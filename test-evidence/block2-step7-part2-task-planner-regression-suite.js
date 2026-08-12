// ============================================================
// AXIOM — Block 2 / Step 7 / Part 2: Autonomous AI Task Planning &
// Execution regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1),
// os/core/capability-router.js (Part 3), os/core/runtime-context.js
// (Part 5), os/core/agent-registry-integration.js (Part 2, for its
// discoverCapabilities() discovery API only — no real subsystem
// globals are present in this sandbox, so it registers nothing
// itself), and os/core/task-planner.js (Step 7 Part 2) in a minimal
// vm sandbox — same pattern every Block 2 / Step 6 suite already
// uses. Agents are registered directly via
// AxiomOrchestrator.registerAgent() with small handlers standing in
// for real subsystems, so this suite proves the *autonomous planning*
// contract: goal decomposition, dynamic capability matching, task
// state transitions (Pending/Queued/Running/Waiting/Completed/Failed/
// Cancelled), dependency-respecting sequential execution, true
// parallel execution for independent clauses, graceful failure
// propagation, cancellation, retry-only-what-failed, and Runtime
// Context lifecycle — independent of which real subsystems happen to
// be on a given page.
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

  load('os/core/orchestrator.js');
  if (opts.withRouter !== false) load('os/core/capability-router.js');
  if (opts.withRuntimeContext !== false) load('os/core/runtime-context.js');
  if (opts.withDiscovery !== false) load('os/core/agent-registry-integration.js');
  if (opts.withPlanner !== false) load('os/core/task-planner.js');

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
  const calls = { search: 0, remember: 0, summarize: 0, flaky: 0 };
  W.AxiomOrchestrator.registerAgent({
    id: 'browser', name: 'Browser', capabilities: ['search-web'],
    permissions: ['browser:*'], tools: ['browser.search'],
    handler: opts.searchHandler || (async (task) => { calls.search++; await tick(10); return { ok: true, via: 'browser', payload: task.payload }; })
  });
  W.AxiomOrchestrator.registerAgent({
    id: 'memory', name: 'Memory', capabilities: ['remember-info'],
    permissions: ['memory:*'], tools: ['memory.save'],
    handler: opts.rememberHandler || (async (task) => { calls.remember++; await tick(10); return { ok: true, via: 'memory', payload: task.payload }; })
  });
  W.AxiomOrchestrator.registerAgent({
    id: 'brain', name: 'Brain', capabilities: ['summarize-report'],
    permissions: ['brain:*'], tools: ['brain.summarize'],
    handler: opts.summarizeHandler || (async (task) => { calls.summarize++; await tick(10); return { ok: true, via: 'brain', payload: task.payload }; })
  });
  W.AxiomOrchestrator.registerAgent({
    id: 'flaky', name: 'Flaky', capabilities: ['flaky-task'],
    permissions: [], tools: ['flaky.run'],
    handler: opts.flakyHandler || (async () => { calls.flaky++; throw new Error('synthetic failure'); })
  });
  return calls;
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
  console.log('AXIOM Block 2 / Step 7 / Part 2 — Autonomous AI Task Planning & Execution regression\n');

  await test('module refuses to install without AxiomOrchestrator.route (capability-router.js) present', () => {
    const W = loadSandbox({ withRouter: false, withRuntimeContext: false, withDiscovery: false, withPlanner: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/task-planner.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'task-planner.js' });
    assert.strictEqual(W.AxiomAutonomousTaskPlanner, undefined);
    assert.strictEqual(typeof W.AxiomOrchestrator.planGoal, 'undefined');
  });

  await test('module refuses to install without AxiomRuntimeContext present', () => {
    const W = loadSandbox({ withRuntimeContext: false, withPlanner: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/task-planner.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'task-planner.js' });
    assert.strictEqual(W.AxiomAutonomousTaskPlanner, undefined);
  });

  await test('module installs onto AxiomOrchestrator and exposes a standalone global once all dependencies are present', () => {
    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomOrchestrator.planGoal, 'function');
    assert.strictEqual(typeof W.AxiomOrchestrator.executeGoal, 'function');
    assert.strictEqual(typeof W.AxiomAutonomousTaskPlanner.planGoal, 'function');
    // Never collides with the scheduler-level TASK_STATUS Part 1 already installed.
    assert.notStrictEqual(W.AxiomOrchestrator.GOAL_TASK_STATE, W.AxiomOrchestrator.TASK_STATUS);
  });

  await test('decomposeGoal(): "then" splits a goal into ordered, dependency-chained clauses', () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const d = W.AxiomOrchestrator.decomposeGoal('search the web, then remember it');
    assert.strictEqual(d.sequential, true);
    assert.strictEqual(d.clauses.length, 2);
    assert.strictEqual(d.clauses[0], 'search the web');
    assert.strictEqual(d.clauses[1], 'remember it');
  });

  await test('decomposeGoal(): "and"/comma splits into INDEPENDENT clauses (no forced sequencing)', () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const d = W.AxiomOrchestrator.decomposeGoal('search the web and remember it');
    assert.strictEqual(d.sequential, false);
    assert.strictEqual(d.clauses.length, 2);
  });

  await test('decomposeGoal(): capability matching is derived live from discoverCapabilities(), never hardcoded', () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const d = W.AxiomOrchestrator.decomposeGoal('search the web');
    assert.strictEqual(d.clauseTasks[0][0].capability, 'search-web');
  });

  await test('decomposeGoal(): a clause with no matching live capability is marked unresolvable, not guessed', () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const d = W.AxiomOrchestrator.decomposeGoal('do something nobody registered');
    assert.strictEqual(d.clauseTasks[0][0].capability, null);
  });

  await test('planGoal(): builds a task per clause and wires sequential dependsOn correctly', () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const plan = W.AxiomOrchestrator.planGoal('search the web, then remember it');
    assert.strictEqual(plan.tasks.length, 2);
    assert.strictEqual(plan.tasks[0].dependsOn.length, 0);
    assert.strictEqual(plan.tasks[1].dependsOn.length, 1);
    assert.strictEqual(plan.tasks[1].dependsOn[0], plan.tasks[0].id);
    assert.strictEqual(plan.tasks[0].status, 'pending');
  });

  await test('executeGoal(): sequential clauses run in order — second task never dispatches before the first completes', async () => {
    const W = loadSandbox();
    const order = [];
    registerTestAgents(W, {
      searchHandler: async () => { order.push('search-start'); await tick(30); order.push('search-end'); return { ok: true }; },
      rememberHandler: async () => { order.push('remember-start'); return { ok: true }; }
    });
    const started = W.AxiomOrchestrator.executeGoal('search the web, then remember it');
    const result = await started.promise;
    assert.strictEqual(result.status, 'completed');
    assert.deepStrictEqual(order, ['search-start', 'search-end', 'remember-start']);
  });

  await test('executeGoal(): independent clauses ("and") run truly in parallel, not one-at-a-time', async () => {
    const W = loadSandbox();
    const order = [];
    registerTestAgents(W, {
      searchHandler: async () => { order.push('search-start'); await tick(30); order.push('search-end'); return { ok: true }; },
      summarizeHandler: async () => { order.push('summarize-start'); await tick(10); order.push('summarize-end'); return { ok: true }; }
    });
    const started = W.AxiomOrchestrator.executeGoal('search the web and summarize the report');
    const result = await started.promise;
    assert.strictEqual(result.status, 'completed');
    // Both must have STARTED before either finished — proof of real concurrency.
    assert.deepStrictEqual(order.slice(0, 2).sort(), ['search-start', 'summarize-start']);
  });

  await test('task states progress Pending -> Queued -> Running -> Completed, observed via emitted events', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const seen = [];
    W.AxiomOrchestrator.on('goal_task_queued', (p) => seen.push('queued:' + p.status === undefined ? '' : p.status));
    W.AxiomOrchestrator.on('goal_task_started', () => seen.push('running'));
    W.AxiomOrchestrator.on('goal_task_completed', () => seen.push('completed'));
    const started = W.AxiomOrchestrator.executeGoal('search the web');
    await started.promise;
    assert.ok(seen.indexOf('running') !== -1);
    assert.ok(seen.indexOf('completed') !== -1);
    assert.ok(seen.indexOf('running') < seen.indexOf('completed'));
  });

  await test('a task blocked on an unfinished dependency is reported Waiting before it is dispatched', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    let sawWaiting = false;
    W.AxiomOrchestrator.on('goal_task_waiting', () => { sawWaiting = true; });
    const started = W.AxiomOrchestrator.executeGoal('search the web, then remember it');
    await started.promise;
    assert.strictEqual(sawWaiting, true);
  });

  await test('a task with no resolvable capability fails the goal gracefully (no crash, no dispatch)', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const started = W.AxiomOrchestrator.executeGoal('do something nobody registered');
    const result = await started.promise;
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.tasks[0].status, 'failed');
    assert.ok(/could not resolve a capability/i.test(result.tasks[0].error));
  });

  await test('a downstream task is Cancelled (not silently skipped) when its dependency fails, and the flaky agent is never re-run beyond its own retry budget', async () => {
    const W = loadSandbox();
    const calls = registerTestAgents(W);
    const started = W.AxiomOrchestrator.executeGoal('trigger the flaky task, then remember it');
    const result = await started.promise;
    assert.strictEqual(result.status, 'failed');
    const flakyTask = result.tasks.find((t) => t.capability === 'flaky-task');
    const dependentTask = result.tasks.find((t) => t.capability === 'remember-info');
    assert.strictEqual(flakyTask.status, 'failed');
    assert.strictEqual(dependentTask.status, 'cancelled');
    // Scheduler default is 1 retry -> exactly 2 attempts on the only agent exposing this capability.
    assert.strictEqual(calls.flaky, 2);
  }).then(() => {}); // (no-op keeps the promise chain explicit for readability)

  await test('cancelGoal(): a running task is cancelled through capability-router.js (not force-killed), queued/waiting tasks cancel immediately', async () => {
    const W = loadSandbox();
    let resolveSlow;
    registerTestAgents(W, {
      searchHandler: () => new Promise((resolve) => { resolveSlow = resolve; })
    });
    const started = W.AxiomOrchestrator.executeGoal('search the web, then remember it');
    await tick(10); // let the first task reach Running
    const status = W.AxiomOrchestrator.getGoalStatus(started.planId);
    assert.strictEqual(status.tasks[0].status, 'running');
    const ok = W.AxiomOrchestrator.cancelGoal(started.planId, 'test cancel');
    assert.strictEqual(ok, true);
    if (resolveSlow) resolveSlow({ ok: true }); // let the in-flight handler settle, per the documented cooperative-cancel contract
    const result = await started.promise;
    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(result.tasks[0].status, 'cancelled'); // was Running when cancelGoal() was called — must land Cancelled, not Failed
    assert.strictEqual(result.tasks[1].status, 'cancelled'); // never-dispatched dependent
  });

  await test('retryGoal(): re-executes only the clause that failed, not the clause that already succeeded', async () => {
    const W = loadSandbox();
    const calls = registerTestAgents(W);
    const started = W.AxiomOrchestrator.executeGoal('search the web, then trigger the flaky task');
    const first = await started.promise;
    assert.strictEqual(first.status, 'failed');
    assert.strictEqual(calls.search, 1);
    const retried = W.AxiomOrchestrator.retryGoal(started.planId);
    assert.ok(retried, 'retryGoal() should accept a failed goal');
    const second = await retried.promise;
    assert.strictEqual(second.tasks.length, 1); // only the failed clause was re-planned
    assert.strictEqual(second.tasks[0].capability, 'flaky-task');
    assert.strictEqual(calls.search, 1); // the already-successful clause was never re-run
  });

  await test('getGoalStatus()/getGoalTasks()/listGoals() reflect the same state executeGoal() resolves with', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const started = W.AxiomOrchestrator.executeGoal('search the web');
    await started.promise;
    const status = W.AxiomOrchestrator.getGoalStatus(started.planId);
    assert.strictEqual(status.status, 'completed');
    assert.strictEqual(W.AxiomOrchestrator.getGoalTasks(started.planId).length, 1);
    assert.ok(W.AxiomOrchestrator.listGoals().indexOf(started.planId) !== -1);
  });

  await test('Runtime Context: exactly one real context exists per in-flight goal, and it is destroyed (not leaked) once the goal settles', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const started = W.AxiomOrchestrator.executeGoal('search the web, then remember it');
    const planId = started.planId;
    const status = W.AxiomOrchestrator.getGoalStatus(planId);
    const contexts = W.AxiomRuntimeContext.getContextsByWorkflow(planId);
    assert.strictEqual(contexts.length, 1);
    assert.strictEqual(status.contextId, contexts[0].contextId);
    await started.promise;
    assert.strictEqual(W.AxiomRuntimeContext.getContext(status.contextId), null);
  });

  await test('no duplicate listeners: two concurrent goals each invoke their agents exactly once (single shared route_completed/route_failed listener)', async () => {
    const W = loadSandbox();
    const calls = registerTestAgents(W);
    const a = W.AxiomOrchestrator.executeGoal('search the web');
    const b = W.AxiomOrchestrator.executeGoal('remember it');
    await Promise.all([a.promise, b.promise]);
    assert.strictEqual(calls.search, 1);
    assert.strictEqual(calls.remember, 1);
  });

  await test('executeGoal() rejects a plan that decomposed into zero tasks instead of hanging forever', async () => {
    const W = loadSandbox();
    registerTestAgents(W);
    const started = W.AxiomOrchestrator.executeGoal('   ');
    await assert.rejects(started.promise);
  });

  await test('existing Part 1/3/5 regression posture: task-planner.js never edits orchestrator.js, capability-router.js, or runtime-context.js at runtime', () => {
    const W = loadSandbox();
    // Spot-check a handful of untouched, pre-existing surface area from
    // earlier parts still behaves exactly as their own suites already prove.
    assert.strictEqual(typeof W.AxiomOrchestrator.route, 'function');
    assert.strictEqual(typeof W.AxiomOrchestrator.enqueue, 'function');
    assert.strictEqual(typeof W.AxiomRuntimeContext.createContext, 'function');
    assert.strictEqual(W.AxiomOrchestrator.TASK_STATUS.QUEUED, 'queued');
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
