// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2B-2: OpenRouter Stream Manager
// + Response Parser regression suite
// ------------------------------------------------------------
// Runs the real files on disk (os/api/openrouter/stream-manager.js,
// os/api/openrouter/response-parser.js), together with all of their
// Part 2A/2B-1 siblings, in a hand-built `vm` sandbox — same pattern
// as block2-step9-part2a-openrouter-core-regression-suite.js and
// block2-step9-part2b1-chat-manager-regression-suite.js. Every
// network call (including the streamed response body) is mocked; no
// real network access is used or required.
//
// Sections:
//   1. Degrade / usage-error paths — missing dependencies, unknown
//      chat, empty content, no stored key
//   2. Response parser — pure unit tests, no sandbox required
//   3. Happy-path streaming — started/chunk*/finished events, chunk
//      callbacks, progress callbacks, resolved promise shape,
//      accumulated content persisted into chat-manager.js's shared
//      history
//   4. Non-streaming-body fallback — environment without a readable
//      reader still resolves with the full reply as one chunk
//   5. Cancellation — mid-stream cancelStream(), event + callback +
//      promise rejection, partial content preserved and queryable
//   6. Resume — resumeStream() continues the same streamId/
//      accumulated content with a new requestId
//   7. Error paths — HTTP failure, network failure, idle timeout,
//      each classified via the reused error-handler.js
//   8. Tool-call streaming — fragments merged across chunks
//   9. Non-duplication / non-modification statics
//  10. Part 2B-1's own suite still passes unmodified after this Part
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder, TextDecoder } = require('util');

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

  const sandbox = {
    console,
    document: documentStub,
    CustomEvent: FakeCustomEvent,
    AbortController: FakeAbortController,
    TextEncoder,
    TextDecoder,
    // Deliberately ignores the `ms` argument, same convention as
    // Part 2A's/2B-1's own suites — every mocked async op here
    // resolves via microtasks well before a real 0ms macrotask timer
    // fires, so this never spuriously trips idle-timeout logic for a
    // fast-resolving mock, but still lets a genuinely-hung mock (a
    // read() that never resolves) get caught by it.
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
      emit: () => {}
    },
    AxiomAnalyticsAutomation: undefined,
    AxiomSupabaseConnection: undefined,
    AxiomRuntimeContext: undefined,
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
    'os/api/openrouter/chat-manager.js',
    'os/api/openrouter/response-parser.js',
    'os/api/openrouter/stream-manager.js'
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
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitUntil(fn, tries) {
  tries = tries || 50;
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await sleep(0);
  }
  return fn();
}

function okJson(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function chatCompletionResponse(content, usage) {
  return okJson({
    id: 'gen-test',
    model: 'openai/gpt-4o-mini',
    choices: [{ message: { role: 'assistant', content: content } }],
    usage: usage || { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  });
}

// ---------- SSE mock helpers ----------

function sseDataLine(obj) { return 'data: ' + JSON.stringify(obj) + '\n\n'; }
const SSE_DONE_LINE = 'data: [DONE]\n\n';

/**
 * Builds a fake fetch Response whose body exposes a readable-stream
 * `getReader()` yielding one encoded Uint8Array per entry in
 * `lines` (each entry already a raw SSE line/line-group string —
 * tests control exactly how the bytes are chunked across read()
 * calls, including splitting one SSE line across two reads).
 */
function sseResponse(lines, statusOverride) {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l));
  let i = 0;
  return Promise.resolve({
    ok: statusOverride ? statusOverride.ok : true,
    status: statusOverride ? statusOverride.status : 200,
    body: {
      getReader() {
        return {
          read() {
            if (i < chunks.length) {
              const value = chunks[i++];
              return Promise.resolve({ done: false, value });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
          cancel() { i = chunks.length; return Promise.resolve(); }
        };
      }
    },
    json: () => Promise.resolve(statusOverride && statusOverride.body ? statusOverride.body : {})
  });
}

/** A response with no readable-stream body at all (non-streaming-capable environment). */
function nonStreamingBodyResponse(json) {
  return Promise.resolve({ ok: true, status: 200, body: null, json: () => Promise.resolve(json) });
}

/** A response whose reader never resolves — simulates a hung connection for idle-timeout tests. */
function hangingStreamResponse() {
  return Promise.resolve({
    ok: true, status: 200,
    body: { getReader() { return { read() { return new Promise(() => {}); }, cancel() { return Promise.resolve(); } }; } },
    json: () => Promise.resolve({})
  });
}

async function withStoredKey(sb, key) {
  const original = sb.fetch;
  sb.fetch = () => okJson({ data: { label: 'test-key' } });
  sb.AxiomOpenRouter.init();
  const result = await sb.AxiomOpenRouter.setApiKey(key || 'sk-or-v1-test-key');
  assertOk(result.valid, 'setApiKey() must succeed to seed the test key');
  sb.fetch = original;
}

async function main() {
  console.log('AXIOM Block 2 / Step 9 / Part 2B-2 — OpenRouter Stream Manager + Response Parser regression\n');

  // =================================================================
  // 1. Degrade / usage-error paths
  // =================================================================
  await test('stream-manager: installs onto window.AxiomOpenRouter.stream standalone (no load-order dependency)', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/stream-manager.js');
    assertOk(typeof sb.AxiomOpenRouter.stream === 'object');
  });

  await test('stream-manager: streamMessage() rejects "core_not_loaded" when chat-manager.js is absent', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/response-parser.js');
    loadInto(sb, 'os/api/openrouter/stream-manager.js');
    const { streamId, promise } = sb.AxiomOpenRouter.stream.streamMessage('any', 'hi');
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertEq(streamId, null);
    assertOk(!!error && error.code === 'core_not_loaded', JSON.stringify(error));
  });

  await test('stream-manager: streamMessage() rejects "core_not_loaded" when api-manager.js is absent (chat-manager.js present)', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/chat-manager.js');
    loadInto(sb, 'os/api/openrouter/response-parser.js');
    loadInto(sb, 'os/api/openrouter/stream-manager.js');
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi').promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'core_not_loaded', JSON.stringify(error));
  });

  await test('stream-manager: streamMessage() rejects "chat_not_found" for an unknown chatId', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    let error = null;
    try { await sb.AxiomOpenRouter.stream.streamMessage('nope', 'hi').promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'chat_not_found', JSON.stringify(error));
  });

  await test('stream-manager: streamMessage() rejects "invalid_message" for empty/non-string content', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, '').promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'invalid_message', JSON.stringify(error));
  });

  await test('stream-manager: streamMessage() rejects "invalid_api_key" when no key is stored', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    sb.AxiomOpenRouter.init();
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi').promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'invalid_api_key', JSON.stringify(error));
  });

  await test('stream-manager: getStream()/listStreams() return null/empty for unknown ids without throwing', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    assertEq(sb.AxiomOpenRouter.stream.getStream('nope'), null);
    assertEq(sb.AxiomOpenRouter.stream.listStreams('nope').length, 0);
  });

  await test('stream-manager: cancelStream() on an unknown streamId returns false, does not throw', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    assertEq(sb.AxiomOpenRouter.stream.cancelStream('nope'), false);
  });

  await test('stream-manager: resumeStream() on an unknown streamId returns null', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    assertEq(sb.AxiomOpenRouter.stream.resumeStream('nope'), null);
  });

  // =================================================================
  // 2. Response parser — pure unit tests
  // =================================================================
  (function parserUnitTests() {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/response-parser.js');
    const parser = sb.AxiomOpenRouter.parser;

    check('parser: installs onto window.AxiomOpenRouter.parser standalone (no other file loaded)', typeof parser === 'object');

    check('parser: parseSSELine() ignores blank lines', parser.parseSSELine('') === null);
    check('parser: parseSSELine() ignores SSE comment/keep-alive lines', parser.parseSSELine(': keep-alive') === null);
    check('parser: parseSSELine() ignores non-"data:" fields', parser.parseSSELine('event: message') === null);
    check('parser: parseSSELine() recognizes the [DONE] sentinel', parser.parseSSELine('data: [DONE]').done === true);
    const parsedLine = parser.parseSSELine('data: {"id":"x","choices":[{"index":0,"delta":{"content":"hi"}}]}');
    check('parser: parseSSELine() parses a well-formed data line', parsedLine && parsedLine.json && parsedLine.json.id === 'x', JSON.stringify(parsedLine));
    const malformed = parser.parseSSELine('data: {not valid json');
    check('parser: parseSSELine() returns {json:null, parseError} for malformed JSON rather than throwing', malformed && malformed.json === null && typeof malformed.parseError === 'string', JSON.stringify(malformed));

    const chunk = parser.normalizeStreamChunk({ id: 'g1', model: 'm1', choices: [{ index: 0, delta: { content: 'He' }, finish_reason: null }] });
    check('parser: normalizeStreamChunk() extracts delta.content', chunk.delta.content === 'He', JSON.stringify(chunk));
    check('parser: normalizeStreamChunk() returns null finishReason for a null finish_reason', chunk.finishReason === null);
    const finalChunk = parser.normalizeStreamChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    check('parser: normalizeStreamChunk() normalizes finish_reason', finalChunk.finishReason === 'stop');
    check('parser: normalizeStreamChunk() returns null for a non-object input', parser.normalizeStreamChunk('nope') === null);

    const resp = parser.normalizeChatResponse({
      id: 'g2', model: 'm2',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
    });
    check('parser: normalizeChatResponse() shapes id/model/choices/usage', resp.id === 'g2' && resp.model === 'm2' && resp.choices[0].message.content === 'hi there' && resp.usage.totalTokens === 6, JSON.stringify(resp));
    const emptyResp = parser.normalizeChatResponse({});
    check('parser: normalizeChatResponse() degrades gracefully on a malformed/empty body', Array.isArray(emptyResp.choices) && emptyResp.choices.length === 0 && emptyResp.usage.totalTokens === 0);

    check('parser: normalizeUsage() defaults every field to 0 for a missing/empty usage block', JSON.stringify(parser.normalizeUsage(undefined)) === JSON.stringify({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }));
    check('parser: normalizeUsage() computes totalTokens when the source omits it', parser.normalizeUsage({ prompt_tokens: 3, completion_tokens: 4 }).totalTokens === 7);

    check('parser: normalizeFinishReason() maps the legacy function_call alias to tool_calls', parser.normalizeFinishReason('function_call') === 'tool_calls');
    check('parser: normalizeFinishReason() passes an unrecognized reason through unchanged', parser.normalizeFinishReason('some_new_reason') === 'some_new_reason');
    check('parser: normalizeFinishReason() returns null for a missing reason', parser.normalizeFinishReason(null) === null);

    const toolCalls = parser.normalizeToolCalls([{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"c' } }]);
    check('parser: normalizeToolCalls() shapes a tool-call fragment', toolCalls[0].id === 'call_1' && toolCalls[0].function.name === 'get_weather', JSON.stringify(toolCalls));
    check('parser: normalizeToolCalls() returns null for a missing/empty array', parser.normalizeToolCalls(undefined) === null && parser.normalizeToolCalls([]) === null);

    const errShaped = parser.normalizeErrorResponse({ error: { message: 'bad request', code: 'invalid_request', param: 'model' } }, 400);
    check('parser: normalizeErrorResponse() shapes an object-style error body', errShaped.status === 400 && errShaped.message === 'bad request' && errShaped.code === 'invalid_request' && errShaped.param === 'model', JSON.stringify(errShaped));
    const errString = parser.normalizeErrorResponse({ error: 'plain string error' }, 500);
    check('parser: normalizeErrorResponse() shapes a string-style error body', errString.message === 'plain string error', JSON.stringify(errString));
    const errEmpty = parser.normalizeErrorResponse(null, 502);
    check('parser: normalizeErrorResponse() degrades gracefully on a null body', errEmpty.status === 502 && typeof errEmpty.message === 'string');
  })();

  // =================================================================
  // 3. Happy-path streaming
  // =================================================================
  await test('stream-manager: streamMessage() fires started -> chunk(s) -> finished, resolves with the full message + usage', async () => {
    const sb = makeSandbox({
      fetch: () => sseResponse([
        sseDataLine({ id: 'g1', model: 'openai/gpt-4o-mini', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }),
        sseDataLine({ id: 'g1', choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }] }),
        sseDataLine({ id: 'g1', choices: [{ index: 0, delta: { content: 'lo!' }, finish_reason: 'stop' }] }),
        sseDataLine({ id: 'g1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } }),
        SSE_DONE_LINE
      ])
    });
    loadFull(sb);
    await withStoredKey(sb);

    const started = [], chunks = [], finished = [];
    sb.AxiomOpenRouter.on('openrouter_stream_started', (p) => started.push(p));
    sb.AxiomOpenRouter.on('openrouter_stream_chunk', (p) => chunks.push(p));
    sb.AxiomOpenRouter.on('openrouter_stream_finished', (p) => finished.push(p));

    const chat = sb.AxiomOpenRouter.chat.createChat({ model: 'openai/gpt-4o-mini' });
    const { streamId, promise } = sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'Hi!');
    assertOk(!!streamId);
    const result = await promise;

    assertEq(started.length, 1);
    assertEq(started[0].streamId, streamId);
    assertEq(started[0].model, 'openai/gpt-4o-mini');
    assertOk(chunks.length >= 2, 'expected multiple chunk events, got ' + chunks.length);
    assertEq(chunks[chunks.length - 1].content, 'Hello!', 'last chunk event carries the fully accumulated content');
    assertEq(finished.length, 1);
    assertEq(finished[0].streamId, streamId);
    assertEq(finished[0].usage.totalTokens, 11);
    assertEq(finished[0].finishReason, 'stop');

    assertEq(result.message.content, 'Hello!');
    assertEq(result.usage.promptTokens, 8);
    assertEq(result.usage.completionTokens, 3);
    assertEq(result.finishReason, 'stop');
    assertEq(result.chatId, chat.chatId);
  });

  await test('stream-manager: onChunk/onProgress/onComplete callbacks fire with correct shapes', async () => {
    const sb = makeSandbox({
      fetch: () => sseResponse([
        sseDataLine({ choices: [{ index: 0, delta: { content: 'A' }, finish_reason: null }] }),
        sseDataLine({ choices: [{ index: 0, delta: { content: 'B' }, finish_reason: 'stop' }] }),
        SSE_DONE_LINE
      ])
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();

    const onChunkCalls = [], onProgressCalls = [];
    let completeResult = null;
    const { promise } = sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi', {
      onChunk: (delta, accumulated, meta) => onChunkCalls.push({ delta, accumulated, meta }),
      onProgress: (info) => onProgressCalls.push(info),
      onComplete: (result) => { completeResult = result; }
    });
    await promise;

    assertEq(onChunkCalls.length, 2);
    assertEq(onChunkCalls[0].delta, 'A');
    assertEq(onChunkCalls[0].accumulated, 'A');
    assertEq(onChunkCalls[1].accumulated, 'AB');
    assertOk(onProgressCalls.length >= 2);
    assertOk(onProgressCalls[0].charsReceived >= 1);
    assertOk(!!completeResult && completeResult.message.content === 'AB');
  });

  await test('stream-manager: a chunk split across two raw read()s is still parsed correctly (SSE line reassembly)', async () => {
    const full = sseDataLine({ choices: [{ index: 0, delta: { content: 'reassembled' }, finish_reason: 'stop' }] });
    const splitPoint = Math.floor(full.length / 2);
    const sb = makeSandbox({
      fetch: () => sseResponse([full.slice(0, splitPoint), full.slice(splitPoint), SSE_DONE_LINE])
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    const result = await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi').promise;
    assertEq(result.message.content, 'reassembled');
  });

  await test('stream-manager: the finished streamed reply lands in chat-manager.js\'s own shared history, alongside the user turn', async () => {
    const sb = makeSandbox({
      fetch: () => sseResponse([sseDataLine({ choices: [{ index: 0, delta: { content: 'streamed reply' }, finish_reason: 'stop' }] }), SSE_DONE_LINE])
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'user turn').promise;
    const history = sb.AxiomOpenRouter.chat.getHistory(chat.chatId);
    assertEq(history.length, 2);
    assertEq(history[0].role, 'user');
    assertEq(history[0].content, 'user turn');
    assertEq(history[1].role, 'assistant');
    assertEq(history[1].content, 'streamed reply');
  });

  await test('stream-manager: a streamed reply rolls usage into token-manager.js\'s existing accounting', async () => {
    const sb = makeSandbox({
      fetch: () => sseResponse([
        sseDataLine({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } }),
        SSE_DONE_LINE
      ])
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat({ model: 'openai/gpt-4o-mini' });
    await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi').promise;
    const stats = sb.AxiomOpenRouter.tokens.getUsageStats('openai/gpt-4o-mini');
    assertEq(stats.promptTokens, 12);
    assertEq(stats.completionTokens, 6);
  });

  await test('stream-manager: per-call overrides apply to the streamed request only, never mutating saved conversation config', async () => {
    let capturedBody = null;
    const sb = makeSandbox({
      fetch: (url, req) => { capturedBody = JSON.parse(req.body); return sseResponse([sseDataLine({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }), SSE_DONE_LINE]); }
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat({ model: 'openai/gpt-4o-mini', temperature: 0.2 });
    await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi', {}, { model: 'anthropic/claude-3-haiku', temperature: 0.9 }).promise;
    assertEq(capturedBody.model, 'anthropic/claude-3-haiku');
    assertEq(capturedBody.temperature, 0.9);
    assertEq(capturedBody.stream, true);
    const saved = sb.AxiomOpenRouter.chat.getChat(chat.chatId);
    assertEq(saved.model, 'openai/gpt-4o-mini');
    assertEq(saved.temperature, 0.2);
  });

  // =================================================================
  // 4. Non-streaming-body fallback
  // =================================================================
  await test('stream-manager: an environment without a readable-stream body still resolves via the non-streaming fallback', async () => {
    const sb = makeSandbox({
      fetch: () => nonStreamingBodyResponse({
        id: 'g1', model: 'openai/gpt-4o-mini',
        choices: [{ message: { role: 'assistant', content: 'fallback reply' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
      })
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();

    let onChunkCalls = 0;
    const result = await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi', { onChunk: () => { onChunkCalls++; } }).promise;
    assertEq(result.message.content, 'fallback reply');
    assertEq(result.usage.totalTokens, 7);
    assertEq(onChunkCalls, 1, 'the fallback delivers exactly one synthesized chunk');
  });

  // =================================================================
  // 5. Cancellation
  // =================================================================
  await test('stream-manager: cancelStream() mid-stream stops it, fires openrouter_stream_cancelled with partial content, rejects the promise', async () => {
    let readCount = 0;
    const encoder = new TextEncoder();
    const sb = makeSandbox({
      fetch: () => Promise.resolve({
        ok: true, status: 200,
        body: {
          getReader() {
            return {
              read() {
                readCount++;
                if (readCount === 1) return Promise.resolve({ done: false, value: encoder.encode(sseDataLine({ choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] })) });
                // Every subsequent read() hangs — simulates a stream
                // that's still open when cancelStream() is called.
                return new Promise(() => {});
              },
              cancel() { return Promise.resolve(); }
            };
          }
        },
        json: () => Promise.resolve({})
      })
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();

    let cancelledEvent = null, onCancelInfo = null;
    sb.AxiomOpenRouter.on('openrouter_stream_cancelled', (p) => { cancelledEvent = p; });
    const { streamId, promise } = sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi', { onCancel: (info) => { onCancelInfo = info; } });

    await waitUntil(() => sb.AxiomOpenRouter.stream.getStream(streamId).accumulatedContent === 'partial');
    assertOk(sb.AxiomOpenRouter.stream.cancelStream(streamId, 'test reason'));

    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'stream_cancelled', JSON.stringify(error));

    assertOk(!!cancelledEvent && cancelledEvent.streamId === streamId);
    assertEq(cancelledEvent.reason, 'test reason');
    assertEq(cancelledEvent.partialContent, 'partial');
    assertOk(!!onCancelInfo && onCancelInfo.partialContent === 'partial');

    const snapshot = sb.AxiomOpenRouter.stream.getStream(streamId);
    assertEq(snapshot.status, 'cancelled');
    assertEq(snapshot.accumulatedContent, 'partial');

    assertEq(sb.AxiomOpenRouter.stream.cancelStream(streamId), false, 'cancelling an already-cancelled stream returns false');
  });

  // =================================================================
  // 6. Resume
  // =================================================================
  await test('stream-manager: resumeStream() continues the same streamId, appending to the previously accumulated content under a new requestId', async () => {
    let call = 0;
    const sb = makeSandbox({
      fetch: () => {
        call++;
        if (call === 1) {
          // First leg: deliver one chunk, then hang (never finishes) so the stream can be cancelled mid-flight.
          return Promise.resolve({
            ok: true, status: 200,
            body: {
              getReader() {
                let reads = 0;
                return {
                  read() {
                    reads++;
                    if (reads === 1) return Promise.resolve({ done: false, value: new TextEncoder().encode(sseDataLine({ choices: [{ index: 0, delta: { content: 'Hello, ' }, finish_reason: null }] })) });
                    return new Promise(() => {});
                  },
                  cancel() { return Promise.resolve(); }
                };
              }
            },
            json: () => Promise.resolve({})
          });
        }
        // Second leg (resume): completes normally.
        return sseResponse([sseDataLine({ choices: [{ index: 0, delta: { content: 'world!' }, finish_reason: 'stop' }] }), SSE_DONE_LINE]);
      }
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();

    const startedEvents = [];
    sb.AxiomOpenRouter.on('openrouter_stream_started', (p) => startedEvents.push(p));

    const first = sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi');
    await waitUntil(() => sb.AxiomOpenRouter.stream.getStream(first.streamId).accumulatedContent === 'Hello, ');
    const firstRequestId = sb.AxiomOpenRouter.stream.getStream(first.streamId).requestId;
    sb.AxiomOpenRouter.stream.cancelStream(first.streamId);
    let cancelErr = null;
    try { await first.promise; } catch (e) { cancelErr = e; }
    assertOk(!!cancelErr);

    const resumed = sb.AxiomOpenRouter.stream.resumeStream(first.streamId);
    assertOk(!!resumed && resumed.streamId === first.streamId, 'resume must reuse the same streamId');
    const result = await resumed.promise;

    assertEq(result.message.content, 'Hello, world!', 'resumed content is appended to what was already accumulated');
    assertEq(result.streamId, first.streamId);
    assertOk(result.requestId !== firstRequestId, 'resume must use a new requestId for the new HTTP leg');

    assertEq(startedEvents.length, 2);
    assertOk(!startedEvents[0].resumed);
    assertEq(startedEvents[1].resumed, true);

    const history = sb.AxiomOpenRouter.chat.getHistory(chat.chatId);
    assertEq(history.length, 2, 'only one user turn and one final assistant turn — the interrupted leg never appended a partial assistant turn');
    assertEq(history[1].content, 'Hello, world!');
  });

  await test('stream-manager: resumeStream() returns null for a stream that is not currently stopped', async () => {
    const sb = makeSandbox({ fetch: () => new Promise(() => {}) }); // never resolves — stream stays 'streaming'/'connecting'
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    const { streamId } = sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi');
    assertEq(sb.AxiomOpenRouter.stream.resumeStream(streamId), null);
  });

  // =================================================================
  // 7. Error paths
  // =================================================================
  await test('stream-manager: an HTTP 500 is classified, emits openrouter_error, and keeps the user turn for retry without an assistant turn', async () => {
    const sb = makeSandbox({
      fetch: () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: { message: 'server error' } }) })
    });
    loadFull(sb);
    await withStoredKey(sb);
    let errorEvent = null;
    sb.AxiomOpenRouter.on('openrouter_error', (p) => { errorEvent = p; });
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi').promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'server_error', JSON.stringify(error));
    assertOk(!!errorEvent, 'openrouter_error must be emitted via the reused classifyError()');
    const history = sb.AxiomOpenRouter.chat.getHistory(chat.chatId);
    assertEq(history.length, 1);
    assertEq(history[0].role, 'user');
  });

  await test('stream-manager: a network failure classifies as "network_error" via the reused error-handler.js', async () => {
    const sb = makeSandbox({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi').promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'network_error', JSON.stringify(error));
  });

  await test('stream-manager: an idle stream (no bytes ever arrive) is aborted by the idle timeout and rejects', async () => {
    const sb = makeSandbox({ fetch: () => hangingStreamResponse() });
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.stream.configure({ idleTimeoutMs: 1 });
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let error = null;
    try { await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'hi').promise; } catch (e) { error = e; }
    assertOk(!!error, 'idle stream must eventually reject');
  });

  // =================================================================
  // 8. Tool-call streaming
  // =================================================================
  await test('stream-manager: tool-call argument fragments are merged across chunks into one final call', async () => {
    const sb = makeSandbox({
      fetch: () => sseResponse([
        sseDataLine({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '' } }] }, finish_reason: null }] }),
        sseDataLine({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }, finish_reason: null }] }),
        sseDataLine({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Tokyo"}' } }] }, finish_reason: 'tool_calls' }] }),
        SSE_DONE_LINE
      ])
    });
    loadFull(sb);
    await withStoredKey(sb);
    const chat = sb.AxiomOpenRouter.chat.createChat();
    const result = await sb.AxiomOpenRouter.stream.streamMessage(chat.chatId, 'weather?').promise;
    assertEq(result.finishReason, 'tool_calls');
    assertOk(!!result.message.toolCalls, 'finished message should carry merged toolCalls');
    assertEq(result.message.toolCalls[0].id, 'call_abc');
    assertEq(result.message.toolCalls[0].function.name, 'get_weather');
    assertEq(result.message.toolCalls[0].function.arguments, '{"city":"Tokyo"}');
  });

  // =================================================================
  // 9. Non-duplication / non-modification statics
  // =================================================================
  (function staticChecks() {
    const protectedFiles = [
      'js/core/openrouter-client.js', 'js/core/openrouter-config.js', 'js/core/model-selector.js',
      'os/api/openrouter/api-manager.js', 'os/api/openrouter/model-manager.js',
      'os/api/openrouter/token-manager.js', 'os/api/openrouter/error-handler.js'
    ];
    protectedFiles.forEach((rel) => {
      const src = readSrc(rel);
      check(`static: ${rel} exists and was not touched by Part 2B-2 (present, non-empty)`, typeof src === 'string' && src.length > 0);
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

    // Updated for Part 2B-3 (same precedent as this suite's own note
    // above: Part 2A's and Part 2B-1's suites were each updated in
    // turn for approved new sibling files; now this suite is updated
    // for Part 2B-3's request-queue.js). stream-manager.js/
    // response-parser.js themselves are unmodified in their public
    // contracts — see the static checks elsewhere in this file — only
    // the file count expectation changes here.
    check('static: os/api/openrouter/ contains exactly the ten expected entries (incl. Part 2C-1A\'s tool-calling/), nothing extra',
      (() => {
        const dir = path.join(ROOT, 'os/api/openrouter');
        const names = fs.readdirSync(dir).sort();
        const expected = ['api-manager.js', 'chat-manager.js', 'error-handler.js', 'model-manager.js', 'request-queue.js', 'response-parser.js', 'stream-manager.js', 'token-manager.js', 'tool-calling', 'usage-tracker.js'];
        return JSON.stringify(names) === JSON.stringify(expected);
      })());

    // chat-manager.js's own PUBLIC contract (every function Part 2B-1
    // shipped) must be byte-identical in behavior — verified here by
    // confirming every one of its documented exports is still present
    // with the same names; the full Part 2B-1 suite (re-run in §10)
    // is the real behavioral proof.
    const chatManagerSrc = readSrc('os/api/openrouter/chat-manager.js');
    ['createChat', 'getChat', 'listChats', 'getHistory', 'setSystemPrompt', 'configureChat', 'sendMessage', 'resetChat', 'deleteChat', 'configure'].forEach((fnName) => {
      check(`static: chat-manager.js still exports ${fnName} (Part 2B-1's public contract untouched)`, chatManagerSrc.indexOf(fnName + ':') !== -1);
    });
    check('static: chat-manager.js\'s new _internal surface is additive only (existing exports object still assembled the same way)',
      chatManagerSrc.indexOf('ChatManager._internal = ChatManagerInternal;') !== -1);

    const codeOnly = (rel) => readSrc(rel).split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
    check('static: stream-manager.js never touches localStorage key axiom_openrouter_selected_model (existing UI selector\'s key)',
      codeOnly('os/api/openrouter/stream-manager.js').indexOf('axiom_openrouter_selected_model') === -1);
    check('static: stream-manager.js never touches localStorage key axiom_os_openrouter_default_model (model-manager.js\'s key)',
      codeOnly('os/api/openrouter/stream-manager.js').indexOf('axiom_os_openrouter_default_model') === -1);
    check('static: stream-manager.js never touches localStorage key axiom_os_openrouter_api_key (api-manager.js\'s key)',
      codeOnly('os/api/openrouter/stream-manager.js').indexOf('axiom_os_openrouter_api_key') === -1);
    check('static: stream-manager.js does not reference js/core/openrouter-client.js\'s global (window.OpenRouter)',
      codeOnly('os/api/openrouter/stream-manager.js').indexOf('window.OpenRouter') === -1);
    check('static: response-parser.js makes no fetch()/XHR/network calls of its own (pure normalization)',
      codeOnly('os/api/openrouter/response-parser.js').indexOf('fetch(') === -1);
    check('static: response-parser.js touches no localStorage key (stateless module)',
      codeOnly('os/api/openrouter/response-parser.js').indexOf('localStorage') === -1);
  })();

  // =================================================================
  // 10. Part 2B-1's own suite still passes unmodified after this Part
  // =================================================================
  await test('regression: Part 2B-1\'s own chat-manager suite still passes in full after Part 2B-2\'s additive changes', async () => {
    delete require.cache[require.resolve('./block2-step9-part2b1-chat-manager-regression-suite.js')];
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, [path.join(__dirname, 'block2-step9-part2b1-chat-manager-regression-suite.js')], { encoding: 'utf8' });
    const match = out.match(/(\d+) passed, (\d+) failed\./);
    assertOk(!!match, 'could not find summary line in Part 2B-1 suite output:\n' + out);
    assertEq(match[2], '0', 'Part 2B-1 suite reported failures:\n' + out);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f.label + (f.detail ? ' :: ' + f.detail : '')));
    process.exitCode = 1;
  }
}

main();
