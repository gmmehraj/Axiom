// ============================================================
// AXIOM — Block 2 / Step 1 / Part 2: AI execution pipeline regression
// ------------------------------------------------------------
// Loads the real, unmodified agent-runtime.js / coding-agent.js /
// coding-toolkit.js / capability-kit.js / agent-manager.js via jsdom
// and drives them exactly as the app does. This suite is additive to
// block2-step1-coding-agent-regression-suite.js (Part 1) and covers
// the reliability work done in Part 2:
//
//   - request validation (oversized prompt rejected before any network call)
//   - a hung stream is actually timed out (not left pending forever)
//   - transient failures are retried, but a cancellation is never retried
//   - token usage is estimated and tracked cumulatively on the agent
//   - conversation context (system + history) reaches the model
//   - state always returns to idle, exactly once, no duplicate responses
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

function load(rel) { window.eval(fs.readFileSync(path.join(AI, rel), 'utf8')); }
load('os/runtime/agent-runtime.js');
load('os/runtime/agent-definitions/_shared.js');
load('os/runtime/agent-definitions/coding-agent.js');
load('os/runtime/agent-definitions/_assemble.js');
load('os/runtime/capabilities/capability-kit.js');
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
  await new Promise((r) => setTimeout(r, 20));

  const bus = window.AxiomAgentRuntime.bus;
  const agent = MGR.get('agent.coding');

  // -- 1. Request validation: an oversized prompt is rejected before any network call --
  let liveCalls = 0;
  window.OpenRouter = {
    streamChat({ onDone }) { liveCalls++; setTimeout(() => onDone('should not be reached', false), 10); }
  };
  let tId = MGR.dispatch('agent.coding', { prompt: 'x'.repeat(20001) });
  let r = await waitFor(bus, 'agent.coding', tId);
  check('oversized prompt is rejected without ever calling the client', r.ok === false && /exceeds the .*character limit/.test(r.error), JSON.stringify(r));
  check('no network call was made for the rejected request', liveCalls === 0, 'liveCalls=' + liveCalls);
  check('agent is idle after a validation rejection (no wedge)', agent.status === 'idle', 'status=' + agent.status);

  // -- 2. A hung stream (never calls onDone/onError) is timed out, not left pending forever --
  window.OpenRouter = {
    streamChat() { /* never calls onDone or onError — simulates a dead connection */ }
  };
  tId = MGR.dispatch('agent.coding', { prompt: 'hang please', op: 'generate', timeoutMs: 500 });
  r = await Promise.race([
    waitFor(bus, 'agent.coding', tId),
    new Promise((resolve) => setTimeout(() => resolve({ __timedOutWaiting: true }), 4000))
  ]);
  check('a hung stream is timed out (request-level timeoutMs honored) instead of waiting forever', !r.__timedOutWaiting, 'test harness itself timed out waiting for the task to settle');
  if (!r.__timedOutWaiting) {
    check('hung-stream task fails cleanly rather than crashing', r.ok === false, JSON.stringify(r));
  }

  // -- 3. Transient failures are retried; a cancellation is never retried --
  let attempts = 0;
  window.OpenRouter = {
    streamChat({ onDone, onError }) {
      attempts++;
      if (attempts < 2) { setTimeout(() => onError(new Error('transient network blip')), 5); return; }
      setTimeout(() => onDone('recovered after retry', false), 5);
    }
  };
  tId = MGR.dispatch('agent.coding', { prompt: 'retry me', op: 'generate' });
  r = await waitFor(bus, 'agent.coding', tId);
  check('a transient failure is retried and the task still succeeds', r.ok === true && attempts > 1 && /recovered after retry/.test(r.code), 'attempts=' + attempts + ' ' + JSON.stringify(r));

  let cancelAttempts = 0;
  window.OpenRouter = {
    streamChat({ signal, onDone }) {
      cancelAttempts++;
      const t = setTimeout(() => onDone('should not arrive', false), 500);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); onDone('', true); });
    }
  };
  tId = agent.enqueue({ prompt: 'cancel me', op: 'generate' });
  await new Promise((r2) => setTimeout(r2, 20));
  agent.cancelCurrent();
  r = await waitFor(bus, 'agent.coding', tId);
  check('a cancelled request is never retried', cancelAttempts === 1, 'cancelAttempts=' + cancelAttempts);
  check('a cancelled request resolves as cancelled', r.ok === false && r.cancelled === true, JSON.stringify(r));

  // -- 4. Token usage is estimated and tracked cumulatively on the agent --
  window.OpenRouter = {
    streamChat({ onDone }) { setTimeout(() => onDone('a modestly sized response for token estimation purposes', false), 5); }
  };
  const beforeTotal = (agent.stats.tokens && agent.stats.tokens.total) || 0;
  tId = MGR.dispatch('agent.coding', { prompt: 'estimate my tokens please', op: 'generate' });
  r = await waitFor(bus, 'agent.coding', tId);
  check('generate result carries an estimated usage figure', r.ok && r.usage && r.usage.totalTokens > 0, JSON.stringify(r.usage));
  check('agent cumulative token stats increase after a completed request', agent.stats.tokens && agent.stats.tokens.total > beforeTotal, JSON.stringify(agent.stats.tokens));

  // -- 5. Conversation context (system + history) reaches the model --
  let seenMessages = null;
  window.OpenRouter = {
    streamChat({ messages, onDone }) { seenMessages = messages; setTimeout(() => onDone('ok', false), 5); }
  };
  tId = MGR.dispatch('agent.coding', {
    prompt: 'and then what?',
    op: 'generate',
    system: 'You are a terse coding assistant.',
    history: [{ role: 'user', content: 'write a for loop' }, { role: 'assistant', content: 'for (...) {}' }]
  });
  r = await waitFor(bus, 'agent.coding', tId);
  check('system + history + latest prompt all reach the client in order', !!seenMessages
    && seenMessages[0].role === 'system'
    && seenMessages[1].content === 'write a for loop'
    && seenMessages[2].content === 'for (...) {}'
    && seenMessages[3].content === 'and then what?', JSON.stringify(seenMessages));

  // -- 6. State always returns to idle, exactly once, no duplicate responses, after a burst --
  window.OpenRouter = {
    streamChat({ onDone }) { setTimeout(() => onDone('burst reply', false), Math.random() * 20); }
  };
  const ids = [1, 2, 3, 4].map(n => agent.enqueue({ prompt: 'burst ' + n, op: 'generate' }));
  let completions = 0;
  const offCount = bus.on('task:completed', (env) => { if (env.source === 'agent.coding' && ids.includes(env.payload.task.id)) completions++; });
  await Promise.all(ids.map(id => waitFor(bus, 'agent.coding', id)));
  offCount();
  check('every burst task completes exactly once (no duplicate responses)', completions === 4, 'completions=' + completions);
  check('agent settles back to idle after a burst', agent.status === 'idle', 'status=' + agent.status);

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : '\n' + fails + ' CHECK(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
}

main();
