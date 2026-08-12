// ============================================================
// AXIOM AI OS — Milestone 8: Multi-Agent Orchestrator
// ------------------------------------------------------------
// Executes a decomposed plan (see task-planner.js) across whatever
// agents it names. It is the generic engine behind Task 2 (multi-
// agent collaboration) and Task 4 (long-running tasks): every named
// workflow in capabilities/workflows.js is a hand-written, fixed
// sequence; this module runs ARBITRARY step graphs built at runtime
// from a free-text request, in dependency order, with retries,
// pause/resume/cancel, and shared context — without touching or
// duplicating any of that hand-written workflow logic.
//
// It never talks to an agent directly except through
// AxiomAgentManager.dispatch() (a structured `task:assign` event) and
// never learns a result except through the shared bus's
// `task:completed` / `task:failed` events — the same contract every
// other caller in this codebase uses.
//
// Public surface — window.AxiomOrchestrator:
//   .run(plan, opts?) -> { runId, promise }
//   .pause(runId) / .resume(runId) / .cancel(runId) -> boolean
//   .status(runId)  -> snapshot | null
//   .listRuns()      -> runId[]
// ============================================================
window.AxiomOrchestrator = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  if (!RT || !MGR) {
    AxLogger.error('[AxiomOrchestrator] requires agent-runtime.js and agent-manager.js loaded first.');
    return null;
  }
  var bus = RT.bus;
  var CTX = window.AxiomContextStore; // optional but expected

  var runs = new Map(); // runId -> run state
  var DEFAULT_RETRIES = 2;
  var DEFAULT_BACKOFF_MS = 400;
  var DEFAULT_STEP_TIMEOUT_MS = 15000;
  var DEFAULT_CONCURRENCY = 3;

  function uid() { return 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

  function emit(type, runId, payload) {
    bus.emit(type, 'orchestrator', Object.assign({ runId: runId }, payload || {}));
  }

  // Waits for the specific agent+task pair to settle, exactly like the
  // hand-written workflows already do — reused here as the one place any
  // orchestration code waits on a dispatched task.
  function onTaskSettled(agentId, taskId, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var offOk = bus.on('task:completed', function (env) {
        if (done || env.payload.agent !== agentId || env.payload.task.id !== taskId) return;
        done = true; offOk(); offFail(); clearTimeout(timer);
        resolve(env.payload.result);
      });
      var offFail = bus.on('task:failed', function (env) {
        if (done || env.payload.agent !== agentId || env.payload.task.id !== taskId) return;
        done = true; offOk(); offFail(); clearTimeout(timer);
        reject(new Error(env.payload.error || (agentId + ' task failed.')));
      });
      var timer = setTimeout(function () {
        if (done) return;
        done = true; offOk(); offFail();
        reject(new Error(agentId + ' step timed out after ' + timeoutMs + 'ms'));
      }, timeoutMs || DEFAULT_STEP_TIMEOUT_MS);
    });
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Dispatch one step with retry/backoff. Mirrors capability-kit's policy
  // at the orchestration layer, since a step here can span an entire
  // workflow hop rather than one capability call.
  function runStepWithRetry(run, step, opts) {
    var attempts = 0;
    var maxAttempts = 1 + (typeof opts.retries === 'number' ? opts.retries : DEFAULT_RETRIES);

    function attempt() {
      attempts += 1;
      if (run.status === 'cancelled') return Promise.reject(new Error('run cancelled'));
      step.status = 'running';
      step.startedAt = Date.now();
      emit('orchestrator:step-started', run.id, { stepId: step.id, agentId: step.agentId, attempt: attempts });
      if (CTX) CTX.appendProgress(run.id, 'Started "' + step.clause + '" on ' + step.agentId, { stepId: step.id });

      var taskId = MGR.dispatch(step.agentId, Object.assign({}, step.task, { runId: run.id }));
      if (!taskId) return Promise.reject(new Error('Unknown or unavailable agent "' + step.agentId + '".'));

      return onTaskSettled(step.agentId, taskId, opts.stepTimeoutMs)
        .then(function (result) {
          step.status = 'done';
          step.result = result;
          step.finishedAt = Date.now();
          emit('orchestrator:step-completed', run.id, { stepId: step.id, agentId: step.agentId, result: result });
          if (CTX) CTX.merge(run.id, wrapResultKey(step, result));
          if (window.AxiomPlanner && step.plannerStepId) {
            window.AxiomPlanner.markComplete(run.planId, step.plannerStepId);
          }
          return result;
        })
        .catch(function (err) {
          if (run.status === 'cancelled') throw err;
          if (attempts < maxAttempts) {
            emit('orchestrator:step-retry', run.id, { stepId: step.id, agentId: step.agentId, attempt: attempts, error: String(err && err.message || err) });
            return delay(DEFAULT_BACKOFF_MS * attempts).then(attempt);
          }
          step.status = 'failed';
          step.error = String(err && err.message || err);
          step.finishedAt = Date.now();
          emit('orchestrator:step-failed', run.id, { stepId: step.id, agentId: step.agentId, error: step.error });
          if (CTX) CTX.appendError(run.id, step.error, { stepId: step.id });
          if (window.AxiomPlanner && step.plannerStepId) {
            window.AxiomPlanner.updateStep(run.planId, step.plannerStepId, { status: 'blocked' });
          }
          throw err;
        });
    }

    return attempt();
  }

  function wrapResultKey(step, result) {
    var key = 'result:' + step.agentId + ':' + step.id;
    var patch = {};
    patch[key] = result;
    return patch;
  }

  function stepReady(run, step) {
    if (step.status !== 'pending') return false;
    return step.dependsOn.every(function (depId) {
      var dep = run.stepsById[depId];
      // A dependency that failed permanently blocks its dependents rather
      // than silently skipping them — a "graceful failure" the caller can
      // see in status(), not a crash of the whole run.
      return dep && dep.status === 'done';
    });
  }

  function hasBlockedDependency(run, step) {
    return step.dependsOn.some(function (depId) {
      var dep = run.stepsById[depId];
      return dep && dep.status === 'failed';
    });
  }

  // The scheduler loop: while not paused/cancelled, keep launching every
  // step whose dependencies are satisfied, up to the concurrency limit,
  // until every step is settled (done/failed/skipped) or the run stalls.
  function pump(run, opts) {
    if (run.status === 'cancelled') { finalize(run); return; }
    if (run.status === 'paused') return; // resume() re-calls pump()

    var pending = run.steps.filter(function (s) { return s.status === 'pending'; });
    if (!pending.length) { finalize(run); return; }

    var runningCount = run.steps.filter(function (s) { return s.status === 'running'; }).length;
    var launched = false;

    pending.forEach(function (step) {
      if (runningCount >= (opts.concurrency || DEFAULT_CONCURRENCY)) return;
      if (hasBlockedDependency(run, step)) {
        step.status = 'skipped';
        step.error = 'Skipped — a dependency failed.';
        emit('orchestrator:step-skipped', run.id, { stepId: step.id, agentId: step.agentId });
        return;
      }
      if (!stepReady(run, step)) return;

      launched = true;
      runningCount += 1;
      runStepWithRetry(run, step, opts)
        .catch(function () { /* already recorded on the step; run continues */ })
        .then(function () { pump(run, opts); });
    });

    // Nothing launched this tick and nothing is running -> the graph is
    // stuck (e.g. a cyclic dependency) rather than silently hanging forever.
    if (!launched && !runningCount) {
      pending.forEach(function (s) {
        s.status = 'failed';
        s.error = 'Unresolvable dependency graph.';
      });
      finalize(run);
    }
  }

  function finalize(run) {
    if (run.finalized) return;
    var pending = run.steps.filter(function (s) { return s.status === 'pending' || s.status === 'running'; });
    if (pending.length) return; // still work in flight
    run.finalized = true;
    var failed = run.steps.filter(function (s) { return s.status === 'failed'; });
    run.status = run.status === 'cancelled' ? 'cancelled' : (failed.length ? 'failed' : 'completed');
    run.finishedAt = Date.now();
    if (CTX) CTX.setStatus(run.id, run.status);
    emit('orchestrator:run-' + run.status, run.id, { goal: run.goal, steps: run.steps.length, failed: failed.length });
    run.resolve({
      runId: run.id, status: run.status, goal: run.goal,
      steps: run.steps.map(function (s) { return { id: s.id, agentId: s.agentId, clause: s.clause, status: s.status, result: s.result, error: s.error }; })
    });
  }

  function run(plan, opts) {
    opts = opts || {};
    if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
      return { runId: null, promise: Promise.reject(new Error('[AxiomOrchestrator] run() requires a plan with at least one step.')) };
    }
    var runId = uid();
    var state = {
      id: runId,
      planId: plan.planId || null,
      goal: plan.goal || 'Untitled run',
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      finalized: false,
      steps: plan.steps.map(function (s) {
        return Object.assign({}, s, { status: 'pending', result: null, error: null });
      }),
      stepsById: null
    };
    state.stepsById = {};
    state.steps.forEach(function (s) { state.stepsById[s.id] = s; });

    var promise = new Promise(function (resolve) { state.resolve = resolve; });
    runs.set(runId, state);

    if (CTX) CTX.create(runId, { goal: state.goal, planId: state.planId });
    emit('orchestrator:run-started', runId, { goal: state.goal, steps: state.steps.length });

    pump(state, opts);
    return { runId: runId, promise: promise };
  }

  function pause(runId) {
    var r = runs.get(runId);
    if (!r || r.status !== 'running') return false;
    r.status = 'paused';
    emit('orchestrator:run-paused', runId, {});
    return true;
  }

  function resume(runId, opts) {
    var r = runs.get(runId);
    if (!r || r.status !== 'paused') return false;
    r.status = 'running';
    emit('orchestrator:run-resumed', runId, {});
    pump(r, opts || {});
    return true;
  }

  // Cancellation is cooperative and immediate for not-yet-started steps;
  // in-flight steps are asked to stop via the agent's own cancel() (which
  // capability-kit already honours) and will settle shortly after.
  function cancel(runId) {
    var r = runs.get(runId);
    if (!r) return false;
    r.status = 'cancelled';
    r.steps.forEach(function (s) {
      if (s.status === 'pending') s.status = 'skipped';
      if (s.status === 'running') {
        try { MGR.cancel(s.agentId); } catch (e) { /* best-effort */ }
      }
    });
    emit('orchestrator:run-cancel-requested', runId, {});
    finalize(r);
    return true;
  }

  function status(runId) {
    var r = runs.get(runId);
    if (!r) return null;
    return {
      runId: r.id, planId: r.planId, goal: r.goal, status: r.status,
      startedAt: r.startedAt, finishedAt: r.finishedAt,
      steps: r.steps.map(function (s) { return { id: s.id, agentId: s.agentId, clause: s.clause, status: s.status, error: s.error }; })
    };
  }

  function listRuns() { return Array.from(runs.keys()); }

  return { run: run, pause: pause, resume: resume, cancel: cancel, status: status, listRuns: listRuns };
})();
