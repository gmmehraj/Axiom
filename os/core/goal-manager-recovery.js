// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3F: Adaptive Execution &
// Recovery Layer
// ------------------------------------------------------------
// Parts 3A/3B (goal-manager.js) gave the stack a durable Goal Record,
// a validated status machine, dependencies, and a computed queue.
// Part 3C (autonomous-decision-engine.js) added eligibility-aware
// admission. Part 3D (decision-engine-execution-bridge.js) wired
// admission through to real Task Planner execution, mirrored
// progress back onto the Goal Record, and already retries a failed
// GOAL a bounded number of times before giving up
// (`decisionengine_execution_exhausted`). Part 3E (goal-manager-
// learning.js) started remembering which strategies tend to succeed
// or fail and can recommend a better order/priority. None of those
// five Parts ever watches an IN-FLIGHT goal for going quiet, tells a
// permanently-impossible goal apart from a merely-unlucky one once
// Part 3D's own retry budget is spent, or repairs the dependency
// graph so a goal that depends on a dead goal is not blocked forever.
//
// This Part is exactly that adaptive layer, and adds nothing else:
//
//   1. Monitors active goal execution in real time — `checkGoalHealth()`
//      / `monitorActiveGoals()` read the SAME three sources of truth
//      every other Part already reads (`AxiomGoalManager.getGoal()`,
//      `AxiomRuntimeContext.getContext()` via the Goal Record's own
//      `contextId`, and — when Part 3D is loaded —
//      `AxiomDecisionEngineExecutionBridge.getExecution()`). No
//      second, independently-ticking status is kept; this module only
//      remembers the last time it observed activity for a goal so it
//      can compute idle time.
//   2. Detects stalled goals — a RUNNING goal with no observed
//      progress for longer than `getStallThresholdMs()` (default
//      30s, caller-configurable, same "explicit knob, sane default"
//      posture Part 3D's `maxExecutionRetries` already uses).
//   3. Detects blocked goals — reuses Part 3A/3B's own
//      `isGoalBlocked()` (and Part 3C's own `evaluateGoal()` when
//      loaded, for the richer reason string) verbatim; no second
//      dependency-satisfaction check is implemented here.
//   4. Detects repeated execution failures — reuses the Goal Record's
//      OWN `retryCount` (already incremented by Part 3A's
//      `retryGoal()` on every retry, across the whole lineage) against
//      a configurable `getMaxRecoveryAttempts()` ceiling, plus Part
//      3D's own `decisionengine_execution_exhausted` event when that
//      Part is loaded. No parallel failure counter is invented.
//   5. Automatically retries recoverable goals using the EXISTING
//      retry system — `attemptRecovery()` calls Part 3A's own
//      `retryGoal()` (mints a fresh Goal Record, never mutates the
//      failed one — exactly the call Part 3D's own `attemptRetry()`
//      already makes) and, when Part 3C is loaded, re-enters it
//      through `AxiomDecisionEngine.admitGoal()` — the same
//      eligibility-checked admission path every other goal goes
//      through. Recoverability itself is decided by re-using Part
//      3C's own `evaluateGoal()` reason string on the freshly-minted
//      retry candidate (see `RECOVERY.md` companion notes in
//      `STEP7_PART3F_VALIDATION.md` §3.1) — never a second capability/
//      agent-availability check invented locally.
//   6. Reorders remaining goals when execution conditions change —
//      calls Part 3E's own `optimizeGoalScheduling()` when loaded
//      (falls back to Part 3B's own `runGoalScheduler()` when Part 3E
//      is not present); no ordering logic of any kind is reimplemented
//      here.
//   7. Skips goals that become impossible — a permanently-impossible
//      goal (Part 3C's `evaluateGoal()` reports no agent anywhere
//      advertises the required capability) is cancelled via Part 3A's
//      own `cancelGoal()`. Dependents that explicitly opted the
//      dependency out via `metadata.optionalDependencies` (a goal's
//      own metadata — the same "caller-declared, never invented" data
//      source Part 3C's `resolveGoalCapability()` and Part 3D's
//      `metadata.maxRetries` already use) are unblocked via Part 3B's
//      own `removeGoalDependency()`; every other dependent is left
//      exactly as blocked as `isGoalBlocked()` already says it is.
//   8. Resumes interrupted execution after recovery — without Part
//      3D loaded, a stalled goal is the SAME Goal Record: paused via
//      Part 3B's own `pauseGoal()`, then immediately resumed via Part
//      3B's own `resumeGoal()` (`goal_resumed`). With Part 3D loaded,
//      its stuck plan is cancelled via Part 3D's own
//      `cancelExecution()`, and — because that settles asynchronously,
//      never inside the same call stack — this module waits for Part
//      3D's own `decisionengine_execution_cancelled` event before
//      recovering the goal as a fresh attempt via `attemptRecovery()`
//      (`goal_recovered`; see §3.3 of the companion validation report
//      for why re-dispatching the SAME Goal Record synchronously would
//      race Part 3D's own execution record). A successful goal-level
//      recovery (`attemptRecovery()`) also re-links any goal that
//      depended on the now-dead original onto the fresh retry via
//      `addGoalDependency()`/`removeGoalDependency()`, so a dependent
//      is never left waiting on a goal that will never complete.
//   9. Emits exactly four new lifecycle events — `goal_recovered`,
//      `goal_resumed`, `goal_skipped`, `goal_blocked` — none of which
//      collide with any existing `goalmgr_*` / `goal_task_*` /
//      `decisionengine_*` / `goalmgrlearn_*` name already in use
//      anywhere in this project (regression-tested).
//
// What this module explicitly does NOT do:
//   - It does not re-implement retry, routing, scheduling, workflow,
//     or orchestration logic. Every mutation goes through an existing,
//     already-validated public entry point on `AxiomGoalManager`
//     (`retryGoal`, `pauseGoal`, `resumeGoal`, `cancelGoal`,
//     `addGoalDependency`, `removeGoalDependency`, `scheduleGoal`,
//     `markGoalRunning`), `AxiomDecisionEngine` (`evaluateGoal`,
//     `admitGoal`), `AxiomDecisionEngineExecutionBridge`
//     (`dispatchGoal`, `cancelExecution`), or `AxiomGoalManagerLearning`
//     (`optimizeGoalScheduling`).
//   - It does not implement machine learning. Every decision is a
//     plain threshold/comparison over existing counters and
//     timestamps (idle time vs. a configured threshold, `retryCount`
//     vs. a configured ceiling, a reason string vs. a fixed
//     substring) — no model, no fitted parameter, no training step.
//   - It does not create, update, or destroy an `AxiomRuntimeContext`
//     record itself, and does not decompose goal text, match
//     capabilities, or dispatch a task directly. All of that stays
//     exactly `goal-manager.js`'s, `capability-router.js`'s, and
//     `task-planner.js`'s own.
//
// Dependencies — required vs. optional (same posture every Part in
// this lineage already documents):
//   REQUIRED: `os/core/orchestrator.js` (Event Bus), `os/core/
//   runtime-context.js` (real-time activity signal via a goal's own
//   `contextId`), `os/core/goal-manager.js` (Step 7 Parts 3A/3B).
//   OPTIONAL, soft-checked at each use site: `os/core/autonomous-
//   decision-engine.js` (Part 3C — richer eligibility/impossibility
//   reasoning and re-admission), `os/core/decision-engine-execution-
//   bridge.js` (Part 3D — real dispatch/cancel/re-dispatch and
//   `decisionengine_execution_exhausted`), `os/core/goal-manager-
//   learning.js` (Part 3E — learned reordering). A project with only
//   `goal-manager.js` underneath this module still gets stall
//   detection (via Runtime Context activity + Goal Record status),
//   blocked-goal detection (`isGoalBlocked()`), and recovery/skip
//   driven by `AxiomGoalManager`'s own status machine alone.
//
// Usage:
//   AxiomGoalManagerRecovery.monitorActiveGoals();
//   // -> [{ goalId, status, idleMs, stalled, blocked, impossible }, ...]
//   AxiomGoalManagerRecovery.setStallThresholdMs(15000);
//   AxiomGoalManagerRecovery.setMaxRecoveryAttempts(3);
//   AxiomOrchestrator.on('goal_recovered', ({ goalId, recoveredGoalId }) => {});
//   AxiomOrchestrator.on('goal_resumed', ({ goalId }) => {});
//   AxiomOrchestrator.on('goal_skipped', ({ goalId, reason, dependentsReleased }) => {});
//   AxiomOrchestrator.on('goal_blocked', ({ goalId, reason }) => {});
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;
  var GoalManager = global.AxiomGoalManager;
  var RuntimeContext = global.AxiomRuntimeContext;
  var DecisionEngine = global.AxiomDecisionEngine;
  var ExecutionBridge = global.AxiomDecisionEngineExecutionBridge;
  var Learning = global.AxiomGoalManagerLearning;

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[AxiomGoalManagerRecovery] ' + message, detail !== undefined ? detail : '');
      return;
    }
    try {
      // eslint-disable-next-line no-console
      console[method === 'error' ? 'error' : 'log']('[AxiomGoalManagerRecovery] ' + message, detail || '');
    } catch (e) { /* no console available — swallow */ }
  }

  if (!Orchestrator || typeof Orchestrator.emit !== 'function' || typeof Orchestrator.on !== 'function') {
    log('error', 'requires os/core/orchestrator.js (Event Bus) loaded first.');
    return;
  }
  if (!RuntimeContext || typeof RuntimeContext.getContext !== 'function') {
    log('error', 'requires os/core/runtime-context.js loaded first.');
    return;
  }
  if (!GoalManager || typeof GoalManager.getGoal !== 'function' || typeof GoalManager.isGoalBlocked !== 'function' ||
      typeof GoalManager.retryGoal !== 'function' || typeof GoalManager.pauseGoal !== 'function' ||
      typeof GoalManager.resumeGoal !== 'function' || typeof GoalManager.cancelGoal !== 'function' ||
      typeof GoalManager.addGoalDependency !== 'function' || typeof GoalManager.removeGoalDependency !== 'function') {
    log('error', 'requires os/core/goal-manager.js (Step 7 Parts 3A/3B) loaded first.');
    return;
  }

  var API_VERSION = '1.0.0';
  var GOAL_STATUS = GoalManager.GOAL_STATUS;

  // ------------------------------------------------------------
  // PART A — small local helpers, same style as the rest of the
  // Step 7 stack.
  // ------------------------------------------------------------
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function now() { return Date.now(); }

  function deepFreeze(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.getOwnPropertyNames(obj).forEach(function (key) {
      var val = obj[key];
      if (val && typeof val === 'object' && !Object.isFrozen(val)) deepFreeze(val);
    });
    return Object.freeze(obj);
  }

  function emit(event, payload) { Orchestrator.emit(event, payload); }

  var TERMINAL_GOAL_STATUSES = [GOAL_STATUS.COMPLETED, GOAL_STATUS.FAILED, GOAL_STATUS.CANCELLED];
  function isTerminal(status) { return TERMINAL_GOAL_STATUSES.indexOf(status) !== -1; }

  // The exact wording Part 3C's own `resolveGoalAgent()` uses for a
  // capability nothing registered ever advertises — reused verbatim
  // as the one signal this module treats as PERMANENT impossibility,
  // never re-derived from a second capability/agent scan.
  var IMPOSSIBLE_REASON_MARKER = 'no agent registered advertises capability';

  // ------------------------------------------------------------
  // PART B — Configuration knobs. Explicit, caller-set, sane
  // defaults — same "unbounded is opt-in, never a hidden default"
  // posture Part 3D's own `maxExecutionRetries` already uses.
  // ------------------------------------------------------------
  var DEFAULT_STALL_THRESHOLD_MS = 30000;
  var stallThresholdMs = DEFAULT_STALL_THRESHOLD_MS;

  function setStallThresholdMs(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) {
      throw new Error('[AxiomGoalManagerRecovery] setStallThresholdMs: expected a positive number, got ' + n + '.');
    }
    stallThresholdMs = n;
    return stallThresholdMs;
  }
  function getStallThresholdMs() { return stallThresholdMs; }

  var DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;
  var maxRecoveryAttempts = DEFAULT_MAX_RECOVERY_ATTEMPTS;

  function setMaxRecoveryAttempts(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || Math.floor(n) !== n) {
      throw new Error('[AxiomGoalManagerRecovery] setMaxRecoveryAttempts: expected a non-negative integer, got ' + n + '.');
    }
    maxRecoveryAttempts = n;
    return maxRecoveryAttempts;
  }
  function getMaxRecoveryAttempts() { return maxRecoveryAttempts; }

  function resolveMaxRecoveryAttempts(goal) {
    var meta = isPlainObject(goal.metadata) ? goal.metadata : {};
    if (typeof meta.maxRecoveryAttempts === 'number' && isFinite(meta.maxRecoveryAttempts) && meta.maxRecoveryAttempts >= 0) {
      return Math.floor(meta.maxRecoveryAttempts);
    }
    return maxRecoveryAttempts;
  }

  // ------------------------------------------------------------
  // PART C — Activity tracking. The ONLY new bookkeeping this module
  // keeps: the last time it observed activity for a goal, so idle
  // time can be computed. Fed by Part 3D's own progress/dispatch
  // events when that Part is loaded, and by Part 3A's own status
  // events either way — never a second, independently-incremented
  // task/step counter.
  // ------------------------------------------------------------
  var lastActivityAt = Object.create(null);
  var reportedBlocked = Object.create(null); // goalId -> true, de-dupes goal_blocked spam
  var recoveryLedger = Object.create(null);  // original goalId -> latest recovery goalId
  var stallCancelPending = Object.create(null); // goalId -> true, see PART I below
  var MAX_HISTORY = 500;
  var recoveryHistory = [];
  var metrics = { stalledDetected: 0, blockedDetected: 0, recovered: 0, resumed: 0, skipped: 0, exhausted: 0 };

  // Opt-out knob: a caller that wants `monitorActiveGoals()`/
  // `checkGoalHealth()` for diagnostics only, while driving
  // `attemptRecovery()`/`skipGoal()`/`resumeGoal()` entirely by hand,
  // can turn the two automatic event-driven triggers off. Detection
  // (stall/blocked/impossible reporting) is never gated by this flag
  // — only the two *automatic* recovery triggers are.
  var autoRecoveryEnabled = true;
  function setAutoRecoveryEnabled(v) { autoRecoveryEnabled = !!v; return autoRecoveryEnabled; }
  function isAutoRecoveryEnabled() { return autoRecoveryEnabled; }

  function pushHistory(entry) {
    recoveryHistory.unshift(deepFreeze(Object.assign({ at: now() }, entry)));
    if (recoveryHistory.length > MAX_HISTORY) recoveryHistory.length = MAX_HISTORY;
  }

  function touch(goalId) { lastActivityAt[goalId] = now(); }

  function onActivityEvent(payload) {
    if (payload && isNonEmptyString(payload.goalId)) touch(payload.goalId);
  }

  Orchestrator.on('goalmgr_running', onActivityEvent);
  Orchestrator.on('goalmgr_queued', onActivityEvent);
  Orchestrator.on('goalmgr_resumed', onActivityEvent);
  if (ExecutionBridge) {
    Orchestrator.on('decisionengine_execution_started', onActivityEvent);
    Orchestrator.on('decisionengine_execution_progress', onActivityEvent);
  }

  // ------------------------------------------------------------
  // PART D — Real-time health for a single goal. Reads three
  // existing sources of truth; invents no fourth one.
  // ------------------------------------------------------------
  function contextActivityAt(goal) {
    if (!goal.contextId) return null;
    try {
      var ctx = RuntimeContext.getContext(goal.contextId);
      return ctx ? ctx.updatedAt : null;
    } catch (err) {
      return null; // context already destroyed/finalized — not this module's concern
    }
  }

  function resolveActivityAt(goal) {
    var candidates = [goal.updatedAt || 0, lastActivityAt[goal.id] || 0];
    var ctxAt = contextActivityAt(goal);
    if (typeof ctxAt === 'number') candidates.push(ctxAt);
    return Math.max.apply(null, candidates);
  }

  function evaluate(goalId) {
    if (DecisionEngine && typeof DecisionEngine.evaluateGoal === 'function') {
      try { return DecisionEngine.evaluateGoal(goalId); } catch (err) { /* fall through to local */ }
    }
    return null;
  }

  function isImpossibleReason(reason) {
    return isNonEmptyString(reason) && reason.indexOf(IMPOSSIBLE_REASON_MARKER) !== -1;
  }

  function checkGoalHealth(goalId) {
    var goal = GoalManager.getGoal(goalId);
    if (!goal) throw new Error('[AxiomGoalManagerRecovery] checkGoalHealth: goal "' + goalId + '" does not exist.');

    var terminal = isTerminal(goal.status);
    var activityAt = resolveActivityAt(goal);
    var idleMs = terminal ? 0 : Math.max(0, now() - activityAt);
    var stalled = !terminal && goal.status === GOAL_STATUS.RUNNING && idleMs >= stallThresholdMs;

    var blocked = false;
    var impossible = false;
    var evaluation = evaluate(goalId);
    if (!terminal) {
      blocked = GoalManager.isGoalBlocked(goalId);
      if (evaluation) impossible = isImpossibleReason(evaluation.reason);
    }

    var execution = (ExecutionBridge && typeof ExecutionBridge.getExecution === 'function')
      ? ExecutionBridge.getExecution(goalId)
      : null;

    return deepFreeze({
      goalId: goal.id,
      status: goal.status,
      retryCount: goal.retryCount,
      idleMs: idleMs,
      stalled: stalled,
      blocked: blocked,
      impossible: impossible,
      evaluation: evaluation,
      execution: execution
    });
  }

  // ------------------------------------------------------------
  // PART E — Reordering. Reuses Part 3E's own learned order when
  // present; falls back to Part 3B's own scheduler otherwise. No
  // ordering logic of any kind lives in this file.
  // ------------------------------------------------------------
  function reorderRemainingGoals(filter) {
    if (Learning && typeof Learning.optimizeGoalScheduling === 'function') {
      return Learning.optimizeGoalScheduling(filter);
    }
    return GoalManager.runGoalScheduler(filter);
  }

  // ------------------------------------------------------------
  // PART F — Dependency repair. Only ever calls Part 3B's own
  // `addGoalDependency()`/`removeGoalDependency()`; never touches the
  // dependency graph's internal representation.
  // ------------------------------------------------------------
  function relinkDependents(originalGoalId, newGoalId) {
    var relinked = [];
    var dependents = GoalManager.getGoalDependents(originalGoalId);
    dependents.forEach(function (dependentId) {
      var dependent = GoalManager.getGoal(dependentId);
      if (!dependent || isTerminal(dependent.status)) return;
      try {
        GoalManager.addGoalDependency(dependentId, newGoalId);
        GoalManager.removeGoalDependency(dependentId, originalGoalId);
        relinked.push(dependentId);
      } catch (err) {
        log('error', 'relinkDependents: failed for dependent "' + dependentId + '"', { message: err && err.message });
      }
    });
    return relinked;
  }

  function releaseOptionalDependents(goalId) {
    var released = [];
    var dependents = GoalManager.getGoalDependents(goalId);
    dependents.forEach(function (dependentId) {
      var dependent = GoalManager.getGoal(dependentId);
      if (!dependent || isTerminal(dependent.status)) return;
      var meta = isPlainObject(dependent.metadata) ? dependent.metadata : {};
      var optional = Array.isArray(meta.optionalDependencies) ? meta.optionalDependencies : [];
      if (optional.indexOf(goalId) === -1) return; // hard dependency — stays blocked, by design
      try {
        GoalManager.removeGoalDependency(dependentId, goalId);
        released.push(dependentId);
      } catch (err) {
        log('error', 'releaseOptionalDependents: failed for dependent "' + dependentId + '"', { message: err && err.message });
      }
    });
    return released;
  }

  // ------------------------------------------------------------
  // PART G — Skip. A goal that has become permanently impossible (or
  // has exhausted every recovery attempt this module allows) is
  // cancelled via Part 3A's own `cancelGoal()` — never left to spin
  // forever. Dependents that opted the dependency out continue;
  // every other dependent is left exactly as blocked as
  // `isGoalBlocked()` already reports.
  // ------------------------------------------------------------
  function skipGoal(goalId, reason) {
    var goal = GoalManager.getGoal(goalId);
    if (!goal) return null;

    var released = releaseOptionalDependents(goalId);

    if (!isTerminal(goal.status)) {
      GoalManager.cancelGoal(goalId, reason || 'skipped by AxiomGoalManagerRecovery');
    }

    metrics.skipped += 1;
    pushHistory({ event: 'skipped', goalId: goalId, reason: reason || null, dependentsReleased: released });
    emit('goal_skipped', { goalId: goalId, reason: reason || null, dependentsReleased: released });

    reorderRemainingGoals();
    return { goalId: goalId, reason: reason || null, dependentsReleased: released };
  }

  // ------------------------------------------------------------
  // PART H — Recovery. Reuses Part 3A's own `retryGoal()` (existing
  // retry system) to mint a fresh attempt, decides recoverable-vs-
  // impossible by reusing Part 3C's own `evaluateGoal()` reason on
  // that fresh candidate (never a second capability/agent check), and
  // — on success — re-links any goal that depended on the dead
  // original onto the new attempt so a dependent is never blocked on
  // a goal that will never complete.
  // ------------------------------------------------------------
  // Accepts exactly the same two statuses Part 3A's own `retryGoal()`
  // already accepts (Failed or Cancelled) — never a wider set invented
  // here. A Cancelled goal only ever reaches this function via this
  // module's own stall-recovery cancellation (see `onExecutionCancelled`
  // above) or an explicit caller decision; an ordinary user-initiated
  // cancellation elsewhere in the project is never auto-retried,
  // because nothing in this file listens to a bare `goalmgr_cancelled`.
  var RECOVERABLE_STATUSES = [GOAL_STATUS.FAILED, GOAL_STATUS.CANCELLED];
  function attemptRecovery(originalGoalId, reason) {
    var original = GoalManager.getGoal(originalGoalId);
    if (!original || RECOVERABLE_STATUSES.indexOf(original.status) === -1) return null;

    var limit = resolveMaxRecoveryAttempts(original);
    if (original.retryCount >= limit) {
      metrics.exhausted += 1;
      pushHistory({ event: 'recovery_exhausted', goalId: originalGoalId, retryCount: original.retryCount, limit: limit });
      return skipGoal(originalGoalId, 'recovery attempts exhausted (' + original.retryCount + '/' + limit + ')');
    }

    var next;
    try {
      next = GoalManager.retryGoal(originalGoalId);
    } catch (err) {
      log('error', 'attemptRecovery: GoalManager.retryGoal failed', { goalId: originalGoalId, message: err && err.message });
      return null;
    }

    var evaluation = evaluate(next.id);
    if (evaluation && isImpossibleReason(evaluation.reason)) {
      // The retry candidate is just as permanently impossible as the
      // original — cancel the freshly-minted attempt too and skip the
      // whole lineage rather than mint an endless series of doomed
      // retries.
      GoalManager.cancelGoal(next.id, evaluation.reason);
      return skipGoal(originalGoalId, evaluation.reason);
    }

    recoveryLedger[originalGoalId] = next.id;
    var relinked = relinkDependents(originalGoalId, next.id);

    if (DecisionEngine && typeof DecisionEngine.admitGoal === 'function') {
      try { DecisionEngine.admitGoal(next.id); } catch (err) {
        log('error', 'attemptRecovery: DecisionEngine.admitGoal failed', { goalId: next.id, message: err && err.message });
      }
    } else {
      // No Decision Engine loaded — leave the fresh retry Queued/
      // Pending exactly like any other goal driven by hand; a caller
      // (or a future `runGoalScheduler()` call) picks it up normally.
      GoalManager.enqueueGoal(next.id);
    }

    metrics.recovered += 1;
    pushHistory({ event: 'recovered', goalId: originalGoalId, recoveredGoalId: next.id, reason: reason || null });
    emit('goal_recovered', { goalId: originalGoalId, recoveredGoalId: next.id, reason: reason || null, dependentsRelinked: relinked });

    reorderRemainingGoals();
    return { goalId: originalGoalId, recoveredGoalId: next.id, dependentsRelinked: relinked };
  }

  // Part 3D's own bound is spent — this Part decides whether to keep
  // trying (a fresh escalation, still bounded by
  // `getMaxRecoveryAttempts()`/`metadata.maxRecoveryAttempts`) or to
  // give up for good.
  function onExecutionExhausted(payload) {
    if (!autoRecoveryEnabled) return;
    if (!payload || !isNonEmptyString(payload.goalId)) return;
    attemptRecovery(payload.goalId, payload.reason || 'execution bridge retries exhausted');
  }
  if (ExecutionBridge) {
    Orchestrator.on('decisionengine_execution_exhausted', onExecutionExhausted);
  }

  // When no Execution Bridge is loaded, nothing else in this project
  // ever retries a goal driven purely by hand through
  // `AxiomGoalManager`'s own status machine — so this module reacts
  // directly to `goalmgr_failed` itself instead. (When the Bridge IS
  // loaded, it already owns first-line retries up to its own bound
  // and this module only steps in once it gives up, via
  // `decisionengine_execution_exhausted` above — reacting to
  // `goalmgr_failed` as well would mint a second, competing retry.)
  function onManualGoalFailed(payload) {
    if (!autoRecoveryEnabled) return;
    if (!payload || !isNonEmptyString(payload.goalId)) return;
    attemptRecovery(payload.goalId, payload.reason || 'goal failed');
  }
  if (!ExecutionBridge) {
    Orchestrator.on('goalmgr_failed', onManualGoalFailed);
  }

  // A stall recovery that cancelled an in-flight Bridge execution
  // settles asynchronously (the Task Planner's own plan promise, not
  // a synchronous call this module can wait on inline — see PART I
  // below for why). `decisionengine_execution_cancelled` is only ever
  // reacted to for a goalId THIS module itself just cancelled for
  // that exact reason — a cancellation any other caller requests is
  // left alone.
  function onExecutionCancelled(payload) {
    if (!payload || !isNonEmptyString(payload.goalId)) return;
    if (!stallCancelPending[payload.goalId]) return;
    delete stallCancelPending[payload.goalId];
    if (!autoRecoveryEnabled) return;
    attemptRecovery(payload.goalId, 'resumed after stall');
  }
  if (ExecutionBridge) {
    Orchestrator.on('decisionengine_execution_cancelled', onExecutionCancelled);
  }

  // ------------------------------------------------------------
  // PART I — Stall handling & resume. A stalled RUNNING goal is
  // paused (Part 3B's own `pauseGoal()`), its stuck in-flight plan
  // cancelled (Part 3D's own `cancelExecution()` when present), then
  // immediately resumed (Part 3B's own `resumeGoal()`) and
  // re-dispatched (Part 3D's own `dispatchGoal()` when present, else
  // re-admitted via Part 3C/3A directly).
  // ------------------------------------------------------------
  // A stalled goal is handled two different ways depending on whether
  // Part 3D is loaded, because Part 3D's own execution record only
  // ever settles through its plan promise's `.then()` — asynchronously,
  // never inside the same call stack as `cancelExecution()` — and
  // `dispatchGoal()` explicitly refuses to start a second plan for a
  // goalId whose existing execution record isn't terminal yet ("never
  // double-dispatch"). Re-admitting the SAME Goal Record synchronously
  // right after requesting cancellation would therefore either be
  // silently ignored (dispatch refused) or, worse, let the OLD plan's
  // eventual settlement overwrite the NEW execution record once it
  // does resolve. Neither this module nor Part 3D exposes a
  // synchronous "cancellation has fully settled" signal, so this
  // module never invents one — it waits for the real, existing
  // `decisionengine_execution_cancelled` event instead (see
  // `onExecutionCancelled` above), then recovers the goal exactly like
  // any other Cancelled/Failed goal via `attemptRecovery()` (a fresh
  // Goal Record, `goal_recovered`).
  //
  // Without Part 3D, there is no such asynchronous execution record to
  // race against — pausing and resuming the SAME Goal Record
  // synchronously (Part 3B's own `pauseGoal()`/`resumeGoal()`) is
  // exactly what "resume interrupted execution" means, and
  // `goal_resumed` is emitted for that case.
  function handleStalledGoal(goalId, idleMs) {
    metrics.stalledDetected += 1;
    pushHistory({ event: 'stalled', goalId: goalId, idleMs: idleMs });
    emit('goal_blocked', { goalId: goalId, reason: 'stalled', idleMs: idleMs });

    if (ExecutionBridge && typeof ExecutionBridge.cancelExecution === 'function') {
      stallCancelPending[goalId] = true;
      var cancelled = false;
      try { cancelled = ExecutionBridge.cancelExecution(goalId, 'stalled — recovering'); } catch (err) { /* best-effort */ }
      if (!cancelled) delete stallCancelPending[goalId]; // nothing in flight to cancel — leave the goal as-is
      return null; // outcome (goal_recovered) arrives asynchronously via onExecutionCancelled
    }

    var paused;
    try {
      paused = GoalManager.pauseGoal(goalId, 'stalled — no progress for ' + idleMs + 'ms');
    } catch (err) {
      log('error', 'handleStalledGoal: pauseGoal failed', { goalId: goalId, message: err && err.message });
      return null;
    }
    if (!paused.success) return null;

    return resumeGoalInternal(goalId);
  }

  function resumeGoalInternal(goalId) {
    var goal = GoalManager.getGoal(goalId);
    if (!goal) return null;

    if (goal.status === GOAL_STATUS.WAITING && goal.isPaused) {
      try {
        GoalManager.resumeGoal(goalId);
      } catch (err) {
        log('error', 'resumeGoalInternal: resumeGoal failed', { goalId: goalId, message: err && err.message });
        return null;
      }
    }

    touch(goalId);

    // Re-admission is deliberately routed through
    // `AxiomDecisionEngine.admitGoal()` ONLY — exactly the single path
    // `decision-engine-execution-bridge.js` itself documents as the
    // only thing that ever legitimately triggers a dispatch
    // (`decisionengine_admitted` -> Bridge's own listener ->
    // `dispatchGoal()`). Calling `ExecutionBridge.dispatchGoal()`
    // directly here would start real execution against a Goal Record
    // still sitting Queued, which is a state combination nothing else
    // in this project ever produces. Without Part 3C loaded, this
    // goal is left Queued for a caller to pick up via
    // `scheduleGoal()`/`markGoalRunning()`/`runGoalScheduler()` by
    // hand — the identical posture the rest of the stack already has
    // without Part 3C.
    if (DecisionEngine && typeof DecisionEngine.admitGoal === 'function') {
      try { DecisionEngine.admitGoal(goalId); } catch (err) { /* left Queued — a future cycle will pick it up */ }
    }

    metrics.resumed += 1;
    pushHistory({ event: 'resumed', goalId: goalId });
    emit('goal_resumed', { goalId: goalId });
    return { goalId: goalId };
  }

  function resumeGoal(goalId) { return resumeGoalInternal(goalId); }

  // ------------------------------------------------------------
  // PART J — Monitoring sweep. Caller-invoked (or, opt-in, timer-
  // driven via `startMonitoring()`) — never a hidden, always-on
  // interval a caller didn't ask for.
  // ------------------------------------------------------------
  function monitorActiveGoals() {
    var active = GoalManager.listGoals({}).filter(function (g) { return !isTerminal(g.status); });
    var results = [];

    active.forEach(function (g) {
      var health = checkGoalHealth(g.id);
      results.push(health);

      if (health.stalled) {
        handleStalledGoal(g.id, health.idleMs);
        return;
      }

      if (health.blocked || health.impossible) {
        if (health.impossible) {
          skipGoal(g.id, (health.evaluation && health.evaluation.reason) || 'goal is permanently impossible');
        } else if (!reportedBlocked[g.id]) {
          reportedBlocked[g.id] = true;
          metrics.blockedDetected += 1;
          pushHistory({ event: 'blocked', goalId: g.id });
          emit('goal_blocked', { goalId: g.id, reason: 'unresolved dependencies' });
        }
      } else {
        delete reportedBlocked[g.id];
      }
    });

    return results;
  }

  var monitorTimer = null;
  function startMonitoring(intervalMs) {
    stopMonitoring();
    var interval = (typeof intervalMs === 'number' && intervalMs > 0) ? intervalMs : stallThresholdMs;
    monitorTimer = global.setInterval(function () {
      try { monitorActiveGoals(); } catch (err) { log('error', 'startMonitoring: sweep failed', { message: err && err.message }); }
    }, interval);
    return true;
  }
  function stopMonitoring() {
    if (monitorTimer !== null) {
      global.clearInterval(monitorTimer);
      monitorTimer = null;
      return true;
    }
    return false;
  }
  function isMonitoring() { return monitorTimer !== null; }

  // ------------------------------------------------------------
  // PART K — Read APIs
  // ------------------------------------------------------------
  function getRecoveryHistory(limit) {
    var n = (typeof limit === 'number' && limit > 0) ? limit : recoveryHistory.length;
    return recoveryHistory.slice(0, n);
  }

  function getRecoveryMetrics() {
    return deepFreeze({
      stalledDetected: metrics.stalledDetected,
      blockedDetected: metrics.blockedDetected,
      recovered: metrics.recovered,
      resumed: metrics.resumed,
      skipped: metrics.skipped,
      exhausted: metrics.exhausted
    });
  }

  function getRecoveryFor(originalGoalId) {
    var recoveredGoalId = recoveryLedger[originalGoalId];
    return recoveredGoalId ? { goalId: originalGoalId, recoveredGoalId: recoveredGoalId } : null;
  }

  // ------------------------------------------------------------
  // Standalone global only — same posture every other Step 7 Part
  // already documents, and for the identical reason: this module is
  // a *consumer* of `AxiomOrchestrator`, `AxiomGoalManager`,
  // `AxiomRuntimeContext`, and optionally `AxiomDecisionEngine` /
  // `AxiomDecisionEngineExecutionBridge` / `AxiomGoalManagerLearning`,
  // so putting its logic inside any one of them would make that
  // module aware of the others in a way none of them are today.
  // `orchestrator.js`, `runtime-context.js`, `goal-manager.js`,
  // `autonomous-decision-engine.js`, `decision-engine-execution-
  // bridge.js`, and `goal-manager-learning.js` are none of them
  // edited by this file.
  // ------------------------------------------------------------
  var AxiomGoalManagerRecovery = {
    API_VERSION: API_VERSION,

    setStallThresholdMs: setStallThresholdMs,
    getStallThresholdMs: getStallThresholdMs,
    setMaxRecoveryAttempts: setMaxRecoveryAttempts,
    getMaxRecoveryAttempts: getMaxRecoveryAttempts,
    setAutoRecoveryEnabled: setAutoRecoveryEnabled,
    isAutoRecoveryEnabled: isAutoRecoveryEnabled,

    checkGoalHealth: checkGoalHealth,
    monitorActiveGoals: monitorActiveGoals,
    startMonitoring: startMonitoring,
    stopMonitoring: stopMonitoring,
    isMonitoring: isMonitoring,

    attemptRecovery: attemptRecovery,
    skipGoal: skipGoal,
    resumeGoal: resumeGoal,
    reorderRemainingGoals: reorderRemainingGoals,

    getRecoveryFor: getRecoveryFor,
    getRecoveryHistory: getRecoveryHistory,
    getRecoveryMetrics: getRecoveryMetrics
  };

  global.AxiomGoalManagerRecovery = AxiomGoalManagerRecovery;
})(typeof window !== 'undefined' ? window : this);
