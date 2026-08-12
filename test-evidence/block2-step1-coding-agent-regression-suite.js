// ============================================================
// AXIOM — Block 2 / Step 1: Coding Agent stabilization regression
// ------------------------------------------------------------
// Loads the real, unmodified agent-runtime.js / coding-agent.js /
// coding-toolkit.js / agent-manager.js via jsdom (headless, no browser)
// and drives them exactly the way a real page does. Mocks only
// window.OpenRouter (the actual client the app loads — NOT the
// window.OpenRouterClient / window.AxiomOpenRouter names the old code
// incorrectly looked for) and window.ModelSelector, so this exercises
// OUR code against a realistic client shape, not the network.
//
// This complements milestone6-regression-suite.js, which already covers
// project-search / project-analysis / refactor-never-auto-applies /
// bug-investigation-read-only with NO client configured. This suite
// covers the opposite, previously-broken case: a client IS available,
// and generate / explain-code / cancellation should actually reach it.
// ============================================================
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const AI = path.join(__dirname, '..');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/playground.html',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true
});
const { window } = dom;

window.AxLogger = { warn(){}, error(){}, info(){}, debug(){} };
window.ModelSelector = { getSelectedModel: () => 'openai/gpt-4o-mini' };

let liveCallCount = 0;
window.OpenRouter = {
  streamChat({ model, messages, signal, onDone, onError }) {
    liveCallCount++;
    if (!model) { onError(new Error('no model')); return; }
    setTimeout(() => {
      if (signal && signal.aborted) { onDone('', true); return; }
      onDone('mock reply to: ' + messages[messages.length - 1].content.slice(0, 30), false);
    }, 30);
  }
};

function load(rel) { window.eval(fs.readFileSync(path.join(AI, rel), 'utf8')); }
load('os/runtime/agent-runtime.js');
load('os/runtime/agent-definitions/_shared.js');
load('os/runtime/agent-definitions/coding-agent.js');
load('os/runtime/agent-definitions/_assemble.js');
load('os/runtime/capabilities/coding-toolkit.js');
load('os/runtime/agent-manager.js');

let fails = 0;
function check(label, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + ' ' + label + (cond ? '' : '  -> ' + detail));
  if (!cond) fails++;
}

function waitFor(bus, agentId, taskId) {
  return new Promise((resolve) => {
    const off = bus.on('*', (env) => {
      if ((env.type === 'task:completed' || env.type === 'task:failed') && env.source === agentId && env.payload.task.id === taskId) {
        off();
        resolve(env.payload.result || { ok: false, error: env.payload.error });
      }
    });
  });
}

async function main() {
  const MGR = window.AxiomAgentManager;
  MGR.register(window.AxiomAgentDefinitions[0]); // agent.coding is the only spec loaded here
  MGR.start();
  await new Promise((r) => setTimeout(r, 20)); // let init() settle to idle

  const bus = window.AxiomAgentRuntime.bus;

  // -- 1. Coding Agent initializes correctly --------------------------
  const agent = MGR.get('agent.coding');
  check('Coding Agent registered and reachable via manager', !!agent, 'agent.get returned ' + agent);
  check('Coding Agent reaches idle after init (not stuck initializing/offline)', agent.status === 'idle', 'status=' + agent.status);

  // -- 2. generate op now reaches the real client (previously always the canned note) --
  let tId = MGR.dispatch('agent.coding', { prompt: 'write a hello world function' });
  let r = await waitFor(bus, 'agent.coding', tId);
  check('generate op returns a live result via the real client', r.ok && r.live === true && /mock reply/.test(r.code), JSON.stringify(r));
  check('exactly one underlying client call for one task (no duplicate calls)', liveCallCount === 1, 'liveCallCount=' + liveCallCount);
  check('agent returns to idle after completing (no wedge)', agent.status === 'idle', 'status=' + agent.status);

  // -- 3. explain-code op reaches the same client (previously always threw) --
  tId = MGR.dispatch('agent.coding', { op: 'explain-code', code: 'function f(){return 1;}' });
  r = await waitFor(bus, 'agent.coding', tId);
  check('explain-code op succeeds via the real client', r.ok && r.result && /mock reply/.test(r.result.explanation), JSON.stringify(r));

  // -- 4. two tasks queued back-to-back never run concurrently (no overlap) --
  let concurrent = 0, maxConcurrent = 0;
  const prevStreamChat = window.OpenRouter.streamChat;
  window.OpenRouter.streamChat = function (opts) {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    const inner = { ...opts, onDone: (t, a) => { concurrent--; opts.onDone(t, a); } };
    return prevStreamChat(inner);
  };
  const idA = agent.enqueue({ prompt: 'task A' });
  const idB = agent.enqueue({ prompt: 'task B' });
  await Promise.all([waitFor(bus, 'agent.coding', idA), waitFor(bus, 'agent.coding', idB)]);
  check('queued tasks never overlap (max 1 concurrent client call)', maxConcurrent === 1, 'maxConcurrent=' + maxConcurrent);
  window.OpenRouter.streamChat = prevStreamChat;

  // -- 5. cancellation actually aborts the in-flight request (not just cosmetic) --
  window.OpenRouter.streamChat = function ({ signal, onDone }) {
    const t = setTimeout(() => onDone('should not arrive if cancelled', false), 500);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); onDone('', true); });
  };
  tId = agent.enqueue({ prompt: 'a long task' });
  await new Promise((r2) => setTimeout(r2, 20)); // let it start (status -> working)
  const hadCurrent = agent.cancelCurrent();
  r = await waitFor(bus, 'agent.coding', tId);
  check('cancelCurrent() found an in-flight task to flag', hadCurrent === true, 'hadCurrent=' + hadCurrent);
  check('cancelled in-flight generate resolves as cancelled, not a stale result', r.ok === false && r.cancelled === true, JSON.stringify(r));

  // -- 6. missing-client pages still degrade gracefully (no throw, no crash) --
  const savedClient = window.OpenRouter;
  delete window.OpenRouter;
  tId = MGR.dispatch('agent.coding', { op: 'explain-code', code: 'x' });
  r = await waitFor(bus, 'agent.coding', tId);
  check('explain-code with no client fails cleanly (no crash) instead of throwing unhandled', r.ok === false && /model client is available/.test(r.error), JSON.stringify(r));
  window.OpenRouter = savedClient;

  // -- 7. unsupported op still fails gracefully --
  tId = MGR.dispatch('agent.coding', { op: 'not-a-real-op' });
  r = await waitFor(bus, 'agent.coding', tId);
  check('unsupported op fails gracefully (no crash)', r.ok === false && /Unsupported coding op/.test(r.error), JSON.stringify(r));

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : '\n' + fails + ' CHECK(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
}

main();
