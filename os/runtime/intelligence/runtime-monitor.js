// ============================================================
// AXIOM AI OS — Milestone 8: Runtime Monitoring
// ------------------------------------------------------------
// Task 8 asks for visibility into active agents, queue size, running
// tasks, failed tasks, processing time and agent health. Health-by-
// status already exists (AgentManager.health()); this module adds
// what wasn't tracked anywhere: queue depth per agent, task
// throughput (completed/failed counters), and processing-time
// statistics (avg / p95) measured from real `task:started` ->
// `task:completed|failed` event pairs on the shared bus.
//
// Deliberately no UI: this is a pure data/event module (the brief is
// explicit that no page layout may change). Anything wanting a panel
// can read AxiomRuntimeMonitor.report() or subscribe to updates.
//
// Public surface — window.AxiomRuntimeMonitor:
//   .report()          -> full snapshot (agents, queues, tasks, timing)
//   .subscribe(fn)      -> fn(report) on every tick; returns unsubscribe
//   .history(n?)        -> last n report snapshots (bounded ring buffer)
// ============================================================
window.AxiomRuntimeMonitor = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  if (!RT || !MGR) {
    AxLogger.error('[AxiomRuntimeMonitor] requires agent-runtime.js and agent-manager.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var TICK_MS = 5000;
  var HISTORY_MAX = 60; // 5 minutes at the default tick
  var SAMPLE_MAX = 200; // bounded so long sessions can't leak memory

  var inFlight = new Map();      // taskId -> { agentId, startedAt }
  var durations = [];            // bounded ring buffer of { agentId, ms }
  var counters = { completed: 0, failed: 0, retried: 0 };
  var history = [];
  var subscribers = new Set();

  bus.on('task:started', function (env) {
    var t = env.payload && env.payload.task;
    if (t && t.id) inFlight.set(t.id, { agentId: env.payload.agent, startedAt: Date.now() });
  });
  bus.on('task:completed', function (env) {
    counters.completed += 1;
    settle(env);
  });
  bus.on('task:failed', function (env) {
    counters.failed += 1;
    settle(env);
  });
  bus.on('orchestrator:step-retry', function () { counters.retried += 1; });

  function settle(env) {
    var t = env.payload && env.payload.task;
    if (!t || !t.id) return;
    var started = inFlight.get(t.id);
    inFlight.delete(t.id);
    if (!started) return;
    durations.push({ agentId: started.agentId, ms: Date.now() - started.startedAt });
    if (durations.length > SAMPLE_MAX) durations.shift();
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx];
  }

  function processingTimeStats() {
    var byAgent = {};
    durations.forEach(function (d) { (byAgent[d.agentId] = byAgent[d.agentId] || []).push(d.ms); });
    var out = {};
    Object.keys(byAgent).forEach(function (agentId) {
      var ms = byAgent[agentId].slice().sort(function (a, b) { return a - b; });
      var avg = ms.reduce(function (a, b) { return a + b; }, 0) / ms.length;
      out[agentId] = { samples: ms.length, avgMs: Math.round(avg), p95Ms: percentile(ms, 0.95) };
    });
    return out;
  }

  function report() {
    var snap = MGR.snapshot();
    var queues = {};
    snap.agents.forEach(function (a) { queues[a.id] = a.queued; });
    var running = snap.agents.filter(function (a) { return a.current !== null; }).map(function (a) { return a.id; });

    return {
      at: Date.now(),
      health: MGR.health(),
      activeAgents: snap.agents.filter(function (a) { return a.status !== 'offline'; }).map(function (a) { return a.id; }),
      queueSizes: queues,
      runningTasks: running,
      taskCounters: Object.assign({}, counters),
      processingTime: processingTimeStats()
    };
  }

  function tick() {
    var snap = report();
    history.push(snap);
    if (history.length > HISTORY_MAX) history.shift();
    subscribers.forEach(function (fn) { try { fn(snap); } catch (e) { /* isolated */ } });
    bus.emit('monitor:report', 'runtime-monitor', { at: snap.at });
  }
  setInterval(tick, TICK_MS);

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.add(fn);
    return function () { subscribers.delete(fn); };
  }

  function historyFn(n) { return history.slice(-(n || HISTORY_MAX)); }

  return { report: report, subscribe: subscribe, history: historyFn };
})();
