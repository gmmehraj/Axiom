// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3B: Autonomous Goal Management
// System — Scheduling & Prioritization regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1) and
// os/core/runtime-context.js (Part 5), then the extended
// os/core/goal-manager.js (Step 7 Part 3A foundation + Part 3B
// scheduling) in a minimal vm sandbox — same pattern the Part 3A
// suite already uses. Every Part 3A assertion keeps passing
// unmodified in its own suite; this suite covers ONLY what Part 3B
// adds: priority levels, the goal queue, dependency tracking +
// circular dependency detection, automatic goal ordering, goal
// scheduling, pause/resume/cancel/retry, and duplicate goal
// prevention.
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
  console.log('AXIOM Block 2 / Step 7 / Part 3B — Autonomous Goal Management System (Scheduling & Prioritization) regression\n');

  // ------------------------------------------------------------
  // Priority levels
  // ------------------------------------------------------------
  await test('GOAL_PRIORITY: createGoal() defaults to NORMAL priority', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Default priority' });
    assert.strictEqual(g.priority, W.AxiomGoalManager.GOAL_PRIORITY.NORMAL);
  });

  await test('GOAL_PRIORITY: createGoal() accepts an explicit valid priority', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Urgent', priority: W.AxiomGoalManager.GOAL_PRIORITY.CRITICAL });
    assert.strictEqual(g.priority, W.AxiomGoalManager.GOAL_PRIORITY.CRITICAL);
  });

  await test('GOAL_PRIORITY: createGoal() rejects an unknown priority value', () => {
    const W = loadSandbox();
    assert.throws(() => W.AxiomGoalManager.createGoal({ title: 'Bad', priority: 3.5 }));
  });

  await test('setGoalPriority(): changes priority and is reflected on the goal', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Reprioritize' });
    const updated = W.AxiomGoalManager.setGoalPriority(g.id, W.AxiomGoalManager.GOAL_PRIORITY.HIGH);
    assert.strictEqual(updated.priority, W.AxiomGoalManager.GOAL_PRIORITY.HIGH);
  });

  await test('setGoalPriority(): rejects a terminal goal', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Done' });
    W.AxiomGoalManager.cancelGoal(g.id, 'n/a');
    assert.throws(() => W.AxiomGoalManager.setGoalPriority(g.id, W.AxiomGoalManager.GOAL_PRIORITY.HIGH));
  });

  await test('setGoalPriority(): rejects an unknown priority value', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'X' });
    assert.throws(() => W.AxiomGoalManager.setGoalPriority(g.id, 42));
  });

  // ------------------------------------------------------------
  // Goal queue & automatic priority ordering
  // ------------------------------------------------------------
  await test('getGoalQueue(): orders queued goals by priority (desc), then createdAt (asc)', () => {
    const W = loadSandbox();
    const P = W.AxiomGoalManager.GOAL_PRIORITY;
    const low = W.AxiomGoalManager.createGoal({ title: 'Low', priority: P.LOW });
    const high = W.AxiomGoalManager.createGoal({ title: 'High', priority: P.HIGH });
    const normalFirst = W.AxiomGoalManager.createGoal({ title: 'Normal-1', priority: P.NORMAL });
    const normalSecond = W.AxiomGoalManager.createGoal({ title: 'Normal-2', priority: P.NORMAL });
    [low, high, normalFirst, normalSecond].forEach((g) => W.AxiomGoalManager.markGoalQueued(g.id));

    const queue = W.AxiomGoalManager.getGoalQueue();
    assert.deepStrictEqual(queue.map((g) => g.id), [high.id, normalFirst.id, normalSecond.id, low.id]);
  });

  await test('getGoalQueue(): excludes non-Queued goals', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.markGoalQueued(a.id);
    // b stays Pending
    const queue = W.AxiomGoalManager.getGoalQueue();
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].id, a.id);
  });

  await test('enqueueGoal(): moves a Pending goal to Queued and is idempotent when already Queued', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Enqueue me' });
    let r = W.AxiomGoalManager.enqueueGoal(g.id);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.goal.status, 'queued');
    r = W.AxiomGoalManager.enqueueGoal(g.id); // already queued
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.goal.status, 'queued');
  });

  await test('dequeueNextGoal(): pops the highest-priority queued goal and transitions it to Running', () => {
    const W = loadSandbox();
    const P = W.AxiomGoalManager.GOAL_PRIORITY;
    const low = W.AxiomGoalManager.createGoal({ title: 'Low', priority: P.LOW });
    const high = W.AxiomGoalManager.createGoal({ title: 'High', priority: P.HIGH });
    W.AxiomGoalManager.markGoalQueued(low.id);
    W.AxiomGoalManager.markGoalQueued(high.id);

    const r = W.AxiomGoalManager.dequeueNextGoal();
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.goal.id, high.id);
    assert.strictEqual(r.goal.status, 'running');
    assert.strictEqual(W.AxiomGoalManager.getGoalQueue().length, 1);
    assert.strictEqual(W.AxiomGoalManager.getGoalQueue()[0].id, low.id);
  });

  await test('dequeueNextGoal(): returns a failure result (not a throw) on an empty queue', () => {
    const W = loadSandbox();
    const r = W.AxiomGoalManager.dequeueNextGoal();
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.goal, null);
  });

  // ------------------------------------------------------------
  // Dependency tracking
  // ------------------------------------------------------------
  await test('addGoalDependency(): records the edge in both directions', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id); // b depends on a
    const deps = W.AxiomGoalManager.getGoalDependencies(b.id);
    assert.strictEqual(deps.length, 1);
    assert.strictEqual(deps[0].goalId, a.id);
    assert.strictEqual(deps[0].satisfied, false);
    const depOfA = W.AxiomGoalManager.getGoalDependents(a.id);
    assert.strictEqual(depOfA.length, 1);
    assert.strictEqual(depOfA[0], b.id);
  });

  await test('addGoalDependency(): is idempotent for the same edge added twice', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    assert.strictEqual(W.AxiomGoalManager.getGoalDependencies(b.id).length, 1);
  });

  await test('addGoalDependency(): rejects a goal depending on itself', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    assert.throws(() => W.AxiomGoalManager.addGoalDependency(a.id, a.id));
  });

  await test('addGoalDependency(): rejects an unknown goal on either side', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    assert.throws(() => W.AxiomGoalManager.addGoalDependency(a.id, 'goal_missing'));
    assert.throws(() => W.AxiomGoalManager.addGoalDependency('goal_missing', a.id));
  });

  await test('removeGoalDependency(): removes the edge in both directions', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    W.AxiomGoalManager.removeGoalDependency(b.id, a.id);
    assert.strictEqual(W.AxiomGoalManager.getGoalDependencies(b.id).length, 0);
    assert.strictEqual(W.AxiomGoalManager.getGoalDependents(a.id).length, 0);
  });

  await test('getGoalDependencies(): satisfied flips to true once the prerequisite completes', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    W.AxiomGoalManager.markGoalQueued(a.id);
    W.AxiomGoalManager.markGoalRunning(a.id);
    W.AxiomGoalManager.completeGoal(a.id);
    const deps = W.AxiomGoalManager.getGoalDependencies(b.id);
    assert.strictEqual(deps[0].satisfied, true);
  });

  await test('isGoalBlocked(): true while any dependency is unresolved, false once all are Completed', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    assert.strictEqual(W.AxiomGoalManager.isGoalBlocked(b.id), true);
    W.AxiomGoalManager.markGoalQueued(a.id);
    W.AxiomGoalManager.markGoalRunning(a.id);
    W.AxiomGoalManager.completeGoal(a.id);
    assert.strictEqual(W.AxiomGoalManager.isGoalBlocked(b.id), false);
  });

  // ------------------------------------------------------------
  // Circular dependency detection
  // ------------------------------------------------------------
  await test('addGoalDependency(): rejects a direct circular dependency (A<->B)', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id); // b depends on a
    assert.throws(() => W.AxiomGoalManager.addGoalDependency(a.id, b.id)); // a depends on b -> cycle
  });

  await test('addGoalDependency(): rejects a transitive circular dependency (A->B->C->A)', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    const c = W.AxiomGoalManager.createGoal({ title: 'C' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id); // b depends on a
    W.AxiomGoalManager.addGoalDependency(c.id, b.id); // c depends on b
    assert.throws(() => W.AxiomGoalManager.addGoalDependency(a.id, c.id)); // a depends on c -> cycle
    // graph must be left unmodified after the refused edge
    assert.strictEqual(W.AxiomGoalManager.getGoalDependencies(a.id).length, 0);
  });

  // ------------------------------------------------------------
  // Automatic goal ordering
  // ------------------------------------------------------------
  await test('getGoalExecutionOrder(): a dependency is always ordered before its dependent', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    const order = W.AxiomGoalManager.getGoalExecutionOrder().map((g) => g.id);
    assert.ok(order.indexOf(a.id) < order.indexOf(b.id));
  });

  await test('getGoalExecutionOrder(): a satisfied (Completed) dependency does not hold up its dependent\'s position', () => {
    const W = loadSandbox();
    const P = W.AxiomGoalManager.GOAL_PRIORITY;
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B', priority: P.CRITICAL });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    W.AxiomGoalManager.markGoalQueued(a.id);
    W.AxiomGoalManager.markGoalRunning(a.id);
    W.AxiomGoalManager.completeGoal(a.id);
    const order = W.AxiomGoalManager.getGoalExecutionOrder().map((g) => g.id);
    assert.strictEqual(order.length, 1);
    assert.strictEqual(order[0], b.id); // a is terminal, excluded from the (non-terminal) order
  });

  await test('getGoalExecutionOrder(): independent goals with no dependencies fall back to priority ordering', () => {
    const W = loadSandbox();
    const P = W.AxiomGoalManager.GOAL_PRIORITY;
    const low = W.AxiomGoalManager.createGoal({ title: 'Low', priority: P.LOW });
    const high = W.AxiomGoalManager.createGoal({ title: 'High', priority: P.HIGH });
    const order = W.AxiomGoalManager.getGoalExecutionOrder().map((g) => g.id);
    assert.strictEqual(order.length, 2);
    assert.strictEqual(order[0], high.id);
    assert.strictEqual(order[1], low.id);
  });

  await test('getGoalExecutionOrder(): respects a diamond dependency graph (A -> {B,C} -> D)', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    const c = W.AxiomGoalManager.createGoal({ title: 'C' });
    const d = W.AxiomGoalManager.createGoal({ title: 'D' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    W.AxiomGoalManager.addGoalDependency(c.id, a.id);
    W.AxiomGoalManager.addGoalDependency(d.id, b.id);
    W.AxiomGoalManager.addGoalDependency(d.id, c.id);
    const order = W.AxiomGoalManager.getGoalExecutionOrder().map((g) => g.id);
    assert.strictEqual(order.indexOf(a.id), 0);
    assert.strictEqual(order.indexOf(d.id), 3);
    assert.ok(order.indexOf(a.id) < order.indexOf(b.id));
    assert.ok(order.indexOf(a.id) < order.indexOf(c.id));
    assert.ok(order.indexOf(b.id) < order.indexOf(d.id));
    assert.ok(order.indexOf(c.id) < order.indexOf(d.id));
  });

  // ------------------------------------------------------------
  // Goal scheduling
  // ------------------------------------------------------------
  await test('scheduleGoal(): an unblocked Pending goal is admitted to Queued', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Free' });
    const r = W.AxiomGoalManager.scheduleGoal(g.id);
    assert.strictEqual(r.scheduled, true);
    assert.strictEqual(r.blocked, false);
    assert.strictEqual(r.goal.status, 'queued');
  });

  await test('scheduleGoal(): a goal with an unresolved dependency is parked in Waiting, not Queued', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    const r = W.AxiomGoalManager.scheduleGoal(b.id);
    assert.strictEqual(r.scheduled, false);
    assert.strictEqual(r.blocked, true);
    assert.strictEqual(r.goal.status, 'waiting');
  });

  await test('scheduleGoal(): once the dependency completes, re-scheduling admits the waiting goal', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    W.AxiomGoalManager.scheduleGoal(b.id); // -> waiting
    W.AxiomGoalManager.markGoalQueued(a.id);
    W.AxiomGoalManager.markGoalRunning(a.id);
    W.AxiomGoalManager.completeGoal(a.id);
    const r = W.AxiomGoalManager.scheduleGoal(b.id);
    assert.strictEqual(r.scheduled, true);
    assert.strictEqual(r.goal.status, 'queued');
  });

  await test('runGoalScheduler(): admits every unblocked goal and parks every blocked one, in dependency order', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    const c = W.AxiomGoalManager.createGoal({ title: 'C' }); // independent
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);

    const result = W.AxiomGoalManager.runGoalScheduler();
    const scheduledIds = result.scheduled.map((g) => g.id);
    const blockedIds = result.blocked.map((g) => g.id);

    assert.ok(scheduledIds.indexOf(a.id) !== -1);
    assert.ok(scheduledIds.indexOf(c.id) !== -1);
    assert.ok(blockedIds.indexOf(b.id) !== -1);
    assert.strictEqual(W.AxiomGoalManager.getGoal(b.id).status, 'waiting');
  });

  // ------------------------------------------------------------
  // Pause / Resume
  // ------------------------------------------------------------
  await test('pauseGoal(): Running -> Waiting, flagged isPaused, resumeGoal(): Waiting -> Queued', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Pausable' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);

    const paused = W.AxiomGoalManager.pauseGoal(g.id, 'operator requested pause');
    assert.strictEqual(paused.goal.status, 'waiting');
    assert.strictEqual(paused.goal.isPaused, true);
    assert.strictEqual(paused.goal.pauseReason, 'operator requested pause');

    const resumed = W.AxiomGoalManager.resumeGoal(g.id);
    assert.strictEqual(resumed.goal.status, 'queued');
    assert.strictEqual(resumed.goal.isPaused, false);
    assert.strictEqual(resumed.goal.pauseReason, null);
  });

  await test('pauseGoal(): rejects a goal that is not Running or Queued', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Still pending' });
    assert.throws(() => W.AxiomGoalManager.pauseGoal(g.id));
  });

  await test('resumeGoal(): rejects a Waiting goal that is blocked on a dependency, not paused', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    W.AxiomGoalManager.scheduleGoal(b.id); // -> waiting (blocked, NOT paused)
    assert.throws(() => W.AxiomGoalManager.resumeGoal(b.id));
  });

  await test('resumeGoal(): rejects a goal that is not Waiting at all', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Pending goal' });
    assert.throws(() => W.AxiomGoalManager.resumeGoal(g.id));
  });

  // ------------------------------------------------------------
  // Cancel (Part 3A's cancelGoal, reused untouched) + Retry
  // ------------------------------------------------------------
  await test('cancelGoal(): still works exactly as Part 3A left it', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Cancel me' });
    const r = W.AxiomGoalManager.cancelGoal(g.id, 'no longer needed');
    assert.strictEqual(r.goal.status, 'cancelled');
  });

  await test('retryGoal(): a Failed goal produces a fresh goal carrying title/metadata/priority/parent forward', () => {
    const W = loadSandbox();
    const P = W.AxiomGoalManager.GOAL_PRIORITY;
    const g = W.AxiomGoalManager.createGoal({
      title: 'Flaky', metadata: { attempt: 1 }, priority: P.HIGH
    });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.failGoal(g.id, 'transient error');

    const retried = W.AxiomGoalManager.retryGoal(g.id);
    assert.notStrictEqual(retried.id, g.id);
    assert.strictEqual(retried.title, 'Flaky');
    assert.deepStrictEqual(retried.metadata, { attempt: 1 });
    assert.strictEqual(retried.priority, P.HIGH);
    assert.strictEqual(retried.status, 'pending');
    assert.strictEqual(retried.retryOf, g.id);
    assert.strictEqual(retried.retryCount, 1);

    // the original terminal record is untouched, never resurrected
    assert.strictEqual(W.AxiomGoalManager.getGoal(g.id).status, 'failed');
  });

  await test('retryGoal(): a Cancelled goal can also be retried', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Cancelled once' });
    W.AxiomGoalManager.cancelGoal(g.id, 'paused project');
    const retried = W.AxiomGoalManager.retryGoal(g.id);
    assert.strictEqual(retried.status, 'pending');
    assert.strictEqual(retried.retryOf, g.id);
  });

  await test('retryGoal(): rejects a goal that is not yet terminal', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Still going' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    assert.throws(() => W.AxiomGoalManager.retryGoal(g.id));
  });

  await test('retryGoal(): carries the original\'s dependency edges forward onto the new goal', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'Prereq' });
    const g = W.AxiomGoalManager.createGoal({ title: 'Dependent' });
    W.AxiomGoalManager.addGoalDependency(g.id, a.id);
    W.AxiomGoalManager.cancelGoal(g.id, 'stopped');

    const retried = W.AxiomGoalManager.retryGoal(g.id);
    const deps = W.AxiomGoalManager.getGoalDependencies(retried.id);
    assert.strictEqual(deps.length, 1);
    assert.strictEqual(deps[0].goalId, a.id);
  });

  await test('retryGoal(): repeated retries chain retryCount upward', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Chronically flaky' });
    W.AxiomGoalManager.cancelGoal(g.id, 'stop 1');
    const retry1 = W.AxiomGoalManager.retryGoal(g.id);
    W.AxiomGoalManager.cancelGoal(retry1.id, 'stop 2');
    const retry2 = W.AxiomGoalManager.retryGoal(retry1.id);
    assert.strictEqual(retry2.retryCount, 2);
    assert.strictEqual(retry2.retryOf, retry1.id);
  });

  // ------------------------------------------------------------
  // Duplicate goal prevention
  // ------------------------------------------------------------
  await test('createGoal({dedupeKey}): a second create with the same key returns the existing (non-terminal) goal', () => {
    const W = loadSandbox();
    const first = W.AxiomGoalManager.createGoal({ title: 'Sync inbox', dedupeKey: 'sync-inbox' });
    const second = W.AxiomGoalManager.createGoal({ title: 'Sync inbox again', dedupeKey: 'sync-inbox' });
    assert.strictEqual(second.id, first.id);
    assert.strictEqual(second.duplicate, true);
    assert.strictEqual(W.AxiomGoalManager.listGoals().length, 1);
  });

  await test('createGoal({dedupeKey}): scoped per parentId — same key under a different parent is not a duplicate', () => {
    const W = loadSandbox();
    const parentA = W.AxiomGoalManager.createGoal({ title: 'Parent A' });
    const parentB = W.AxiomGoalManager.createGoal({ title: 'Parent B' });
    const childA = W.AxiomGoalManager.createChildGoal(parentA.id, { title: 'Step', dedupeKey: 'step' });
    const childB = W.AxiomGoalManager.createChildGoal(parentB.id, { title: 'Step', dedupeKey: 'step' });
    assert.notStrictEqual(childA.id, childB.id);
  });

  await test('createGoal({dedupeKey}): once the original reaches a terminal status, the key is free again', () => {
    const W = loadSandbox();
    const first = W.AxiomGoalManager.createGoal({ title: 'Sync inbox', dedupeKey: 'sync-inbox' });
    W.AxiomGoalManager.cancelGoal(first.id, 'stale request');
    const second = W.AxiomGoalManager.createGoal({ title: 'Sync inbox', dedupeKey: 'sync-inbox' });
    assert.notStrictEqual(second.id, first.id);
    assert.strictEqual(second.duplicate, undefined);
  });

  await test('createGoal(): omitting dedupeKey never triggers duplicate prevention (default, backward-compatible)', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'Same title' });
    const b = W.AxiomGoalManager.createGoal({ title: 'Same title' });
    assert.notStrictEqual(a.id, b.id);
  });

  // ------------------------------------------------------------
  // Snapshot immutability + non-duplication of Part 3A behavior
  // ------------------------------------------------------------
  await test('every new Part 3B read returns a deep-frozen snapshot, same discipline as Part 3A', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'Frozen' });
    const queued = W.AxiomGoalManager.enqueueGoal(g.id).goal;
    assert.strictEqual(Object.isFrozen(queued), true);
    const queue = W.AxiomGoalManager.getGoalQueue();
    assert.strictEqual(Object.isFrozen(queue[0]), true);
  });

  await test('Part 3B installs nothing onto AxiomOrchestrator either (same posture as Part 3A)', () => {
    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomOrchestrator.scheduleGoal, 'undefined');
    assert.strictEqual(typeof W.AxiomOrchestrator.addGoalDependency, 'undefined');
    assert.strictEqual(typeof W.AxiomGoalManager.scheduleGoal, 'function');
  });

  await test('Event Bus: goalmgr_priority_changed, goalmgr_dependency_added, goalmgr_paused, goalmgr_resumed, goalmgr_retried all fire', () => {
    const W = loadSandbox();
    const seen = [];
    ['goalmgr_priority_changed', 'goalmgr_dependency_added', 'goalmgr_paused', 'goalmgr_resumed', 'goalmgr_retried']
      .forEach((evt) => W.AxiomOrchestrator.on(evt, () => seen.push(evt)));

    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.setGoalPriority(b.id, W.AxiomGoalManager.GOAL_PRIORITY.HIGH);
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    W.AxiomGoalManager.markGoalQueued(a.id);
    W.AxiomGoalManager.markGoalRunning(a.id);
    const paused = W.AxiomGoalManager.pauseGoal(a.id, 'hold');
    W.AxiomGoalManager.resumeGoal(a.id);
    W.AxiomGoalManager.markGoalRunning(a.id);
    W.AxiomGoalManager.failGoal(a.id, 'boom');
    W.AxiomGoalManager.retryGoal(a.id);

    assert.deepStrictEqual(seen, [
      'goalmgr_priority_changed', 'goalmgr_dependency_added', 'goalmgr_paused', 'goalmgr_resumed', 'goalmgr_retried'
    ]);
    void paused;
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
