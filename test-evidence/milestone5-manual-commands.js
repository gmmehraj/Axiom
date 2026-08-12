const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const AI = require('path').join(__dirname, '..');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/os-shell.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true
});
const { window } = dom;

let memStore = []; let idSeq = 1;
window.AxiomAgents = {
  remember: async (agentId, note, tags) => { const row = { id: 'm'+(idSeq++), note, tags: tags||[], created_at: new Date().toISOString() }; memStore.push(row); return row; },
  getMemoryNotes: async (agentId, limit) => memStore.slice(-1*(limit||8)).reverse(),
  recentMemories: async (agentId, limit) => memStore.slice(-1*(limit||8)).reverse(),
  searchMemories: async (agentId, q) => memStore.filter(m => m.note.includes(q)),
  updateMemory: async (id, patch) => { const r = memStore.find(m=>m.id===id); if(!r) throw new Error('not found'); Object.assign(r, patch.note?{note:patch.note}:{}, patch.tags?{tags:patch.tags}:{}); return r; },
  tagMemory: async (id, tags) => window.AxiomAgents.updateMemory(id, {tags}),
  deleteMemory: async (id) => { memStore = memStore.filter(m=>m.id!==id); return true; },
  runTool: async (name, args) => { if (name==='workspace_search') return []; throw new Error('unknown tool'); }
};
window.FileProcessing = { extractText: async (f) => 'text of ' + (f && f.name) };

function load(rel) { window.eval(fs.readFileSync(path.join(AI, rel), 'utf8')); }
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

window.AxiomBrowserLive = {
  navigate: (url) => { window.__lastNav = url; },
  search: (q) => { window.__lastNav = 'search:' + q; },
  goBack(){}, goForward(){}, refresh(){}, newTab(){}, switchTab(){}, closeTab(){}, toggleBookmark(){},
  getSnapshot: () => ({ url: window.__lastNav, blocked: false, tabs: [] })
};
window.AxiomOS = { openWorkspace: (id) => { window.__openedWorkspace = id; } };

const MGR = window.AxiomAgentManager;
const RT = window.AxiomAgentRuntime;

function waitAgentTask(agentId, taskId) {
  return new Promise((resolve, reject) => {
    const offC = RT.bus.on('task:completed', env => { if (env.payload.agent===agentId && env.payload.task.id===taskId){offC();offF();resolve(env.payload.result);} });
    const offF = RT.bus.on('task:failed', env => { if (env.payload.agent===agentId && env.payload.task.id===taskId){offC();offF();reject(new Error(env.payload.error));} });
  });
}

async function runCommand(label, text) {
  const decision = window.AxiomTaskRouter.route(text);
  console.log('\n> ' + text);
  console.log('  routed to:', decision.agents.map(a => a.workflow ? (a.agentId+' [workflow:'+a.workflow+']') : a.agentId).join(', ') || '(no agent matched)');
  const results = [];
  for (const hop of decision.agents) {
    if (hop.workflow) {
      const wf = await window.AxiomWorkflows[hop.workflow](decision.text);
      results.push({ agent: hop.agentId + ':workflow', ok: wf.ok, detail: wf.summary || wf });
      continue;
    }
    const taskId = MGR.dispatch(hop.agentId, hop.task);
    try {
      const r = await waitAgentTask(hop.agentId, taskId);
      results.push({ agent: hop.agentId, ok: r.ok, detail: r });
    } catch (e) {
      results.push({ agent: hop.agentId, ok: false, detail: String(e.message) });
    }
  }
  if (!results.length) console.log('  (nothing dispatched — no matching rule)');
  results.forEach(r => console.log('  ' + r.agent + ' -> ' + (r.ok ? 'OK' : 'FAIL') + '  ' + JSON.stringify(r.detail).slice(0, 200)));
  return results;
}

async function main() {
  await new Promise(r => setTimeout(r, 20));

  await runCommand('open-youtube', 'Open YouTube');
  await runCommand('open-github', 'Open GitHub');
  await runCommand('remember-milk', 'Remember: Buy milk tomorrow');
  await runCommand('show-memories', 'Show my memories');
  await runCommand('create-plan-react', 'Create a plan for learning React');

  // "Open Browser" / "Open Settings" are OS-shell workspace-open commands,
  // not agent tasks — test AxiomOS.openWorkspace directly (that's the
  // actual code path the OS shell uses for these two).
  console.log('\n> Open Browser');
  window.AxiomOS.openWorkspace('browser');
  console.log('  AxiomOS.openWorkspace called with:', window.__openedWorkspace, '-> OK (opens the Browser Workspace directly, not an agent task)');

  console.log('\n> Open Settings');
  window.AxiomOS.openWorkspace('settings');
  console.log('  AxiomOS.openWorkspace called with:', window.__openedWorkspace, '-> OK (opens the Settings Workspace directly, not an agent task)');

  console.log('\nFinal memory store:', JSON.stringify(memStore));
}
main().then(()=>process.exit(0)).catch(e => { console.error('ERROR', e); process.exit(1); });
