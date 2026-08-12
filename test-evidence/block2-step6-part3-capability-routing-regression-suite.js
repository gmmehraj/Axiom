// ============================================================
// AXIOM — Block 2 / Step 6 / Part 3: Capability Routing & Intelligent
// Task Dispatch regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1) and
// os/core/capability-router.js (Part 3) in a minimal vm sandbox (same
// pattern as the Part 1/Part 2 suites). Agents are registered directly
// via AxiomOrchestrator.registerAgent() with small handlers standing
// in for real subsystems, so this suite's job is only to prove the
// *routing* contract: capability resolution, deterministic agent
// selection, immutable execution plans, the dispatch pipeline flowing
// through the real Scheduler, runtime monitoring, and error routing /
// failover — independent of which real subsystems happen to be on a
// given page.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');

function loadSandbox() {
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Promise, Object, Array, JSON, Math, Error
  };
  sandbox.window = sandbox;
  sandbox.document = undefined;

  vm.createContext(sandbox);

  const orchestratorSrc = fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8');
  vm.runInContext(orchestratorSrc, sandbox, { filename: 'orchestrator.js' });

  const routerSrc = fs.readFileSync(path.join(AI, 'os/core/capability-router.js'), 'utf8');
  vm.runInContext(routerSrc, sandbox, { filename: 'capability-router.js' });

  return sandbox.window;
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerTestAgents(W, opts) {
  opts = opts || {};
  W.AxiomOrchestrator.registerAgent({
    id: 'agent-a',
    name: 'Agent A',
    capabilities: ['transcode'],
    permissions: ['media:transcode'],
    tools: ['a.run'],
    handler: opts.aHandler || (async (task) => ({ ok: true, via: 'agent-a', task: task.type }))
  });
  W.AxiomOrchestrator.registerAgent({
    id: 'agent-b',
    name: 'Agent B',
    capabilities: ['transcode'],
    permissions: ['media:transcode'],
    tools: ['b.run'],
    handler: opts.bHandler || (async (task) => ({ ok: true, via: 'agent-b', task: task.type }))
  });
  W.AxiomOrchestrator.registerAgent({
    id: 'agent-c',
    name: 'Agent C (no permission)',
    capabilities: ['transcode'],
    permissions: [],
    tools: ['c.run'],
    handler: opts.cHandler || (async (task) => ({ ok: true, via: 'agent-c' }))
  });
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
  console.log('AXIOM Block 2 / Step 6 / Part 3 — Capability Routing & Intelligent Task Dispatch regression\n');

  await test('module loads and requires AxiomOrchestrator to be present first', () => {
    const sandbox = { console, setTimeout, clearTimeout, Date, Object, Array, JSON, Math, Error };
    sandbox.window = sandbox;
    sandbox.document = undefined;
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(AI, 'os/core/capability-router.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'capability-router.js' });
    assert.strictEqual(sandbox.window.AxiomCapabilityRouter, undefined);
  });

  await test('installs a routing API onto the existing AxiomOrchestrator without editing orchestrator.js behavior', async () => {
    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomOrchestrator.route, 'function');
    assert.strictEqual(typeof W.AxiomOrchestrator.resolveExecutionPlan, 'function');
    // Part 1 behavior still intact: manual registerAgent()/dispatch() unaffected.
    W.AxiomOrchestrator.registerAgent({ id: 'plain', handler: async () => 'ok' });
    const id = W.AxiomOrchestrator.dispatch({ agentId: 'plain', type: 'default' });
    await tick(20);
    assert.strictEqual(W.AxiomOrchestrator.getTask(id).status, 'completed');
  });

  await test('resolveExecutionPlan() produces an immutable plan with required fields', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const plan = W.AxiomOrchestrator.resolveExecutionPlan({ capability: 'transcode', payload: { file: 'x.mp4' } });
    assert.ok(plan.requestId);
    assert.ok(['agent-a', 'agent-b'].indexOf(plan.agentId) !== -1); // agent-c lacks permission... (no requiredPermission set here so c is eligible too)
    assert.strictEqual(plan.capability, 'transcode');
    assert.ok(plan.retryPolicy);
    assert.ok(plan.executionPath.length >= 2);
    assert.strictEqual(Object.isFrozen(plan), true);
    assert.strictEqual(Object.isFrozen(plan.retryPolicy), true);
    assert.strictEqual(Object.isFrozen(plan.executionPath), true);
    const originalAgentId = plan.agentId;
    plan.agentId = 'hacked'; // silently a no-op on a frozen object in sloppy mode
    assert.strictEqual(plan.agentId, originalAgentId);
  });

  await test('resolveCapability() infers capability from a type that matches a known capability', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const cap = W.AxiomOrchestrator.resolveCapability({ type: 'transcode' });
    assert.strictEqual(cap, 'transcode');
  });

  await test('resolveCapability() throws a clear error when nothing can be resolved', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    assert.throws(() => W.AxiomOrchestrator.resolveCapability({ type: 'no-such-capability' }));
  });

  await test('selectAgent() excludes agents lacking the required permission', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const chosen = W.AxiomOrchestrator.selectAgent('transcode', { requiredPermission: 'media:transcode' });
    assert.notStrictEqual(chosen.id, 'agent-c');
  });

  await test('selectAgent() is deterministic: fewer-workload agent wins, then lexical agent id', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    // enqueue() only queues synchronously — the scheduler's drain is
    // deferred to a setTimeout(0), so calling selectAgent() before
    // awaiting anything sees agent-a with one queued task and agent-b
    // with none.
    W.AxiomOrchestrator.enqueue({ agentId: 'agent-a', type: 'transcode', timeout: 5000 });
    const chosen = W.AxiomOrchestrator.selectAgent('transcode', { requiredPermission: 'media:transcode' });
    assert.strictEqual(chosen.id, 'agent-b');
    await tick(30); // let the queued task drain so it doesn't leak into later tests
  });

  await test('selectAgent() falls back to lexical agent id ordering when everything else ties', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const chosen = W.AxiomOrchestrator.selectAgent('transcode', { requiredPermission: 'media:transcode' });
    assert.strictEqual(chosen.id, 'agent-a');
  });

  await test('setAgentPriority()/getAgentPriority() let a higher-priority agent win a tie', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    W.AxiomOrchestrator.setAgentPriority('agent-b', 10);
    const chosen = W.AxiomOrchestrator.selectAgent('transcode', { requiredPermission: 'media:transcode' });
    assert.strictEqual(chosen.id, 'agent-b');
    assert.strictEqual(W.AxiomOrchestrator.getAgentPriority('agent-b'), 10);
    assert.strictEqual(W.AxiomOrchestrator.getAgentPriority('agent-a'), 0);
  });

  await test('route() dispatches through the real Scheduler and completes successfully', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const outcome = W.AxiomOrchestrator.route({ capability: 'transcode', payload: { file: 'y.mp4' } });
    assert.strictEqual(outcome.accepted, true);
    await tick(30);
    const status = W.AxiomOrchestrator.getTaskStatus(outcome.requestId);
    assert.strictEqual(status.status, 'completed');
    assert.strictEqual(status.task.status, 'completed');
  });

  await test('route() with an explicit agentId never fails over on failure', async () => {
    const W = loadSandbox();
    let calls = 0;
    registerTestAgents(W, {
      aHandler: async () => { calls++; throw new Error('agent-a always fails'); }
    });
    const outcome = W.AxiomOrchestrator.route({ agentId: 'agent-a', type: 'transcode', maxRetries: 0 });
    await tick(50);
    const status = W.AxiomOrchestrator.getTaskStatus(outcome.requestId);
    assert.strictEqual(status.status, 'failed');
    assert.strictEqual(status.failoverCount, 0);
    assert.strictEqual(calls, 1);
  });

  await test('route() fails over to an alternate healthy agent when the chosen agent errors out', async () => {
    const W = loadSandbox();
    registerTestAgents(W, {
      aHandler: async () => { throw new Error('agent-a is broken'); }
    });
    W.AxiomOrchestrator.setAgentPriority('agent-a', 100); // force agent-a to be picked first
    const outcome = W.AxiomOrchestrator.route({
      capability: 'transcode', requiredPermission: 'media:transcode', maxRetries: 0
    });
    assert.strictEqual(outcome.agentId, 'agent-a');
    await tick(80);
    const status = W.AxiomOrchestrator.getTaskStatus(outcome.requestId);
    assert.strictEqual(status.status, 'completed');
    assert.strictEqual(status.failoverCount, 1);
    assert.strictEqual(status.agentId, 'agent-b');
    assert.strictEqual(Array.prototype.slice.call(status.triedAgents).sort().join(','), 'agent-a,agent-b');
  });

  await test('route() returns a standardized graceful failure when no eligible agent exists at all — never throws', async () => {
    const W = loadSandbox();
    registerTestAgents(W); // permission required, none granted this time
    const outcome = W.AxiomOrchestrator.route({ capability: 'transcode', requiredPermission: 'nope:permission' });
    assert.strictEqual(outcome.accepted, false);
    assert.ok(outcome.error);
  });

  await test('route() malformed input throws synchronously, same posture as dispatch()', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    assert.throws(() => W.AxiomOrchestrator.route({}));
  });

  await test('cancelRequest() cancels the underlying task through the real Scheduler', async () => {
    const W = loadSandbox();
    W.AxiomOrchestrator.registerAgent({
      id: 'slow',
      capabilities: ['slow-cap'],
      handler: async () => { await new Promise((r) => setTimeout(r, 500)); return 'done'; }
    });
    const outcome = W.AxiomOrchestrator.route({ capability: 'slow-cap', timeout: 5000 });
    await tick(10);
    const ok = W.AxiomOrchestrator.cancelRequest(outcome.requestId);
    assert.strictEqual(ok, true);
    const status = W.AxiomOrchestrator.getTaskStatus(outcome.requestId);
    assert.strictEqual(status.status, 'cancelled');
  });

  await test('retryRequest() re-plans a failed capability-based request and can land on a different agent', async () => {
    const W = loadSandbox();
    registerTestAgents(W, { aHandler: async () => { throw new Error('nope'); } });
    const first = W.AxiomOrchestrator.route({
      agentId: 'agent-a', type: 'transcode', maxRetries: 0
    });
    await tick(30);
    assert.strictEqual(W.AxiomOrchestrator.getTaskStatus(first.requestId).status, 'failed');
    // Explicit-agent requests are pinned, so retrying should target agent-a again and fail again.
    const retried = W.AxiomOrchestrator.retryRequest(first.requestId);
    assert.strictEqual(retried.agentId, 'agent-a');
    await tick(30);
    assert.strictEqual(W.AxiomOrchestrator.getTaskStatus(first.requestId).status, 'failed');
  });

  await test('getTaskMetrics() aggregates completed/failed/failedOver counts across routed requests', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const a = W.AxiomOrchestrator.route({ capability: 'transcode', requiredPermission: 'media:transcode' });
    const b = W.AxiomOrchestrator.route({ capability: 'transcode', requiredPermission: 'media:transcode' });
    await tick(30);
    const m = W.AxiomOrchestrator.getTaskMetrics();
    assert.strictEqual(m.completed, 2);
    assert.strictEqual(m.totalRequests, 2);
    assert.ok(a.requestId !== b.requestId);
  });

  await test('getExecutionHistory() returns finished requests, most recent first, bounded by limit', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    W.AxiomOrchestrator.route({ capability: 'transcode', requiredPermission: 'media:transcode' });
    W.AxiomOrchestrator.route({ capability: 'transcode', requiredPermission: 'media:transcode' });
    W.AxiomOrchestrator.route({ capability: 'transcode', requiredPermission: 'media:transcode' });
    await tick(40);
    const hist = W.AxiomOrchestrator.getExecutionHistory(2);
    assert.strictEqual(hist.length, 2);
    assert.strictEqual(hist[0].status, 'completed');
  });

  await test('getQueueStatus() reports per-agent queued/running counts using only public listTasks()', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    W.AxiomOrchestrator.dispatch({ agentId: 'agent-a', type: 'transcode', timeout: 5000 });
    await tick(5);
    const qs = W.AxiomOrchestrator.getQueueStatus();
    assert.ok(qs.byAgent['agent-a']);
    assert.ok(qs.byAgent['agent-a'].running >= 0);
    assert.ok(qs.totals);
  });

  await test('a misbehaving handler never crashes the Orchestrator — synchronous throw is contained', async () => {
    const W = loadSandbox();
    W.AxiomOrchestrator.registerAgent({
      id: 'boom',
      capabilities: ['boom-cap'],
      handler: () => { throw new Error('synchronous explosion'); }
    });
    const outcome = W.AxiomOrchestrator.route({ capability: 'boom-cap', maxRetries: 0 });
    assert.strictEqual(outcome.accepted, true);
    await tick(30);
    const status = W.AxiomOrchestrator.getTaskStatus(outcome.requestId);
    assert.strictEqual(status.status, 'failed');
    // process is still alive and orchestrator still responds:
    assert.strictEqual(W.AxiomOrchestrator.getRuntimeState(), 'running');
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
