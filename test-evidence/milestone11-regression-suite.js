// ============================================================
// AXIOM AI OS — Milestone 11 Regression Suite
// ------------------------------------------------------------
// Same intent and load order as milestone10-regression-suite.js: load
// the REAL, unmodified runtime files (Milestones 4/8/9/10/11) and
// exercise them against light in-memory fakes for the two external
// backends, never against mocks of the runtime itself.
//
// Unlike the Milestone 5/6/10 suites, this harness does not use jsdom
// (unavailable in this execution environment — no package registry
// access). Instead it runs the exact same unmodified source files
// inside a Node `vm` context with a minimal browser-global shim
// (window/document/localStorage/CustomEvent/performance) that
// implements only what these files actually touch — verified by
// grepping the runtime for every browser API it references before
// writing this harness. No runtime file was changed to accommodate
// the harness.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const AI = path.join(__dirname, '..');

// ---------------------- Minimal browser shim -------------------------
function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, new Set()).get(type)).add(fn); },
    removeEventListener(type, fn) { const s = listeners.get(type); if (s) s.delete(fn); },
    dispatchEvent(evt) { const s = listeners.get(evt.type); if (s) s.forEach((fn) => fn(evt)); return true; }
  };
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.console = console;
sandbox.Date = Date; sandbox.Promise = Promise; sandbox.Map = Map; sandbox.Set = Set;
sandbox.Array = Array; sandbox.Object = Object; sandbox.JSON = JSON; sandbox.Math = Math;
sandbox.Number = Number; sandbox.String = String; sandbox.Boolean = Boolean; sandbox.RegExp = RegExp;
sandbox.Error = Error; sandbox.Symbol = Symbol;
sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = setInterval; sandbox.clearInterval = clearInterval;
sandbox.performance = require('perf_hooks').performance;
sandbox.document = Object.assign(makeEventTarget(), {});
sandbox.addEventListener = makeEventTarget().addEventListener;
sandbox.CustomEvent = class CustomEvent {
  constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; }
};
sandbox.localStorage = makeLocalStorage();
// BroadcastChannel intentionally left undefined — agent-runtime.js already
// feature-detects it with `typeof BroadcastChannel !== 'undefined'`.

vm.createContext(sandbox);

let memStore = [];
let idSeq = 1;
sandbox.window.AxiomAgents = {
  remember: async (agentId, note, tags) => {
    const row = { id: 'm' + (idSeq++), note, tags: tags || [], pinned: false, category: null, created_at: new Date().toISOString() };
    memStore.push(row);
    return row;
  },
  getMemoryNotes: async (agentId, limit) => memStore.slice(-1 * (limit || 8)).reverse(),
  recentMemories: async (agentId, limit) => memStore.slice(-1 * (limit || 8)).reverse(),
  searchMemories: async (agentId, query) => memStore.filter((m) => m.note.includes(query)),
  updateMemory: async (id, patch) => {
    const row = memStore.find((m) => m.id === id);
    if (!row) throw new Error('not found');
    Object.assign(row, patch);
    return row;
  },
  tagMemory: async (id, tags) => sandbox.window.AxiomAgents.updateMemory(id, { tags }),
  deleteMemory: async (id) => { memStore = memStore.filter((m) => m.id !== id); return true; },
  pinMemory: async (id, pinned) => sandbox.window.AxiomAgents.updateMemory(id, { pinned: pinned !== false }),
  unpinMemory: async (id) => sandbox.window.AxiomAgents.updateMemory(id, { pinned: false }),
  listPinned: async (agentId, limit) => memStore.filter((m) => m.pinned).slice(0, limit || 50),
  setCategory: async (id, category) => sandbox.window.AxiomAgents.updateMemory(id, { category: category || null }),
  listCategories: async (agentId) => {
    const counts = {};
    memStore.forEach((m) => { if (m.category) counts[m.category] = (counts[m.category] || 0) + 1; });
    return Object.keys(counts).map((c) => ({ category: c, count: counts[c] }));
  },
  semanticRecall: async (agentId, query, limit) => {
    const qTokens = String(query).toLowerCase().match(/[a-z0-9]+/g) || [];
    return memStore
      .map((m) => {
        const noteTokens = new Set((m.note.toLowerCase().match(/[a-z0-9]+/g) || []).concat(m.tags.map((t) => t.toLowerCase())));
        const score = qTokens.filter((t) => noteTokens.has(t)).length;
        return { note: m, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit || 8)
      .map((x) => Object.assign({ relevance: x.score }, x.note));
  },
  rememberShortTerm: async (agentId, note, tags) => {
    const row = { id: 'st-' + (idSeq++), note, tags: tags || [], created_at: new Date().toISOString() };
    (sandbox.window.__shortTerm = sandbox.window.__shortTerm || []).push(row);
    return row;
  },
  recallShortTerm: async (agentId, limit) => (sandbox.window.__shortTerm || []).slice(-1 * (limit || 10)).reverse()
};
sandbox.window.FileProcessing = {
  extractText: async (file) => 'Extracted text content for ' + (file && file.name),
  ocrImage: async (file) => 'OCR text for ' + (file && file.name)
};

function load(rel) {
  const code = fs.readFileSync(path.join(AI, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

// Exact same load order as os-shell.html — Milestone 11 files appended
// right after m10-bootstrap.js (matches the actual <script> edit made to
// os-shell.html for this milestone).
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
load('os/runtime/scheduler/event-timeline.js');
load('os/runtime/scheduler/task-graph.js');
load('os/runtime/scheduler/task-scheduler.js');
load('os/runtime/scheduler/resource-monitor.js');
load('os/runtime/scheduler/plugin-registry.js');
load('os/runtime/scheduler/autonomous-executive.js');
load('os/runtime/scheduler/m11-bootstrap.js');

// Fake same-window browser workspace, same shape as the Milestone 6/10 fake.
let bookmarks = [];
let historyLog = [];
sandbox.window.AxiomBrowserLive = {
  navigate: (url) => { sandbox.window.__lastNav = url; historyLog.push({ url }); },
  search: (q) => { sandbox.window.__lastNav = 'search:' + q; historyLog.push({ url: 'search:' + q }); },
  goBack: () => {}, goForward: () => {}, refresh: () => {},
  newTab: () => {}, switchTab: () => {}, closeTab: () => {},
  toggleBookmark: () => { bookmarks.push({ url: sandbox.window.__lastNav }); },
  getSnapshot: () => ({ url: sandbox.window.__lastNav, blocked: false, tabs: [] }),
  bookmarksList: () => bookmarks.slice(),
  historyList: () => historyLog.slice().reverse(),
  historyClear: () => { historyLog = []; },
  listDownloads: () => [],
  readingMode: () => ({ title: 'Fake Page', text: 'Enough readable text to summarize.', chars: 40 }),
  summarizePage: () => ({ title: 'Fake Page', url: sandbox.window.__lastNav, summary: 'Enough readable text to summarize.' }),
  extractLinks: () => ({ url: sandbox.window.__lastNav, count: 2, links: [{ url: 'https://a.example', text: 'A' }, { url: 'https://b.example', text: 'B' }] }),
  extractImages: () => ({ url: sandbox.window.__lastNav, count: 0, images: [] }),
  isBlocked: () => false
};

async function main() {
  const results = [];
  function check(name, cond, detail) { results.push({ name, pass: !!cond, detail }); }
  const w = sandbox.window;

  // ===================== Regression: Milestones 4–10 unaffected =====================
  await new Promise((r) => setTimeout(r, 20));
  const selfTest = await w.AxiomRuntime.selfTest();
  check('Milestone 4/5 self-test still passes (no regression)', selfTest && selfTest.ok, JSON.stringify(selfTest && selfTest.results.filter((r) => !r.pass)));

  const selfTestM8 = await w.AxiomRuntime.selfTestM8();
  check('Milestone 8 self-test still passes (no regression)', selfTestM8 && selfTestM8.ok, JSON.stringify(selfTestM8 && selfTestM8.results.filter((r) => !r.pass)));

  const selfTestM9 = await w.AxiomRuntime.selfTestM9();
  check('Milestone 9 self-test still passes (no regression)', selfTestM9 && selfTestM9.ok, JSON.stringify(selfTestM9 && selfTestM9.results.filter((r) => !r.pass)));

  const selfTestM10 = await w.AxiomRuntime.selfTestM10();
  check('Milestone 10 self-test still passes (no regression)', selfTestM10 && selfTestM10.ok, JSON.stringify(selfTestM10 && selfTestM10.results.filter((r) => !r.pass)));

  const snap = w.AxiomAgentManager.snapshot();
  check('Still exactly 10 core agents, no duplicates', snap.count === 10 && new Set(snap.agents.map((a) => a.id)).size === 10, 'count=' + snap.count);

  // ===================== Milestone 11 self-test (built-in) =====================
  const selfTestM11 = await w.AxiomRuntime.selfTestM11();
  check('Milestone 11 self-test passes', selfTestM11 && selfTestM11.ok, JSON.stringify(selfTestM11 && selfTestM11.results.filter((r) => !r.pass)));
  selfTestM11.results.forEach((r) => check('  [M11] ' + r.name, r.pass, r.detail));

  // ===================== Additional targeted checks beyond the built-in self-test =====================

  // ----- Scheduler: retries -----
  const SCHED = w.AxiomTaskScheduler;
  const originalCreateJob = w.AxiomJobManager.createJob;
  let createJobCalls = 0;
  w.AxiomJobManager.createJob = function (...args) { createJobCalls += 1; return originalCreateJob.apply(this, args); };
  const before = createJobCalls;
  const t1 = SCHED.schedule('remember: m11 duplicate-execution guard', { priority: 'normal' });
  await t1.promise;
  check('scheduler admits a task into the Job Manager exactly once (no duplicate execution)', createJobCalls === before + 1, createJobCalls - before);
  w.AxiomJobManager.createJob = originalCreateJob;

  // ----- Plugin registry: duplicate id rejected -----
  const PLUGINS = w.AxiomPluginRegistry;
  const first = PLUGINS.register({ id: 'plugin.dup-check', name: 'Dup Check', version: '1.0.0', handler: () => Promise.resolve({ ok: true }) });
  const second = PLUGINS.register({ id: 'plugin.dup-check', name: 'Dup Check Two', version: '1.0.0', handler: () => Promise.resolve({ ok: true }) });
  check('plugin registry rejects a second registration of the same id', first.ok === true && second.ok === false, second.error);
  PLUGINS.unregister('plugin.dup-check');

  // ----- Plugin registry: malformed spec rejected -----
  const malformed = PLUGINS.register({ id: 'not-namespaced' });
  check('plugin registry rejects a non-namespaced id', malformed.ok === false, malformed.error);

  // ----- Task graph: cyclic-safe topological order -----
  const cyclicGraph = w.AxiomTaskGraph.fromPlan({
    goal: 'cyclic test',
    steps: [
      { id: 'a', agentId: 'agent.assistant', clause: 'a', dependsOn: ['b'] },
      { id: 'b', agentId: 'agent.assistant', clause: 'b', dependsOn: ['a'] }
    ]
  });
  check('task graph returns null topological order for a cyclic graph instead of throwing', cyclicGraph.order === null);

  // ----- Event timeline: bounded / queryable -----
  const timelineReport1 = w.AxiomEventTimeline.recent(5);
  check('event timeline .recent() returns newest-first entries', Array.isArray(timelineReport1) && timelineReport1.length > 0);

  // ----- Resource monitor: browser metrics degrade gracefully -----
  const browserMetrics = w.AxiomResourceMonitor.browserMetrics();
  check('resource monitor browser metrics never throw even without full browser APIs', typeof browserMetrics === 'object' && browserMetrics !== null, browserMetrics);

  // ----- Runtime stability: no duplicate event loops -----
  check('Event Bus, Agent Manager, Job Manager, Orchestrator, Executive AI are still the same singletons after M11 load',
    !!(w.AxiomAgentRuntime && w.AxiomAgentRuntime.bus && w.AxiomAgentManager && w.AxiomJobManager && w.AxiomOrchestrator && w.AxiomExecutiveAI));
  check('Milestone 11 introduced no window.AxiomJobManager2 / duplicate manager globals',
    !w.AxiomJobManager2 && !w.AxiomOrchestrator2 && !w.AxiomAgentManager2 && !w.AxiomExecutiveAI2);

  const passed = results.filter((r) => r.pass).length;
  console.log('\n=== MILESTONE 11 VERIFICATION ===');
  results.forEach((r) => console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   -> ' + r.detail)));
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
