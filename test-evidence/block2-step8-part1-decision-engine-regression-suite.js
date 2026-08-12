// ============================================================
// AXIOM — Block 2 / Step 8 / Part 1: Cognitive Decision Engine
// regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1),
// os/core/runtime-context.js (Step 6 Part 5), os/core/goal-manager.js
// (Step 7 Parts 3A+3B), os/core/capability-router.js (Step 6 Part 3),
// os/core/agent-registry-integration.js (Step 6 Part 2, needed for
// Orchestrator.discoverCapabilities()), and — where relevant — the
// real, unmodified os/core/autonomous-decision-engine.js (Step 7
// Part 3C, to prove the naming-collision avoidance holds), then the
// new os/core/decision-engine.js (Step 8 Part 1) in a minimal vm
// sandbox — same pattern every prior Block 2 suite in this project
// already uses.
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
  if (opts.withAutonomousDecisionEngine) load('os/core/autonomous-decision-engine.js');
  if (opts.withDecisionEngine !== false) load('os/core/decision-engine.js');

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
  console.log('AXIOM Block 2 / Step 8 / Part 1 — Cognitive Decision Engine regression\n');

  // ------------------------------------------------------------
  // Load-order guards
  // ------------------------------------------------------------
  await test('module does not install itself without AxiomOrchestrator present', () => {
    const sandbox = { console, setTimeout, clearTimeout, Date, Object, Array, JSON, Math, Error };
    sandbox.window = sandbox;
    sandbox.document = undefined;
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(AI, 'os/core/decision-engine.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'decision-engine.js' });
    assert.strictEqual(sandbox.window.AxiomCognitiveDecisionEngine, undefined);
  });

  await test('module does not install itself without AxiomRuntimeContext present', () => {
    const W = loadSandbox({ withRuntimeContext: false, withGoalManager: false, withDecisionEngine: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/decision-engine.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'decision-engine.js' });
    assert.strictEqual(W.AxiomCognitiveDecisionEngine, undefined);
  });

  await test('module does not install itself without AxiomGoalManager present', () => {
    const W = loadSandbox({ withGoalManager: false, withDecisionEngine: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/decision-engine.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'decision-engine.js' });
    assert.strictEqual(W.AxiomCognitiveDecisionEngine, undefined);
  });

  await test('module does not install itself without AxiomCapabilityRouter present', () => {
    const W = loadSandbox({ withCapabilityRouter: false, withDecisionEngine: false });
    const src = fs.readFileSync(path.join(AI, 'os/core/decision-engine.js'), 'utf8');
    vm.runInContext(src, W, { filename: 'decision-engine.js' });
    assert.strictEqual(W.AxiomCognitiveDecisionEngine, undefined);
  });

  await test('installs cleanly with the full stack present, without editing any dependency', () => {
    const deps = [
      'os/core/orchestrator.js', 'os/core/runtime-context.js', 'os/core/goal-manager.js',
      'os/core/capability-router.js', 'os/core/agent-registry-integration.js',
      'os/core/autonomous-decision-engine.js'
    ];
    const before = {};
    deps.forEach((d) => { before[d] = fs.readFileSync(path.join(AI, d), 'utf8'); });

    const W = loadSandbox({ withAutonomousDecisionEngine: true });
    assert.strictEqual(typeof W.AxiomCognitiveDecisionEngine, 'object');
    assert.strictEqual(typeof W.AxiomCognitiveDecisionEngine.decide, 'function');

    const after = {};
    deps.forEach((d) => { after[d] = fs.readFileSync(path.join(AI, d), 'utf8'); });
    assert.deepStrictEqual(before, after);
  });

  // ------------------------------------------------------------
  // Naming-collision avoidance (see decision-engine.js file header)
  // ------------------------------------------------------------
  await test('does NOT install onto window.AxiomDecisionEngine — that name stays Part 3C\'s own scheduling engine', () => {
    const W = loadSandbox({ withAutonomousDecisionEngine: true });
    assert.strictEqual(typeof W.AxiomDecisionEngine, 'object');
    assert.strictEqual(typeof W.AxiomDecisionEngine.selectNextGoal, 'function'); // Part 3C's real API, untouched
    assert.strictEqual(typeof W.AxiomCognitiveDecisionEngine, 'object');
    assert.notStrictEqual(W.AxiomDecisionEngine, W.AxiomCognitiveDecisionEngine);
  });

  await test('installs standalone even when Part 3C (window.AxiomDecisionEngine) is entirely absent', () => {
    const W = loadSandbox(); // withAutonomousDecisionEngine defaults to false
    assert.strictEqual(W.AxiomDecisionEngine, undefined);
    assert.strictEqual(typeof W.AxiomCognitiveDecisionEngine, 'object');
  });

  await test('emits only previously-unused event names (no collision with decisionengine_* or goalmgr_* namespaces)', () => {
    const W = loadSandbox({ withAutonomousDecisionEngine: true });
    const seen = [];
    ['decision_started', 'decision_completed', 'decision_failed'].forEach((evt) => {
      W.AxiomOrchestrator.on(evt, () => seen.push(evt));
    });
    W.AxiomCognitiveDecisionEngine.decide('search for react hooks', { dryRun: true });
    assert.ok(seen.indexOf('decision_started') !== -1);
    assert.ok(seen.indexOf('decision_completed') !== -1);
  });

  // ------------------------------------------------------------
  // Intent detection — single intent
  // ------------------------------------------------------------
  await test('single-intent detection: coding request classifies as coding with one intent only', () => {
    const W = loadSandbox();
    const r = W.AxiomCognitiveDecisionEngine.detectIntent('please debug this function');
    assert.strictEqual(r.intents.length, 1);
    assert.strictEqual(r.primaryIntent, 'coding');
    assert.strictEqual(r.intents[0].isPrimary, true);
  });

  await test('single-intent detection: browser request classifies as browser', () => {
    const W = loadSandbox();
    const r = W.AxiomCognitiveDecisionEngine.detectIntent('navigate to the website and open a new tab');
    assert.strictEqual(r.primaryIntent, 'browser');
  });

  await test('unrecognized text classifies as unknown with low confidence', () => {
    const W = loadSandbox();
    const r = W.AxiomCognitiveDecisionEngine.detectIntent('zxjk qwop flarn blibbet');
    assert.strictEqual(r.primaryIntent, 'unknown');
    assert.ok(r.confidence < 0.5);
  });

  // ------------------------------------------------------------
  // Intent detection — multi-intent
  // ------------------------------------------------------------
  await test('multi-intent detection: a request naming two distinct intents returns both', () => {
    const W = loadSandbox();
    const r = W.AxiomCognitiveDecisionEngine.detectIntent(
      'debug the login function and then search for react hooks'
    );
    assert.ok(r.intents.length >= 2);
    const categories = r.intents.map((i) => i.category);
    assert.ok(categories.indexOf('coding') !== -1);
    assert.ok(categories.indexOf('search') !== -1);
  });

  await test('multi-intent detection: exactly one intent is flagged isPrimary, and it is the highest scorer', () => {
    const W = loadSandbox();
    const r = W.AxiomCognitiveDecisionEngine.detectIntent(
      'remember that i debugged the bug in the function, then search for docs'
    );
    const primaries = r.intents.filter((i) => i.isPrimary);
    assert.strictEqual(primaries.length, 1);
    assert.strictEqual(primaries[0].category, r.primaryIntent);
    r.intents.forEach((i) => assert.ok(i.confidence <= primaries[0].confidence));
  });

  await test('options.maxIntents on decide() caps how many intents are processed into goals', () => {
    const W = loadSandbox();
    const d = W.AxiomCognitiveDecisionEngine.decide(
      'debug the login function and then search for react hooks',
      { maxIntents: 1, dryRun: true }
    );
    assert.strictEqual(d.goals.length, 0); // dryRun — but capability/agent arrays still respect the cap
    assert.strictEqual(d.capabilities.length, 1);
    assert.strictEqual(d.agents.length, 1);
  });

  // ------------------------------------------------------------
  // Confidence scoring
  // ------------------------------------------------------------
  await test('confidence scoring: a request with more/stronger keyword hits scores higher confidence than a weak one', () => {
    const W = loadSandbox();
    const strong = W.AxiomCognitiveDecisionEngine.detectIntent(
      'debug the bug in this function, write a unit test, and refactor the class'
    );
    const weak = W.AxiomCognitiveDecisionEngine.detectIntent('function');
    assert.ok(strong.confidence >= weak.confidence);
  });

  await test('confidence scoring: every confidence value is within [0, 1]', () => {
    const W = loadSandbox();
    const texts = [
      'hello there', 'debug the bug', 'search for something', 'zzz qqq xxx',
      'remember this and also plan my trip and analyze the report'
    ];
    texts.forEach((t) => {
      W.AxiomCognitiveDecisionEngine.detectIntent(t).intents.forEach((i) => {
        assert.ok(i.confidence >= 0 && i.confidence <= 1);
      });
    });
  });

  // ------------------------------------------------------------
  // Context extraction
  // ------------------------------------------------------------
  await test('context extraction: URLs, file names, dates, and times are all recognized', () => {
    const W = loadSandbox();
    const ctx = W.AxiomCognitiveDecisionEngine.extractContext(
      'Open report.pdf and visit https://example.com tomorrow at 5:30pm'
    );
    assert.ok(ctx.urls.indexOf('https://example.com') !== -1);
    assert.ok(ctx.fileNames.indexOf('report.pdf') !== -1);
    assert.ok(ctx.dates.indexOf('tomorrow') !== -1);
    assert.ok(ctx.times.indexOf('5:30pm') !== -1);
  });

  await test('context extraction: quoted phrases and capitalized multi-word phrases are extracted as entities', () => {
    const W = loadSandbox();
    const ctx = W.AxiomCognitiveDecisionEngine.extractContext(
      'ask Sarah Connor about "Project Falcon"'
    );
    assert.ok(ctx.entities.indexOf('Sarah Connor') !== -1);
    assert.ok(ctx.entities.indexOf('Project Falcon') !== -1);
  });

  await test('context extraction: a single capitalized sentence-leading word alone is not treated as an entity', () => {
    const W = loadSandbox();
    const ctx = W.AxiomCognitiveDecisionEngine.extractContext('Open the browser please');
    assert.strictEqual(ctx.entities.indexOf('Open'), -1);
  });

  await test('context extraction: imperative commands are extracted from known action verbs', () => {
    const W = loadSandbox();
    const ctx = W.AxiomCognitiveDecisionEngine.extractContext('open github.com and save the file');
    assert.ok(ctx.commands.some((c) => c.toLowerCase().indexOf('open github') !== -1));
    assert.ok(ctx.commands.some((c) => c.toLowerCase().indexOf('save the file') !== -1));
  });

  await test('context extraction: application names are matched against the LIVE agent registry', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'coding-agent', name: 'Coding Agent', capabilities: ['code-generation'] });
    const ctx = W.AxiomCognitiveDecisionEngine.extractContext('open the coding agent and run a script');
    assert.ok(ctx.applicationNames.indexOf('Coding Agent') !== -1);
  });

  await test('context extraction: keywords excludes stopwords and short filler words', () => {
    const W = loadSandbox();
    const ctx = W.AxiomCognitiveDecisionEngine.extractContext('the quick fox jumps over the lazy dog');
    assert.strictEqual(ctx.keywords.indexOf('the'), -1);
    assert.ok(ctx.keywords.indexOf('quick') !== -1);
  });

  // ------------------------------------------------------------
  // Capability discovery — must never hardcode a capability name
  // ------------------------------------------------------------
  await test('capability recommendation reads only from the LIVE registry (Orchestrator.discoverCapabilities())', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-1', capabilities: ['zzz-custom-capability'] });
    const matches = W.AxiomCognitiveDecisionEngine.matchCapabilities(['zzz', 'custom', 'capability']);
    assert.ok(matches.some((m) => m.capability === 'zzz-custom-capability'));
  });

  await test('a brand-new capability registered at runtime becomes recommendable with zero code changes', () => {
    const W = loadSandbox();
    const before = W.AxiomCognitiveDecisionEngine.matchCapabilities(['telepathy']);
    assert.strictEqual(before.length, 0);
    registerAgent(W, { id: 'agent-1', capabilities: ['telepathy'] });
    const after = W.AxiomCognitiveDecisionEngine.matchCapabilities(['telepathy']);
    assert.ok(after.some((m) => m.capability === 'telepathy'));
  });

  await test('decide() capability recommendations for coding intent resolve to a real registered capability', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'coding-agent', name: 'Coding Agent', capabilities: ['debug', 'code-generation'] });
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login bug', { dryRun: true });
    const codingRec = d.capabilities.find((c) => c.intent === 'coding');
    assert.ok(codingRec.recommended.some((r) => r.capability === 'debug'));
  });

  // ------------------------------------------------------------
  // Agent recommendation — must reuse CapabilityRouter.selectAgent()
  // verbatim, never reimplement health/workload ranking.
  // ------------------------------------------------------------
  await test('agent recommendation matches AxiomCapabilityRouter.selectAgent() directly (no duplicated selection logic)', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-1', capabilities: ['debug'] });
    registerAgent(W, { id: 'agent-2', capabilities: ['debug'] });
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login bug', { dryRun: true });
    const rec = d.agents.find((a) => a.intent === 'coding');
    const direct = W.AxiomCapabilityRouter.selectAgent(rec.capability, {});
    assert.strictEqual(rec.recommendedAgent.id, direct.id);
  });

  await test('agent recommendation is null when no agent exposes the recommended capability', () => {
    const W = loadSandbox();
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login bug', { dryRun: true });
    const rec = d.agents.find((a) => a.intent === 'coding');
    assert.strictEqual(rec.recommendedAgent, null);
  });

  await test('recommendation never dispatches or routes: AxiomCapabilityRouter.route()/prepare() are never called by decide()', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-1', capabilities: ['debug'] });
    let routeCalled = false, prepareCalled = false;
    const origRoute = W.AxiomCapabilityRouter.route;
    const origPrepare = W.AxiomCapabilityRouter.prepare;
    W.AxiomCapabilityRouter.route = function () { routeCalled = true; return origRoute.apply(this, arguments); };
    W.AxiomCapabilityRouter.prepare = function () { prepareCalled = true; return origPrepare.apply(this, arguments); };
    W.AxiomCognitiveDecisionEngine.decide('debug the login bug', { dryRun: true });
    assert.strictEqual(routeCalled, false);
    assert.strictEqual(prepareCalled, false);
  });

  await test('recommendation never admits/dispatches a goal: no goal created by decide() ever leaves PENDING', () => {
    const W = loadSandbox();
    registerAgent(W, { id: 'agent-1', capabilities: ['debug'] });
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login bug');
    d.goals.forEach((g) => {
      const live = W.AxiomGoalManager.getGoal(g.id);
      assert.strictEqual(live.status, 'pending');
    });
  });

  // ------------------------------------------------------------
  // Goal generation — must reuse AxiomGoalManager.createGoal() itself
  // ------------------------------------------------------------
  await test('decide() creates one real Goal Manager record per processed intent', () => {
    const W = loadSandbox();
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login function and then search for react hooks');
    assert.strictEqual(d.goals.length, d.intents.length);
    d.goals.forEach((g) => {
      const live = W.AxiomGoalManager.getGoal(g.id);
      assert.ok(live);
      assert.strictEqual(live.id, g.id);
    });
  });

  await test('decide() goals carry decisionId/intent/confidence in metadata, traceable back to the decision', () => {
    const W = loadSandbox();
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login function');
    assert.strictEqual(d.goals[0].metadata.decisionId, d.decisionId);
    assert.strictEqual(d.goals[0].metadata.intent, d.primaryIntent);
  });

  await test('options.dryRun skips goal creation entirely — zero Goal Manager side effects', () => {
    const W = loadSandbox();
    const beforeCount = W.AxiomGoalManager.listGoals().length;
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login function', { dryRun: true });
    assert.strictEqual(d.goals.length, 0);
    assert.strictEqual(W.AxiomGoalManager.listGoals().length, beforeCount);
  });

  // ------------------------------------------------------------
  // Decision object structure
  // ------------------------------------------------------------
  await test('decide() returns a fully-formed, frozen decision object', () => {
    const W = loadSandbox();
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login function');
    ['decisionId', 'input', 'timestamp', 'intents', 'primaryIntent', 'confidence',
      'context', 'goals', 'capabilities', 'agents', 'reasoning', 'contextId'].forEach((k) => {
      assert.ok(Object.prototype.hasOwnProperty.call(d, k), 'missing key: ' + k);
    });
    assert.strictEqual(Object.isFrozen(d), true);
    assert.strictEqual(typeof d.reasoning, 'string');
    assert.ok(d.reasoning.length > 0);
  });

  await test('decide() creates and completes a real Runtime Context record for the decision', () => {
    const W = loadSandbox();
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login function');
    assert.ok(d.contextId);
    const ctx = W.AxiomRuntimeContext.getContext(d.contextId);
    assert.strictEqual(ctx.status, 'completed');
  });

  await test('decide() throws a structural error on empty/invalid input, before creating any state', () => {
    const W = loadSandbox();
    const beforeGoals = W.AxiomGoalManager.listGoals().length;
    assert.throws(() => W.AxiomCognitiveDecisionEngine.decide(''), /non-empty text/);
    assert.throws(() => W.AxiomCognitiveDecisionEngine.decide(null), /non-empty text/);
    assert.strictEqual(W.AxiomGoalManager.listGoals().length, beforeGoals);
  });

  // ------------------------------------------------------------
  // Events
  // ------------------------------------------------------------
  await test('decision_started fires before decision_completed, both carrying the same decisionId', () => {
    const W = loadSandbox();
    const order = [];
    let startedId = null, completedId = null;
    W.AxiomOrchestrator.on('decision_started', (p) => { order.push('started'); startedId = p.decisionId; });
    W.AxiomOrchestrator.on('decision_completed', (p) => { order.push('completed'); completedId = p.decisionId; });
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login function');
    assert.deepStrictEqual(order, ['started', 'completed']);
    assert.strictEqual(startedId, d.decisionId);
    assert.strictEqual(completedId, d.decisionId);
  });

  await test('decision_completed payload reports primaryIntent, confidence, and the created goalIds', () => {
    const W = loadSandbox();
    let payload = null;
    W.AxiomOrchestrator.on('decision_completed', (p) => { payload = p; });
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login function');
    assert.strictEqual(payload.primaryIntent, d.primaryIntent);
    assert.strictEqual(payload.confidence, d.confidence);
    assert.deepStrictEqual(payload.goalIds, d.goals.map((g) => g.id));
  });

  await test('decision_failed fires (with no decision_completed) when goal creation fails mid-decision', () => {
    const W = loadSandbox();
    let failedPayload = null, completedFired = false;
    W.AxiomOrchestrator.on('decision_failed', (p) => { failedPayload = p; });
    W.AxiomOrchestrator.on('decision_completed', () => { completedFired = true; });
    const originalCreateGoal = W.AxiomGoalManager.createGoal;
    W.AxiomGoalManager.createGoal = function () { throw new Error('simulated Goal Manager failure'); };
    try {
      assert.throws(() => W.AxiomCognitiveDecisionEngine.decide('debug the login function'), /simulated Goal Manager failure/);
    } finally {
      W.AxiomGoalManager.createGoal = originalCreateGoal;
    }
    assert.ok(failedPayload);
    assert.strictEqual(completedFired, false);
  });

  await test('decision_failed marks the decision\'s Runtime Context record as failed, not left dangling', () => {
    const W = loadSandbox();
    let failedPayload = null;
    W.AxiomOrchestrator.on('decision_failed', (p) => { failedPayload = p; });
    const originalCreateGoal = W.AxiomGoalManager.createGoal;
    W.AxiomGoalManager.createGoal = function () { throw new Error('simulated failure'); };
    try {
      try { W.AxiomCognitiveDecisionEngine.decide('debug the login function'); } catch (e) { /* expected */ }
    } finally {
      W.AxiomGoalManager.createGoal = originalCreateGoal;
    }
    const ctxs = W.AxiomRuntimeContext.listContexts().filter((c) => c.metadata && c.metadata.decisionId === failedPayload.decisionId);
    assert.strictEqual(ctxs.length, 1);
    assert.strictEqual(ctxs[0].status, 'failed');
  });

  // ------------------------------------------------------------
  // Decision history / metrics
  // ------------------------------------------------------------
  await test('getDecision()/getDecisionHistory() return the same decision decide() produced', () => {
    const W = loadSandbox();
    const d = W.AxiomCognitiveDecisionEngine.decide('debug the login function');
    const fetched = W.AxiomCognitiveDecisionEngine.getDecision(d.decisionId);
    assert.strictEqual(fetched.decisionId, d.decisionId);
    const history = W.AxiomCognitiveDecisionEngine.getDecisionHistory({ limit: 1 });
    assert.strictEqual(history[0].decisionId, d.decisionId);
  });

  await test('getMetrics() tracks started/completed/failed counts', () => {
    const W = loadSandbox();
    W.AxiomCognitiveDecisionEngine.decide('debug the login function');
    const originalCreateGoal = W.AxiomGoalManager.createGoal;
    W.AxiomGoalManager.createGoal = function () { throw new Error('simulated failure'); };
    try { W.AxiomCognitiveDecisionEngine.decide('debug something'); } catch (e) { /* expected */ }
    W.AxiomGoalManager.createGoal = originalCreateGoal;

    const m = W.AxiomCognitiveDecisionEngine.getMetrics();
    assert.strictEqual(m.startedCount, 2);
    assert.strictEqual(m.completedCount, 1);
    assert.strictEqual(m.failedCount, 1);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
