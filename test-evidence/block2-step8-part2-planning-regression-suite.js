// ============================================================
// AXIOM — Block 2 / Step 8 / Part 2: Intelligent Planning
// regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js,
// os/core/runtime-context.js, os/core/goal-manager.js,
// os/core/capability-router.js, os/core/agent-registry-
// integration.js, os/core/goal-manager-learning.js (optional — see
// the "soft dependency" tests below), and the extended
// os/core/decision-engine.js (Step 8 Parts 1+2) in a minimal vm
// sandbox — same pattern block2-step8-part1-decision-engine-
// regression-suite.js already uses.
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
  if (opts.withAgentRegistryIntegration !== false) load('os/core/agent-registry-integration.js');
  if (opts.withGoalManagerLearning !== false) load('os/core/goal-manager-learning.js');
  if (opts.withDecisionEngine !== false) load('os/core/decision-engine.js');

  return sandbox.window;
}

function registerAgent(W, config) {
  return W.AxiomOrchestrator.registerAgent(Object.assign({
    handler: async () => ({ ok: true })
  }, config));
}

function registerCodingAndSearchAgents(W) {
  registerAgent(W, { id: 'coder', name: 'Coder', capabilities: ['coding', 'debug'], tools: [] });
  registerAgent(W, { id: 'searcher', name: 'Searcher', capabilities: ['search', 'research'], tools: [] });
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
  console.log('AXIOM Block 2 / Step 8 / Part 2 — Intelligent Planning regression\n');

  // ------------------------------------------------------------
  // Clean install / no duplicate engine / soft-dependency guards
  // ------------------------------------------------------------
  await test('planning API installs alongside Part 1 without editing any dependency file', () => {
    const deps = [
      'os/core/orchestrator.js', 'os/core/runtime-context.js', 'os/core/goal-manager.js',
      'os/core/capability-router.js', 'os/core/agent-registry-integration.js',
      'os/core/goal-manager-learning.js'
    ];
    const before = {};
    deps.forEach((d) => { before[d] = fs.readFileSync(path.join(AI, d), 'utf8'); });

    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomCognitiveDecisionEngine, 'object');
    assert.strictEqual(typeof W.AxiomCognitiveDecisionEngine.decide, 'function');
    assert.strictEqual(typeof W.AxiomCognitiveDecisionEngine.plan, 'function');
    assert.strictEqual(typeof W.AxiomCognitiveDecisionEngine.generateExecutionPlan, 'function');
    // Still exactly one engine global — no second window.Axiom*DecisionEngine* was introduced.
    assert.strictEqual(W.AxiomDecisionEngine, undefined);

    deps.forEach((d) => {
      assert.strictEqual(fs.readFileSync(path.join(AI, d), 'utf8'), before[d], d + ' was modified');
    });
  });

  await test('generateExecutionPlan() works without goal-manager-learning.js loaded (soft dependency)', () => {
    const W = loadSandbox({ withGoalManagerLearning: false });
    const g1 = W.AxiomGoalManager.createGoal({ title: 'solo task' });
    const p = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [g1.id] });
    assert.strictEqual(p.strategy, 'sequential');
    assert.strictEqual(typeof p.score.overall, 'number');
    assert.strictEqual(p.factors.historicalSuccessRate, 0.5); // neutral default, no learning module
  });

  await test('"learning" strategy throws a clear structural error without goal-manager-learning.js', () => {
    const W = loadSandbox({ withGoalManagerLearning: false });
    const g1 = W.AxiomGoalManager.createGoal({ title: 'solo task' });
    assert.throws(
      () => W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [g1.id] }, { strategy: 'learning' }),
      /requires os\/core\/goal-manager-learning\.js/
    );
  });

  await test('generateAlternativePlans() omits the "learning" strategy when the module is absent', () => {
    const W = loadSandbox({ withGoalManagerLearning: false });
    const g1 = W.AxiomGoalManager.createGoal({ title: 'solo task' });
    const alt = W.AxiomCognitiveDecisionEngine.generateAlternativePlans({ goalIds: [g1.id] });
    // .sort()/.join() rather than deepStrictEqual: the two arrays live in different
    // vm realms (sandbox vs. this file), so deepStrictEqual's prototype check would
    // fail even when the contents genuinely match.
    assert.strictEqual(alt.plans.map((p) => p.strategy).sort().join(','), ['sequential', 'parallel'].sort().join(','));
  });

  // ------------------------------------------------------------
  // Sequential planning
  // ------------------------------------------------------------
  await test('sequential strategy: one goal per step, in Goal Manager\'s own execution order', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'first' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'second' });
    const p = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [g1.id, g2.id] }, { strategy: 'sequential' });
    assert.strictEqual(p.strategy, 'sequential');
    assert.strictEqual(p.steps.length, 2);
    p.steps.forEach((s) => {
      assert.strictEqual(s.mode, 'sequential');
      assert.strictEqual(s.goals.length, 1);
    });
    const authoritative = W.AxiomGoalManager.getGoalExecutionOrder({ goalIds: [g1.id, g2.id] }).map((g) => g.id);
    assert.deepStrictEqual(p.steps.map((s) => s.goals[0].goalId), authoritative);
  });

  // ------------------------------------------------------------
  // Parallel planning
  // ------------------------------------------------------------
  await test('parallel strategy: independent goals share one parallel step', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'independent A' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'independent B' });
    const g3 = W.AxiomGoalManager.createGoal({ title: 'independent C' });
    const p = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [g1.id, g2.id, g3.id] }, { strategy: 'parallel' });
    assert.strictEqual(p.strategy, 'parallel');
    assert.strictEqual(p.steps.length, 1);
    assert.strictEqual(p.steps[0].mode, 'parallel');
    assert.strictEqual(p.steps[0].goals.length, 3);
  });

  await test('parallel strategy produces a lower (or equal) estimated duration than sequential for the same goals', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'A' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'B' });
    const g3 = W.AxiomGoalManager.createGoal({ title: 'C' });
    const ids = [g1.id, g2.id, g3.id];
    const seq = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: ids }, { strategy: 'sequential' });
    const par = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: ids }, { strategy: 'parallel' });
    assert.ok(par.factors.estimatedDurationMs <= seq.factors.estimatedDurationMs);
    assert.ok(par.score.efficiency >= seq.score.efficiency);
  });

  // ------------------------------------------------------------
  // Dependency planning
  // ------------------------------------------------------------
  await test('parallel strategy respects Goal Manager dependencies: a dependent goal is placed in a later step', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'fetch data' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'process data' });
    const g3 = W.AxiomGoalManager.createGoal({ title: 'independent task' });
    W.AxiomGoalManager.addGoalDependency(g2.id, g1.id); // g2 depends on g1

    const p = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [g1.id, g2.id, g3.id] }, { strategy: 'parallel' });
    assert.strictEqual(p.steps.length, 2);

    const step1Ids = p.steps[0].goals.map((g) => g.goalId);
    const step2Ids = p.steps[1].goals.map((g) => g.goalId);
    assert.ok(step1Ids.includes(g1.id));
    assert.ok(step1Ids.includes(g3.id)); // independent goal joins the first wave
    assert.ok(!step1Ids.includes(g2.id));
    assert.strictEqual(step2Ids.length, 1);
    assert.strictEqual(step2Ids[0], g2.id);

    const g2Step = p.steps[1].goals[0];
    assert.strictEqual(g2Step.dependsOn.length, 1);
    assert.strictEqual(g2Step.dependsOn[0], g1.id);
  });

  await test('sequential strategy never orders a dependent goal before its prerequisite', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'prereq' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'dependent' });
    W.AxiomGoalManager.addGoalDependency(g2.id, g1.id);
    const p = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [g2.id, g1.id] }, { strategy: 'sequential' });
    const order = p.steps.map((s) => s.goals[0].goalId);
    assert.ok(order.indexOf(g1.id) < order.indexOf(g2.id));
  });

  await test('a request containing only unknown goalIds throws before any plan is built', () => {
    const W = loadSandbox();
    // Goal Manager's own addGoalDependency() refuses to ever create a cycle (regression-
    // tested in goal-manager.js's own suite), so a genuine cycle cannot be constructed
    // through the public API here. What CAN and must be verified at this layer is that
    // generateExecutionPlan() fails structurally rather than silently returning an empty
    // plan when none of the requested goals resolve to anything real.
    assert.throws(() => W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: ['goal_does_not_exist'] }));
  });

  // ------------------------------------------------------------
  // Plan scoring
  // ------------------------------------------------------------
  await test('every generated plan carries reliability/efficiency/completionProbability/resourceUsage/confidence in [0,1]', () => {
    const W = loadSandbox();
    registerCodingAndSearchAgents(W);
    const g1 = W.AxiomGoalManager.createGoal({ title: 'debug the login function', metadata: { recommendedCapability: 'debug' } });
    const p = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [g1.id] }, { strategy: 'sequential' });
    ['reliability', 'efficiency', 'completionProbability', 'resourceUsage', 'confidence', 'overall'].forEach((k) => {
      assert.strictEqual(typeof p.score[k], 'number');
      assert.ok(p.score[k] >= 0 && p.score[k] <= 1, k + ' out of range: ' + p.score[k]);
    });
  });

  await test('a goal with a live, healthy agent scores higher agentAvailability/capabilityAvailability than one with none', () => {
    const W = loadSandbox();
    registerCodingAndSearchAgents(W);
    const matched = W.AxiomGoalManager.createGoal({ title: 'debug', metadata: { recommendedCapability: 'debug' } });
    const unmatched = W.AxiomGoalManager.createGoal({ title: 'xyzzy plugh quux' });
    const pMatched = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [matched.id] });
    const pUnmatched = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [unmatched.id] });
    assert.strictEqual(pMatched.factors.capabilityAvailability, 1);
    assert.strictEqual(pMatched.factors.agentAvailability, 1);
    assert.strictEqual(pUnmatched.factors.capabilityAvailability, 0);
    assert.strictEqual(pUnmatched.factors.agentAvailability, 0);
    assert.ok(pMatched.score.reliability > pUnmatched.score.reliability);
  });

  await test('scorePlan() re-derives the same score fresh from a plan object', () => {
    const W = loadSandbox();
    registerCodingAndSearchAgents(W);
    const g1 = W.AxiomGoalManager.createGoal({ title: 'debug', metadata: { recommendedCapability: 'debug' } });
    const p = W.AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [g1.id] });
    const rescored = W.AxiomCognitiveDecisionEngine.scorePlan(p);
    assert.deepStrictEqual(rescored, p.score);
  });

  await test('scorePlan() rejects a malformed plan object', () => {
    const W = loadSandbox();
    assert.throws(() => W.AxiomCognitiveDecisionEngine.scorePlan({ foo: 'bar' }));
  });

  // ------------------------------------------------------------
  // Alternative plans
  // ------------------------------------------------------------
  await test('generateAlternativePlans() returns sequential + parallel + learning, exactly one selected', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'A' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'B' });
    const alt = W.AxiomCognitiveDecisionEngine.generateAlternativePlans({ goalIds: [g1.id, g2.id] });
    assert.strictEqual(alt.plans.length, 3);
    assert.strictEqual(alt.plans.map((p) => p.strategy).sort().join(','), ['learning', 'parallel', 'sequential'].sort().join(','));
    assert.ok(alt.selected);
    assert.strictEqual(alt.rejected.length, 2);
    assert.ok(!alt.rejected.some((r) => r.planId === alt.selected.planId));
  });

  await test('generateAlternativePlans() selects the highest-overall-scoring plan', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'A' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'B' });
    const g3 = W.AxiomGoalManager.createGoal({ title: 'C' });
    const alt = W.AxiomCognitiveDecisionEngine.generateAlternativePlans({ goalIds: [g1.id, g2.id, g3.id] });
    const best = alt.plans.reduce((m, p) => (p.score.overall > m.score.overall ? p : m), alt.plans[0]);
    assert.strictEqual(alt.selected.planId, best.planId);
  });

  await test('each rejected plan carries a non-empty, comparative reason', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'A' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'B' });
    const alt = W.AxiomCognitiveDecisionEngine.generateAlternativePlans({ goalIds: [g1.id, g2.id] });
    alt.rejected.forEach((r) => {
      assert.strictEqual(typeof r.reason, 'string');
      assert.ok(r.reason.length > 0);
      assert.ok(r.strategy);
    });
  });

  // ------------------------------------------------------------
  // Explanation generation
  // ------------------------------------------------------------
  await test('explainPlan() mentions the selected strategy, every rejection, the path, and a completion estimate', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'first task' });
    const g2 = W.AxiomGoalManager.createGoal({ title: 'second task' });
    const alt = W.AxiomCognitiveDecisionEngine.generateAlternativePlans({ goalIds: [g1.id, g2.id] });
    const explanation = W.AxiomCognitiveDecisionEngine.explainPlan(alt.selected, alt.rejected);
    assert.ok(explanation.indexOf(alt.selected.strategy) !== -1);
    alt.rejected.forEach((r) => { assert.ok(explanation.indexOf(r.strategy) !== -1); });
    assert.ok(explanation.indexOf('Expected execution path') !== -1);
    assert.ok(explanation.indexOf('Estimated completion time') !== -1);
    assert.ok(explanation.indexOf('first task') !== -1);
  });

  await test('plan()\'s own returned explanation matches explainPlan() called on the same selection', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'only task' });
    const result = W.AxiomCognitiveDecisionEngine.plan({ goalIds: [g1.id] });
    const rebuilt = W.AxiomCognitiveDecisionEngine.explainPlan(result.selected, result.rejected);
    assert.strictEqual(result.explanation, rebuilt);
  });

  // ------------------------------------------------------------
  // Events
  // ------------------------------------------------------------
  await test('planning_started fires before planning_completed, both carrying the same planningId', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'task' });
    const seen = [];
    W.AxiomOrchestrator.on('planning_started', (p) => seen.push(['started', p.planningId]));
    W.AxiomOrchestrator.on('planning_completed', (p) => seen.push(['completed', p.planningId]));
    const result = W.AxiomCognitiveDecisionEngine.plan({ goalIds: [g1.id] });
    assert.deepStrictEqual(seen, [['started', result.planningId], ['completed', result.planningId]]);
  });

  await test('plan_selected fires with the winning plan\'s id, strategy, and score', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'task' });
    let payload = null;
    W.AxiomOrchestrator.on('plan_selected', (p) => { payload = p; });
    const result = W.AxiomCognitiveDecisionEngine.plan({ goalIds: [g1.id] });
    assert.strictEqual(payload.planId, result.selected.planId);
    assert.strictEqual(payload.strategy, result.selected.strategy);
    assert.strictEqual(payload.score.overall, result.selected.score.overall);
  });

  await test('planning_failed fires (with no planning_completed) on invalid input, before any plan is built', () => {
    const W = loadSandbox();
    let failedPayload = null;
    let completedFired = false;
    W.AxiomOrchestrator.on('planning_failed', (p) => { failedPayload = p; });
    W.AxiomOrchestrator.on('planning_completed', () => { completedFired = true; });
    assert.throws(() => W.AxiomCognitiveDecisionEngine.plan({ goalIds: [] }));
    assert.ok(failedPayload);
    assert.strictEqual(completedFired, false);
  });

  await test('planning_failed marks the planning cycle\'s own Runtime Context record as failed', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'task' });
    let failedPayload = null;
    W.AxiomOrchestrator.on('planning_failed', (p) => { failedPayload = p; });
    const originalGetOrder = W.AxiomGoalManager.getGoalExecutionOrder;
    W.AxiomGoalManager.getGoalExecutionOrder = function () { throw new Error('simulated Goal Manager failure'); };
    try {
      try { W.AxiomCognitiveDecisionEngine.plan({ goalIds: [g1.id] }); } catch (e) { /* expected */ }
    } finally {
      W.AxiomGoalManager.getGoalExecutionOrder = originalGetOrder;
    }
    assert.ok(failedPayload);
    const ctxs = W.AxiomRuntimeContext.listContexts().filter((c) => c.metadata && c.metadata.planningId === failedPayload.planningId);
    assert.strictEqual(ctxs.length, 1);
    assert.strictEqual(ctxs[0].status, 'failed');
  });

  await test('a full decide() -> plan() cycle never calls dispatch/route/prepare/markGoalRunning', () => {
    const W = loadSandbox();
    registerCodingAndSearchAgents(W);
    let dispatched = false, routed = false;
    const origDispatch = W.AxiomOrchestrator.dispatch;
    const origRoute = W.AxiomCapabilityRouter.route;
    const origMarkRunning = W.AxiomGoalManager.markGoalRunning;
    W.AxiomOrchestrator.dispatch = function () { dispatched = true; return origDispatch.apply(this, arguments); };
    W.AxiomCapabilityRouter.route = function () { routed = true; return origRoute.apply(this, arguments); };
    W.AxiomGoalManager.markGoalRunning = function () { throw new Error('markGoalRunning must never be called by planning'); };
    try {
      const decision = W.AxiomCognitiveDecisionEngine.decide('open github.com and debug the login function');
      W.AxiomCognitiveDecisionEngine.plan(decision);
    } finally {
      W.AxiomOrchestrator.dispatch = origDispatch;
      W.AxiomCapabilityRouter.route = origRoute;
      W.AxiomGoalManager.markGoalRunning = origMarkRunning;
    }
    assert.strictEqual(dispatched, false);
    assert.strictEqual(routed, false);
    // Goals created by decide() are still exactly where decide() left them: pending.
    const goals = W.AxiomGoalManager.listGoals({});
    goals.forEach((g) => assert.strictEqual(g.status, 'pending'));
  });

  // ------------------------------------------------------------
  // History / metrics
  // ------------------------------------------------------------
  await test('getPlanning()/getPlanningHistory() round-trip a completed planning cycle', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'task' });
    const result = W.AxiomCognitiveDecisionEngine.plan({ goalIds: [g1.id] });
    const fetched = W.AxiomCognitiveDecisionEngine.getPlanning(result.planningId);
    assert.strictEqual(fetched.planningId, result.planningId);
    const history = W.AxiomCognitiveDecisionEngine.getPlanningHistory({ limit: 1 });
    assert.strictEqual(history[0].planningId, result.planningId);
  });

  await test('getPlanningMetrics() tracks started/completed/failed counts independently of decision metrics', () => {
    const W = loadSandbox();
    const g1 = W.AxiomGoalManager.createGoal({ title: 'task' });
    W.AxiomCognitiveDecisionEngine.plan({ goalIds: [g1.id] });
    try { W.AxiomCognitiveDecisionEngine.plan({ goalIds: [] }); } catch (e) { /* expected */ }

    const pm = W.AxiomCognitiveDecisionEngine.getPlanningMetrics();
    assert.strictEqual(pm.startedCount, 2);
    assert.strictEqual(pm.completedCount, 1);
    assert.strictEqual(pm.failedCount, 1);

    const dm = W.AxiomCognitiveDecisionEngine.getMetrics();
    assert.strictEqual(dm.startedCount, 0); // decide() was never called in this test
  });

  await test('empty/invalid planning input throws before any state (context, history) is created', () => {
    const W = loadSandbox();
    const beforeHistory = W.AxiomCognitiveDecisionEngine.getPlanningHistory({}).length;
    assert.throws(() => W.AxiomCognitiveDecisionEngine.plan({}));
    assert.throws(() => W.AxiomCognitiveDecisionEngine.plan(null));
    const afterHistory = W.AxiomCognitiveDecisionEngine.getPlanningHistory({}).length;
    assert.strictEqual(afterHistory, beforeHistory);
  });

  // ------------------------------------------------------------
  // End-to-end: decide() output feeds straight into plan()
  // ------------------------------------------------------------
  await test('plan() accepts a decide() Decision Object directly and carries its decisionId through', () => {
    const W = loadSandbox();
    registerCodingAndSearchAgents(W);
    const decision = W.AxiomCognitiveDecisionEngine.decide('debug the login function and search for react hooks');
    const result = W.AxiomCognitiveDecisionEngine.plan(decision);
    assert.strictEqual(result.decisionId, decision.decisionId);
    result.plans.forEach((p) => assert.strictEqual(p.decisionId, decision.decisionId));
    const planGoalIds = result.selected.goalIds.slice().sort();
    const decisionGoalIds = decision.goals.map((g) => g.id).sort();
    assert.deepStrictEqual(planGoalIds, decisionGoalIds);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
