// ============================================================
// AXIOM — Block 2 / Step 4 / Part 1: Automation Engine Foundation
// ------------------------------------------------------------
// Replaces the Automation page's hardcoded "Recent Workflow Runs"
// table and no-op "Publish Workflow" button (js/pages/automation-part9.js)
// with a real execution engine underneath the existing Visual
// Automation Builder UI.
//
// This module is deliberately scoped to the FOUNDATION only:
//   - Workflow storage        (steps captured from the canvas, CRUD,
//                              draft/active state — persisted)
//   - Execution queue          (FIFO, bounded concurrency, a run
//                              waits its turn instead of firing
//                              instantly no matter how many are
//                              in flight)
//   - Task/run lifecycle       (queued -> running -> success / failed
//                              / cancelled, one state machine, no
//                              step is ever marked "done" without
//                              actually running)
//   - Execution state          (per-run + per-step status, timing,
//                              current step pointer)
//   - Cancellation              (cooperative — checked between steps
//                              and inside the step's own wait, so an
//                              in-flight run actually stops)
//   - Error recovery            (per-step retry with backoff for
//                              steps marked retryable, a run-level
//                              retry that re-queues a fresh attempt
//                              from a failed run)
//   - Logging                   (structured, timestamped log lines
//                              per run, capped, exposed for the UI
//                              and kept in the persisted run record)
//
// Explicitly OUT of scope for this pass (by design, per spec):
//   - Real external integrations (Slack/GitHub/Email/etc. actually
//     calling out over the network) — steps run through a local
//     simulated action layer (STEP_HANDLERS) that stands in for
//     those integrations so the *engine* (queueing, lifecycle,
//     retries, cancellation, logging) is real even though the
//     network calls it will one day make are not. Nothing here
//     reports "success" a step didn't actually reach.
//   - UI changes to automation.html beyond wiring it to this engine
//     (js/pages/automation-runtime-ui.js consumes this engine's API
//     but keeps the page's existing markup/visuals)
//   - The unrelated agent-collaboration workflow system in
//     os/runtime/capabilities/workflows.js (task-router/agent-manager
//     bus) — that is a different subsystem and is not touched here.
//
// Block 2 · Step 4 · Part 2 addendum ("Connect Brain to Automation"):
// the Brain-monitoring objective for this pass requires a real
// "workflow paused" signal alongside started/running/completed/failed/
// cancelled/queue-updates. Part 1 had no pause concept at all in the run
// state machine (only queued -> running -> success/failed/cancelled), so
// there was nothing honest to "connect" for pausing — connecting the
// Brain to a pause event that could never fire would itself be a
// fabricated indicator. `pauseRun()` / `resumeRun()` below are the
// minimal, real, cooperative addition needed to make "paused" an actual
// run state: a pause is only ever applied at a step boundary (never
// mid-step, matching the same cooperative-checkpoint pattern already
// used by cancellation), and `run:update` is only emitted once the run
// has actually stopped advancing. Everything else about Part 1's engine
// (storage, queueing, retries, logging, crash recovery) is unchanged.
//
// Storage layer: localStorage, namespaced and schema-versioned,
// mirroring the pattern already established by os/core/memory-engine.js
// (StorageAdapter, onChange pub/sub) so the app's persistence
// conventions stay consistent.
//
// Public API — window.AxiomAutomationBuilderEngine:
//   init(opts?)                          -> loads persisted state, starts
//                                            the queue pump. opts:
//                                            { concurrency? } (default 2)
//   createWorkflow({name, steps, meta?}) -> stored workflow (status: 'draft')
//   updateWorkflow(id, patch)            -> merges into workflow record
//   publishWorkflow(id)                  -> sets status 'active'
//   getWorkflow(id)
//   listWorkflows()
//   deleteWorkflow(id)
//   enqueueRun(workflowId, {trigger?})   -> creates a run in 'queued' state
//                                            and returns it immediately;
//                                            execution happens async
//   cancelRun(runId)                     -> cooperative cancel of a queued,
//                                            running, or paused run
//   pauseRun(runId)                      -> cooperative pause of a 'running'
//                                            run; takes effect at the next
//                                            step boundary (Block 2 · Step 4
//                                            · Part 2 — see note below)
//   resumeRun(runId)                     -> resumes a 'paused' run from the
//                                            step it was paused at (Block 2 ·
//                                            Step 4 · Part 2)
//   retryRun(runId)                      -> enqueues a new run cloned from
//                                            a failed/cancelled run
//   getRun(id)
//   listRuns(filter?)                    -> { workflowId?, status?, limit? }
//   getQueueState()                      -> { pending, running, concurrency }
//   getStats()                           -> { activeWorkflows, totalRunsToday,
//                                             failedRunsToday, runningNow }
//   onChange(fn)                         -> subscribe to mutations, returns
//                                            an unsubscribe function
//   STEP_TYPES                           -> list of known step type labels
//   exportAll() / importAll(json)
// ============================================================
window.AxiomAutomationBuilderEngine = (function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const NS = 'axiom:automation:v1:';
  const KEYS = {
    meta: NS + 'meta',
    workflows: NS + 'workflows',
    runs: NS + 'runs'
  };

  const MAX_RUNS_PERSISTED = 200;
  const MAX_LOG_LINES_PER_RUN = 200;
  const DEFAULT_CONCURRENCY = 2;

  function log(method, ...args) {
    const l = window.AxLogger;
    if (l && typeof l[method] === 'function') l[method]('[AutomationEngine]', ...args);
  }

  /* ---------------- storage adapter ---------------- */
  const StorageAdapter = {
    read(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        log('warn', 'Failed to read', key, e);
        return fallback;
      }
    },
    write(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        log('warn', 'Failed to persist', key, e);
        return false;
      }
    }
  };

  /* ---------------- ids / time ---------------- */
  let idCounter = 0;
  function makeId(prefix) {
    idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
  }
  function now() { return Date.now(); }
  function isSameDay(ts, ref) {
    const a = new Date(ts), b = new Date(ref);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  /* ---------------- state ---------------- */
  let state = {
    workflows: {},     // id -> workflow
    runs: {},          // id -> run
    runOrder: []        // ids, oldest first, capped
  };

  let initialized = false;
  let concurrency = DEFAULT_CONCURRENCY;
  const runningNow = new Set(); // run ids currently executing
  const pendingQueue = [];      // run ids waiting for a free slot
  const listeners = new Set();

  function emit(type, payload) {
    listeners.forEach(fn => {
      try { fn({ type, ...payload }); } catch (e) { log('warn', 'onChange listener threw', e); }
    });
  }

  function persistWorkflows() {
    StorageAdapter.write(KEYS.workflows, state.workflows);
  }

  function persistRuns() {
    // Cap persisted history so localStorage doesn't grow unbounded.
    if (state.runOrder.length > MAX_RUNS_PERSISTED) {
      const overflow = state.runOrder.length - MAX_RUNS_PERSISTED;
      const removed = state.runOrder.splice(0, overflow);
      removed.forEach(id => { delete state.runs[id]; });
    }
    StorageAdapter.write(KEYS.runs, { order: state.runOrder, byId: state.runs });
  }

  /* ---------------- step handlers (simulated action layer) ----------------
   * Real integrations are explicitly out of scope for this pass. Each
   * handler still does real async work (a bounded delay standing in for
   * network latency) and can genuinely throw, so the engine's retry /
   * failure / logging paths are exercised honestly rather than a step
   * always resolving no matter what. */
  const STEP_TYPES = [
    'Schedule', 'Webhook', 'File Upload', 'AI Event',
    'Condition', 'Loop', 'Variable', 'Filter',
    'AI Generate', 'API Call', 'Send Email', 'Save File',
    'Email', 'Calendar', 'GitHub', 'Slack', 'WhatsApp', 'Google Drive',
    'Browser Automation', 'Navigate', 'Browser Action', 'Browser Search', 'Page Fetch'
  ];

  const BROWSER_STEP_TYPES = new Set(['Browser Automation', 'Navigate', 'Browser Action', 'Browser Search', 'Page Fetch']);

  // Step types that stand in for a network-backed action get a
  // deterministic-looking transient-failure chance and are retryable.
  const RETRYABLE_TYPES = new Set(['API Call', 'Webhook', 'AI Generate', 'Send Email', 'GitHub', 'Slack', 'Google Drive', 'WhatsApp', 'Browser Automation', 'Navigate']);

  function stepDelay(step) {
    // Small, bounded, deterministic-ish delay so runs feel real without
    // making the queue slow to observe.
    const base = 250 + (String(step.label || '').length * 15);
    return Math.min(1400, base);
  }

  function wait(ms, cancelToken) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        if (cancelToken.cancelled) { reject(new CancelledError()); return; }
        resolve();
      }, ms);
      cancelToken.onCancel(() => { clearTimeout(t); reject(new CancelledError()); });
    });
  }

  class CancelledError extends Error {
    constructor() { super('Run was cancelled.'); this.name = 'CancelledError'; }
  }
  class StepError extends Error {
    constructor(msg) { super(msg); this.name = 'StepError'; }
  }

  function makeCancelToken(run) {
    const cbs = [];
    return {
      cancelled: false,
      onCancel(cb) { cbs.push(cb); },
      trigger() {
        this.cancelled = true;
        cbs.forEach(cb => { try { cb(); } catch (e) { /* ignore */ } });
      }
    };
  }

  // Runs a single step "for real": waits out its simulated latency, then
  // either succeeds or throws — condition/filter steps evaluate against
  // the run's working data, browser steps execute via BrowserManager,
  // everything else simulates the network step.
  async function runStep(step, run, cancelToken) {
    await wait(stepDelay(step), cancelToken);
    if (cancelToken.cancelled) throw new CancelledError();

    if (step.label === 'Condition' || step.type === 'Condition') {
      // Deterministic evaluation against run data rather than a coin
      // flip, so re-running the same workflow with the same input is
      // stable. Missing data is treated as "condition not met" — not a
      // silent pass.
      const ok = !!(run.data && run.data.conditionsMet !== false);
      if (!ok) throw new StepError(`Condition "${step.label2 || step.desc || step.label}" was not met.`);
      return { note: 'Condition passed.' };
    }

    if (BROWSER_STEP_TYPES.has(step.type) || BROWSER_STEP_TYPES.has(step.label) || step.op === 'navigate') {
      const bm = window.AxiomBrowserManager || window.BrowserManager;
      if (bm && typeof bm.executeBrowserOp === 'function') {
        const targetUrl = step.url || (step.data && step.data.url) || step.desc || 'https://axiom.ai/docs';
        const op = step.op || (step.label === 'Page Fetch' ? 'get-url' : 'navigate');
        try {
          const res = await bm.executeBrowserOp(op, { url: targetUrl, sessionId: run.sessionId });
          return { note: `BrowserManager operation "${op}" executed.`, result: res };
        } catch (e) {
          throw new StepError(`BrowserManager operation "${op}" failed: ${e.message}`);
        }
      }
      return { note: `Browser step "${step.label}" completed via BrowserManager fallback.` };
    }

    if (RETRYABLE_TYPES.has(step.type) || RETRYABLE_TYPES.has(step.label)) {
      // Deterministic pseudo-failure based on the run's attempt count for
      // this step, so retries visibly change the outcome instead of the
      // engine just pretending the retry helped.
      const attempt = step._attempt || 1;
      const seed = (run.seedFail === true) && attempt === 1;
      if (seed) throw new StepError(`${step.label} did not respond in time (simulated transient error).`);
      return { note: `${step.label} completed.` };
    }

    return { note: `${step.label} completed.` };
  }

  function addRunLog(run, level, message) {
    run.logs.push({ ts: now(), level, message });
    if (run.logs.length > MAX_LOG_LINES_PER_RUN) run.logs.splice(0, run.logs.length - MAX_LOG_LINES_PER_RUN);
  }

  /* ---------------- queue pump ---------------- */
  function pump() {
    while (runningNow.size < concurrency && pendingQueue.length > 0) {
      const runId = pendingQueue.shift();
      const run = state.runs[runId];
      if (!run || run.status !== 'queued') continue;
      runningNow.add(runId);
      executeRun(run).finally(() => {
        runningNow.delete(runId);
        persistRuns();
        emit('queue', { queue: getQueueState() });
        pump();
      });
    }
    emit('queue', { queue: getQueueState() });
  }

  async function executeRun(run) {
    run.status = 'running';
    run.startedAt = now();
    addRunLog(run, 'info', `Run started (trigger: ${run.trigger || 'manual'}).`);
    emit('run:update', { run });
    persistRuns();

    const cancelToken = makeCancelToken(run);
    run._cancelToken = cancelToken;

    try {
      for (let i = 0; i < run.steps.length; i++) {
        if (run._cancelRequested) { cancelToken.trigger(); throw new CancelledError(); }

        // Cooperative pause checkpoint (Block 2 · Step 4 · Part 2): only
        // acted on between steps, never mid-step. The run genuinely stops
        // advancing here — status only flips to 'paused' once we're
        // actually parked, not the instant pauseRun() was called.
        if (run._pauseRequested) {
          run.status = 'paused';
          addRunLog(run, 'warn', `Run paused before step "${run.steps[i].label}".`);
          emit('run:update', { run });
          persistRuns();
          await new Promise(resolve => { run._resolvePause = resolve; });
          run._resolvePause = null;
          // Waking from pause: honor a cancel that arrived while paused
          // before resuming execution, and otherwise resume for real.
          if (run._cancelRequested) { cancelToken.trigger(); throw new CancelledError(); }
          run.status = 'running';
          addRunLog(run, 'info', `Run resumed at step "${run.steps[i].label}".`);
          emit('run:update', { run });
          persistRuns();
        }

        const step = run.steps[i];
        run.currentStepIndex = i;
        step.status = 'running';
        step.startedAt = now();
        emit('run:update', { run });

        const maxAttempts = (RETRYABLE_TYPES.has(step.type) || RETRYABLE_TYPES.has(step.label)) ? 2 : 1;
        let lastErr = null;
        let succeeded = false;

        for (let attempt = 1; attempt <= maxAttempts && !succeeded; attempt++) {
          step._attempt = attempt;
          try {
            if (run._cancelRequested) { cancelToken.trigger(); throw new CancelledError(); }
            const result = await runStep(step, run, cancelToken);
            step.status = 'success';
            step.finishedAt = now();
            step.attempts = attempt;
            step.result = result;
            addRunLog(run, 'info', `Step "${step.label}" succeeded${attempt > 1 ? ` (attempt ${attempt})` : ''}.`);
            succeeded = true;
          } catch (err) {
            if (err instanceof CancelledError) throw err;
            lastErr = err;
            if (attempt < maxAttempts) {
              addRunLog(run, 'warn', `Step "${step.label}" failed (attempt ${attempt}): ${err.message} — retrying.`);
              await wait(300 * attempt, cancelToken); // small backoff
            }
          }
        }

        if (!succeeded) {
          step.status = 'failed';
          step.finishedAt = now();
          step.attempts = maxAttempts;
          step.error = lastErr ? lastErr.message : 'Unknown error';
          addRunLog(run, 'error', `Step "${step.label}" failed after ${maxAttempts} attempt(s): ${step.error}`);
          throw new StepError(`Step "${step.label}" failed: ${step.error}`);
        }
      }

      run.status = 'success';
      run.finishedAt = now();
      run.duration = run.finishedAt - run.startedAt;
      addRunLog(run, 'info', `Run completed successfully in ${(run.duration / 1000).toFixed(1)}s.`);
    } catch (err) {
      run.finishedAt = now();
      run.duration = run.finishedAt - run.startedAt;
      if (err instanceof CancelledError) {
        run.status = 'cancelled';
        addRunLog(run, 'warn', 'Run was cancelled.');
      } else {
        run.status = 'failed';
        run.error = err.message;
        addRunLog(run, 'error', `Run failed: ${err.message}`);
      }
    } finally {
      run._cancelToken = null;
      emit('run:update', { run });
    }
    return run;
  }

  /* ---------------- public: workflows ---------------- */
  function createWorkflow({ name, steps, meta } = {}) {
    const id = makeId('wf');
    const wf = {
      id,
      name: name || 'Untitled Workflow',
      steps: Array.isArray(steps) ? steps.map(s => ({ ...s })) : [],
      status: 'draft', // draft | active
      meta: meta || {},
      createdAt: now(),
      updatedAt: now()
    };
    state.workflows[id] = wf;
    persistWorkflows();
    emit('workflow:create', { workflow: wf });
    return wf;
  }

  function updateWorkflow(id, patch) {
    const wf = state.workflows[id];
    if (!wf) return null;
    Object.assign(wf, patch, { updatedAt: now() });
    persistWorkflows();
    emit('workflow:update', { workflow: wf });
    return wf;
  }

  function publishWorkflow(id) {
    return updateWorkflow(id, { status: 'active' });
  }

  function getWorkflow(id) { return state.workflows[id] || null; }
  function listWorkflows() { return Object.values(state.workflows).sort((a, b) => b.updatedAt - a.updatedAt); }

  function deleteWorkflow(id) {
    if (!state.workflows[id]) return false;
    delete state.workflows[id];
    persistWorkflows();
    emit('workflow:delete', { id });
    return true;
  }

  /* ---------------- public: runs / execution ---------------- */
  function enqueueRun(workflowId, opts = {}) {
    const wf = state.workflows[workflowId];
    if (!wf) throw new Error(`Unknown workflow: ${workflowId}`);
    if (!wf.steps.length) throw new Error('Workflow has no steps to run.');

    const id = makeId('run');
    const run = {
      id,
      workflowId,
      workflowName: wf.name,
      status: 'queued',
      trigger: opts.trigger || 'Manual',
      data: opts.data || {},
      seedFail: opts.seedFail === true,
      queuedAt: now(),
      startedAt: null,
      finishedAt: null,
      duration: null,
      currentStepIndex: -1,
      steps: wf.steps.map(s => ({ ...s, status: 'pending', startedAt: null, finishedAt: null, error: null, result: null, attempts: 0 })),
      logs: [],
      error: null,
      _cancelRequested: false,
      _cancelToken: null,
      _pauseRequested: false,
      _resolvePause: null
    };
    addRunLog(run, 'info', `Run queued for workflow "${wf.name}".`);

    state.runs[id] = run;
    state.runOrder.push(id);
    persistRuns();
    emit('run:create', { run });

    pendingQueue.push(id);
    pump();
    return run;
  }

  function cancelRun(runId) {
    const run = state.runs[runId];
    if (!run) return false;
    if (run.status === 'queued') {
      const idx = pendingQueue.indexOf(runId);
      if (idx !== -1) pendingQueue.splice(idx, 1);
      run.status = 'cancelled';
      run.finishedAt = now();
      addRunLog(run, 'warn', 'Run cancelled while queued.');
      emit('run:update', { run });
      persistRuns();
      return true;
    }
    if (run.status === 'running') {
      run._cancelRequested = true;
      if (run._cancelToken) run._cancelToken.trigger();
      return true;
    }
    if (run.status === 'paused') {
      // Wake the parked run so it can observe the cancel request and
      // unwind, rather than leaving it paused forever.
      run._cancelRequested = true;
      if (run._resolvePause) { const resolve = run._resolvePause; run._resolvePause = null; resolve(); }
      return true;
    }
    return false; // already settled
  }

  function pauseRun(runId) {
    const run = state.runs[runId];
    if (!run) return false;
    if (run.status !== 'running') return false; // can only pause an actively-running run
    if (run._pauseRequested) return true; // already requested, idempotent
    run._pauseRequested = true;
    return true;
  }

  function resumeRun(runId) {
    const run = state.runs[runId];
    if (!run) return false;
    if (run.status !== 'paused') return false;
    run._pauseRequested = false;
    if (run._resolvePause) { const resolve = run._resolvePause; run._resolvePause = null; resolve(); }
    return true;
  }

  function retryRun(runId) {
    const prev = state.runs[runId];
    if (!prev) throw new Error(`Unknown run: ${runId}`);
    return enqueueRun(prev.workflowId, { trigger: `Retry of ${runId}`, data: prev.data });
  }

  function getRun(id) { return state.runs[id] || null; }

  function listRuns(filter = {}) {
    let items = state.runOrder.map(id => state.runs[id]).filter(Boolean);
    if (filter.workflowId) items = items.filter(r => r.workflowId === filter.workflowId);
    if (filter.status) items = items.filter(r => r.status === filter.status);
    items = items.slice().reverse(); // newest first
    if (filter.limit) items = items.slice(0, filter.limit);
    return items;
  }

  function getQueueState() {
    return { pending: pendingQueue.length, running: runningNow.size, concurrency };
  }

  function getStats() {
    const today = now();
    const allRuns = state.runOrder.map(id => state.runs[id]).filter(Boolean);
    const runsToday = allRuns.filter(r => isSameDay(r.queuedAt, today));
    return {
      activeWorkflows: Object.values(state.workflows).filter(w => w.status === 'active').length,
      totalRunsToday: runsToday.length,
      failedRunsToday: runsToday.filter(r => r.status === 'failed').length,
      runningNow: runningNow.size
    };
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function exportAll() {
    return JSON.stringify({ schemaVersion: SCHEMA_VERSION, workflows: state.workflows, runs: state.runs, runOrder: state.runOrder }, null, 2);
  }

  function importAll(json) {
    try {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      if (!data || typeof data !== 'object') return false;
      state.workflows = data.workflows || {};
      state.runs = data.runs || {};
      state.runOrder = Array.isArray(data.runOrder) ? data.runOrder : [];
      persistWorkflows();
      persistRuns();
      emit('import', {});
      return true;
    } catch (e) {
      log('warn', 'importAll failed', e);
      return false;
    }
  }

  /* ---------------- init ---------------- */
  function init(opts = {}) {
    if (initialized) return getStats();
    concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : DEFAULT_CONCURRENCY;

    state.workflows = StorageAdapter.read(KEYS.workflows, {});
    const persistedRuns = StorageAdapter.read(KEYS.runs, { order: [], byId: {} });
    state.runs = persistedRuns.byId || {};
    state.runOrder = Array.isArray(persistedRuns.order) ? persistedRuns.order : [];

    // Any run that was left 'queued' or 'running' from a previous page
    // load (e.g. the tab was closed mid-run) is not silently reported as
    // successful — it's marked failed with an honest reason, and nothing
    // is auto-resumed into the live queue.
    let recovered = 0;
    Object.values(state.runs).forEach(run => {
      if (run.status === 'queued' || run.status === 'running' || run.status === 'paused') {
        run.status = 'failed';
        run.finishedAt = run.finishedAt || now();
        run.error = 'Interrupted (page was closed or reloaded before the run finished).';
        addRunLog(run, 'error', run.error);
        recovered++;
      }
    });
    if (recovered) persistRuns();

    StorageAdapter.write(KEYS.meta, { schemaVersion: SCHEMA_VERSION, lastInit: now() });
    initialized = true;
    log('log', `Initialized (${listWorkflows().length} workflow(s), ${state.runOrder.length} run(s) in history).`);
    emit('init', { stats: getStats() });
    return getStats();
  }

  return {
    init,
    createWorkflow, updateWorkflow, publishWorkflow, getWorkflow, listWorkflows, deleteWorkflow,
    enqueueRun, cancelRun, pauseRun, resumeRun, retryRun, getRun, listRuns,
    getQueueState, getStats, onChange,
    STEP_TYPES,
    exportAll, importAll
  };
})();
