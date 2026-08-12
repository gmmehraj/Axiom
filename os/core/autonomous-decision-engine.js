// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3C: Autonomous Decision Engine
// ------------------------------------------------------------
// Part 3A (goal-manager.js foundation) gave the stack a durable,
// hierarchical Goal Record with a validated status machine. Part 3B
// added priority, dependency tracking, a computed queue, and
// scheduling primitives (`scheduleGoal`, `runGoalScheduler`) — but
// every one of those admits a goal into RUNNING purely on the basis
// of the goal graph itself (priority, age, dependency order). None of
// them ever look at whether the WORK a goal actually needs can be
// done right now: is there a healthy agent exposing the right
// capability, and does the system have the headroom to run it.
//
// This module is that missing decision layer. It picks "the next
// goal" the same way a caller previously had to do by hand — reading
// the goal graph, the live agent registry, and the current runtime
// load, then deciding — except automatically, and without ever
// hardcoding a goal type, a capability name, an agent id, or a fixed
// sequence of steps. Every decision is a pure function of state this
// module reads from three existing subsystems at decision time:
//
//   1. Active goals & dependencies   — os/core/goal-manager.js
//      (`AxiomGoalManager`): `getGoalExecutionOrder`, `isGoalBlocked`,
//      `getGoal`, `scheduleGoal`, `markGoalRunning`.
//   2. Runtime Context               — os/core/runtime-context.js
//      (`AxiomRuntimeContext`): `getActiveContexts`,
//      `getContextMetrics` — the live system-load signal.
//   3. Available agents & capabilities — os/core/capability-router.js
//      (`AxiomCapabilityRouter`) and os/core/orchestrator.js
//      (`AxiomOrchestrator.listAgents`/`discoverAgents`):
//      `selectAgent(capability, options)` — the live, health/workload
//      -ranked agent-selection logic already built for real dispatch,
//      reused verbatim rather than re-implemented here.
//
// What "no hardcoded workflows" means concretely: this file contains
// no goal-type -> capability table, no capability -> agent-id table,
// and no fixed multi-step plan. The capability a goal needs (if any)
// is read off the goal's OWN metadata (`metadata.capability` /
// `metadata.requiredCapability`, set by whatever created the goal);
// which agent can serve it is resolved fresh, every time, from
// whichever agents happen to be registered right now via
// `AxiomCapabilityRouter.selectAgent()`. A goal with no capability
// requirement at all is perfectly valid and is judged on goal-graph
// eligibility (blocked/unblocked, capacity) alone. Add a brand-new
// capability and a brand-new agent at runtime and this module needs
// no code change to route goals to it.
//
// What this module explicitly does NOT do:
//   - It does not re-implement goal status transitions, the goal
//     queue, dependency tracking, or circular-dependency detection —
//     all of that stays exactly Part 3A/3B's (`transitionGoal`,
//     `getGoalQueue`, `addGoalDependency`, ...). This module only ever
//     calls `scheduleGoal()`/`markGoalRunning()` — the same two calls
//     any external caller already had to make by hand.
//   - It does not re-implement agent selection, health/workload
//     ranking, or failover — all of that stays exactly
//     `capability-router.js`'s `selectAgent()`. This module never
//     inspects `AxiomOrchestrator.listAgents()` records to make a
//     selection decision itself; it only uses `listAgents()` for the
//     read-only "does any agent exist for this capability at all"
//     diagnostic distinction between "no candidate" and "candidates
//     exist but none eligible right now".
//   - It does not create Runtime Context records itself — every goal
//     already gets exactly one, created by `goal-manager.js` at
//     `createGoal()` time; this module only *reads*
//     `AxiomRuntimeContext.getActiveContexts()`/`getContextMetrics()`
//     for system-load headroom.
//   - It does not dispatch/execute a goal's underlying work. Admitting
//     a goal here means driving its status to RUNNING via the goal's
//     own status machine — identical in spirit to Part 3B's
//     `dequeueNextGoal()` — not invoking a task or an agent handler.
//   - It does not install anything onto `AxiomOrchestrator` — same
//     standalone-global posture `goal-manager.js` already documents
//     and for the identical reason: nothing here should be able to
//     collide with `task-planner.js`'s own Goal-shaped surface.
//
// Usage:
//   AxiomDecisionEngine.evaluateGoal(goalId)
//   // -> { eligible, blocked, capability, agentAvailable, atCapacity, reason, ... }
//
//   AxiomDecisionEngine.selectNextGoal()
//   // -> the single best eligible goal snapshot right now, or null
//
//   AxiomDecisionEngine.runDecisionCycle()
//   // -> admits every unblocked goal into the queue (reusing Part
//   //    3B's runGoalScheduler), then automatically selects and
//   //    admits ONE goal into RUNNING if a fully-eligible candidate
//   //    exists: { admitted, deferred, systemLoad }
//
//   AxiomOrchestrator.on('decisionengine_admitted', ({ goalId, agentId }) => { ... });
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;
  var RuntimeContext = global.AxiomRuntimeContext;
  var GoalManager = global.AxiomGoalManager;
  var CapabilityRouter = global.AxiomCapabilityRouter;

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[AxiomDecisionEngine] ' + message, detail !== undefined ? detail : '');
      return;
    }
    try {
      // eslint-disable-next-line no-console
      console[method === 'error' ? 'error' : 'log']('[AxiomDecisionEngine] ' + message, detail || '');
    } catch (e) { /* no console available — swallow */ }
  }

  if (!Orchestrator || typeof Orchestrator.emit !== 'function' || typeof Orchestrator.on !== 'function') {
    log('error', 'requires os/core/orchestrator.js (Event Bus) loaded first.');
    return;
  }
  if (!RuntimeContext || typeof RuntimeContext.getActiveContexts !== 'function') {
    log('error', 'requires os/core/runtime-context.js loaded first.');
    return;
  }
  if (!GoalManager || typeof GoalManager.getGoalExecutionOrder !== 'function') {
    log('error', 'requires os/core/goal-manager.js (Step 7 Part 3A/3B) loaded first.');
    return;
  }
  if (!CapabilityRouter || typeof CapabilityRouter.selectAgent !== 'function') {
    log('error', 'requires os/core/capability-router.js loaded first.');
    return;
  }

  var API_VERSION = '1.0.0';

  // ------------------------------------------------------------
  // PART A — small local helpers (same style as the rest of the
  // stack; nothing here is shared mutable state from another file).
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

  var GOAL_STATUS = GoalManager.GOAL_STATUS;
  var SCHEDULABLE_STATUSES = [GOAL_STATUS.PENDING, GOAL_STATUS.WAITING, GOAL_STATUS.QUEUED];

  function emit(event, payload) { Orchestrator.emit(event, payload); }

  // ------------------------------------------------------------
  // PART B — Runtime Context evaluation. System load is a pure read
  // over the real Runtime Context registry — no counter of our own is
  // kept in sync; `getActiveContexts().length` (mirrored by
  // `getContextMetrics().active`) already IS the live count of
  // in-flight contexts across every subsystem, not just goals.
  // `maxConcurrentGoals` is an optional, caller-set knob (default:
  // unbounded) — this module never hardcodes a concurrency ceiling;
  // callers who want throttling opt in explicitly.
  // ------------------------------------------------------------
  var maxConcurrentGoals = null; // null = unbounded

  function setMaxConcurrentGoals(n) {
    if (n === null) { maxConcurrentGoals = null; return null; }
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || Math.floor(n) !== n) {
      throw new Error('[AxiomDecisionEngine] setMaxConcurrentGoals: expected a non-negative integer or null, got ' + n + '.');
    }
    maxConcurrentGoals = n;
    return maxConcurrentGoals;
  }

  function getMaxConcurrentGoals() { return maxConcurrentGoals; }

  function getSystemLoad() {
    var runningGoals = GoalManager.listGoals({ status: GOAL_STATUS.RUNNING }).length;
    var contextMetrics = RuntimeContext.getContextMetrics();
    var atCapacity = maxConcurrentGoals !== null && runningGoals >= maxConcurrentGoals;
    return deepFreeze({
      runningGoals: runningGoals,
      activeContexts: contextMetrics.active,
      peakConcurrentContexts: contextMetrics.peakConcurrent,
      maxConcurrentGoals: maxConcurrentGoals,
      atCapacity: atCapacity,
      timestamp: Date.now()
    });
  }

  // ------------------------------------------------------------
  // PART C — Capability & agent evaluation. The capability a goal
  // needs is read off the goal's own metadata — never a literal in
  // this file. Agent selection is entirely delegated to
  // `AxiomCapabilityRouter.selectAgent()`, the exact same
  // health/availability/workload/priority-ranked logic real dispatch
  // already uses, so "is an agent available" here can never disagree
  // with what would actually happen if the goal were routed.
  // ------------------------------------------------------------
  function resolveGoalCapability(goal) {
    var meta = isPlainObject(goal.metadata) ? goal.metadata : {};
    if (isNonEmptyString(meta.capability)) return meta.capability;
    if (isNonEmptyString(meta.requiredCapability)) return meta.requiredCapability;
    return null;
  }

  function anyAgentKnowsCapability(capability) {
    var agents = Orchestrator.discoverAgents ?
      Orchestrator.discoverAgents({ capability: capability }) :
      Orchestrator.listAgents().filter(function (a) { return a.capabilities.indexOf(capability) !== -1; });
    return agents.length > 0;
  }

  function resolveGoalAgent(goal, capability) {
    if (!capability) {
      return { agent: null, available: true, reason: 'goal does not require a capability' };
    }
    var meta = isPlainObject(goal.metadata) ? goal.metadata : {};
    var agent = CapabilityRouter.selectAgent(capability, {
      excludeAgents: Array.isArray(meta.excludeAgents) ? meta.excludeAgents : [],
      requiredPermission: isNonEmptyString(meta.requiredPermission) ? meta.requiredPermission : null
    });
    if (agent) return { agent: agent, available: true, reason: 'eligible agent found' };
    if (!anyAgentKnowsCapability(capability)) {
      return { agent: null, available: false, reason: 'no agent registered advertises capability "' + capability + '"' };
    }
    return { agent: null, available: false, reason: 'capability "' + capability + '" has agents registered, but none are currently eligible (health/permission/exclusion)' };
  }

  // ------------------------------------------------------------
  // PART D — Single-goal evaluation. Combines goal-graph eligibility
  // (Part 3A/3B), capability/agent availability (Part C above), and
  // system load (Part B above) into one diagnostic. Read-only — never
  // mutates the goal or triggers a transition.
  // ------------------------------------------------------------
  function evaluateGoal(goalId) {
    var goal = GoalManager.getGoal(goalId);
    if (!goal) throw new Error('[AxiomDecisionEngine] evaluateGoal: goal "' + goalId + '" does not exist.');

    var systemLoad = getSystemLoad();
    var terminal = [GOAL_STATUS.COMPLETED, GOAL_STATUS.FAILED, GOAL_STATUS.CANCELLED].indexOf(goal.status) !== -1;
    var schedulable = SCHEDULABLE_STATUSES.indexOf(goal.status) !== -1;
    var blocked = schedulable ? GoalManager.isGoalBlocked(goalId) : false;
    var capability = resolveGoalCapability(goal);
    var agentInfo = resolveGoalAgent(goal, capability);

    var eligible = false;
    var reason = null;

    if (terminal) {
      reason = 'goal is in a terminal status ("' + goal.status + '")';
    } else if (goal.isPaused) {
      reason = 'goal is paused';
    } else if (!schedulable) {
      reason = 'goal status "' + goal.status + '" is not schedulable (already running or otherwise in flight)';
    } else if (blocked) {
      reason = 'goal is blocked by one or more unresolved dependencies';
    } else if (!agentInfo.available) {
      reason = agentInfo.reason;
    } else if (systemLoad.atCapacity) {
      reason = 'system is at its configured concurrency capacity (' + systemLoad.maxConcurrentGoals + ' running goals)';
    } else {
      eligible = true;
      reason = 'ready — unblocked, capability satisfied, capacity available';
    }

    return deepFreeze({
      goalId: goal.id,
      title: goal.title,
      status: goal.status,
      priority: goal.priority,
      createdAt: goal.createdAt,
      isPaused: goal.isPaused,
      blocked: blocked,
      capability: capability,
      agentId: agentInfo.agent ? agentInfo.agent.id : null,
      agentAvailable: agentInfo.available,
      systemLoad: systemLoad,
      eligible: eligible,
      reason: reason
    });
  }

  // ------------------------------------------------------------
  // PART E — Ranking & selection. Candidate order is Part 3B's own
  // `getGoalExecutionOrder()` (topological over dependencies, then
  // priority desc / age asc) — no second ordering scheme is invented;
  // this module only adds the capability/agent/capacity filter on
  // top, evaluating every candidate so an independent branch behind a
  // blocked goal (e.g. a diamond dependency) is still considered
  // rather than the whole scan stopping at the first ineligible goal.
  // ------------------------------------------------------------
  function rankCandidateGoals(filter) {
    var order = GoalManager.getGoalExecutionOrder(filter);
    return order
      .filter(function (g) { return SCHEDULABLE_STATUSES.indexOf(g.status) !== -1 && !g.isPaused; })
      .map(function (g) { return evaluateGoal(g.id); });
  }

  function selectNextGoal(filter) {
    var ranked = rankCandidateGoals(filter);
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].eligible) return ranked[i];
    }
    return null;
  }

  // ------------------------------------------------------------
  // PART F — Admission. Composes Part 3B's own `scheduleGoal()` /
  // `markGoalRunning()` — the identical two calls an external caller
  // already had to make by hand — rather than driving `transitionGoal`
  // directly. No status-machine logic is duplicated here.
  // ------------------------------------------------------------
  function admitGoal(goalId) {
    var evaluation = evaluateGoal(goalId);
    if (!evaluation.eligible) {
      return { admitted: false, goal: GoalManager.getGoal(goalId), evaluation: evaluation };
    }

    var goal = GoalManager.getGoal(goalId);
    if (goal.status === GOAL_STATUS.PENDING || goal.status === GOAL_STATUS.WAITING) {
      var scheduled = GoalManager.scheduleGoal(goalId);
      if (!scheduled.scheduled) {
        // Dependency state changed between evaluate() and here (race)
        // — refuse rather than force an admission the graph no longer
        // supports.
        return { admitted: false, goal: scheduled.goal, evaluation: evaluateGoal(goalId) };
      }
    }

    var run = GoalManager.markGoalRunning(goalId);
    if (!run.success) {
      return { admitted: false, goal: run.goal, evaluation: evaluateGoal(goalId) };
    }

    emit('decisionengine_admitted', { goalId: goalId, agentId: evaluation.agentId, capability: evaluation.capability });
    return { admitted: true, goal: run.goal, evaluation: evaluation };
  }

  // ------------------------------------------------------------
  // PART G — Decision cycle & history. `runDecisionCycle()` is the
  // single autonomous entry point requested: it (1) reuses Part 3B's
  // `runGoalScheduler()` to admit every unblocked Pending/Waiting goal
  // into the Queue exactly as it already would, then (2) selects and
  // admits ONE goal into Running via Part F above. A bounded,
  // append-only decision log mirrors the "History" discipline
  // `goal-manager.js`/`runtime-context.js` already use elsewhere.
  // ------------------------------------------------------------
  var MAX_HISTORY = 500;
  var decisionHistory = [];
  var metrics = { cycles: 0, admitted: 0, deferred: 0, idle: 0 };

  function pushHistory(entry) {
    decisionHistory.unshift(deepFreeze(Object.assign({ at: Date.now() }, entry)));
    if (decisionHistory.length > MAX_HISTORY) decisionHistory.length = MAX_HISTORY;
  }

  function runDecisionCycle(filter) {
    metrics.cycles += 1;
    var schedulerResult = GoalManager.runGoalScheduler(filter);
    var systemLoadBefore = getSystemLoad();

    var next = selectNextGoal(filter);
    if (!next) {
      metrics.idle += 1;
      var idleOutcome = {
        admitted: null,
        deferred: null,
        scheduled: schedulerResult.scheduled.length,
        parkedWaiting: schedulerResult.blocked.length,
        systemLoad: systemLoadBefore
      };
      pushHistory({ outcome: 'idle', scheduled: idleOutcome.scheduled, parkedWaiting: idleOutcome.parkedWaiting });
      emit('decisionengine_idle', { systemLoad: systemLoadBefore });
      return deepFreeze(idleOutcome);
    }

    var result = admitGoal(next.goalId);
    var outcome = {
      admitted: result.admitted ? result.goal : null,
      deferred: result.admitted ? null : result.evaluation,
      scheduled: schedulerResult.scheduled.length,
      parkedWaiting: schedulerResult.blocked.length,
      systemLoad: getSystemLoad()
    };

    if (result.admitted) {
      metrics.admitted += 1;
      pushHistory({ outcome: 'admitted', goalId: next.goalId, agentId: result.evaluation.agentId, capability: result.evaluation.capability });
    } else {
      metrics.deferred += 1;
      pushHistory({ outcome: 'deferred', goalId: next.goalId, reason: result.evaluation.reason });
      emit('decisionengine_deferred', { goalId: next.goalId, reason: result.evaluation.reason });
    }

    emit('decisionengine_cycle_complete', outcome);
    return deepFreeze(outcome);
  }

  function getDecisionHistory(limit) {
    var n = typeof limit === 'number' && limit > 0 ? limit : decisionHistory.length;
    return decisionHistory.slice(0, n);
  }

  function getDecisionMetrics() {
    return deepFreeze({
      cycles: metrics.cycles,
      admitted: metrics.admitted,
      deferred: metrics.deferred,
      idle: metrics.idle
    });
  }

  // ------------------------------------------------------------
  // Standalone global only — same posture and for the same reason
  // goal-manager.js documents in its own header: this module installs
  // nothing onto AxiomOrchestrator, so it cannot collide with
  // task-planner.js's or capability-router.js's own surface there.
  // orchestrator.js, runtime-context.js, goal-manager.js, and
  // capability-router.js are none of them edited by this file.
  // ------------------------------------------------------------
  var AxiomDecisionEngine = {
    API_VERSION: API_VERSION,

    setMaxConcurrentGoals: setMaxConcurrentGoals,
    getMaxConcurrentGoals: getMaxConcurrentGoals,
    getSystemLoad: getSystemLoad,

    resolveGoalCapability: function (goalId) { return resolveGoalCapability(GoalManager.getGoal(goalId)); },
    evaluateGoal: evaluateGoal,
    rankCandidateGoals: rankCandidateGoals,
    selectNextGoal: selectNextGoal,

    admitGoal: admitGoal,
    runDecisionCycle: runDecisionCycle,

    getDecisionHistory: getDecisionHistory,
    getDecisionMetrics: getDecisionMetrics
  };

  global.AxiomDecisionEngine = AxiomDecisionEngine;
})(typeof window !== 'undefined' ? window : this);
