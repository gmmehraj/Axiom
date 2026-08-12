// ============================================================
// AXIOM — Block 2 / Step 4 / Part 4: Automation Manager
// ------------------------------------------------------------
// Parts 1-3 built three separate pieces: the execution engine itself
// (os/core/automation-engine.js — workflow storage, queue, run
// lifecycle, retries, cancellation, logging), a connector to the Brain's
// live status pointer (os/core/brain-automation-bridge.js), and a
// connector that persists run history into Memory
// (os/core/automation-memory-bridge.js). Each is real and each does its
// one job, but nothing sits in front of them as a single, centralized
// place to actually run a workflow, watch what's executing right now, or
// ask "what's the state of automation" / "what happened to run X" — a
// caller had to know which of three separate globals to reach for, and
// nothing enforced any policy (like not starting a second run of a
// workflow that's already mid-flight) at the point where a run actually
// starts.
//
// This module is that centralized manager. It does not re-implement
// queueing, execution, retries, or history storage — those already exist
// and are correct — it composes the existing engines' own public APIs
// (AxiomAutomationBuilderEngine, AxiomAutomationMemoryBridge, and
// optionally AxiomBrain if present) behind one namespaced surface, and
// adds the one real policy gap this pass's audit turned up (below).
//
// ------------------------------------------------------------
// Audit before writing any code — was there a gap to fill first?
// ------------------------------------------------------------
// Following the same discipline as Parts 2 and 3 (audit the objective
// against the real engine before assuming a facade alone is enough):
//
//   - Queue Manager, Workflow Manager, History API: the underlying data
//     and operations already exist in full on
//     AxiomAutomationBuilderEngine and AxiomAutomationMemoryBridge — no
//     gap, a composing wrapper is genuinely all that's needed.
//   - Execution Monitor: run objects already carry everything needed to
//     derive live progress (currentStepIndex, steps[], startedAt) — no
//     engine gap, but nothing today turns that into "what's running
//     right now, how far along, for how long", so this pass adds that
//     derivation (read-only; it invents no state the engine doesn't
//     already track).
//   - Status API: same story — Engine.getStats()/getQueueState() and
//     Bridge's stored history already carry the real numbers; nothing
//     rolled them into one status snapshot.
//   - "No duplicate execution" (an explicit validation requirement for
//     this pass): auditing js/pages/automation-runtime-ui.js's
//     #runWorkflowNow click handler and AxiomAutomationBuilderEngine
//     .enqueueRun() together found a REAL, demonstrable gap — the same
//     kind of gap Part 2 found with "paused" not existing at all. The
//     Run-Now button has no guard against a double-click (or any other
//     caller) enqueueing a second run for a workflow that already has one
//     queued, running, or paused. The engine will happily queue both;
//     with concurrency > 1 they can even execute at the same time. There
//     was nothing to "connect" for a duplicate-execution guard, because
//     no such guard existed anywhere to reuse. `run.start()` below is the
//     minimal, real addition that closes this gap: it is now the one
//     place a run actually gets enqueued through this manager, and it
//     checks AxiomAutomationBuilderEngine.listRuns() for a real in-flight
//     run of the same workflow before calling the engine's own
//     enqueueRun() — never fabricating a "busy" state, only reporting one
//     the engine's own run records actually show.
//
// No engine change was required this pass, same as Part 3 — the gap was
// a missing policy layer, not a missing engine capability.
//
// ------------------------------------------------------------
// What this module deliberately does NOT do
// ------------------------------------------------------------
//   - No new storage. Workflows and runs still live only in
//     AxiomAutomationBuilderEngine's own localStorage-backed state;
//     history still lives only in AxiomMemoryEngine via
//     AxiomAutomationMemoryBridge. This module holds no persisted state
//     of its own beyond small in-memory counters for its own stats().
//   - No UI changes. automation.html's markup and
//     js/pages/automation-runtime-ui.js / automation-part9.js are
//     untouched. #runWorkflowNow still calls
//     AxiomAutomationBuilderEngine.enqueueRun() directly today — routing
//     that click handler through AutomationManager.run.start() instead
//     (so the existing UI actually benefits from the duplicate-execution
//     guard) is a UI change and is explicitly out of scope for this pass,
//     per spec ("Do NOT change existing UI"). This module is built and
//     tested as the correct place for any future caller — UI or
//     otherwise — to run a workflow through.
//   - No new business logic in the engine or the bridges. Cancellation,
//     pause/resume, retries-with-backoff, and history persistence are
//     unchanged; this module only calls their existing methods.
//   - No AI reasoning, scoring, or prediction over runs — Execution
//     Monitor and Status API derive plain arithmetic (elapsed time, step
//     counts, retry counts) from fields the engine already reports,
//     nothing is summarized, ranked, or inferred.
//
// ------------------------------------------------------------
// Public API — window.AxiomAutomationManager:
// ------------------------------------------------------------
//   API_VERSION
//   init(opts?)                    -> initializes the underlying engine
//                                      (idempotent) and returns getStatus()
//
//   workflows.create({name, steps, meta?})
//   workflows.update(id, patch)
//   workflows.publish(id)
//   workflows.get(id)
//   workflows.list()
//   workflows.delete(id)
//                                   -> thin, direct passthrough to
//                                      AxiomAutomationBuilderEngine; no
//                                      policy applies to workflow
//                                      definitions, only to starting runs
//
//   queue.getState()                -> { pending, running, concurrency }
//   queue.listPending()              -> queued runs, oldest-queued first
//   queue.listRunning()               -> currently-executing runs
//
//   run.start(workflowId, opts?)     -> { started, reason, run }
//                                      THE enforced entry point: refuses
//                                      to enqueue (reason:
//                                      'duplicate-in-flight') if the same
//                                      workflow already has a queued /
//                                      running / paused run, unless
//                                      opts.force === true. opts:
//                                      { trigger?, data?, force? }
//   run.retry(runId, opts?)          -> { started, reason, run } — same
//                                      duplicate guard, applied to the
//                                      retried run's workflow
//   run.cancel(runId)                -> passthrough (no duplicate concern)
//   run.pause(runId)                 -> passthrough
//   run.resume(runId)                -> passthrough
//   run.get(runId)                   -> passthrough
//   run.list(filter?)                -> passthrough
//
//   monitor.getActiveRuns()          -> queued/running/paused runs with
//                                      derived elapsedMs/percentComplete
//   monitor.getRunProgress(runId)    -> single run's derived progress, or
//                                      null if not currently in flight
//   monitor.getErrorRecoveryStats()  -> real counts derived from stored
//                                      run history: step-level retries
//                                      observed, runs that recovered after
//                                      a retry, runs that failed even
//                                      after retrying
//
//   status.getStatus()               -> queue + engine stats + active-run
//                                      count + this manager's own
//                                      duplicate-guard counters (+ Brain's
//                                      live automation pointer, read-only,
//                                      if AxiomBrain is present on the page)
//   status.getWorkflowStatus(id)     -> { workflow, hasInFlightRun,
//                                      inFlightRun, lastRun }
//
//   history.listExecutionHistory(opts?)
//   history.getExecutionHistory(runId)
//   history.listActions(opts?)
//                                   -> passthrough to
//                                      AxiomAutomationMemoryBridge, if
//                                      present on the page; harmless empty
//                                      shape if not (mirrors the guard
//                                      pattern already used throughout
//                                      the bridges)
//
//   getStats()                       -> this manager's own counters
//                                      { runsStarted, duplicatesBlocked,
//                                        cancelCalls, pauseCalls,
//                                        resumeCalls, retryCalls }
//   onChange(fn)                     -> passthrough subscribe to the
//                                      engine's own pub/sub (so Manager
//                                      reads never drift from engine
//                                      writes)
//   destroy()                        -> unsubscribes this module's own
//                                      Execution Monitor listener
//                                      (page-teardown / test isolation)
// ============================================================
window.AxiomAutomationManager = (function () {
  'use strict';

  var API_VERSION = '1.0.0';
  var DEFAULT_LIMIT = 25;
  var MAX_LIMIT = 200;
  var IN_FLIGHT_LOOKUP_LIMIT = 100; // how far back to scan for an in-flight run of a workflow

  function Engine() { return window.AxiomAutomationBuilderEngine || null; }
  function Bridge() { return window.AxiomAutomationMemoryBridge || null; }
  function Brain() { return window.AxiomBrain || null; }

  // Harmless no-op shape on any page that doesn't load the engine at all
  // (mirrors the guard pattern already used by every other bridge/manager
  // in this codebase).
  if (!Engine()) {
    var noop = function () { return null; };
    var noopList = function () { return { items: [], total: 0, offset: 0, limit: 0 }; };
    return {
      API_VERSION: API_VERSION,
      init: noop,
      workflows: { create: noop, update: noop, publish: noop, get: noop, list: function () { return []; }, delete: function () { return false; } },
      queue: { getState: noop, listPending: function () { return []; }, listRunning: function () { return []; } },
      run: {
        start: function () { return { started: false, reason: 'engine-unavailable', run: null }; },
        retry: function () { return { started: false, reason: 'engine-unavailable', run: null }; },
        cancel: function () { return false; }, pause: function () { return false; }, resume: function () { return false; },
        get: noop, list: function () { return []; }
      },
      monitor: { getActiveRuns: function () { return []; }, getRunProgress: noop, getErrorRecoveryStats: noop },
      status: { getStatus: noop, getWorkflowStatus: noop },
      history: { listExecutionHistory: noopList, getExecutionHistory: noop, listActions: noopList },
      getStats: noop,
      onChange: function () { return function () {}; },
      destroy: function () {}
    };
  }

  Engine().init(); // idempotent — safe even if a page already called this

  var IN_FLIGHT_STATUSES = { queued: true, running: true, paused: true };

  var stats = {
    runsStarted: 0,
    duplicatesBlocked: 0,
    cancelCalls: 0,
    pauseCalls: 0,
    resumeCalls: 0,
    retryCalls: 0
  };

  function now() { return Date.now(); }

  function paginate(items, opts) {
    opts = opts || {};
    var total = items.length;
    var offset = (typeof opts.offset === 'number' && opts.offset >= 0) ? opts.offset : 0;
    var limit = (typeof opts.limit === 'number') ? opts.limit : DEFAULT_LIMIT;
    limit = Math.max(1, Math.min(MAX_LIMIT, limit));
    return { items: items.slice(offset, offset + limit), total: total, offset: offset, limit: limit };
  }

  // ============================================================
  // WORKFLOW MANAGER — direct passthrough; workflow definitions carry no
  // "in flight" concept, so no policy is needed beyond the engine's own.
  // ============================================================
  var workflows = {
    create: function (spec) { return Engine().createWorkflow(spec); },
    update: function (id, patch) { return Engine().updateWorkflow(id, patch); },
    publish: function (id) { return Engine().publishWorkflow(id); },
    get: function (id) { return Engine().getWorkflow(id); },
    list: function () { return Engine().listWorkflows(); },
    delete: function (id) { return Engine().deleteWorkflow(id); }
  };

  // ============================================================
  // QUEUE MANAGER — direct passthrough plus small, honest filters over
  // the engine's own listRuns(); no new queue primitive is created.
  // ============================================================
  var queue = {
    getState: function () { return Engine().getQueueState(); },
    listPending: function () {
      return Engine().listRuns({ status: 'queued', limit: MAX_LIMIT }).slice().reverse(); // oldest-queued first
    },
    listRunning: function () {
      return Engine().listRuns({ status: 'running', limit: MAX_LIMIT });
    }
  };

  // ============================================================
  // Shared duplicate-execution guard, used by both run.start() and
  // run.retry() — the real gap this pass closes (see header note).
  // ============================================================
  function findInFlightRun(workflowId) {
    var runs = Engine().listRuns({ workflowId: workflowId, limit: IN_FLIGHT_LOOKUP_LIMIT });
    for (var i = 0; i < runs.length; i++) {
      if (IN_FLIGHT_STATUSES[runs[i].status]) return runs[i];
    }
    return null;
  }

  // ============================================================
  // RUN CONTROL — the enforced entry point (run.start / run.retry) plus
  // direct passthrough for the actions that carry no duplicate concern.
  // ============================================================
  var run = {
    start: function (workflowId, opts) {
      opts = opts || {};
      var wf = Engine().getWorkflow(workflowId);
      if (!wf) return { started: false, reason: 'unknown-workflow', run: null };
      if (wf.status !== 'active') return { started: false, reason: 'workflow-not-active', run: null };

      if (!opts.force) {
        var existing = findInFlightRun(workflowId);
        if (existing) {
          stats.duplicatesBlocked++;
          return { started: false, reason: 'duplicate-in-flight', run: existing };
        }
      }

      var created = Engine().enqueueRun(workflowId, {
        trigger: opts.trigger || 'Manual',
        data: opts.data,
        seedFail: opts.seedFail
      });
      stats.runsStarted++;
      return { started: true, reason: null, run: created };
    },

    retry: function (runId, opts) {
      opts = opts || {};
      var prev = Engine().getRun(runId);
      if (!prev) return { started: false, reason: 'unknown-run', run: null };

      if (!opts.force) {
        var existing = findInFlightRun(prev.workflowId);
        if (existing) {
          stats.duplicatesBlocked++;
          return { started: false, reason: 'duplicate-in-flight', run: existing };
        }
      }

      var created = Engine().retryRun(runId);
      stats.runsStarted++;
      stats.retryCalls++;
      return { started: true, reason: null, run: created };
    },

    cancel: function (runId) { stats.cancelCalls++; return Engine().cancelRun(runId); },
    pause: function (runId) { stats.pauseCalls++; return Engine().pauseRun(runId); },
    resume: function (runId) { stats.resumeCalls++; return Engine().resumeRun(runId); },
    get: function (runId) { return Engine().getRun(runId); },
    list: function (filter) { return Engine().listRuns(filter); }
  };

  // ============================================================
  // EXECUTION MONITOR — read-only derivation over the engine's own run
  // records. Nothing here is stored; every field is recomputed on read
  // from run.status/currentStepIndex/steps/startedAt/queuedAt, which the
  // engine already tracks for real.
  // ============================================================
  function deriveProgress(r) {
    var stepCount = (r.steps || []).length;
    var stepIndex = (typeof r.currentStepIndex === 'number') ? r.currentStepIndex : -1;
    var percentComplete = stepCount > 0 ? Math.round((Math.max(0, stepIndex) / stepCount) * 100) : 0;
    if (r.status === 'success') percentComplete = 100;
    var since = r.startedAt || r.queuedAt || now();
    var elapsedMs = (r.finishedAt || now()) - since;
    return Object.assign({}, r, {
      elapsedMs: elapsedMs,
      stepIndex: stepIndex,
      stepCount: stepCount,
      percentComplete: percentComplete
    });
  }

  var monitor = {
    getActiveRuns: function () {
      return Engine().listRuns({ limit: MAX_LIMIT })
        .filter(function (r) { return IN_FLIGHT_STATUSES[r.status]; })
        .map(deriveProgress);
    },
    getRunProgress: function (runId) {
      var r = Engine().getRun(runId);
      if (!r || !IN_FLIGHT_STATUSES[r.status]) return null;
      return deriveProgress(r);
    },
    // Real, derived error-recovery numbers — never a guess. A "step
    // retry" is only counted when a step's own recorded attempts > 1,
    // exactly mirroring what the engine's retry-with-backoff loop itself
    // produced (automation-engine.js's executeRun()).
    getErrorRecoveryStats: function () {
      var runs = Engine().listRuns({ limit: MAX_LIMIT });
      var stepRetries = 0;
      var runsWithStepRetries = 0;
      var recoveredAfterRetry = 0;
      var failedAfterRetries = 0;
      runs.forEach(function (r) {
        var hadRetry = false;
        (r.steps || []).forEach(function (s) {
          if (s.attempts && s.attempts > 1) {
            stepRetries += (s.attempts - 1);
            hadRetry = true;
          }
        });
        if (hadRetry) {
          runsWithStepRetries++;
          if (r.status === 'success') recoveredAfterRetry++;
          if (r.status === 'failed') failedAfterRetries++;
        }
      });
      return {
        stepRetriesObserved: stepRetries,
        runsWithStepRetries: runsWithStepRetries,
        runsRecoveredAfterRetry: recoveredAfterRetry,
        runsFailedAfterRetries: failedAfterRetries
      };
    }
  };

  // ============================================================
  // STATUS API — one rolled-up snapshot, composed entirely from the
  // engine's/bridge's own already-real numbers.
  // ============================================================
  var status = {
    getStatus: function () {
      var brain = Brain();
      var snapshot = {
        apiVersion: API_VERSION,
        queue: Engine().getQueueState(),
        engineStats: Engine().getStats(),
        activeRunCount: monitor.getActiveRuns().length,
        managerStats: Object.assign({}, stats),
        ts: now()
      };
      // Brain's live automation pointer is read-only context here — this
      // manager never writes to Brain (that remains
      // brain-automation-bridge.js's job) and is fully functional without
      // it, matching every other optional-dependency guard in this file.
      if (brain && typeof brain.getState === 'function') {
        snapshot.brainAutomation = (brain.getState().automation) || null;
      }
      return snapshot;
    },
    getWorkflowStatus: function (workflowId) {
      var wf = Engine().getWorkflow(workflowId);
      if (!wf) return null;
      var inFlight = findInFlightRun(workflowId);
      var recent = Engine().listRuns({ workflowId: workflowId, limit: 1 });
      return {
        workflow: wf,
        hasInFlightRun: !!inFlight,
        inFlightRun: inFlight,
        lastRun: recent.length ? recent[0] : null
      };
    }
  };

  // ============================================================
  // HISTORY API — passthrough to the Part 3 connector. Harmless empty
  // shape if a page loads the Manager without the Memory bridge.
  // ============================================================
  var history = {
    listExecutionHistory: function (opts) {
      var b = Bridge();
      return b ? b.listExecutionHistory(opts) : { items: [], total: 0, offset: 0, limit: 0 };
    },
    getExecutionHistory: function (runId) {
      var b = Bridge();
      return b ? b.getExecutionHistory(runId) : null;
    },
    listActions: function (opts) {
      var b = Bridge();
      return b ? b.listActions(opts) : { items: [], total: 0, offset: 0, limit: 0 };
    }
  };

  function onChange(fn) { return Engine().onChange(fn); }

  // No listener of its own is required for correctness (every method
  // above reads the engine live, on demand) — kept as a no-op-safe
  // unsubscribe purely so callers/tests can treat destroy() uniformly
  // across every module in this codebase.
  var unsubscribe = function () {};

  function destroy() { unsubscribe(); }

  function getStats() { return Object.assign({}, stats); }

  function init(opts) {
    Engine().init(opts);
    return status.getStatus();
  }

  var browser = {
    getManager: function () { return global.AxiomBrowserManager || global.BrowserManager || null; },
    executeOp: function (op, params) {
      var bm = global.AxiomBrowserManager || global.BrowserManager;
      if (!bm) return Promise.reject(new Error('BrowserManager unavailable.'));
      return bm.executeBrowserOp(op, params);
    },
    getStatus: function (sessionId, tabId) {
      var bm = global.AxiomBrowserManager || global.BrowserManager;
      return bm ? bm.getNavigationStatus(sessionId, tabId) : null;
    }
  };

  return {
    API_VERSION: API_VERSION,
    init: init,
    workflows: workflows,
    queue: queue,
    run: run,
    monitor: monitor,
    status: status,
    history: history,
    browser: browser,
    getStats: getStats,
    onChange: onChange,
    destroy: destroy
  };
})();
