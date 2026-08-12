// ============================================================
// AXIOM — Block 2 / Step 3 / Part 3: Memory Manager regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/memory-engine.js and
// os/core/memory-manager.js together in a small hand-rolled
// window/localStorage shim (same pattern as the Part 1 and Part 2
// suites) and exercises every public Manager method against real
// engine state — no shortcuts, no mocked engine.
//
// No jsdom import: no network access in this sandbox to install it,
// so this uses Node's vm module with a minimal shim instead.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
}

function loadEngineAndManager() {
  const localStorage = makeLocalStorage();
  const sandbox = {
    window: {},
    console,
    setInterval: () => 0,   // no real timers needed for this suite
    clearInterval: () => {},
    Date
  };
  sandbox.window.localStorage = localStorage;
  sandbox.localStorage = localStorage;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);

  const engineSrc = fs.readFileSync(path.join(AI, 'os/core/memory-engine.js'), 'utf8');
  const managerSrc = fs.readFileSync(path.join(AI, 'os/core/memory-manager.js'), 'utf8');
  vm.runInContext(engineSrc, sandbox, { filename: 'memory-engine.js' });
  vm.runInContext(managerSrc, sandbox, { filename: 'memory-manager.js' });

  return sandbox.window;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + e.message);
  }
}

console.log('AXIOM Block 2 / Step 3 / Part 3 — Memory Manager regression suite');
console.log('======================================================================');

// ---- Group 1: module presence & stable API surface ----
(function () {
  const win = loadEngineAndManager();
  test('AxiomMemoryEngine loads standalone', () => {
    assert.ok(win.AxiomMemoryEngine, 'engine missing');
  });
  test('AxiomMemoryManager loads and exposes API_VERSION', () => {
    assert.ok(win.AxiomMemoryManager, 'manager missing');
    assert.strictEqual(typeof win.AxiomMemoryManager.API_VERSION, 'string');
  });
  test('Manager exposes every documented method', () => {
    const M = win.AxiomMemoryManager;
    ['init', 'getConversation', 'listConversations', 'ensureConversation',
     'findMemories', 'registerMemory', 'listSessions', 'getSession',
     'getMetadataSummary', 'getOverview', 'runCleanup', 'onChange']
      .forEach(name => assert.strictEqual(typeof M[name], 'function', name + ' missing'));
  });
  test('Part 1/Part 2 engine API is untouched (no methods removed)', () => {
    const E = win.AxiomMemoryEngine;
    ['init', 'getSession', 'touchSession', 'startConversation', 'endConversation',
     'addMessage', 'getConversationHistory', 'listConversations', 'hasConversation',
     'updateConversationMeta', 'addMemory', 'updateMemory', 'touchMemory',
     'deleteMemory', 'getMemory', 'queryMemories', 'listTags', 'listAgents',
     'listProjects', 'getWorkingMemory', 'setWorkingMemory', 'getStats',
     'cleanup', 'exportAll', 'importAll', 'onChange']
      .forEach(name => assert.strictEqual(typeof E[name], 'function', name + ' missing'));
  });
})();

// ---- Group 2: conversation lookup ----
(function () {
  const win = loadEngineAndManager();
  const E = win.AxiomMemoryEngine, M = win.AxiomMemoryManager;
  E.init();
  const conv = E.startConversation({ title: 'Test conversation' });
  E.addMessage(conv.id, { role: 'user', content: 'hello' });
  E.addMessage(conv.id, { role: 'assistant', content: 'hi there' });

  test('getConversation returns conversation + messages', () => {
    const result = M.getConversation(conv.id);
    assert.ok(result, 'expected a result');
    assert.strictEqual(result.conversation.id, conv.id);
    assert.strictEqual(result.messages.length, 2);
    assert.strictEqual(result.total, 2);
  });
  test('getConversation paginates messages', () => {
    const result = M.getConversation(conv.id, { offset: 1, limit: 1 });
    assert.strictEqual(result.messages.length, 1);
    assert.strictEqual(result.messages[0].content, 'hi there');
  });
  test('getConversation returns null for unknown id', () => {
    assert.strictEqual(M.getConversation('nope'), null);
  });
  test('listConversations includes the created conversation', () => {
    const result = M.listConversations();
    assert.ok(result.items.some(c => c.id === conv.id));
    assert.strictEqual(typeof result.total, 'number');
  });
  test('listConversations titleContains filter narrows results', () => {
    const result = M.listConversations({ titleContains: 'Test' });
    assert.ok(result.items.every(c => c.title.includes('Test')));
    assert.ok(result.items.length >= 1);
  });
  test('ensureConversation reuses an existing id (no duplicate)', () => {
    const before = E.listConversations().length;
    const r = M.ensureConversation(conv.id);
    assert.strictEqual(r.created, false);
    assert.strictEqual(E.listConversations().length, before);
  });
  test('ensureConversation creates when id is new', () => {
    const before = E.listConversations().length;
    const r = M.ensureConversation('brand-new-conv-id');
    assert.strictEqual(r.created, true);
    assert.strictEqual(E.listConversations().length, before + 1);
  });
})();

// ---- Group 3: memory filtering ----
(function () {
  const win = loadEngineAndManager();
  const E = win.AxiomMemoryEngine, M = win.AxiomMemoryManager;
  E.init();
  E.addMemory({ text: 'Loves TypeScript', agent: 'Code Agent', project: 'p1', type: 'preference', importance: 0.9, confidence: 0.8, tags: ['ts'] });
  E.addMemory({ text: 'Uses dark mode', agent: 'General', project: 'p1', type: 'preference', importance: 0.3, confidence: 0.95, tags: ['theme'] });
  E.addMemory({ text: 'Deploys on Vercel', agent: 'DevOps Agent', project: 'p2', type: 'infrastructure', importance: 0.7, confidence: 0.6, tags: ['deploy'] });

  test('findMemories with no filter returns all memories', () => {
    const result = M.findMemories();
    assert.strictEqual(result.total, 3);
  });
  test('findMemories filters by project', () => {
    const result = M.findMemories({ project: 'p1' });
    assert.strictEqual(result.total, 2);
  });
  test('findMemories filters by agent', () => {
    const result = M.findMemories({ agent: 'DevOps Agent' });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.items[0].text, 'Deploys on Vercel');
  });
  test('findMemories sorts by importance descending', () => {
    const result = M.findMemories({}, { sort: 'importance' });
    assert.strictEqual(result.items[0].text, 'Loves TypeScript');
  });
  test('findMemories paginates', () => {
    const result = M.findMemories({}, { limit: 2 });
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.total, 3);
  });
  test('registerMemory dedupes an exact repeat', () => {
    const before = E.queryMemories({}).length;
    const r1 = M.registerMemory({ text: 'Unique note', agent: 'General', project: 'p1', type: 'context' });
    const r2 = M.registerMemory({ text: 'Unique note', agent: 'General', project: 'p1', type: 'context' });
    assert.strictEqual(r1.created, true);
    assert.strictEqual(r2.created, false);
    assert.strictEqual(r1.record.id, r2.record.id);
    assert.strictEqual(E.queryMemories({}).length, before + 1);
  });
})();

// ---- Group 4: session browsing ----
(function () {
  const win = loadEngineAndManager();
  const E = win.AxiomMemoryEngine, M = win.AxiomMemoryManager;
  E.init();

  test('listSessions includes the current live session', () => {
    const result = M.listSessions();
    assert.ok(result.total >= 1);
    const current = E.getSession();
    assert.ok(result.items.some(s => s.id === current.id));
  });
  test('listSessions derives status and duration', () => {
    const result = M.listSessions();
    const current = result.items.find(s => s.id === E.getSession().id);
    assert.strictEqual(current.status, 'active');
    assert.strictEqual(typeof current.durationMs, 'number');
    assert.ok(current.durationMs >= 0);
  });
  test('getSession returns a single session by id', () => {
    const current = E.getSession();
    const found = M.getSession(current.id);
    assert.ok(found);
    assert.strictEqual(found.id, current.id);
  });
  test('getSession returns null for unknown id', () => {
    assert.strictEqual(M.getSession('does-not-exist'), null);
  });
})();

// ---- Group 5: metadata retrieval ----
(function () {
  const win = loadEngineAndManager();
  const E = win.AxiomMemoryEngine, M = win.AxiomMemoryManager;
  E.init();
  E.addMemory({ text: 'a', agent: 'Code Agent', project: 'p1', type: 'preference', importance: 0.9, confidence: 0.9, tags: ['x', 'y'], pinned: true });
  E.addMemory({ text: 'b', agent: 'Code Agent', project: 'p1', type: 'context', importance: 0.1, confidence: 0.2, tags: ['y'] });

  test('getMetadataSummary counts tags/agents/projects/types', () => {
    const summary = M.getMetadataSummary();
    assert.strictEqual(summary.tagCounts.y, 2);
    assert.strictEqual(summary.tagCounts.x, 1);
    assert.strictEqual(summary.agentCounts['Code Agent'], 2);
    assert.strictEqual(summary.projectCounts.p1, 2);
    assert.strictEqual(summary.pinnedCount, 1);
  });
  test('getMetadataSummary buckets importance/confidence', () => {
    const summary = M.getMetadataSummary();
    assert.strictEqual(summary.importanceDistribution['0.8-1.0'], 1);
    assert.strictEqual(summary.importanceDistribution['0.0-0.2'], 1);
  });
  test('getOverview merges engine stats with top-N roll-ups', () => {
    const overview = M.getOverview();
    assert.strictEqual(typeof overview.memoryCount, 'number');
    assert.strictEqual(overview.apiVersion, M.API_VERSION);
    assert.ok(Array.isArray(overview.topTags));
    assert.ok(overview.topTags.some(t => t.key === 'y'));
  });
})();

// ---- Group 6: memory cleanup (driven + reported) ----
(function () {
  const win = loadEngineAndManager();
  const E = win.AxiomMemoryEngine, M = win.AxiomMemoryManager;
  E.init();
  // A ttl-bearing memory already expired, so cleanup() has something real to remove.
  const stale = E.addMemory({ text: 'stale', agent: 'General', project: 'p1', type: 'lifecycle', ttl: 1000 });
  stale.updatedAt = Date.now() - 5000;

  test('runCleanup reports a before/after breakdown', () => {
    const report = M.runCleanup();
    assert.ok(report, 'expected a report');
    assert.strictEqual(typeof report.before.memoryCount, 'number');
    assert.strictEqual(typeof report.after.memoryCount, 'number');
    assert.strictEqual(typeof report.memoriesRemoved, 'number');
    assert.strictEqual(typeof report.ranAt, 'number');
  });
  test('runCleanup actually removed the expired memory', () => {
    assert.strictEqual(E.getMemory(stale.id), null);
  });
  test('runCleanup is idempotent on a second call (no negative counts)', () => {
    const report = M.runCleanup();
    assert.strictEqual(report.memoriesRemoved, 0);
    assert.strictEqual(report.changed, false);
  });
})();

// ---- Group 7: no duplicate records / no performance regression ----
(function () {
  const win = loadEngineAndManager();
  const E = win.AxiomMemoryEngine, M = win.AxiomMemoryManager;
  E.init();

  test('registerMemory called 50x with identical input creates exactly one record', () => {
    for (let i = 0; i < 50; i++) {
      M.registerMemory({ text: 'Repeated fact', agent: 'General', project: 'p1', type: 'context' });
    }
    const matches = E.queryMemories({ project: 'p1' }).filter(m => m.text === 'Repeated fact');
    assert.strictEqual(matches.length, 1);
  });
  test('ensureConversation called 50x with identical id creates exactly one record', () => {
    for (let i = 0; i < 50; i++) {
      M.ensureConversation('idempotent-conv');
    }
    const matches = E.listConversations().filter(c => c.id === 'idempotent-conv');
    assert.strictEqual(matches.length, 1);
  });
  test('findMemories over 2000 records completes quickly (no regression)', () => {
    for (let i = 0; i < 2000; i++) {
      E.addMemory({ text: 'bulk-' + i, agent: i % 2 ? 'Code Agent' : 'General', project: 'bulk', type: 'context', importance: Math.random(), confidence: Math.random() });
    }
    const start = Date.now();
    const result = M.findMemories({ project: 'bulk' }, { sort: 'importance', limit: 50 });
    const elapsed = Date.now() - start;
    assert.strictEqual(result.items.length, 50);
    assert.ok(elapsed < 1000, 'findMemories took ' + elapsed + 'ms, expected < 1000ms');
  });
})();

console.log('======================================================================');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
