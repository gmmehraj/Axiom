// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3E: Goal Manager Learning Layer
// regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1),
// os/core/runtime-context.js (Step 6 Part 5), os/core/capability-
// router.js (Step 6 Part 3), os/core/agent-registry-integration.js
// (Part 2), os/core/goal-manager.js (Step 7 Parts 3A+3B), os/core/
// task-planner.js (Step 7 Part 2), os/core/autonomous-decision-
// engine.js (Step 7 Part 3C), os/core/decision-engine-execution-
// bridge.js (Step 7 Part 3D), then the new os/core/goal-manager-
// learning.js (Step 7 Part 3E) in a minimal vm sandbox — same pattern
// every prior Block 2 suite in this project already uses.
//
// Covers both configurations this Part explicitly supports:
//   (a) the full stack (Parts 1-3D all loaded) — autonomous execution
//       feeding the learning layer via goal-manager.js's own events;
//   (b) goal-manager.js loaded WITHOUT Part 3C/3D at all — a caller
//       driving the Goal Record by hand (completeGoal/failGoal/
//       cancelGoal/retryGoal) still gets learned from, and every
//       optional-dependency code path degrades gracefully.
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

  return sandbox.window;
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerTestAgents(W, opts) {
  opts = opts || {};
  const calls = { search: 0, remember: 0, flaky: 0 };
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
  W.AxiomOrchestrator.registerAgent({
    id: 'flaky', name: 'Flaky', capabilities: ['flaky-task'],
    permissions: [], tools: ['flaky.run'],
    handler: opts.flakyHandler || (async () => { calls.flaky++; throw new Error('synthetic failure'); })
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

// goal-manager.js's status machine only allows COMPLETED from RUNNING
// (PENDING -> QUEUED -> RUNNING -> COMPLETED) — this walks a goal
// through the real, validated chain rather than calling completeGoal()
// straight from PENDING, which the transition table refuses.
function runToCompletion(W, goalId, result) {
  W.AxiomGoalManager.markGoalQueued(goalId);
  W.AxiomGoalManager.markGoalRunning(goalId);
  return W.AxiomGoalManager.completeGoal(goalId, result);
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
  console.log('AXIOM Block 2 / Step 7 / Part 3E — Goal Manager Learning Layer regression\n');

  // ------------------------------------------------------------
  // Load-order guards
  // ------------------------------------------------------------
  await test('module does not install itself without AxiomOrchestrator present', () => {
    const sandbox = { console, setTimeout, clearTimeout, Date, Object, Array, JSON, Math, Error };
    sandbox.window = sandbox;
    sandbox.document = undefined;
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(AI, 'os/core/goal-manager-learning.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'goal-manager-learning.js' });
    assert.strictEqual(sandbox.window.AxiomGoalManagerLearning, undefined);
  });

  await test('module does not install itself without AxiomRuntimeContext present', () => {
    const W = loadSandbox({ withRuntimeContext: false, withCapabilityRouter: false, withDiscovery: false, withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/goal-manager-learning.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'goal-manager-learning.js' });
    assert.strictEqual(W.AxiomGoalManagerLearning, undefined);
  });

  await test('module does not install itself without AxiomGoalManager present', () => {
    const W = loadSandbox({ withGoalManager: false, withTaskPlanner: false, withDecisionEngine: false, withBridge: false, withLearning: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/goal-manager-learning.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'goal-manager-learning.js' });
    assert.strictEqual(W.AxiomGoalManagerLearning, undefined);
  });

  await test('module installs cleanly with the FULL stack present, without editing any dependency', () => {
    const before = {
      orchestrator: fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8'),
      runtimeContext: fs.readFileSync(path.join(AI, 'os/core/runtime-context.js'), 'utf8'),
      goalManager: fs.readFileSync(path.join(AI, 'os/core/goal-manager.js'), 'utf8'),
      taskPlanner: fs.readFileSync(path.join(AI, 'os/core/task-planner.js'), 'utf8'),
      decisionEngine: fs.readFileSync(path.join(AI, 'os/core/autonomous-decision-engine.js'), 'utf8'),
      bridge: fs.readFileSync(path.join(AI, 'os/core/decision-engine-execution-bridge.js'), 'utf8')
    };
    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomGoalManagerLearning, 'object');
    assert.strictEqual(typeof W.AxiomGoalManagerLearning.getExecutionHistory, 'function');
    // Installs nothing onto AxiomOrchestrator's own surface.
    assert.strictEqual(typeof W.AxiomOrchestrator.planGoal, 'function');
    const after = {
      orchestrator: fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8'),
      runtimeContext: fs.readFileSync(path.join(AI, 'os/core/runtime-context.js'), 'utf8'),
      goalManager: fs.readFileSync(path.join(AI, 'os/core/goal-manager.js'), 'utf8'),
      taskPlanner: fs.readFileSync(path.join(AI, 'os/core/task-planner.js'), 'utf8'),
      decisionEngine: fs.readFileSync(path.join(AI, 'os/core/autonomous-decision-engine.js'), 'utf8'),
      bridge: fs.readFileSync(path.join(AI, 'os/core/decision-engine-execution-bridge.js'), 'utf8')
    };
    assert.deepStrictEqual(before, after);
  });

  await test('module installs cleanly with ONLY goal-manager.js present (no Part 3C/3D)', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    assert.strictEqual(typeof W.AxiomGoalManagerLearning, 'object');
    assert.strictEqual(W.AxiomDecisionEngine, undefined);
    assert.strictEqual(W.AxiomDecisionEngineExecutionBridge, undefined);
  });

  // ------------------------------------------------------------
  // Recording execution history — manual driving (no Part 3C/3D)
  // ------------------------------------------------------------
  await test('a manually-completed goal (no Decision Engine/Bridge loaded) is recorded in execution history', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'manual goal', metadata: { capability: 'manual-cap' } });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.completeGoal(g.id, { ok: true });

    const hist = W.AxiomGoalManagerLearning.getExecutionHistory({ goalId: g.id });
    assert.strictEqual(hist.length, 1);
    assert.strictEqual(hist[0].outcome, 'completed');
    assert.strictEqual(hist[0].strategy, 'manual-cap');
    assert.strictEqual(typeof hist[0].durationMs, 'number');
  });

  await test('a goal with no capability metadata is grouped under the fixed "general" strategy', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'no capability here' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.completeGoal(g.id);
    const stats = W.AxiomGoalManagerLearning.getStrategyStats('general');
    assert.strictEqual(stats.successes, 1);
  });

  await test('a manually-failed goal increments failure stats for its strategy', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'manual failing goal', metadata: { capability: 'manual-cap-2' } });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.failGoal(g.id, 'synthetic manual failure');

    const stats = W.AxiomGoalManagerLearning.getStrategyStats('manual-cap-2');
    assert.strictEqual(stats.failures, 1);
    assert.strictEqual(stats.successes, 0);
    const hist = W.AxiomGoalManagerLearning.getExecutionHistory({ goalId: g.id });
    assert.strictEqual(hist[0].reason, 'synthetic manual failure');
  });

  await test('a manually-cancelled goal is recorded as a cancellation, not a failure', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'manual cancel', metadata: { capability: 'manual-cap-3' } });
    W.AxiomGoalManager.cancelGoal(g.id, 'no longer needed');
    const stats = W.AxiomGoalManagerLearning.getStrategyStats('manual-cap-3');
    assert.strictEqual(stats.cancellations, 1);
    assert.strictEqual(stats.failures, 0);
    assert.strictEqual(stats.successes, 0);
  });

  await test('a manual retry is recorded against the ORIGINAL goal\'s strategy', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'will fail then retry', metadata: { capability: 'manual-cap-4' } });
    W.AxiomGoalManager.failGoal(g.id, 'boom');
    const retried = W.AxiomGoalManager.retryGoal(g.id);
    assert.strictEqual(retried.retryOf, g.id);

    const stats = W.AxiomGoalManagerLearning.getStrategyStats('manual-cap-4');
    assert.strictEqual(stats.retries, 1);
    const hist = W.AxiomGoalManagerLearning.getExecutionHistory({ goalId: g.id, outcome: 'retry' });
    assert.strictEqual(hist.length, 1);
    assert.strictEqual(hist[0].relatedGoalId, retried.id);
  });

  // ------------------------------------------------------------
  // Recording execution history — full autonomous stack
  // ------------------------------------------------------------
  await test('an autonomously-executed successful goal is recorded via goal-manager.js\'s own events', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web', metadata: { capability: 'search-web' } });
    W.AxiomDecisionEngine.runDecisionCycle();
    await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'completed');

    const stats = W.AxiomGoalManagerLearning.getStrategyStats('search-web');
    assert.strictEqual(stats.successes, 1);
    assert.strictEqual(stats.avgDurationMs !== null, true);
  });

  await test('an autonomously-executed, exhausted-retry goal increments the "exhausted" counter (Part 3D enrichment)', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    W.AxiomDecisionEngineExecutionBridge.setMaxExecutionRetries(1);
    const g = W.AxiomGoalManager.createGoal({ title: 'run the flaky task', metadata: { capability: 'flaky-task' } });
    W.AxiomDecisionEngine.runDecisionCycle();
    await waitFor(() => W.AxiomGoalManagerLearning.getStrategyStats('flaky-task').exhausted === 1, 3000);

    const stats = W.AxiomGoalManagerLearning.getStrategyStats('flaky-task');
    assert.strictEqual(stats.failures >= 1, true);
    assert.strictEqual(stats.exhausted, 1);
  });

  await test('exhausted-retry tracking is simply absent (no throw) when Part 3D is not loaded', async () => {
    const W = loadSandbox({ withBridge: false });
    // No AxiomDecisionEngineExecutionBridge at all — the module must
    // still have installed and still work for the events it DOES own.
    assert.strictEqual(W.AxiomDecisionEngineExecutionBridge, undefined);
    const g = W.AxiomGoalManager.createGoal({ title: 'manual again', metadata: { capability: 'still-works' } });
    W.AxiomGoalManager.failGoal(g.id, 'x');
    assert.strictEqual(W.AxiomGoalManagerLearning.getStrategyStats('still-works').failures, 1);
  });

  // ------------------------------------------------------------
  // Strategy stats & scoring
  // ------------------------------------------------------------
  await test('getStrategyStats() for a never-seen strategy returns a neutral, zero-sample snapshot', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const stats = W.AxiomGoalManagerLearning.getStrategyStats('never-seen-strategy');
    assert.strictEqual(stats.attempts, 0);
    assert.strictEqual(stats.successRate, null);
    assert.strictEqual(stats.score, 0.5);
    assert.strictEqual(stats.avgDurationMs, null);
    assert.strictEqual(Object.isFrozen(stats), true);
  });

  await test('score is a deterministic Laplace-smoothed statistic, not a black-box model', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    for (let i = 0; i < 3; i++) {
      const g = W.AxiomGoalManager.createGoal({ title: 'good strategy run', metadata: { capability: 'good-strategy' } });
      W.AxiomGoalManager.markGoalRunning(W.AxiomGoalManager.markGoalQueued(g.id).goal.id);
      W.AxiomGoalManager.completeGoal(g.id);
    }
    const stats = W.AxiomGoalManagerLearning.getStrategyStats('good-strategy');
    // (3 successes + 1) / (3 + 0 + 2) = 4/5 = 0.8, exactly.
    assert.strictEqual(stats.score, 0.8);
    assert.strictEqual(stats.successRate, 1);
  });

  await test('listStrategyStats() sorts most-successful-first', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const good = W.AxiomGoalManager.createGoal({ title: 'a', metadata: { capability: 'strat-good' } });
    runToCompletion(W, good.id);

    const bad = W.AxiomGoalManager.createGoal({ title: 'b', metadata: { capability: 'strat-bad' } });
    W.AxiomGoalManager.markGoalRunning(W.AxiomGoalManager.markGoalQueued(bad.id).goal.id);
    W.AxiomGoalManager.failGoal(bad.id, 'nope');

    const list = W.AxiomGoalManagerLearning.listStrategyStats();
    const goodIdx = list.findIndex((s) => s.key === 'strat-good');
    const badIdx = list.findIndex((s) => s.key === 'strat-bad');
    assert.ok(goodIdx < badIdx);
  });

  await test('listFailingStrategies() only returns strategies at/above the failure threshold', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const onceBad = W.AxiomGoalManager.createGoal({ title: 'a', metadata: { capability: 'once-bad' } });
    W.AxiomGoalManager.failGoal(onceBad.id, 'x');

    const twiceBad1 = W.AxiomGoalManager.createGoal({ title: 'b', metadata: { capability: 'twice-bad' } });
    W.AxiomGoalManager.failGoal(twiceBad1.id, 'x');
    const twiceBad2 = W.AxiomGoalManager.createGoal({ title: 'c', metadata: { capability: 'twice-bad' } });
    W.AxiomGoalManager.failGoal(twiceBad2.id, 'x');

    const atLeastTwo = W.AxiomGoalManagerLearning.listFailingStrategies(2);
    assert.strictEqual(atLeastTwo.some((s) => s.key === 'once-bad'), false);
    assert.strictEqual(atLeastTwo.some((s) => s.key === 'twice-bad'), true);
  });

  // ------------------------------------------------------------
  // Recommend a better execution order
  // ------------------------------------------------------------
  await test('recommendGoalOrder() reorders two independent, same-priority goals toward the historically stronger strategy', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });

    // Seed history: 'strong' has a much better track record than 'weak'.
    for (let i = 0; i < 5; i++) {
      const s = W.AxiomGoalManager.createGoal({ title: 'seed strong', metadata: { capability: 'strong' } });
      runToCompletion(W, s.id);
      const w = W.AxiomGoalManager.createGoal({ title: 'seed weak', metadata: { capability: 'weak' } });
      W.AxiomGoalManager.failGoal(w.id, 'x');
    }

    // 'weak' created first, so the raw execution order (same priority,
    // tie-broken by createdAt) would put it ahead of 'strong'.
    const gWeak = W.AxiomGoalManager.createGoal({ title: 'do weak thing', metadata: { capability: 'weak' } });
    const gStrong = W.AxiomGoalManager.createGoal({ title: 'do strong thing', metadata: { capability: 'strong' } });

    const rawOrder = W.AxiomGoalManager.getGoalExecutionOrder({ goalIds: [gWeak.id, gStrong.id] });
    assert.strictEqual(rawOrder[0].id, gWeak.id); // raw order: weak first (older)

    const recommended = W.AxiomGoalManagerLearning.recommendGoalOrder({ goalIds: [gWeak.id, gStrong.id] });
    assert.strictEqual(recommended[0].id, gStrong.id); // learned order: strong first
    assert.strictEqual(recommended[1].id, gWeak.id);
  });

  await test('recommendGoalOrder() never reorders across different priority tiers', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    for (let i = 0; i < 5; i++) {
      const s = W.AxiomGoalManager.createGoal({ title: 'seed', metadata: { capability: 'low-prio-strategy' } });
      runToCompletion(W, s.id);
    }
    const high = W.AxiomGoalManager.createGoal({ title: 'high prio, no history', priority: W.AxiomGoalManager.GOAL_PRIORITY.HIGH });
    const low = W.AxiomGoalManager.createGoal({ title: 'low prio, great history', priority: W.AxiomGoalManager.GOAL_PRIORITY.LOW, metadata: { capability: 'low-prio-strategy' } });

    const recommended = W.AxiomGoalManagerLearning.recommendGoalOrder({ goalIds: [high.id, low.id] });
    assert.strictEqual(recommended[0].id, high.id); // priority always wins
  });

  await test('recommendGoalOrder() never violates a real dependency edge', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    for (let i = 0; i < 5; i++) {
      const s = W.AxiomGoalManager.createGoal({ title: 'seed', metadata: { capability: 'dependent-strategy' } });
      runToCompletion(W, s.id);
    }
    const prereq = W.AxiomGoalManager.createGoal({ title: 'prereq (weak history)', metadata: { capability: 'no-history-strategy' } });
    const dependent = W.AxiomGoalManager.createGoal({ title: 'dependent (strong history)', metadata: { capability: 'dependent-strategy' } });
    W.AxiomGoalManager.addGoalDependency(dependent.id, prereq.id);

    const recommended = W.AxiomGoalManagerLearning.recommendGoalOrder({ goalIds: [prereq.id, dependent.id] });
    assert.strictEqual(recommended[0].id, prereq.id); // prerequisite must still come first
    assert.strictEqual(recommended[1].id, dependent.id);
  });

  await test('a swap threshold below the score gap is a no-op (churn control)', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    W.AxiomGoalManagerLearning.setSwapThreshold(0.99); // effectively disables reordering
    const s = W.AxiomGoalManager.createGoal({ title: 'seed', metadata: { capability: 'strong-2' } });
    runToCompletion(W, s.id);

    const gWeak = W.AxiomGoalManager.createGoal({ title: 'weak', metadata: { capability: 'weak-2' } });
    const gStrong = W.AxiomGoalManager.createGoal({ title: 'strong', metadata: { capability: 'strong-2' } });
    const recommended = W.AxiomGoalManagerLearning.recommendGoalOrder({ goalIds: [gWeak.id, gStrong.id] });
    assert.strictEqual(recommended[0].id, gWeak.id); // unchanged — threshold too high to justify a swap
    assert.strictEqual(W.AxiomGoalManagerLearning.getSwapThreshold(), 0.99);
  });

  // ------------------------------------------------------------
  // Optimize future goal scheduling
  // ------------------------------------------------------------
  await test('optimizeGoalScheduling() queues goals in the learned order and returns the runGoalScheduler() shape', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    for (let i = 0; i < 5; i++) {
      const s = W.AxiomGoalManager.createGoal({ title: 'seed', metadata: { capability: 'sched-strong' } });
      runToCompletion(W, s.id);
    }
    const gWeak = W.AxiomGoalManager.createGoal({ title: 'weak', metadata: { capability: 'sched-weak' } });
    const gStrong = W.AxiomGoalManager.createGoal({ title: 'strong', metadata: { capability: 'sched-strong' } });

    const result = W.AxiomGoalManagerLearning.optimizeGoalScheduling({ goalIds: [gWeak.id, gStrong.id] });
    assert.strictEqual(result.scheduled.length, 2);
    assert.strictEqual(result.scheduled[0].id, gStrong.id); // strong scheduled first
    assert.strictEqual(result.scheduled[1].id, gWeak.id);
    assert.strictEqual(W.AxiomGoalManager.getGoal(gStrong.id).status, 'queued');
    assert.strictEqual(W.AxiomGoalManager.getGoal(gWeak.id).status, 'queued');
  });

  await test('optimizeGoalScheduling() reports blocked goals exactly like runGoalScheduler()', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const prereq = W.AxiomGoalManager.createGoal({ title: 'prereq' });
    const dependent = W.AxiomGoalManager.createGoal({ title: 'dependent' });
    W.AxiomGoalManager.addGoalDependency(dependent.id, prereq.id);

    const result = W.AxiomGoalManagerLearning.optimizeGoalScheduling({ goalIds: [prereq.id, dependent.id] });
    assert.strictEqual(result.scheduled.some((g) => g.id === prereq.id), true);
    assert.strictEqual(result.blocked.some((g) => g.id === dependent.id), true);
  });

  // ------------------------------------------------------------
  // Improve prioritization using historical data
  // ------------------------------------------------------------
  await test('getRecommendedPriority() declines to recommend with too little history', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'brand new', metadata: { capability: 'brand-new-strategy' } });
    const rec = W.AxiomGoalManagerLearning.getRecommendedPriority(g.id);
    assert.strictEqual(rec.recommended, null);
    assert.strictEqual(typeof rec.reason, 'string');
  });

  await test('getRecommendedPriority() suggests HIGH for a strategy with a strong track record', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    for (let i = 0; i < 5; i++) {
      const s = W.AxiomGoalManager.createGoal({ title: 'seed', metadata: { capability: 'reliable-strategy' } });
      runToCompletion(W, s.id);
    }
    const g = W.AxiomGoalManager.createGoal({ title: 'next one', metadata: { capability: 'reliable-strategy' } });
    const rec = W.AxiomGoalManagerLearning.getRecommendedPriority(g.id);
    assert.strictEqual(rec.recommended, W.AxiomGoalManager.GOAL_PRIORITY.HIGH);
  });

  await test('getRecommendedPriority() suggests LOW for a strategy with a poor track record', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    for (let i = 0; i < 5; i++) {
      const s = W.AxiomGoalManager.createGoal({ title: 'seed', metadata: { capability: 'unreliable-strategy' } });
      W.AxiomGoalManager.failGoal(s.id, 'x');
    }
    const g = W.AxiomGoalManager.createGoal({ title: 'next one', metadata: { capability: 'unreliable-strategy' } });
    const rec = W.AxiomGoalManagerLearning.getRecommendedPriority(g.id);
    assert.strictEqual(rec.recommended, W.AxiomGoalManager.GOAL_PRIORITY.LOW);
  });

  await test('applyRecommendedPriority() actually calls setGoalPriority() and emits an event', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    for (let i = 0; i < 5; i++) {
      const s = W.AxiomGoalManager.createGoal({ title: 'seed', metadata: { capability: 'apply-strategy' } });
      W.AxiomGoalManager.failGoal(s.id, 'x');
    }
    const g = W.AxiomGoalManager.createGoal({ title: 'next one', priority: W.AxiomGoalManager.GOAL_PRIORITY.NORMAL, metadata: { capability: 'apply-strategy' } });

    const events = [];
    W.AxiomOrchestrator.on('goalmgrlearn_priority_applied', (p) => events.push(p));
    const result = W.AxiomGoalManagerLearning.applyRecommendedPriority(g.id);

    assert.strictEqual(result.applied, true);
    assert.strictEqual(W.AxiomGoalManager.getGoal(g.id).priority, W.AxiomGoalManager.GOAL_PRIORITY.LOW);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].to, W.AxiomGoalManager.GOAL_PRIORITY.LOW);
  });

  await test('applyRecommendedPriority() is a no-op when already at the recommended priority', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    for (let i = 0; i < 5; i++) {
      const s = W.AxiomGoalManager.createGoal({ title: 'seed', metadata: { capability: 'noop-strategy' } });
      runToCompletion(W, s.id);
    }
    const g = W.AxiomGoalManager.createGoal({ title: 'already high', priority: W.AxiomGoalManager.GOAL_PRIORITY.HIGH, metadata: { capability: 'noop-strategy' } });
    const result = W.AxiomGoalManagerLearning.applyRecommendedPriority(g.id);
    assert.strictEqual(result.applied, false);
  });

  await test('getRecommendedPriority() throws for an unknown goal id (same posture as the rest of the stack)', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    assert.throws(() => W.AxiomGoalManagerLearning.getRecommendedPriority('goal_does_not_exist'));
  });

  // ------------------------------------------------------------
  // Aggregate analytics reuse
  // ------------------------------------------------------------
  await test('getLearningMetrics() folds in existing Goal Manager + Runtime Context metrics without re-deriving them', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'x' });
    runToCompletion(W, g.id);
    const metrics = W.AxiomGoalManagerLearning.getLearningMetrics();
    assert.deepStrictEqual(metrics.goals, W.AxiomGoalManager.getGoalMetrics());
    assert.deepStrictEqual(metrics.systemLoad, W.AxiomRuntimeContext.getContextMetrics());
    assert.strictEqual(metrics.strategies.recorded, 1);
    assert.strictEqual(metrics.decisions, undefined); // Decision Engine not loaded in this config
    assert.strictEqual(metrics.execution, undefined); // Bridge not loaded in this config
  });

  await test('getLearningMetrics() includes decisions/execution when Parts 3C/3D are loaded', () => {
    const W = loadSandbox();
    const metrics = W.AxiomGoalManagerLearning.getLearningMetrics();
    assert.deepStrictEqual(metrics.decisions, W.AxiomDecisionEngine.getDecisionMetrics());
    assert.deepStrictEqual(metrics.execution, W.AxiomDecisionEngineExecutionBridge.getExecutionMetrics());
  });

  // ------------------------------------------------------------
  // Immutability & validation
  // ------------------------------------------------------------
  await test('every read-path result is frozen (no accidental external mutation)', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const g = W.AxiomGoalManager.createGoal({ title: 'x', metadata: { capability: 'freeze-check' } });
    runToCompletion(W, g.id);
    assert.strictEqual(Object.isFrozen(W.AxiomGoalManagerLearning.getExecutionHistory()[0]), true);
    assert.strictEqual(Object.isFrozen(W.AxiomGoalManagerLearning.getStrategyStats('freeze-check')), true);
    assert.strictEqual(Object.isFrozen(W.AxiomGoalManagerLearning.getLearningMetrics()), true);
    assert.strictEqual(Object.isFrozen(W.AxiomGoalManagerLearning.getRecommendedPriority(g.id)), true);
  });

  await test('setSwapThreshold() rejects out-of-range values', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    assert.throws(() => W.AxiomGoalManagerLearning.setSwapThreshold(1.5));
    assert.throws(() => W.AxiomGoalManagerLearning.setSwapThreshold(-0.1));
    assert.throws(() => W.AxiomGoalManagerLearning.setSwapThreshold('nope'));
  });

  await test('setMinSamplesForRecommendation() rejects non-integers and negatives', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    assert.throws(() => W.AxiomGoalManagerLearning.setMinSamplesForRecommendation(-1));
    assert.throws(() => W.AxiomGoalManagerLearning.setMinSamplesForRecommendation(1.5));
    assert.strictEqual(W.AxiomGoalManagerLearning.setMinSamplesForRecommendation(5), 5);
    assert.strictEqual(W.AxiomGoalManagerLearning.getMinSamplesForRecommendation(), 5);
  });

  await test('getExecutionHistory() supports goalId/strategy/outcome filters and a limit, most-recent-first', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const g1 = W.AxiomGoalManager.createGoal({ title: 'a', metadata: { capability: 'filter-cap' } });
    runToCompletion(W, g1.id);
    const g2 = W.AxiomGoalManager.createGoal({ title: 'b', metadata: { capability: 'filter-cap' } });
    W.AxiomGoalManager.failGoal(g2.id, 'x');

    const byStrategy = W.AxiomGoalManagerLearning.getExecutionHistory({ strategy: 'filter-cap' });
    assert.strictEqual(byStrategy.length, 2);
    assert.strictEqual(byStrategy[0].goalId, g2.id); // most recent first

    const byOutcome = W.AxiomGoalManagerLearning.getExecutionHistory({ outcome: 'failed' });
    assert.strictEqual(byOutcome.every((e) => e.outcome === 'failed'), true);

    const limited = W.AxiomGoalManagerLearning.getExecutionHistory({}, 1);
    assert.strictEqual(limited.length, 1);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
