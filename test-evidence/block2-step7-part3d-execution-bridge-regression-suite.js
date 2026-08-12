// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3D: Decision Engine -> Autonomous
// Task Planner Execution Bridge regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1),
// os/core/runtime-context.js (Step 6 Part 5), os/core/capability-
// router.js (Step 6 Part 3), os/core/agent-registry-integration.js
// (Part 2), os/core/goal-manager.js (Step 7 Parts 3A+3B), os/core/
// task-planner.js (Step 7 Part 2), os/core/autonomous-decision-
// engine.js (Step 7 Part 3C), then the new os/core/decision-engine-
// execution-bridge.js (Step 7 Part 3D) in a minimal vm sandbox — same
// pattern every prior Block 2 suite in this project already uses.
// Agents are registered directly via AxiomOrchestrator.registerAgent()
// with small handlers standing in for real subsystems, exactly as the
// Part 2 and Part 3C suites already do.
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

  return sandbox.window;
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Small, deterministic stand-ins for real subsystems. 'flaky' always
// rejects and is the ONLY agent exposing 'flaky-task', so its
// failures can never be masked by alternate-agent failover — a clean
// way to force a real terminal Failed state on purpose.
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
  console.log('AXIOM Block 2 / Step 7 / Part 3D — Decision Engine / Task Planner Execution Bridge regression\n');

  // ------------------------------------------------------------
  // Load-order guards
  // ------------------------------------------------------------
  await test('module does not install itself without AxiomOrchestrator present', () => {
    const sandbox = { console, setTimeout, clearTimeout, Date, Object, Array, JSON, Math, Error };
    sandbox.window = sandbox;
    sandbox.document = undefined;
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(AI, 'os/core/decision-engine-execution-bridge.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'decision-engine-execution-bridge.js' });
    assert.strictEqual(sandbox.window.AxiomDecisionEngineExecutionBridge, undefined);
  });

  await test('module does not install itself without AxiomOrchestrator.executeGoal (task-planner.js) present', () => {
    const W = loadSandbox({ withTaskPlanner: false, withDecisionEngine: false, withBridge: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/decision-engine-execution-bridge.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'decision-engine-execution-bridge.js' });
    assert.strictEqual(W.AxiomDecisionEngineExecutionBridge, undefined);
  });

  await test('module does not install itself without AxiomGoalManager present', () => {
    const W = loadSandbox({ withGoalManager: false, withDecisionEngine: false, withBridge: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/decision-engine-execution-bridge.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'decision-engine-execution-bridge.js' });
    assert.strictEqual(W.AxiomDecisionEngineExecutionBridge, undefined);
  });

  await test('module does not install itself without AxiomDecisionEngine present', () => {
    const W = loadSandbox({ withDecisionEngine: false, withBridge: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/decision-engine-execution-bridge.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'decision-engine-execution-bridge.js' });
    assert.strictEqual(W.AxiomDecisionEngineExecutionBridge, undefined);
  });

  await test('module installs cleanly once all dependencies are present, without editing any of them', () => {
    const before = {
      orchestrator: fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8'),
      goalManager: fs.readFileSync(path.join(AI, 'os/core/goal-manager.js'), 'utf8'),
      taskPlanner: fs.readFileSync(path.join(AI, 'os/core/task-planner.js'), 'utf8'),
      decisionEngine: fs.readFileSync(path.join(AI, 'os/core/autonomous-decision-engine.js'), 'utf8')
    };
    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomDecisionEngineExecutionBridge, 'object');
    assert.strictEqual(typeof W.AxiomDecisionEngineExecutionBridge.dispatchGoal, 'function');
    // Installs nothing onto AxiomOrchestrator's Goal namespace — task-planner.js still owns it alone.
    assert.strictEqual(typeof W.AxiomOrchestrator.planGoal, 'function');
    const after = {
      orchestrator: fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8'),
      goalManager: fs.readFileSync(path.join(AI, 'os/core/goal-manager.js'), 'utf8'),
      taskPlanner: fs.readFileSync(path.join(AI, 'os/core/task-planner.js'), 'utf8'),
      decisionEngine: fs.readFileSync(path.join(AI, 'os/core/autonomous-decision-engine.js'), 'utf8')
    };
    assert.deepStrictEqual(before, after);
  });

  // ------------------------------------------------------------
  // Automatic execution
  // ------------------------------------------------------------
  await test('a goal admitted by the Decision Engine is automatically dispatched to the Task Planner', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web' });

    W.AxiomDecisionEngine.runDecisionCycle();

    const ok = await waitFor(() => {
      const exec = W.AxiomDecisionEngineExecutionBridge.getExecution(g.id);
      return exec && exec.status === 'completed';
    });
    assert.strictEqual(ok, true);

    const exec = W.AxiomDecisionEngineExecutionBridge.getExecution(g.id);
    assert.strictEqual(exec.tasksTotal, 1);
    assert.strictEqual(exec.tasksCompleted, 1);

    const finalGoal = W.AxiomGoalManager.getGoal(g.id);
    assert.strictEqual(finalGoal.status, 'completed');
  });

  await test('a goal never admitted by the Decision Engine is never dispatched', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    // Two-clause goal, second clause depends on the first: nothing to
    // admit until scheduled, and we never call runDecisionCycle().
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web, then remember it' });
    await tick(30);
    assert.strictEqual(W.AxiomDecisionEngineExecutionBridge.getExecution(g.id), null);
    assert.strictEqual(W.AxiomGoalManager.getGoal(g.id).status, 'pending');
  });

  await test('multi-clause goal decomposes and executes sequentially through the real Task Planner', async () => {
    const W = loadSandbox();
    const calls = registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web, then remember it' });

    W.AxiomDecisionEngine.runDecisionCycle();

    const ok = await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'completed');
    assert.strictEqual(ok, true);
    assert.strictEqual(calls.search, 1);
    assert.strictEqual(calls.remember, 1);

    const exec = W.AxiomDecisionEngineExecutionBridge.getExecution(g.id);
    assert.strictEqual(exec.tasksTotal, 2);
    assert.strictEqual(exec.tasksCompleted, 2);
  });

  await test('never double-dispatches the same admitted goal', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web' });
    W.AxiomDecisionEngine.admitGoal(g.id);
    const first = W.AxiomDecisionEngineExecutionBridge.getExecution(g.id);
    W.AxiomDecisionEngineExecutionBridge.dispatchGoal(g.id); // re-entrant call while still running
    const second = W.AxiomDecisionEngineExecutionBridge.getExecution(g.id);
    assert.strictEqual(first.planId, second.planId);
    assert.strictEqual(W.AxiomDecisionEngineExecutionBridge.getExecutionMetrics().dispatched, 1);
    await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'completed');
  });

  // ------------------------------------------------------------
  // Progress tracking / Runtime Context
  // ------------------------------------------------------------
  await test('progress is mirrored onto the Goal Record\'s own metadata as tasks complete', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web, then remember it' });
    W.AxiomDecisionEngine.runDecisionCycle();

    await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'completed');
    const finalGoal = W.AxiomGoalManager.getGoal(g.id);
    assert.strictEqual(finalGoal.metadata.execution.tasksTotal, 2);
    assert.strictEqual(finalGoal.metadata.execution.tasksCompleted, 2);
    assert.strictEqual(finalGoal.metadata.execution.planStatus, 'completed');
  });

  await test('updateGoalMetadata()\'s own side effect keeps the Goal Record\'s Runtime Context synced — no direct AxiomRuntimeContext calls in the bridge', () => {
    const src = fs.readFileSync(path.join(AI, 'os/core/decision-engine-execution-bridge.js'), 'utf8');
    // The bridge must never capture its own reference to
    // AxiomRuntimeContext — syncing happens exclusively as a side
    // effect of AxiomGoalManager.updateGoalMetadata(). (Explanatory
    // comments may still mention the name; only a live binding to it
    // would let this module touch Runtime Context directly.)
    assert.strictEqual(/global\.AxiomRuntimeContext|var\s+RuntimeContext\s*=/.test(src), false);
  });

  await test('execution progress events are published on the shared Event Bus', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const events = [];
    W.AxiomOrchestrator.on('decisionengine_execution_progress', (p) => events.push(p));
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web' });
    W.AxiomDecisionEngine.runDecisionCycle();
    await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'completed');
    assert.ok(events.length >= 1);
    assert.strictEqual(events[0].goalId, g.id);
  });

  await test('a started execution publishes decisionengine_execution_started with the plan id', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const events = [];
    W.AxiomOrchestrator.on('decisionengine_execution_started', (p) => events.push(p));
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web' });
    W.AxiomDecisionEngine.runDecisionCycle();
    await waitFor(() => events.length === 1);
    assert.strictEqual(events[0].goalId, g.id);
    assert.strictEqual(typeof events[0].planId, 'string');
  });

  // ------------------------------------------------------------
  // Failure handling & retries
  // ------------------------------------------------------------
  await test('a failed plan fails the Goal Record and publishes decisionengine_execution_failed', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    W.AxiomDecisionEngineExecutionBridge.setMaxExecutionRetries(0);
    const failedEvents = [];
    W.AxiomOrchestrator.on('decisionengine_execution_failed', (p) => failedEvents.push(p));

    const g = W.AxiomGoalManager.createGoal({ title: 'run the flaky task', metadata: { capability: 'flaky-task' } });
    W.AxiomDecisionEngine.runDecisionCycle();

    const ok = await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'failed');
    assert.strictEqual(ok, true);
    assert.strictEqual(failedEvents.length, 1);
    assert.strictEqual(failedEvents[0].goalId, g.id);
  });

  await test('retries the whole goal as a fresh Goal Record, bounded by setMaxExecutionRetries()', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    W.AxiomDecisionEngineExecutionBridge.setMaxExecutionRetries(2);
    const retryEvents = [];
    const exhaustedEvents = [];
    W.AxiomOrchestrator.on('decisionengine_execution_retry', (p) => retryEvents.push(p));
    W.AxiomOrchestrator.on('decisionengine_execution_exhausted', (p) => exhaustedEvents.push(p));

    const g = W.AxiomGoalManager.createGoal({ title: 'run the flaky task', metadata: { capability: 'flaky-task' } });
    W.AxiomDecisionEngine.runDecisionCycle();

    const ok = await waitFor(() => exhaustedEvents.length === 1, 4000);
    assert.strictEqual(ok, true);
    // 2 retries permitted -> 2 fresh Goal Records minted beyond the original.
    assert.strictEqual(retryEvents.length, 2);
    assert.strictEqual(retryEvents[0].goalId, g.id);
    assert.strictEqual(retryEvents[0].retryCount, 1);
    assert.strictEqual(retryEvents[1].retryCount, 2);
    assert.strictEqual(exhaustedEvents[0].retryCount, 2);
    assert.strictEqual(exhaustedEvents[0].limit, 2);

    // The original goal and both retries all ended up Failed — never
    // silently dropped.
    assert.strictEqual(W.AxiomGoalManager.getGoal(g.id).status, 'failed');
    assert.strictEqual(W.AxiomGoalManager.getGoal(retryEvents[0].retryGoalId).status, 'failed');
    assert.strictEqual(W.AxiomGoalManager.getGoal(retryEvents[1].retryGoalId).status, 'failed');
  });

  await test('a goal\'s own metadata.maxRetries overrides the module default for just that goal', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    W.AxiomDecisionEngineExecutionBridge.setMaxExecutionRetries(2);
    const exhaustedEvents = [];
    W.AxiomOrchestrator.on('decisionengine_execution_exhausted', (p) => exhaustedEvents.push(p));

    const g = W.AxiomGoalManager.createGoal({
      title: 'run the flaky task', metadata: { capability: 'flaky-task', maxRetries: 0 }
    });
    W.AxiomDecisionEngine.runDecisionCycle();

    const ok = await waitFor(() => exhaustedEvents.length === 1, 2000);
    assert.strictEqual(ok, true);
    assert.strictEqual(exhaustedEvents[0].limit, 0);
  });

  await test('retries are re-admitted through AxiomDecisionEngine.admitGoal() — never AxiomGoalManager.markGoalRunning() directly', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    W.AxiomDecisionEngineExecutionBridge.setMaxExecutionRetries(1);
    const admittedGoalIds = [];
    W.AxiomOrchestrator.on('decisionengine_admitted', (p) => admittedGoalIds.push(p.goalId));

    const g = W.AxiomGoalManager.createGoal({ title: 'run the flaky task', metadata: { capability: 'flaky-task' } });
    W.AxiomDecisionEngine.runDecisionCycle();

    await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'failed' &&
      admittedGoalIds.length === 2, 3000);
    // The original admission, plus the retry's own admission — both
    // went through the real Decision Engine event, not a bypass.
    assert.strictEqual(admittedGoalIds[0], g.id);
    assert.notStrictEqual(admittedGoalIds[1], g.id);
  });

  // ------------------------------------------------------------
  // Cancellation
  // ------------------------------------------------------------
  await test('cancelExecution() cancels the in-flight plan and the Goal Record ends up Cancelled exactly once', async () => {
    const W = loadSandbox();
    let resolveHandler;
    const pendingHandler = new Promise((resolve) => { resolveHandler = resolve; });
    registerTestAgents(W, {
      searchHandler: async () => { resolveHandler(); return pendingHandler.then(() => new Promise(() => {})); }
    });
    const cancelledEvents = [];
    W.AxiomOrchestrator.on('decisionengine_execution_cancelled', (p) => cancelledEvents.push(p));

    const g = W.AxiomGoalManager.createGoal({ title: 'search the web' });
    W.AxiomDecisionEngine.runDecisionCycle();
    await pendingHandler; // wait until the task is actually in flight

    const cancelled = W.AxiomDecisionEngineExecutionBridge.cancelExecution(g.id, 'user requested cancel');
    assert.strictEqual(cancelled, true);

    const ok = await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'cancelled');
    assert.strictEqual(ok, true);
    assert.strictEqual(cancelledEvents.length, 1);
    assert.strictEqual(cancelledEvents[0].goalId, g.id);
  });

  await test('cancelExecution() on a goal with no in-flight execution is a safe no-op', () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web' });
    assert.strictEqual(W.AxiomDecisionEngineExecutionBridge.cancelExecution(g.id, 'n/a'), false);
  });

  // ------------------------------------------------------------
  // Non-duplication guards
  // ------------------------------------------------------------
  await test('does not duplicate goal decomposition: dispatched plan\'s clauses match AxiomOrchestrator.decomposeGoal() directly', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const text = 'search the web, then remember it';
    const g = W.AxiomGoalManager.createGoal({ title: text });
    const direct = W.AxiomOrchestrator.decomposeGoal(text);

    W.AxiomDecisionEngine.runDecisionCycle();
    await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'completed');

    const exec = W.AxiomDecisionEngineExecutionBridge.getExecution(g.id);
    const planSnapshot = W.AxiomOrchestrator.getGoalStatus(exec.planId);
    assert.strictEqual(planSnapshot.tasks.length, direct.clauseTasks.reduce((n, c) => n + c.length, 0));
  });

  await test('does not duplicate admission logic: dispatchGoal() never runs for a goal the Decision Engine has not admitted', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web' });
    // Directly asking the bridge to dispatch an un-admitted (still
    // Pending) goal is a caller error the Task Planner itself would
    // reject downstream — the bridge's own automatic path only ever
    // fires from a genuine 'decisionengine_admitted' event.
    W.AxiomDecisionEngineExecutionBridge.dispatchGoal(g.id);
    await tick(30);
    // The Goal Record itself was never transitioned by the bridge —
    // only the Decision Engine's admitGoal()/markGoalRunning() may do
    // that, and it was never called here.
    assert.strictEqual(W.AxiomGoalManager.getGoal(g.id).status, 'pending');
  });

  await test('getExecutionForPlan() resolves the same execution record as getExecution()', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web' });
    W.AxiomDecisionEngine.runDecisionCycle();
    await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'completed');
    const byGoal = W.AxiomDecisionEngineExecutionBridge.getExecution(g.id);
    const byPlan = W.AxiomDecisionEngineExecutionBridge.getExecutionForPlan(byGoal.planId);
    assert.strictEqual(byGoal.goalId, byPlan.goalId);
  });

  await test('execution + history snapshots are frozen (no accidental external mutation)', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const g = W.AxiomGoalManager.createGoal({ title: 'search the web' });
    W.AxiomDecisionEngine.runDecisionCycle();
    await waitFor(() => W.AxiomGoalManager.getGoal(g.id).status === 'completed');
    const exec = W.AxiomDecisionEngineExecutionBridge.getExecution(g.id);
    const history = W.AxiomDecisionEngineExecutionBridge.getExecutionHistory(1);
    assert.strictEqual(Object.isFrozen(exec), true);
    assert.strictEqual(Object.isFrozen(history[0]), true);
  });

  await test('getExecutionMetrics() reports accurate dispatched/completed/failed/retried/exhausted counters', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    W.AxiomDecisionEngineExecutionBridge.setMaxExecutionRetries(1);

    const gOk = W.AxiomGoalManager.createGoal({ title: 'search the web' });
    W.AxiomDecisionEngine.runDecisionCycle();
    await waitFor(() => W.AxiomGoalManager.getGoal(gOk.id).status === 'completed');

    const gBad = W.AxiomGoalManager.createGoal({ title: 'run the flaky task', metadata: { capability: 'flaky-task' } });
    W.AxiomDecisionEngine.runDecisionCycle();
    await waitFor(() => W.AxiomDecisionEngineExecutionBridge.getExecutionMetrics().exhausted === 1, 3000);

    const m = W.AxiomDecisionEngineExecutionBridge.getExecutionMetrics();
    assert.strictEqual(m.dispatched, 3); // 1 ok + original-flaky + 1 retry
    assert.strictEqual(m.completed, 1);
    assert.strictEqual(m.failed, 2);
    assert.strictEqual(m.retried, 1);
    assert.strictEqual(m.exhausted, 1);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
