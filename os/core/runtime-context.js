// ============================================================
// AXIOM — Block 2 / Step 6 / Part 5: Runtime Context Engine
// ------------------------------------------------------------
// Parts 1-4 gave the Orchestrator a place for agents to register
// (Agent Registry / Integration), a routing/dispatch pipeline
// (Capability Router), and a multi-stage collaboration model
// (Workflow Planner). None of those own a durable, queryable notion
// of "what is the current in-flight state of this request/workflow
// right now" — Workflow Planner keeps its own private wf.context
// object per workflow, Capability Router keeps none at all, and
// nothing ties the two together.
//
// This module is that missing piece: a Runtime Context Engine that
// tracks *temporary, in-memory execution state* while AXIOM is
// running — one isolated context per request/workflow, with a real
// lifecycle, parent/child relationships for sub-workflows, and
// automatic cleanup so nothing lingers past the work it belonged to.
//
// This is explicitly NOT:
//   - Permanent Memory (os/core/memory-engine.js, memory-manager.js).
//     Nothing here is persisted to storage and nothing here is ever
//     read by the Memory subsystem. Runtime contexts vanish; Memory
//     is forever.
//   - Browser History. No navigation state, no tabs, no URLs.
//   - Brain storage. No knowledge graph, no long-term reasoning state.
//
// It does not touch, re-implement, or import from Browser, Brain,
// Memory, Automation, Analytics, or any UI/.html file, and it does
// not talk to OpenRouter or any AI provider. It is purely additive to
// the Orchestrator layer, exactly like capability-router.js and
// workflow-planner.js were: it installs a small set of extra methods
// onto the existing AxiomOrchestrator singleton (if present) and
// otherwise stands alone as window.AxiomRuntimeContext. Workflow
// Planner and Capability Router are not modified by this file — they
// are free to start calling these APIs in a future part, but nothing
// here reaches into their internals.
//
// Usage:
//   const ctx = AxiomRuntimeContext.createContext({
//     workflowId: 'wf_123', requestId: 'req_456', ownerAgent: 'executive',
//     metadata: { source: 'chat' }, state: { step: 0 }
//   });
//   AxiomRuntimeContext.updateContext(ctx.contextId, { state: { step: 1 } });
//   AxiomRuntimeContext.markRunning(ctx.contextId);
//   ...
//   AxiomRuntimeContext.completeContext(ctx.contextId, { result: 'ok' });
//   // context is auto-archived immediately, and fully destroyed once
//   // its archive TTL elapses (or immediately via destroyContext()).
//
//   const child = AxiomRuntimeContext.createChildContext(ctx.contextId, {
//     ownerAgent: 'research'
//   });
//
//   AxiomOrchestrator.on('context_completed', ({ contextId }) => { ... });
// ============================================================
(function (global) {
  'use strict';

  var API_VERSION = '1.0.0';

  function log(method, message, detail) {
    if (global.console && typeof global.console[method] === 'function') {
      global.console[method]('[AxiomRuntimeContext] ' + message, detail || '');
    }
  }

  function reportError(where, err, detail) {
    log('error', where + ': ' + ((err && err.message) ? err.message : String(err)), detail);
  }

  // ------------------------------------------------------------
  // Small shared helpers (same conventions as workflow-planner.js /
  // capability-router.js: ES5, no external deps, defensive parsing).
  // ------------------------------------------------------------
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function now() { return Date.now(); }

  var idCounter = 0;
  function makeId(prefix) {
    idCounter += 1;
    return prefix + '_' + now().toString(36) + '_' + idCounter.toString(36);
  }

  // FIX 5 (Clone Strategy): Runtime Context officially supports only
  // JSON-safe payloads (plain objects/arrays/strings/numbers/booleans/
  // null) — see RUNTIME_CONTEXT.md, "Supported payloads". The old
  // safeClone() tried JSON.parse(JSON.stringify(value)) and, on
  // failure, silently fell back to a *shallow* copy. That fallback
  // was worse than doing nothing: JSON.stringify() doesn't actually
  // throw for most unsupported values (functions, undefined array
  // slots) — it just silently drops or nulls them — so state could
  // already be quietly corrupted before the catch block ever ran, and
  // a shallow copy on genuinely circular data still hands back live,
  // mutable references that snapshot()'s deepFreeze() cannot lock,
  // breaking the "read-only snapshot" guarantee. safeClone() now
  // validates the full shape up front and fails safely (throws a
  // descriptive error) instead of ever returning a corrupted or
  // partially-shared clone.
  function jsonSafeError(path, reason) {
    var err = new Error(
      'Runtime Context payload at "' + path + '" is not JSON-safe (' + reason + '). ' +
      'Runtime Context only supports plain objects/arrays/strings/numbers/booleans/null — ' +
      'see RUNTIME_CONTEXT.md "Supported payloads".'
    );
    err.nonSerializable = true;
    err.path = path;
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
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object') return value;
    assertJsonSafe(value, '$', []);
    // Validation above already guarantees this can't throw or drop
    // data, but keep the try/catch as a last-resort safety net rather
    // than ever handing back an unfrozen, partially-cloned object.
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      throw jsonSafeError('$', (err && err.message) || String(err));
    }
  }

  function deepFreeze(obj) {
    if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
    Object.getOwnPropertyNames(obj).forEach(function (key) {
      var val = obj[key];
      if (val && typeof val === 'object') deepFreeze(val);
    });
    return Object.freeze(obj);
  }

  function mergeInto(target, patch) {
    if (!isPlainObject(patch)) return target;
    Object.keys(patch).forEach(function (k) { target[k] = safeClone(patch[k]); });
    return target;
  }

  // ------------------------------------------------------------
  // PART C — Context Lifecycle
  // ------------------------------------------------------------
  var STATUS = {
    CREATED: 'created',
    READY: 'ready',
    RUNNING: 'running',
    WAITING: 'waiting',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    DESTROYED: 'destroyed'
  };

  var TERMINAL_STATUSES = [STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED];

  // Adjacency list of legal forward transitions. Anything not listed
  // here is illegal and transitionContext() will refuse it (fail
  // safely: return { success:false }, never throw into caller code).
  var TRANSITIONS = {};
  TRANSITIONS[STATUS.CREATED] = [STATUS.READY, STATUS.CANCELLED, STATUS.FAILED];
  TRANSITIONS[STATUS.READY] = [STATUS.RUNNING, STATUS.CANCELLED, STATUS.FAILED];
  TRANSITIONS[STATUS.RUNNING] = [STATUS.WAITING, STATUS.PAUSED, STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED];
  TRANSITIONS[STATUS.WAITING] = [STATUS.RUNNING, STATUS.FAILED, STATUS.CANCELLED];
  TRANSITIONS[STATUS.PAUSED] = [STATUS.RUNNING, STATUS.CANCELLED, STATUS.FAILED];
  TRANSITIONS[STATUS.COMPLETED] = [STATUS.DESTROYED];
  TRANSITIONS[STATUS.FAILED] = [STATUS.DESTROYED];
  TRANSITIONS[STATUS.CANCELLED] = [STATUS.DESTROYED];
  TRANSITIONS[STATUS.DESTROYED] = []; // terminal, no way out

  function canTransition(from, to) {
    var allowed = TRANSITIONS[from];
    return !!allowed && allowed.indexOf(to) !== -1;
  }

  // ------------------------------------------------------------
  // Storage
  // ------------------------------------------------------------
  // Three tiers, matching the lifecycle:
  //   activeById   — CREATED..PAUSED (live, mutable, in-flight work)
  //   archivedById — just reached a terminal status; still fully
  //                  readable/recoverable until its TTL expires
  //   history      — bounded append-only log of every context that
  //                  has ever existed (final snapshot only), survives
  //                  past DESTROYED for audit/monitoring purposes
  var activeById = Object.create(null);
  var archivedById = Object.create(null);
  var history = [];
  var HISTORY_LIMIT = 1000;

  // parentContextId -> [childContextId, ...]
  var childIndex = Object.create(null);
  // contextId -> timeout handle (for createContext({ timeoutMs }))
  var timeoutHandles = Object.create(null);

  var metrics = {
    createdCount: 0,
    destroyedCount: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    peakConcurrent: 0
  };

  var DEFAULT_ARCHIVE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  var autoCleanupHandle = null;
  var AUTO_CLEANUP_INTERVAL_MS = 30 * 1000;

  function activeCount() { return Object.keys(activeById).length; }

  function trackPeak() {
    var c = activeCount();
    if (c > metrics.peakConcurrent) metrics.peakConcurrent = c;
  }

  function requireActive(contextId) {
    var ctx = activeById[contextId];
    if (!ctx) throw new Error('Runtime context "' + contextId + '" does not exist or is not active.');
    return ctx;
  }

  function findAnywhere(contextId) {
    return activeById[contextId] || archivedById[contextId] || null;
  }

  function pushHistory(ctx, event) {
    history.push({
      contextId: ctx.contextId,
      workflowId: ctx.workflowId,
      requestId: ctx.requestId,
      ownerAgent: ctx.ownerAgent,
      status: ctx.status,
      event: event,
      at: now()
    });
    if (history.length > HISTORY_LIMIT) history.shift();
  }

  function emit(event, payload) {
    var Orchestrator = global.AxiomOrchestrator;
    if (Orchestrator && typeof Orchestrator.emit === 'function') {
      try { Orchestrator.emit(event, payload); } catch (err) { reportError('emit:' + event, err); }
    }
  }

  // ------------------------------------------------------------
  // PART D — Immutable snapshots. This is the ONLY shape any caller
  // outside this file ever sees; the live mutable objects in
  // activeById/archivedById never leak out directly.
  // ------------------------------------------------------------
  function snapshot(ctx) {
    if (!ctx) return null;
    return deepFreeze({
      contextId: ctx.contextId,
      workflowId: ctx.workflowId,
      requestId: ctx.requestId,
      ownerAgent: ctx.ownerAgent,
      parentContextId: ctx.parentContextId,
      childContextIds: (childIndex[ctx.contextId] || []).slice(),
      createdAt: ctx.createdAt,
      updatedAt: ctx.updatedAt,
      archivedAt: ctx.archivedAt || null,
      expiresAt: ctx.expiresAt || null,
      status: ctx.status,
      metadata: safeClone(ctx.metadata),
      state: safeClone(ctx.state),
      temporaryData: safeClone(ctx.temporaryData)
    });
  }

  // ------------------------------------------------------------
  // PART A — Core context object lifecycle
  // ------------------------------------------------------------
  function createContext(options) {
    options = isPlainObject(options) ? options : {};

    if (options.parentContextId && !findAnywhere(options.parentContextId)) {
      throw new Error('createContext: parentContextId "' + options.parentContextId + '" does not exist.');
    }

    var contextId = makeId('ctx');
    var ctx = {
      contextId: contextId,
      workflowId: isNonEmptyString(options.workflowId) ? options.workflowId : null,
      requestId: isNonEmptyString(options.requestId) ? options.requestId : null,
      ownerAgent: isNonEmptyString(options.ownerAgent) ? options.ownerAgent : null,
      parentContextId: isNonEmptyString(options.parentContextId) ? options.parentContextId : null,
      createdAt: now(),
      updatedAt: now(),
      archivedAt: null,
      expiresAt: null,
      status: STATUS.CREATED,
      metadata: isPlainObject(options.metadata) ? safeClone(options.metadata) : {},
      state: isPlainObject(options.state) ? safeClone(options.state) : {},
      temporaryData: isPlainObject(options.temporaryData) ? safeClone(options.temporaryData) : {},
      archiveTtlMs: (typeof options.archiveTtlMs === 'number' && options.archiveTtlMs >= 0)
        ? options.archiveTtlMs : DEFAULT_ARCHIVE_TTL_MS
    };

    activeById[contextId] = ctx;
    if (ctx.parentContextId) {
      var siblings = childIndex[ctx.parentContextId] || (childIndex[ctx.parentContextId] = []);
      siblings.push(contextId);
    }

    metrics.createdCount += 1;
    trackPeak();
    pushHistory(ctx, 'created');

    if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0 && typeof global.setTimeout === 'function') {
      timeoutHandles[contextId] = global.setTimeout(function () { expireContext(contextId); }, options.timeoutMs);
    }

    emit('context_created', { contextId: contextId, workflowId: ctx.workflowId, requestId: ctx.requestId });
    return snapshot(ctx);
  }

  function getContext(contextId) {
    var ctx = findAnywhere(contextId);
    return ctx ? snapshot(ctx) : null;
  }

  function getContextStatus(contextId) {
    var ctx = findAnywhere(contextId);
    if (!ctx) return null;
    return { contextId: ctx.contextId, status: ctx.status, updatedAt: ctx.updatedAt };
  }

  function updateContext(contextId, patch) {
    var ctx = requireActive(contextId);
    patch = isPlainObject(patch) ? patch : {};

    if (isPlainObject(patch.state)) ctx.state = mergeInto(isPlainObject(ctx.state) ? ctx.state : {}, patch.state);
    if (isPlainObject(patch.metadata)) ctx.metadata = mergeInto(isPlainObject(ctx.metadata) ? ctx.metadata : {}, patch.metadata);
    if (isPlainObject(patch.temporaryData)) ctx.temporaryData = mergeInto(isPlainObject(ctx.temporaryData) ? ctx.temporaryData : {}, patch.temporaryData);

    ctx.updatedAt = now();

    if (isNonEmptyString(patch.status) && patch.status !== ctx.status) {
      // Route through the validated transition path rather than
      // setting status directly, so an updateContext() caller can't
      // silently bypass lifecycle rules.
      var result = transitionContext(contextId, patch.status, patch.reason);
      if (!result.success) {
        log('warn', 'updateContext: ignored illegal status transition', result);
      }
      return getContext(contextId);
    }

    emit('context_updated', { contextId: contextId });
    return snapshot(ctx);
  }

  function clearContext(contextId) {
    var ctx = requireActive(contextId);
    ctx.state = {};
    ctx.temporaryData = {};
    ctx.updatedAt = now();
    emit('context_cleared', { contextId: contextId });
    return snapshot(ctx);
  }

  function cloneContext(contextId, overrides) {
    var source = findAnywhere(contextId);
    if (!source) throw new Error('cloneContext: "' + contextId + '" does not exist.');
    overrides = isPlainObject(overrides) ? overrides : {};

    return createContext({
      workflowId: overrides.workflowId || source.workflowId,
      requestId: overrides.requestId || source.requestId,
      ownerAgent: overrides.ownerAgent || source.ownerAgent,
      parentContextId: Object.prototype.hasOwnProperty.call(overrides, 'parentContextId')
        ? overrides.parentContextId : source.parentContextId,
      metadata: mergeInto(safeClone(source.metadata) || {}, { clonedFrom: source.contextId }),
      state: safeClone(source.state),
      temporaryData: overrides.carryTemporaryData === false ? {} : safeClone(source.temporaryData),
      archiveTtlMs: source.archiveTtlMs
    });
  }

  // FIX 1 (Child Context Cleanup): destroyContext() used to leave two
  // kinds of stale childIndex data behind forever:
  //   1. the destroyed context's own id stayed listed in its parent's
  //      childIndex[parentContextId] array indefinitely.
  //   2. childIndex[contextId] (that context's own list of children)
  //      stayed allocated as an orphaned key even though the context
  //      itself was fully gone from activeById/archivedById.
  // Both are unbounded-growth leaks under repeated create/destroy
  // cycles. This helper removes both in one place so every exit path
  // out of destroyContext() stays consistent.
  function pruneChildIndex(contextId, parentContextId) {
    if (parentContextId && childIndex[parentContextId]) {
      var siblings = childIndex[parentContextId].filter(function (id) { return id !== contextId; });
      if (siblings.length) {
        childIndex[parentContextId] = siblings;
      } else {
        delete childIndex[parentContextId];
      }
    }
    if (childIndex[contextId]) delete childIndex[contextId];
  }

  function destroyContext(contextId, reason) {
    var ctx = findAnywhere(contextId);
    if (!ctx) return false;
    if (ctx.status === STATUS.DESTROYED) return false;

    // Destroy is allowed to force-terminate a still-live context
    // (mirrors cancelWorkflow's forceful posture) — but it does so
    // through the same validated path, never a raw field write.
    if (activeById[contextId] && TERMINAL_STATUSES.indexOf(ctx.status) === -1) {
      transitionContext(contextId, STATUS.CANCELLED, reason || 'destroyed while active');
      ctx = findAnywhere(contextId); // may now live in archivedById
    }

    if (timeoutHandles[contextId] && typeof global.clearTimeout === 'function') {
      global.clearTimeout(timeoutHandles[contextId]);
    }
    delete timeoutHandles[contextId];

    delete activeById[contextId];
    delete archivedById[contextId];
    pruneChildIndex(contextId, ctx.parentContextId);

    ctx.status = STATUS.DESTROYED;
    ctx.destroyedAt = now();
    ctx.updatedAt = ctx.destroyedAt;
    pushHistory(ctx, 'destroyed:' + (reason || 'manual'));

    metrics.destroyedCount += 1;
    emit('context_destroyed', { contextId: contextId, reason: reason || null });
    return true;
  }

  // ------------------------------------------------------------
  // PART B — Parent/child relationships
  // ------------------------------------------------------------
  function createChildContext(parentContextId, options) {
    options = isPlainObject(options) ? options : {};
    // A child is a brand-new, independently-isolated context — it
    // does NOT inherit parent state/temporaryData by reference or by
    // value. It only inherits identity fields (workflowId) unless the
    // caller overrides them, so a child of a workflow stays traceable
    // to that workflow without ever sharing mutable data.
    var parent = findAnywhere(parentContextId);
    if (!parent) throw new Error('createChildContext: parent "' + parentContextId + '" does not exist.');

    return createContext({
      workflowId: Object.prototype.hasOwnProperty.call(options, 'workflowId') ? options.workflowId : parent.workflowId,
      requestId: options.requestId || parent.requestId,
      ownerAgent: options.ownerAgent || null,
      parentContextId: parentContextId,
      metadata: options.metadata,
      state: options.state,
      temporaryData: options.temporaryData,
      timeoutMs: options.timeoutMs,
      archiveTtlMs: options.archiveTtlMs
    });
  }

  function getChildContexts(parentContextId) {
    return (childIndex[parentContextId] || [])
      .map(function (id) { return getContext(id); })
      .filter(Boolean);
  }

  function getParentContext(contextId) {
    var ctx = findAnywhere(contextId);
    if (!ctx || !ctx.parentContextId) return null;
    return getContext(ctx.parentContextId);
  }

  function getContextsByWorkflow(workflowId) {
    return listContexts({ workflowId: workflowId });
  }

  // ------------------------------------------------------------
  // PART C (cont.) — Lifecycle transitions
  // ------------------------------------------------------------
  function transitionContext(contextId, toStatus, reason) {
    var ctx = activeById[contextId];
    if (!ctx) {
      return { success: false, error: 'not_active', contextId: contextId };
    }
    if (!TRANSITIONS.hasOwnProperty(toStatus)) {
      return { success: false, error: 'unknown_status', contextId: contextId, to: toStatus };
    }
    if (ctx.status === toStatus) {
      return { success: true, contextId: contextId, status: toStatus, noop: true };
    }
    if (!canTransition(ctx.status, toStatus)) {
      log('warn', 'illegal transition ' + ctx.status + ' -> ' + toStatus + ' for ' + contextId);
      return { success: false, error: 'illegal_transition', contextId: contextId, from: ctx.status, to: toStatus };
    }

    var from = ctx.status;
    ctx.status = toStatus;
    ctx.updatedAt = now();
    if (reason !== undefined) ctx.metadata.lastTransitionReason = reason;

    pushHistory(ctx, 'transition:' + from + '->' + toStatus);
    emit('context_status_changed', { contextId: contextId, from: from, to: toStatus, reason: reason || null });

    if (TERMINAL_STATUSES.indexOf(toStatus) !== -1) {
      if (toStatus === STATUS.COMPLETED) metrics.completedCount += 1;
      if (toStatus === STATUS.FAILED) metrics.failedCount += 1;
      if (toStatus === STATUS.CANCELLED) metrics.cancelledCount += 1;
      emit('context_' + toStatus, { contextId: contextId, reason: reason || null });
      // "must automatically clean itself when tasks complete" — move
      // straight to archive the instant a terminal status is reached.
      // Cleanup here NEVER touches other contexts, so it cannot
      // affect any workflow/context that is still active.
      autoArchive(contextId);
    }

    return { success: true, contextId: contextId, status: toStatus, from: from };
  }

  function markReady(contextId) { return transitionContext(contextId, STATUS.READY); }
  function markRunning(contextId) { return transitionContext(contextId, STATUS.RUNNING); }
  function markWaiting(contextId, reason) { return transitionContext(contextId, STATUS.WAITING, reason); }
  function pauseContext(contextId, reason) { return transitionContext(contextId, STATUS.PAUSED, reason); }
  function resumeContext(contextId) { return transitionContext(contextId, STATUS.RUNNING); }
  function completeContext(contextId, result) {
    var ctx = activeById[contextId];
    if (ctx && isPlainObject(result)) ctx.temporaryData = mergeInto(ctx.temporaryData, { result: result });
    return transitionContext(contextId, STATUS.COMPLETED);
  }
  function failContext(contextId, reason) { return transitionContext(contextId, STATUS.FAILED, reason); }
  function cancelContext(contextId, reason) { return transitionContext(contextId, STATUS.CANCELLED, reason); }

  function expireContext(contextId) {
    delete timeoutHandles[contextId];
    var ctx = activeById[contextId];
    if (!ctx) return; // already terminal/archived/destroyed — nothing to do
    failContext(contextId, 'timeout');
  }

  // ------------------------------------------------------------
  // PART F — Cleanup & Recovery
  // ------------------------------------------------------------
  function autoArchive(contextId) {
    var ctx = activeById[contextId];
    if (!ctx) return null;
    delete activeById[contextId];
    ctx.archivedAt = now();
    ctx.expiresAt = ctx.archivedAt + ctx.archiveTtlMs;
    archivedById[contextId] = ctx;
    pushHistory(ctx, 'archived');
    emit('context_archived', { contextId: contextId, expiresAt: ctx.expiresAt });
    return snapshot(ctx);
  }

  function archiveContext(contextId) {
    // Manual archive entry point — same effect as autoArchive but
    // callable directly (e.g. to archive a context that's still in
    // a non-terminal status, such as WAITING, without destroying it).
    var ctx = activeById[contextId];
    if (!ctx) return null;
    if (TERMINAL_STATUSES.indexOf(ctx.status) === -1) {
      // Force through CANCELLED first so the lifecycle stays valid —
      // an archived-but-not-terminal context would be an illegal
      // state to recover back into.
      transitionContext(contextId, STATUS.CANCELLED, 'archived manually');
      return getContext(contextId);
    }
    return autoArchive(contextId);
  }

  function recoverContext(contextId) {
    var ctx = archivedById[contextId];
    if (!ctx) return null;
    if (ctx.expiresAt && now() > ctx.expiresAt) return null; // too late, treat as gone

    delete archivedById[contextId];
    ctx.status = STATUS.READY;
    ctx.archivedAt = null;
    ctx.expiresAt = null;
    ctx.updatedAt = now();
    activeById[contextId] = ctx;
    trackPeak();
    pushHistory(ctx, 'recovered');
    emit('context_recovered', { contextId: contextId });
    return snapshot(ctx);
  }

  function cleanupExpiredContexts() {
    var t = now();
    var removed = [];
    Object.keys(archivedById).forEach(function (contextId) {
      var ctx = archivedById[contextId];
      if (ctx.expiresAt && t >= ctx.expiresAt) {
        destroyContext(contextId, 'expired');
        removed.push(contextId);
      }
    });
    return removed;
  }

  function startAutoCleanup(intervalMs) {
    // stopAutoCleanup() first guarantees this is idempotent — calling
    // startAutoCleanup() again (e.g. to reconfigure the interval)
    // never results in two timers running concurrently.
    stopAutoCleanup();
    if (typeof global.setInterval !== 'function') return false;
    autoCleanupHandle = global.setInterval(
      cleanupExpiredContexts,
      typeof intervalMs === 'number' && intervalMs > 0 ? intervalMs : AUTO_CLEANUP_INTERVAL_MS
    );
    // Don't hold the process open in a Node/test environment for a
    // background sweep timer that exists purely for hygiene.
    if (autoCleanupHandle && typeof autoCleanupHandle.unref === 'function') autoCleanupHandle.unref();
    return true;
  }

  function stopAutoCleanup() {
    if (autoCleanupHandle && typeof global.clearInterval === 'function') {
      global.clearInterval(autoCleanupHandle);
    }
    autoCleanupHandle = null;
  }

  function isAutoCleanupRunning() {
    return autoCleanupHandle !== null;
  }

  // ------------------------------------------------------------
  // PART E — Monitoring APIs
  // ------------------------------------------------------------
  function listContexts(filter) {
    filter = isPlainObject(filter) ? filter : {};
    var all = Object.keys(activeById).map(function (id) { return activeById[id]; })
      .concat(Object.keys(archivedById).map(function (id) { return archivedById[id]; }));

    return all.filter(function (ctx) {
      if (filter.status && ctx.status !== filter.status) return false;
      if (filter.workflowId && ctx.workflowId !== filter.workflowId) return false;
      if (filter.requestId && ctx.requestId !== filter.requestId) return false;
      if (filter.ownerAgent && ctx.ownerAgent !== filter.ownerAgent) return false;
      return true;
    }).map(snapshot);
  }

  function getActiveContexts() {
    return Object.keys(activeById).map(function (id) { return snapshot(activeById[id]); });
  }

  function getContextMetrics() {
    return {
      createdCount: metrics.createdCount,
      destroyedCount: metrics.destroyedCount,
      completedCount: metrics.completedCount,
      failedCount: metrics.failedCount,
      cancelledCount: metrics.cancelledCount,
      peakConcurrent: metrics.peakConcurrent,
      active: activeCount(),
      archived: Object.keys(archivedById).length
    };
  }

  function getContextHistory(filter, limit) {
    filter = isPlainObject(filter) ? filter : {};
    var out = history.filter(function (entry) {
      if (filter.contextId && entry.contextId !== filter.contextId) return false;
      if (filter.workflowId && entry.workflowId !== filter.workflowId) return false;
      return true;
    });
    // Most recent first.
    out = out.slice().reverse();
    if (typeof limit === 'number' && limit >= 0) out = out.slice(0, limit);
    return out.map(function (e) { return Object.assign({}, e); });
  }

  // ------------------------------------------------------------
  // Install a thin, additive surface onto AxiomOrchestrator — same
  // idempotent convention as installWorkflowApi() /
  // installRoutingApi(). Optional: this file works standalone as
  // window.AxiomRuntimeContext even if Orchestrator isn't loaded, but
  // when it IS present we also mirror the API onto it so Workflow
  // Planner / Capability Router (or anything else holding a reference
  // to AxiomOrchestrator) can reach it without a second global.
  // ------------------------------------------------------------
  function installRuntimeContextApi() {
    var Orchestrator = global.AxiomOrchestrator;
    if (!Orchestrator || typeof Orchestrator.createContext === 'function') return; // absent, or already installed

    Orchestrator.createContext = createContext;
    Orchestrator.destroyContext = destroyContext;
    Orchestrator.getContext = getContext;
    Orchestrator.updateContext = updateContext;
    Orchestrator.cloneContext = cloneContext;
    Orchestrator.clearContext = clearContext;

    Orchestrator.createChildContext = createChildContext;
    Orchestrator.getChildContexts = getChildContexts;
    Orchestrator.getParentContext = getParentContext;
    Orchestrator.getContextsByWorkflow = getContextsByWorkflow;

    Orchestrator.listContexts = listContexts;
    Orchestrator.getContextMetrics = getContextMetrics;
    Orchestrator.getActiveContexts = getActiveContexts;
    Orchestrator.getContextHistory = getContextHistory;
    Orchestrator.getContextStatus = getContextStatus;

    Orchestrator.recoverContext = recoverContext;
    Orchestrator.archiveContext = archiveContext;
    Orchestrator.cleanupExpiredContexts = cleanupExpiredContexts;
    Orchestrator.startAutoCleanup = startAutoCleanup;
    Orchestrator.stopAutoCleanup = stopAutoCleanup;
    Orchestrator.isAutoCleanupRunning = isAutoCleanupRunning;

    Orchestrator.CONTEXT_STATUS = STATUS;
  }

  installRuntimeContextApi();

  // FIX 2 (Automatic Cleanup): cleanupExpiredContexts() existed but
  // nothing ever called startAutoCleanup(), so archived contexts only
  // ever got swept out by a caller remembering to do it manually. The
  // engine now starts its own sweep as soon as it loads. The interval
  // is configurable at load time via
  // global.AXIOM_RUNTIME_CONTEXT_CLEANUP_INTERVAL_MS (falls back to
  // AUTO_CLEANUP_INTERVAL_MS), and remains reconfigurable afterwards
  // via startAutoCleanup(customIntervalMs) — which is safe to call
  // again at any time since it always stops any existing timer first.
  // Cleanup only ever touches archivedById (never activeById), so
  // this can never affect a context that is still active.
  startAutoCleanup(
    typeof global.AXIOM_RUNTIME_CONTEXT_CLEANUP_INTERVAL_MS === 'number'
      ? global.AXIOM_RUNTIME_CONTEXT_CLEANUP_INTERVAL_MS
      : AUTO_CLEANUP_INTERVAL_MS
  );

  var AxiomRuntimeContext = {
    API_VERSION: API_VERSION,
    CONTEXT_STATUS: STATUS,

    // Part A
    createContext: createContext,
    destroyContext: destroyContext,
    getContext: getContext,
    updateContext: updateContext,
    cloneContext: cloneContext,
    clearContext: clearContext,

    // Part B
    createChildContext: createChildContext,
    getChildContexts: getChildContexts,
    getParentContext: getParentContext,
    getContextsByWorkflow: getContextsByWorkflow,

    // Part C
    transitionContext: transitionContext,
    markReady: markReady,
    markRunning: markRunning,
    markWaiting: markWaiting,
    pauseContext: pauseContext,
    resumeContext: resumeContext,
    completeContext: completeContext,
    failContext: failContext,
    cancelContext: cancelContext,

    // Part E
    listContexts: listContexts,
    getContextMetrics: getContextMetrics,
    getActiveContexts: getActiveContexts,
    getContextHistory: getContextHistory,
    getContextStatus: getContextStatus,

    // Part F
    recoverContext: recoverContext,
    archiveContext: archiveContext,
    cleanupExpiredContexts: cleanupExpiredContexts,
    startAutoCleanup: startAutoCleanup,
    stopAutoCleanup: stopAutoCleanup,
    isAutoCleanupRunning: isAutoCleanupRunning
  };

  global.AxiomRuntimeContext = AxiomRuntimeContext;
})(typeof window !== 'undefined' ? window : this);
