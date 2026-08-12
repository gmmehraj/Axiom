// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3C: Autonomous Decision Engine
// regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1),
// os/core/runtime-context.js (Step 6 Part 5), os/core/goal-manager.js
// (Step 7 Parts 3A+3B), and os/core/capability-router.js (Step 6
// Part 3), then the new os/core/autonomous-decision-engine.js (Step 7
// Part 3C) in a minimal vm sandbox — same pattern every prior Block 2
// suite in this project already uses. Agents are registered directly
// via AxiomOrchestrator.registerAgent() with small handlers standing
// in for real subsystems, exactly as the Part 3 capability-routing
// suite already does.
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
  if (opts.withCapabilityRouter !== false) load('os/core/capability-router.js');
  if (opts.withDecisionEngine !== false) load('os/core/autonomous-decision-engine.js');

  return sandbox.window;
}

function registerAgent(W, config) {
  return W.AxiomOrchestrator.registerAgent(Object.assign({
    handler: async () => ({ ok: true })
  }, config));
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
  console.log('AXIOM Block 2 / Step 7 / Part 3C — Autonomous Decision Engine regression\n');

  // ------------------------------------------------------------
  // Load-order guards
  // ------------------------------------------------------------
  await test('module does not install itself without AxiomOrchestrator present', () => {
    const sandbox = { console, setTimeout, clearTimeout, Date, Object, Array, JSON, Math, Error };
    sandbox.window = sandbox;
    sandbox.document = undefined;
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(AI, 'os/core/autonomous-decision-engine.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'autonomous-decision-engine.js' });
    assert.strictEqual(sandbox.window.AxiomDecisionEngine, undefined);
  });

  await test('module does not install itself without AxiomGoalManager present', () => {
    const W = loadSandbox({ withGoalManager: false, withDecisionEngine: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/autonomous-decision-engine.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'autonomous-decision-engine.js' });
    assert.strictEqual(W.AxiomDecisionEngine, undefined);
  });

  await test('module does not install itself without AxiomCapabilityRouter present', () => {
    const W = loadSandbox({ withCapabilityRouter: false, withDecisionEngine: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/autonomous-decision-engine.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'autonomous-decision-engine.js' });
    assert.strictEqual(W.AxiomDecisionEngine, undefined);
  });

  await test('installs nothing onto AxiomOrchestrator (same standalone posture as goal-manager.js)', () => {
    const W = loadSandbox();
    assert.strictEqual(W.AxiomOrchestrator.evaluateGoal, undefined);
    assert.strictEqual(W.AxiomOrchestrator.selectNextGoal, undefined);
    assert.strictEqual(W.AxiomOrchestrator.runDecisionCycle, undefined);
  });

  // ------------------------------------------------------------
  // Capability & agent evaluation (dynamic, no hardcoded table)
  // ------------------------------------------------------------
  await test('evaluateGoal(): a goal with no capability requirement is eligible with no agents registered at all', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'plain goal' });
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, true, ev.reason);
    assert.strictEqual(ev.capability, null);
    assert.strictEqual(ev.agentId, null);
  });

  await test('evaluateGoal(): a goal requiring an unregistered capability is ineligible with a clear reason', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'needs ghost-cap', metadata: { capability: 'ghost-cap' } });
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, false);
    assert.ok(/no agent registered/.test(ev.reason), ev.reason);
  });

  await test('evaluateGoal(): a goal becomes eligible the moment a matching agent is registered at runtime (no code change)', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'needs summarize', metadata: { capability: 'summarize' } });
    assert.strictEqual(W.AxiomDecisionEngine.evaluateGoal(g.id).eligible, false);

    registerAgent(W, { id: 'agent-sum', capabilities: ['summarize'] });

    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, true, ev.reason);
    assert.strictEqual(ev.agentId, 'agent-sum');
  });

  await test('evaluateGoal(): capability metadata alias "requiredCapability" is honored identically to "capability"', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-tr', capabilities: ['translate'] });
    const g = W.AxiomGoalManager.createGoal({ title: 'needs translate', metadata: { requiredCapability: 'translate' } });
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, true, ev.reason);
    assert.strictEqual(ev.agentId, 'agent-tr');
  });

  await test('evaluateGoal(): distinguishes "no agent for capability" from "agent exists but ineligible" (disabled)', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-disabled', capabilities: ['render'] });
    W.AxiomOrchestrator.setAgentStatus('agent-disabled', 'disabled');
    const g = W.AxiomGoalManager.createGoal({ title: 'needs render', metadata: { capability: 'render' } });
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, false);
    assert.ok(/agents registered, but none are currently eligible/.test(ev.reason), ev.reason);
  });

  await test('evaluateGoal(): honors a goal-specified requiredPermission via the real capability-router selectAgent()', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-noperm', capabilities: ['deploy'], permissions: [] });
    const g = W.AxiomGoalManager.createGoal({
      title: 'needs deploy with perm',
      metadata: { capability: 'deploy', requiredPermission: 'infra:deploy' }
    });
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, false);

    registerAgent(W, { id: 'agent-perm', capabilities: ['deploy'], permissions: ['infra:deploy'] });
    const ev2 = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev2.eligible, true, ev2.reason);
    assert.strictEqual(ev2.agentId, 'agent-perm');
  });

  await test('evaluateGoal(): honors a goal-specified excludeAgents list', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-only', capabilities: ['index'] });
    const g = W.AxiomGoalManager.createGoal({ title: 'needs index', metadata: { capability: 'index', excludeAgents: ['agent-only'] } });
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, false);
  });

  // ------------------------------------------------------------
  // Goal-graph evaluation (dependencies, status, pause)
  // ------------------------------------------------------------
  await test('evaluateGoal(): a goal blocked by an unresolved dependency is ineligible', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    const ev = W.AxiomDecisionEngine.evaluateGoal(b.id);
    assert.strictEqual(ev.blocked, true);
    assert.strictEqual(ev.eligible, false);
    assert.ok(/unresolved dependencies/.test(ev.reason), ev.reason);
  });

  await test('evaluateGoal(): a dependency completing makes the dependent eligible on the next evaluation', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    W.AxiomGoalManager.markGoalQueued(a.id);
    W.AxiomGoalManager.markGoalRunning(a.id);
    W.AxiomGoalManager.completeGoal(a.id, { done: true });
    const ev = W.AxiomDecisionEngine.evaluateGoal(b.id);
    assert.strictEqual(ev.blocked, false);
    assert.strictEqual(ev.eligible, true, ev.reason);
  });

  await test('evaluateGoal(): a terminal goal is never eligible', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'X' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.completeGoal(g.id, {});
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, false);
    assert.ok(/terminal/.test(ev.reason), ev.reason);
  });

  await test('evaluateGoal(): a paused (Waiting, isPaused) goal is ineligible with a distinct reason from dependency-blocked', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'P' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    W.AxiomGoalManager.pauseGoal(g.id, 'operator hold');
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, false);
    assert.ok(/paused/.test(ev.reason), ev.reason);
  });

  await test('evaluateGoal(): a Running goal is not (re-)eligible', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'R' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, false);
    assert.ok(/not schedulable/.test(ev.reason), ev.reason);
  });

  await test('evaluateGoal(): throws a clear error for an unknown goal id', () => {
    const W = loadSandbox();
    assert.throws(() => W.AxiomDecisionEngine.evaluateGoal('no-such-goal'));
  });

  // ------------------------------------------------------------
  // Runtime Context / system-load evaluation
  // ------------------------------------------------------------
  await test('getSystemLoad(): reflects the real, live AxiomRuntimeContext active-context count', () => {
    const W = loadSandbox();
    const before = W.AxiomDecisionEngine.getSystemLoad();
    W.AxiomGoalManager.createGoal({ title: 'creates a real context too' });
    const after = W.AxiomDecisionEngine.getSystemLoad();
    assert.strictEqual(after.activeContexts, before.activeContexts + 1);
  });

  await test('getSystemLoad(): runningGoals matches AxiomGoalManager.listGoals({status: RUNNING}) exactly', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'G' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    W.AxiomGoalManager.markGoalRunning(g.id);
    const load = W.AxiomDecisionEngine.getSystemLoad();
    assert.strictEqual(load.runningGoals, W.AxiomGoalManager.listGoals({ status: 'running' }).length);
    assert.strictEqual(load.runningGoals, 1);
  });

  await test('setMaxConcurrentGoals()/getMaxConcurrentGoals(): defaults to unbounded (null), is settable and clamped to non-negative integers', () => {
    const W = loadSandbox();
    assert.strictEqual(W.AxiomDecisionEngine.getMaxConcurrentGoals(), null);
    W.AxiomDecisionEngine.setMaxConcurrentGoals(3);
    assert.strictEqual(W.AxiomDecisionEngine.getMaxConcurrentGoals(), 3);
    assert.throws(() => W.AxiomDecisionEngine.setMaxConcurrentGoals(-1));
    assert.throws(() => W.AxiomDecisionEngine.setMaxConcurrentGoals(1.5));
    W.AxiomDecisionEngine.setMaxConcurrentGoals(null);
    assert.strictEqual(W.AxiomDecisionEngine.getMaxConcurrentGoals(), null);
  });

  await test('evaluateGoal(): a goal is ineligible once running-goal count reaches the configured capacity', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'over capacity' });
    W.AxiomDecisionEngine.setMaxConcurrentGoals(0);
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    assert.strictEqual(ev.eligible, false);
    assert.ok(/capacity/.test(ev.reason), ev.reason);
    assert.strictEqual(ev.systemLoad.atCapacity, true);
  });

  // ------------------------------------------------------------
  // Ranking & selection (dynamic, no hardcoded sequence)
  // ------------------------------------------------------------
  await test('rankCandidateGoals(): follows the same dependency/priority ordering as getGoalExecutionOrder()', () => {
    const W = loadSandbox();
    const low = W.AxiomGoalManager.createGoal({ title: 'low', priority: W.AxiomGoalManager.GOAL_PRIORITY.LOW });
    const high = W.AxiomGoalManager.createGoal({ title: 'high', priority: W.AxiomGoalManager.GOAL_PRIORITY.CRITICAL });
    const ranked = W.AxiomDecisionEngine.rankCandidateGoals({ goalIds: [low.id, high.id] });
    assert.strictEqual(ranked.length, 2);
    assert.strictEqual(ranked[0].goalId, high.id);
    assert.strictEqual(ranked[1].goalId, low.id);
  });

  await test('selectNextGoal(): picks the highest-priority fully-eligible candidate, skipping capability-blocked higher priority ones', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-only-b', capabilities: ['b-cap'] });
    const higherButBlocked = W.AxiomGoalManager.createGoal({
      title: 'higher but no agent', priority: W.AxiomGoalManager.GOAL_PRIORITY.CRITICAL, metadata: { capability: 'a-cap' }
    });
    const lowerButReady = W.AxiomGoalManager.createGoal({
      title: 'lower but ready', priority: W.AxiomGoalManager.GOAL_PRIORITY.LOW, metadata: { capability: 'b-cap' }
    });
    const sel = W.AxiomDecisionEngine.selectNextGoal({ goalIds: [higherButBlocked.id, lowerButReady.id] });
    assert.ok(sel);
    assert.strictEqual(sel.goalId, lowerButReady.id);
  });

  await test('selectNextGoal(): returns null when no candidate is eligible', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'needs ghost', metadata: { capability: 'ghost' } });
    const sel = W.AxiomDecisionEngine.selectNextGoal({ goalIds: [g.id] });
    assert.strictEqual(sel, null);
  });

  await test('selectNextGoal(): an independent branch behind a blocked dependency is still considered (diamond-safe)', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A (unresolved)', priority: W.AxiomGoalManager.GOAL_PRIORITY.CRITICAL });
    const b = W.AxiomGoalManager.createGoal({ title: 'B depends on A', priority: W.AxiomGoalManager.GOAL_PRIORITY.CRITICAL });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    const c = W.AxiomGoalManager.createGoal({ title: 'C independent', priority: W.AxiomGoalManager.GOAL_PRIORITY.LOW });
    const sel = W.AxiomDecisionEngine.selectNextGoal({ goalIds: [a.id, b.id, c.id] });
    assert.ok(sel);
    assert.ok([a.id, c.id].indexOf(sel.goalId) !== -1); // a is unblocked & higher priority, wins over c
    assert.strictEqual(sel.goalId, a.id);
  });

  // ------------------------------------------------------------
  // Admission (composes goal-manager's own scheduleGoal/markGoalRunning)
  // ------------------------------------------------------------
  await test('admitGoal(): drives an eligible Pending goal through Queued into Running via the real status machine', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'admit me' });
    const seen = [];
    ['goalmgr_queued', 'goalmgr_running', 'decisionengine_admitted'].forEach((evt) => W.AxiomOrchestrator.on(evt, () => seen.push(evt)));
    const result = W.AxiomDecisionEngine.admitGoal(g.id);
    assert.strictEqual(result.admitted, true);
    assert.strictEqual(result.goal.status, 'running');
    assert.deepStrictEqual(seen, ['goalmgr_queued', 'goalmgr_running', 'decisionengine_admitted']);
  });

  await test('admitGoal(): refuses (does not force) an ineligible goal, no status change occurs', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'needs ghost', metadata: { capability: 'ghost' } });
    const result = W.AxiomDecisionEngine.admitGoal(g.id);
    assert.strictEqual(result.admitted, false);
    assert.strictEqual(result.goal.status, 'pending');
  });

  await test('admitGoal(): a goal already Queued is admitted straight to Running (scheduleGoal is a no-op for it)', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'already queued' });
    W.AxiomGoalManager.markGoalQueued(g.id);
    const result = W.AxiomDecisionEngine.admitGoal(g.id);
    assert.strictEqual(result.admitted, true);
    assert.strictEqual(result.goal.status, 'running');
  });

  // ------------------------------------------------------------
  // Full autonomous decision cycle
  // ------------------------------------------------------------
  await test('runDecisionCycle(): admits scheduler-eligible Pending goals and reuses Part 3B runGoalScheduler() for Waiting/blocked ones', () => {
    const W = loadSandbox();
    const a = W.AxiomGoalManager.createGoal({ title: 'A' });
    const b = W.AxiomGoalManager.createGoal({ title: 'B depends on A' });
    W.AxiomGoalManager.addGoalDependency(b.id, a.id);
    const cycle = W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [a.id, b.id] });
    assert.ok(cycle.admitted, 'expected a admitted: ' + JSON.stringify(cycle));
    assert.strictEqual(cycle.admitted.id, a.id);
    assert.strictEqual(cycle.admitted.status, 'running');
    assert.strictEqual(cycle.parkedWaiting, 1);
    assert.strictEqual(W.AxiomGoalManager.getGoal(b.id).status, 'waiting');
  });

  await test('runDecisionCycle(): emits decisionengine_idle and returns admitted:null when nothing is eligible', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'needs ghost', metadata: { capability: 'ghost' } });
    let idleFired = false;
    W.AxiomOrchestrator.on('decisionengine_idle', () => { idleFired = true; });
    const cycle = W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [g.id] });
    assert.strictEqual(cycle.admitted, null);
    assert.strictEqual(idleFired, true);
  });

  await test('runDecisionCycle(): repeated calls drain the queue one eligible goal at a time, highest priority first', () => {
    const W = loadSandbox();
    const low = W.AxiomGoalManager.createGoal({ title: 'low', priority: W.AxiomGoalManager.GOAL_PRIORITY.LOW });
    const high = W.AxiomGoalManager.createGoal({ title: 'high', priority: W.AxiomGoalManager.GOAL_PRIORITY.CRITICAL });
    const c1 = W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [low.id, high.id] });
    assert.strictEqual(c1.admitted.id, high.id);
    W.AxiomGoalManager.completeGoal(high.id, {});
    const c2 = W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [low.id, high.id] });
    assert.strictEqual(c2.admitted.id, low.id);
  });

  await test('runDecisionCycle(): a goal blocked purely by capacity becomes admittable once capacity frees up', () => {
    const W = loadSandbox();
    const running = W.AxiomGoalManager.createGoal({ title: 'already running' });
    W.AxiomGoalManager.markGoalQueued(running.id);
    W.AxiomGoalManager.markGoalRunning(running.id);
    W.AxiomDecisionEngine.setMaxConcurrentGoals(1);

    const waiting = W.AxiomGoalManager.createGoal({ title: 'wants in' });
    const c1 = W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [waiting.id] });
    assert.strictEqual(c1.admitted, null);

    W.AxiomGoalManager.completeGoal(running.id, {});
    const c2 = W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [waiting.id] });
    assert.ok(c2.admitted, 'expected admission once capacity freed: ' + JSON.stringify(c2));
    assert.strictEqual(c2.admitted.id, waiting.id);
  });

  // ------------------------------------------------------------
  // History, metrics, immutability, non-duplication
  // ------------------------------------------------------------
  await test('getDecisionHistory(): records admitted/deferred/idle outcomes, most recent first, bounded', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'one' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'needs ghost', metadata: { capability: 'ghost' } });
    W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [g1.id] });
    W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [g2.id] });
    const history = W.AxiomDecisionEngine.getDecisionHistory();
    assert.strictEqual(history[0].outcome, 'idle');
    assert.strictEqual(history[1].outcome, 'admitted');
  });

  await test('getDecisionMetrics(): counts cycles/admitted/deferred/idle accurately', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'ok' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'needs ghost', metadata: { capability: 'ghost' } });
    W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [g1.id] });
    W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [g2.id] });
    const m = W.AxiomDecisionEngine.getDecisionMetrics();
    assert.strictEqual(m.cycles, 2);
    assert.strictEqual(m.admitted, 1);
    assert.strictEqual(m.idle, 1);
    assert.strictEqual(m.deferred, 0);
  });

  await test('every evaluateGoal()/getSystemLoad()/runDecisionCycle() read returns a deep-frozen snapshot', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'freeze me' });
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    const load = W.AxiomDecisionEngine.getSystemLoad();
    const cycle = W.AxiomDecisionEngine.runDecisionCycle({ goalIds: [] });
    assert.strictEqual(Object.isFrozen(ev), true);
    assert.strictEqual(Object.isFrozen(ev.systemLoad), true);
    assert.strictEqual(Object.isFrozen(load), true);
    assert.strictEqual(Object.isFrozen(cycle), true);
  });

  await test('does not duplicate agent selection logic: evaluateGoal() agentId always matches AxiomCapabilityRouter.selectAgent() directly', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-1', capabilities: ['index'] });
    registerAgent(W, { id: 'agent-2', capabilities: ['index'] });
    const g = W.AxiomGoalManager.createGoal({ title: 'needs index', metadata: { capability: 'index' } });
    const ev = W.AxiomDecisionEngine.evaluateGoal(g.id);
    const direct = W.AxiomCapabilityRouter.selectAgent('index', {});
    assert.strictEqual(ev.agentId, direct.id);
  });

  await test('does not duplicate ordering logic: admitting the selected goal never bypasses transitionGoal()\'s validated state machine', () => {
    const W = loadSandbox();
    const g = W.AxiomGoalManager.createGoal({ title: 'valid path' });
    W.AxiomDecisionEngine.admitGoal(g.id);
    const history = W.AxiomGoalManager.getGoalHistory({ goalId: g.id });
    const statuses = history.map((h) => h.status).reverse();
    const expected = ['pending', 'queued', 'running'];
    assert.strictEqual(statuses.length, expected.length);
    expected.forEach((s, i) => assert.strictEqual(statuses[i], s));
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
