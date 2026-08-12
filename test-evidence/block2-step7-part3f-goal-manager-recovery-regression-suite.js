// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3F: Adaptive Execution &
// Recovery Layer regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1),
// os/core/runtime-context.js (Step 6 Part 5), os/core/capability-
// router.js (Step 6 Part 3), os/core/agent-registry-integration.js
// (Part 2), os/core/goal-manager.js (Step 7 Parts 3A+3B), os/core/
// task-planner.js (Step 7 Part 2), os/core/autonomous-decision-
// engine.js (Step 7 Part 3C), os/core/decision-engine-execution-
// bridge.js (Step 7 Part 3D), os/core/goal-manager-learning.js (Step
// 7 Part 3E), then the new os/core/goal-manager-recovery.js (Step 7
// Part 3F) in a minimal vm sandbox — same pattern every prior Block 2
// suite in this project already uses.
//
// Covers every configuration this Part explicitly supports:
//   (a) the full stack (Parts 1-3E all loaded) — automatic recovery
//       driven by decisionengine_execution_exhausted, real
//       dispatch/cancel/re-dispatch, learned reordering;
//   (b) goal-manager.js loaded WITHOUT Part 3C/3D/3E at all — a
//       caller driving the Goal Record by hand still gets stall
//       detection, blocked-goal detection, and recovery/skip driven
//       entirely off goal-manager.js's own status machine.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');

function loadSandbox(opts) {
  opts = opts || {};
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Promise, Object, Array, JSON, Math, Error
  };
  sandbox.window = sandbox;
  sandbox.document = undefined;

  vm.createContext(sandbox);

  const load = (rel) => {
    const src = fs.readFileSync(path.join(AI, rel), 'utf8');
    vm.runInContext(src, sandbox, { filename: rel });
  };

  if (opts.withOrchestrator !== false) load('os/core/orchestrator.js');
  if (opts.withRuntimeContext !== false) load('os/core/runtime-context.js');
  if (opts.withCapabilityRouter !== false) load('os/core/capability-router.js');
  if (opts.withDiscovery !== false) load('os/core/agent-registry-integration.js');
  if (opts.withGoalManager !== false) load('os/core/goal-manager.js');
  if (opts.withTaskPlanner !== false) load('os/core/task-planner.js');
  if (opts.withDecisionEngine !== false) load('os/core/autonomous-decision-engine.js');
  if (opts.withBridge !== false) load('os/core/decision-engine-execution-bridge.js');
  if (opts.withLearning !== false) load('os/core/goal-manager-learning.js');
  if (opts.withRecovery !== false) load('os/core/goal-manager-recovery.js');

  return sandbox.window;
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerTestAgents(W, opts) {
  opts = opts || {};
  const calls = { search: 0, remember: 0 };
  W.AxiomOrchestrator.registerAgent({
    id: 'browser', name: 'Browser', capabilities: ['search-web'],
    permissions: ['browser:*'], tools: ['browser.search'],
    handler: opts.searchHandler || (async (task) => { calls.search++; await tick(5); return { ok: true, via: 'browser', payload: task.payload }; })
  });
  W.AxiomOrchestrator.registerAgent({
    id: 'memory', name: 'Memory', capabilities: ['remember-info'],
    permissions: ['memory:*'], tools: ['memory.save'],
    handler: opts.rememberHandler || (async (task) => { calls.remember++; await tick(5); return { ok: true, via: 'memory', payload: task.payload }; })
  });
  return calls;
}

async function waitFor(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 2000)) {
    if (fn()) return true;
    await tick(5);
  }
  return false;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + e.stack);
  }
}

async function main() {
  console.log('AXIOM Block 2 / Step 7 / Part 3F — Adaptive Execution & Recovery Layer regression\n');

  // ------------------------------------------------------------
  // Load-order guards
  // ------------------------------------------------------------
  await test('module does not install itself without AxiomOrchestrator present', () => {
    const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Object, Array, JSON, Math, Error };
    sandbox.window = sandbox;
    sandbox.document = undefined;
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(AI, 'os/core/goal-manager-recovery.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'goal-manager-recovery.js' });
    assert.strictEqual(sandbox.window.AxiomGoalManagerRecovery, undefined);
  });

  await test('module does not install itself without AxiomRuntimeContext present', () => {
    const W = loadSandbox({ withRuntimeContext: false, withCapabilityRouter: false, withDiscovery: false, withGoalManager: false, withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false, withRecovery: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/goal-manager-recovery.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'goal-manager-recovery.js' });
    assert.strictEqual(W.AxiomGoalManagerRecovery, undefined);
  });

  await test('module does not install itself without AxiomGoalManager present', () => {
    const W = loadSandbox({ withGoalManager: false, withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false, withRecovery: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/goal-manager-recovery.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'goal-manager-recovery.js' });
    assert.strictEqual(W.AxiomGoalManagerRecovery, undefined);
  });

  await test('module installs cleanly with the FULL stack present, without editing any dependency', () => {
    const deps = [
      'os/core/orchestrator.js', 'os/core/runtime-context.js', 'os/core/goal-manager.js',
      'os/core/task-planner.js', 'os/core/autonomous-decision-engine.js',
      'os/core/decision-engine-execution-bridge.js', 'os/core/goal-manager-learning.js'
    ];
    const before = {};
    deps.forEach((d) => { before[d] = fs.readFileSync(path.join(AI, d), 'utf8'); });

    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomGoalManagerRecovery, 'object');
    assert.strictEqual(typeof W.AxiomGoalManagerRecovery.monitorActiveGoals, 'function');
    // Installs nothing onto AxiomOrchestrator's own surface.
    assert.strictEqual(typeof W.AxiomOrchestrator.planGoal, 'function');

    const after = {};
    deps.forEach((d) => { after[d] = fs.readFileSync(path.join(AI, d), 'utf8'); });
    assert.deepStrictEqual(before, after);
  });

  await test('module installs cleanly with ONLY goal-manager.js present (no Part 3C/3D/3E)', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    assert.strictEqual(typeof W.AxiomGoalManagerRecovery, 'object');
    assert.strictEqual(W.AxiomDecisionEngine, undefined);
    assert.strictEqual(W.AxiomDecisionEngineExecutionBridge, undefined);
    assert.strictEqual(W.AxiomGoalManagerLearning, undefined);
  });

  // ------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------
  await test('setStallThresholdMs()/getStallThresholdMs() round-trip and reject bad input', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    assert.strictEqual(W.AxiomGoalManagerRecovery.setStallThresholdMs(1234), 1234);
    assert.strictEqual(W.AxiomGoalManagerRecovery.getStallThresholdMs(), 1234);
    assert.throws(() => W.AxiomGoalManagerRecovery.setStallThresholdMs(0));
    assert.throws(() => W.AxiomGoalManagerRecovery.setStallThresholdMs(-5));
    assert.throws(() => W.AxiomGoalManagerRecovery.setStallThresholdMs('soon'));
  });

  await test('setMaxRecoveryAttempts()/getMaxRecoveryAttempts() round-trip and reject bad input', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    assert.strictEqual(W.AxiomGoalManagerRecovery.setMaxRecoveryAttempts(5), 5);
    assert.strictEqual(W.AxiomGoalManagerRecovery.getMaxRecoveryAttempts(), 5);
    assert.throws(() => W.AxiomGoalManagerRecovery.setMaxRecoveryAttempts(-1));
    assert.throws(() => W.AxiomGoalManagerRecovery.setMaxRecoveryAttempts(1.5));
  });

  // ------------------------------------------------------------
  // checkGoalHealth() — real-time monitoring
  // ------------------------------------------------------------
  await test('checkGoalHealth() returns a frozen diagnostic snapshot for a Pending goal', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'diagnostic target' });
    const health = W.AxiomGoalManagerRecovery.checkGoalHealth(g.id);
    assert.strictEqual(health.goalId, g.id);
    assert.strictEqual(health.status, 'pending');
    assert.strictEqual(health.stalled, false);
    assert.ok(Object.isFrozen(health));
  });

  await test('checkGoalHealth() marks a long-idle RUNNING goal as stalled once idle time exceeds the threshold', async () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    W.AxiomGoalManagerRecovery.setStallThresholdMs(20);
    const g = W.AxiomGoalManager.createGoal({ title: 'will stall' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    await tick(60);
    const health = W.AxiomGoalManagerRecovery.checkGoalHealth(g.id);
    assert.strictEqual(health.stalled, true);
    assert.ok(health.idleMs >= 20);
  });

  await test('checkGoalHealth() does not mark a freshly-started RUNNING goal as stalled', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    W.AxiomGoalManagerRecovery.setStallThresholdMs(5000);
    const g = W.AxiomGoalManager.createGoal({ title: 'just started' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    const health = W.AxiomGoalManagerRecovery.checkGoalHealth(g.id);
    assert.strictEqual(health.stalled, false);
  });

  await test('checkGoalHealth() reports blocked=true by reusing isGoalBlocked() verbatim', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const prereq = W.AxiomGoalManager.createGoal({ title: 'prereq' });
    const dependent = W.AxiomGoalManager.createGoal({ title: 'dependent' });
    W.AxiomGoalManager.addGoalDependency(dependent.id, prereq.id);
    const health = W.AxiomGoalManagerRecovery.checkGoalHealth(dependent.id);
    assert.strictEqual(health.blocked, true);
    assert.strictEqual(health.blocked, W.AxiomGoalManager.isGoalBlocked(dependent.id));
  });

  await test('checkGoalHealth() reports impossible=true when Part 3C is loaded and no agent advertises the required capability', () => {
    const W = loadSandbox({ withTaskPlanner: false, withBridge: false, withLearning: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'no such agent', metadata: { capability: 'nonexistent-capability' } });
    const health = W.AxiomGoalManagerRecovery.checkGoalHealth(g.id);
    assert.strictEqual(health.impossible, true);
    assert.ok(health.evaluation.reason.indexOf('no agent registered advertises capability') !== -1);
  });

  await test('checkGoalHealth().impossible is always false without Part 3C loaded (graceful degrade)', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'no decision engine here', metadata: { capability: 'nonexistent-capability' } });
    const health = W.AxiomGoalManagerRecovery.checkGoalHealth(g.id);
    assert.strictEqual(health.impossible, false);
    assert.strictEqual(health.evaluation, null);
  });

  // ------------------------------------------------------------
  // monitorActiveGoals() — sweep
  // ------------------------------------------------------------
  await test('monitorActiveGoals() returns a diagnostic per non-terminal goal and skips terminal ones', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const pending = W.AxiomGoalManager.createGoal({ title: 'still pending' });
    const done = W.AxiomGoalManager.createGoal({ title: 'already done' });
    W.AxiomGoalManager.markGoalQueued(done.id);
    W.AxiomGoalManager.markGoalRunning(done.id);
    W.AxiomGoalManager.completeGoal(done.id);

    const results = W.AxiomGoalManagerRecovery.monitorActiveGoals();
    const ids = results.map((r) => r.goalId);
    assert.ok(ids.indexOf(pending.id) !== -1);
    assert.strictEqual(ids.indexOf(done.id), -1);
  });

  await test('monitorActiveGoals() emits goal_blocked exactly once per blocked-state entry (de-duped across sweeps)', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const prereq = W.AxiomGoalManager.createGoal({ title: 'prereq' });
    const dependent = W.AxiomGoalManager.createGoal({ title: 'dependent' });
    W.AxiomGoalManager.addGoalDependency(dependent.id, prereq.id);

    let blockedEvents = 0;
    W.AxiomOrchestrator.on('goal_blocked', (p) => { if (p.goalId === dependent.id) blockedEvents++; });

    W.AxiomGoalManagerRecovery.monitorActiveGoals();
    W.AxiomGoalManagerRecovery.monitorActiveGoals();
    W.AxiomGoalManagerRecovery.monitorActiveGoals();
    assert.strictEqual(blockedEvents, 1);

    // Unblock, then re-block — should fire again exactly once.
    W.AxiomGoalManager.markGoalQueued(prereq.id);
    W.AxiomGoalManager.markGoalRunning(prereq.id);
    W.AxiomGoalManager.completeGoal(prereq.id);
    W.AxiomGoalManagerRecovery.monitorActiveGoals();
    assert.strictEqual(blockedEvents, 1); // no longer blocked, no new event

    const prereq2 = W.AxiomGoalManager.createGoal({ title: 'prereq2' });
    W.AxiomGoalManager.addGoalDependency(dependent.id, prereq2.id);
    W.AxiomGoalManagerRecovery.monitorActiveGoals();
    assert.strictEqual(blockedEvents, 2);
  });

  await test('monitorActiveGoals() cancels and emits goal_skipped for a permanently-impossible goal', () => {
    const W = loadSandbox({ withTaskPlanner: false, withBridge: false, withLearning: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'doomed', metadata: { capability: 'never-registered' } });

    let skipped = null;
    W.AxiomOrchestrator.on('goal_skipped', (p) => { skipped = p; });

    W.AxiomGoalManagerRecovery.monitorActiveGoals();
    assert.ok(skipped);
    assert.strictEqual(skipped.goalId, g.id);
    assert.strictEqual(W.AxiomGoalManager.getGoal(g.id).status, 'cancelled');
  });

  await test('startMonitoring()/stopMonitoring()/isMonitoring() drive monitorActiveGoals() on an interval and can be stopped', async () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const prereq = W.AxiomGoalManager.createGoal({ title: 'prereq' });
    const dependent = W.AxiomGoalManager.createGoal({ title: 'dependent' });
    W.AxiomGoalManager.addGoalDependency(dependent.id, prereq.id);

    let blockedEvents = 0;
    W.AxiomOrchestrator.on('goal_blocked', () => { blockedEvents++; });

    assert.strictEqual(W.AxiomGoalManagerRecovery.isMonitoring(), false);
    W.AxiomGoalManagerRecovery.startMonitoring(10);
    assert.strictEqual(W.AxiomGoalManagerRecovery.isMonitoring(), true);
    await waitFor(() => blockedEvents >= 1, 1000);
    assert.ok(blockedEvents >= 1);

    W.AxiomGoalManagerRecovery.stopMonitoring();
    assert.strictEqual(W.AxiomGoalManagerRecovery.isMonitoring(), false);
    const countAfterStop = blockedEvents;
    await tick(50);
    assert.strictEqual(blockedEvents, countAfterStop);
  });

  // ------------------------------------------------------------
  // Stall handling & resume
  // ------------------------------------------------------------
  await test('a stalled RUNNING goal (no Bridge) is paused then resumed automatically, emitting goal_blocked then goal_resumed', async () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    W.AxiomGoalManagerRecovery.setStallThresholdMs(15);
    const g = W.AxiomGoalManager.createGoal({ title: 'manual stall' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);

    const events = [];
    W.AxiomOrchestrator.on('goal_blocked', (p) => { if (p.goalId === g.id) events.push('blocked:' + p.reason); });
    W.AxiomOrchestrator.on('goal_resumed', (p) => { if (p.goalId === g.id) events.push('resumed'); });

    await tick(30);
    const result = W.AxiomGoalManagerRecovery.monitorActiveGoals();
    const diag = result.find((r) => r.goalId === g.id);
    assert.strictEqual(diag.stalled, true);

    assert.deepStrictEqual(events, ['blocked:stalled', 'resumed']);
    // No Decision Engine loaded — resumed goal is left Queued (the
    // same posture the rest of the stack already has without Part 3C).
    assert.strictEqual(W.AxiomGoalManager.getGoal(g.id).status, 'queued');
    assert.strictEqual(W.AxiomGoalManagerRecovery.getRecoveryMetrics().stalledDetected, 1);
    assert.strictEqual(W.AxiomGoalManagerRecovery.getRecoveryMetrics().resumed, 1);
  });

  await test('a stalled RUNNING goal (Bridge + Decision Engine loaded) has its stuck execution cancelled and is recovered as a fresh attempt once cancellation settles', async () => {
    const W = loadSandbox({ withLearning: false });
    // Never resolves and holds no timer/handle — a plan that is stuck
    // forever without keeping this test process alive.
    registerTestAgents(W, { searchHandler: async () => new Promise(() => {}) });
    const g = W.AxiomGoalManager.createGoal({ title: 'search something forever', metadata: { capability: 'search-web' } });
    W.AxiomDecisionEngine.admitGoal(g.id);
    assert.strictEqual(W.AxiomGoalManager.getGoal(g.id).status, 'running');
    const firstExecution = W.AxiomDecisionEngineExecutionBridge.getExecution(g.id);
    assert.ok(firstExecution);

    W.AxiomGoalManagerRecovery.setStallThresholdMs(15);
    await tick(40);

    let blocked = null;
    let recovered = null;
    W.AxiomOrchestrator.on('goal_blocked', (p) => { if (p.goalId === g.id) blocked = p; });
    W.AxiomOrchestrator.on('goal_recovered', (p) => { if (p.goalId === g.id) recovered = p; });

    W.AxiomGoalManagerRecovery.monitorActiveGoals();
    assert.ok(blocked);
    assert.strictEqual(blocked.reason, 'stalled');

    await waitFor(() => recovered !== null, 2000);
    assert.ok(recovered, 'expected goal_recovered once the cancelled execution settles asynchronously');
    assert.strictEqual(W.AxiomGoalManager.getGoal(g.id).status, 'cancelled');
    const next = W.AxiomGoalManager.getGoal(recovered.recoveredGoalId);
    assert.strictEqual(next.status, 'running');
    const secondExecution = W.AxiomDecisionEngineExecutionBridge.getExecution(next.id);
    assert.notStrictEqual(secondExecution.planId, firstExecution.planId);
  });

  // ------------------------------------------------------------
  // Recovery / retry
  // ------------------------------------------------------------
  await test('attemptRecovery() mints a retry via the existing retry system and enqueues it (no Decision Engine)', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'failed once' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.failGoal(g.id, 'synthetic failure');

    let recovered = null;
    W.AxiomOrchestrator.on('goal_recovered', (p) => { recovered = p; });

    const result = W.AxiomGoalManagerRecovery.attemptRecovery(g.id, 'test recovery');
    assert.ok(result);
    assert.ok(recovered);
    assert.strictEqual(recovered.goalId, g.id);
    assert.strictEqual(recovered.recoveredGoalId, result.recoveredGoalId);
    const next = W.AxiomGoalManager.getGoal(result.recoveredGoalId);
    assert.strictEqual(next.status, 'queued');
    assert.strictEqual(next.retryOf, g.id);
    assert.strictEqual(W.AxiomGoalManagerRecovery.getRecoveryFor(g.id).recoveredGoalId, result.recoveredGoalId);
  });

  await test('attemptRecovery() re-admits the retry through AxiomDecisionEngine.admitGoal() when Part 3C is loaded', () => {
    const W = loadSandbox({ withTaskPlanner: false, withBridge: false, withLearning: false });
    registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'failed with capability', metadata: { capability: 'search-web' } });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.failGoal(g.id, 'synthetic failure');

    const result = W.AxiomGoalManagerRecovery.attemptRecovery(g.id, 'test recovery');
    const next = W.AxiomGoalManager.getGoal(result.recoveredGoalId);
    assert.strictEqual(next.status, 'running'); // scheduled + markGoalRunning via admitGoal()
  });

  await test('attemptRecovery() relinks a dependent from the dead original onto the fresh retry', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    W.AxiomGoalManagerRecovery.setAutoRecoveryEnabled(false); // manual, single-call control for this test
    const original = W.AxiomGoalManager.createGoal({ title: 'will fail' });
    const dependent = W.AxiomGoalManager.createGoal({ title: 'depends on it' });
    W.AxiomGoalManager.addGoalDependency(dependent.id, original.id);
    W.AxiomGoalManager.markGoalQueued(original.id);
    W.AxiomGoalManager.markGoalRunning(original.id);
    W.AxiomGoalManager.failGoal(original.id, 'synthetic failure');

    const result = W.AxiomGoalManagerRecovery.attemptRecovery(original.id, 'test');
    assert.strictEqual(result.dependentsRelinked.length, 1);
    assert.strictEqual(result.dependentsRelinked[0], dependent.id);

    const deps = W.AxiomGoalManager.getGoalDependencies(dependent.id);
    const depIds = deps.map((d) => d.goalId);
    assert.strictEqual(depIds.indexOf(original.id), -1);
    assert.ok(depIds.indexOf(result.recoveredGoalId) !== -1);
  });

  await test('attemptRecovery() declines (returns null) for a goal that is not Failed', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'still pending' });
    const result = W.AxiomGoalManagerRecovery.attemptRecovery(g.id, 'test');
    assert.strictEqual(result, null);
  });

  await test('attemptRecovery() escalates to skipGoal() once retryCount reaches the configured ceiling', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    W.AxiomGoalManagerRecovery.setAutoRecoveryEnabled(false); // manual, single-chain control for this test
    W.AxiomGoalManagerRecovery.setMaxRecoveryAttempts(1);
    const g = W.AxiomGoalManager.createGoal({ title: 'chronically failing' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.failGoal(g.id, 'fail 1');

    const first = W.AxiomGoalManagerRecovery.attemptRecovery(g.id, 'first');
    assert.ok(first.recoveredGoalId);
    W.AxiomGoalManager.markGoalQueued(first.recoveredGoalId);
    W.AxiomGoalManager.markGoalRunning(first.recoveredGoalId);
    W.AxiomGoalManager.failGoal(first.recoveredGoalId, 'fail 2');

    let skipped = null;
    W.AxiomOrchestrator.on('goal_skipped', (p) => { skipped = p; });
    let recoveredAgain = false;
    W.AxiomOrchestrator.on('goal_recovered', () => { recoveredAgain = true; });

    const second = W.AxiomGoalManagerRecovery.attemptRecovery(first.recoveredGoalId, 'second');
    assert.ok(skipped);
    assert.strictEqual(recoveredAgain, false);
    assert.strictEqual(second.goalId, first.recoveredGoalId);
    // Already terminal (Failed) — skipGoal() never forces a second
    // transition on top of an existing terminal status; it only ADDS
    // the goal_skipped bookkeeping/dependent release on top of
    // whatever terminal state the goal already reached.
    assert.strictEqual(W.AxiomGoalManager.getGoal(first.recoveredGoalId).status, 'failed');
  });

  await test('attemptRecovery() honours a per-goal metadata.maxRecoveryAttempts override', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    W.AxiomGoalManagerRecovery.setMaxRecoveryAttempts(10);
    const g = W.AxiomGoalManager.createGoal({ title: 'tight leash', metadata: { maxRecoveryAttempts: 0 } });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.failGoal(g.id, 'fail once');

    let skipped = null;
    W.AxiomOrchestrator.on('goal_skipped', (p) => { skipped = p; });
    const result = W.AxiomGoalManagerRecovery.attemptRecovery(g.id, 'test');
    assert.ok(skipped);
    assert.strictEqual(result.goalId, g.id);
  });

  await test('attemptRecovery() skips immediately (no endless retries) when the fresh retry candidate is itself permanently impossible', () => {
    const W = loadSandbox({ withTaskPlanner: false, withBridge: false, withLearning: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'doomed', metadata: { capability: 'never-registered' } });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.failGoal(g.id, 'fail');

    let skipped = null;
    W.AxiomOrchestrator.on('goal_skipped', (p) => { skipped = p; });
    let recovered = false;
    W.AxiomOrchestrator.on('goal_recovered', () => { recovered = true; });

    W.AxiomGoalManagerRecovery.attemptRecovery(g.id, 'test');
    assert.ok(skipped);
    assert.strictEqual(recovered, false);
  });

  await test('decisionengine_execution_exhausted (Part 3D) automatically triggers attemptRecovery()', async () => {
    const W = loadSandbox({ withLearning: false });
    W.AxiomDecisionEngineExecutionBridge.setMaxExecutionRetries(0);
    registerTestAgents(W, { searchHandler: async () => { throw new Error('always fails'); } });
    const g = W.AxiomGoalManager.createGoal({ title: 'always fails', metadata: { capability: 'search-web' } });

    let recovered = null;
    W.AxiomOrchestrator.on('goal_recovered', (p) => { if (p.goalId === g.id) recovered = p; });

    W.AxiomDecisionEngine.admitGoal(g.id);
    await waitFor(() => recovered !== null, 2000);
    assert.ok(recovered, 'expected goal_recovered to fire automatically off decisionengine_execution_exhausted');
  });

  await test('goalmgr_failed does NOT trigger automatic recovery when the Execution Bridge is loaded (avoids double-retry with the Bridge\'s own attemptRetry)', () => {
    const W = loadSandbox({ withLearning: false }); // full stack, including the Bridge
    const g = W.AxiomGoalManager.createGoal({ title: 'manually driven despite the bridge being loaded' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);

    let recovered = false;
    W.AxiomOrchestrator.on('goal_recovered', () => { recovered = true; });
    // A goal that never went through the Bridge's own dispatch path
    // (so no decisionengine_execution_exhausted will ever fire for
    // it) still must NOT be auto-recovered off goalmgr_failed alone
    // while the Bridge is loaded — confirming the goalmgr_failed
    // listener is simply never attached in that configuration.
    W.AxiomGoalManager.failGoal(g.id, 'manual failure, never touched the bridge');

    assert.strictEqual(recovered, false);
  });

  await test('decisionengine_execution_exhausted is the ONLY trigger this module reacts to per exhaustion (no duplicate goal_recovered for the same event)', async () => {
    const W = loadSandbox({ withLearning: false });
    W.AxiomDecisionEngineExecutionBridge.setMaxExecutionRetries(0);
    registerTestAgents(W, { searchHandler: async () => { throw new Error('always fails'); } });
    const g = W.AxiomGoalManager.createGoal({ title: 'fails once, exhausts immediately', metadata: { capability: 'search-web' } });

    let recoveredCount = 0;
    W.AxiomOrchestrator.on('goal_recovered', (p) => { if (p.goalId === g.id) recoveredCount++; });

    W.AxiomDecisionEngine.admitGoal(g.id);
    await waitFor(() => recoveredCount >= 1, 2000);
    await tick(30);
    assert.strictEqual(recoveredCount, 1);
  });

  await test('goalmgr_failed DOES trigger automatic recovery for a manually-driven goal when no Execution Bridge is loaded', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'manual failure' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);

    let recovered = null;
    W.AxiomOrchestrator.on('goal_recovered', (p) => { recovered = p; });
    W.AxiomGoalManager.failGoal(g.id, 'manual failure');

    assert.ok(recovered);
    assert.strictEqual(recovered.goalId, g.id);
  });

  // ------------------------------------------------------------
  // Skip / dependents
  // ------------------------------------------------------------
  await test('skipGoal() cancels the goal and releases ONLY dependents that opted in via metadata.optionalDependencies', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const target = W.AxiomGoalManager.createGoal({ title: 'to be skipped' });
    const optionalDependent = W.AxiomGoalManager.createGoal({ title: 'optional', metadata: { optionalDependencies: [target.id] } });
    const hardDependent = W.AxiomGoalManager.createGoal({ title: 'hard requirement' });
    W.AxiomGoalManager.addGoalDependency(optionalDependent.id, target.id);
    W.AxiomGoalManager.addGoalDependency(hardDependent.id, target.id);

    let skipped = null;
    W.AxiomOrchestrator.on('goal_skipped', (p) => { skipped = p; });

    W.AxiomGoalManagerRecovery.skipGoal(target.id, 'no longer needed');

    assert.strictEqual(W.AxiomGoalManager.getGoal(target.id).status, 'cancelled');
    assert.strictEqual(W.AxiomGoalManager.isGoalBlocked(optionalDependent.id), false);
    assert.strictEqual(W.AxiomGoalManager.isGoalBlocked(hardDependent.id), true);
    assert.ok(skipped);
    assert.strictEqual(skipped.dependentsReleased.length, 1);
    assert.strictEqual(skipped.dependentsReleased[0], optionalDependent.id);
  });

  await test('skipGoal() calls the existing scheduler/reorder path as a side effect (condition change)', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const target = W.AxiomGoalManager.createGoal({ title: 'to be skipped' });
    const other = W.AxiomGoalManager.createGoal({ title: 'independent pending goal' });
    assert.strictEqual(W.AxiomGoalManager.getGoal(other.id).status, 'pending');

    W.AxiomGoalManagerRecovery.skipGoal(target.id, 'condition changed');

    // runGoalScheduler() (invoked internally as the no-Learning
    // fallback) queues every unblocked Pending/Waiting goal.
    assert.strictEqual(W.AxiomGoalManager.getGoal(other.id).status, 'queued');
  });

  // ------------------------------------------------------------
  // Reordering
  // ------------------------------------------------------------
  await test('reorderRemainingGoals() calls AxiomGoalManagerLearning.optimizeGoalScheduling() when Part 3E is loaded', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    let called = false;
    const originalFn = W.AxiomGoalManagerLearning.optimizeGoalScheduling;
    W.AxiomGoalManagerLearning.optimizeGoalScheduling = function () { called = true; return originalFn.apply(this, arguments); };
    W.AxiomGoalManagerRecovery.reorderRemainingGoals();
    assert.strictEqual(called, true);
  });

  await test('reorderRemainingGoals() falls back to AxiomGoalManager.runGoalScheduler() when Part 3E is not loaded', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    let called = false;
    const originalFn = W.AxiomGoalManager.runGoalScheduler;
    W.AxiomGoalManager.runGoalScheduler = function () { called = true; return originalFn.apply(this, arguments); };
    W.AxiomGoalManagerRecovery.reorderRemainingGoals();
    assert.strictEqual(called, true);
  });

  // ------------------------------------------------------------
  // Event naming — no collisions with any existing event anywhere
  // in this project
  // ------------------------------------------------------------
  await test('goal_recovered/goal_resumed/goal_skipped/goal_blocked never collide with an existing emit(\'...\') anywhere else in os/core', () => {
    const coreDir = path.join(AI, 'os/core');
    const files = fs.readdirSync(coreDir).filter((f) => f.endsWith('.js') && f !== 'goal-manager-recovery.js');
    const newEvents = ['goal_recovered', 'goal_resumed', 'goal_skipped', 'goal_blocked'];
    files.forEach((f) => {
      const src = fs.readFileSync(path.join(coreDir, f), 'utf8');
      newEvents.forEach((evt) => {
        assert.strictEqual(src.indexOf("'" + evt + "'") === -1, true, evt + ' collides with an emit in ' + f);
      });
    });
  });

  // ------------------------------------------------------------
  // Frozen reads / metrics / history
  // ------------------------------------------------------------
  await test('every read-path result (checkGoalHealth, getRecoveryHistory, getRecoveryMetrics) is frozen', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'freeze me' });
    const health = W.AxiomGoalManagerRecovery.checkGoalHealth(g.id);
    assert.ok(Object.isFrozen(health));
    const metricsSnap = W.AxiomGoalManagerRecovery.getRecoveryMetrics();
    assert.ok(Object.isFrozen(metricsSnap));
    W.AxiomGoalManagerRecovery.skipGoal(g.id, 'for history');
    const history = W.AxiomGoalManagerRecovery.getRecoveryHistory();
    assert.ok(history.length > 0);
    assert.ok(Object.isFrozen(history[0]));
  });

  await test('getRecoveryMetrics() accurately tracks counts across a stall + recover + skip scenario', async () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    W.AxiomGoalManagerRecovery.setAutoRecoveryEnabled(false); // manual, deterministic counts for this test
    W.AxiomGoalManagerRecovery.setStallThresholdMs(15);

    const stallGoal = W.AxiomGoalManager.createGoal({ title: 'will stall' });
    W.AxiomGoalManager.markGoalQueued(stallGoal.id);
    W.AxiomGoalManager.markGoalRunning(stallGoal.id);
    await tick(30);
    W.AxiomGoalManagerRecovery.monitorActiveGoals();

    const failGoal = W.AxiomGoalManager.createGoal({ title: 'will fail then recover' });
    W.AxiomGoalManager.markGoalQueued(failGoal.id);
    W.AxiomGoalManager.markGoalRunning(failGoal.id);
    W.AxiomGoalManager.failGoal(failGoal.id, 'oops');
    W.AxiomGoalManagerRecovery.attemptRecovery(failGoal.id, 'test');

    const skipTarget = W.AxiomGoalManager.createGoal({ title: 'to skip' });
    W.AxiomGoalManagerRecovery.skipGoal(skipTarget.id, 'no longer needed');

    const m = W.AxiomGoalManagerRecovery.getRecoveryMetrics();
    assert.strictEqual(m.stalledDetected, 1);
    assert.strictEqual(m.resumed, 1);
    assert.strictEqual(m.recovered, 1);
    assert.strictEqual(m.skipped, 1);
  });

  await test('getRecoveryHistory() supports a limit and is most-recent-first', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const a = W.AxiomGoalManager.createGoal({ title: 'a' });
    const b = W.AxiomGoalManager.createGoal({ title: 'b' });
    W.AxiomGoalManagerRecovery.skipGoal(a.id, 'first');
    W.AxiomGoalManagerRecovery.skipGoal(b.id, 'second');
    const full = W.AxiomGoalManagerRecovery.getRecoveryHistory();
    assert.strictEqual(full[0].goalId, b.id);
    assert.strictEqual(full[1].goalId, a.id);
    const limited = W.AxiomGoalManagerRecovery.getRecoveryHistory(1);
    assert.strictEqual(limited.length, 1);
    assert.strictEqual(limited[0].goalId, b.id);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
  // Every test constructs a fresh vm sandbox that reloads
  // agent-registry-integration.js's health-poll interval and
  // capability-router.js's per-task timeout watchdog; both are
  // real (unref'd where the underlying module remembers to, not
  // everywhere) timers scoped to that sandbox's own `global`, so a
  // 30+-test run can leave the host process with dangling handles
  // that have nothing left to do. Force the exit once every
  // assertion has run and the summary above is printed — the exact
  // same thing a CI runner would do around this script.
  process.exit(process.exitCode || 0);
}

main();
