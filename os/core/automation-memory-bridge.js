// ============================================================
// AXIOM — Block 2 / Step 4 / Part 3: Connect Memory to Automation
// ------------------------------------------------------------
// The Automation Engine Foundation (os/core/automation-engine.js, Part 1)
// has a full workflow/run lifecycle — queued -> running -> paused ->
// success/failed/cancelled — exposed via AxiomAutomationBuilderEngine
// .onChange(). The Memory Foundation (os/core/memory-engine.js, Block 2 ·
// Step 3 · Part 1) already has a real, persisted, queryable store
// (addMemory/queryMemories) and a stable read API in front of it
// (os/core/memory-manager.js, Block 2 · Step 3 · Part 3). Before this
// file, nothing connected the two: a workflow could run, fail, or get
// cancelled, and once Brain's single live-status pointer
// (brain-automation-bridge.js, Part 2) moved on to the next run, that
// run's outcome was gone — nothing durable remembered it.
//
// This module is the connector. The Automation Engine is the producer;
// AxiomMemoryEngine is the persistent store. It never invents an outcome,
// a result, or an action — every record written here is a direct
// reflection of a real `run:update` event the engine already emitted from
// its own state machine, using the run object's own fields (steps,
// timestamps, errors) rather than summarizing or reasoning about them.
//
// Objective checklist -> where each piece of history actually comes from:
//   Workflow execution history <- one 'automation-run' Memory record per
//                                  run, written the moment 'run:update'
//                                  reports a TERMINAL status (success /
//                                  failed / cancelled) — not one record
//                                  per intermediate step/queue tick, since
//                                  the run object already carries its own
//                                  full step-by-step detail
//   Results                    <- run.steps, reduced to {label, type,
//                                  status, attempts, result} per step
//   Errors                     <- run.error (run-level) and each failed
//                                  step's own step.error — never a
//                                  generic "something failed" string
//   Runtime                    <- run.startedAt / run.finishedAt /
//                                  run.duration, taken verbatim from the
//                                  engine, never recomputed or estimated
//   Metadata                   <- run.id, run.workflowId, run.workflowName,
//                                  run.trigger, run.queuedAt, step count
//   User actions                <- a separate 'automation-action' Memory
//                                  record for each real 'paused' event and
//                                  each real paused-> running (resume)
//                                  transition — the only pause/resume
//                                  signals the engine actually emits (see
//                                  brain-automation-bridge.js's own note:
//                                  cancelRun() on a 'running'/'paused' run
//                                  does not emit its own event, only the
//                                  eventual terminal 'cancelled' run:update
//                                  does, so a cancellation is recorded as
//                                  part of that run's history record, not
//                                  as a separate fabricated "cancel
//                                  requested" action)
//
// No vector memory, no embeddings, no semantic search, no AI reasoning
// over history — this module only stores structured fields it read
// straight off the engine's own run object and exposes plain
// equality/sort/paginate lookups, the same non-semantic retrieval
// AxiomMemoryEngine/AxiomMemoryManager already provide for every other
// memory record.
//
// Explicitly NOT done here (out of scope for "connect"): no new UI, no
// change to automation.html's or memory.html's existing markup, no change
// to AxiomAutomationBuilderEngine's or AxiomMemoryEngine's own business
// logic — only new listeners that call their existing, unchanged public
// APIs (Engine.onChange/listRuns, Memory.addMemory/getMemory/
// queryMemories).
//
// De-duplication / idempotency:
//   - Every run-history record is written under the STABLE id
//     `automation-run:<runId>`. AxiomMemoryEngine.addMemory() keys its
//     store by id, so writing the same id twice overwrites in place
//     rather than creating a duplicate — this also makes the Part 3 seed
//     pass (below) safe to re-run on every page load without ever
//     accumulating duplicate history rows for the same run.
//   - A run only reaches a terminal status once (the engine's own
//     lifecycle never revisits 'success'/'failed'/'cancelled'), so the
//     stable-id overwrite is a safety net, not something relied on to
//     paper over repeated writes.
//   - Action records use the id
//     `automation-action:<runId>:<action>:<timestamp>` — deliberately NOT
//     collapsed to one-per-run, because a single run can genuinely be
//     paused and resumed more than once, and each occurrence is a real,
//     separate action worth keeping in the browsable history.
//
// Public API — window.AxiomAutomationMemoryBridge (small, for tests/UI):
//   listExecutionHistory(opts?) -> { items, total, offset, limit }
//                                   opts: { workflowId?, status?, sort?
//                                   ('recent'|'oldest'), offset?, limit? }
//   getExecutionHistory(runId)  -> the stored run-history record | null
//   listActions(opts?)          -> { items, total, offset, limit }
//                                   opts: { runId?, action?, offset?, limit? }
//   getStats()                  -> { runsRecorded, actionsRecorded }
//   destroy()                   -> unsubscribes from the engine
//                                   (page-teardown / test isolation)
// ============================================================
window.AxiomAutomationMemoryBridge = (function () {
  'use strict';

  var Engine = window.AxiomAutomationBuilderEngine;
  var Memory = window.AxiomMemoryEngine;

  // Harmless no-op on any page that has one but not the other (mirrors
  // the guard pattern already used by brain-automation-bridge.js and
  // brain-memory-bridge.js).
  if (!Engine || !Memory) {
    return {
      listExecutionHistory: function () { return { items: [], total: 0, offset: 0, limit: 0 }; },
      getExecutionHistory: function () { return null; },
      listActions: function () { return { items: [], total: 0, offset: 0, limit: 0 }; },
      getStats: function () { return null; },
      destroy: function () {}
    };
  }

  Engine.init();  // idempotent — safe even if a page already called this
  Memory.init();  // idempotent — safe even if a page already called this

  var TERMINAL_STATUSES = { success: true, failed: true, cancelled: true };
  var DEFAULT_LIMIT = 25;
  var MAX_LIMIT = 200;

  var stats = { runsRecorded: 0, actionsRecorded: 0 };
  var recordedTerminalRunIds = new Set(); // local guard against redundant work, not correctness-critical
  var lastStatusByRunId = new Map();      // runId -> last-seen status, to detect a real paused -> running resume

  function now() { return Date.now(); }

  function importanceFor(status) {
    if (status === 'failed') return 0.6;
    if (status === 'cancelled') return 0.4;
    return 0.3; // success
  }

  function summarizeSteps(steps) {
    return (steps || []).map(function (s) {
      return {
        label: s.label,
        type: s.type,
        status: s.status,
        attempts: s.attempts || 0,
        error: s.error || null,
        result: s.result || null
      };
    });
  }

  function writeRunHistory(run) {
    var duration = (typeof run.duration === 'number')
      ? run.duration
      : (run.finishedAt && run.startedAt ? run.finishedAt - run.startedAt : null);
    var durationLabel = (typeof duration === 'number') ? (duration / 1000).toFixed(1) + 's' : 'unknown duration';

    Memory.addMemory({
      id: 'automation-run:' + run.id,
      text: 'Workflow "' + run.workflowName + '" run ' + run.status + ' (' + durationLabel + ', trigger: ' + (run.trigger || 'Manual') + ').',
      agent: 'AutomationEngine',
      project: run.workflowId,
      type: 'automation-run',
      tags: ['automation', 'run', run.status],
      importance: importanceFor(run.status),
      confidence: 1,
      pinned: false,
      ttl: null, // durable history, not a transient status — never expires on its own
      data: {
        runId: run.id,
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        status: run.status,
        trigger: run.trigger || 'Manual',
        queuedAt: run.queuedAt || null,
        startedAt: run.startedAt || null,
        finishedAt: run.finishedAt || null,
        duration: duration,
        stepCount: (run.steps || []).length,
        steps: summarizeSteps(run.steps),
        error: run.error || null
      }
    });
    stats.runsRecorded++;
  }

  function writeAction(run, action) {
    var step = (typeof run.currentStepIndex === 'number' && run.currentStepIndex >= 0 && run.steps)
      ? run.steps[run.currentStepIndex]
      : null;
    Memory.addMemory({
      id: 'automation-action:' + run.id + ':' + action + ':' + now(),
      text: 'Run of "' + run.workflowName + '" was ' + action + (step ? (' at step "' + step.label + '"') : '') + '.',
      agent: 'AutomationEngine',
      project: run.workflowId,
      type: 'automation-action',
      tags: ['automation', 'action', action],
      importance: 0.2,
      confidence: 1,
      pinned: false,
      ttl: null,
      data: {
        runId: run.id,
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        action: action, // 'paused' | 'resumed'
        atStepIndex: run.currentStepIndex,
        atStepLabel: step ? step.label : null,
        ts: now()
      }
    });
    stats.actionsRecorded++;
  }

  function onRunEvent(run) {
    if (!run || !run.id) return;
    var prevStatus = lastStatusByRunId.get(run.id);

    // A real 'paused' event — a genuine cooperative-pause checkpoint, per
    // automation-engine.js's own pause/resume lifecycle (Part 2).
    if (run.status === 'paused' && prevStatus !== 'paused') {
      writeAction(run, 'paused');
    }

    // A real 'running' event whose previous observed status for this SAME
    // run was 'paused' — the only way the engine transitions running <-
    // paused is via resumeRun(), so this is a genuine resume, distinct
    // from a fresh run's first queued -> running transition.
    if (run.status === 'running' && prevStatus === 'paused') {
      writeAction(run, 'resumed');
    }

    // Execution history: written once, when the run genuinely reaches a
    // terminal status. A cancellation has no separate observable
    // "cancel requested" event from the engine (see header note), so it
    // is captured here, as part of the run's own terminal record, rather
    // than invented as a standalone action.
    if (TERMINAL_STATUSES[run.status] && !recordedTerminalRunIds.has(run.id)) {
      recordedTerminalRunIds.add(run.id);
      writeRunHistory(run);
    }

    lastStatusByRunId.set(run.id, run.status);
  }

  function onEngineChange(evt) {
    if (!evt || !evt.type) return;
    switch (evt.type) {
      case 'run:create':
      case 'run:update':
        onRunEvent(evt.run);
        break;
      // 'queue' (pending/running counts) and workflow-*definition*
      // bookkeeping ('workflow:create/update/delete', 'init', 'import')
      // are not execution history, results, errors, runtime, or a user
      // action on any specific run — deliberately not persisted here.
      default:
        break;
    }
  }

  var unsubscribe = Engine.onChange(onEngineChange);

  // Seed once with whatever the engine already knows on load — e.g. runs
  // that finished (or were recovered as 'failed' by the engine's own
  // crash-recovery pass) before this bridge was subscribed on this page
  // load. Safe to call every time: writeRunHistory() overwrites the same
  // stable id rather than duplicating.
  (function seed() {
    var runs = Engine.listRuns({ limit: MAX_LIMIT });
    runs.forEach(function (run) {
      lastStatusByRunId.set(run.id, run.status);
      if (TERMINAL_STATUSES[run.status] && !recordedTerminalRunIds.has(run.id)) {
        recordedTerminalRunIds.add(run.id);
        writeRunHistory(run);
      }
    });
  })();

  // ---- browsing helpers (plain equality/sort/paginate — no semantic
  //      search, no embeddings, matching AxiomMemoryManager's own
  //      read-layer conventions) ------------------------------------------
  function paginate(items, opts) {
    opts = opts || {};
    var total = items.length;
    var offset = (typeof opts.offset === 'number' && opts.offset >= 0) ? opts.offset : 0;
    var limit = (typeof opts.limit === 'number') ? opts.limit : DEFAULT_LIMIT;
    limit = Math.max(1, Math.min(MAX_LIMIT, limit));
    return { items: items.slice(offset, offset + limit), total: total, offset: offset, limit: limit };
  }

  function listExecutionHistory(opts) {
    opts = opts || {};
    var filter = { type: 'automation-run' };
    if (opts.workflowId) filter.project = opts.workflowId;
    var items = Memory.queryMemories(filter);
    if (opts.status) items = items.filter(function (m) { return m.data && m.data.status === opts.status; });
    items = items.slice().sort(function (a, b) {
      return opts.sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    });
    return paginate(items, opts);
  }

  function getExecutionHistory(runId) {
    if (!runId) return null;
    return Memory.getMemory('automation-run:' + runId);
  }

  function listActions(opts) {
    opts = opts || {};
    var items = Memory.queryMemories({ type: 'automation-action' });
    if (opts.runId) items = items.filter(function (m) { return m.data && m.data.runId === opts.runId; });
    if (opts.action) items = items.filter(function (m) { return m.data && m.data.action === opts.action; });
    items = items.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    return paginate(items, opts);
  }

  function destroy() {
    if (typeof unsubscribe === 'function') unsubscribe();
  }

  function getStats() {
    return Object.assign({}, stats);
  }

  return {
    listExecutionHistory: listExecutionHistory,
    getExecutionHistory: getExecutionHistory,
    listActions: listActions,
    getStats: getStats,
    destroy: destroy
  };
})();
