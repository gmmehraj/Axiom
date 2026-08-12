// ============================================================
// AXIOM — Block 2 / Step 7 / Part 2: Autonomous AI Task Planning &
// Execution
// ------------------------------------------------------------
// Step 6 built the whole coordination stack this pass runs on top of:
//   - orchestrator.js            registry / bus / scheduler (Part 1)
//   - runtime-context.js         the one real context system  (Part 5)
//   - capability-router.js       analyze -> resolve -> route -> retry
//                                 -> alternate-agent failover for a
//                                 SINGLE capability request     (Part 3)
//   - agent-registry-integration.js  live discovery (Part 2)
//   - workflow-planner.js        HAND-AUTHORED, sequential-only stage
//                                 graphs a caller builds by hand  (Part 4)
//
// None of those pieces takes a free-text GOAL and decides what work
// needs to happen. workflow-planner.js's usage example makes this
// explicit: the caller already writes out `stages: [...]` themselves.
// That is the real, net-new gap this Part closes — nothing else here
// is duplicated:
//
//   - Goal decomposition ("Analyze user goals and automatically break
//     them into executable tasks") does not exist anywhere in
//     os/core/*. This module adds it, built only from what the live
//     registry already exposes (Orchestrator.discoverCapabilities()),
//     the same "never hardcode a subsystem/capability name" posture
//     capability-router.js already holds itself to.
//
//   - Task ASSIGNMENT and DISPATCH are not reimplemented. Every
//     decomposed task is handed to capability-router.js's own
//     route() — the exact same request/retry/timeout/alternate-agent
//     -failover pipeline every other caller in this codebase uses.
//     This module never calls AxiomOrchestrator.enqueue() directly and
//     never talks to an agent handler.
//
//   - Execution ordering reuses dependsOn the same way workflow-
//     planner.js does, but does NOT reuse workflow-planner.js's
//     engine itself, for one deliberate, documented reason:
//     executeWorkflow() runs its topological order "one stage at a
//     time" (see workflow-planner.js Part A/B) — sequential only, by
//     design, for hand-authored collaboration chains. This Part's
//     brief explicitly asks for "sequential AND parallel task
//     execution where appropriate," which a strictly one-at-a-time
//     loop cannot provide. Rather than editing workflow-planner.js's
//     execution loop (risking Step 6 Part 4's already-passing
//     regression suite) or copying it, this module drives its own
//     tasks straight through capability-router.js's route() — which
//     already supports N concurrent in-flight requests — firing every
//     task whose dependencies are satisfied in the same tick. Tasks
//     from a single clause with no ordering word between them fire
//     together; tasks gated by "then" / ";" / "after that" wait for
//     their dependency to reach a terminal state first. Nothing about
//     the Scheduler, the EventBus, or capability-router.js's retry/
//     failover pipeline is re-implemented anywhere in this file.
//
//   - Retry / graceful failure recovery is not reimplemented either.
//     By the time a route()'d task reaches this module as failed, the
//     Scheduler has already retried it on its original agent up to
//     its own maxRetries, and capability-router.js has already tried
//     up to two alternate agents exposing the same capability (Part
//     F). What this module adds on top is graph-level recovery that
//     only makes sense at the goal level: a task whose dependency
//     never completed is marked WAITING then CANCELLED rather than
//     dispatched into a request that could never succeed, and a
//     caller can re-run just the clauses that failed via retryGoal()
//     without re-doing the clauses that already completed.
//
//   - Runtime Context integration follows the exact pattern
//     runtime-context.js's own FIX 3 established for workflow-
//     planner.js: one real AxiomRuntimeContext record per goal run,
//     created at start, synced on every task state change, completed
//     /failed/cancelled and destroyed on every exit path. No second,
//     parallel context object is kept anywhere in this file.
//
// Task states — Pending, Queued, Running, Waiting, Completed, Failed,
// Cancelled — are new at the individual-task level (see rationale
// below; the existing TASK_STATUS on orchestrator.js is scheduler-
// level and unrelated, so this module intentionally does not reuse or
// collide with that name):
//   PENDING    created, not yet evaluated by the scheduling loop
//   WAITING    evaluated at least once; blocked on an unfinished
//              dependency
//   QUEUED     dependencies satisfied, route() has been called,
//              waiting for capability-router.js to admit it
//   RUNNING    the routed request is in flight
//   COMPLETED  / FAILED / CANCELLED — terminal
//
// Usage:
//   var plan = AxiomOrchestrator.planGoal(
//     'search AI news, then remember it, then summarize progress');
//   var started = AxiomOrchestrator.executeGoal(plan);
//   started.promise.then(function (result) { ... });
//   AxiomOrchestrator.getGoalStatus(started.planId);
//   AxiomOrchestrator.cancelGoal(started.planId);
//   AxiomOrchestrator.retryGoal(started.planId); // only the failed clauses
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;
  var RuntimeContext = global.AxiomRuntimeContext;

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[AutonomousTaskPlanner] ' + message, detail !== undefined ? detail : '');
      return;
    }
    try {
      // eslint-disable-next-line no-console
      console[method === 'error' ? 'error' : 'log']('[AutonomousTaskPlanner] ' + message, detail || '');
    } catch (e) { /* no console available — swallow */ }
  }

  if (!Orchestrator || typeof Orchestrator.route !== 'function' ||
      typeof Orchestrator.discoverCapabilities !== 'function') {
    log('error', 'requires os/core/orchestrator.js, capability-router.js, and agent-registry-integration.js loaded first.');
    return;
  }
  if (!RuntimeContext || typeof RuntimeContext.createContext !== 'function') {
    log('error', 'requires os/core/runtime-context.js loaded first.');
    return;
  }

  var API_VERSION = '1.0.0';

  var TASK_STATE = {
    PENDING: 'pending',
    WAITING: 'waiting',
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  };
  var TERMINAL_TASK_STATES = [TASK_STATE.COMPLETED, TASK_STATE.FAILED, TASK_STATE.CANCELLED];

  var GOAL_STATUS = {
    PLANNED: 'planned',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  };

  function isTerminal(status) { return TERMINAL_TASK_STATES.indexOf(status) !== -1; }
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }

  var seq = 0;
  function uid(prefix) {
    seq += 1;
    return prefix + '-' + Date.now().toString(36) + '-' + seq.toString(36);
  }

  // ------------------------------------------------------------
  // PART A — Goal decomposition
  // ------------------------------------------------------------
  // Sequencing words/punctuation split a goal into ORDERED clauses.
  // A goal with none of these is checked for "and"/comma separated
  // subjects instead — those are treated as INDEPENDENT clauses with
  // no dependency between them, which is what lets this module offer
  // real parallel execution rather than always chaining every clause.
  var SEQUENCE_SPLIT = /\s*(?:,\s*then\s+|\bthen\b|\bafter that\b|;\s*|\.\s+(?=[a-z]))\s*/i;
  var PARALLEL_SPLIT = /\s*(?:,\s*and\s+|\band\b|,)\s*/i;

  function cleanClause(s) {
    return String(s || '').trim().replace(/^(and|then|also)\s+/i, '').replace(/[.\s]+$/, '');
  }

  function splitClauses(text) {
    var raw = String(text || '').trim();
    if (!raw) return { clauses: [], sequential: false };
    var bySeq = raw.split(SEQUENCE_SPLIT).map(cleanClause).filter(Boolean);
    if (bySeq.length > 1) return { clauses: bySeq, sequential: true };
    var byPar = raw.split(PARALLEL_SPLIT).map(cleanClause).filter(Boolean);
    if (byPar.length > 1) return { clauses: byPar, sequential: false };
    return { clauses: [cleanClause(raw)], sequential: false };
  }

  function tokenize(s) {
    return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  // Scores every capability the LIVE registry currently advertises
  // against a clause's words. A capability like "bug-investigation"
  // matches a clause containing both "bug" and "investigat[e/ion]";
  // partial word overlap still counts, so "investigate the bug"
  // scores against it too. No subsystem or capability name is ever
  // hardcoded here — everything comes from
  // Orchestrator.discoverCapabilities() at call time, so a newly
  // registered agent's capabilities become plannable automatically,
  // with zero changes to this file (mirrors the same guarantee
  // STEP7_PART1_REPORT.md verified for capability-router.js's own
  // routing).
  function matchCapabilities(clauseWords) {
    var known = Orchestrator.discoverCapabilities();
    var wordSet = Object.create(null);
    clauseWords.forEach(function (w) { wordSet[w] = true; });

    var scored = known.map(function (capability) {
      var capWords = tokenize(capability);
      var score = capWords.reduce(function (n, w) { return n + (wordSet[w] ? 1 : 0); }, 0);
      return { capability: capability, score: score };
    }).filter(function (m) { return m.score > 0; });

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.capability < b.capability ? -1 : (a.capability > b.capability ? 1 : 0);
    });
    return scored;
  }

  function makeTask(planId, clause, capability) {
    return {
      id: uid('gtask'),
      planId: planId,
      clause: clause,
      capability: capability || null,
      status: TASK_STATE.PENDING,
      dependsOn: [],
      requestId: null,
      agentId: null,
      result: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null
    };
  }

  // decomposeGoal(): the pure analysis step (Task 1), with no side
  // effects and no dispatch — safe to call to preview a plan before
  // committing to executeGoal().
  function decomposeGoal(text, opts) {
    opts = opts || {};
    var analysis = splitClauses(text);
    var maxPerClause = typeof opts.maxCapabilitiesPerClause === 'number' ? opts.maxCapabilitiesPerClause : 2;

    var clauseTasks = analysis.clauses.map(function (clause) {
      var matches = matchCapabilities(tokenize(clause));
      if (!matches.length) return [{ clause: clause, capability: null }];
      return matches.slice(0, Math.max(1, maxPerClause)).map(function (m) {
        return { clause: clause, capability: m.capability };
      });
    });

    return { clauses: analysis.clauses, sequential: analysis.sequential, clauseTasks: clauseTasks };
  }

  // ------------------------------------------------------------
  // PART B — Plan storage
  // ------------------------------------------------------------
  var plansById = Object.create(null);
  // Maps an in-flight capability-router.js requestId back to the goal
  // task that issued it, so the two module-level listeners below
  // (registered once, never per-plan) can resolve any plan's tasks —
  // the same "one shared listener, not N leaked ones" discipline
  // orchestrator.js's own scheduler follows.
  var requestToTask = Object.create(null);

  function planGoal(text, opts) {
    opts = opts || {};
    if (typeof text === 'object' && text && Array.isArray(text.tasks)) {
      // Already a plan object (e.g. re-submitted by the caller) —
      // pass through unchanged so executeGoal() can accept either.
      return text;
    }
    var decomposition = decomposeGoal(text, opts);
    var planId = uid('goalplan');
    var tasks = [];
    var byClauseIndex = [];

    decomposition.clauseTasks.forEach(function (group) {
      var ids = group.map(function (g) {
        var t = makeTask(planId, g.clause, g.capability);
        tasks.push(t);
        return t;
      });
      byClauseIndex.push(ids);
    });

    if (decomposition.sequential) {
      for (var i = 1; i < byClauseIndex.length; i++) {
        var prevIds = byClauseIndex[i - 1].map(function (t) { return t.id; });
        byClauseIndex[i].forEach(function (t) { t.dependsOn = prevIds.slice(); });
      }
    }
    // else: independent clauses stay dependency-free -> the execution
    // loop below fires all of them in the very first tick, in parallel.

    var plan = {
      id: planId,
      goal: String(text || '').trim() || 'Untitled goal',
      status: GOAL_STATUS.PLANNED,
      sequential: decomposition.sequential,
      tasks: tasks,
      tasksById: null,
      contextId: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      cancelRequested: false,
      finalized: false,
      resolve: null
    };
    plan.tasksById = Object.create(null);
    tasks.forEach(function (t) { plan.tasksById[t.id] = t; });

    plansById[planId] = plan;
    Orchestrator.emit('goal_planned', {
      planId: planId, goal: plan.goal, taskCount: tasks.length, sequential: plan.sequential
    });
    return snapshotPlan(plan);
  }

  // ------------------------------------------------------------
  // PART C — Runtime Context integration (reused, not duplicated —
  // identical create/sync/finalize/destroy shape to
  // workflow-planner.js's createWorkflowContext/syncWorkflowContext/
  // finalizeWorkflowContext).
  // ------------------------------------------------------------
  function createGoalContext(plan) {
    var rc = RuntimeContext.createContext({
      workflowId: plan.id,
      metadata: { goal: plan.goal, taskCount: plan.tasks.length },
      state: { status: plan.status },
      temporaryData: { tasks: {} }
    });
    RuntimeContext.markReady(rc.contextId);
    RuntimeContext.markRunning(rc.contextId);
    return rc.contextId;
  }

  function syncGoalContext(plan) {
    if (!plan.contextId) return;
    try {
      var tasksById = {};
      plan.tasks.forEach(function (t) { tasksById[t.id] = snapshotTask(t); });
      RuntimeContext.updateContext(plan.contextId, {
        state: { status: plan.status },
        temporaryData: { tasks: tasksById }
      });
    } catch (err) {
      log('error', 'sync-runtime-context failed', { contextId: plan.contextId, message: err && err.message });
    }
  }

  function finalizeGoalContext(plan, reason) {
    if (!plan.contextId) return;
    syncGoalContext(plan);
    try {
      if (plan.status === GOAL_STATUS.COMPLETED) RuntimeContext.completeContext(plan.contextId);
      else if (plan.status === GOAL_STATUS.FAILED) RuntimeContext.failContext(plan.contextId, reason);
      else RuntimeContext.cancelContext(plan.contextId, reason);
    } catch (err) {
      log('error', 'finalize-runtime-context failed', { contextId: plan.contextId, message: err && err.message });
    }
    try {
      RuntimeContext.destroyContext(plan.contextId, reason || plan.status);
    } catch (err) {
      log('error', 'destroy-runtime-context failed', { contextId: plan.contextId, message: err && err.message });
    }
  }

  // ------------------------------------------------------------
  // PART D — Execution loop
  // ------------------------------------------------------------
  function dependencyStates(plan, task) {
    return task.dependsOn.map(function (depId) { return plan.tasksById[depId] ? plan.tasksById[depId].status : null; });
  }

  function emitTaskEvent(type, plan, task, extra) {
    Orchestrator.emit(type, Object.assign({
      planId: plan.id, taskId: task.id, clause: task.clause, capability: task.capability, status: task.status
    }, extra || {}));
  }

  // One admission pass: every PENDING/WAITING task whose dependencies
  // are now satisfied is routed immediately (parallel, no artificial
  // one-at-a-time throttling); every task with a permanently-failed
  // dependency is cancelled instead of being dispatched into a
  // request that could never succeed; everything else becomes/stays
  // WAITING. Re-entrant calls while a pass is already running are
  // coalesced onto the next microtask, the same guard
  // task-scheduler-style modules elsewhere in this codebase use to
  // prevent duplicate admissions.
  function tick(plan) {
    if (plan.finalized) return;
    if (plan.ticking) { plan.tickQueued = true; return; }
    plan.ticking = true;

    plan.tasks.forEach(function (task) {
      if (task.status !== TASK_STATE.PENDING && task.status !== TASK_STATE.WAITING) return;

      var depStates = dependencyStates(plan, task);
      var blocked = depStates.some(function (s) { return s === TASK_STATE.FAILED || s === TASK_STATE.CANCELLED; });
      if (blocked) {
        task.status = TASK_STATE.CANCELLED;
        task.error = 'Skipped — a dependency did not complete.';
        task.finishedAt = Date.now();
        emitTaskEvent('goal_task_cancelled', plan, task, { error: task.error });
        return;
      }

      var ready = depStates.every(function (s) { return s === TASK_STATE.COMPLETED; });
      if (!ready) {
        if (task.status !== TASK_STATE.WAITING) {
          task.status = TASK_STATE.WAITING;
          emitTaskEvent('goal_task_waiting', plan, task);
        }
        return;
      }

      if (!task.capability) {
        task.status = TASK_STATE.FAILED;
        task.error = 'Could not resolve a capability for "' + task.clause + '" against the live agent registry.';
        task.finishedAt = Date.now();
        emitTaskEvent('goal_task_failed', plan, task, { error: task.error });
        return;
      }

      task.status = TASK_STATE.QUEUED;
      emitTaskEvent('goal_task_queued', plan, task);

      var routed = Orchestrator.route({
        requestId: task.id,
        capability: task.capability,
        payload: { text: task.clause, goal: plan.goal },
        priority: 0
      });

      if (!routed.accepted) {
        task.status = TASK_STATE.FAILED;
        task.error = routed.error || 'Routing was not accepted.';
        task.finishedAt = Date.now();
        emitTaskEvent('goal_task_failed', plan, task, { error: task.error });
        return;
      }

      task.requestId = routed.requestId;
      task.agentId = routed.agentId;
      task.status = TASK_STATE.RUNNING;
      task.startedAt = Date.now();
      requestToTask[routed.requestId] = task;
      emitTaskEvent('goal_task_started', plan, task, { agentId: routed.agentId });
    });

    syncGoalContext(plan);
    plan.ticking = false;
    if (plan.tickQueued) { plan.tickQueued = false; tick(plan); return; }

    maybeFinalize(plan);
  }

  function maybeFinalize(plan) {
    if (plan.finalized) return;
    var outstanding = plan.tasks.some(function (t) { return !isTerminal(t.status); });
    if (outstanding) return;

    plan.finalized = true;
    var failed = plan.tasks.filter(function (t) { return t.status === TASK_STATE.FAILED; });
    var cancelled = plan.tasks.filter(function (t) { return t.status === TASK_STATE.CANCELLED; });
    plan.status = plan.cancelRequested
      ? GOAL_STATUS.CANCELLED
      : (failed.length ? GOAL_STATUS.FAILED : GOAL_STATUS.COMPLETED);
    plan.finishedAt = Date.now();

    finalizeGoalContext(plan, failed.length ? (failed[0] && failed[0].error) : (plan.cancelRequested ? 'cancelled_by_caller' : undefined));

    Orchestrator.emit('goal_' + plan.status, {
      planId: plan.id, goal: plan.goal, tasks: plan.tasks.length, failed: failed.length, cancelled: cancelled.length
    });

    if (typeof plan.resolve === 'function') {
      plan.resolve({ planId: plan.id, status: plan.status, goal: plan.goal, tasks: plan.tasks.map(snapshotTask) });
    }
  }

  // Two listeners, registered exactly once at module load — never one
  // per plan or per task — so N concurrent goals never leak N times
  // the listeners. Mirrors capability-router.js's own single
  // task_started/task_completed/task_failed registration.
  function onRouteCompleted(payload) {
    var task = requestToTask[payload.requestId];
    if (!task) return;
    delete requestToTask[payload.requestId];
    task.status = TASK_STATE.COMPLETED;
    task.result = payload.result;
    task.finishedAt = Date.now();
    var plan = plansById[task.planId];
    if (!plan) return;
    emitTaskEvent('goal_task_completed', plan, task);
    tick(plan);
  }

  function onRouteFailed(payload) {
    var task = requestToTask[payload.requestId];
    if (!task) return;
    delete requestToTask[payload.requestId];
    // capability-router.js's own cancelRequest() emits route_failed en
    // route to marking the request CANCELLED (see os/core/capability-
    // router.js Part F / cancelRequest) — ask it for the settled
    // status rather than guessing from the failure reason string, so
    // a caller-initiated cancelGoal() ends a task as Cancelled, not
    // Failed.
    var reqStatus = Orchestrator.getTaskStatus ? Orchestrator.getTaskStatus(payload.requestId) : null;
    task.status = (reqStatus && reqStatus.status === 'cancelled') ? TASK_STATE.CANCELLED : TASK_STATE.FAILED;
    task.error = payload.reason;
    task.finishedAt = Date.now();
    var plan = plansById[task.planId];
    if (!plan) return;
    emitTaskEvent(task.status === TASK_STATE.CANCELLED ? 'goal_task_cancelled' : 'goal_task_failed', plan, task, { error: task.error });
    tick(plan);
  }

  Orchestrator.on('route_completed', onRouteCompleted);
  Orchestrator.on('route_failed', onRouteFailed);

  function executeGoal(textOrPlan, opts) {
    var planSnapshot = planGoal(textOrPlan, opts);
    var plan = plansById[planSnapshot.id];
    if (!plan) {
      return { planId: null, promise: Promise.reject(new Error('[AutonomousTaskPlanner] executeGoal: unknown plan.')) };
    }
    if (!plan.tasks.length) {
      return { planId: plan.id, promise: Promise.reject(new Error('[AutonomousTaskPlanner] executeGoal: goal decomposed into zero tasks.')) };
    }
    if (plan.status !== GOAL_STATUS.PLANNED) {
      return { planId: plan.id, promise: Promise.reject(new Error('[AutonomousTaskPlanner] executeGoal: plan "' + plan.id + '" already ' + plan.status + '.')) };
    }

    plan.status = GOAL_STATUS.RUNNING;
    plan.startedAt = Date.now();
    plan.contextId = createGoalContext(plan);

    var promise = new Promise(function (resolve) { plan.resolve = resolve; });
    Orchestrator.emit('goal_started', { planId: plan.id, goal: plan.goal, taskCount: plan.tasks.length });

    tick(plan);
    return { planId: plan.id, promise: promise };
  }

  // ------------------------------------------------------------
  // PART E — Cancellation & retry
  // ------------------------------------------------------------
  function cancelGoal(planId, reason) {
    var plan = plansById[planId];
    if (!plan || plan.status !== GOAL_STATUS.RUNNING) return false;
    plan.cancelRequested = true;

    plan.tasks.forEach(function (task) {
      if (task.status === TASK_STATE.RUNNING && task.requestId) {
        // Mark Cancelled and stop tracking this request *before* asking
        // capability-router.js to cancel it: Orchestrator.cancel() (called
        // from inside cancelRequest()) synchronously emits task_failed ->
        // route_failed before cancelRequest() sets its own record to
        // 'cancelled', so reacting to that nested event here would race
        // and could observe a transient 'failed' status. Dropping the
        // requestId from requestToTask first makes the nested
        // onRouteFailed() a clean no-op instead.
        var requestId = task.requestId;
        delete requestToTask[requestId];
        task.status = TASK_STATE.CANCELLED;
        task.error = reason || 'Cancelled by caller.';
        task.finishedAt = Date.now();
        emitTaskEvent('goal_task_cancelled', plan, task, { error: task.error });
        Orchestrator.cancelRequest(requestId, reason || 'cancelled_by_caller');
        return;
      }
      if (task.status === TASK_STATE.PENDING || task.status === TASK_STATE.WAITING || task.status === TASK_STATE.QUEUED) {
        task.status = TASK_STATE.CANCELLED;
        task.error = reason || 'Cancelled by caller.';
        task.finishedAt = Date.now();
        emitTaskEvent('goal_task_cancelled', plan, task, { error: task.error });
      }
    });

    if (!plan.finalized) tick(plan);
    return true;
  }

  // Re-runs only the clauses that failed last time, chained as their
  // own fresh sequential goal so a partial success is never repeated
  // — the same "retry only what actually failed" guarantee
  // job-manager.js's retryJob() and task-scheduler.js's cascade-cancel
  // both hold themselves to elsewhere in this codebase.
  function retryGoal(planId) {
    var plan = plansById[planId];
    if (!plan || plan.status !== GOAL_STATUS.FAILED) return null;
    var failedClauses = [];
    plan.tasks.forEach(function (t) {
      if (t.status === TASK_STATE.FAILED && failedClauses.indexOf(t.clause) === -1) failedClauses.push(t.clause);
    });
    if (!failedClauses.length) return null;
    return executeGoal(failedClauses.join(', then '));
  }

  // ------------------------------------------------------------
  // PART F — Read APIs
  // ------------------------------------------------------------
  function snapshotTask(t) {
    return {
      id: t.id, planId: t.planId, clause: t.clause, capability: t.capability,
      status: t.status, dependsOn: t.dependsOn.slice(), requestId: t.requestId, agentId: t.agentId,
      result: t.result, error: t.error, createdAt: t.createdAt, startedAt: t.startedAt, finishedAt: t.finishedAt
    };
  }

  function snapshotPlan(plan) {
    return {
      id: plan.id, goal: plan.goal, status: plan.status, sequential: plan.sequential,
      contextId: plan.contextId, createdAt: plan.createdAt, startedAt: plan.startedAt, finishedAt: plan.finishedAt,
      tasks: plan.tasks.map(snapshotTask)
    };
  }

  function getGoalStatus(planId) {
    var plan = plansById[planId];
    return plan ? snapshotPlan(plan) : null;
  }

  function getGoalTasks(planId) {
    var plan = plansById[planId];
    return plan ? plan.tasks.map(snapshotTask) : [];
  }

  function listGoals() { return Object.keys(plansById); }

  // ------------------------------------------------------------
  // Install onto the existing AxiomOrchestrator object (additive
  // only — orchestrator.js, capability-router.js, agent-registry-
  // integration.js, runtime-context.js, and workflow-planner.js are
  // none of them edited, so every earlier Step 6/7 regression suite
  // and file stays valid and untouched).
  // ------------------------------------------------------------
  function installTaskPlanningApi() {
    if (typeof Orchestrator.planGoal === 'function') return; // idempotent

    Orchestrator.decomposeGoal = decomposeGoal;
    Orchestrator.planGoal = planGoal;
    Orchestrator.executeGoal = executeGoal;
    Orchestrator.cancelGoal = cancelGoal;
    Orchestrator.retryGoal = retryGoal;
    Orchestrator.getGoalStatus = getGoalStatus;
    Orchestrator.getGoalTasks = getGoalTasks;
    Orchestrator.listGoals = listGoals;
    Orchestrator.GOAL_TASK_STATE = TASK_STATE;
    Orchestrator.GOAL_STATUS = GOAL_STATUS;
  }

  installTaskPlanningApi();

  // Exposed directly too, for callers/tests that want the module
  // without going through the installed AxiomOrchestrator surface —
  // same convention capability-router.js and workflow-planner.js
  // follow. Deliberately NOT named AxiomTaskPlanner: that global
  // already exists in this repository under
  // os/runtime/intelligence/task-planner.js, which belongs to a
  // separate page (os-shell.html) and a separate lineage (the
  // "AI OS" Milestone stack) that this Block 2 / Step 6/7 lineage
  // does not load and must not collide with, even though no single
  // page currently loads both.
  var AxiomAutonomousTaskPlanner = {
    API_VERSION: API_VERSION,
    TASK_STATE: TASK_STATE,
    GOAL_STATUS: GOAL_STATUS,
    decomposeGoal: decomposeGoal,
    planGoal: planGoal,
    executeGoal: executeGoal,
    cancelGoal: cancelGoal,
    retryGoal: retryGoal,
    getGoalStatus: getGoalStatus,
    getGoalTasks: getGoalTasks,
    listGoals: listGoals
  };

  global.AxiomAutonomousTaskPlanner = AxiomAutonomousTaskPlanner;
})(window);
