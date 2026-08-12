// ============================================================
// AXIOM — Block 2 / Step 2 / Part 2: Brain <-> AI integration regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/axiom-brain.js and
// js/core/ai-state-manager.js and drives them with the SAME event shapes
// the real runtime produces (axiom:agent-event envelopes mirroring the
// Agent Event Bus, axiom:model-changed from model-selector.js,
// AxiomAIState.setState() for the activity/error path) — then asserts
// AxiomBrain ends up with the right state, with no direct shortcuts into
// AxiomBrain itself.
//
// No jsdom import: this sandbox has no network access to install it, so
// this suite uses a small hand-rolled DOM/window shim (EventTarget-style
// addEventListener/dispatchEvent, an in-memory localStorage, a minimal
// CustomEvent) via Node's vm module instead. It exercises the exact same
// files, unmodified, that ship in the project — only the browser
// environment around them is stubbed.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const AI = path.join(__dirname, '..');

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    },
    dispatchEvent(evt) {
      const set = listeners.get(evt.type);
      if (set) set.forEach((fn) => { try { fn(evt); } catch (e) { /* isolated, matches real bus semantics */ } });
      return true;
    }
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

class FakeCustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init && Object.prototype.hasOwnProperty.call(init, 'detail') ? init.detail : null;
  }
}

// ---- Build the sandbox ("window" is self-referential, as in real browsers) --
const sandbox = {};
const docTarget = makeEventTarget();
sandbox.document = Object.assign(docTarget, {
  documentElement: { setAttribute() {}, getAttribute() { return null; } },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {} }),
  readyState: 'complete'
});
sandbox.localStorage = makeLocalStorage();
sandbox.CustomEvent = FakeCustomEvent;
sandbox.console = console;
sandbox.Object = Object;
// unref every timer so this test exits promptly instead of being held
// open by axiom-brain.js's real 3-minute "keep time-of-day fresh" interval.
sandbox.setTimeout = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; };
sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; };
sandbox.clearInterval = clearInterval;
Object.assign(sandbox, makeEventTarget()); // window itself gets addEventListener/dispatchEvent (for 'storage')
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

function emitAgentEvent(type, payload) {
  sandbox.document.dispatchEvent(new FakeCustomEvent('axiom:agent-event', { detail: { type: type, source: 'test', payload: payload || {}, ts: Date.now(), id: 'evt-' + Math.random() } }));
}

// ---- Load the real, unmodified files under test -----------------------
load('os/core/axiom-brain.js');
load('js/core/ai-state-manager.js');

const Brain = sandbox.AxiomBrain;
const AIState = sandbox.AxiomAIState;

check('AxiomBrain loaded', !!Brain);
check('AxiomAIState loaded', !!AIState);

// -- 1. Brain starts with the new AI-pipeline metadata fields, all unset --
{
  const s = Brain.getState();
  check('initial activeModel is null', s.activeModel === null, s.activeModel);
  check('initial activeConversationId is null', s.activeConversationId === null, s.activeConversationId);
  check('initial toolActive is false', s.toolActive === false, s.toolActive);
  check('initial activeTool is null', s.activeTool === null, s.activeTool);
}

// -- 2. Tool execution: capability:loading -> toolActive/activeTool set --
emitAgentEvent('capability:loading', { capability: 'coding:generate', task: 't1', attempt: 1 });
{
  const s = Brain.getState();
  check('capability:loading sets toolActive', s.toolActive === true, s.toolActive);
  check('capability:loading sets activeTool', s.activeTool === 'coding:generate', s.activeTool);
}

// -- 3. Tool execution ends cleanly on success, no duplicate/stuck state --
emitAgentEvent('capability:success', { capability: 'coding:generate', task: 't1', attempt: 1 });
{
  const s = Brain.getState();
  check('capability:success clears toolActive', s.toolActive === false, s.toolActive);
  check('capability:success clears activeTool', s.activeTool === null, s.activeTool);
}

// -- 4. A retry sequence: loading -> retry (still in-flight) -> failure (exhausted) --
emitAgentEvent('capability:loading', { capability: 'coding:explain-code', task: 't2', attempt: 1 });
check('retry-sequence: loading sets toolActive', Brain.getState().toolActive === true, Brain.getState());
emitAgentEvent('capability:retry', { capability: 'coding:explain-code', task: 't2', attempt: 1 }); // not a terminal event
check('capability:retry does not clear toolActive (still in flight)', Brain.getState().toolActive === true, Brain.getState());
emitAgentEvent('capability:loading', { capability: 'coding:explain-code', task: 't2', attempt: 2 }); // next attempt
emitAgentEvent('capability:failure', { capability: 'coding:explain-code', task: 't2', attempt: 2, error: 'boom' });
{
  const s = Brain.getState();
  check('exhausted retries -> toolActive clears', s.toolActive === false, s.toolActive);
  check('exhausted retries -> activeTool clears', s.activeTool === null, s.activeTool);
}

// -- 5. Cancellation and timeout both clear the tool state too --
emitAgentEvent('capability:loading', { capability: 'browser:search', task: 't3' });
emitAgentEvent('capability:cancelled', { capability: 'browser:search', task: 't3' });
check('capability:cancelled clears toolActive', Brain.getState().toolActive === false, Brain.getState());
emitAgentEvent('capability:loading', { capability: 'browser:search', task: 't4' });
emitAgentEvent('capability:timeout', { capability: 'browser:search', task: 't4', timeoutMs: 10000 });
check('capability:timeout clears toolActive', Brain.getState().toolActive === false, Brain.getState());

// -- 6. Active conversation: conversation:* events set/clear the id --
emitAgentEvent('conversation:thinking', { conversationId: 'conv-123', turnId: 'turn-1', stage: 'analyzing' });
check('conversation:thinking sets activeConversationId', Brain.getState().activeConversationId === 'conv-123', Brain.getState().activeConversationId);
emitAgentEvent('conversation:progress', { conversationId: 'conv-123', turnId: 'turn-1', stage: 'submitted' });
check('conversation:progress keeps the same activeConversationId', Brain.getState().activeConversationId === 'conv-123', Brain.getState().activeConversationId);
emitAgentEvent('conversation:done', { conversationId: 'conv-123', turnId: 'turn-1', status: 'completed' });
check('conversation:done clears activeConversationId', Brain.getState().activeConversationId === null, Brain.getState().activeConversationId);

// -- 7. Active model: axiom:model-changed (what model-selector.js dispatches) --
sandbox.document.dispatchEvent(new FakeCustomEvent('axiom:model-changed', { detail: { modelId: 'openai/gpt-4o-mini' } }));
check('axiom:model-changed sets activeModel', Brain.getState().activeModel === 'openai/gpt-4o-mini', Brain.getState().activeModel);
sandbox.document.dispatchEvent(new FakeCustomEvent('axiom:model-changed', { detail: { modelId: 'anthropic/claude-3.5-sonnet' } }));
check('a second axiom:model-changed updates activeModel', Brain.getState().activeModel === 'anthropic/claude-3.5-sonnet', Brain.getState().activeModel);

// -- 8. Error events: the documented Milestone-3 gap is fixed --
AIState.setState('error');
check('AxiomAIState error now reaches Brain as activity:"error" (was forced to "idle")', Brain.getState().activity === 'error', Brain.getState().activity);
AIState.setState('thinking');
check('AxiomAIState thinking still reaches Brain as activity:"thinking" (unchanged behavior)', Brain.getState().activity === 'thinking', Brain.getState().activity);
AIState.setState('idle');
check('AxiomAIState idle still reaches Brain as activity:"idle" (unchanged behavior)', Brain.getState().activity === 'idle', Brain.getState().activity);

// -- 9. No duplicate/stuck state: a burst of interleaved tool + conversation
//       events across two "concurrent" capabilities settles correctly --
emitAgentEvent('capability:loading', { capability: 'memory:search', task: 'tA' });
emitAgentEvent('conversation:thinking', { conversationId: 'conv-999', turnId: 'turn-9' });
emitAgentEvent('capability:success', { capability: 'memory:search', task: 'tA' });
emitAgentEvent('conversation:done', { conversationId: 'conv-999', turnId: 'turn-9' });
{
  const s = Brain.getState();
  check('burst settles: toolActive back to false', s.toolActive === false, s.toolActive);
  check('burst settles: activeTool back to null', s.activeTool === null, s.activeTool);
  check('burst settles: activeConversationId back to null', s.activeConversationId === null, s.activeConversationId);
}

// -- 10. Non-agent, non-conversation bus noise is ignored (no crash, no bleed) --
emitAgentEvent('agent:status', { id: 'agent.coding', prev: 'idle', status: 'thinking' });
emitAgentEvent('task:started', { agent: 'agent.coding', task: { id: 'z1' } });
{
  const s = Brain.getState();
  check('unrelated bus events do not touch toolActive', s.toolActive === false, s.toolActive);
  check('unrelated bus events do not touch activeModel', s.activeModel === 'anthropic/claude-3.5-sonnet', s.activeModel);
}

console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
process.exit(fails === 0 ? 0 : 1);
