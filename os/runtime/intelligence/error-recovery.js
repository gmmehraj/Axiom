// ============================================================
// AXIOM AI OS — Milestone 8: Error Recovery
// ------------------------------------------------------------
// Task 9 asks for automatic retries, graceful failures, timeout
// handling, recovery workflows and agent restart. Per-capability
// retry/timeout already exists (capability-kit.js), and a single
// failed step's retry already lives in orchestrator.js. What was
// missing is a policy that watches the WHOLE runtime for a pattern
// no single task-level retry can see: one agent failing repeatedly
// across unrelated tasks, which usually means the agent itself is
// wedged rather than any one task being bad luck.
//
// This module only ever calls PUBLIC AgentManager methods
// (deactivate/activate, i.e. shutdown+re-init) to restart an agent —
// it never reaches into agent internals, so restarting an agent
// cannot desync it from the manager's registry.
//
// Public surface — window.AxiomErrorRecovery:
//   .restartAgent(agentId) -> Promise<agent>
//   .report()              -> recent recovery actions (bounded log)
//   .setThreshold(n)        -> change the "restart after N failures" trigger
// ============================================================
window.AxiomErrorRecovery = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  if (!RT || !MGR) {
    AxLogger.error('[AxiomErrorRecovery] requires agent-runtime.js and agent-manager.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var FAILURE_WINDOW_MS = 30000;
  var threshold = 3; // consecutive failures inside the window before a restart
  var failureLog = new Map(); // agentId -> [timestamps]
  var actionLog = [];
  var MAX_LOG = 100;

  function recordAction(action) {
    actionLog.push(Object.assign({ at: Date.now() }, action));
    if (actionLog.length > MAX_LOG) actionLog.shift();
  }

  function recentFailures(agentId) {
    var now = Date.now();
    var list = (failureLog.get(agentId) || []).filter(function (t) { return now - t <= FAILURE_WINDOW_MS; });
    failureLog.set(agentId, list);
    return list;
  }

  function restartAgent(agentId) {
    var agent = MGR.get(agentId);
    if (!agent) return Promise.resolve(null);
    recordAction({ type: 'restart', agentId: agentId, reason: 'repeated failures' });
    bus.emit('recovery:agent-restart', 'error-recovery', { agentId: agentId });
    MGR.deactivate(agentId); // shutdown() — clears queue, goes offline
    failureLog.set(agentId, []);
    return MGR.activate(agentId); // init() — back to idle, subscriptions rewired
  }

  // Graceful failure + recovery workflow: a task failing doesn't crash
  // anything upstream (agent-runtime.js already auto-recovers a single
  // agent to idle after 1.2s) — this module's job is purely the
  // cross-task pattern detector + the restart action, layered on top.
  bus.on('task:failed', function (env) {
    var agentId = env.payload && env.payload.agent;
    if (!agentId) return;
    var list = recentFailures(agentId);
    list.push(Date.now());
    failureLog.set(agentId, list);
    if (list.length >= threshold) {
      restartAgent(agentId);
    }
  });

  // Timeout handling: capability-kit and the orchestrator both already
  // emit a distinct event on timeout rather than a generic failure — this
  // module just keeps a visible tally so a stuck downstream dependency
  // (e.g. an embedded iframe never responding) is diagnosable from one
  // place instead of scattered console warnings.
  var timeoutTally = {};
  bus.on('capability:timeout', function (env) {
    var name = env.payload && env.payload.capability;
    if (name) timeoutTally[name] = (timeoutTally[name] || 0) + 1;
  });
  bus.on('orchestrator:step-failed', function (env) {
    if (env.payload && /timed out/i.test(env.payload.error || '')) {
      timeoutTally[env.payload.agentId] = (timeoutTally[env.payload.agentId] || 0) + 1;
    }
  });

  function report() {
    return {
      threshold: threshold,
      recentFailuresByAgent: Array.from(failureLog.entries()).map(function (e) { return { agentId: e[0], count: e[1].length }; }),
      timeouts: Object.assign({}, timeoutTally),
      actions: actionLog.slice(-25)
    };
  }

  function setThreshold(n) {
    if (typeof n === 'number' && n > 0) threshold = n;
    return threshold;
  }

  return { restartAgent: restartAgent, report: report, setThreshold: setThreshold };
})();
