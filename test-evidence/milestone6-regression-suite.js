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

// Stub subsystems the runtime touches so this test focuses on Milestone 6
// logic itself, not unrelated backends (Supabase, real network, etc).
// Extends the Milestone 5 fakes with the columns/fields Milestone 6 adds
// (pinned, category) rather than replacing them.
let memStore = []; // {id, note, tags, pinned, category, created_at}
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
    if (patch.note !== undefined) row.note = patch.note;
    if (patch.tags !== undefined) row.tags = patch.tags;
    if (patch.pinned !== undefined) row.pinned = patch.pinned;
    if (patch.category !== undefined) row.category = patch.category;
    return row;
  },
  tagMemory: async (id, tags) => window.AxiomAgents.updateMemory(id, { tags }),
  deleteMemory: async (id) => { memStore = memStore.filter(m => m.id !== id); return true; },
  // Milestone 6 memory fakes — mirror agents.js's real implementations
  // closely enough to exercise the Memory Agent handler's new ops.
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
  recallShortTerm: async (agentId, limit) => (window.__shortTerm || []).slice(-1 * (limit || 10)).reverse(),
  clearShortTerm: async () => { window.__shortTerm = []; return true; },
  runTool: async (name, args) => {
    if (name === 'workspace_search') {
      return [
        { id: 'f1', filename: 'notes.pdf', kind: 'document' },
        { id: 'f2', filename: 'diagram.png', kind: 'image' },
        { id: 'f3', filename: 'src/app.js', kind: 'document' }
      ].filter(f => !args.query || f.filename.includes(args.query));
    }
    if (name === 'document_search') {
      return [{ id: 'd1', filename: 'axiom-notes.md', kind: 'document' }].filter(f => !args.query || true);
    }
    throw new Error('unknown tool ' + name);
  }
};
window.FileProcessing = {
  extractText: async (file) => 'Extracted text content for ' + (file && file.name),
  ocrImage: async (file) => 'OCR text for ' + (file && file.name)
};

function load(rel) {
  const code = fs.readFileSync(path.join(AI, rel), 'utf8');
  window.eval(code);
}

// Same load order as the HTML pages, capability files inserted right after
// agent-definitions.js (matches the actual Milestone 6 <script> edits).
load('os/shared/logger.js');
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

// Fake same-window browser workspace (AxiomBrowserLive) with the Milestone
// 6 surface added, so the Browser Agent has something real to drive
// without needing an actual iframe.
let bookmarks = [];
let historyLog = [];
let downloadsLog = [];
window.AxiomBrowserLive = {
  navigate: (url) => { window.__lastNav = url; historyLog.push({ url }); },
  search: (q) => { window.__lastNav = 'search:' + q; },
  goBack: () => {}, goForward: () => {}, refresh: () => {},
  newTab: () => {}, switchTab: () => {}, closeTab: () => {},
  toggleBookmark: () => { bookmarks.push({ url: window.__lastNav }); },
  getSnapshot: () => ({ url: window.__lastNav, blocked: false, tabs: [] }),
  bookmarksList: () => bookmarks.slice(),
  historyList: () => historyLog.slice().reverse(),
  historyClear: () => { historyLog = []; },
  recordDownload: (e) => { downloadsLog.push(e); return e; },
  listDownloads: () => downloadsLog.slice().reverse(),
  clearDownloads: () => { downloadsLog = []; },
  readingMode: () => ({ title: 'Fake Page', text: 'This is enough readable text content to summarize meaningfully for the reading mode check.', chars: 88 }),
  summarizePage: () => ({ title: 'Fake Page', url: window.__lastNav, summary: 'This is enough readable text content to summarize meaningfully.' }),
  extractLinks: () => ({ url: window.__lastNav, count: 2, links: [{ url: 'https://a.example', text: 'A' }, { url: 'https://b.example', text: 'B' }] }),
  extractImages: () => ({ url: window.__lastNav, count: 1, images: [{ url: 'https://a.example/img.png', alt: 'x' }] }),
  isBlocked: () => false
};

const MGR = window.AxiomAgentManager;
const RT = window.AxiomAgentRuntime;

function waitFor(agentId, taskId) {
  return new Promise((resolve, reject) => {
    const offC = RT.bus.on('task:completed', (env) => {
      if (env.payload.agent === agentId && env.payload.task.id === taskId) { offC(); offF(); resolve(env.payload.result); }
    });
    const offF = RT.bus.on('task:failed', (env) => {
      if (env.payload.agent === agentId && env.payload.task.id === taskId) { offC(); offF(); reject(new Error(env.payload.error)); }
    });
  });
}

async function main() {
  const results = [];
  function check(name, cond, detail) { results.push({ name, pass: !!cond, detail }); }

  // ===================== Reliability (Step 10) =====================
  await new Promise((r) => setTimeout(r, 20));
  const selfTest = await window.AxiomRuntime.selfTest();
  check('Milestone 4/5 self-test still passes (no regression)', selfTest && selfTest.ok, JSON.stringify(selfTest && selfTest.results.filter(r => !r.pass)));

  const snap = MGR.snapshot();
  check('Still exactly 10 core agents, no duplicates', snap.count === 10 && new Set(snap.agents.map(a => a.id)).size === 10, 'count=' + snap.count);

  // Re-registering a default agent must be ignored, not duplicated.
  const before = MGR.list().length;
  MGR.register(window.AxiomAgentDefinitionsById['agent.memory']);
  check('Re-registering an existing agent id is ignored (no duplicate)', MGR.list().length === before, 'before=' + before + ' after=' + MGR.list().length);

  // ===================== Browser Agent (Step 1) =====================
  let tId = MGR.dispatch('agent.browser', { op: 'navigate', url: 'https://example.com' });
  let r = await waitFor('agent.browser', tId);
  check('Browser Agent navigate() still works', r.ok && r.live, JSON.stringify(r));

  tId = MGR.dispatch('agent.browser', { op: 'bookmark' });
  r = await waitFor('agent.browser', tId);
  check('Browser Agent bookmark()', r.ok, JSON.stringify(r));

  tId = MGR.dispatch('agent.browser', { op: 'bookmarks-list' });
  r = await waitFor('agent.browser', tId);
  check('Browser Agent bookmarks-list()', r.ok && Array.isArray(r.result), JSON.stringify(r));

  tId = MGR.dispatch('agent.browser', { op: 'history-list' });
  r = await waitFor('agent.browser', tId);
  check('Browser Agent history-list()', r.ok && Array.isArray(r.result), JSON.stringify(r));

  tId = MGR.dispatch('agent.browser', { op: 'reading-mode' });
  r = await waitFor('agent.browser', tId);
  check('Browser Agent reading-mode()', r.ok && r.result && r.result.text.length > 0, JSON.stringify(r));

  tId = MGR.dispatch('agent.browser', { op: 'summarize-page' });
  r = await waitFor('agent.browser', tId);
  check('Browser Agent summarize-page()', r.ok && r.result && r.result.summary, JSON.stringify(r));

  tId = MGR.dispatch('agent.browser', { op: 'extract-links' });
  r = await waitFor('agent.browser', tId);
  check('Browser Agent extract-links()', r.ok && r.result.count === 2, JSON.stringify(r));

  tId = MGR.dispatch('agent.browser', { op: 'extract-images' });
  r = await waitFor('agent.browser', tId);
  check('Browser Agent extract-images()', r.ok && r.result.count === 1, JSON.stringify(r));

  // ===================== Memory Agent (Step 2) =====================
  tId = MGR.dispatch('agent.memory', { op: 'remember', note: 'User prefers dark mode', tags: ['ui'] });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent remember() still works', r.ok && r.result.note.includes('dark mode'), JSON.stringify(r));
  const memId = r.result.id;

  tId = MGR.dispatch('agent.memory', { op: 'pin', id: memId });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent pin()', r.ok && r.result.pinned === true, JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'list-pinned' });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent list-pinned()', r.ok && r.result.length === 1, JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'categorize', id: memId, category: 'preferences' });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent categorize()', r.ok && r.result.category === 'preferences', JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'list-categories' });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent list-categories()', r.ok && r.result.some(c => c.category === 'preferences'), JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'semantic-recall', query: 'dark mode preference' });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent semantic-recall()', r.ok && r.result.length >= 1 && r.result[0].relevance > 0, JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'short-term-remember', note: 'ephemeral note' });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent short-term-remember()', r.ok && r.result.note === 'ephemeral note', JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'short-term-recall' });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent short-term-recall()', r.ok && r.result.length === 1, JSON.stringify(r));

  // ===================== Planner Agent (Step 3) =====================
  tId = MGR.dispatch('agent.planner', { op: 'create-plan', goal: 'Ship Milestone 6', steps: ['Design', 'Implement', 'Test'] });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent create-plan() still works', r.ok && r.result.steps.length === 3, JSON.stringify(r));
  const planId = r.result.id;
  const stepA = r.result.steps[0].id;
  const stepB = r.result.steps[1].id;

  tId = MGR.dispatch('agent.planner', { op: 'add-subtask', planId, parentStepId: stepA, title: 'Draft wireframes' });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent add-subtask()', r.ok && r.result.parentId === stepA, JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'set-deadline', planId, stepId: stepA, dueAt: Date.now() + 3600000 });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent set-deadline()', r.ok && typeof r.result.deadline === 'number', JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'add-dependency', planId, stepId: stepB, dependsOnStepId: stepA });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent add-dependency()', r.ok && r.result.dependsOn.includes(stepA), JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'complete-checked', planId, stepId: stepB });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent complete-checked() blocks on open dependency', r.ok && r.result.blocked === true, JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'complete', planId, stepId: stepA });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent complete() dependency step', r.ok && r.result.status === 'done', JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'complete-checked', planId, stepId: stepB });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent complete-checked() proceeds once unblocked', r.ok && r.result.status === 'done', JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'execution-log', planId });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent execution-log() recorded status changes', r.ok && r.result.length >= 2, JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'create-goal', goal: 'Launch v2', targetDate: '2026-12-01' });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent create-goal()', r.ok && r.result.type === 'goal', JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'daily-plan' });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent daily-plan()', r.ok && Array.isArray(r.result.steps), JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'weekly-plan' });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent weekly-plan()', r.ok && Array.isArray(r.result.steps), JSON.stringify(r));

  // ===================== File Agent (Step 4) =====================
  tId = MGR.dispatch('agent.file', { op: 'summarize', file: { name: 'report.pdf' } });
  r = await waitFor('agent.file', tId);
  check('File Agent summarize() still works', r.ok && r.result.summary.includes('Extracted text'), JSON.stringify(r));

  tId = MGR.dispatch('agent.file', { op: 'pass', targetAgent: 'agent.vision', file: { name: 'diagram.png' } });
  r = await waitFor('agent.file', tId);
  check('File Agent pass() hands off (agent collaboration intact)', r.ok && r.result.handedOffTo === 'agent.vision', JSON.stringify(r));

  const jsonExt = window.FileProcessing.extractText ? true : true; // extractJson lives in file-processing.js itself
  const fpSrc = fs.readFileSync(path.join(AI, 'file-processing.js'), 'utf8');
  check('File Agent format support includes JSON (Step 4)', /extractJson/.test(fpSrc) && /ext === .json./.test(fpSrc), 'checked file-processing.js source');

  // ===================== Research Agent (Step 5) =====================
  tId = MGR.dispatch('agent.research', { op: 'collect-sources', query: 'notes' });
  r = await waitFor('agent.research', tId);
  check('Research Agent collect-sources()', r.ok && r.result && Array.isArray(r.result.docResults), JSON.stringify(r));

  tId = MGR.dispatch('agent.research', { op: 'store-findings', query: 'notes', topic: 'AXIOM notes' });
  r = await waitFor('agent.research', tId);
  check('Research Agent store-findings() writes to Memory (reuse, not duplication)', r.ok && memStore.some(m => m.note.includes('AXIOM notes')), JSON.stringify(r));

  tId = MGR.dispatch('agent.research', { op: 'action-items', topic: 'AXIOM notes', items: ['Read the notes', 'Summarize for the team'] });
  r = await waitFor('agent.research', tId);
  check('Research Agent action-items() writes to Planner (reuse, not duplication)', r.ok && window.AxiomPlanner.listPlans().some(p => p.goal.includes('AXIOM notes')), JSON.stringify(r));

  // ===================== Voice Agent (Step 6) =====================
  check('Voice adapter kit registered a default STT + TTS adapter', window.AxiomVoiceAdapters.listProviders().stt.includes('browser') && window.AxiomVoiceAdapters.listProviders().tts.includes('browser'), JSON.stringify(window.AxiomVoiceAdapters.listProviders()));

  tId = MGR.dispatch('agent.voice', { op: 'route-voice-command', text: 'remember I like tea' });
  r = await waitFor('agent.voice', tId);
  check('Voice Agent route-voice-command() reuses the Task Router', r.ok && r.decision.agents[0].agentId === 'agent.memory', JSON.stringify(r));

  // ===================== Vision Agent (Step 7) =====================
  check('Vision adapter kit registered the file-processing OCR adapter', window.AxiomVisionAdapters.listProviders().ocr.includes('file-processing'), JSON.stringify(window.AxiomVisionAdapters.listProviders()));

  tId = MGR.dispatch('agent.vision', { op: 'ocr', file: { name: 'scan.png' } });
  r = await waitFor('agent.vision', tId);
  check('Vision Agent ocr() via adapter kit reuses FileProcessing', r.ok && r.text.includes('OCR text'), JSON.stringify(r));

  tId = MGR.dispatch('agent.vision', { op: 'send-to-file-agent', visionResult: { text: 'hello' }, meta: { op: 'organize' } });
  r = await waitFor('agent.vision', tId);
  check('Vision Agent send-to-file-agent() collaborates via structured dispatch', r.ok && !!r.dispatchedTaskId, JSON.stringify(r));

  // ===================== Coding Agent (Step 8) =====================
  tId = MGR.dispatch('agent.coding', { op: 'project-search', query: 'app' });
  r = await waitFor('agent.coding', tId);
  check('Coding Agent project-search()', r.ok && r.result.some(f => f.filename === 'src/app.js'), JSON.stringify(r));

  tId = MGR.dispatch('agent.coding', { op: 'project-analysis' });
  r = await waitFor('agent.coding', tId);
  check('Coding Agent project-analysis()', r.ok && r.result.total === 3, JSON.stringify(r));

  tId = MGR.dispatch('agent.coding', { op: 'refactor', code: 'function f(){}' });
  r = await waitFor('agent.coding', tId);
  check('Coding Agent refactor() never auto-applies', r.ok && r.result.requiresConfirmation === true && r.result.applied === false, JSON.stringify(r));

  tId = MGR.dispatch('agent.coding', { op: 'bug-investigation', description: 'app.js throws on load' });
  r = await waitFor('agent.coding', tId);
  check('Coding Agent bug-investigation() is read-only (candidate files only)', r.ok && Array.isArray(r.result.candidateFiles), JSON.stringify(r));

  // ===================== Multi-agent workflows (Step 9) =====================
  const researchDecision = window.AxiomTaskRouter.route('Research React');
  check('Router still flags "research X" as the researchAndRemember workflow', researchDecision.agents[0].workflow === 'researchAndRemember', JSON.stringify(researchDecision));

  const devDecision = window.AxiomTaskRouter.route('investigate this bug in the login flow');
  check('Router flags bug investigation as the developmentWorkflow', devDecision.agents[0].workflow === 'developmentWorkflow', JSON.stringify(devDecision));

  const docDecision = window.AxiomTaskRouter.route('process this document for me');
  check('Router flags document processing as the documentWorkflow', docDecision.agents[0].workflow === 'documentWorkflow', JSON.stringify(docDecision));

  const devResult = await window.AxiomWorkflows.developmentWorkflow('app.js throws on load');
  check('Development workflow completes end-to-end (Coding -> Browser -> Planner -> Assistant)', devResult.ok && devResult.plan, JSON.stringify(devResult));

  const docResult = await window.AxiomWorkflows.documentWorkflow({ name: 'report.pdf' });
  check('Document workflow completes end-to-end (File -> Memory -> Assistant)', docResult.ok && docResult.memory, JSON.stringify(docResult));

  const compound = window.AxiomTaskRouter.route('research the topic then generate code for it');
  check('Compound multi-agent request still dispatches to several agents (no regression)', compound.agents.length >= 2 && !compound.agents[0].workflow, JSON.stringify(compound));

  // ===================== Error handling / graceful failure (Step 10) =====================
  tId = MGR.dispatch('agent.memory', { op: 'not-a-real-op' });
  r = await waitFor('agent.memory', tId);
  check('Unsupported op still fails gracefully (no crash)', r.ok === false && /Unsupported/.test(r.error), JSON.stringify(r));

  const passed = results.filter(r => r.pass).length;
  console.log('\n=== MILESTONE 6 VERIFICATION ===');
  results.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   -> ' + r.detail)));
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
