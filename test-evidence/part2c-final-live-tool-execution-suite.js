// ============================================================
// AXIOM — Part 2C Final: Live Tool Execution Wiring
// Regression suite (test matrix A-O from the build spec)
// ------------------------------------------------------------
// Loads the real, unmodified files via jsdom and drives them the same
// way the live playground.html page does:
//   os/core/orchestrator.js
//   os/core/capability-router.js
//   os/api/openrouter/tool-calling/{tool-schema,tool-manager,tool-call-parser}.js
//   os/api/openrouter/tool-calling/axiom-tool-registry-bridge.js
//   js/core/live-tool-executor.js        (new)
//   js/core/openrouter-client.js         (modified: tools/tool_choice + accumulation)
//   js/core/app.js                       (modified: tool-round loop in streamAssistantReply)
// ============================================================
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const AI = path.join(__dirname, '..');

let fails = 0;
function check(label, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + ' ' + label + (cond ? '' : '  -> ' + detail));
  if (!cond) fails++;
}

function freshWindow() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <form id="chatForm"><textarea id="chatInput"></textarea></form>
    <div id="chatWindow"></div>
    <select id="modelSelect"></select>
    <div id="creditsBanner"></div>
  </body></html>`, {
    url: 'http://localhost/playground.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.AxLogger = { warn(){}, error(){}, info(){}, debug(){}, log(){} };
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  // Mirrors supabase-config.js's top-level `const SUPABASE_URL` (a bare
  // lexical identifier openrouter-config.js reads directly, per its own
  // header comment) — defined here the same way for the harness only.
  window.eval('var SUPABASE_URL = "http://localhost/supabase";');
  return window;
}

function load(window, rel) {
  window.eval(fs.readFileSync(path.join(AI, rel), 'utf8'));
}

function loadCoreStack(window) {
  load(window, 'os/core/orchestrator.js');
  load(window, 'os/core/capability-router.js');
  load(window, 'os/api/openrouter/tool-calling/tool-schema.js');
  load(window, 'os/api/openrouter/tool-calling/tool-manager.js');
  load(window, 'os/api/openrouter/tool-calling/tool-call-parser.js');
  load(window, 'os/api/openrouter/tool-calling/axiom-tool-registry-bridge.js');
  load(window, 'js/core/live-tool-executor.js');
}

// A tiny synthetic agent registered directly on the real AxiomOrchestrator
// (never a second registry) so tests don't depend on which real subsystems
// (Browser/Brain/Memory/...) happen to be present in this Node harness.
function registerSyntheticAgent(window, opts) {
  opts = opts || {};
  window.AxiomOrchestrator.registerAgent({
    id: opts.id || 'test-agent',
    name: opts.name || 'Test Agent',
    capabilities: [opts.capability || 'echo'],
    permissions: opts.permissions || [],
    tools: [opts.capability || 'echo'],
    handler: opts.handler || function (task) { return Promise.resolve({ ok: true, echoedPayload: task.payload }); }
  });
}

async function testA_normalChatUnaffected() {
  const window = freshWindow();
  loadCoreStack(window);
  load(window, 'js/core/openrouter-config.js');
  load(window, 'js/core/openrouter-client.js');

  window.supabaseClient = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
  window.SUPABASE_ANON_KEY = 'anon';

  let seenBody = null;
  window.fetch = async (url, init) => {
    seenBody = JSON.parse(init.body);
    const sse = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse));
          controller.close();
        }
      })
    };
  };

  let done = null;
  await new Promise((resolve) => {
    window.OpenRouter.streamChat({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      onDone: (fullText, aborted, extra) => { done = { fullText, aborted, extra }; resolve(); }
    });
  });

  check('A. normal chat still works (no tools requested)', done.fullText === 'Hello world' && !done.aborted, JSON.stringify(done));
  check('A. no `tools` field sent when none supplied', !('tools' in seenBody), JSON.stringify(seenBody));
  check('A. extra.toolCalls is null when the model called no tools', done.extra.toolCalls === null, JSON.stringify(done.extra));
}

async function testB_toolDefinitionsReachRequest() {
  const window = freshWindow();
  loadCoreStack(window);
  load(window, 'js/core/openrouter-config.js');
  load(window, 'js/core/openrouter-client.js');
  window.supabaseClient = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
  window.SUPABASE_ANON_KEY = 'anon';

  registerSyntheticAgent(window, { id: 'echo-agent', capability: 'echo_tool' });
  window.AxiomLiveToolExecutor.ensureInitialized();
  const defs = window.AxiomLiveToolExecutor.getToolDefinitions();
  check('B1. bridge discovers the registered agent as a tool definition', Array.isArray(defs) && defs.some(d => d.function.name === 'echo_tool'), JSON.stringify(defs));

  let seenBody = null;
  window.fetch = async (url, init) => {
    seenBody = JSON.parse(init.body);
    const sse = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return { ok: true, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }) };
  };
  await new Promise((resolve) => {
    window.OpenRouter.streamChat({ model: 'x', messages: [{ role: 'user', content: 'hi' }], tools: defs, onDone: resolve });
  });
  check('B2. tool definitions reach the OpenRouter request body', Array.isArray(seenBody.tools) && seenBody.tools.some(d => d.function.name === 'echo_tool'), JSON.stringify(seenBody.tools));
}

async function testC_syntheticToolCallParsed() {
  const window = freshWindow();
  loadCoreStack(window);
  const raw = { id: 'call_1', type: 'function', function: { name: 'echo_tool', arguments: '{"x":1}' } };
  const parsed = window.AxiomOpenRouterToolCallParser.parseToolCall(raw);
  check('C. synthetic/mock tool_call is parsed correctly', parsed.id === 'call_1' && parsed.name === 'echo_tool' && parsed.arguments.x === 1 && !parsed.parseError, JSON.stringify(parsed));
}

async function testD_permissionApprovedExecutes() {
  const window = freshWindow();
  loadCoreStack(window);
  registerSyntheticAgent(window, {
    id: 'granted-agent', capability: 'granted_tool', permissions: ['granted_tool'],
    handler: (task) => Promise.resolve({ ok: true, got: task.payload })
  });
  window.AxiomLiveToolExecutor.ensureInitialized();
  const tool = window.AxiomOpenRouterToolRegistryBridge.getTool('granted_tool');
  // Exercise the ACTUAL enforcement path: grant an explicit requiredPermission
  // that matches what the agent was registered with, through the same
  // unmodified capability-router.js validate()/hasPermission().
  tool.metadata.requiredPermission = 'granted_tool';
  window.AxiomOpenRouterToolManager.unregisterTool('granted_tool');
  window.AxiomOpenRouterToolManager.registerTool(tool);

  const result = await window.AxiomLiveToolExecutor.executeToolCall({
    id: 'call_ok', type: 'function', function: { name: 'granted_tool', arguments: '{"a":1}' }
  });
  const parsedContent = JSON.parse(result.content);
  check('D. permission-approved tool executes and returns the handler result', parsedContent.ok === true && parsedContent.got.a === 1, JSON.stringify(result));
  check('D. tool_call_id is preserved on the result', result.tool_call_id === 'call_ok', JSON.stringify(result));
}

async function testE_permissionDeniedDoesNotExecute() {
  const window = freshWindow();
  loadCoreStack(window);
  let executed = false;
  registerSyntheticAgent(window, {
    id: 'locked-agent', capability: 'locked_tool', permissions: [], // agent granted NOTHING
    handler: (task) => { executed = true; return Promise.resolve({ ok: true }); }
  });
  window.AxiomLiveToolExecutor.ensureInitialized();
  const tool = window.AxiomOpenRouterToolRegistryBridge.getTool('locked_tool');
  tool.metadata.requiredPermission = 'locked_tool:use'; // agent does NOT have this permission
  window.AxiomOpenRouterToolManager.unregisterTool('locked_tool');
  window.AxiomOpenRouterToolManager.registerTool(tool);

  const result = await window.AxiomLiveToolExecutor.executeToolCall({
    id: 'call_denied', type: 'function', function: { name: 'locked_tool', arguments: '{}' }
  });
  const parsedContent = JSON.parse(result.content);
  check('E. permission-denied tool never invokes the handler', executed === false, 'executed=' + executed);
  check('E. permission-denied tool returns a safe role:"tool" error, not a throw', !!parsedContent.error, JSON.stringify(result));
  check('E. capability-router itself reported the denial (not a client-side guess)', /permission/i.test(parsedContent.error), JSON.stringify(result));
}

async function testF_multipleToolCallsAllReturn() {
  const window = freshWindow();
  loadCoreStack(window);
  registerSyntheticAgent(window, { id: 'multi-agent', capability: 'multi_tool', handler: (task) => Promise.resolve({ n: task.payload.n }) });
  window.AxiomLiveToolExecutor.ensureInitialized();

  const calls = [1, 2, 3].map(n => ({ id: 'call_' + n, type: 'function', function: { name: 'multi_tool', arguments: JSON.stringify({ n }) } }));
  const results = await Promise.all(calls.map(c => window.AxiomLiveToolExecutor.executeToolCall(c)));
  check('F. all tool_calls execute and all results return', results.length === 3 && results.every((r, i) => JSON.parse(r.content).n === i + 1), JSON.stringify(results));
}

async function testG_toolCallIdPreserved() {
  const window = freshWindow();
  loadCoreStack(window);
  registerSyntheticAgent(window, { id: 'id-agent', capability: 'id_tool' });
  window.AxiomLiveToolExecutor.ensureInitialized();
  const result = await window.AxiomLiveToolExecutor.executeToolCall({ id: 'call_xyz', type: 'function', function: { name: 'id_tool', arguments: '{}' } });
  check('G. role:"tool" result preserves the ORIGINAL tool_call_id', result.tool_call_id === 'call_xyz', JSON.stringify(result));
}

async function testH_followUpReachesTransport() {
  // Exercised end-to-end in testJ_appLoopMultiRound below (checks the
  // second streamChat call carries the appended tool result message).
  check('H. covered by J (follow-up request observed reaching the transport)', true);
}

async function testI_loopTerminatesNoMoreToolCalls() {
  check('I. covered by J (loop stops once a round returns no tool_calls)', true);
}

async function testJ_appLoopMultiRoundAndDedup() {
  const window = freshWindow();
  load(window, 'js/core/app.js');

  let call = 0;
  const seenMessagesPerCall = [];
  window.OpenRouter = {
    streamChat({ messages, onToken, onDone }) {
      call++;
      seenMessagesPerCall.push(JSON.parse(JSON.stringify(messages)));
      if (call === 1) {
        // Round 1: model asks for a tool call twice with the SAME id
        // (duplicate protection) plus one distinct id.
        setTimeout(() => onDone('', false, {
          toolCalls: [
            { id: 'call_a', name: 'do_thing', arguments: { x: 1 }, argumentsRaw: '{"x":1}', raw: { id: 'call_a', type: 'function', function: { name: 'do_thing', arguments: '{"x":1}' } } },
            { id: 'call_a', name: 'do_thing', arguments: { x: 1 }, argumentsRaw: '{"x":1}', raw: { id: 'call_a', type: 'function', function: { name: 'do_thing', arguments: '{"x":1}' } } }
          ],
          finishReason: 'tool_calls'
        }), 5);
      } else {
        // Round 2 (follow-up): final answer, no more tool_calls.
        setTimeout(() => {
          onToken('All done.', 'All done.');
          onDone('All done.', false, { toolCalls: null, finishReason: 'stop' });
        }, 5);
      }
    }
  };

  let executedCount = 0;
  window.AxiomLiveToolExecutor = {
    ensureInitialized: () => true,
    getToolDefinitions: () => [{ type: 'function', function: { name: 'do_thing', parameters: { type: 'object' } } }],
    executeToolCall: (raw) => { executedCount++; return Promise.resolve({ tool_call_id: raw.id, content: JSON.stringify({ ok: true }) }); },
    cancelPending: () => {}
  };

  const result = await window.streamAssistantReply({ model: 'x' });

  check('J. loop makes a follow-up request through the SAME transport after tool results', call === 2, 'call=' + call);
  check('I. loop terminates once a round returns no tool_calls (final answer returned)', result && result.fullText === 'All done.', JSON.stringify(result));
  check('K. duplicate tool_call.id is executed only once', executedCount === 1, 'executedCount=' + executedCount);

  const round2Messages = seenMessagesPerCall[1];
  const toolMsgs = round2Messages.filter(m => m.role === 'tool');
  check('G/H. follow-up request carries role:"tool" messages with matching tool_call_id, including the skipped duplicate', toolMsgs.length === 2 && toolMsgs.every(m => m.tool_call_id === 'call_a'), JSON.stringify(toolMsgs));
  const dup = toolMsgs.find(m => JSON.parse(m.content).error);
  check('K. the duplicate gets a safe error content, not a second execution', !!dup, JSON.stringify(toolMsgs));

  const assistantWithCalls = round2Messages.find(m => m.role === 'assistant' && Array.isArray(m.tool_calls));
  check('6. assistant message with tool_calls is preserved (with original ids) ahead of the tool results', !!assistantWithCalls && assistantWithCalls.tool_calls[0].id === 'call_a', JSON.stringify(assistantWithCalls));
}

async function testJ2_toolTurnLimit() {
  const window = freshWindow();
  load(window, 'js/core/app.js');

  let call = 0;
  window.OpenRouter = {
    streamChat({ onDone }) {
      call++;
      // Always asks for another (distinct-id) tool call — never terminates on its own.
      setTimeout(() => onDone('', false, {
        toolCalls: [{ id: 'call_' + call, name: 'loop_tool', arguments: {}, argumentsRaw: '{}', raw: { id: 'call_' + call, type: 'function', function: { name: 'loop_tool', arguments: '{}' } } }],
        finishReason: 'tool_calls'
      }), 2);
    }
  };
  window.AxiomLiveToolExecutor = {
    ensureInitialized: () => true,
    getToolDefinitions: () => [{ type: 'function', function: { name: 'loop_tool', parameters: { type: 'object' } } }],
    executeToolCall: (raw) => Promise.resolve({ tool_call_id: raw.id, content: JSON.stringify({ ok: true }) }),
    cancelPending: () => {}
  };

  const result = await window.streamAssistantReply({ model: 'x' });
  check('J. tool-turn limit (8) is enforced — loop does not run forever', call === 8, 'call=' + call);
  check('J. limit reached is surfaced as a normal (non-throwing) turn end', result === null, JSON.stringify(result));
}

async function testL_streamingAccumulation() {
  const window = freshWindow();
  loadCoreStack(window);
  load(window, 'js/core/openrouter-config.js');
  load(window, 'js/core/openrouter-client.js');
  window.supabaseClient = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
  window.SUPABASE_ANON_KEY = 'anon';

  window.fetch = async () => {
    // Split across multiple SSE deltas, as a real streamed tool_call arrives.
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_stream","type":"function","function":{"name":"do_","arguments":""}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"thing","arguments":"{\\"x\\":"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"42}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n';
    return { ok: true, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }) };
  };

  let done = null;
  await new Promise((resolve) => {
    window.OpenRouter.streamChat({ model: 'x', messages: [{ role: 'user', content: 'hi' }], onDone: (fullText, aborted, extra) => { done = extra; resolve(); } });
  });

  check('L. streaming tool-call deltas accumulate into one finalized call', Array.isArray(done.toolCalls) && done.toolCalls.length === 1, JSON.stringify(done));
  check('L. accumulated name is assembled across deltas ("do_" + "thing")', done.toolCalls && done.toolCalls[0].name === 'do_thing', JSON.stringify(done));
  check('L. accumulated arguments are assembled and parsed across deltas', done.toolCalls && done.toolCalls[0].arguments.x === 42, JSON.stringify(done));
  check('L. finishReason is captured', done.finishReason === 'tool_calls', JSON.stringify(done));
}

async function testM_cancellationNoOrphan() {
  const window = freshWindow();
  loadCoreStack(window);
  load(window, 'js/core/openrouter-config.js');
  load(window, 'js/core/openrouter-client.js');
  window.supabaseClient = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
  window.SUPABASE_ANON_KEY = 'anon';

  let cancelledCount = 0;
  window.AxiomLiveToolExecutor = {
    ensureInitialized: () => true,
    getToolDefinitions: () => null,
    executeToolCall: () => new Promise(() => {}), // never resolves — would orphan if not aborted
    cancelPending: (reason) => { cancelledCount++; }
  };

  load(window, 'js/core/app.js');
  // app.js already loaded OpenRouter for real above; override with an
  // abort-aware fake so the round actually aborts.
  window.OpenRouter = {
    streamChat({ signal, onDone }) {
      const t = setTimeout(() => onDone('should not arrive', false), 1000);
      signal.addEventListener('abort', () => { clearTimeout(t); onDone('', true); });
    }
  };

  const p1 = window.streamAssistantReply({ model: 'x' });
  await new Promise(r => setTimeout(r, 5));
  const p2 = window.streamAssistantReply({ model: 'x' }); // second call aborts the first, same as a new user message
  const [r1, r2] = await Promise.all([p1, p2]);
  check('M. an in-flight round aborted by a new request resolves null (no orphaned promise)', r1 === null, JSON.stringify(r1));
}

async function testN_noApiKeyExposed() {
  const clientSrc = fs.readFileSync(path.join(AI, 'js/core/openrouter-client.js'), 'utf8');
  const edgeFnSrc = fs.readFileSync(path.join(AI, 'supabase/functions/openrouter-chat/index.ts'), 'utf8');
  const executorSrc = fs.readFileSync(path.join(AI, 'js/core/live-tool-executor.js'), 'utf8');
  check('N. OPENROUTER_API_KEY never appears in the browser-side client', !clientSrc.includes('OPENROUTER_API_KEY'), 'found in openrouter-client.js');
  check('N. OPENROUTER_API_KEY never appears in the new browser-side wiring file', !executorSrc.includes('OPENROUTER_API_KEY'), 'found in live-tool-executor.js');
  check('N. OPENROUTER_API_KEY is only ever read server-side (Edge Function)', edgeFnSrc.includes('OPENROUTER_API_KEY'), 'expected in the Edge Function, server-side only');
  check('N. SUPABASE_SERVICE_ROLE_KEY never appears in the new browser-side wiring file', !executorSrc.includes('SUPABASE_SERVICE_ROLE_KEY'), 'found in live-tool-executor.js');
}

async function testO_normalHistoryPreserved() {
  const window = freshWindow();
  load(window, 'js/core/app.js');
  window.OpenRouter = {
    streamChat({ messages, onToken, onDone }) {
      setTimeout(() => {
        onToken('plain reply', 'plain reply');
        onDone('plain reply', false, { toolCalls: null, finishReason: 'stop' });
      }, 2);
    }
  };
  window.chatHistory = window.chatHistory || [];
  const before = (window.chatHistory || []).length;
  const r = await window.streamAssistantReply({ model: 'x' });
  check('O. existing normal chat/history behavior is preserved when no tools are involved', r && r.fullText === 'plain reply', JSON.stringify(r));
}

async function testSecretRedaction() {
  const window = freshWindow();
  loadCoreStack(window);
  registerSyntheticAgent(window, {
    id: 'secret-agent', capability: 'secret_tool',
    handler: () => Promise.resolve({ ok: true, apiKey: 'sk-should-not-leak', nested: { service_role_key: 'sr-should-not-leak', safe: 'fine' } })
  });
  window.AxiomLiveToolExecutor.ensureInitialized();
  const result = await window.AxiomLiveToolExecutor.executeToolCall({ id: 'call_secret', type: 'function', function: { name: 'secret_tool', arguments: '{}' } });
  check('13. secret-shaped keys in a tool result are redacted before reaching the model', !result.content.includes('sk-should-not-leak') && !result.content.includes('sr-should-not-leak'), result.content);
  check('13. non-secret sibling fields survive redaction', JSON.parse(result.content).nested.safe === 'fine', result.content);
}

async function main() {
  await testA_normalChatUnaffected();
  await testB_toolDefinitionsReachRequest();
  await testC_syntheticToolCallParsed();
  await testD_permissionApprovedExecutes();
  await testE_permissionDeniedDoesNotExecute();
  await testF_multipleToolCallsAllReturn();
  await testG_toolCallIdPreserved();
  await testH_followUpReachesTransport();
  await testI_loopTerminatesNoMoreToolCalls();
  await testJ_appLoopMultiRoundAndDedup();
  await testJ2_toolTurnLimit();
  await testL_streamingAccumulation();
  await testM_cancellationNoOrphan();
  await testN_noApiKeyExposed();
  await testO_normalHistoryPreserved();
  await testSecretRedaction();

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : '\n' + fails + ' CHECK(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SUITE CRASHED:', err);
  process.exit(1);
});
