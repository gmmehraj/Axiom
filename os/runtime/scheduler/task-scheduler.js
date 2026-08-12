// ============================================================
// AXIOM AI OS — Milestone 11: Global Task Scheduler
// ------------------------------------------------------------
// Objective 1: "Implement a global task scheduler with priorities,
// dependencies, retries, cancellation, and background execution."
//
// The Job Manager (Milestone 8) already turns one plan into one
// background-running job with progress/pause/resume/cancel/retry.
// What does not exist anywhere yet is a layer ABOVE many jobs that
// decides WHICH job gets to actually start next when several are
// requested at once — by priority, and honouring dependencies
// BETWEEN separate jobs (not just between steps inside one job,
// which the Orchestrator already owns). This module is exactly that
// admission layer. It never runs a step itself and never talks to an
// Agent — every unit of work it admits is handed to the EXISTING
// Job Manager, unchanged, which is what actually executes it.
//
// Reuses:
//   - AxiomJobManager.createJob()  -> the only way a scheduled task's
//     work is ever actually executed. This module never calls the
//     Orchestrator or Agent Manager directly.
//   - AxiomJobManager.cancelJob()  -> cancelling an already-admitted task.
//   - AxiomJobManager.retryJob()   -> re-running only the failed clauses
//     of a scheduler-level retry (same re-decomposition guarantee
//     Executive AI relies on).
//   - The Agent Event Bus for every state change this module makes,
//     so the Event Timeline / Task Graph / Resource Monitor observe
//     scheduling purely through structured events, never by polling
//     this module's internals.
//
// Priorities: 'critical' > 'high' > 'normal' (default) > 'low'.
// Dependencies: `opts.dependsOn` is an array of OTHER scheduler task
// ids — a task is never admitted until all of them have settled with
// status 'completed'. If a dependency ends 'failed' or 'cancelled',
// every task depending on it is cancelled rather than left queued
// forever (mirrors the Orchestrator's own "a failed dependency blocks
// its dependents" rule, one level up).
//
// Public surface — window.AxiomTaskScheduler:
//   .schedule(textOrPlan, opts?) -> { taskId, priority, promise }
//   .cancel(taskId)              -> boolean
//   .getTask(taskId)             -> task snapshot | null
//   .list()                      -> task snapshot[]
//   .report()                    -> queue-depth / counts summary
//   .configure({ maxConcurrent }) -> current config
// ============================================================
window.AxiomTaskScheduler = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var JOBS = window.AxiomJobManager;
  if (!RT || !JOBS) {
    AxLogger.error('[AxiomTaskScheduler] requires agent-runtime.js and the Milestone 8 job-manager.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 };
  var DEFAULT_MAX_CONCURRENT = 3;
  var DEFAULT_MAX_RETRIES = 2;      // same bound Executive AI uses for its own auto-retry loop
  var RETRY_BACKOFF_MS = 500;

  var config = { maxConcurrent: DEFAULT_MAX_CONCURRENT };
  var tasks = new Map();   // taskId -> task record
  var seq = 0;
  var ticking = false;     // re-entrancy guard — never two admission passes at once
  var tickQueued = false;

  function uid() { return 'sched-' + Date.now().toString(36) + '-' + (++seq).toString(36); }
  function emit(type, taskId, payload) {
    bus.emit(type, 'task-scheduler', Object.assign({ taskId: taskId }, payload || {}));
  }

  function admittedCount() {
    var n = 0;
    tasks.forEach(function (t) { if (t.status === 'admitted' || t.status === 'running') n += 1; });
    return n;
  }

  function dependenciesSettled(task) {
    return task.dependsOn.every(function (depId) {
      var dep = tasks.get(depId);
      return !dep || dep.status === 'completed'; // an unknown dep id can never block forever
    });
  }

  function dependenciesFailed(task) {
    return task.dependsOn.some(function (depId) {
      var dep = tasks.get(depId);
      return dep && (dep.status === 'failed' || dep.status === 'cancelled');
    });
  }

  function cascadeCancel(taskId, reason) {
    tasks.forEach(function (t) {
      if (t.status !== 'queued') return;
      if (t.dependsOn.indexOf(taskId) === -1) return;
      finalize(t, 'cancelled', { reason: reason || ('dependency "' + taskId + '" did not complete') });
      cascadeCancel(t.id, reason); // propagate through chains of scheduled work
    });
  }

  function finalize(task, status, detail) {
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return;
    task.status = status;
    task.finishedAt = Date.now();
    task.detail = detail || null;
    emit('scheduler:' + status, task.id, { jobId: task.jobId, detail: detail || null });
    task.resolve({ taskId: task.id, status: status, jobId: task.jobId, detail: detail || null });
    if (status !== 'completed') cascadeCancel(task.id, 'upstream task ' + status);
    scheduleTick();
  }

  function wireJob(task) {
    var offDone = bus.on('job:completed', function (env) {
      if (env.payload.jobId !== task.jobId) return;
      offDone(); offFail(); offCancel();
      finalize(task, 'completed', { summary: env.payload.summary });
    });
    var offFail = bus.on('job:failed', function (env) {
      if (env.payload.jobId !== task.jobId) return;
      offDone(); offFail(); offCancel();
      maybeRetry(task, env.payload.error);
    });
    var offCancel = bus.on('job:cancelled', function (env) {
      if (env.payload.jobId !== task.jobId) return;
      offDone(); offFail(); offCancel();
      finalize(task, 'cancelled', { reason: 'job cancelled' });
    });
  }

  function maybeRetry(task, error) {
    if (task.retriesUsed >= task.maxRetries) {
      finalize(task, 'failed', { error: error, retriesUsed: task.retriesUsed });
      return;
    }
    task.retriesUsed += 1;
    emit('scheduler:retry', task.id, { attempt: task.retriesUsed, error: error });
    setTimeout(function () {
      var retried = JOBS.retryJob(task.jobId);
      if (!retried) {
        // Nothing retryable left to recover — same terminal outcome
        // Executive AI reaches when JobManager.retryJob() finds no
        // failed-step summary to re-run from.
        finalize(task, 'failed', { error: error, retriesUsed: task.retriesUsed, reason: 'nothing retryable' });
        return;
      }
      task.jobId = retried.id;
      wireJob(task);
    }, RETRY_BACKOFF_MS * task.retriesUsed);
  }

  function admit(task) {
    task.status = 'admitted';
    task.admittedAt = Date.now();
    emit('scheduler:admitted', task.id, { priority: task.priority });
    var job = JOBS.createJob(task.planOrText, task.jobOpts);
    task.jobId = job.id;
    task.status = 'running';
    wireJob(task);
  }

  // Single admission pass: pick the highest-priority, oldest, fully-ready
  // task for every free concurrency slot. Never recurses synchronously —
  // scheduleTick() defers to a microtask so bursts of schedule() calls in
  // the same tick collapse into one pass instead of duplicate admissions
  // (the "no duplicate task executions" requirement, enforced structurally).
  function tick() {
    ticking = true;
    var freeSlots = config.maxConcurrent - admittedCount();
    if (freeSlots <= 0) { ticking = false; return; }

    var ready = Array.from(tasks.values()).filter(function (t) { return t.status === 'queued'; });
    ready.forEach(function (t) {
      if (dependenciesFailed(t)) { finalize(t, 'cancelled', { reason: 'a dependency failed or was cancelled' }); }
    });
    ready = ready.filter(function (t) { return t.status === 'queued' && dependenciesSettled(t); });
    ready.sort(function (a, b) {
      var pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      return pr !== 0 ? pr : a.seq - b.seq;
    });

    ready.slice(0, freeSlots).forEach(function (t) { admit(t); });
    ticking = false;
  }

  function scheduleTick() {
    if (tickQueued) return;
    tickQueued = true;
    Promise.resolve().then(function () {
      tickQueued = false;
      if (!ticking) tick();
    });
  }

  function schedule(textOrPlan, opts) {
    opts = opts || {};
    var priority = PRIORITY_RANK.hasOwnProperty(opts.priority) ? opts.priority : 'normal';
    var taskId = uid();
    var task = {
      id: taskId,
      seq: ++seq,
      goal: typeof textOrPlan === 'string' ? textOrPlan : (textOrPlan && textOrPlan.goal) || 'Untitled',
      planOrText: textOrPlan,
      jobOpts: opts.jobOpts || {},
      priority: priority,
      dependsOn: Array.isArray(opts.dependsOn) ? opts.dependsOn.slice() : [],
      maxRetries: typeof opts.retries === 'number' ? opts.retries : DEFAULT_MAX_RETRIES,
      retriesUsed: 0,
      status: 'queued',
      createdAt: Date.now(),
      admittedAt: null,
      finishedAt: null,
      jobId: null,
      detail: null,
      resolve: null
    };
    var promise = new Promise(function (resolve) { task.resolve = resolve; });
    tasks.set(taskId, task);
    emit('scheduler:queued', taskId, { priority: priority, dependsOn: task.dependsOn, goal: task.goal });
    scheduleTick();
    return { taskId: taskId, priority: priority, promise: promise };
  }

  function cancel(taskId) {
    var task = tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'queued') { finalize(task, 'cancelled', { reason: 'cancelled before admission' }); return true; }
    if (task.status === 'admitted' || task.status === 'running') {
      return task.jobId ? !!JOBS.cancelJob(task.jobId) : false; // outcome arrives via the job:cancelled listener
    }
    return false; // already terminal
  }

  function snapshotOf(task) {
    return {
      id: task.id, goal: task.goal, priority: task.priority, status: task.status,
      dependsOn: task.dependsOn.slice(), jobId: task.jobId, retriesUsed: task.retriesUsed,
      createdAt: task.createdAt, admittedAt: task.admittedAt, finishedAt: task.finishedAt, detail: task.detail
    };
  }

  function getTask(taskId) {
    var t = tasks.get(taskId);
    return t ? snapshotOf(t) : null;
  }

  function list() { return Array.from(tasks.values()).map(snapshotOf); }

  function report() {
    var counts = { queued: 0, admitted: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    tasks.forEach(function (t) { counts[t.status] = (counts[t.status] || 0) + 1; });
    return { maxConcurrent: config.maxConcurrent, total: tasks.size, counts: counts };
  }

  function configure(patch) {
    if (patch && typeof patch.maxConcurrent === 'number' && patch.maxConcurrent > 0) {
      config.maxConcurrent = Math.floor(patch.maxConcurrent);
      scheduleTick();
    }
    return Object.assign({}, config);
  }

  return { schedule: schedule, cancel: cancel, getTask: getTask, list: list, report: report, configure: configure };
})();
