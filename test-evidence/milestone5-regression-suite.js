const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const AI = require('path').join(__dirname, '..');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/os-shell.html',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true
});
const { window } = dom;

// Stub subsystems the runtime touches so this test focuses on Milestone 5
// logic itself, not unrelated backends (Supabase, real network, etc).
let memStore = []; // {id, note, tags, created_at}
let idSeq = 1;
window.AxiomAgents = {
  remember: async (agentId, note, tags) => {
    const row = { id: 'm' + (idSeq++), note, tags: tags || [], created_at: new Date().toISOString() };
    memStore.push(row);
    return row;
  },
  getMemoryNotes: async (agentId, limit) => memStore.slice(-1 * (limit || 8)).reverse(),
  recentMemories: async (agentId, limit) => memStore.slice(-1 * (limit || 8)).reverse(),
  searchMemories: async (agentId, query) => memStore.filter(m => m.note.includes(query)),
  updateMemory: async (id, patch) => {
    const row = memStore.find(m => m.id === id);
    if (!row) throw new Error('not found');
    if (patch.note) row.note = patch.note;
    if (patch.tags) row.tags = patch.tags;
    return row;
  },
  tagMemory: async (id, tags) => window.AxiomAgents.updateMemory(id, { tags }),
  deleteMemory: async (id) => { memStore = memStore.filter(m => m.id !== id); return true; },
  runTool: async (name, args) => {
    if (name === 'workspace_search') {
      return [
        { id: 'f1', filename: 'notes.pdf', kind: 'document' },
        { id: 'f2', filename: 'diagram.png', kind: 'image' }
      ].filter(f => !args.query || f.filename.includes(args.query));
    }
    throw new Error('unknown tool ' + name);
  }
};
window.FileProcessing = {
  extractText: async (file) => 'Extracted text content for ' + (file && file.name)
};

function load(rel) {
  const code = fs.readFileSync(path.join(AI, rel), 'utf8');
  window.eval(code);
}

// Same load order as the HTML pages, capability files inserted right
// after agent-definitions.js (matches the actual <script> edits made).
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
load('os/runtime/capabilities/workflows.js');
load('os/runtime/task-router.js');
load('os/runtime/agent-manager.js');
load('os/runtime/runtime-bootstrap.js');

// Fake same-window browser workspace (AxiomBrowserLive) so the Browser
// Agent has something real to drive without needing an actual iframe.
window.AxiomBrowserLive = {
  navigate: (url) => { window.__lastNav = url; },
  search: (q) => { window.__lastNav = 'search:' + q; },
  goBack: () => {}, goForward: () => {}, refresh: () => {},
  newTab: () => {}, switchTab: () => {}, closeTab: () => {}, toggleBookmark: () => {},
  getSnapshot: () => ({ url: window.__lastNav, blocked: false, tabs: [] })
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

  // 1. Milestone 4 self-test still passes (no regression).
  await new Promise((r) => setTimeout(r, 20));
  const selfTest = await window.AxiomRuntime.selfTest();
  check('Milestone 4 self-test still passes', selfTest && selfTest.ok, JSON.stringify(selfTest && selfTest.results.filter(r => !r.pass)));

  // 2. Browser Agent: navigate via bridge
  let tId = MGR.dispatch('agent.browser', { op: 'navigate', url: 'https://example.com' });
  let r = await waitFor('agent.browser', tId);
  check('Browser Agent navigate()', r.ok && r.live && window.__lastNav === 'https://example.com', JSON.stringify(r));

  // 3. Browser Agent: search
  tId = MGR.dispatch('agent.browser', { op: 'search', query: 'axiom os' });
  r = await waitFor('agent.browser', tId);
  check('Browser Agent search()', r.ok && window.__lastNav === 'search:axiom os', JSON.stringify(r));

  // 4. Memory Agent: remember + recall + search + tag + update + delete
  tId = MGR.dispatch('agent.memory', { op: 'remember', note: 'User prefers dark mode', tags: ['ui'] });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent remember()', r.ok && r.result && r.result.note === 'User prefers dark mode', JSON.stringify(r));
  const memId = r.result.id;

  tId = MGR.dispatch('agent.memory', { op: 'recall' });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent recall()', r.ok && Array.isArray(r.result) && r.result.length >= 1, JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'search', query: 'dark mode' });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent search()', r.ok && r.result.length === 1, JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'tag', id: memId, tags: ['ui', 'preference'] });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent tag()', r.ok && r.result.tags.includes('preference'), JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'update', id: memId, note: 'User strongly prefers dark mode' });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent update()', r.ok && r.result.note.includes('strongly'), JSON.stringify(r));

  tId = MGR.dispatch('agent.memory', { op: 'delete', id: memId });
  r = await waitFor('agent.memory', tId);
  check('Memory Agent delete()', r.ok && r.result.deleted === memId, JSON.stringify(r));

  // 5. Planner Agent: create-plan, add-step, prioritize, complete, progress
  tId = MGR.dispatch('agent.planner', { op: 'create-plan', goal: 'Ship Milestone 5', steps: ['Design', 'Implement', 'Test'] });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent create-plan()', r.ok && r.result.steps.length === 3, JSON.stringify(r));
  const planId = r.result.id;
  const stepId = r.result.steps[0].id;

  tId = MGR.dispatch('agent.planner', { op: 'add-step', planId, title: 'Ship it' });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent add-step()', r.ok && r.result.title === 'Ship it', JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'complete', planId, stepId });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent complete()', r.ok && r.result.status === 'done', JSON.stringify(r));

  tId = MGR.dispatch('agent.planner', { op: 'progress', planId });
  r = await waitFor('agent.planner', tId);
  check('Planner Agent progress()', r.ok && r.result.done === 1, JSON.stringify(r));

  // 6. File Agent: summarize, search, organize, pass
  tId = MGR.dispatch('agent.file', { op: 'summarize', file: { name: 'report.pdf' } });
  r = await waitFor('agent.file', tId);
  check('File Agent summarize()', r.ok && r.result.summary.includes('Extracted text'), JSON.stringify(r));

  tId = MGR.dispatch('agent.file', { op: 'search', query: 'notes' });
  r = await waitFor('agent.file', tId);
  check('File Agent search()', r.ok && r.result.length === 1 && r.result[0].filename === 'notes.pdf', JSON.stringify(r));

  tId = MGR.dispatch('agent.file', { op: 'organize' });
  r = await waitFor('agent.file', tId);
  check('File Agent organize()', r.ok && r.result.total === 2 && r.result.byKind.document && r.result.byKind.image, JSON.stringify(r));

  tId = MGR.dispatch('agent.file', { op: 'pass', targetAgent: 'agent.vision', file: { name: 'diagram.png' } });
  r = await waitFor('agent.file', tId);
  check('File Agent pass() hands off', r.ok && r.result.handedOffTo === 'agent.vision', JSON.stringify(r));

  // 7. Error handling: unsupported op fails gracefully (no throw / crash)
  tId = MGR.dispatch('agent.memory', { op: 'not-a-real-op' });
  r = await waitFor('agent.memory', tId);
  check('Unsupported op fails gracefully (no crash)', r.ok === false && /Unsupported/.test(r.error), JSON.stringify(r));

  // 8. Cancellation: queue two tasks, cancel the second before it runs
  const busyAgent = MGR.get('agent.memory');
  const keepId = MGR.dispatch('agent.memory', { op: 'recall' });
  const cancelTaskId = 'cancel-target-' + Date.now();
  MGR.dispatch('agent.memory', { id: cancelTaskId, op: 'recall' });
  const cancelled = MGR.cancel('agent.memory', cancelTaskId);
  check('Manager can cancel a queued task', cancelled === true, 'cancel() returned ' + cancelled);
  await waitFor('agent.memory', keepId); // drain the queue cleanly

  // 9. Multi-agent collaboration workflow: "research X"
  const decision = window.AxiomTaskRouter.route('Research React');
  check('Router flags research as a workflow hop', decision.agents[0].workflow === 'researchAndRemember', JSON.stringify(decision));

  const workflowResult = await window.AxiomWorkflows.researchAndRemember('Research React');
  check('Collaboration workflow completes end-to-end', workflowResult.ok && workflowResult.memory && workflowResult.plan, JSON.stringify(workflowResult));
  check('Workflow stored a memory about the topic', memStore.some(m => m.note.includes('React')), JSON.stringify(memStore));

  // Compound multi-agent (non-workflow) requests still dispatch to several agents
  const compound = window.AxiomTaskRouter.route('research the topic then generate code for it');
  check('Compound request still multi-dispatches (no workflow regression)', compound.agents.length >= 2 && !compound.agents[0].workflow, JSON.stringify(compound));

  const passed = results.filter(r => r.pass).length;
  console.log('\n=== MILESTONE 5 VERIFICATION ===');
  results.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   -> ' + r.detail)));
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

main().then(()=>process.exit(0)).catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
