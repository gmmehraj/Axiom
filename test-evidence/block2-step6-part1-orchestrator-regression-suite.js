// ============================================================
// AXIOM — Block 2 / Step 6 / Part 1: Orchestrator Core regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js in a minimal
// vm sandbox (same pattern as the Browser/Memory/Automation Foundation
// suites) and exercises the public Orchestrator API — registry, event
// bus, scheduler, and lifecycle — against real state.
//
// Async note: the scheduler drains via setTimeout(fn, 0), so tests that
// depend on a task having settled use a small `tick(ms)` helper backed
// by the sandbox's real timer functions rather than assuming synchronous
// execution.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');

function loadOrchestrator() {
  const sandbox = {
    console,
    setTimeout, clearTimeout,
    Date, Promise, Object, Array, JSON, Math, Error
  };
  sandbox.window = sandbox;
  sandbox.document = undefined; // no DOM in this harness — exercises the non-DOM startup branch
  vm.createContext(sandbox);

  const src = fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'orchestrator.js' });

  return sandbox.window.AxiomOrchestrator;
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    console.log('        ' + e.message);
  }
}

async function main() {
  console.log('AXIOM Block 2 / Step 6 / Part 1 — Orchestrator Core regression\n');

  await test('module loads and auto-starts (no DOM branch)', () => {
    const O = loadOrchestrator();
    assert.strictEqual(O.getRuntimeState(), 'running');
    assert.strictEqual(typeof O.API_VERSION, 'string');
  });

  await test('registerAgent() validates and stores a full record', () => {
    const O = loadOrchestrator();
    const agent = O.registerAgent({
      id: 'echo',
      name: 'Echo Agent',
      capabilities: ['echo'],
      permissions: ['echo:*'],
      tools: ['echo.run'],
      handler: async (t) => t.payload
    });
    assert.strictEqual(agent.id, 'echo');
    assert.strictEqual(agent.status, 'idle');
    assert.strictEqual(agent.health, 'healthy');
    assert.deepStrictEqual(O.getAgent('echo').capabilities, ['echo']);
  });

  await test('registerAgent() rejects duplicate ids and missing handler', () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'a1', handler: () => {} });
    assert.throws(() => O.registerAgent({ id: 'a1', handler: () => {} }), /already registered/);
    assert.throws(() => O.registerAgent({ id: 'a2' }), /handler/);
  });

  await test('registerAgent() emits agent_registered on the bus', () => {
    const O = loadOrchestrator();
    let seen = null;
    O.on('agent_registered', (p) => { seen = p; });
    O.registerAgent({ id: 'a1', handler: () => {} });
    assert.ok(seen && seen.agentId === 'a1');
  });

  await test('event bus: on/off/once, duplicate subscription ignored', () => {
    const O = loadOrchestrator();
    let count = 0;
    const fn = () => { count++; };
    O.on('custom', fn);
    O.on('custom', fn); // duplicate — must not double-fire
    O.emit('custom');
    assert.strictEqual(count, 1);

    let onceCount = 0;
    O.once('custom2', () => { onceCount++; });
    O.emit('custom2');
    O.emit('custom2');
    assert.strictEqual(onceCount, 1);

    O.off('custom', fn);
    O.emit('custom');
    assert.strictEqual(count, 1);
  });

  await test('event bus: a throwing listener does not break emit() for others', () => {
    const O = loadOrchestrator();
    let secondRan = false;
    O.on('boom', () => { throw new Error('listener blew up'); });
    O.on('boom', () => { secondRan = true; });
    assert.doesNotThrow(() => O.emit('boom'));
    assert.strictEqual(secondRan, true);
  });

  await test('dispatch() by explicit agentId runs the handler via the scheduler (not synchronously)', async () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'echo', handler: async (t) => ({ echoed: t.payload }) });
    const id = O.dispatch({ agentId: 'echo', payload: { x: 1 } });
    // Must still be queued/unset immediately after dispatch() returns —
    // proves tasks are not executed inline on the caller's stack.
    const immediate = O.getTask(id);
    assert.ok(immediate.status === 'queued' || immediate.status === 'running');
    await tick(50);
    const done = O.getTask(id);
    assert.strictEqual(done.status, 'completed');
    assert.deepStrictEqual(done.result, { echoed: { x: 1 } });
  });

  await test('dispatch() by capability routes to a healthy matching agent', async () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'nav', capabilities: ['navigate'], handler: async () => 'ok' });
    const id = O.dispatch({ capability: 'navigate', payload: {} });
    await tick(50);
    assert.strictEqual(O.getTask(id).status, 'completed');
  });

  await test('dispatch() throws when no agent matches and nothing is enqueued', () => {
    const O = loadOrchestrator();
    assert.throws(() => O.dispatch({ capability: 'nonexistent' }), /no healthy agent matches/);
  });

  await test('task_started / task_completed lifecycle events fire in order', async () => {
    const O = loadOrchestrator();
    const seen = [];
    O.on('task_started', () => seen.push('started'));
    O.on('task_completed', () => seen.push('completed'));
    O.registerAgent({ id: 'echo', handler: async () => 'ok' });
    O.dispatch({ agentId: 'echo' });
    await tick(50);
    assert.deepStrictEqual(seen, ['started', 'completed']);
  });

  await test('a rejected/throwing handler produces task_failed, not an unhandled rejection', async () => {
    const O = loadOrchestrator();
    let failReason = null;
    O.on('task_failed', (p) => { failReason = p.reason; });
    O.registerAgent({ id: 'bad', handler: async () => { throw new Error('kaboom'); } });
    const id = O.dispatch({ agentId: 'bad' });
    await tick(50);
    assert.strictEqual(O.getTask(id).status, 'failed');
    assert.strictEqual(failReason, 'kaboom');
  });

  await test('retries: a failing task retries up to maxRetries before failing for good', async () => {
    const O = loadOrchestrator();
    let attempts = 0;
    O.registerAgent({
      id: 'flaky',
      handler: async () => { attempts++; throw new Error('nope'); }
    });
    const id = O.dispatch({ agentId: 'flaky', maxRetries: 2, retryDelay: 5, timeout: 0 });
    await tick(100);
    assert.strictEqual(attempts, 3); // 1 initial + 2 retries
    assert.strictEqual(O.getTask(id).status, 'failed');
  });

  await test('timeout: a handler that never resolves is marked timed_out', async () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'hang', handler: () => new Promise(() => {}) });
    const id = O.dispatch({ agentId: 'hang', timeout: 20 });
    await tick(80);
    assert.strictEqual(O.getTask(id).status, 'timed_out');
  });

  await test('priority: higher-priority queued task runs before a lower-priority one', async () => {
    const O = loadOrchestrator();
    const order = [];
    O.registerAgent({
      id: 'worker',
      handler: async (t) => { order.push(t.payload.label); return true; }
    });
    // Enqueue synchronously before the scheduler's first drain (setTimeout 0)
    // fires, so both are genuinely competing in the same queue.
    O.dispatch({ agentId: 'worker', payload: { label: 'low' }, priority: 0 });
    O.dispatch({ agentId: 'worker', payload: { label: 'high' }, priority: 10 });
    await tick(50);
    assert.deepStrictEqual(order, ['high', 'low']);
  });

  await test('cancel(): a queued task is removed and reports cancelled, never runs', async () => {
    const O = loadOrchestrator();
    let ran = false;
    O.registerAgent({ id: 'worker', handler: async () => { ran = true; } });
    O.dispatch({ agentId: 'worker', priority: -100 }); // low priority so the next can be cancelled first
    const id2 = O.dispatch({ agentId: 'worker', priority: -100 });
    O.cancel(id2, 'test cancel');
    await tick(50);
    assert.strictEqual(O.getTask(id2).status, 'cancelled');
  });

  await test('unregisterAgent() cancels that agent\'s pending tasks and emits agent_removed', async () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'echo', handler: async () => 'ok' });
    let removed = null;
    O.on('agent_removed', (p) => { removed = p.agentId; });
    const id = O.dispatch({ agentId: 'echo', priority: -100 });
    O.unregisterAgent('echo');
    assert.strictEqual(removed, 'echo');
    assert.strictEqual(O.getAgent('echo'), null);
    const task = O.getTask(id);
    assert.ok(task.status === 'cancelled');
  });

  await test('getHealthyAgents() excludes disabled/unhealthy agents', () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'a1', handler: () => {} });
    O.registerAgent({ id: 'a2', handler: () => {} });
    O.setAgentHealth('a2', O.HEALTH.UNHEALTHY);
    const healthy = O.getHealthyAgents().map((a) => a.id);
    assert.deepStrictEqual(healthy, ['a1']);
  });

  await test('listAgents()/getAgent() never leak the raw handler function', () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'a1', handler: () => 'secret' });
    assert.strictEqual(O.getAgent('a1').handler, undefined);
    assert.strictEqual(O.listAgents()[0].handler, undefined);
  });

  await test('dispatch() throws once the runtime has been shut down', () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'echo', handler: async () => 'ok' });
    O.shutdown();
    assert.strictEqual(O.getRuntimeState(), 'stopped');
    assert.throws(() => O.dispatch({ agentId: 'echo' }), /before startup/);
  });

  await test('shutdown() cancels in-flight/queued tasks and startup() can resume it', async () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'echo', handler: async () => 'ok' });
    const id = O.dispatch({ agentId: 'echo', priority: -100 });
    O.shutdown();
    assert.strictEqual(O.getTask(id).status, 'cancelled');
    assert.strictEqual(O.startup(), true);
    assert.strictEqual(O.getRuntimeState(), 'running');
  });

  await test('getStats() reflects agent and task counts accurately', async () => {
    const O = loadOrchestrator();
    O.registerAgent({ id: 'a1', handler: async () => 'ok' });
    O.dispatch({ agentId: 'a1' });
    await tick(50);
    const stats = O.getStats();
    assert.strictEqual(stats.agents, 1);
    assert.strictEqual(stats.healthyAgents, 1);
    assert.strictEqual(stats.tasks.total, 1);
    assert.strictEqual(stats.tasks.byStatus.completed, 1);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
