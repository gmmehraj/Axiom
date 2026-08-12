// ============================================================
// AXIOM AI OS — Milestone 8: Long-Running Job Manager
// ------------------------------------------------------------
// Task 4 asks for background jobs with progress updates,
// cancellation, pause, resume and retry. The Orchestrator already
// runs a plan asynchronously and exposes pause/resume/cancel per
// run; this module is the thin, persisted "job" wrapper around that:
// it survives the caller not awaiting the result (fire-and-forget
// from the router/UI), gives every job a stable id you can poll or
// re-open later in the same tab, and batches progress notifications
// instead of firing one bus event per tiny update (Task 10 —
// performance: event dispatch volume is the actual cost of a chatty
// long-running job, not CPU work).
//
// Jobs are persisted to localStorage (the same lightweight pattern
// planner-store.js and browser-live.js already use) so a job's
// terminal state (completed/failed/cancelled) and summary survive a
// page refresh, even though an in-flight run itself cannot resume
// live orchestration across a full reload — that limitation is
// listed plainly in the deliverable notes rather than papered over.
//
// Public surface — window.AxiomJobManager:
//   .createJob(text | plan, opts?) -> jobRecord (status starts 'running')
//   .getJob(id) -> jobRecord | null
//   .listJobs(limit?) -> jobRecord[]
//   .cancelJob(id) / .pauseJob(id) / .resumeJob(id) -> boolean
//   .retryJob(id) -> jobRecord | null   (re-runs only the failed steps)
// ============================================================
window.AxiomJobManager = (function () {
  'use strict';

  var STORAGE_KEY = 'axiom-jobs';
  var PROGRESS_BATCH_MS = 250; // Task 10: coalesce progress ticks

  function uid() { return 'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function save(jobs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(-100))); }
    catch (e) { AxLogger.warn('[AxiomJobManager] could not persist jobs:', e); }
  }
  function upsert(job) {
    var jobs = load();
    var idx = jobs.findIndex(function (j) { return j.id === job.id; });
    if (idx === -1) jobs.unshift(job); else jobs[idx] = job;
    save(jobs);
  }

  var bus = window.AxiomAgentRuntime && window.AxiomAgentRuntime.bus;
  var ORCH = window.AxiomOrchestrator;
  var PLANNER_INTEL = null; // resolved lazily — file may load in either order

  // In-memory index of live (this-tab, this-session) jobs -> orchestrator
  // runIds, so pause/resume/cancel/retry can reach the live run rather than
  // only the persisted snapshot.
  var live = new Map(); // jobId -> { runId, batchTimer, pendingNotes }

  function emitBatchedProgress(jobId) {
    var l = live.get(jobId);
    if (!l || !l.pendingNotes.length) return;
    var job = load().find(function (j) { return j.id === jobId; });
    if (job) {
      job.lastNotes = l.pendingNotes.slice(-5);
      upsert(job);
    }
    if (bus) bus.emit('job:progress', 'job-manager', { jobId: jobId, notes: l.pendingNotes.slice() });
    l.pendingNotes = [];
  }

  function queueProgress(jobId, note) {
    var l = live.get(jobId);
    if (!l) return;
    l.pendingNotes.push(note);
    if (l.batchTimer) return;
    l.batchTimer = setTimeout(function () {
      l.batchTimer = null;
      emitBatchedProgress(jobId);
    }, PROGRESS_BATCH_MS);
  }

  function createJob(textOrPlan, opts) {
    opts = opts || {};
    if (!ORCH) throw new Error('[AxiomJobManager] AxiomOrchestrator must be loaded first.');
    var planner = window.AxiomTaskPlanner;
    var plan = (typeof textOrPlan === 'string')
      ? (planner ? planner.createExecutionPlan(textOrPlan, opts) : { goal: textOrPlan, steps: [] })
      : textOrPlan;

    var jobId = uid();
    var job = {
      id: jobId, goal: plan.goal, planId: plan.planId || null,
      status: 'running', createdAt: Date.now(), updatedAt: Date.now(),
      progressPct: 0, lastNotes: [], summary: null, error: null
    };
    upsert(job);
    live.set(jobId, { runId: null, batchTimer: null, pendingNotes: [] });

    var offProgress = bus && bus.on('context:progress', function (env) {
      var l = live.get(jobId);
      if (l && env.payload && env.payload.runId === l.runId) queueProgress(jobId, env.payload.note);
    });
    var offStepDone = bus && bus.on('orchestrator:step-completed', function (env) {
      var l = live.get(jobId);
      if (!l || env.payload.runId !== l.runId) return;
      var current = load().find(function (j) { return j.id === jobId; });
      if (current) {
        var total = (window.AxiomOrchestrator.status(l.runId) || { steps: [] }).steps.length || 1;
        var done = (window.AxiomOrchestrator.status(l.runId).steps || []).filter(function (s) { return s.status === 'done'; }).length;
        current.progressPct = Math.round((done / total) * 100);
        current.updatedAt = Date.now();
        upsert(current);
      }
    });

    var started = ORCH.run(plan, opts);
    if (live.has(jobId)) live.get(jobId).runId = started.runId;

    started.promise.then(function (result) {
      if (offProgress) offProgress();
      if (offStepDone) offStepDone();
      var current = load().find(function (j) { return j.id === jobId; }) || job;
      current.status = result.status; // completed | failed | cancelled
      current.progressPct = result.status === 'completed' ? 100 : current.progressPct;
      current.summary = result;
      current.updatedAt = Date.now();
      upsert(current);
      if (bus) bus.emit('job:' + current.status, 'job-manager', { jobId: jobId, summary: result });
      live.delete(jobId);
    }, function (err) {
      if (offProgress) offProgress();
      if (offStepDone) offStepDone();
      var current = load().find(function (j) { return j.id === jobId; }) || job;
      current.status = 'failed';
      current.error = String(err && err.message || err);
      current.updatedAt = Date.now();
      upsert(current);
      if (bus) bus.emit('job:failed', 'job-manager', { jobId: jobId, error: current.error });
      live.delete(jobId);
    });

    return job;
  }

  function getJob(id) { return load().find(function (j) { return j.id === id; }) || null; }
  function listJobs(limit) { return load().slice(0, limit || 50); }

  function cancelJob(id) {
    var l = live.get(id);
    if (!l || !ORCH) return false;
    var ok = ORCH.cancel(l.runId);
    if (ok) { var job = getJob(id); if (job) { job.status = 'cancelled'; upsert(job); } }
    return ok;
  }
  function pauseJob(id) {
    var l = live.get(id);
    if (!l || !ORCH) return false;
    var ok = ORCH.pause(l.runId);
    if (ok) { var job = getJob(id); if (job) { job.status = 'paused'; upsert(job); } }
    return ok;
  }
  function resumeJob(id) {
    var l = live.get(id);
    if (!l || !ORCH) return false;
    var ok = ORCH.resume(l.runId);
    if (ok) { var job = getJob(id); if (job) { job.status = 'running'; upsert(job); } }
    return ok;
  }

  // Re-runs a completed-with-failures job by re-decomposing only the steps
  // that failed last time (identified by clause), so retrying doesn't repeat
  // successful work.
  function retryJob(id) {
    var job = getJob(id);
    if (!job || !job.summary || !job.summary.steps) return null;
    var failedClauses = job.summary.steps.filter(function (s) { return s.status === 'failed'; }).map(function (s) { return s.clause; });
    if (!failedClauses.length) return null;
    return createJob(failedClauses.join(', then '));
  }

  return { createJob: createJob, getJob: getJob, listJobs: listJobs, cancelJob: cancelJob, pauseJob: pauseJob, resumeJob: resumeJob, retryJob: retryJob };
})();
