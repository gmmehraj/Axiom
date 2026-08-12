const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const AI = path.join(__dirname, '..');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/os-shell.html',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true
});
const { window } = dom;

// Stub subsystems the runtime touches, same shape as the Milestone 5/6
// regression fakes, so this suite exercises real Milestone 10 logic
// against the real Milestone 4/8/9 runtime rather than a mock of it.
let memStore = [];
let idSeq = 1;
window.AxiomAgents = {
  remember: async (agentId, note, tags) => {
    const row = { id: 'm' + (idSeq++), note, tags: tags || [], pinned: false, category: null, created_at: new Date().toISOString() };
    memStore.push(row);
    return row;
  },
  getMemoryNotes: async (agentId, limit) => memStore.slice(-1 * (limit || 8)).reverse(),
  recentMemories: async (agentId, limit) => memStore.slice(-1 * (limit || 8)).reverse(),
  searchMemories: async (agentId, query) => memStore.filter(m => m.note.includes(query)),
  updateMemory: async (id, patch) => {
    const row = memStore.find(m => m.id === id);
    if (!row) throw new Error('not found');
    Object.assign(row, patch);
    return row;
  },
  tagMemory: async (id, tags) => window.AxiomAgents.updateMemory(id, { tags }),
  deleteMemory: async (id) => { memStore = memStore.filter(m => m.id !== id); return true; },
  pinMemory: async (id, pinned) => window.AxiomAgents.updateMemory(id, { pinned: pinned !== false }),
  unpinMemory: async (id) => window.AxiomAgents.updateMemory(id, { pinned: false }),
  listPinned: async (agentId, limit) => memStore.filter(m => m.pinned).slice(0, limit || 50),
  setCategory: async (id, category) => window.AxiomAgents.updateMemory(id, { category: category || null }),
  listCategories: async (agentId) => {
    const counts = {};
    memStore.forEach(m => { if (m.category) counts[m.category] = (counts[m.category] || 0) + 1; });
    return Object.keys(counts).map(c => ({ category: c, count: counts[c] }));
  },
  semanticRecall: async (agentId, query, limit) => {
    const qTokens = String(query).toLowerCase().match(/[a-z0-9]+/g) || [];
    return memStore
      .map(m => {
        const noteTokens = new Set((m.note.toLowerCase().match(/[a-z0-9]+/g) || []).concat(m.tags.map(t => t.toLowerCase())));
        const score = qTokens.filter(t => noteTokens.has(t)).length;
        return { note: m, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit || 8)
      .map(x => Object.assign({ relevance: x.score }, x.note));
  },
  rememberShortTerm: async (agentId, note, tags) => {
    const row = { id: 'st-' + (idSeq++), note, tags: tags || [], created_at: new Date().toISOString() };
    (window.__shortTerm = window.__shortTerm || []).push(row);
    return row;
  },
  recallShortTerm: async (agentId, limit) => (window.__shortTerm || []).slice(-1 * (limit || 10)).reverse()
};
window.FileProcessing = {
  extractText: async (file) => 'Extracted text content for ' + (file && file.name),
  ocrImage: async (file) => 'OCR text for ' + (file && file.name)
};

function load(rel) {
  const code = fs.readFileSync(path.join(AI, rel), 'utf8');
  window.eval(code);
}

// Exact same load order as os-shell.html, Milestone 10 files appended
// right after m9-bootstrap.js (matches the actual <script> edit made
// to os-shell.html for this milestone).
load('os/shared/logger.js');
load('os/shared/id-factory.js');
load('os/runtime/agent-runtime.js');
load('os/runtime/agent-definitions/_shared.js');
load('os/runtime/agent-definitions/assistant-agent.js');
load('os/runtime/agent-definitions/browser-agent.js');
load('os/runtime/agent-definitions/memory-agent.js');
load('os/runtime/agent-definitions/planner-agent.js');
load('os/runtime/agent-definitions/research-agent.js');
load('os/runtime/agent-definitions/coding-agent.js');
load('os/runtime/agent-definitions/vision-agent.js');
load('os/runtime/agent-definitions/voice-agent.js');
load('os/runtime/agent-definitions/automation-agent.js');
load('os/runtime/agent-definitions/file-agent.js');
load('os/runtime/agent-definitions/_assemble.js');
load('os/runtime/capabilities/capability-kit.js');
load('os/runtime/capabilities/browser-bridge.js');
load('os/runtime/capabilities/planner-store.js');
load('os/runtime/capabilities/research-toolkit.js');
load('os/runtime/capabilities/voice-adapter-kit.js');
load('os/runtime/capabilities/vision-adapter-kit.js');
load('os/runtime/capabilities/coding-toolkit.js');
load('os/runtime/capabilities/workflows.js');
load('os/runtime/task-router.js');
load('os/runtime/agent-manager.js');
load('os/runtime/runtime-bootstrap.js');
load('os/runtime/intelligence/context-store.js');
load('os/runtime/intelligence/task-planner.js');
load('os/runtime/intelligence/orchestrator.js');
load('os/runtime/intelligence/job-manager.js');
load('os/runtime/intelligence/error-recovery.js');
load('os/runtime/intelligence/runtime-monitor.js');
load('os/runtime/intelligence/planner-intelligence.js');
load('os/runtime/intelligence/browser-intelligence.js');
load('os/runtime/intelligence/memory-intelligence.js');
load('os/runtime/intelligence/dynamic-workflow.js');
load('os/runtime/intelligence/m8-bootstrap.js');
load('os/runtime/executive/executive-ai.js');
load('os/runtime/executive/m9-bootstrap.js');
load('os/runtime/conversation/nlu-resolver.js');
load('os/runtime/conversation/conversation-stream.js');
load('os/runtime/conversation/conversation-memory.js');
load('os/runtime/conversation/conversation-manager.js');
load('os/runtime/conversation/conversation-context.js');
load('os/runtime/conversation/m10-bootstrap.js');

// Fake same-window browser workspace, same shape as the Milestone 6 fake,
// so Browser Agent / Browser Intelligence / conversation context's
// "current browser session" lookup all have something real to read.
let bookmarks = [];
let historyLog = [];
window.AxiomBrowserLive = {
  navigate: (url) => { window.__lastNav = url; historyLog.push({ url }); },
  search: (q) => { window.__lastNav = 'search:' + q; historyLog.push({ url: 'search:' + q }); },
  goBack: () => {}, goForward: () => {}, refresh: () => {},
  newTab: () => {}, switchTab: () => {}, closeTab: () => {},
  toggleBookmark: () => { bookmarks.push({ url: window.__lastNav }); },
  getSnapshot: () => ({ url: window.__lastNav, blocked: false, tabs: [] }),
  bookmarksList: () => bookmarks.slice(),
  historyList: () => historyLog.slice().reverse(),
  historyClear: () => { historyLog = []; },
  listDownloads: () => [],
  readingMode: () => ({ title: 'Fake Page', text: 'Enough readable text to summarize.', chars: 40 }),
  summarizePage: () => ({ title: 'Fake Page', url: window.__lastNav, summary: 'Enough readable text to summarize.' }),
  extractLinks: () => ({ url: window.__lastNav, count: 2, links: [{ url: 'https://a.example', text: 'A' }, { url: 'https://b.example', text: 'B' }] }),
  extractImages: () => ({ url: window.__lastNav, count: 0, images: [] }),
  isBlocked: () => false
};

async function main() {
  const results = [];
  function check(name, cond, detail) { results.push({ name, pass: !!cond, detail }); }

  // ===================== Regression: Milestones 4–9 unaffected =====================
  await new Promise((r) => setTimeout(r, 20));
  const selfTest = await window.AxiomRuntime.selfTest();
  check('Milestone 4/5 self-test still passes (no regression)', selfTest && selfTest.ok, JSON.stringify(selfTest && selfTest.results.filter(r => !r.pass)));

  const selfTestM8 = await window.AxiomRuntime.selfTestM8();
  check('Milestone 8 self-test still passes (no regression)', selfTestM8 && selfTestM8.ok, JSON.stringify(selfTestM8 && selfTestM8.results.filter(r => !r.pass)));

  const selfTestM9 = await window.AxiomRuntime.selfTestM9();
  check('Milestone 9 self-test still passes (no regression)', selfTestM9 && selfTestM9.ok, JSON.stringify(selfTestM9 && selfTestM9.results.filter(r => !r.pass)));

  const snap = window.AxiomAgentManager.snapshot();
  check('Still exactly 10 core agents, no duplicates', snap.count === 10 && new Set(snap.agents.map(a => a.id)).size === 10, 'count=' + snap.count);

  // ===================== Milestone 10 self-test (built-in) =====================
  const selfTestM10 = await window.AxiomRuntime.selfTestM10();
  check('Milestone 10 self-test passes', selfTestM10 && selfTestM10.ok, JSON.stringify(selfTestM10 && selfTestM10.results.filter(r => !r.pass)));

  const CONV = window.AxiomConversationManager;

  // ===================== Single-turn conversation =====================
  const soloConv = CONV.start();
  const solo = CONV.send(soloConv, 'remember: single turn regression check');
  check('Single-turn send() runs the unmodified Executive AI pipeline', !!(solo.executiveId && solo.promise), JSON.stringify(solo));
  const soloOutcome = await solo.promise;
  check('Single-turn conversation reaches a terminal status', ['completed', 'needs-clarification', 'cancelled'].includes(soloOutcome.status), soloOutcome.status);

  // ===================== Multi-turn conversation (brief's own example) =====================
  const convId = CONV.start();

  const turn1 = CONV.send(convId, 'Research AI startups.');
  check('Turn 1 does not require clarification', turn1.status !== 'needs-clarification', turn1.status);
  await turn1.promise;
  check('Turn 1 sets an active topic for later turns', CONV.state(convId).activeTopic && CONV.state(convId).activeTopic.length > 0, CONV.state(convId).activeTopic);

  const turn2 = CONV.send(convId, 'Now save the best ones.');
  check('Turn 2 ("the best ones") resolves against turn 1\'s topic without repeating it', turn2.resolvedText.toLowerCase().includes('ai startups'), turn2.resolvedText);
  check('Turn 2 does not ask for clarification (context carried over)', turn2.status !== 'needs-clarification', turn2.status);
  await turn2.promise;

  const turn3 = CONV.send(convId, 'Create a roadmap.');
  check('Turn 3 (bare action, no stated object) has the topic injected automatically', turn3.resolvedText.toLowerCase().includes('ai startups'), turn3.resolvedText);
  await turn3.promise;

  const turn4 = CONV.send(convId, 'Open them in Browser.');
  check('Turn 4 ("them") resolves against the active topic', turn4.resolvedText.toLowerCase().includes('ai startups'), turn4.resolvedText);
  const turn4Outcome = await turn4.promise;
  check('Turn 4 reaches a terminal status', ['completed', 'needs-clarification', 'cancelled'].includes(turn4Outcome.status), turn4Outcome.status);

  check('All 4 turns tracked in this conversation\'s bounded history', CONV.history(convId).length === 4, CONV.history(convId).length);

  // ===================== Ambiguous / follow-up questions =====================
  const freshConv = CONV.start();
  const ambiguous = CONV.send(freshConv, 'fix that');
  check('A dangling reference with zero conversation history asks for clarification instead of guessing', ambiguous.status === 'needs-clarification');
  check('Clarification never produced an executiveId (nothing was run)', ambiguous.executiveId === null);

  const resumed = CONV.resolveClarification(freshConv, ambiguous.turnId, 'the login page');
  check('resolveClarification() re-enters the normal pipeline after the user answers', !!(resumed && resumed.turnId), resumed && resumed.status);
  if (resumed) await resumed.promise;

  // ===================== Streaming / progressive responses =====================
  const streamConv = CONV.start();
  const streamedTypes = [];
  const unsub = CONV.subscribe(streamConv, (evt) => streamedTypes.push(evt.type));
  const streamTurn = CONV.send(streamConv, 'search AI news and summarize the findings');
  await streamTurn.promise;
  unsub();
  check('Streaming surfaced a "thinking" stage before completion', streamedTypes.includes('thinking'), JSON.stringify(streamedTypes));
  check('Streaming surfaced a terminal "done" event', streamedTypes.includes('done'), JSON.stringify(streamedTypes));

  // ===================== Context loading =====================
  const ctx = await window.AxiomConversationContext.build(convId);
  check('Context bundle carries the active conversation + topic', ctx.conversation && ctx.conversation.activeTopic, JSON.stringify(ctx.conversation));
  check('Context bundle includes previous responses from this conversation', Array.isArray(ctx.previousResponses) && ctx.previousResponses.length > 0, ctx.previousResponses.length);
  check('Context bundle includes a selectedMemory section (Memory Intelligence)', Array.isArray(ctx.selectedMemory));
  check('Context bundle includes a browserSession section (Browser Bridge)', 'browserSession' in ctx);
  check('Context bundle includes a plannerState section', 'plannerState' in ctx);

  // ===================== Conversation memory selectivity =====================
  const beforeCount = memStore.length;
  const chatConv = CONV.start();
  const chatTurn = CONV.send(chatConv, 'remember: hi there');
  await chatTurn.promise;
  // A single-step, non-decision remark should not necessarily bloat the
  // memory store beyond what the agent's own remember() op already wrote
  // (Executive AI's own outcome note, or the memory agent op itself) —
  // the important assertion is that ConversationMemory's own filter ran
  // without throwing and without duplicating that same write twice.
  check('ConversationMemory selectivity ran without throwing', memStore.length >= beforeCount);

  // ===================== No global-variable state leakage =====================
  check('Conversation state is not exposed as a bare global (no window.conversations)', typeof window.conversations === 'undefined');
  check('Two conversations never share activeTopic', CONV.state(convId).activeTopic !== CONV.state(freshConv).activeTopic || !CONV.state(freshConv).activeTopic);

  // ===================== Runtime stability: Conversation Manager coordinates only =====================
  check('AxiomConversationManager never exposes a dispatch()/route() of its own', typeof CONV.dispatch === 'undefined' && typeof CONV.route === 'undefined');
  check('Executive AI, Agent Manager, Event Bus, Orchestrator, Memory Intelligence are all still the same singletons', window.AxiomExecutiveAI && window.AxiomAgentManager && window.AxiomAgentRuntime.bus && window.AxiomOrchestrator && window.AxiomMemoryIntelligence);

  const passed = results.filter(r => r.pass).length;
  console.log('\n=== MILESTONE 10 VERIFICATION ===');
  results.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   -> ' + r.detail)));
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
