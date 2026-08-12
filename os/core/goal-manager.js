// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3A: Autonomous Goal Management
// System — Foundation
// ------------------------------------------------------------
// Step 6 gave the coordination stack a durable, queryable notion of
// "what is running right now" (runtime-context.js) and Step 7 Part 2
// gave it a way to turn ONE free-text goal into a flat, capability-
// routed task list (task-planner.js's planGoal/executeGoal). Neither
// of those owns a durable, hierarchical GOAL RECORD: something with
// a stable id, a parent/child tree (sub-goals of a goal), arbitrary
// caller-attached metadata, and a lifecycle a caller can drive by
// hand — independent of whether that goal is ever decomposed into
// capability-routed tasks at all.
//
// This file is that foundation, and ONLY that foundation:
//   - Goal data model, Goal IDs, parent/child goals, goal metadata.
//   - Goal status: Pending, Queued, Running, Waiting, Completed,
//     Failed, Cancelled — with a real, validated transition table
//     (see PART C), the same "illegal transitions are refused, never
//     silently coerced" posture runtime-context.js already holds
//     itself to for CONTEXT_STATUS.
//   - Goal Registry (PART A: goalsById + parent/child index) and Goal
//     History (PART A: a bounded, append-only transition log).
//   - Runtime Context integration (PART D): exactly one real
//     AxiomRuntimeContext record per goal, created alongside the
//     goal, synced on every metadata/status change, finalized and
//     destroyed once the goal reaches a terminal status — the same
//     create/sync/finalize/destroy shape task-planner.js's own
//     createGoalContext/syncGoalContext/finalizeGoalContext already
//     established. Every call in PART D goes straight through the
//     real os/core/runtime-context.js API; none of Runtime Context's
//     own clone/freeze/transition-validation logic is reimplemented
//     here.
//   - Events published on the existing Orchestrator Event Bus (PART
//     E) — see "Event naming" below for why they are NOT the bare
//     `goal_*` names.
//
// Deliberately NOT in this Part (left for a later Part 3B/3C, exactly
// as Part 2's own header staged goal decomposition/execution/failover
// separately from Part 1's scheduler):
//   - No goal decomposition (free text -> clauses/tasks). That is
//     task-planner.js's decomposeGoal(), untouched.
//   - No capability matching, dispatch, retry, or agent failover.
//     That is capability-router.js's route(), untouched.
//   - No hand-authored multi-stage execution graphs. That is
//     workflow-planner.js's executeWorkflow(), untouched.
//   - No automatic status ticking. This module's status transitions
//     are caller-driven (markGoalQueued/markGoalRunning/... below) —
//     a future part can drive them from task-planner.js/workflow-
//     planner.js progress without this file ever needing to change.
//
// Why this does NOT install anything onto AxiomOrchestrator (a real
// difference from every other os/core/*.js Part so far):
// task-planner.js already fully claims the "Goal" namespace on the
// shared AxiomOrchestrator singleton — Orchestrator.planGoal,
// .executeGoal, .cancelGoal, .retryGoal, .getGoalStatus,
// .getGoalTasks, .listGoals, .GOAL_STATUS, .GOAL_TASK_STATE — for its
// own, differently-shaped "goal plan" concept (a flat, single-run
// task list keyed by planId). This module's "goal" is a different,
// hierarchical, long-lived record keyed by goalId. Reusing any of
// those names on Orchestrator (even `cancelGoal`, even `listGoals`,
// even `GOAL_STATUS`) would silently overwrite or be silently blocked
// by task-planner.js's own install, exactly the class of bug
// RUNTIME_CONTEXT.md's FIX 4 ("Naming Collision") already documents
// and fixes for `createContext`. Rather than invent a second set of
// awkwardly-prefixed Orchestrator method names to dodge that, this
// module follows the same fallback convention capability-router.js /
// workflow-planner.js / task-planner.js all already use for their
// *standalone* export: it is reachable ONLY as window.AxiomGoalManager,
// and it reaches the Event Bus and Runtime Context the same way any
// external caller would — through AxiomOrchestrator.emit/on and
// AxiomRuntimeContext's public API — never by mutating Orchestrator's
// own surface.
//
// Event naming: for the same reason, every event this module publishes
// is prefixed `goalmgr_` (goalmgr_created, goalmgr_queued,
// goalmgr_running, goalmgr_waiting, goalmgr_completed, goalmgr_failed,
// goalmgr_cancelled, goalmgr_child_created, goalmgr_metadata_updated)
// rather than the bare `goal_*` / `goal_task_*` names task-planner.js
// already emits on this exact same shared bus. A listener subscribed
// to `goal_completed` (task-planner.js's plan-level event, payload
// keyed by planId) must never be handed a goalmgr-level payload keyed
// by goalId, or vice versa — same bus, disjoint namespaces.
//
// Usage:
//   const parent = AxiomGoalManager.createGoal({
//     title: 'Ship the Q3 report', metadata: { owner: 'exec-agent' }
//   });
//   const child = AxiomGoalManager.createChildGoal(parent.id, {
//     title: 'Gather the source numbers'
//   });
//   AxiomGoalManager.markGoalQueued(child.id);
//   AxiomGoalManager.markGoalRunning(child.id);
//   AxiomGoalManager.completeGoal(child.id, { rows: 42 });
//   AxiomGoalManager.getChildGoals(parent.id);
//   AxiomGoalManager.getGoalHistory({ goalId: child.id });
//   AxiomOrchestrator.on('goalmgr_completed', ({ goalId }) => { ... });
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;
  var RuntimeContext = global.AxiomRuntimeContext;

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[AxiomGoalManager] ' + message, detail !== undefined ? detail : '');
      return;
    }
    try {
      // eslint-disable-next-line no-console
      console[method === 'error' ? 'error' : 'log']('[AxiomGoalManager] ' + message, detail || '');
    } catch (e) { /* no console available — swallow */ }
  }

  if (!Orchestrator || typeof Orchestrator.emit !== 'function' || typeof Orchestrator.on !== 'function') {
    log('error', 'requires os/core/orchestrator.js (Event Bus) loaded first.');
    return;
  }
  if (!RuntimeContext || typeof RuntimeContext.createContext !== 'function') {
    log('error', 'requires os/core/runtime-context.js loaded first.');
    return;
  }

  var API_VERSION = '1.0.0';

  // ------------------------------------------------------------
  // Small shared helpers (same conventions as workflow-planner.js /
  // capability-router.js / task-planner.js: ES5, no external deps,
  // defensive parsing, own tiny copies rather than reaching into
  // another module's internals).
  // ------------------------------------------------------------
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function now() { return Date.now(); }

  function deepFreeze(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.getOwnPropertyNames(obj).forEach(function (key) {
      var val = obj[key];
      if (val && typeof val === 'object' && !Object.isFrozen(val)) deepFreeze(val);
    });
    return Object.freeze(obj);
  }

  // Goal metadata/result/error only ever need to be JSON-safe plain
  // data (same restriction RUNTIME_CONTEXT.md documents for context
  // payloads, since every goal's metadata is mirrored into its
  // Runtime Context record). Deliberately NOT a bare
  // JSON.parse(JSON.stringify(...)) try/catch: JSON.stringify() does
  // not throw for functions/symbols/undefined — it silently drops or
  // nulls them — which is exactly the silent-corruption failure mode
  // RUNTIME_CONTEXT.md's own FIX 5 documents and moved away from.
  // assertJsonSafe() walks the value first and fails loudly.
  function jsonSafeError(path, reason) {
    var err = new Error('[AxiomGoalManager] value at "' + path + '" is not JSON-safe (' + reason +
      '). Only plain objects/arrays/strings/numbers/booleans/null are supported.');
    err.nonSerializable = true;
    return err;
  }

  function assertJsonSafe(value, path, seen) {
    path = path || '$';
    if (value === null) return;
    var t = typeof value;
    if (t === 'function' || t === 'symbol' || t === 'bigint') throw jsonSafeError(path, t);
    if (t === 'undefined') throw jsonSafeError(path, 'undefined');
    if (t !== 'object') return; // string / number / boolean — safe
    if (seen.indexOf(value) !== -1) throw jsonSafeError(path, 'circular reference');
    seen = seen.concat([value]);
    if (Array.isArray(value)) {
      value.forEach(function (item, i) { assertJsonSafe(item, path + '[' + i + ']', seen); });
      return;
    }
    Object.keys(value).forEach(function (k) { assertJsonSafe(value[k], path + '.' + k, seen); });
  }

  function safeClone(value) {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'object') return value;
    assertJsonSafe(value, '$', []);
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      throw jsonSafeError('$', (err && err.message) || String(err));
    }
  }

  var idCounter = 0;
  function makeId(prefix) {
    idCounter += 1;
    return prefix + '_' + now().toString(36) + '_' + idCounter.toString(36);
  }

  // ------------------------------------------------------------
  // PART A — Goal status model
  // ------------------------------------------------------------
  var GOAL_STATUS = {
    PENDING: 'pending',
    QUEUED: 'queued',
    RUNNING: 'running',
    WAITING: 'waiting',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  };

  var TERMINAL_GOAL_STATUSES = [GOAL_STATUS.COMPLETED, GOAL_STATUS.FAILED, GOAL_STATUS.CANCELLED];
  function isTerminal(status) { return TERMINAL_GOAL_STATUSES.indexOf(status) !== -1; }

  var VALID_STATUSES = Object.keys(GOAL_STATUS).map(function (k) { return GOAL_STATUS[k]; });
  function isKnownStatus(status) { return VALID_STATUSES.indexOf(status) !== -1; }

  // ------------------------------------------------------------
  // PART F (3B) — Priority levels. A small closed enum (same posture
  // as GOAL_STATUS above: a fixed, named set rather than an arbitrary
  // numeric range) so ordering is predictable and every caller means
  // the same thing by "high priority". Higher number = scheduled
  // sooner.
  // ------------------------------------------------------------
  var GOAL_PRIORITY = { LOW: 1, NORMAL: 5, HIGH: 8, CRITICAL: 10 };
  var VALID_PRIORITIES = Object.keys(GOAL_PRIORITY).map(function (k) { return GOAL_PRIORITY[k]; });
  function isKnownPriority(p) { return VALID_PRIORITIES.indexOf(p) !== -1; }

  // Adjacency list of legal forward transitions — same shape/posture
  // as runtime-context.js's own TRANSITIONS table. WAITING -> QUEUED
  // exists so a goal blocked on something (a dependency, an external
  // approval) can be re-admitted without ever pretending it was still
  // RUNNING while it waited.
  var TRANSITIONS = {};
  TRANSITIONS[GOAL_STATUS.PENDING] = [GOAL_STATUS.QUEUED, GOAL_STATUS.WAITING, GOAL_STATUS.CANCELLED, GOAL_STATUS.FAILED];
  TRANSITIONS[GOAL_STATUS.QUEUED] = [GOAL_STATUS.RUNNING, GOAL_STATUS.CANCELLED, GOAL_STATUS.FAILED];
  TRANSITIONS[GOAL_STATUS.RUNNING] = [GOAL_STATUS.WAITING, GOAL_STATUS.COMPLETED, GOAL_STATUS.FAILED, GOAL_STATUS.CANCELLED];
  TRANSITIONS[GOAL_STATUS.WAITING] = [GOAL_STATUS.QUEUED, GOAL_STATUS.RUNNING, GOAL_STATUS.FAILED, GOAL_STATUS.CANCELLED];
  TRANSITIONS[GOAL_STATUS.COMPLETED] = [];
  TRANSITIONS[GOAL_STATUS.FAILED] = [];
  TRANSITIONS[GOAL_STATUS.CANCELLED] = [];

  function canTransition(from, to) {
    var allowed = TRANSITIONS[from];
    return !!allowed && allowed.indexOf(to) !== -1;
  }

  // ------------------------------------------------------------
  // PART A (cont.) — Goal Registry, parent/child index, Goal History
  // ------------------------------------------------------------
  // Unlike Runtime Context's activeById/archivedById split (contexts
  // are ephemeral execution state that gets swept away), goals are
  // durable records: goalsById is the single Goal Registry and never
  // evicts a goal on its own, terminal or not. Nothing in this Part
  // deletes a goal — that policy decision is deliberately left open
  // for a later part rather than guessed at here.
  var goalsById = Object.create(null);
  // parentId -> [childGoalId, ...]
  var childIndex = Object.create(null);

  // ------------------------------------------------------------
  // Part 3B state (Scheduling & Prioritization) — lives alongside the
  // Part 3A registry above, same "external index next to goalsById"
  // shape childIndex already established (never stored as extra
  // fuzzy fields hanging off the goal record itself).
  //   dependsOn[goalId]  -> [prerequisiteGoalId, ...]   (goalId needs these)
  //   dependents[goalId] -> [dependentGoalId, ...]      (reverse index)
  //   dedupeIndex[key]   -> goalId                      (duplicate prevention)
  // ------------------------------------------------------------
  var dependsOn = Object.create(null);
  var dependents = Object.create(null);
  var dedupeIndex = Object.create(null);

  function dedupeIndexKey(parentId, dedupeKey) {
    return (parentId || '$root') + '::' + dedupeKey;
  }

  // Bounded, append-only log of every create/transition/metadata-
  // update event any goal has ever gone through — the Goal History,
  // independent of (and outliving) any single goal's own current
  // state. Same bounded-array shape as runtime-context.js's history.
  var history = [];
  var HISTORY_LIMIT = 2000;

  var metrics = { createdCount: 0, completedCount: 0, failedCount: 0, cancelledCount: 0 };

  function pushHistory(g, event, detail) {
    history.push({
      goalId: g.id,
      parentId: g.parentId,
      status: g.status,
      event: event,
      detail: detail !== undefined ? detail : null,
      at: now()
    });
    if (history.length > HISTORY_LIMIT) history.shift();
  }

  function emit(event, payload) {
    try {
      Orchestrator.emit(event, payload);
    } catch (err) {
      log('error', 'emit:' + event + ' failed', err && err.message);
    }
  }

  function findGoal(goalId) {
    return (isNonEmptyString(goalId) && goalsById[goalId]) || null;
  }

  function requireGoal(goalId) {
    var g = findGoal(goalId);
    if (!g) throw new Error('[AxiomGoalManager] goal "' + goalId + '" does not exist.');
    return g;
  }

  // ------------------------------------------------------------
  // PART B — Immutable snapshots. Same discipline as runtime-
  // context.js's snapshot(): this is the ONLY shape any caller
  // outside this file ever sees; the live mutable records in
  // goalsById never leak out directly.
  // ------------------------------------------------------------
  function snapshotGoal(g) {
    if (!g) return null;
    return deepFreeze({
      id: g.id,
      parentId: g.parentId,
      childIds: (childIndex[g.id] || []).slice(),
      title: g.title,
      description: g.description,
      metadata: safeClone(g.metadata),
      status: g.status,
      contextId: g.contextId,
      result: safeClone(g.result),
      error: g.error,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      startedAt: g.startedAt,
      finishedAt: g.finishedAt,
      // --- Part 3B additions (see PART F/G/I below) ---
      priority: g.priority,
      dependsOn: (dependsOn[g.id] || []).slice(),
      dependents: (dependents[g.id] || []).slice(),
      isPaused: g.isPaused,
      pausedAt: g.pausedAt,
      pauseReason: g.pauseReason,
      dedupeKey: g.dedupeKey,
      retryOf: g.retryOf,
      retryCount: g.retryCount
    });
  }

  // ------------------------------------------------------------
  // PART D — Runtime Context integration. Same create/sync/finalize/
  // destroy shape task-planner.js's createGoalContext/
  // syncGoalContext/finalizeGoalContext already established for
  // goal-shaped work over runtime-context.js's public API — nothing
  // about Runtime Context's own lifecycle, clone/freeze, or
  // transition-validation logic is reimplemented here.
  // ------------------------------------------------------------
  function createGoalRuntimeContext(g) {
    try {
      var rc = RuntimeContext.createContext({
        metadata: { goalId: g.id, parentId: g.parentId, title: g.title },
        state: { status: g.status },
        temporaryData: { metadata: g.metadata }
      });
      // Mirrors task-planner.js's createGoalContext(): the context is
      // marked ready-then-running immediately, so it stays a single
      // coarse "this goal record is active" container for the whole
      // life of the goal. The goal's own PENDING/QUEUED/WAITING/...
      // status is the fine-grained state of record; it is mirrored
      // into the context's `state` on every sync rather than driving
      // a second, parallel Runtime Context status machine.
      RuntimeContext.markReady(rc.contextId);
      RuntimeContext.markRunning(rc.contextId);
      return rc.contextId;
    } catch (err) {
      log('error', 'createGoalRuntimeContext failed', { goalId: g.id, message: err && err.message });
      return null;
    }
  }

  function syncGoalRuntimeContext(g) {
    if (!g.contextId) return;
    try {
      RuntimeContext.updateContext(g.contextId, {
        state: { status: g.status, result: g.result, error: g.error },
        temporaryData: { metadata: g.metadata }
      });
    } catch (err) {
      log('error', 'syncGoalRuntimeContext failed', { goalId: g.id, contextId: g.contextId, message: err && err.message });
    }
  }

  function finalizeGoalRuntimeContext(g, reason) {
    if (!g.contextId) return;
    syncGoalRuntimeContext(g);
    try {
      if (g.status === GOAL_STATUS.COMPLETED) RuntimeContext.completeContext(g.contextId, g.result);
      else if (g.status === GOAL_STATUS.FAILED) RuntimeContext.failContext(g.contextId, reason);
      else RuntimeContext.cancelContext(g.contextId, reason);
    } catch (err) {
      log('error', 'finalizeGoalRuntimeContext failed', { goalId: g.id, contextId: g.contextId, message: err && err.message });
    }
    try {
      RuntimeContext.destroyContext(g.contextId, reason || g.status);
    } catch (err) {
      log('error', 'destroyGoalRuntimeContext failed', { goalId: g.id, contextId: g.contextId, message: err && err.message });
    }
  }

  // ------------------------------------------------------------
  // PART A (cont.) — Goal creation
  // ------------------------------------------------------------
  function validateParentId(parentId) {
    if (parentId === undefined || parentId === null) return null;
    if (!isNonEmptyString(parentId)) {
      throw new Error('[AxiomGoalManager] parentId must be a non-empty string when provided.');
    }
    if (!goalsById[parentId]) {
      throw new Error('[AxiomGoalManager] createGoal: parentId "' + parentId + '" does not exist.');
    }
    return parentId;
  }

  function createGoal(options) {
    options = isPlainObject(options) ? options : {};
    var parentId = validateParentId(options.parentId);

    // PART J — Duplicate goal prevention. Opt-in: only goals created
    // with an explicit dedupeKey participate. If a non-terminal goal
    // already holds that (parentId, dedupeKey) slot, createGoal() is
    // idempotent — it returns the EXISTING goal (flagged `duplicate:
    // true`) instead of minting a second one. A terminal goal's slot
    // is free again (that unit of work is done, retrying it is a
    // deliberate new goal, not a duplicate of a finished one).
    var dedupeKey = isNonEmptyString(options.dedupeKey) ? options.dedupeKey : null;
    if (dedupeKey) {
      var dKey = dedupeIndexKey(parentId, dedupeKey);
      var existingId = dedupeIndex[dKey];
      var existing = existingId ? goalsById[existingId] : null;
      if (existing && !isTerminal(existing.status)) {
        var dup = snapshotGoal(existing);
        var out = {};
        Object.keys(dup).forEach(function (k) { out[k] = dup[k]; });
        out.duplicate = true;
        return deepFreeze(out);
      }
    }

    var priority = options.priority !== undefined ? options.priority : GOAL_PRIORITY.NORMAL;
    if (!isKnownPriority(priority)) {
      throw new Error('[AxiomGoalManager] createGoal: priority must be one of GOAL_PRIORITY (' +
        VALID_PRIORITIES.join(', ') + ').');
    }

    var id = makeId('goal');

    var g = {
      id: id,
      parentId: parentId,
      title: isNonEmptyString(options.title)
        ? options.title
        : (isNonEmptyString(options.description) ? options.description : 'Untitled goal'),
      description: isNonEmptyString(options.description) ? options.description : null,
      metadata: isPlainObject(options.metadata) ? safeClone(options.metadata) : {},
      status: GOAL_STATUS.PENDING,
      contextId: null,
      result: null,
      error: null,
      createdAt: now(),
      updatedAt: now(),
      startedAt: null,
      finishedAt: null,
      priority: priority,
      isPaused: false,
      pausedAt: null,
      pauseReason: null,
      dedupeKey: dedupeKey,
      retryOf: isNonEmptyString(options.retryOf) ? options.retryOf : null,
      retryCount: 0
    };

    goalsById[id] = g;
    if (parentId) {
      var siblings = childIndex[parentId] || (childIndex[parentId] = []);
      siblings.push(id);
    }
    if (dedupeKey) dedupeIndex[dedupeIndexKey(parentId, dedupeKey)] = id;

    g.contextId = createGoalRuntimeContext(g);

    metrics.createdCount += 1;
    pushHistory(g, 'created');
    emit('goalmgr_created', { goalId: g.id, parentId: g.parentId, title: g.title, status: g.status, priority: g.priority });
    if (parentId) emit('goalmgr_child_created', { goalId: g.id, parentId: parentId });

    return snapshotGoal(g);
  }

  function createChildGoal(parentId, options) {
    if (!isNonEmptyString(parentId)) {
      throw new Error('[AxiomGoalManager] createChildGoal: parentId is required.');
    }
    options = isPlainObject(options) ? options : {};
    var merged = {};
    Object.keys(options).forEach(function (k) { merged[k] = options[k]; });
    merged.parentId = parentId;
    return createGoal(merged);
  }

  // ------------------------------------------------------------
  // PART A (cont.) — Registry read APIs
  // ------------------------------------------------------------
  function getGoal(goalId) {
    return snapshotGoal(findGoal(goalId));
  }

  function getChildGoals(goalId) {
    return (childIndex[goalId] || [])
      .map(function (id) { return snapshotGoal(goalsById[id]); })
      .filter(Boolean);
  }

  function getParentGoal(goalId) {
    var g = findGoal(goalId);
    if (!g || !g.parentId) return null;
    return snapshotGoal(goalsById[g.parentId]);
  }

  function listGoals(filter) {
    filter = isPlainObject(filter) ? filter : {};
    return Object.keys(goalsById)
      .map(function (id) { return goalsById[id]; })
      .filter(function (g) {
        if (filter.status && g.status !== filter.status) return false;
        if (filter.parentId !== undefined && g.parentId !== filter.parentId) return false;
        if (filter.rootOnly && g.parentId) return false;
        return true;
      })
      .map(snapshotGoal);
  }

  function updateGoalMetadata(goalId, patch) {
    var g = requireGoal(goalId);
    if (!isPlainObject(patch)) {
      throw new Error('[AxiomGoalManager] updateGoalMetadata: patch must be a plain object.');
    }
    var cloned = safeClone(patch);
    Object.keys(cloned).forEach(function (k) { g.metadata[k] = cloned[k]; });
    g.updatedAt = now();

    syncGoalRuntimeContext(g);
    pushHistory(g, 'metadata_updated', { keys: Object.keys(cloned) });
    emit('goalmgr_metadata_updated', { goalId: g.id, metadata: safeClone(g.metadata) });

    return snapshotGoal(g);
  }

  // ------------------------------------------------------------
  // PART C — Status transitions
  // ------------------------------------------------------------
  function transitionGoal(goalId, toStatus, detail) {
    var g = requireGoal(goalId);
    if (!isKnownStatus(toStatus)) {
      throw new Error('[AxiomGoalManager] transitionGoal: unknown status "' + toStatus + '".');
    }
    if (!canTransition(g.status, toStatus)) {
      return {
        success: false,
        error: 'Illegal transition ' + g.status + ' -> ' + toStatus + ' for goal "' + goalId + '".',
        goal: snapshotGoal(g)
      };
    }

    var fromStatus = g.status;
    g.status = toStatus;
    g.updatedAt = now();
    if (toStatus === GOAL_STATUS.RUNNING && !g.startedAt) g.startedAt = now();
    if (isTerminal(toStatus)) g.finishedAt = now();
    if (toStatus === GOAL_STATUS.COMPLETED && detail !== undefined) g.result = safeClone(detail);
    if ((toStatus === GOAL_STATUS.FAILED || toStatus === GOAL_STATUS.CANCELLED) && detail !== undefined) {
      g.error = detail;
    }

    pushHistory(g, 'transition', { from: fromStatus, to: toStatus, detail: detail !== undefined ? detail : null });

    if (isTerminal(toStatus)) {
      if (toStatus === GOAL_STATUS.COMPLETED) metrics.completedCount += 1;
      else if (toStatus === GOAL_STATUS.FAILED) metrics.failedCount += 1;
      else metrics.cancelledCount += 1;
      finalizeGoalRuntimeContext(g, typeof detail === 'string' ? detail : g.error);
    } else {
      syncGoalRuntimeContext(g);
    }

    emit('goalmgr_' + toStatus, {
      goalId: g.id, parentId: g.parentId, status: toStatus, from: fromStatus,
      detail: detail !== undefined ? detail : null
    });

    return { success: true, goal: snapshotGoal(g) };
  }

  function markGoalQueued(goalId, detail) { return transitionGoal(goalId, GOAL_STATUS.QUEUED, detail); }
  function markGoalRunning(goalId, detail) { return transitionGoal(goalId, GOAL_STATUS.RUNNING, detail); }
  function markGoalWaiting(goalId, detail) { return transitionGoal(goalId, GOAL_STATUS.WAITING, detail); }
  function completeGoal(goalId, result) { return transitionGoal(goalId, GOAL_STATUS.COMPLETED, result); }
  function failGoal(goalId, reason) { return transitionGoal(goalId, GOAL_STATUS.FAILED, reason); }
  function cancelGoal(goalId, reason) { return transitionGoal(goalId, GOAL_STATUS.CANCELLED, reason); }

  // ------------------------------------------------------------
  // PART A (cont.) — Goal History & metrics reads
  // ------------------------------------------------------------
  function getGoalHistory(filter, limit) {
    filter = isPlainObject(filter) ? filter : {};
    var out = history.filter(function (e) {
      if (filter.goalId && e.goalId !== filter.goalId) return false;
      if (filter.parentId !== undefined && e.parentId !== filter.parentId) return false;
      if (filter.event && e.event !== filter.event) return false;
      return true;
    });
    out = out.slice().reverse(); // most recent first
    if (typeof limit === 'number' && limit >= 0) out = out.slice(0, limit);
    return out.map(function (e) {
      var copy = {};
      Object.keys(e).forEach(function (k) { copy[k] = e[k]; });
      return copy;
    });
  }

  function getGoalMetrics() {
    var byStatus = {};
    VALID_STATUSES.forEach(function (s) { byStatus[s] = 0; });
    Object.keys(goalsById).forEach(function (id) { byStatus[goalsById[id].status] += 1; });
    return {
      total: Object.keys(goalsById).length,
      byStatus: byStatus,
      createdCount: metrics.createdCount,
      completedCount: metrics.completedCount,
      failedCount: metrics.failedCount,
      cancelledCount: metrics.cancelledCount
    };
  }

  // ------------------------------------------------------------
  // PART F (3B, cont.) — Priority
  // ------------------------------------------------------------
  function setGoalPriority(goalId, priority) {
    var g = requireGoal(goalId);
    if (isTerminal(g.status)) {
      throw new Error('[AxiomGoalManager] setGoalPriority: goal "' + goalId + '" is terminal (' + g.status + ').');
    }
    if (!isKnownPriority(priority)) {
      throw new Error('[AxiomGoalManager] setGoalPriority: priority must be one of GOAL_PRIORITY (' +
        VALID_PRIORITIES.join(', ') + ').');
    }
    var from = g.priority;
    g.priority = priority;
    g.updatedAt = now();
    pushHistory(g, 'priority_changed', { from: from, to: priority });
    emit('goalmgr_priority_changed', { goalId: g.id, from: from, to: priority });
    return snapshotGoal(g);
  }

  // ------------------------------------------------------------
  // PART G (3B) — Dependency tracking & circular dependency detection
  // ------------------------------------------------------------
  function addEdge(map, key, value) {
    var list = map[key] || (map[key] = []);
    if (list.indexOf(value) === -1) list.push(value);
  }
  function removeEdge(map, key, value) {
    var list = map[key];
    if (!list) return;
    var idx = list.indexOf(value);
    if (idx !== -1) list.splice(idx, 1);
  }

  // Would adding "goalId depends on prereqId" create a cycle? True
  // iff goalId is already reachable FROM prereqId by walking existing
  // dependsOn edges — i.e. prereqId (transitively) already depends on
  // goalId, so goalId would end up depending on itself.
  function wouldCreateCycle(goalId, prereqId) {
    if (goalId === prereqId) return true;
    var seen = Object.create(null);
    var stack = [prereqId];
    while (stack.length) {
      var cur = stack.pop();
      if (cur === goalId) return true;
      if (seen[cur]) continue;
      seen[cur] = true;
      (dependsOn[cur] || []).forEach(function (next) { stack.push(next); });
    }
    return false;
  }

  function addGoalDependency(goalId, prereqGoalId) {
    var g = requireGoal(goalId);
    var prereq = requireGoal(prereqGoalId);
    if (g.id === prereq.id) {
      throw new Error('[AxiomGoalManager] addGoalDependency: a goal cannot depend on itself ("' + goalId + '").');
    }
    if ((dependsOn[g.id] || []).indexOf(prereq.id) !== -1) {
      return getGoalDependencies(g.id); // already recorded — idempotent
    }
    if (wouldCreateCycle(g.id, prereq.id)) {
      throw new Error('[AxiomGoalManager] addGoalDependency: "' + goalId + '" -> "' + prereqGoalId +
        '" would create a circular dependency.');
    }
    addEdge(dependsOn, g.id, prereq.id);
    addEdge(dependents, prereq.id, g.id);
    pushHistory(g, 'dependency_added', { dependsOn: prereq.id });
    emit('goalmgr_dependency_added', { goalId: g.id, dependsOn: prereq.id });
    return getGoalDependencies(g.id);
  }

  function removeGoalDependency(goalId, prereqGoalId) {
    var g = requireGoal(goalId);
    requireGoal(prereqGoalId);
    removeEdge(dependsOn, g.id, prereqGoalId);
    removeEdge(dependents, prereqGoalId, g.id);
    pushHistory(g, 'dependency_removed', { dependsOn: prereqGoalId });
    emit('goalmgr_dependency_removed', { goalId: g.id, dependsOn: prereqGoalId });
    return getGoalDependencies(g.id);
  }

  function getGoalDependencies(goalId) {
    requireGoal(goalId);
    return (dependsOn[goalId] || []).map(function (id) {
      var p = goalsById[id];
      return { goalId: id, status: p ? p.status : null, satisfied: !!p && p.status === GOAL_STATUS.COMPLETED };
    });
  }

  function getGoalDependents(goalId) {
    requireGoal(goalId);
    return (dependents[goalId] || []).slice();
  }

  function isGoalBlocked(goalId) {
    var g = requireGoal(goalId);
    return (dependsOn[g.id] || []).some(function (id) {
      var p = goalsById[id];
      return !p || p.status !== GOAL_STATUS.COMPLETED;
    });
  }

  // ------------------------------------------------------------
  // PART G (cont.) — Automatic goal ordering. A pure read: Kahn's-
  // algorithm topological sort over the live dependency graph,
  // restricted to non-terminal goals (a completed/failed/cancelled
  // prerequisite is already resolved as far as ordering is concerned
  // — see isGoalBlocked() for whether it's *satisfied*), tie-broken
  // by priority (desc) then createdAt (asc) — same "read-computed
  // from the single registry" posture listGoals()/getGoalQueue()
  // already use; no separate ordering structure is kept in sync.
  // ------------------------------------------------------------
  function prioritySort(list) {
    return list.slice().sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
  }

  function getGoalExecutionOrder(filter) {
    filter = isPlainObject(filter) ? filter : {};
    var candidateIds = isPlainObject(filter) && Array.isArray(filter.goalIds)
      ? filter.goalIds.filter(function (id) { return !!goalsById[id]; })
      : Object.keys(goalsById);

    var candidates = candidateIds
      .map(function (id) { return goalsById[id]; })
      .filter(function (g) { return !isTerminal(g.status); });

    var candidateSet = Object.create(null);
    candidates.forEach(function (g) { candidateSet[g.id] = true; });

    var inDegree = Object.create(null);
    candidates.forEach(function (g) {
      inDegree[g.id] = (dependsOn[g.id] || []).filter(function (dep) { return candidateSet[dep]; }).length;
    });

    var remaining = candidates.slice();
    var order = [];
    var guard = candidates.length + 1;

    while (remaining.length && guard-- > 0) {
      var ready = prioritySort(remaining.filter(function (g) { return inDegree[g.id] === 0; }));
      if (!ready.length) break; // defensive — cycles are refused at creation time, this should not happen
      var next = ready[0];
      order.push(next);
      remaining = remaining.filter(function (g) { return g.id !== next.id; });
      (dependents[next.id] || []).forEach(function (depId) {
        if (inDegree[depId] !== undefined) inDegree[depId] -= 1;
      });
    }

    if (remaining.length) {
      throw new Error('[AxiomGoalManager] getGoalExecutionOrder: unresolved cycle among goals [' +
        remaining.map(function (g) { return g.id; }).join(', ') + '].');
    }

    return order.map(snapshotGoal);
  }

  // ------------------------------------------------------------
  // PART H (3B) — Goal queue & scheduling. The queue is deliberately
  // NOT a separately-maintained array (that would be a second source
  // of truth to keep in sync, and this stack already has ONE real
  // scheduler/queue — os/runtime/scheduler/task-scheduler.js — for
  // agent-runtime jobs, which this file does not touch or duplicate).
  // getGoalQueue() is a pure, computed read over the Goal Registry,
  // exactly like listGoals(): the QUEUED goals, ordered by priority
  // then createdAt. scheduleGoal()/runGoalScheduler() only ever drive
  // goals through the existing, validated transitionGoal() state
  // machine — no parallel status or ordering logic is introduced.
  // ------------------------------------------------------------
  function getGoalQueue() {
    var queued = Object.keys(goalsById)
      .map(function (id) { return goalsById[id]; })
      .filter(function (g) { return g.status === GOAL_STATUS.QUEUED; });
    return prioritySort(queued).map(snapshotGoal);
  }

  function enqueueGoal(goalId) {
    var g = requireGoal(goalId);
    if (g.status === GOAL_STATUS.QUEUED) return { success: true, goal: snapshotGoal(g) };
    return transitionGoal(g.id, GOAL_STATUS.QUEUED);
  }

  // Pops and runs the single best candidate at the head of the queue
  // (highest priority, then oldest). Returns the same
  // { success, goal } / { success:false, error } shape transitionGoal()
  // already returns everywhere else in this file.
  function dequeueNextGoal() {
    var head = getGoalQueue()[0];
    if (!head) return { success: false, error: 'queue is empty', goal: null };
    return markGoalRunning(head.id);
  }

  // Attempts to admit ONE goal into the queue, respecting its
  // dependencies: blocked -> parked in WAITING; clear -> QUEUED.
  // A no-op (returns current state) for anything already past PENDING
  // /WAITING, or for a terminal goal.
  function scheduleGoal(goalId) {
    var g = requireGoal(goalId);
    if (isTerminal(g.status)) {
      return { scheduled: false, blocked: false, goal: snapshotGoal(g) };
    }
    if (g.status !== GOAL_STATUS.PENDING && g.status !== GOAL_STATUS.WAITING) {
      return { scheduled: false, blocked: isGoalBlocked(g.id), goal: snapshotGoal(g) };
    }
    if (isGoalBlocked(g.id)) {
      if (g.status !== GOAL_STATUS.WAITING) transitionGoal(g.id, GOAL_STATUS.WAITING, 'blocked by unresolved dependencies');
      return { scheduled: false, blocked: true, goal: getGoal(g.id) };
    }
    var r = transitionGoal(g.id, GOAL_STATUS.QUEUED);
    return { scheduled: r.success, blocked: false, goal: r.goal };
  }

  // Runs scheduleGoal() across every eligible (Pending/Waiting) goal,
  // in automatic-ordering order, so dependents are considered after
  // their prerequisites have had a chance to be admitted first.
  function runGoalScheduler(filter) {
    var order = getGoalExecutionOrder(filter);
    var scheduled = [];
    var blocked = [];
    order.forEach(function (snap) {
      if (snap.status !== GOAL_STATUS.PENDING && snap.status !== GOAL_STATUS.WAITING) return;
      var r = scheduleGoal(snap.id);
      if (r.scheduled) scheduled.push(r.goal);
      else if (r.blocked) blocked.push(r.goal);
    });
    return { scheduled: scheduled, blocked: blocked };
  }

  // ------------------------------------------------------------
  // PART I (3B) — Pause / Resume / Cancel / Retry. Cancel reuses
  // Part 3A's cancelGoal() untouched (still exported below). Pause/
  // Resume are a semantic layer over the existing RUNNING/QUEUED <->
  // WAITING edges transitionGoal() already validates — no new status
  // is introduced, and an already-blocked (dependency-WAITING) goal
  // is left alone by pauseGoal() rather than double-parked.
  // ------------------------------------------------------------
  function pauseGoal(goalId, reason) {
    var g = requireGoal(goalId);
    if (g.status !== GOAL_STATUS.RUNNING && g.status !== GOAL_STATUS.QUEUED) {
      throw new Error('[AxiomGoalManager] pauseGoal: goal "' + goalId +
        '" must be Running or Queued to pause (is "' + g.status + '").');
    }
    var r = transitionGoal(g.id, GOAL_STATUS.WAITING, reason !== undefined ? reason : 'paused');
    if (!r.success) return r;
    g.isPaused = true;
    g.pausedAt = now();
    g.pauseReason = reason !== undefined ? reason : null;
    pushHistory(g, 'paused', { reason: g.pauseReason });
    emit('goalmgr_paused', { goalId: g.id, reason: g.pauseReason });
    return { success: true, goal: getGoal(g.id) };
  }

  function resumeGoal(goalId) {
    var g = requireGoal(goalId);
    if (g.status !== GOAL_STATUS.WAITING) {
      throw new Error('[AxiomGoalManager] resumeGoal: goal "' + goalId +
        '" is not Waiting (is "' + g.status + '").');
    }
    if (!g.isPaused) {
      throw new Error('[AxiomGoalManager] resumeGoal: goal "' + goalId +
        '" is Waiting on unresolved dependencies, not paused — use scheduleGoal()/runGoalScheduler() instead.');
    }
    var r = transitionGoal(g.id, GOAL_STATUS.QUEUED);
    if (!r.success) return r;
    g.isPaused = false;
    g.pausedAt = null;
    g.pauseReason = null;
    pushHistory(g, 'resumed');
    emit('goalmgr_resumed', { goalId: g.id });
    return { success: true, goal: getGoal(g.id) };
  }

  // Creates a fresh goal that carries forward the failed/cancelled
  // goal's title/description/metadata/parent/priority and its
  // dependency edges, linked back via retryOf/retryCount — it does
  // NOT mutate or re-admit the original terminal record (Part 3A:
  // "Nothing in this Part deletes a goal" / terminal statuses have no
  // outgoing transitions, and that stays true here).
  function retryGoal(goalId, options) {
    var original = requireGoal(goalId);
    if (original.status !== GOAL_STATUS.FAILED && original.status !== GOAL_STATUS.CANCELLED) {
      throw new Error('[AxiomGoalManager] retryGoal: goal "' + goalId +
        '" must be Failed or Cancelled to retry (is "' + original.status + '").');
    }
    options = isPlainObject(options) ? options : {};

    var next = createGoal({
      title: original.title,
      description: original.description,
      parentId: original.parentId,
      metadata: original.metadata,
      priority: options.priority !== undefined ? options.priority : original.priority,
      retryOf: original.id
    });

    var nextGoal = goalsById[next.id];
    nextGoal.retryCount = original.retryCount + 1;

    (dependsOn[original.id] || []).forEach(function (prereqId) {
      if (goalsById[prereqId]) addGoalDependency(next.id, prereqId);
    });

    pushHistory(nextGoal, 'retried', { retryOf: original.id });
    emit('goalmgr_retried', { goalId: nextGoal.id, retryOf: original.id, retryCount: nextGoal.retryCount });

    return getGoal(next.id);
  }

  // ------------------------------------------------------------
  // Standalone global only — see the header comment above for why
  // this deliberately does NOT install anything onto AxiomOrchestrator.
  // orchestrator.js, runtime-context.js, capability-router.js,
  // agent-registry-integration.js, workflow-planner.js, and
  // task-planner.js are none of them edited by this file.
  // ------------------------------------------------------------
  var AxiomGoalManager = {
    API_VERSION: API_VERSION,
    GOAL_STATUS: GOAL_STATUS,
    GOAL_PRIORITY: GOAL_PRIORITY,

    createGoal: createGoal,
    createChildGoal: createChildGoal,
    getGoal: getGoal,
    getChildGoals: getChildGoals,
    getParentGoal: getParentGoal,
    listGoals: listGoals,
    updateGoalMetadata: updateGoalMetadata,

    canTransitionGoal: canTransition,
    transitionGoal: transitionGoal,
    markGoalQueued: markGoalQueued,
    markGoalRunning: markGoalRunning,
    markGoalWaiting: markGoalWaiting,
    completeGoal: completeGoal,
    failGoal: failGoal,
    cancelGoal: cancelGoal,

    getGoalHistory: getGoalHistory,
    getGoalMetrics: getGoalMetrics,

    // --- Part 3B: Scheduling & Prioritization ---
    setGoalPriority: setGoalPriority,

    addGoalDependency: addGoalDependency,
    removeGoalDependency: removeGoalDependency,
    getGoalDependencies: getGoalDependencies,
    getGoalDependents: getGoalDependents,
    isGoalBlocked: isGoalBlocked,
    getGoalExecutionOrder: getGoalExecutionOrder,

    getGoalQueue: getGoalQueue,
    enqueueGoal: enqueueGoal,
    dequeueNextGoal: dequeueNextGoal,
    scheduleGoal: scheduleGoal,
    runGoalScheduler: runGoalScheduler,

    pauseGoal: pauseGoal,
    resumeGoal: resumeGoal,
    retryGoal: retryGoal
  };

  global.AxiomGoalManager = AxiomGoalManager;
})(window);
