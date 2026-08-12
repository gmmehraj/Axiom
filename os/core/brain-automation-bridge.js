// ============================================================
// AXIOM — Block 2 / Step 4 / Part 2: Connect the Brain to Automation
// ------------------------------------------------------------
// The Automation Engine Foundation (os/core/automation-engine.js, Block 2 ·
// Step 4 · Part 1) already has a full, real workflow/run lifecycle —
// storage, a bounded-concurrency queue, retries, cancellation, logging —
// exposed via AxiomAutomationBuilderEngine.onChange(). The Brain (os/core/
// axiom-brain.js) already tracks live AI-pipeline state but, before this
// file, had no idea automation workflows existed at all: a workflow could
// run, retry, fail, or get cancelled and the Brain (and every widget that
// reads from it) would never know.
//
// This module is the connector. The Automation Engine is the producer;
// the Brain is the consumer. It never invents a status the engine did not
// actually report — every write here is a direct reflection of a real
// `run:create` / `run:update` / `queue` event the engine already emitted
// from its own state machine (see automation-engine.js's queued -> running
// -> paused/success/failed/cancelled lifecycle).
//
// Objective checklist -> where each event actually comes from:
//   Workflow started    <- 'run:create'                  (run.status === 'queued')
//   Workflow running    <- 'run:update' (run.status === 'running')
//   Workflow paused      <- 'run:update' (run.status === 'paused') — only
//                           possible starting Block 2 · Step 4 · Part 2,
//                           see the addendum note at the top of
//                           automation-engine.js for why pause did not
//                           exist before this pass
//   Workflow completed  <- 'run:update' (run.status === 'success')
//   Workflow failed      <- 'run:update' (run.status === 'failed')
//   Cancellation          <- 'run:update' (run.status === 'cancelled')
//   Queue updates          <- 'queue' (engine.getQueueState(): pending/
//                           running/concurrency, recomputed by the engine
//                           itself on every pump() cycle)
//
// Explicitly NOT done here (out of scope for "connect"): no new UI, no
// change to automation.html's existing markup, no change to the engine's
// own workflow/run business logic beyond the pause/resume addition
// documented in automation-engine.js (required to make "paused" a real,
// non-fabricated state) — only new listeners that call the engine's
// existing public onChange() API and Brain's existing setState()/getState().
//
// De-duplication / no stale state:
//   - Brain.automation always reflects the single most-recently-observed
//     run event; if two runs are genuinely in flight (concurrency > 1),
//     Brain still surfaces the run whose event was received last — a
//     single shared Brain object has one "most recent" signal, matching
//     how activity/mood already work for the AI pipeline. Full per-run
//     detail remains available from AxiomAutomationBuilderEngine.listRuns()
//     for any consumer that needs it; Brain is a live-status pointer, not
//     a duplicate run store.
//   - A `run:update` is only written to Brain when the run's status
//     actually changed since the last write for that same run id, so a
//     redundant emit (e.g. the engine re-emitting 'run:update' for the
//     same status) never produces a duplicate Brain 'change' tick.
//   - Queue counts are written on every real 'queue' event, since pending/
//     running counts can legitimately repeat across ticks (e.g. staying at
//     0 pending) without that being a "duplicate" — it is the accurate
//     current state, not a new discrete event to de-dupe.
//
// Public API — window.AxiomBrainAutomationBridge (small, for tests/cleanup):
//   getStats()  -> { runEventsObserved, queueEventsObserved }
//   destroy()   -> unsubscribes from the engine (page-teardown / test isolation)
// ============================================================
window.AxiomBrainAutomationBridge = (function () {
  'use strict';

  var Brain = window.AxiomBrain;
  var Engine = window.AxiomAutomationBuilderEngine;

  // Harmless no-op on any page that has one but not the other (mirrors the
  // guard pattern already used by brain-memory-bridge.js and
  // ai-state-manager.js's driveAICore/driveBrain).
  if (!Brain || !Engine) {
    return { getStats: function () { return null; }, destroy: function () {} };
  }

  Engine.init(); // idempotent — safe even if a page already called this

  var stats = { runEventsObserved: 0, queueEventsObserved: 0 };
  var lastWrittenSignature = null; // runId + '|' + status, for de-dup

  function writeAutomationState(patch) {
    var current = Brain.getState().automation || {};
    Brain.setState({ automation: Object.assign({}, current, patch) });
  }

  function onRunEvent(run) {
    if (!run || !run.id) return;
    var signature = run.id + '|' + run.status;
    if (signature === lastWrittenSignature) return; // no real change since last write
    lastWrittenSignature = signature;

    writeAutomationState({
      status: run.status, // 'queued' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled'
      runId: run.id,
      workflowId: run.workflowId || null,
      workflowName: run.workflowName || null
    });
    stats.runEventsObserved++;
  }

  function onQueueEvent(queue) {
    if (!queue) return;
    writeAutomationState({
      queue: {
        pending: queue.pending || 0,
        running: queue.running || 0,
        concurrency: queue.concurrency || 0
      }
    });
    stats.queueEventsObserved++;
  }

  function onEngineChange(evt) {
    if (!evt || !evt.type) return;
    switch (evt.type) {
      case 'run:create':
      case 'run:update':
        onRunEvent(evt.run);
        break;
      case 'queue':
        onQueueEvent(evt.queue);
        break;
      // 'workflow:create' / 'workflow:update' / 'workflow:delete' /
      // 'init' / 'import' are workflow-definition/bookkeeping events, not
      // live run activity — deliberately not surfaced on the Brain, which
      // tracks "what's happening right now", not the workflow catalog.
      default:
        break;
    }
  }

  var unsubscribe = Engine.onChange(onEngineChange);

  // Seed once with whatever the engine already knows on load (e.g. a run
  // still 'running' from before this page was opened in a new tab), so
  // the Brain doesn't start blank until the next real event.
  (function seed() {
    var runs = Engine.listRuns({ limit: 1 });
    if (runs && runs.length) onRunEvent(runs[0]);
    onQueueEvent(Engine.getQueueState());
  })();

  function destroy() {
    if (typeof unsubscribe === 'function') unsubscribe();
  }

  function getStats() {
    return Object.assign({}, stats);
  }

  return { getStats: getStats, destroy: destroy };
})();
