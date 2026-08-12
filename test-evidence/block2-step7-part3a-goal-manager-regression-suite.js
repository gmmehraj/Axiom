// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3A: Autonomous Goal Management
// System — Foundation regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1) and
// os/core/runtime-context.js (Part 5), then os/core/goal-manager.js
// (Step 7 Part 3A) in a minimal vm sandbox — same pattern every
// Block 2 / Step 6/7 suite already uses. A separate scenario also
// loads os/core/task-planner.js (Step 7 Part 2) alongside it to
// prove the two "goal" concepts never collide on the shared
// AxiomOrchestrator surface or the shared Event Bus.
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
  if (opts.withTaskPlanner) {
    load('os/core/capability-router.js');
    load('os/core/agent-registry-integration.js');
    load('os/core/task-planner.js');
  }
  if (opts.withGoalManager !== false) load('os/core/goal-manager.js');

  return sandbox.window;
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
  console.log('AXIOM Block 2 / Step 7 / Part 3A — Autonomous Goal Management System (Foundation) regression\n');

  // ------------------------------------------------------------
  // Load-order / dependency guards
  // ------------------------------------------------------------
  await test('module refuses to install without AxiomOrchestrator (Event Bus) present', () => {
    const W = loadSandbox({ withOrchestrator: false, withRuntimeContext: false, withGoalManager: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/goal-manager.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'goal-manager.js' });
    assert.strictEqual(W.AxiomGoalManager, undefined);
  });

  await test('module refuses to install without AxiomRuntimeContext present', () => {
    const W = loadSandbox({ withRuntimeContext: false, withGoalManager: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/goal-manager.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'goal-manager.js' });
    assert.strictEqual(W.AxiomGoalManager, undefined);
  });

  await test('module exposes a standalone global and installs NOTHING onto AxiomOrchestrator', () => {
    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomGoalManager.createGoal, 'function');
    assert.strictEqual(typeof W.AxiomOrchestrator.createGoal, 'undefined');
    assert.strictEqual(typeof W.AxiomOrchestrator.listGoals, 'undefined');
    assert.strictEqual(typeof W.AxiomOrchestrator.cancelGoal, 'undefined');
    assert.strictEqual(typeof W.AxiomOrchestrator.GOAL_STATUS, 'undefined');
  });

  // ------------------------------------------------------------
  // Goal data model / creation / IDs
  // ------------------------------------------------------------
  await test('createGoal(): returns a unique goal id and defaults status to Pending', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'Goal A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'Goal B' });
    assert.ok(a.id && typeof a.id === 'string');
    assert.notStrictEqual(a.id, b.id);
    assert.strictEqual(a.status, W.AxiomGoalManager.GOAL_STATUS.PENDING);
    assert.strictEqual(a.parentId, null);
    assert.strictEqual(Array.isArray(a.childIds), true);
    assert.strictEqual(a.childIds.length, 0);
  });

  await test('createGoal(): falls back to a default title, and stores metadata verbatim', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ metadata: { owner: 'exec-agent', priority: 3 } });
    assert.strictEqual(g.title, 'Untitled goal');
    assert.deepStrictEqual(g.metadata, { owner: 'exec-agent', priority: 3 });
  });

  await test('createGoal(): snapshot is immutable (deep frozen)', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Immutable', metadata: { a: 1 } });
    assert.strictEqual(Object.isFrozen(g), true);
    assert.strictEqual(Object.isFrozen(g.metadata), true);
    g.status = 'running'; // no-op in non-strict callers, but must never take effect
    g.metadata.a = 2;
    assert.strictEqual(g.status, W.AxiomGoalManager.GOAL_STATUS.PENDING);
    assert.strictEqual(g.metadata.a, 1);
  });

  // ------------------------------------------------------------
  // Parent / child goals
  // ------------------------------------------------------------
  await test('createChildGoal(): links parent and child both directions', () => {
    const W = loadSandbox();
    const parent = W.AxiomGoalManager.createGoal({ title: 'Parent' });
    const child = W.AxiomGoalManager.createChildGoal(parent.id, { title: 'Child' });

    assert.strictEqual(child.parentId, parent.id);
    const children = W.AxiomGoalManager.getChildGoals(parent.id);
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].id, child.id);

    const foundParent = W.AxiomGoalManager.getParentGoal(child.id);
    assert.strictEqual(foundParent.id, parent.id);
  });

  await test('createGoal(): rejects a parentId that does not exist', () => {
    const W = loadSandbox();
    assert.throws(() => W.AxiomGoalManager.createGoal({ title: 'Orphan', parentId: 'goal_missing' }));
  });

  await test('getParentGoal(): returns null for a root goal', () => {
    const W = loadSandbox();
    const root = W.AxiomGoalManager.createGoal({ title: 'Root' });
    assert.strictEqual(W.AxiomGoalManager.getParentGoal(root.id), null);
  });

  await test('listGoals({ rootOnly:true }): excludes child goals', () => {
    const W = loadSandbox();
    const parent = W.AxiomGoalManager.createGoal({ title: 'Parent' });
    W.AxiomGoalManager.createChildGoal(parent.id, { title: 'Child' });
    const roots = W.AxiomGoalManager.listGoals({ rootOnly: true });
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].id, parent.id);
  });

  // ------------------------------------------------------------
  // Metadata
  // ------------------------------------------------------------
  await test('updateGoalMetadata(): merges into existing metadata without dropping other keys', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ metadata: { a: 1 } });
    const updated = W.AxiomGoalManager.updateGoalMetadata(g.id, { b: 2 });
    assert.deepStrictEqual(updated.metadata, { a: 1, b: 2 });
  });

  await test('updateGoalMetadata(): rejects non-JSON-safe metadata instead of silently corrupting it', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Fn' });
    assert.throws(() => W.AxiomGoalManager.updateGoalMetadata(g.id, { fn: function () {} }));
  });

  // ------------------------------------------------------------
  // Goal status lifecycle
  // ------------------------------------------------------------
  await test('full happy-path lifecycle: Pending -> Queued -> Running -> Completed', () => {
    const W = loadSandbox();
    const S = W.AxiomGoalManager.GOAL_STATUS;
    const g = W.AxiomGoalManager.createGoal({ title: 'Lifecycle' });
    assert.strictEqual(g.status, S.PENDING);

    let r = W.AxiomGoalManager.markGoalQueued(g.id);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.goal.status, S.QUEUED);

    r = W.AxiomGoalManager.markGoalRunning(g.id);
    assert.strictEqual(r.goal.status, S.RUNNING);
    assert.ok(r.goal.startedAt);

    r = W.AxiomGoalManager.completeGoal(g.id, { ok: true });
    assert.strictEqual(r.goal.status, S.COMPLETED);
    assert.deepStrictEqual(r.goal.result, { ok: true });
    assert.ok(r.goal.finishedAt);
  });

  await test('Waiting round-trip: Running -> Waiting -> Queued -> Running -> Completed', () => {
    const W = loadSandbox();
    const S = W.AxiomGoalManager.GOAL_STATUS;
    const g = W.AxiomGoalManager.createGoal({ title: 'Waits' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    let r = W.AxiomGoalManager.markGoalWaiting(g.id, 'blocked on dependency');
    assert.strictEqual(r.goal.status, S.WAITING);
    r = W.AxiomGoalManager.markGoalQueued(g.id);
    assert.strictEqual(r.goal.status, S.QUEUED);
    r = W.AxiomGoalManager.markGoalRunning(g.id);
    assert.strictEqual(r.goal.status, S.RUNNING);
    r = W.AxiomGoalManager.completeGoal(g.id);
    assert.strictEqual(r.goal.status, S.COMPLETED);
  });

  await test('failGoal(): Running -> Failed records the error and finishedAt', () => {
    const W = loadSandbox();
    const S = W.AxiomGoalManager.GOAL_STATUS;
    const g = W.AxiomGoalManager.createGoal({ title: 'Fails' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    const r = W.AxiomGoalManager.failGoal(g.id, 'synthetic failure');
    assert.strictEqual(r.goal.status, S.FAILED);
    assert.strictEqual(r.goal.error, 'synthetic failure');
    assert.ok(r.goal.finishedAt);
  });

  await test('cancelGoal(): Pending -> Cancelled is legal directly (never queued/started)', () => {
    const W = loadSandbox();
    const S = W.AxiomGoalManager.GOAL_STATUS;
    const g = W.AxiomGoalManager.createGoal({ title: 'Cancel early' });
    const r = W.AxiomGoalManager.cancelGoal(g.id, 'no longer needed');
    assert.strictEqual(r.goal.status, S.CANCELLED);
  });

  await test('illegal transitions are refused, not silently coerced (Completed -> Running)', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Terminal' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.completeGoal(g.id);
    const r = W.AxiomGoalManager.markGoalRunning(g.id);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.goal.status, W.AxiomGoalManager.GOAL_STATUS.COMPLETED);
  });

  await test('illegal transitions are refused (Pending -> Running, skipping Queued)', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Skip' });
    const r = W.AxiomGoalManager.markGoalRunning(g.id);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.goal.status, W.AxiomGoalManager.GOAL_STATUS.PENDING);
  });

  await test('transitionGoal(): unknown goal id throws; unknown status string throws', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'X' });
    assert.throws(() => W.AxiomGoalManager.markGoalQueued('goal_missing'));
    assert.throws(() => W.AxiomGoalManager.transitionGoal(g.id, 'bogus-status'));
  });

  // ------------------------------------------------------------
  // Goal Registry
  // ------------------------------------------------------------
  await test('Goal Registry: listGoals({status}) filters correctly across many goals', () => {
    const W = loadSandbox();
    const S = W.AxiomGoalManager.GOAL_STATUS;
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.createGoal({ title: 'C' });
    W.AxiomGoalManager.markGoalQueued(a.id);
    W.AxiomGoalManager.markGoalQueued(b.id);
    W.AxiomGoalManager.markGoalRunning(b.id);

    assert.strictEqual(W.AxiomGoalManager.listGoals({ status: S.PENDING }).length, 1);
    assert.strictEqual(W.AxiomGoalManager.listGoals({ status: S.QUEUED }).length, 1);
    assert.strictEqual(W.AxiomGoalManager.listGoals({ status: S.RUNNING }).length, 1);
    assert.strictEqual(W.AxiomGoalManager.listGoals().length, 3);
  });

  await test('Goal Registry: terminal goals stay queryable (never evicted by this Part)', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Persists' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.completeGoal(g.id, { done: true });
    const stillThere = W.AxiomGoalManager.getGoal(g.id);
    assert.ok(stillThere);
    assert.strictEqual(stillThere.status, W.AxiomGoalManager.GOAL_STATUS.COMPLETED);
  });

  // ------------------------------------------------------------
  // Goal History
  // ------------------------------------------------------------
  await test('Goal History: records created + every transition, most-recent first', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'History' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.completeGoal(g.id, { ok: 1 });

    const h = W.AxiomGoalManager.getGoalHistory({ goalId: g.id });
    assert.strictEqual(h.length, 4); // created, queued, running, completed
    assert.strictEqual(h[0].event, 'transition');
    assert.strictEqual(h[0].status, 'completed');
    assert.strictEqual(h[h.length - 1].event, 'created');
  });

  await test('Goal History: getGoalHistory(filter, limit) applies both filter and limit', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Limited' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    const h = W.AxiomGoalManager.getGoalHistory({ goalId: g.id }, 1);
    assert.strictEqual(h.length, 1);
    assert.strictEqual(h[0].status, 'running');
  });

  // ------------------------------------------------------------
  // Runtime Context integration
  // ------------------------------------------------------------
  await test('Runtime Context: exactly one context is created per goal and is reachable via contextId', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Ctx' });
    assert.ok(g.contextId);
    const ctx = W.AxiomRuntimeContext.getContext(g.contextId);
    assert.ok(ctx);
    assert.strictEqual(ctx.metadata.goalId, g.id);
  });

  await test('Runtime Context: sync mirrors goal status/metadata into the context on every change', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Sync' });
    W.AxiomGoalManager.updateGoalMetadata(g.id, { step: 1 });
    let ctx = W.AxiomRuntimeContext.getContext(g.contextId);
    assert.deepStrictEqual(ctx.temporaryData.metadata, { step: 1 });

    W.AxiomGoalManager.markGoalQueued(g.id);
    ctx = W.AxiomRuntimeContext.getContext(g.contextId);
    assert.strictEqual(ctx.state.status, 'queued');
  });

  await test('Runtime Context: the context is finalized and destroyed once the goal reaches Completed', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Finalize' });
    const contextId = g.contextId;
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.completeGoal(g.id, { done: true });
    assert.strictEqual(W.AxiomRuntimeContext.getContext(contextId), null);
  });

  await test('Runtime Context: the context is finalized and destroyed once the goal reaches Cancelled', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'CancelFinalize' });
    const contextId = g.contextId;
    W.AxiomGoalManager.cancelGoal(g.id, 'stopped');
    assert.strictEqual(W.AxiomRuntimeContext.getContext(contextId), null);
  });

  await test('Runtime Context: parent and child goals get their own independent contexts', () => {
    const W = loadSandbox();
    const parent = W.AxiomGoalManager.createGoal({ title: 'Parent' });
    const child = W.AxiomGoalManager.createChildGoal(parent.id, { title: 'Child' });
    assert.notStrictEqual(parent.contextId, child.contextId);
    assert.ok(W.AxiomRuntimeContext.getContext(parent.contextId));
    assert.ok(W.AxiomRuntimeContext.getContext(child.contextId));
  });

  // ------------------------------------------------------------
  // Event Bus
  // ------------------------------------------------------------
  await test('Event Bus: goalmgr_created and goalmgr_child_created fire on creation', () => {
    const W = loadSandbox();
    const seen = [];
    W.AxiomOrchestrator.on('goalmgr_created', (p) => seen.push(['created', p]));
    W.AxiomOrchestrator.on('goalmgr_child_created', (p) => seen.push(['child_created', p]));

    const parent = W.AxiomGoalManager.createGoal({ title: 'Parent' });
    const child = W.AxiomGoalManager.createChildGoal(parent.id, { title: 'Child' });

    const created = seen.filter((e) => e[0] === 'created');
    const childCreated = seen.filter((e) => e[0] === 'child_created');
    assert.strictEqual(created.length, 2);
    assert.strictEqual(childCreated.length, 1);
    assert.strictEqual(childCreated[0][1].goalId, child.id);
    assert.strictEqual(childCreated[0][1].parentId, parent.id);
  });

  await test('Event Bus: goalmgr_<status> fires exactly once per transition, in order', () => {
    const W = loadSandbox();
    const order = [];
    ['goalmgr_queued', 'goalmgr_running', 'goalmgr_completed'].forEach((evt) => {
      W.AxiomOrchestrator.on(evt, () => order.push(evt));
    });
    const g = W.AxiomGoalManager.createGoal({ title: 'Events' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.completeGoal(g.id);
    assert.deepStrictEqual(order, ['goalmgr_queued', 'goalmgr_running', 'goalmgr_completed']);
  });

  await test('Event Bus: a refused/illegal transition does NOT emit a goalmgr_<status> event', () => {
    const W = loadSandbox();
    let count = 0;
    W.AxiomOrchestrator.on('goalmgr_running', () => count++);
    const g = W.AxiomGoalManager.createGoal({ title: 'NoEmit' });
    W.AxiomGoalManager.markGoalRunning(g.id); // illegal: still Pending
    assert.strictEqual(count, 0);
  });

  // ------------------------------------------------------------
  // Metrics
  // ------------------------------------------------------------
  await test('getGoalMetrics(): totals and byStatus counts stay accurate across a mixed batch', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    const c = W.AxiomGoalManager.createGoal({ title: 'C' });
    W.AxiomGoalManager.markGoalQueued(a.id);
    W.AxiomGoalManager.markGoalRunning(a.id);
    W.AxiomGoalManager.completeGoal(a.id);
    W.AxiomGoalManager.cancelGoal(b.id, 'skip');

    const m = W.AxiomGoalManager.getGoalMetrics();
    assert.strictEqual(m.total, 3);
    assert.strictEqual(m.byStatus.completed, 1);
    assert.strictEqual(m.byStatus.cancelled, 1);
    assert.strictEqual(m.byStatus.pending, 1);
    assert.strictEqual(m.createdCount, 3);
    assert.strictEqual(m.completedCount, 1);
    assert.strictEqual(m.cancelledCount, 1);
    void c;
  });

  // ------------------------------------------------------------
  // Non-duplication / non-collision with task-planner.js (Step 7
  // Part 2), loaded together in the SAME sandbox on purpose.
  // ------------------------------------------------------------
  await test('loaded alongside task-planner.js: neither module clobbers the other\'s Orchestrator surface', () => {
    const W = loadSandbox({ withTaskPlanner: true });
    assert.strictEqual(typeof W.AxiomOrchestrator.planGoal, 'function'); // task-planner.js's install
    assert.strictEqual(typeof W.AxiomOrchestrator.executeGoal, 'function');
    assert.strictEqual(typeof W.AxiomGoalManager.createGoal, 'function'); // goal-manager.js's own global
    assert.strictEqual(typeof W.AxiomOrchestrator.createGoal, 'undefined'); // goal-manager.js installed nothing
    assert.notStrictEqual(W.AxiomOrchestrator.GOAL_STATUS, W.AxiomGoalManager.GOAL_STATUS);
  });

  await test('loaded alongside task-planner.js: goalmgr_* and task-planner\'s goal_* events never cross-fire', () => {
    const W = loadSandbox({ withTaskPlanner: true });
    let goalmgrHits = 0, taskPlannerHits = 0;
    W.AxiomOrchestrator.on('goalmgr_completed', () => goalmgrHits++);
    W.AxiomOrchestrator.on('goal_completed', () => taskPlannerHits++);

    const g = W.AxiomGoalManager.createGoal({ title: 'Isolated' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.completeGoal(g.id);

    assert.strictEqual(goalmgrHits, 1);
    assert.strictEqual(taskPlannerHits, 0);
  });

  await test('loaded alongside task-planner.js: task-planner.js\'s own regression posture is unaffected (route/scheduler still work)', () => {
    const W = loadSandbox({ withTaskPlanner: true });
    assert.strictEqual(typeof W.AxiomOrchestrator.route, 'function');
    assert.strictEqual(typeof W.AxiomOrchestrator.enqueue, 'function');
    assert.strictEqual(W.AxiomOrchestrator.TASK_STATUS.QUEUED, 'queued');
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
