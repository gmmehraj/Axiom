// ============================================================
// AXIOM — Block 2 / Step 3 / Part 1: Memory Foundation regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/memory-engine.js in a small
// hand-rolled window/localStorage shim (same pattern already used by
// the Block 2 / Step 2 / Part 2 Brain regression suite) and drives
// its public API directly — sessions, conversation history, message
// indexing, memory CRUD + lifecycle, cleanup, and export/import.
//
// No jsdom import: this sandbox has no network access to install it,
// so it uses Node's vm module with a minimal localStorage shim
// instead. It exercises the exact file that ships in the project,
// unmodified — only the browser environment around it is stubbed.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const AI = path.join(__dirname, '..');

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _dump: () => store
  };
}

const sandbox = {};
sandbox.localStorage = makeLocalStorage();
sandbox.console = console;
sandbox.Object = Object;
sandbox.Date = Date;
sandbox.Math = Math;
sandbox.JSON = JSON;
// unref every timer so this test exits promptly instead of being held
// open by the engine's real heartbeat/cleanup intervals.
sandbox.setInterval = (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; };
sandbox.clearInterval = clearInterval;
sandbox.setTimeout = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; };
sandbox.clearTimeout = clearTimeout;
sandbox.window = sandbox;

vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(path.join(AI, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

let fails = 0;
function check(label, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + ' ' + label + (cond ? '' : '  -> ' + JSON.stringify(detail)));
  if (!cond) fails++;
}

// ---- Load the real, unmodified file under test -----------------------
load('os/core/memory-engine.js');
const Engine = sandbox.AxiomMemoryEngine;
check('AxiomMemoryEngine loaded', !!Engine);

// -- 1. Init creates a session and is idempotent -------------------------
const stats0 = Engine.init();
check('init() returns stats', typeof stats0 === 'object', stats0);
const session1 = Engine.getSession();
check('a session exists after init', !!session1 && !!session1.id, session1);
const statsAgain = Engine.init();
check('calling init() twice does not create a second session', Engine.getSession().id === session1.id, [session1.id, Engine.getSession().id]);

// -- 2. Session heartbeat ------------------------------------------------
const before = Engine.getSession().lastActiveAt;
Engine.touchSession();
check('touchSession() refreshes lastActiveAt', Engine.getSession().lastActiveAt >= before, Engine.getSession());

// -- 3. Conversation history: start, add messages, ordering, persistence -
const conv = Engine.startConversation({ title: 'Test thread' });
check('startConversation returns an id', !!conv.id, conv);
Engine.addMessage(conv.id, { role: 'user', content: 'hello' });
Engine.addMessage(conv.id, { role: 'assistant', content: 'hi there' });
const history = Engine.getConversationHistory(conv.id);
check('conversation history has 2 messages in order', history.length === 2 && history[0].content === 'hello' && history[1].content === 'hi there', history);
check('conversation messageCount tracks history length', Engine.listConversations().find(c => c.id === conv.id).messageCount === 2, Engine.listConversations());

// -- 4. Message-history capping (lifecycle) ------------------------------
const bigConv = Engine.startConversation({ title: 'Flood' });
for (let i = 0; i < 520; i++) Engine.addMessage(bigConv.id, { role: 'user', content: 'msg ' + i });
const cappedHistory = Engine.getConversationHistory(bigConv.id);
check('conversation history is capped at 500 messages', cappedHistory.length === 500, cappedHistory.length);
check('capping keeps the MOST RECENT messages', cappedHistory[cappedHistory.length - 1].content === 'msg 519', cappedHistory[cappedHistory.length - 1]);

// -- 5. Memory CRUD + metadata --------------------------------------------
const mem = Engine.addMemory({ text: 'User likes dark mode', agent: 'General', project: 'axiom-web', type: 'preference', tags: ['theme', 'preference'], importance: 0.8, confidence: 0.9 });
check('addMemory assigns an id', !!mem.id, mem);
check('addMemory sets lifecycle timestamps', typeof mem.createdAt === 'number' && typeof mem.updatedAt === 'number' && typeof mem.lastAccessedAt === 'number', mem);
check('addMemory starts with accessCount 0', mem.accessCount === 0, mem);

Engine.touchMemory(mem.id);
check('touchMemory increments accessCount', Engine.getMemory(mem.id).accessCount === 1, Engine.getMemory(mem.id));

const updated = Engine.updateMemory(mem.id, { pinned: true, importance: 0.95 });
check('updateMemory applies the patch', updated.pinned === true && updated.importance === 0.95, updated);
check('updateMemory bumps updatedAt', updated.updatedAt >= mem.updatedAt, [mem.updatedAt, updated.updatedAt]);

// -- 6. Indexing: query by tag / agent / project / type / pinned ---------
Engine.addMemory({ text: 'Uses PostgreSQL', agent: 'Code Agent', project: 'axiom-web', type: 'infrastructure', tags: ['postgres'], importance: 0.7, confidence: 0.8 });
Engine.addMemory({ text: 'Unrelated note', agent: 'General', project: 'personal', type: 'context', tags: ['misc'], importance: 0.3, confidence: 0.5 });

check('queryMemories by tag returns only matching items', Engine.queryMemories({ tag: 'theme' }).every(m => m.tags.includes('theme')), Engine.queryMemories({ tag: 'theme' }));
check('queryMemories by agent narrows correctly', Engine.queryMemories({ agent: 'Code Agent' }).every(m => m.agent === 'Code Agent'), Engine.queryMemories({ agent: 'Code Agent' }));
check('queryMemories by project + pinned intersects indices', Engine.queryMemories({ project: 'axiom-web', pinned: true }).every(m => m.project === 'axiom-web' && m.pinned), Engine.queryMemories({ project: 'axiom-web', pinned: true }));
check('queryMemories with an unindexed tag value returns empty, not everything', Engine.queryMemories({ tag: 'does-not-exist' }).length === 0, Engine.queryMemories({ tag: 'does-not-exist' }));
check('queryMemories text search matches on content', Engine.queryMemories({ text: 'postgres' }).length >= 1, Engine.queryMemories({ text: 'postgres' }));
check('listTags/listAgents/listProjects reflect stored memories', Engine.listTags().includes('theme') && Engine.listAgents().includes('Code Agent') && Engine.listProjects().includes('axiom-web'), { tags: Engine.listTags(), agents: Engine.listAgents(), projects: Engine.listProjects() });

// -- 7. Delete removes from both store and every index --------------------
const toDelete = Engine.addMemory({ text: 'Temp note', agent: 'General', project: 'general', type: 'context', tags: ['temp-tag'], importance: 0.4, confidence: 0.4 });
Engine.deleteMemory(toDelete.id);
check('deleteMemory removes the record', Engine.getMemory(toDelete.id) === null, Engine.getMemory(toDelete.id));
check('deleteMemory removes it from the tag index too', !Engine.queryMemories({ tag: 'temp-tag' }).some(m => m.id === toDelete.id), Engine.queryMemories({ tag: 'temp-tag' }));

// -- 8. Working memory (ephemeral, session-scoped) -------------------------
Engine.setWorkingMemory([{ label: 'Current project: axiom-web', active: true }]);
check('working memory round-trips', Engine.getWorkingMemory().length === 1 && Engine.getWorkingMemory()[0].label === 'Current project: axiom-web', Engine.getWorkingMemory());

// -- 9. Stats reflect real state, not placeholders -------------------------
const stats = Engine.getStats();
check('stats.memoryCount matches queryMemories({}).length', stats.memoryCount === Engine.queryMemories({}).length, [stats.memoryCount, Engine.queryMemories({}).length]);
check('stats.shortTermCacheLoad is a number between 0 and 1', typeof stats.shortTermCacheLoad === 'number' && stats.shortTermCacheLoad >= 0 && stats.shortTermCacheLoad <= 1, stats);

// -- 10. Cleanup pass is safe to run repeatedly and is a no-op-safe call ---
const beforeCount = Engine.queryMemories({}).length;
const cleanupResult = Engine.cleanup();
check('cleanup() runs without throwing and returns a result object', typeof cleanupResult === 'object', cleanupResult);
check('cleanup() does not delete live, non-expired memories', Engine.queryMemories({}).length === beforeCount, [beforeCount, Engine.queryMemories({}).length]);

// -- 11. Ephemeral (ttl-bearing) memories expire on cleanup ----------------
const ephemeral = Engine.addMemory({ text: 'short-lived scratch note', agent: 'General', project: 'general', type: 'context', tags: [], importance: 0.2, confidence: 0.3, ttl: 1 });
// backdate it so cleanup() sees it as already-expired without a real sleep
Engine.updateMemory(ephemeral.id, { ttl: 1 });
sandbox.eval_backdate = ephemeral.id;
// directly age the record the same way real elapsed time would
Engine.getMemory(ephemeral.id).updatedAt = Date.now() - 1000;
Engine.cleanup();
check('cleanup() expires ephemeral memories past their ttl', Engine.getMemory(ephemeral.id) === null, Engine.getMemory(ephemeral.id));

// -- 12. Pub/sub state management ------------------------------------------
let sawEvent = null;
const unsub = Engine.onChange(evt => { sawEvent = evt; });
Engine.addMemory({ text: 'pubsub probe', agent: 'General', project: 'general', type: 'context', tags: [], importance: 0.5, confidence: 0.5 });
check('onChange fires on memory:added', sawEvent && sawEvent.type === 'memory:added', sawEvent);
unsub();
sawEvent = null;
Engine.addMemory({ text: 'after unsubscribe', agent: 'General', project: 'general', type: 'context', tags: [], importance: 0.5, confidence: 0.5 });
check('unsubscribe stops further notifications', sawEvent === null, sawEvent);

// -- 13. Export / import round-trip ----------------------------------------
const exported = Engine.exportAll();
check('exportAll includes sessions, conversations, messages, memories', !!exported.sessions && !!exported.conversations && !!exported.messages && !!exported.memories, Object.keys(exported));
const memCountBeforeImport = Engine.queryMemories({}).length;
const reimported = Engine.importAll(exported);
check('importAll succeeds', reimported === true, reimported);
check('importAll restores the same memory count', Engine.queryMemories({}).length === memCountBeforeImport, [memCountBeforeImport, Engine.queryMemories({}).length]);

// -- 14. Persistence: a second engine instance reading the same storage ---
//        sees the same data (proves it went through StorageAdapter, not
//        just an in-process array).
const sandbox2 = Object.assign({}, sandbox, {});
sandbox2.localStorage = sandbox.localStorage; // same backing store
vm.createContext(sandbox2);
sandbox2.setInterval = sandbox.setInterval;
sandbox2.setTimeout = sandbox.setTimeout;
sandbox2.window = sandbox2;
const code2 = fs.readFileSync(path.join(AI, 'os/core/memory-engine.js'), 'utf8');
vm.runInContext(code2, sandbox2, { filename: 'os/core/memory-engine.js (second instance)' });
const Engine2 = sandbox2.AxiomMemoryEngine;
Engine2.init();
check('a fresh engine instance reads back persisted memories from localStorage', Engine2.queryMemories({}).length === Engine.queryMemories({}).length, [Engine2.queryMemories({}).length, Engine.queryMemories({}).length]);

console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
process.exit(fails === 0 ? 0 : 1);
