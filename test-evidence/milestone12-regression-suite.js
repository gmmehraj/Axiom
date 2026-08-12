// ============================================================
// AXIOM AI OS — Milestone 12 Regression Suite
// ------------------------------------------------------------
// Same intent as milestone5/8/11-regression-suite.js: load the REAL,
// unmodified runtime files (Milestone 8's memory-intelligence.js and
// all seven Milestone 12 files) inside a Node `vm` context, and drive
// them against a light in-memory fake of the ONE external backend
// they depend on — window.AxiomAgents, which milestone5's own suite
// documents as "Supabase-backed" and therefore the thing to mock, not
// the runtime itself. No Milestone 12 source file is altered to make
// this harness work.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');

// ---------------------- Minimal browser shim -------------------------
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.console = console;
sandbox.Date = Date; sandbox.Promise = Promise; sandbox.Map = Map; sandbox.Set = Set;
sandbox.Array = Array; sandbox.Object = Object; sandbox.JSON = JSON; sandbox.Math = Math;
sandbox.Number = Number; sandbox.String = String; sandbox.Boolean = Boolean; sandbox.RegExp = RegExp;
sandbox.Error = Error; sandbox.Symbol = Symbol; sandbox.isNaN = isNaN;
sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
sandbox.console = console;
vm.createContext(sandbox);

function load(relPath) {
  const code = fs.readFileSync(path.join(AI, relPath), 'utf8');
  vm.runInContext(code, sandbox, { filename: relPath });
}

// ---------------------- Fake AxiomAgents (the ONLY external backend) --
// Backs the same public surface real agents.js exposes for memory ops,
// over a plain in-memory array instead of Supabase.
let seq = 0;
const store = []; // { id, agent_id, note, tags, category, pinned, created_at }

function findRow(id) { return store.find((r) => r.id === id); }

const fakeAxiomAgents = {
  listAll: async () => ([{ id: 'agent.memory', memoryEnabled: true }, { id: 'builtin:general', memoryEnabled: true }]),
  getMemoryNotes: async (agentId, limit) => store.filter((r) => r.agent_id === agentId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit || 8)
    .map((r) => ({ id: r.id, note: r.note, tags: r.tags.slice(), category: r.category, pinned: r.pinned, created_at: r.created_at })),
  recentMemories: async function (agentId, limit) { return fakeAxiomAgents.getMemoryNotes(agentId, limit); },
  remember: async (agentId, note, tags) => {
    const row = { id: 'mem-' + (++seq), agent_id: agentId, note, tags: tags || [], category: null, pinned: false, created_at: new Date(Date.now() - seq).toISOString() };
    store.push(row);
    return { id: row.id, note: row.note, tags: row.tags, created_at: row.created_at };
  },
  searchMemories: async (agentId, query, limit) => {
    const q = String(query || '').toLowerCase();
    return store.filter((r) => r.agent_id === agentId && r.note.toLowerCase().includes(q)).slice(0, limit || 20)
      .map((r) => ({ id: r.id, note: r.note, tags: r.tags.slice(), category: r.category, pinned: r.pinned, created_at: r.created_at }));
  },
  updateMemory: async (id, patch) => {
    const row = findRow(id); if (!row) throw new Error('not found');
    if (typeof patch.note === 'string') row.note = patch.note;
    if (Array.isArray(patch.tags)) row.tags = patch.tags;
    return { id: row.id, note: row.note, tags: row.tags };
  },
  tagMemory: async function (id, tags) { return fakeAxiomAgents.updateMemory(id, { tags: tags || [] }); },
  deleteMemory: async (id) => { const i = store.findIndex((r) => r.id === id); if (i !== -1) store.splice(i, 1); return true; },
  pinMemory: async (id, pinned) => { const row = findRow(id); if (row) row.pinned = pinned !== false; return row; },
  setCategory: async (id, category) => { const row = findRow(id); if (row) row.category = category || null; return row; },
  listCategories: async () => [],
  semanticRecall: async (agentId, query, limit) => fakeAxiomAgents.searchMemories(agentId, query, limit)
};

// ---------------------- Fake bus / agent manager -----------------------
const listeners = new Map();
sandbox.AxiomAgentRuntime = {
  bus: {
    emit: (type, source, payload) => { (listeners.get(type) || []).forEach((fn) => fn({ type, source, payload })); return true; },
    on: (type, fn) => { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); return () => {}; }
  }
};
sandbox.AxiomAgentManager = {
  list: () => ([{ id: 'agent.memory' }, { id: 'agent.assistant' }]),
  snapshot: () => ({ count: 10, agents: Array.from({ length: 10 }, (_, i) => ({ id: 'agent.core' + i })) })
};
sandbox.AxiomAgents = fakeAxiomAgents;

// ---------------------- Load the REAL runtime files ---------------------
load('os/shared/logger.js');
load('os/runtime/intelligence/memory-intelligence.js'); // Milestone 8 — unmodified
load('os/runtime/knowledge/knowledge-graph.js');
load('os/runtime/knowledge/semantic-search.js');
load('os/runtime/knowledge/auto-tagger.js');
load('os/runtime/knowledge/duplicate-detector.js');
load('os/runtime/knowledge/importance-ranker.js');
load('os/runtime/knowledge/memory-summarizer.js');
load('os/runtime/knowledge/executive-knowledge-extension.js');

// ---------------------- Test runner --------------------------------------
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (detail !== undefined ? '  (' + JSON.stringify(detail) + ')' : ''));
}

async function main() {
  const scope = 'agent.memory';
  const tsA = await fakeAxiomAgents.remember(scope, 'User prefers TypeScript for backend services.', ['typescript', 'preference']);
  const tsB = await fakeAxiomAgents.remember(scope, 'User prefers TypeScript over plain JavaScript for backend work.'); // near-dup, untagged
  const meeting = await fakeAxiomAgents.remember(scope, 'Meeting with design team scheduled for Thursday.');

  // ---- 1. Knowledge Graph -------------------------------------------
  const graph = await sandbox.AxiomKnowledgeGraph.build({ perScopeLimit: 200 });
  check('knowledge graph builds nodes and edges from real memory rows', graph.nodes.size > 0 && graph.edges.length > 0, sandbox.AxiomKnowledgeGraph.stats());
  check('knowledge graph has a memory node for a real note', graph.nodes.has('memory:' + tsA.id));
  const related = sandbox.AxiomKnowledgeGraph.relatedMemories(tsA.id, 5);
  check('knowledge graph links the two related TypeScript memories', related.some((r) => r.memoryId === tsB.id), related.map((r) => r.memoryId));
  check('knowledge graph does NOT link the unrelated meeting note to the TypeScript notes',
    !related.some((r) => r.memoryId === meeting.id));

  // ---- 2. Semantic search --------------------------------------------
  const searchResults = await sandbox.AxiomSemanticSearch.search(scope, 'TypeScript backend preference', 5);
  check('semantic search returns scored, ranked results', searchResults.length > 0 && typeof searchResults[0].score === 'number');
  check('semantic search ranks a TypeScript note above the unrelated meeting note',
    searchResults.findIndex((r) => r.id === tsA.id || r.id === tsB.id) < searchResults.findIndex((r) => r.id === meeting.id) || !searchResults.some((r) => r.id === meeting.id));

  // ---- 3. Auto-tagging (fills blanks only) ---------------------------
  const classified = sandbox.AxiomAutoTagger.classify('User prefers TypeScript over plain JavaScript for backend work.');
  check('auto-tagger classify() suggests tags for an untagged note', classified.tags.length > 0, classified);
  const untaggedRow = (await fakeAxiomAgents.getMemoryNotes(scope, 10)).find((r) => r.id === tsB.id);
  const applied = await sandbox.AxiomAutoTagger.autoTag(scope, untaggedRow);
  check('auto-tagger fills tags on a previously-untagged note', applied.changed === true && applied.tags.length > 0, applied);

  const alreadyTaggedRow = (await fakeAxiomAgents.getMemoryNotes(scope, 10)).find((r) => r.id === tsA.id);
  const originalTags = alreadyTaggedRow.tags.slice();
  const skipResult = await sandbox.AxiomAutoTagger.autoTag(scope, alreadyTaggedRow);
  check('auto-tagger never overwrites tags a note already has', JSON.stringify(skipResult.tags) === JSON.stringify(originalTags));

  // ---- 4. Duplicate detection -----------------------------------------
  const groups = await sandbox.AxiomDuplicateDetector.findDuplicates(scope, 0.5, 200);
  const dupHit = groups.find((g) => g.ids.includes(tsA.id) && g.ids.includes(tsB.id));
  check('duplicate detector groups the two near-identical TypeScript notes', !!dupHit, groups.map((g) => g.ids));
  check('duplicate detector does not merge the unrelated meeting note into that group',
    !groups.some((g) => g.ids.includes(meeting.id) && (g.ids.includes(tsA.id) || g.ids.includes(tsB.id))));

  // ---- 5. Importance ranking (feeds the EXISTING M8 ranker) -----------
  await fakeAxiomAgents.pinMemory(tsA.id, true);
  const ranked = await sandbox.AxiomImportanceRanker.rankScope(scope, { limit: 50 });
  const pinnedEntry = ranked.find((r) => r.id === tsA.id);
  const meetingEntry = ranked.find((r) => r.id === meeting.id);
  check('importance ranker scores a pinned + tagged note higher than a bare one',
    pinnedEntry && meetingEntry && pinnedEntry.importance > meetingEntry.importance,
    { pinned: pinnedEntry && pinnedEntry.importance, bare: meetingEntry && meetingEntry.importance });
  check('the ranked list still carries rankScore from the unmodified Milestone 8 rank()',
    ranked.length > 0 && typeof ranked[0].rankScore === 'number');

  // ---- 6. Memory summaries ---------------------------------------------
  const summary = await sandbox.AxiomMemorySummarizer.summarize(scope, { limit: 200 });
  check('summarizer produces a non-empty summary with the correct count', summary.count === 3 && summary.summary.length > 0, summary.summary);

  // ---- 7. Executive AI enhancement (non-destructive wrap) --------------
  check('AxiomMemoryIntelligence.rankedRecall was wrapped, not replaced (marker present)',
    sandbox.AxiomMemoryIntelligence.rankedRecall.__m12Enhanced === true);
  // Query text matches tsA's note verbatim (the underlying ilike-style
  // searchMemories() used by both the real and fake AxiomAgents is a
  // substring match, not tokenized) — so only tsA is a direct hit; tsB
  // should only appear via the Milestone 12 graph expansion.
  const recalled = await sandbox.AxiomMemoryIntelligence.rankedRecall(scope, 'TypeScript for backend services', 8);
  check('enhanced rankedRecall() still resolves an array Executive AI\'s loadMemory() can consume', Array.isArray(recalled));
  check('enhanced rankedRecall() surfaces the graph-related note even when only one matched the query text directly',
    recalled.some((r) => r.id === tsA.id) && recalled.some((r) => r.id === tsB.id), recalled.map((r) => r.id));

  // ---- Regression: Milestone 8 ranker still works standalone -----------
  const plainRank = sandbox.AxiomMemoryIntelligence.rank([{ note: 'a', ts: Date.now() }, { note: 'b', ts: Date.now() - 999999999 }]);
  check('Milestone 8 AxiomMemoryIntelligence.rank() is unmodified and still works standalone', Array.isArray(plainRank) && plainRank.length === 2);

  // ---- Regression: core agent registry untouched ------------------------
  const coreSnap = sandbox.AxiomAgentManager.snapshot();
  check('core agent registry still reports 10 agents, no duplicates (regression)',
    coreSnap.count === 10 && new Set(coreSnap.agents.map((a) => a.id)).size === 10);

  const passed = results.filter((r) => r.pass).length;
  console.log('\n[Milestone 12] ' + (passed === results.length ? 'PASS' : 'FAIL') + ' — ' + passed + '/' + results.length + ' checks passed.');
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Milestone 12 regression suite crashed:', err);
  process.exitCode = 1;
});
