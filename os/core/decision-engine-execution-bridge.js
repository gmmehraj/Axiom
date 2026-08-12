// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3D: Decision Engine -> Autonomous
// Task Planner Execution Bridge
// ------------------------------------------------------------
// Part 3C (autonomous-decision-engine.js) decides WHICH Goal Record
// gets to run next and flips it to RUNNING via
// `AxiomGoalManager.markGoalRunning()` — but nothing it does actually
// turns that goal's free text into work. Separately, Part 2
// (task-planner.js) already does exactly that for a raw text goal:
// `AxiomOrchestrator.executeGoal(text)` decomposes it into clauses,
// matches each clause to a live capability, and dispatches every task
// through `capability-router.js`'s own route()/retry/failover
// pipeline — but it has never been wired to anything that decides
// *which* goal to run; every existing call site hands it a goal
// string by hand.
//
// This module is the missing wire between those two, and adds
// nothing else:
//
//   1. Listens for `AxiomDecisionEngine`'s own `decisionengine_admitted`
//      event and, for every goal it admits, automatically calls
//      `AxiomOrchestrator.executeGoal()` — the exact same call any
//      external caller already had to make by hand. Goal decomposition,
//      capability matching, task dispatch, sequencing/parallelism, and
//      per-task retry/failover are 100% `task-planner.js`'s own logic,
//      reused verbatim; nothing about them is re-implemented here.
//   2. Listens for `task-planner.js`'s own `goal_task_*` events and,
//      for every plan THIS module dispatched, re-reads the
//      authoritative task snapshot via `AxiomOrchestrator.getGoalStatus()`
//      and mirrors the counts onto the Goal Record via
//      `AxiomGoalManager.updateGoalMetadata()` — which already syncs
//      that Goal Record's own Runtime Context as a side effect
//      (`goal-manager.js`'s own `syncGoalRuntimeContext()`), so Runtime
//      Context stays current without this module ever touching
//      `AxiomRuntimeContext` directly.
//   3. Awaits the SAME promise `executeGoal()` already returns (settled
//      exactly once, from `task-planner.js`'s own `maybeFinalize()`) and,
//      on settlement, reflects the plan's terminal status onto the Goal
//      Record via `AxiomGoalManager.completeGoal()` / `failGoal()` /
//      `cancelGoal()` — the same three calls any external caller of the
//      Goal Manager already had to make by hand.
//   4. On a failed plan, retries at the GOAL level (not the task level —
//      `task-planner.js`'s own `retryGoal()` already re-runs just the
//      failed clauses within a single plan; this is a *new*, independent
//      attempt of the whole goal) up to a configurable bound, by calling
//      `AxiomGoalManager.retryGoal()` (mints a fresh Goal Record, never
//      mutates the failed one) and then `AxiomDecisionEngine.admitGoal()`
//      on it — the exact same eligibility-checked admission path every
//      other goal goes through. Exhausted retries are left Failed and
//      reported, never silently dropped.
//
// What this module explicitly does NOT do:
//   - It does not decompose goal text, match capabilities, dispatch
//     tasks, or retry a task on an alternate agent. All of that stays
//     exactly `task-planner.js`'s (`decomposeGoal`, `planGoal`,
//     `executeGoal`, the `tick()` loop) and `capability-router.js`'s
//     (`route()`, its own retry/failover). This module only ever calls
//     the four `AxiomOrchestrator` methods `task-planner.js` installs:
//     `executeGoal`, `cancelGoal`, `retryGoal`, `getGoalStatus`.
//   - It does not re-implement goal eligibility, agent selection, or
//     admission. It only ever calls `AxiomDecisionEngine.admitGoal()` —
//     never `AxiomGoalManager.markGoalRunning()` directly — so a retry
//     can never be admitted by a path the Decision Engine didn't itself
//     approve.
//   - It does not re-implement Goal Record status transitions. It only
//     ever calls `AxiomGoalManager.completeGoal()` / `failGoal()` /
//     `cancelGoal()` / `retryGoal()` / `updateGoalMetadata()` — the
//     exact same validated status machine every other caller of the
//     Goal Manager already goes through.
//   - It does not create, update, or destroy an `AxiomRuntimeContext`
//     record itself. Both the Goal Record's own context (created by
//     `goal-manager.js`) and the plan's own context (created by
//     `task-planner.js`) already exist; this module only triggers the
//     former's existing sync path via `updateGoalMetadata()`.
//
// Usage:
//   // Nothing to call for the common path — once loaded, every goal
//   // the Decision Engine admits is automatically executed:
//   AxiomDecisionEngine.runDecisionCycle();
//   // -> emits 'decisionengine_admitted' for one goal
//   // -> this module's listener calls executeGoal() automatically
//   // -> progress + terminal status flow back onto the Goal Record
//
//   AxiomDecisionEngineExecutionBridge.getExecution(goalId)
//   // -> { goalId, planId, status, tasksTotal, tasksCompleted,
//   //      tasksFailed, tasksCancelled, retryCount, startedAt, finishedAt }
//
//   AxiomDecisionEngineExecutionBridge.setMaxExecutionRetries(2);
//   AxiomDecisionEngineExecutionBridge.cancelExecution(goalId, 'reason');
//
//   AxiomOrchestrator.on('decisionengine_execution_completed', ({ goalId, planId }) => { ... });
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;
  var GoalManager = global.AxiomGoalManager;
  var DecisionEngine = global.AxiomDecisionEngine;

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[AxiomDecisionEngineExecutionBridge] ' + message, detail !== undefined ? detail : '');
      return;
    }
    try {
      // eslint-disable-next-line no-console
      console[method === 'error' ? 'error' : 'log']('[AxiomDecisionEngineExecutionBridge] ' + message, detail || '');
    } catch (e) { /* no console available — swallow */ }
  }

  if (!Orchestrator || typeof Orchestrator.emit !== 'function' || typeof Orchestrator.on !== 'function') {
    log('error', 'requires os/core/orchestrator.js (Event Bus) loaded first.');
    return;
  }
  if (typeof Orchestrator.executeGoal !== 'function' || typeof Orchestrator.getGoalStatus !== 'function' ||
      typeof Orchestrator.cancelGoal !== 'function' || typeof Orchestrator.retryGoal !== 'function') {
    log('error', 'requires os/core/task-planner.js (Step 7 Part 2 — installs ' +
      'AxiomOrchestrator.executeGoal/getGoalStatus/cancelGoal/retryGoal) loaded first.');
    return;
  }
  if (!GoalManager || typeof GoalManager.getGoal !== 'function' || typeof GoalManager.completeGoal !== 'function' ||
      typeof GoalManager.failGoal !== 'function' || typeof GoalManager.cancelGoal !== 'function' ||
      typeof GoalManager.retryGoal !== 'function' || typeof GoalManager.updateGoalMetadata !== 'function') {
    log('error', 'requires os/core/goal-manager.js (Step 7 Part 3A/3B) loaded first.');
    return;
  }
  if (!DecisionEngine || typeof DecisionEngine.admitGoal !== 'function') {
    log('error', 'requires os/core/autonomous-decision-engine.js (Step 7 Part 3C) loaded first.');
    return;
  }

  var API_VERSION = '1.0.0';

  // ------------------------------------------------------------
  // PART A — small local helpers (same style as the rest of the
  // Step 7 stack; nothing here is shared mutable state from another
  // file).
  // ------------------------------------------------------------
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }

  function deepFreeze(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.getOwnPropertyNames(obj).forEach(function (key) {
      var val = obj[key];
      if (val && typeof val === 'object' && !Object.isFrozen(val)) deepFreeze(val);
    });
    return Object.freeze(obj);
  }

  var TERMINAL_GOAL_STATUSES = [
    GoalManager.GOAL_STATUS.COMPLETED,
    GoalManager.GOAL_STATUS.FAILED,
    GoalManager.GOAL_STATUS.CANCELLED
  ];
  function isTerminalGoalStatus(status) { return TERMINAL_GOAL_STATUSES.indexOf(status) !== -1; }
  function isTerminalExecStatus(status) { return status === 'completed' || status === 'failed' || status === 'cancelled'; }

  function emit(event, payload) { Orchestrator.emit(event, payload); }

  // ------------------------------------------------------------
  // PART B — Retry policy. A caller-set knob (default: 2), same
  // "unbounded is opt-in, never a hidden default" posture
  // `autonomous-decision-engine.js`'s own `setMaxConcurrentGoals()`
  // uses. A goal's own `metadata.maxRetries` overrides the module
  // default for just that goal (and is inherited by every retry
  // minted from it, since `AxiomGoalManager.retryGoal()` clones
  // `metadata` onto the new Goal Record).
  // ------------------------------------------------------------
  var DEFAULT_MAX_EXECUTION_RETRIES = 2;
  var maxExecutionRetries = DEFAULT_MAX_EXECUTION_RETRIES;

  function setMaxExecutionRetries(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || Math.floor(n) !== n) {
      throw new Error('[AxiomDecisionEngineExecutionBridge] setMaxExecutionRetries: expected a non-negative integer, got ' + n + '.');
    }
    maxExecutionRetries = n;
    return maxExecutionRetries;
  }

  function getMaxExecutionRetries() { return maxExecutionRetries; }

  function resolveMaxRetries(goal) {
    var meta = isPlainObject(goal.metadata) ? goal.metadata : {};
    if (typeof meta.maxRetries === 'number' && isFinite(meta.maxRetries) && meta.maxRetries >= 0) {
      return Math.floor(meta.maxRetries);
    }
    return maxExecutionRetries;
  }

  function goalText(goal) {
    return isNonEmptyString(goal.description) ? goal.description : goal.title;
  }

  // ------------------------------------------------------------
  // PART C — Execution ledger. One record per dispatched goal,
  // keyed by goalId, plus the reverse planId -> goalId index the
  // task-event listeners need (task-planner.js's own events carry a
  // planId, never a goalId — it has no notion of "goal" in this
  // lineage's sense). Bounded, append-only history mirrors the
  // "History" discipline `goal-manager.js` / `autonomous-decision-
  // engine.js` already use elsewhere.
  // ------------------------------------------------------------
  var executionsByGoalId = Object.create(null);
  var planIdToGoalId = Object.create(null);

  var MAX_HISTORY = 500;
  var executionHistory = [];
  var metrics = { dispatched: 0, completed: 0, failed: 0, retried: 0, exhausted: 0, cancelled: 0 };

  function pushHistory(entry) {
    executionHistory.unshift(deepFreeze(Object.assign({ at: Date.now() }, entry)));
    if (executionHistory.length > MAX_HISTORY) executionHistory.length = MAX_HISTORY;
  }

  // ------------------------------------------------------------
  // PART D — Dispatch. Converts an admitted Goal Record into an
  // executable task plan by calling the existing Task Planner —
  // never a second decomposition/dispatch path of its own.
  // ------------------------------------------------------------
  function dispatchGoal(goalId) {
    var existing = executionsByGoalId[goalId];
    if (existing && !isTerminalExecStatus(existing.status)) {
      return existing; // already in flight — never double-dispatch the same goal
    }

    var goal = GoalManager.getGoal(goalId);
    if (!goal) {
      log('error', 'dispatchGoal: unknown goal "' + goalId + '".');
      return null;
    }

    var started = Orchestrator.executeGoal(goalText(goal));

    var record = {
      goalId: goalId,
      planId: started.planId,
      status: 'running',
      tasksTotal: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksCancelled: 0,
      retryCount: goal.retryCount || 0,
      startedAt: Date.now(),
      finishedAt: null
    };
    executionsByGoalId[goalId] = record;
    if (started.planId) planIdToGoalId[started.planId] = goalId;

    metrics.dispatched += 1;
    pushHistory({ event: 'dispatched', goalId: goalId, planId: started.planId });
    emit('decisionengine_execution_started', { goalId: goalId, planId: started.planId, goal: goal.title });

    // The Task Planner's own promise is the single reliable "this plan
    // has reached a terminal state" signal — it resolves exactly once,
    // from `maybeFinalize()`, whether the outcome is Completed, Failed,
    // or Cancelled. Rejections only occur for goals `executeGoal()`
    // could not even start (e.g. zero tasks); both paths converge on
    // the same finalize step so the Goal Record never depends on which
    // one fired.
    started.promise.then(function (result) {
      onPlanSettled(goalId, result);
    }, function (err) {
      onDispatchRejected(goalId, err && err.message);
    });

    return record;
  }

  function onDispatchRejected(goalId, reason) {
    var rec = executionsByGoalId[goalId];
    if (!rec) return; // defensive — dispatchGoal() always creates one before attaching this handler
    rec.status = 'failed';
    rec.finishedAt = Date.now();
    finalizeGoalFromExecution(goalId, 'failed', reason || 'Task Planner could not start this goal.');
  }

  // ------------------------------------------------------------
  // PART E — Progress monitoring. Re-reads the authoritative plan
  // snapshot from `task-planner.js`'s own `getGoalStatus()` on every
  // task-level event it already emits, rather than keeping a second,
  // independently-incremented counter that could drift from it.
  // ------------------------------------------------------------
  function syncProgress(goalId, rec) {
    var planSnapshot = rec.planId ? Orchestrator.getGoalStatus(rec.planId) : null;
    if (!planSnapshot) return;

    var tasks = planSnapshot.tasks || [];
    rec.tasksTotal = tasks.length;
    rec.tasksCompleted = tasks.filter(function (t) { return t.status === 'completed'; }).length;
    rec.tasksFailed = tasks.filter(function (t) { return t.status === 'failed'; }).length;
    rec.tasksCancelled = tasks.filter(function (t) { return t.status === 'cancelled'; }).length;

    var progress = {
      tasksTotal: rec.tasksTotal,
      tasksCompleted: rec.tasksCompleted,
      tasksFailed: rec.tasksFailed,
      tasksCancelled: rec.tasksCancelled,
      planStatus: planSnapshot.status
    };

    try {
      // Merges into the Goal Record's own metadata AND syncs its
      // Runtime Context as a side effect of `updateGoalMetadata()` —
      // this module never touches `AxiomRuntimeContext` directly.
      GoalManager.updateGoalMetadata(goalId, { execution: Object.assign({ planId: rec.planId }, progress) });
    } catch (err) {
      log('error', 'syncProgress: updateGoalMetadata failed', { goalId: goalId, message: err && err.message });
    }

    pushHistory({ event: 'progress', goalId: goalId, planId: rec.planId, progress: progress });
    emit('decisionengine_execution_progress', Object.assign({ goalId: goalId, planId: rec.planId }, progress));
  }

  function onTaskEvent(payload) {
    if (!payload || !payload.planId) return;
    var goalId = planIdToGoalId[payload.planId];
    if (!goalId) return; // this plan wasn't dispatched by this bridge
    var rec = executionsByGoalId[goalId];
    if (!rec) return;
    syncProgress(goalId, rec);
  }

  Orchestrator.on('goal_task_started', onTaskEvent);
  Orchestrator.on('goal_task_queued', onTaskEvent);
  Orchestrator.on('goal_task_waiting', onTaskEvent);
  Orchestrator.on('goal_task_completed', onTaskEvent);
  Orchestrator.on('goal_task_failed', onTaskEvent);
  Orchestrator.on('goal_task_cancelled', onTaskEvent);

  // ------------------------------------------------------------
  // PART F — Terminal handling: reflect the plan's outcome onto the
  // Goal Record, and retry at the goal level on failure.
  // ------------------------------------------------------------
  function summarizeFailure(result) {
    var failedTask = (result && result.tasks || []).filter(function (t) { return t.status === 'failed'; })[0];
    return failedTask ? failedTask.error : 'Task Planner plan failed.';
  }

  function onPlanSettled(goalId, result) {
    var rec = executionsByGoalId[goalId];
    if (!rec) return;
    rec.status = result.status;
    rec.finishedAt = Date.now();
    syncProgress(goalId, rec); // final, authoritative counts

    var reason = result.status === 'failed' ? summarizeFailure(result) : null;
    finalizeGoalFromExecution(goalId, result.status, reason);
  }

  function finalizeGoalFromExecution(goalId, planStatus, reason) {
    var goal = GoalManager.getGoal(goalId);
    if (!goal) return;
    // A caller may already have moved this Goal Record to a terminal
    // status through some other path (e.g. `cancelExecution()` below,
    // which itself only ever settles through this same function).
    // Never attempt a second transition `transitionGoal()` would
    // refuse anyway — this guard just avoids the resulting no-op call
    // and a misleading duplicate event.
    if (isTerminalGoalStatus(goal.status)) return;

    var rec = executionsByGoalId[goalId];
    var planId = rec ? rec.planId : null;

    if (planStatus === 'completed') {
      GoalManager.completeGoal(goalId, { planId: planId });
      metrics.completed += 1;
      pushHistory({ event: 'completed', goalId: goalId, planId: planId });
      emit('decisionengine_execution_completed', { goalId: goalId, planId: planId });
      return;
    }

    if (planStatus === 'cancelled') {
      GoalManager.cancelGoal(goalId, reason || 'Task Planner plan was cancelled.');
      metrics.cancelled += 1;
      pushHistory({ event: 'cancelled', goalId: goalId, planId: planId, reason: reason || null });
      emit('decisionengine_execution_cancelled', { goalId: goalId, planId: planId, reason: reason || null });
      return;
    }

    // planStatus === 'failed'
    GoalManager.failGoal(goalId, reason || 'Task Planner plan failed.');
    metrics.failed += 1;
    pushHistory({ event: 'failed', goalId: goalId, planId: planId, reason: reason || null });
    emit('decisionengine_execution_failed', { goalId: goalId, planId: planId, reason: reason || null });

    attemptRetry(goalId, reason);
  }

  // Retries the whole GOAL as a fresh attempt (a new Goal Record —
  // never a mutation of the failed one), bounded by
  // `resolveMaxRetries()`, and re-enters it through
  // `AxiomDecisionEngine.admitGoal()` — the same eligibility-checked
  // admission path every other goal goes through. If it isn't
  // eligible yet (blocked, no agent, at capacity) it simply stays
  // Pending, exactly like any other goal, until a future
  // `runDecisionCycle()` picks it up.
  function attemptRetry(originalGoalId, reason) {
    var original = GoalManager.getGoal(originalGoalId);
    if (!original) return;

    var limit = resolveMaxRetries(original);
    if (original.retryCount >= limit) {
      metrics.exhausted += 1;
      pushHistory({ event: 'exhausted', goalId: originalGoalId, retryCount: original.retryCount, limit: limit });
      emit('decisionengine_execution_exhausted', {
        goalId: originalGoalId, retryCount: original.retryCount, limit: limit, reason: reason || null
      });
      return;
    }

    var next;
    try {
      next = GoalManager.retryGoal(originalGoalId);
    } catch (err) {
      log('error', 'attemptRetry: GoalManager.retryGoal failed', { goalId: originalGoalId, message: err && err.message });
      return;
    }

    metrics.retried += 1;
    pushHistory({ event: 'retry_created', goalId: originalGoalId, retryGoalId: next.id, retryCount: next.retryCount });
    emit('decisionengine_execution_retry', {
      goalId: originalGoalId, retryGoalId: next.id, retryCount: next.retryCount, reason: reason || null
    });

    try {
      DecisionEngine.admitGoal(next.id);
    } catch (err) {
      log('error', 'attemptRetry: DecisionEngine.admitGoal failed', { goalId: next.id, message: err && err.message });
    }
  }

  // ------------------------------------------------------------
  // PART G — Automatic trigger. The one listener that makes goal
  // execution actually autonomous: every goal the Decision Engine
  // admits is dispatched to the Task Planner with no further caller
  // action required.
  // ------------------------------------------------------------
  function onDecisionEngineAdmitted(payload) {
    if (!payload || !payload.goalId) return;
    dispatchGoal(payload.goalId);
  }

  Orchestrator.on('decisionengine_admitted', onDecisionEngineAdmitted);

  // ------------------------------------------------------------
  // PART H — Cancellation. Cancels the in-flight PLAN through
  // `task-planner.js`'s own `cancelGoal()`; the Goal Record's own
  // transition to Cancelled happens exactly once, through the same
  // `onPlanSettled()` -> `finalizeGoalFromExecution()` path every
  // other terminal outcome already goes through — never a second,
  // racing call into `AxiomGoalManager.cancelGoal()` from here.
  // ------------------------------------------------------------
  function cancelExecution(goalId, reason) {
    var rec = executionsByGoalId[goalId];
    if (!rec || !rec.planId || isTerminalExecStatus(rec.status)) return false;
    return Orchestrator.cancelGoal(rec.planId, reason);
  }

  // ------------------------------------------------------------
  // PART I — Read APIs
  // ------------------------------------------------------------
  function getExecution(goalId) {
    var rec = executionsByGoalId[goalId];
    return rec ? deepFreeze(Object.assign({}, rec)) : null;
  }

  function getExecutionForPlan(planId) {
    var goalId = planIdToGoalId[planId];
    return goalId ? getExecution(goalId) : null;
  }

  function listExecutions() { return Object.keys(executionsByGoalId); }

  function getExecutionHistory(limit) {
    var n = typeof limit === 'number' && limit > 0 ? limit : executionHistory.length;
    return executionHistory.slice(0, n);
  }

  function getExecutionMetrics() {
    return deepFreeze({
      dispatched: metrics.dispatched,
      completed: metrics.completed,
      failed: metrics.failed,
      retried: metrics.retried,
      exhausted: metrics.exhausted,
      cancelled: metrics.cancelled
    });
  }

  // ------------------------------------------------------------
  // Standalone global only — same posture `goal-manager.js` and
  // `autonomous-decision-engine.js` already document, and for the
  // identical reason: this module is a *consumer* of four existing
  // modules (`AxiomOrchestrator`, `AxiomGoalManager`,
  // `AxiomDecisionEngine`, and transitively `AxiomRuntimeContext`),
  // so putting its logic inside any one of them would make that
  // module aware of the others in a way none of them are today.
  // `orchestrator.js`, `goal-manager.js`, `autonomous-decision-
  // engine.js`, and `task-planner.js` are none of them edited by this
  // file.
  // ------------------------------------------------------------
  var AxiomDecisionEngineExecutionBridge = {
    API_VERSION: API_VERSION,

    setMaxExecutionRetries: setMaxExecutionRetries,
    getMaxExecutionRetries: getMaxExecutionRetries,

    dispatchGoal: dispatchGoal,
    cancelExecution: cancelExecution,

    getExecution: getExecution,
    getExecutionForPlan: getExecutionForPlan,
    listExecutions: listExecutions,

    getExecutionHistory: getExecutionHistory,
    getExecutionMetrics: getExecutionMetrics
  };

  global.AxiomDecisionEngineExecutionBridge = AxiomDecisionEngineExecutionBridge;
})(typeof window !== 'undefined' ? window : this);
