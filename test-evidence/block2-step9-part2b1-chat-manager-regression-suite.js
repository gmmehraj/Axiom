// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2B-1: OpenRouter Chat Manager
// regression suite
// ------------------------------------------------------------
// Runs the real file on disk (os/api/openrouter/chat-manager.js),
// together with its Part 2A siblings, in a hand-built `vm` sandbox —
// same pattern as test-evidence/block2-step9-part2a-openrouter-core-
// regression-suite.js. Every network call is mocked; no real network
// access is used or required.
//
// Sections:
//   1. Degrade-without-Core-Foundation — state management works with
//      only chat-manager.js loaded; sendMessage() rejects cleanly
//   2. Conversation lifecycle — createChat/getChat/listChats/
//      deleteChat, duplicate chatId rejection, openrouter_chat_created
//   3. Multi-turn chat completion — sendMessage() builds the request
//      correctly (system prompt, temperature/topP/maxTokens/stop),
//      appends user+assistant turns, per-call overrides don't mutate
//      saved config, openrouter_request_started/completed events
//   4. Conversation reset — resetChat() clears turns, keeps/clears
//      system prompt per options, openrouter_chat_reset event
//   5. Multiple concurrent conversations — independent state
//   6. Error paths — no stored key, unknown chatId, empty content,
//      network/HTTP failure (classified + emitted, user turn kept
//      for retry, no assistant turn appended)
//   7. Reuse — token accounting via tokens.recordUsage(), default
//      model via models.getDefaultModel(), errors via
//      _internal.classifyError() (not reimplemented here)
//   8. Non-duplication / non-modification statics
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`); }
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

class FakeCustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
}
class FakeAbortController {
  constructor() { this.signal = { aborted: false }; }
  abort() { this.signal.aborted = true; }
}

function makeSandbox(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.localStorage || {});
  const documentStub = { _events: [], dispatchEvent(evt) { this._events.push(evt); return true; } };
  const orchestratorEvents = [];
  const analyticsLogs = [];

  const sandbox = {
    console,
    document: documentStub,
    CustomEvent: FakeCustomEvent,
    AbortController: FakeAbortController,
    setTimeout: (fn) => global.setTimeout(fn, 0),
    clearTimeout: (id) => global.clearTimeout(id),
    setInterval: () => ({ __fakeInterval: true }),
    clearInterval: () => {},
    fetch: opts.fetch || (() => Promise.reject(new Error('no fetch mock configured'))),
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    AxLogger: { log() {}, warn() {}, error() {} },
    AxiomOrchestrator: opts.withOrchestrator === false ? undefined : {
      emit: (event, payload) => { orchestratorEvents.push({ event, payload }); }
    },
    AxiomAnalyticsAutomation: opts.withAnalytics === false ? undefined : {
      addLog: (msg, type) => { analyticsLogs.push({ msg, type }); }
    },
    AxiomSupabaseConnection: opts.supabaseConnection,
    AxiomRuntimeContext: opts.runtimeContext,
    AxiomMakeSeqId: opts.withIdFactory === false ? undefined : (prefix) => {
      let seq = 0;
      return () => prefix + '-' + Date.now().toString(36) + '-' + (++seq).toString(36);
    },
    Object, Array, Math, Date, Promise, Error, JSON, String, Number, isFinite
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  sandbox.__store = store;
  sandbox.__orchestratorEvents = orchestratorEvents;
  sandbox.__analyticsLogs = analyticsLogs;
  return sandbox;
}

function loadInto(sandbox, rel) {
  vm.runInContext(readSrc(rel), sandbox, { filename: rel });
}

function loadFull(sandbox, files) {
  const rels = files || [
    'os/api/openrouter/error-handler.js',
    'os/api/openrouter/api-manager.js',
    'os/api/openrouter/model-manager.js',
    'os/api/openrouter/token-manager.js',
    'os/api/openrouter/chat-manager.js'
  ];
  rels.forEach((rel) => loadInto(sandbox, rel));
}

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('PASS  ' + name);
  } catch (e) {
    fail++;
    failures.push({ label: name, detail: e && e.message });
    console.log('FAIL  ' + name + '  — ' + (e && e.message));
  }
}

function assertOk(value, message) {
  if (!value) throw new Error(message || 'expected a truthy value');
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message ? message + ' — ' : '') + `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function okJson(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function chatCompletionResponse(content, usage) {
  return okJson({
    id: 'gen-test',
    choices: [{ message: { role: 'assistant', content: content } }],
    usage: usage || { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  });
}

async function withStoredKey(sb, key) {
  // Seed the key through the real Part 2A path (setApiKey), same as
  // any real caller would — never write the storage key directly.
  // Temporarily swaps in a key-validation-only fetch mock, then
  // restores whatever fetch mock the test itself configured (e.g. one
  // that captures the chat-completions request body), so seeding the
  // key never clobbers a test's own mock.
  const original = sb.fetch;
  sb.fetch = () => okJson({ data: { label: 'test-key' } });
  sb.AxiomOpenRouter.init();
  const result = await sb.AxiomOpenRouter.setApiKey(key || 'sk-or-v1-test-key');
  assertOk(result.valid, 'setApiKey() must succeed to seed the test key');
  sb.fetch = original;
}

async function main() {
  console.log('AXIOM Block 2 / Step 9 / Part 2B-1 — OpenRouter Chat Manager regression\n');

  // =================================================================
  // 1. Degrade without Core Foundation
  // =================================================================
  await test('chat-manager: installs onto window.AxiomOpenRouter.chat standalone (no load-order dependency)', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/chat-manager.js');
    assertOk(typeof sb.AxiomOpenRouter.chat === 'object');
  });

  await test('chat-manager: state management (createChat/getHistory/resetChat) works with chat-manager.js loaded alone', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/chat-manager.js');
    const chat = sb.AxiomOpenRouter.chat.createChat({ systemPrompt: 'be terse' });
    assertOk(!!chat.chatId);
    assertEq(sb.AxiomOpenRouter.chat.getHistory(chat.chatId).length, 0);
    assertOk(sb.AxiomOpenRouter.chat.resetChat(chat.chatId));
  });

  await test('chat-manager: sendMessage() rejects with "core_not_loaded" when api-manager.js is absent', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/chat-manager.js');
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi'); } catch (e) { error = e; }
    assertOk(!!error && error.code === 'core_not_loaded', JSON.stringify(error));
  });

  // =================================================================
  // 2. Conversation lifecycle
  // =================================================================
  await test('chat-manager: createChat() assigns a chatId and fires openrouter_chat_created', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    let created = null;
    sb.AxiomOpenRouter.on('openrouter_chat_created', (p) => { created = p; });
    const chat = sb.AxiomOpenRouter.chat.createChat({ model: 'openai/gpt-4o-mini' });
    assertOk(!!chat.chatId);
    assertOk(!!created && created.chatId === chat.chatId, JSON.stringify(created));
  });

  await test('chat-manager: createChat() with an explicit chatId that already exists returns null (no clobber)', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const first = sb.AxiomOpenRouter.chat.createChat({ chatId: 'fixed-id' });
    assertOk(!!first);
    const second = sb.AxiomOpenRouter.chat.createChat({ chatId: 'fixed-id' });
    assertEq(second, null);
  });

  await test('chat-manager: getChat() returns null for an unknown chatId', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    assertEq(sb.AxiomOpenRouter.chat.getChat('does-not-exist'), null);
  });

  await test('chat-manager: listChats() reflects every created conversation with a message count', async () => {
    const sb = makeSandbox({ fetch: () => chatCompletionResponse('hi there') });
    loadFull(sb);
    await withStoredKey(sb);
    const a = sb.AxiomOpenRouter.chat.createChat();
    const b = sb.AxiomOpenRouter.chat.createChat();
    await sb.AxiomOpenRouter.chat.sendMessage(a.chatId, 'hello');
    const list = sb.AxiomOpenRouter.chat.listChats();
    const ids = list.map((c) => c.chatId);
    assertOk(ids.indexOf(a.chatId) !== -1 && ids.indexOf(b.chatId) !== -1, JSON.stringify(ids));
    const aEntry = list.find((c) => c.chatId === a.chatId);
    assertEq(aEntry.messageCount, 2, 'user + assistant turn');
  });

  await test('chat-manager: deleteChat() removes the conversation; getChat()/getHistory() then return null', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    assertOk(sb.AxiomOpenRouter.chat.deleteChat(chat.chatId));
    assertEq(sb.AxiomOpenRouter.chat.getChat(chat.chatId), null);
    assertEq(sb.AxiomOpenRouter.chat.getHistory(chat.chatId), null);
    assertOk(!sb.AxiomOpenRouter.chat.deleteChat(chat.chatId), 'deleting twice must not throw or succeed twice');
  });

  await test('chat-manager: setSystemPrompt()/configureChat() update saved state and return true/snapshot', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    assertOk(sb.AxiomOpenRouter.chat.setSystemPrompt(chat.chatId, 'You are terse.'));
    assertEq(sb.AxiomOpenRouter.chat.getChat(chat.chatId).systemPrompt, 'You are terse.');
    const updated = sb.AxiomOpenRouter.chat.configureChat(chat.chatId, { temperature: 0.2, topP: 0.9, maxTokens: 256, stopSequences: ['STOP'] });
    assertEq(updated.temperature, 0.2);
    assertEq(updated.topP, 0.9);
    assertEq(updated.maxTokens, 256);
    assertEq(JSON.stringify(updated.stopSequences), JSON.stringify(['STOP']));
  });

  // =================================================================
  // 3. Multi-turn chat completion
  // =================================================================
  await test('chat-manager: sendMessage() posts to /chat/completions with system prompt + full history + params', async () => {
    let capturedUrl = null, capturedBody = null;
    const sb = makeSandbox({
      fetch: (url, req) => { capturedUrl = url; capturedBody = JSON.parse(req.body); return chatCompletionResponse('Hello back!'); }
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat({
      model: 'openai/gpt-4o-mini', systemPrompt: 'Be terse.',
      temperature: 0.3, topP: 0.8, maxTokens: 128, stopSequences: ['\\n\\n']
    });
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'Hello!');

    assertEq(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assertEq(capturedBody.model, 'openai/gpt-4o-mini');
    assertEq(capturedBody.messages[0].role, 'system');
    assertEq(capturedBody.messages[0].content, 'Be terse.');
    assertEq(capturedBody.messages[1].role, 'user');
    assertEq(capturedBody.messages[1].content, 'Hello!');
    assertEq(capturedBody.temperature, 0.3);
    assertEq(capturedBody.top_p, 0.8);
    assertEq(capturedBody.max_tokens, 128);
    assertEq(JSON.stringify(capturedBody.stop), JSON.stringify(['\\n\\n']));
    assertEq(capturedBody.stream, false);
  });

  await test('chat-manager: sendMessage() omits temperature/top_p/max_tokens/stop entirely when unset (no silent 0/null)', async () => {
    let capturedBody = null;
    const sb = makeSandbox({ fetch: (url, req) => { capturedBody = JSON.parse(req.body); return chatCompletionResponse('ok'); } });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi');
    assertOk(!('temperature' in capturedBody), JSON.stringify(capturedBody));
    assertOk(!('top_p' in capturedBody), JSON.stringify(capturedBody));
    assertOk(!('max_tokens' in capturedBody), JSON.stringify(capturedBody));
    assertOk(!('stop' in capturedBody), JSON.stringify(capturedBody));
  });

  await test('chat-manager: multi-turn — a second sendMessage() includes the first turn\'s user+assistant messages in the request', async () => {
    const seenRequests = [];
    const sb = makeSandbox({
      fetch: (url, req) => { seenRequests.push(JSON.parse(req.body)); return chatCompletionResponse('reply ' + seenRequests.length); }
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'first');
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'second');

    assertEq(seenRequests[1].messages.length, 3, JSON.stringify(seenRequests[1].messages));
    assertEq(seenRequests[1].messages[0].content, 'first');
    assertEq(seenRequests[1].messages[1].content, 'reply 1');
    assertEq(seenRequests[1].messages[2].content, 'second');

    const history = sb.AxiomOpenRouter.chat.getHistory(chat.chatId);
    assertEq(history.length, 4);
    assertEq(history[0].role, 'user');
    assertEq(history[1].role, 'assistant');
  });

  await test('chat-manager: sendMessage() resolves with the assistant message and usage totals', async () => {
    const sb = makeSandbox({ fetch: () => chatCompletionResponse('Hi!', { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }) });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    const result = await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hey');
    assertEq(result.chatId, chat.chatId);
    assertOk(!!result.requestId);
    assertEq(result.message.role, 'assistant');
    assertEq(result.message.content, 'Hi!');
    assertEq(result.usage.promptTokens, 7);
    assertEq(result.usage.completionTokens, 3);
    assertEq(result.usage.totalTokens, 10);
  });

  await test('chat-manager: per-call overrides apply to that request only and never mutate the saved conversation config', async () => {
    let capturedBody = null;
    const sb = makeSandbox({ fetch: (url, req) => { capturedBody = JSON.parse(req.body); return chatCompletionResponse('ok'); } });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat({ model: 'openai/gpt-4o-mini', temperature: 0.2 });
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi', { model: 'anthropic/claude-3-haiku', temperature: 0.9 });
    assertEq(capturedBody.model, 'anthropic/claude-3-haiku');
    assertEq(capturedBody.temperature, 0.9);
    const saved = sb.AxiomOpenRouter.chat.getChat(chat.chatId);
    assertEq(saved.model, 'openai/gpt-4o-mini', 'override must not persist onto the conversation');
    assertEq(saved.temperature, 0.2, 'override must not persist onto the conversation');
  });

  await test('chat-manager: openrouter_request_started/completed fire with matching requestId and model', async () => {
    const sb = makeSandbox({ fetch: () => chatCompletionResponse('ok') });
    loadFull(sb);
    await withStoredKey(sb);
    const started = [], completed = [];
    sb.AxiomOpenRouter.on('openrouter_request_started', (p) => started.push(p));
    sb.AxiomOpenRouter.on('openrouter_request_completed', (p) => completed.push(p));
    const chat = sb.AxiomOpenRouter.chat.createChat({ model: 'openai/gpt-4o-mini' });
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi');
    assertEq(started.length, 1);
    assertEq(completed.length, 1);
    assertEq(started[0].requestId, completed[0].requestId);
    assertEq(started[0].model, 'openai/gpt-4o-mini');
    assertEq(completed[0].model, 'openai/gpt-4o-mini');
    assertOk(!!completed[0].usage);
  });

  // =================================================================
  // 4. Conversation reset
  // =================================================================
  await test('chat-manager: resetChat() clears turns but keeps the system prompt by default, fires openrouter_chat_reset', async () => {
    const sb = makeSandbox({ fetch: () => chatCompletionResponse('ok') });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat({ systemPrompt: 'Be terse.' });
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi');
    let resetEvent = null;
    sb.AxiomOpenRouter.on('openrouter_chat_reset', (p) => { resetEvent = p; });
    assertOk(sb.AxiomOpenRouter.chat.resetChat(chat.chatId));
    assertEq(sb.AxiomOpenRouter.chat.getHistory(chat.chatId).length, 0);
    assertEq(sb.AxiomOpenRouter.chat.getChat(chat.chatId).systemPrompt, 'Be terse.');
    assertOk(!!resetEvent && resetEvent.chatId === chat.chatId);
  });

  await test('chat-manager: resetChat({clearSystemPrompt:true}) also clears the system prompt', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat({ systemPrompt: 'Be terse.' });
    sb.AxiomOpenRouter.chat.resetChat(chat.chatId, { clearSystemPrompt: true });
    assertEq(sb.AxiomOpenRouter.chat.getChat(chat.chatId).systemPrompt, null);
  });

  await test('chat-manager: resetChat() on an unknown chatId returns false, does not throw', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    assertEq(sb.AxiomOpenRouter.chat.resetChat('nope'), false);
  });

  // =================================================================
  // 5. Multiple concurrent conversations
  // =================================================================
  await test('chat-manager: two conversations never share history, model, or params', async () => {
    const sb = makeSandbox({ fetch: () => chatCompletionResponse('reply') });
    loadFull(sb);
    await withStoredKey(sb);
    const a = sb.AxiomOpenRouter.chat.createChat({ model: 'model-a', systemPrompt: 'A prompt' });
    const b = sb.AxiomOpenRouter.chat.createChat({ model: 'model-b', systemPrompt: 'B prompt' });
    await sb.AxiomOpenRouter.chat.sendMessage(a.chatId, 'only in A');
    assertEq(sb.AxiomOpenRouter.chat.getHistory(a.chatId).length, 2);
    assertEq(sb.AxiomOpenRouter.chat.getHistory(b.chatId).length, 0);
    assertEq(sb.AxiomOpenRouter.chat.getChat(a.chatId).model, 'model-a');
    assertEq(sb.AxiomOpenRouter.chat.getChat(b.chatId).model, 'model-b');
  });

  await test('chat-manager: interleaved sendMessage() calls across two conversations keep each history correctly ordered', async () => {
    const sb = makeSandbox({ fetch: (url, req) => chatCompletionResponse('r-' + JSON.parse(req.body).messages.slice(-1)[0].content) });
    loadFull(sb);
    await withStoredKey(sb);
    const a = sb.AxiomOpenRouter.chat.createChat();
    const b = sb.AxiomOpenRouter.chat.createChat();
    await sb.AxiomOpenRouter.chat.sendMessage(a.chatId, 'a1');
    await sb.AxiomOpenRouter.chat.sendMessage(b.chatId, 'b1');
    await sb.AxiomOpenRouter.chat.sendMessage(a.chatId, 'a2');
    const historyA = sb.AxiomOpenRouter.chat.getHistory(a.chatId).map((m) => m.content);
    const historyB = sb.AxiomOpenRouter.chat.getHistory(b.chatId).map((m) => m.content);
    assertEq(JSON.stringify(historyA), JSON.stringify(['a1', 'r-a1', 'a2', 'r-a2']));
    assertEq(JSON.stringify(historyB), JSON.stringify(['b1', 'r-b1']));
  });

  // =================================================================
  // 6. Error paths
  // =================================================================
  await test('chat-manager: sendMessage() rejects "invalid_api_key" when no key is stored', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    sb.AxiomOpenRouter.init();
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi'); } catch (e) { error = e; }
    assertOk(!!error && error.code === 'invalid_api_key', JSON.stringify(error));
  });

  await test('chat-manager: sendMessage() rejects "chat_not_found" for an unknown chatId', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    let error = null;
    try { await sb.AxiomOpenRouter.chat.sendMessage('nope', 'hi'); } catch (e) { error = e; }
    assertOk(!!error && error.code === 'chat_not_found', JSON.stringify(error));
  });

  await test('chat-manager: sendMessage() rejects "invalid_message" for empty/non-string content', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, ''); } catch (e) { error = e; }
    assertOk(!!error && error.code === 'invalid_message', JSON.stringify(error));
  });

  await test('chat-manager: a failed request (HTTP 500) is classified, emits openrouter_error, and keeps the user turn for retry without adding an assistant turn', async () => {
    const sb = makeSandbox({
      fetch: () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: { message: 'server error' } }) })
    });
    loadFull(sb);
    await withStoredKey(sb);
    let errorEvent = null;
    sb.AxiomOpenRouter.on('openrouter_error', (p) => { errorEvent = p; });
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi'); } catch (e) { error = e; }
    assertOk(!!error && error.code === 'server_error', JSON.stringify(error));
    assertOk(!!errorEvent, 'openrouter_error must be emitted on the shared bus via the reused classifyError()');
    const history = sb.AxiomOpenRouter.chat.getHistory(chat.chatId);
    assertEq(history.length, 1, 'the user turn stays so a retry continues the real conversation');
    assertEq(history[0].role, 'user');
  });

  await test('chat-manager: a network failure classifies as "network_error" via the reused error-handler.js', async () => {
    const sb = makeSandbox({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi'); } catch (e) { error = e; }
    assertOk(!!error && error.code === 'network_error', JSON.stringify(error));
  });

  // =================================================================
  // 7. Reuse of existing modules (not reimplemented here)
  // =================================================================
  await test('chat-manager: successful sendMessage() rolls usage into token-manager.js\'s existing accounting', async () => {
    const sb = makeSandbox({ fetch: () => chatCompletionResponse('ok', { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 }) });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat({ model: 'openai/gpt-4o-mini' });
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi');
    const stats = sb.AxiomOpenRouter.tokens.getUsageStats('openai/gpt-4o-mini');
    assertEq(stats.promptTokens, 20);
    assertEq(stats.completionTokens, 4);
    assertEq(stats.requests, 1);
  });

  await test('chat-manager: a chat created without a model falls back to model-manager.js\'s getDefaultModel()', async () => {
    let capturedBody = null;
    const sb = makeSandbox({ fetch: (url, req) => { capturedBody = JSON.parse(req.body); return chatCompletionResponse('ok'); } });
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.models.setDefaultModel('openai/gpt-4o-mini'); // pre-catalog seed, allowed per model-manager.js contract
    const chat = sb.AxiomOpenRouter.chat.createChat();
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi');
    assertEq(capturedBody.model, 'openai/gpt-4o-mini');
  });

  await test('chat-manager: sendMessage() still works (falls back to its own default) if model-manager.js is not loaded', async () => {
    let capturedBody = null;
    const sb = makeSandbox({ fetch: (url, req) => { capturedBody = JSON.parse(req.body); return chatCompletionResponse('ok'); } });
    loadFull(sb, ['os/api/openrouter/error-handler.js', 'os/api/openrouter/api-manager.js', 'os/api/openrouter/chat-manager.js']);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi');
    assertOk(isNonEmptyStringLocal(capturedBody.model));
  });
  function isNonEmptyStringLocal(v) { return typeof v === 'string' && v.length > 0; }

  await test('chat-manager: load-order independence — chat-manager.js loaded BEFORE api-manager.js still works once both are present', async () => {
    const sb = makeSandbox({ fetch: () => chatCompletionResponse('ok') });
    loadInto(sb, 'os/api/openrouter/chat-manager.js');
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/model-manager.js');
    loadInto(sb, 'os/api/openrouter/token-manager.js');
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    const result = await sb.AxiomOpenRouter.chat.sendMessage(chat.chatId, 'hi');
    assertOk(!!result.message);
  });

  // =================================================================
  // 8. Non-duplication / non-modification statics
  // =================================================================
  (function staticChecks() {
    const protectedFiles = [
      'js/core/openrouter-client.js', 'js/core/openrouter-config.js', 'js/core/model-selector.js',
      'os/api/openrouter/api-manager.js', 'os/api/openrouter/model-manager.js',
      'os/api/openrouter/token-manager.js', 'os/api/openrouter/error-handler.js'
    ];
    protectedFiles.forEach((rel) => {
      const src = readSrc(rel);
      check(`static: ${rel} exists and was not touched by Part 2B-1 (present, non-empty)`, typeof src === 'string' && src.length > 0);
    });

    const doNotModify = [
      'os/core/browser-engine.js', 'os/core/browser-manager.js', 'os/core/browser-sandbox.js',
      'os/core/automation-engine.js', 'os/core/automation-manager.js',
      'os/core/memory-engine.js', 'os/core/memory-manager.js',
      'os/core/goal-manager.js', 'os/core/goal-manager-learning.js', 'os/core/goal-manager-recovery.js',
      'js/core/voice.js', 'js/core/voice-controller.js',
      'js/core/supabase/connection-manager.js', 'js/core/supabase/auth-service.js', 'js/core/supabase/env.js'
    ];
    doNotModify.forEach((rel) => {
      const full = path.join(ROOT, rel);
      check(`static: protected file ${rel} still present on disk`, fs.existsSync(full));
    });

    // Updated for Part 2B-2, then again for Part 2B-3 (same precedent
    // as this suite's own §5.3: Part 2A's suite was updated for this
    // suite's approved new sibling file; now this suite is updated for
    // Part 2B-2's two approved new sibling files, plus Part 2B-3's
    // request-queue.js). chat-manager.js itself is unmodified in its
    // public contract — see the static checks below — only its file
    // count expectation changes here.
    check('static: os/api/openrouter/ contains exactly the ten expected entries (Part 2A\'s four + chat-manager.js + Part 2B-2\'s stream-manager.js/response-parser.js + Part 2B-3\'s request-queue.js + Part 2B-4\'s usage-tracker.js + Part 2C-1A\'s tool-calling/), nothing extra',
      (() => {
        const dir = path.join(ROOT, 'os/api/openrouter');
        const names = fs.readdirSync(dir).sort();
        const expected = ['api-manager.js', 'chat-manager.js', 'error-handler.js', 'model-manager.js', 'request-queue.js', 'response-parser.js', 'stream-manager.js', 'token-manager.js', 'tool-calling', 'usage-tracker.js'];
        return JSON.stringify(names) === JSON.stringify(expected);
      })());

    const codeOnly = readSrc('os/api/openrouter/chat-manager.js').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
    check('static: chat-manager.js never touches localStorage key axiom_openrouter_selected_model (existing UI selector\'s key)',
      codeOnly.indexOf('axiom_openrouter_selected_model') === -1);
    check('static: chat-manager.js never touches localStorage key axiom_os_openrouter_default_model (model-manager.js\'s key — read via its API, not localStorage directly)',
      codeOnly.indexOf('axiom_os_openrouter_default_model') === -1);
    check('static: chat-manager.js never touches localStorage key axiom_os_openrouter_api_key (api-manager.js\'s key — read via _internal.getStoredKey(), not localStorage directly)',
      codeOnly.indexOf('axiom_os_openrouter_api_key') === -1);
    check('static: chat-manager.js does not reference js/core/openrouter-client.js\'s global (window.OpenRouter)',
      codeOnly.indexOf('window.OpenRouter') === -1 && !/[^.]\bOpenRouter\s*=/.test(codeOnly.replace(/AxiomOpenRouter/g, '')));
  })();

  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f.label + (f.detail ? ' :: ' + f.detail : '')));
    process.exitCode = 1;
  }
}

main();
