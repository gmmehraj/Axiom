// ============================================================
// AXIOM AI OS — Milestone 14 Part 1 Regression Suite
// ------------------------------------------------------------
// Same intent and load order as milestone13-regression-suite.js: load
// the REAL, unmodified runtime files (Milestones 4/5/8/9/10/11/12/13/14
// Part 1) inside a Node `vm` context with the same minimal browser-global
// shim, and exercise them against light in-memory fakes for the external
// backends (AxiomAgents memory store, AxiomBrowserLive) — never against
// mocks of the runtime itself. No runtime file was changed to accommodate
// this harness.
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

// Exact same load order as os-shell.html — Milestone 14 Part 1 files
// appended right after m13-bootstrap.js (matches the actual <script>
// edit made to os-shell.html for this milestone).
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
load('os/runtime/knowledge/knowledge-graph.js');
load('os/runtime/knowledge/semantic-search.js');
load('os/runtime/knowledge/auto-tagger.js');
load('os/runtime/knowledge/duplicate-detector.js');
load('os/runtime/knowledge/importance-ranker.js');
load('os/runtime/knowledge/memory-summarizer.js');
load('os/runtime/knowledge/executive-knowledge-extension.js');
load('os/runtime/knowledge/m12-bootstrap.js');
load('os/runtime/automation/skill-registry.js');
load('os/runtime/automation/workflow-engine.js');
load('os/runtime/automation/trigger-scheduler.js');
load('os/runtime/automation/automation-engine.js');
load('os/runtime/automation/workflow-history.js');
load('os/runtime/automation/executive-automation-extension.js');
load('os/runtime/automation/m13-bootstrap.js');
load('os/runtime/plugins/plugin-manifest.js');
load('os/runtime/plugins/plugin-loader.js');
load('os/runtime/plugins/plugin-manager.js');
load('os/runtime/plugins/m14-bootstrap.js');

// Fake same-window browser workspace, same shape as the Milestone 6/10/11/13 fake.
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

  // ===================== Regression: Milestones 4–13 unaffected =====================
  await new Promise((r) => setTimeout(r, 20));
  const selfTest = await w.AxiomRuntime.selfTest();
  check('Milestone 4/5 self-test still passes (no regression)', selfTest && selfTest.ok, JSON.stringify(selfTest && selfTest.results.filter((r) => !r.pass)));

  const selfTestM8 = await w.AxiomRuntime.selfTestM8();
  check('Milestone 8 self-test still passes (no regression)', selfTestM8 && selfTestM8.ok, JSON.stringify(selfTestM8 && selfTestM8.results.filter((r) => !r.pass)));

  const selfTestM9 = await w.AxiomRuntime.selfTestM9();
  check('Milestone 9 self-test still passes (no regression)', selfTestM9 && selfTestM9.ok, JSON.stringify(selfTestM9 && selfTestM9.results.filter((r) => !r.pass)));

  const selfTestM10 = await w.AxiomRuntime.selfTestM10();
  check('Milestone 10 self-test still passes (no regression)', selfTestM10 && selfTestM10.ok, JSON.stringify(selfTestM10 && selfTestM10.results.filter((r) => !r.pass)));

  const selfTestM11 = await w.AxiomRuntime.selfTestM11();
  check('Milestone 11 self-test still passes (no regression)', selfTestM11 && selfTestM11.ok, JSON.stringify(selfTestM11 && selfTestM11.results.filter((r) => !r.pass)));

  const selfTestM12 = await w.AxiomRuntime.selfTestM12();
  check('Milestone 12 self-test still passes (no regression)', selfTestM12 && selfTestM12.ok, JSON.stringify(selfTestM12 && selfTestM12.results.filter((r) => !r.pass)));

  const selfTestM13 = await w.AxiomRuntime.selfTestM13();
  check('Milestone 13 self-test still passes (no regression)', selfTestM13 && selfTestM13.ok, JSON.stringify(selfTestM13 && selfTestM13.results.filter((r) => !r.pass)));

  const snap = w.AxiomAgentManager.snapshot();
  check('Still exactly 10 core agents, no duplicates', snap.count === 10 && new Set(snap.agents.map((a) => a.id)).size === 10, 'count=' + snap.count);

  // ===================== Milestone 14 Part 1 self-test (built-in) =====================
  const selfTestM14 = await w.AxiomRuntime.selfTestM14();
  check('Milestone 14 Part 1 self-test passes', selfTestM14 && selfTestM14.ok, JSON.stringify(selfTestM14 && selfTestM14.results.filter((r) => !r.pass)));
  selfTestM14.results.forEach((r) => check('  [M14] ' + r.name, r.pass, r.detail));

  // ===================== Additional targeted checks beyond the built-in self-test =====================

  const M = w.AxiomPluginManager;
  const S = M.STATES;

  // ----- Event-driven front door: install/enable/disable purely via the bus -----
  let installedEvt = null, runningEvt = null, disabledEvt = null;
  const offInstalled = w.AxiomAgentRuntime.bus.on('pluginmgr:installed', (env) => { installedEvt = env.payload; });
  const offRunning = w.AxiomAgentRuntime.bus.on('pluginmgr:running', (env) => { runningEvt = env.payload; });
  const offDisabled = w.AxiomAgentRuntime.bus.on('pluginmgr:disabled', (env) => { disabledEvt = env.payload; });

  w.AxiomAgentRuntime.bus.emit('pluginmgr:install-request', 'regression-test', {
    manifest: { id: 'plugin.regression-bus', name: 'Regression Bus Plugin', version: '1.0.0', author: 'QA', description: 'via bus' },
    factory: function () { return {}; }
  });
  await new Promise((r) => setTimeout(r, 20));
  check('a plugin installed purely via "pluginmgr:install-request" (no JS reference) registers', !!installedEvt && installedEvt.id === 'plugin.regression-bus', installedEvt);

  w.AxiomAgentRuntime.bus.emit('pluginmgr:enable-request', 'regression-test', { id: 'plugin.regression-bus' });
  await new Promise((r) => setTimeout(r, 20));
  check('the same plugin reaches "running" purely via "pluginmgr:enable-request"', !!runningEvt && runningEvt.id === 'plugin.regression-bus' && M.get('plugin.regression-bus').state === S.RUNNING, runningEvt);

  w.AxiomAgentRuntime.bus.emit('pluginmgr:disable-request', 'regression-test', { id: 'plugin.regression-bus' });
  await new Promise((r) => setTimeout(r, 20));
  check('the plugin returns to "disabled" purely via "pluginmgr:disable-request"', !!disabledEvt && disabledEvt.id === 'plugin.regression-bus' && M.get('plugin.regression-bus').state === S.DISABLED, disabledEvt);

  offInstalled(); offRunning(); offDisabled();
  M.uninstall('plugin.regression-bus');

  // ----- Extension-point reuse: a plugin-declared agent goes through the real Plugin Registry -----
  const agentPluginInstall = M.install({
    id: 'plugin.regression-agent', name: 'Regression Agent Plugin', version: '1.0.0', author: 'QA', description: 'declares an agent'
  }, function () {
    return { agent: { id: 'plugin.regression-weather', name: 'Regression Weather', version: '1.0.0', capabilities: ['weather.lookup'] } };
  });
  check('a plugin declaring an "agent" extension point installs cleanly', agentPluginInstall.ok, agentPluginInstall);
  const agentEnable = await M.enable('plugin.regression-agent');
  check('enabling the plugin registers its agent via the real, unmodified AxiomPluginRegistry', agentEnable.ok && !!w.AxiomPluginRegistry.get('plugin.regression-weather'));
  check('the registered agent is a genuine AxiomAgentManager agent too', !!w.AxiomAgentManager.get('plugin.regression-weather'));
  M.disable('plugin.regression-agent');
  check('disabling the plugin unregisters its agent from the Plugin Registry', w.AxiomPluginRegistry.get('plugin.regression-weather') === null);
  check('the agent is also gone from AxiomAgentManager', !w.AxiomAgentManager.get('plugin.regression-weather'));
  M.uninstall('plugin.regression-agent');

  // ----- Duplicate-load prevention under concurrency -----
  let concurrentFactoryRuns = 0;
  M.install({ id: 'plugin.regression-concurrent', name: 'Regression Concurrent', version: '1.0.0', author: 'QA', description: 'concurrency check' },
    function () { concurrentFactoryRuns += 1; return new Promise((res) => setTimeout(() => res({}), 15)); });
  const [c1, c2, c3] = await Promise.all([
    M.load('plugin.regression-concurrent'),
    M.load('plugin.regression-concurrent'),
    M.enable('plugin.regression-concurrent')
  ]);
  check('three concurrent load()/enable() calls on the same plugin run the factory exactly once', concurrentFactoryRuns === 1 && c1.ok && c2.ok && c3.ok, concurrentFactoryRuns);
  M.disable('plugin.regression-concurrent');
  M.uninstall('plugin.regression-concurrent');

  // ----- Runtime stability: no duplicate event loops / duplicate globals -----
  check('Event Bus, Agent Manager, Skill Registry, Plugin Registry, and all Milestone 14 modules are still the same singletons after M14 load',
    !!(w.AxiomAgentRuntime && w.AxiomAgentRuntime.bus && w.AxiomAgentManager && w.AxiomPluginRegistry && w.AxiomSkillRegistry &&
       w.AxiomPluginManifest && w.AxiomPluginLoader && w.AxiomPluginManager));
  check('Milestone 14 introduced no duplicate manager/registry globals',
    !w.AxiomPluginManager2 && !w.AxiomPluginLoader2 && !w.AxiomPluginManifest2 && !w.AxiomPluginRegistry2 && !w.AxiomSkillRegistry2);

  const finalSnap = w.AxiomAgentManager.snapshot();
  check('Still exactly 10 core agents after all Milestone 14 activity, no duplicates',
    finalSnap.count === 10 && new Set(finalSnap.agents.map((a) => a.id)).size === 10, 'count=' + finalSnap.count);

  const passed = results.filter((r) => r.pass).length;
  console.log('\n=== MILESTONE 14 PART 1 VERIFICATION ===');
  results.forEach((r) => console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   -> ' + r.detail)));
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
