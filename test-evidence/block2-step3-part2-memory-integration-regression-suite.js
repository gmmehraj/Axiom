// ============================================================
// AXIOM — Block 2 / Step 3 / Part 2: Connect Brain to Memory regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/axiom-brain.js,
// os/core/memory-engine.js, and os/core/brain-memory-bridge.js together
// in a small hand-rolled window/document/localStorage shim (same pattern
// as the Block 2 / Step 2 / Part 2 and Block 2 / Step 3 / Part 1 suites)
// and drives them with the SAME event shapes the real runtime produces
// (axiom:agent-event envelopes, axiom:message-appended chat-bubble
// events) — then asserts Memory actually recorded what the Brain
// reported, with no direct shortcuts into AxiomMemoryEngine itself.
//
// No jsdom import: no network access in this sandbox to install it, so
// this uses Node's vm module with a minimal DOM/localStorage shim
// instead of jsdom.
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
sandbox.Date = Date;
sandbox.Math = Math;
sandbox.JSON = JSON;
sandbox.Set = Set;
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

function emitMessageAppended(id, role, text) {
  const bubble = { textContent: text };
  const el = { querySelector: () => bubble };
  sandbox.document.dispatchEvent(new FakeCustomEvent('axiom:message-appended', { detail: { id: id, role: role, el: el, bubble: bubble } }));
}

// ---- Load the real, unmodified files under test, in the SAME order the
//      real HTML pages now load them: Brain -> AIState (the module that
//      actually turns conversation:*/model-changed/capability:* events
//      into Brain.activeConversationId/activeModel/toolActive) -> Memory
//      -> Bridge -----------------------------------------------------
load('os/core/axiom-brain.js');
load('js/core/ai-state-manager.js');
load('os/core/memory-engine.js');
load('os/core/brain-memory-bridge.js');

const Brain = sandbox.AxiomBrain;
const AIState = sandbox.AxiomAIState;
const Memory = sandbox.AxiomMemoryEngine;
const Bridge = sandbox.AxiomBrainMemoryBridge;

check('AxiomBrain loaded', !!Brain);
check('AxiomAIState loaded', !!AIState);
check('AxiomMemoryEngine loaded', !!Memory);
check('AxiomBrainMemoryBridge loaded', !!Bridge);
check('Memory was auto-initialized by the bridge', !!Memory.getSession());

// -- 1. Active conversation: a real conversation:* event creates a real
//       conversation record (not fabricated, carries a real timestamp) --
const beforeConv = Date.now();
emitAgentEvent('conversation:thinking', { conversationId: 'conv-alpha', turnId: 't1' });
check('Brain reflects the active conversation id', Brain.getState().activeConversationId === 'conv-alpha', Brain.getState().activeConversationId);
check('Memory created the conversation record', Memory.hasConversation('conv-alpha'), Memory.listConversations());
{
  const conv = Memory.listConversations().find(c => c.id === 'conv-alpha');
  check('conversation createdAt is a real, recent timestamp', conv && conv.createdAt >= beforeConv, conv);
}

// -- 2. User prompts / AI responses: real chat bubbles are recorded with
//       their real text, tagged with the active model -------------------
sandbox.document.dispatchEvent(new FakeCustomEvent('axiom:model-changed', { detail: { modelId: 'openai/gpt-4o-mini' } }));
check('Brain reflects the active model', Brain.getState().activeModel === 'openai/gpt-4o-mini', Brain.getState().activeModel);

emitMessageAppended('m1', 'user', 'What is the capital of France?');
emitMessageAppended('m2', 'assistant', 'The capital of France is Paris.');
{
  const history = Memory.getConversationHistory('conv-alpha');
  check('both the user prompt and the AI response were recorded', history.length === 2, history);
  check('user prompt content matches exactly what was rendered', history[0].role === 'user' && history[0].content === 'What is the capital of France?', history[0]);
  check('AI response content matches exactly what was rendered', history[1].role === 'assistant' && history[1].content === 'The capital of France is Paris.', history[1]);
  check('the AI response is tagged with the real active model', history[1].agent === 'openai/gpt-4o-mini', history[1].agent);
}

// -- 3. No duplicate memory entries: re-firing the same DOM message event
//       (e.g. a stray re-render) must not double-record it --------------
emitMessageAppended('m1', 'user', 'What is the capital of France?');
check('re-firing the same message id does not duplicate it', Memory.getConversationHistory('conv-alpha').length === 2, Memory.getConversationHistory('conv-alpha'));

// -- 4. Conversation metadata: active model / tool state land on the
//       conversation record itself, not just the message ----------------
emitAgentEvent('capability:loading', { capability: 'research:search' });
{
  const conv = Memory.listConversations().find(c => c.id === 'conv-alpha');
  check('conversation meta reflects live toolActive', conv.meta && conv.meta.toolActive === true, conv.meta);
  check('conversation meta reflects the live active tool', conv.meta && conv.meta.activeTool === 'research:search', conv.meta);
  check('conversation meta reflects the live active model', conv.meta && conv.meta.activeModel === 'openai/gpt-4o-mini', conv.meta);
}
emitAgentEvent('capability:success', { capability: 'research:search' });
{
  const conv = Memory.listConversations().find(c => c.id === 'conv-alpha');
  check('conversation meta clears toolActive once the tool finishes', conv.meta.toolActive === false, conv.meta);
}

// -- 5. Session state: Brain activity actually refreshes the Memory
//       session heartbeat (proves Brain -> Memory synchronization, not
//       just Memory's own independent timer) -----------------------------
{
  const sessionBefore = Memory.getSession().lastActiveAt;
  // force a small, deterministic delay so a refreshed heartbeat is
  // measurably different from the original
  const laterTs = sessionBefore + 5000;
  const realNow = Date.now;
  Date.now = () => laterTs;
  Brain.setState({ mood: 'focused' }); // any real Brain change, not just activity
  Date.now = realNow;
  check('a Brain change refreshes the Memory session heartbeat', Memory.getSession().lastActiveAt === laterTs, Memory.getSession());
}

// -- 6. AI lifecycle events: real activity transitions are recorded, each
//       transition exactly once (no duplicate memory entries) -----------
const lifecycleBefore = Memory.queryMemories({ tag: 'lifecycle' }).length;
Brain.setState({ activity: 'thinking' });
Brain.setState({ activity: 'thinking' }); // identical state again -> must NOT create a second entry
Brain.setState({ activity: 'responding' });
Brain.setState({ activity: 'idle' });
{
  const lifecycleAfter = Memory.queryMemories({ tag: 'lifecycle' });
  check('three genuine transitions -> exactly three new lifecycle entries (no dup on repeat)', lifecycleAfter.length - lifecycleBefore === 3, lifecycleAfter.length - lifecycleBefore);
  const thinkingEntries = lifecycleAfter.filter(m => m.tags.indexOf('thinking') !== -1 && m.text.indexOf('thinking') !== -1);
  check('lifecycle entries are ttl-bearing (not permanent long-term memories)', lifecycleAfter.every(m => typeof m.ttl === 'number' && m.ttl > 0), lifecycleAfter.map(m => m.ttl));
}

// -- 7. Session switching: a second, distinct conversation is tracked
//       independently, with its own history and metadata ----------------
emitAgentEvent('conversation:thinking', { conversationId: 'conv-beta', turnId: 't2' });
check('Brain switches to the new active conversation', Brain.getState().activeConversationId === 'conv-beta', Brain.getState().activeConversationId);
emitMessageAppended('m3', 'user', 'And Germany?');
{
  const betaHistory = Memory.getConversationHistory('conv-beta');
  const alphaHistory = Memory.getConversationHistory('conv-alpha');
  check('the new message went to the new conversation, not the old one', betaHistory.length === 1 && betaHistory[0].content === 'And Germany?', betaHistory);
  check('the original conversation history is untouched by the switch', alphaHistory.length === 2, alphaHistory);
}
emitAgentEvent('conversation:done', { conversationId: 'conv-beta' });
{
  const beta = Memory.listConversations().find(c => c.id === 'conv-beta');
  check('conversation:done ends the conversation with a real endedAt timestamp', !!beta.endedAt, beta);
}

// -- 8. Stable synchronization under a burst of interleaved real events --
emitAgentEvent('conversation:thinking', { conversationId: 'conv-gamma', turnId: 't3' });
emitAgentEvent('capability:loading', { capability: 'coding:generate' });
emitMessageAppended('m4', 'user', 'Write a function.');
emitAgentEvent('capability:success', { capability: 'coding:generate' });
emitMessageAppended('m5', 'assistant', 'Here you go.');
emitAgentEvent('conversation:done', { conversationId: 'conv-gamma' });
{
  const gammaHistory = Memory.getConversationHistory('conv-gamma');
  check('a full burst settles into a coherent, correctly-ordered history', gammaHistory.length === 2 && gammaHistory[0].role === 'user' && gammaHistory[1].role === 'assistant', gammaHistory);
  const gamma = Memory.listConversations().find(c => c.id === 'conv-gamma');
  check('the burst conversation ended cleanly', !!gamma.endedAt, gamma);
}

// -- 9. Bridge exposes its own recording stats (used for validation/QA) --
{
  const s = Bridge.getStats();
  check('bridge reports messagesRecorded > 0', s.messagesRecorded > 0, s);
  check('bridge reports conversationsSeen for all three conversations', s.conversationsSeen === 3, s);
}

// -- 10. destroy() cleanly stops recording (no zombie listeners) ---------
Bridge.destroy();
emitMessageAppended('m6', 'user', 'This should not be recorded after destroy().');
{
  const cid = Brain.getState().activeConversationId; // still 'conv-gamma' from step 8/before conversation:done cleared nothing here
  const anyHasM6 = Memory.listConversations().some(c => Memory.getConversationHistory(c.id).some(m => m.content && m.content.indexOf('should not be recorded') !== -1));
  check('destroy() stops the bridge from recording further messages', !anyHasM6, anyHasM6);
}

console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
process.exit(fails === 0 ? 0 : 1);
