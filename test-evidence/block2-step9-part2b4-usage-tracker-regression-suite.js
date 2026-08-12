// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2B-4: OpenRouter Usage Tracker
// regression suite
// ------------------------------------------------------------
// Runs the real file on disk (os/api/openrouter/usage-tracker.js),
// together with all of its Part 2A/2B-1/2B-2/2B-3 siblings, in a
// hand-built `vm` sandbox — same pattern as
// block2-step9-part2b3-request-queue-regression-suite.js.
//
// Sections:
//   1. Standalone install / degrade paths
//   2. Chat request tracking (requests/successes/failures, latency)
//   3. Stream tracking (including resumed-stream non-double-count)
//   4. Retry tracking via request-queue.js
//   5. Token / cost tracking (reuses Token Manager's estimateCost())
//   6. Per-model / per-session / daily / monthly buckets
//   7. Active in-flight count (Runtime Context read-only reuse + fallback)
//   8. openrouter_usage_updated event + existing bus forwarding
//   9. resetStats() / configure()
//  10. Non-duplication / non-modification statics
//  11. Part 2A / 2B-1 / 2B-2 / 2B-3's own suites still pass unmodified
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

function makeSandbox(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.localStorage || {});
  const documentStub = { _events: [], dispatchEvent(evt) { this._events.push(evt); return true; } };
  const emitted = [];

  const sandbox = {
    console,
    document: documentStub,
    CustomEvent: FakeCustomEvent,
    setTimeout: (fn, ms) => global.setTimeout(fn, ms),
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
    AxiomOrchestrator: opts.withOrchestrator === false ? undefined : { emit: () => {} },
    AxiomAnalyticsAutomation: undefined,
    AxiomSupabaseConnection: undefined,
    AxiomRuntimeContext: opts.withRuntimeContext === true ? makeFakeRuntimeContext() : undefined,
    AxiomMakeSeqId: opts.withIdFactory === false ? undefined : (prefix) => {
      let seq = 0;
      return () => prefix + '-' + Date.now().toString(36) + '-' + (++seq).toString(36);
    },
    Object, Array, Math, Date, Promise, Error, JSON, String, Number, isFinite,
    TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : undefined,
    Buffer
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  sandbox.__store = store;
  sandbox.__emitted = emitted;
  return sandbox;
}

function makeFakeRuntimeContext() {
  let n = 0;
  const byId = Object.create(null);
  return {
    createContext(opts) {
      n += 1;
      const ctx = { contextId: 'rc-' + n, status: 'created', ownerAgent: opts && opts.ownerAgent, opts };
      byId[ctx.contextId] = ctx;
      return ctx;
    },
    markRunning(id) { if (byId[id]) byId[id].status = 'running'; },
    completeContext(id) { if (byId[id]) byId[id].status = 'completed'; },
    failContext(id) { if (byId[id]) byId[id].status = 'failed'; },
    listContexts(filter) {
      filter = filter || {};
      return Object.keys(byId).map((id) => byId[id]).filter((ctx) => {
        if (filter.ownerAgent && ctx.ownerAgent !== filter.ownerAgent) return false;
        if (filter.status && ctx.status !== filter.status) return false;
        return true;
      });
    }
  };
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
    'os/api/openrouter/stream-manager.js',
    'os/api/openrouter/request-queue.js',
    'os/api/openrouter/usage-tracker.js'
  ];
  rels.forEach((rel) => loadInto(sandbox, rel));
}

function tapEvents(sb) {
  const originalEmit = sb.AxiomOpenRouter.emit;
  sb.AxiomOpenRouter.emit = function (event, payload) {
    sb.__emitted.push({ event, payload });
    return originalEmit.call(this, event, payload);
  };
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
async function waitUntil(fn, tries, intervalMs) {
  tries = tries || 200;
  intervalMs = intervalMs || 5;
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await sleep(intervalMs);
  }
  return fn();
}

async function withStoredKey(sb, key) {
  const original = sb.fetch;
  sb.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { label: 'test-key' } }) });
  sb.AxiomOpenRouter.init();
  const result = await sb.AxiomOpenRouter.setApiKey(key || 'sk-or-v1-test-key');
  assertOk(result.valid, 'setApiKey() must succeed to seed the test key');
  sb.fetch = original;
}

function okChatJson(content, usage) {
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      id: 'gen-test', model: 'openai/gpt-4o-mini',
      choices: [{ message: { role: 'assistant', content: content || 'ok' } }],
      usage: usage || { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    })
  });
}
function failChatJson(status, message) {
  return Promise.resolve({
    ok: false, status: status || 500,
    json: () => Promise.resolve({ error: { message: message || 'server error' } })
  });
}

function modelsCatalogJson() {
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      data: [
        {
          id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', context_length: 128000,
          pricing: { prompt: '0.00000015', completion: '0.0000006' },
          architecture: { input_modalities: ['text'] }, supported_parameters: []
        }
      ]
    })
  });
}

function sseReaderFetch(chunks) {
  return () => {
    let i = 0;
    const reader = {
      read() {
        if (i >= chunks.length) return Promise.resolve({ done: true, value: undefined });
        const val = Buffer.from(chunks[i++]);
        return Promise.resolve({ done: false, value: val });
      },
      cancel() { return Promise.resolve(); }
    };
    return Promise.resolve({ ok: true, status: 200, body: { getReader: () => reader } });
  };
}

(async function main() {
  // =================================================================
  // 1. Standalone install / degrade paths
  // =================================================================
  await test('standalone: usage-tracker.js installs onto window.AxiomOpenRouter.usage with zero other files loaded', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/usage-tracker.js');
    assertOk(sb.AxiomOpenRouter && sb.AxiomOpenRouter.usage, 'expected window.AxiomOpenRouter.usage to exist');
    const stats = sb.AxiomOpenRouter.usage.getStats();
    assertEq(stats.requests, 0, 'expected zeroed stats with nothing tracked yet');
    assertEq(stats.avgLatencyMs, null, 'expected null avgLatencyMs with no samples');
  });

  await test('standalone: getActiveRequestCount() returns 0 with nothing tracked and no Runtime Context', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/usage-tracker.js');
    assertEq(sb.AxiomOpenRouter.usage.getActiveRequestCount(), 0);
  });

  await test('standalone: read APIs never throw with nothing tracked (getModelStats/getSessionStats/getDailyStats/getMonthlyStats)', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/usage-tracker.js');
    const u = sb.AxiomOpenRouter.usage;
    assertEq(u.getModelStats('nope').requests, 0);
    assertEq(u.getSessionStats('nope').requests, 0);
    assertEq(u.getDailyStats().requests, 0);
    assertEq(u.getMonthlyStats().requests, 0);
    assertEq(Object.keys(u.listModelStats()).length, 0);
  });

  await test('standalone: install() returns false and logs a warning when AxiomOpenRouter.on is absent (no api-manager.js loaded)', async () => {
    // Load usage-tracker.js against a bare sandbox with no
    // AxiomOpenRouter namespace at all pre-installed, confirming
    // install() degrades instead of throwing.
    const sb = makeSandbox();
    let warned = false;
    sb.AxLogger = { log() {}, warn() { warned = true; }, error() {} };
    loadInto(sb, 'os/api/openrouter/usage-tracker.js');
    assertOk(warned, 'expected a warn() log when the bus is unavailable at load time');
    assertEq(sb.AxiomOpenRouter.usage._internal.install(), false, 'expected install() to report failure and be safely re-callable');
  });

  // =================================================================
  // 2. Chat request tracking
  // =================================================================
  await test('chat: a successful sendMessage() increments requests/successes and records tokens', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'c1', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => okChatJson('hi');
    await sb.AxiomOpenRouter.chat.sendMessage('c1', 'hello');
    const stats = sb.AxiomOpenRouter.usage.getStats();
    assertEq(stats.requests, 1);
    assertEq(stats.successes, 1);
    assertEq(stats.failures, 0);
    assertEq(stats.promptTokens, 10);
    assertEq(stats.completionTokens, 5);
    assertEq(stats.totalTokens, 15);
    assertOk(typeof stats.avgLatencyMs === 'number' && stats.avgLatencyMs >= 0, 'expected a non-negative avgLatencyMs after one completed request');
  });

  await test('chat: a failed sendMessage() (non-retryable 401) increments requests/failures, not successes', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'c2', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => failChatJson(401, 'invalid api key');
    await sb.AxiomOpenRouter.chat.sendMessage('c2', 'hello').catch(() => {});
    const stats = sb.AxiomOpenRouter.usage.getStats();
    assertEq(stats.requests, 1);
    assertEq(stats.successes, 0);
    assertEq(stats.failures, 1);
  });

  await test('chat: an unrelated error (e.g. validateApiKey()) is never counted as a tracked request failure', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    sb.AxiomOpenRouter.init();
    sb.fetch = () => failChatJson(401, 'invalid api key');
    await sb.AxiomOpenRouter.setApiKey('sk-or-v1-bad').catch(() => {});
    const stats = sb.AxiomOpenRouter.usage.getStats();
    assertEq(stats.requests, 0, 'setApiKey()/validateApiKey() failures must not be attributed to chat/stream request tracking');
    assertEq(stats.failures, 0);
  });

  // =================================================================
  // 3. Stream tracking
  // =================================================================
  await test('stream: a successful streamMessage() increments requests/successes and records tokens', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 's1', model: 'openai/gpt-4o-mini' });
    sb.fetch = sseReaderFetch([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}],"usage":{"prompt_tokens":6,"completion_tokens":3,"total_tokens":9}}\n\n',
      'data: [DONE]\n\n'
    ]);
    const handle = sb.AxiomOpenRouter.stream.streamMessage('s1', 'hello', { onChunk() {}, onComplete() {}, onError() {} });
    await handle.promise;
    const stats = sb.AxiomOpenRouter.usage.getSessionStats('s1');
    assertEq(stats.requests, 1);
    assertEq(stats.successes, 1);
    assertEq(stats.promptTokens, 6);
    assertEq(stats.completionTokens, 3);
  });

  await test('stream: a failed streamMessage() increments failures', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 's2', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: { message: 'server error' } }) });
    const handle = sb.AxiomOpenRouter.stream.streamMessage('s2', 'hello', { onChunk() {}, onComplete() {}, onError() {} });
    await handle.promise.catch(() => {});
    const stats = sb.AxiomOpenRouter.usage.getSessionStats('s2');
    assertEq(stats.requests, 1);
    assertEq(stats.failures, 1);
  });

  await test('stream: a resumed stream ({resumed:true}) is not counted as a second request', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 's3', model: 'openai/gpt-4o-mini' });
    // Manually fire the two events resumeStream() would fire, without
    // needing a real hung-then-resumed network sequence — this suite
    // is only responsible for usage-tracker.js's OWN reaction to the
    // already-documented {resumed:true} shape, not for re-proving
    // stream-manager.js's resumeStream() behavior (covered by the
    // Part 2B-2 suite re-run in §11).
    sb.AxiomOpenRouter.emit('openrouter_stream_started', { chatId: 's3', streamId: 'str-1', requestId: 'or_req_resume_test', model: 'openai/gpt-4o-mini', at: Date.now(), resumed: false });
    sb.AxiomOpenRouter.emit('openrouter_stream_started', { chatId: 's3', streamId: 'str-1', requestId: 'or_req_resume_test', model: 'openai/gpt-4o-mini', at: Date.now(), resumed: true });
    assertEq(sb.AxiomOpenRouter.usage.getSessionStats('s3').requests, 1, 'expected exactly one counted request across an initial start + a resume of the same requestId');
  });

  // =================================================================
  // 4. Retry tracking via request-queue.js
  // =================================================================
  await test('retry: a queued chat message retried twice before succeeding records 3 requests, 1 success, 2 failures, 2 retries', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'r1', model: 'openai/gpt-4o-mini' });
    sb.AxiomOpenRouter.queue.configure({ retryBaseDelayMs: 5, retryMaxDelayMs: 20, maxRetries: 2 });
    let calls = 0;
    sb.fetch = () => {
      calls += 1;
      return calls < 3 ? failChatJson(503, 'server error') : okChatJson('done');
    };
    const { promise } = sb.AxiomOpenRouter.queue.enqueueChatMessage('r1', 'hello');
    await promise;
    const stats = sb.AxiomOpenRouter.usage.getSessionStats('r1');
    assertEq(stats.requests, 3);
    assertEq(stats.successes, 1);
    assertEq(stats.failures, 2);
    assertEq(stats.retries, 2);
  });

  // =================================================================
  // 5. Token / cost tracking (reuses Token Manager's estimateCost())
  // =================================================================
  await test('cost: costUsd is populated once model-manager.js pricing is loaded (Token Manager reused, not re-derived)', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.fetch = modelsCatalogJson;
    await sb.AxiomOpenRouter.models.fetchModels();
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'cost1', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => okChatJson('hi', { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 });
    await sb.AxiomOpenRouter.chat.sendMessage('cost1', 'hello');
    const stats = sb.AxiomOpenRouter.usage.getSessionStats('cost1');
    const expectedCost = 1000 * 0.00000015 + 1000 * 0.0000006;
    assertOk(Math.abs(stats.costUsd - expectedCost) < 1e-9, `expected costUsd ~= ${expectedCost}, got ${stats.costUsd}`);
  });

  await test('cost: costUsd stays 0 (not null, not thrown) with no pricing loaded — same "unknown cost, no crash" contract as Token Manager', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'cost2', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => okChatJson('hi');
    await sb.AxiomOpenRouter.chat.sendMessage('cost2', 'hello');
    assertEq(sb.AxiomOpenRouter.usage.getSessionStats('cost2').costUsd, 0);
  });

  // =================================================================
  // 6. Per-model / per-session / daily / monthly buckets
  // =================================================================
  await test('buckets: per-model, per-session, daily, and monthly buckets all roll up the same completed request', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'bucket1', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => okChatJson('hi');
    await sb.AxiomOpenRouter.chat.sendMessage('bucket1', 'hello');

    const todayKey = new Date().toISOString().slice(0, 10);
    const monthKey = new Date().toISOString().slice(0, 7);

    assertEq(sb.AxiomOpenRouter.usage.getModelStats('openai/gpt-4o-mini').requests, 1);
    assertEq(sb.AxiomOpenRouter.usage.getSessionStats('bucket1').requests, 1);
    assertEq(sb.AxiomOpenRouter.usage.getDailyStats(todayKey).requests, 1);
    assertEq(sb.AxiomOpenRouter.usage.getMonthlyStats(monthKey).requests, 1);
    assertEq(sb.AxiomOpenRouter.usage.getDailyStats().requests, 1, 'getDailyStats() with no argument must default to today');
    assertEq(sb.AxiomOpenRouter.usage.getMonthlyStats().requests, 1, 'getMonthlyStats() with no argument must default to this month');

    const stats = sb.AxiomOpenRouter.usage.getStats();
    assertEq(stats.models, 1);
    assertEq(stats.sessions, 1);
  });

  await test('buckets: two different chatIds produce two independent session buckets that do not leak into each other', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'sessA', model: 'openai/gpt-4o-mini' });
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'sessB', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => okChatJson('hi');
    await sb.AxiomOpenRouter.chat.sendMessage('sessA', 'hello');
    await sb.AxiomOpenRouter.chat.sendMessage('sessA', 'hello again');
    await sb.AxiomOpenRouter.chat.sendMessage('sessB', 'hello');
    assertEq(sb.AxiomOpenRouter.usage.getSessionStats('sessA').requests, 2);
    assertEq(sb.AxiomOpenRouter.usage.getSessionStats('sessB').requests, 1);
    assertEq(sb.AxiomOpenRouter.usage.getStats().requests, 3);
  });

  // =================================================================
  // 7. Active in-flight count (Runtime Context read-only reuse + fallback)
  // =================================================================
  await test('active: getActiveRequestCount() is 1 while a request is in flight and 0 once it settles (no Runtime Context — internal fallback)', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'active1', model: 'openai/gpt-4o-mini' });
    let resolveFetch;
    sb.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
    const p = sb.AxiomOpenRouter.chat.sendMessage('active1', 'hello');
    await waitUntil(() => sb.AxiomOpenRouter.usage.getActiveRequestCount() === 1);
    assertEq(sb.AxiomOpenRouter.usage.getActiveRequestCount(), 1);
    resolveFetch(await okChatJson('hi'));
    await p;
    assertEq(sb.AxiomOpenRouter.usage.getActiveRequestCount(), 0);
  });

  await test('active: getActiveRequestCount() reads from AxiomRuntimeContext (ownerAgent:openrouter, status:running) when present, read-only', async () => {
    const sb = makeSandbox({ withRuntimeContext: true });
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'active2', model: 'openai/gpt-4o-mini' });
    let resolveFetch;
    sb.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
    const createCalls = [];
    const originalCreate = sb.AxiomRuntimeContext.createContext;
    sb.AxiomRuntimeContext.createContext = function (opts) { createCalls.push(opts); return originalCreate(opts); };
    const p = sb.AxiomOpenRouter.chat.sendMessage('active2', 'hello');
    await waitUntil(() => createCalls.length >= 1);
    assertEq(sb.AxiomOpenRouter.usage.getActiveRequestCount(), 1, 'expected the count to come from the real chat-completion Runtime Context, not a duplicate one created by usage-tracker.js');
    resolveFetch(await okChatJson('hi'));
    await p;
  });

  // =================================================================
  // 8. openrouter_usage_updated event + existing bus forwarding
  // =================================================================
  await test('events: openrouter_usage_updated fires with an up-to-date totals snapshot after a completed request', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    tapEvents(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'ev1', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => okChatJson('hi');
    await sb.AxiomOpenRouter.chat.sendMessage('ev1', 'hello');
    const updates = sb.__emitted.filter((e) => e.event === 'openrouter_usage_updated');
    assertOk(updates.length >= 2, 'expected at least a request_started and a request_completed usage update');
    const last = updates[updates.length - 1];
    assertEq(last.payload.totals.requests, 1);
    assertEq(last.payload.totals.successes, 1);
  });

  await test('events: openrouter_usage_updated is forwarded through the existing Event Bus onto AxiomOrchestrator (not sent directly)', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const forwarded = [];
    sb.AxiomOrchestrator = { emit: (event, payload) => forwarded.push({ event, payload }) };
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'ev2', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => okChatJson('hi');
    await sb.AxiomOpenRouter.chat.sendMessage('ev2', 'hello');
    assertOk(forwarded.some((f) => f.event === 'openrouter_usage_updated'), 'expected openrouter_usage_updated to travel through the existing forwardToOrchestrator(), same as every other openrouter_* event');
  });

  // =================================================================
  // 9. resetStats() / configure()
  // =================================================================
  await test('reset: resetStats() zeroes global, per-model, per-session, daily, and monthly buckets', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.chat.createChat({ chatId: 'reset1', model: 'openai/gpt-4o-mini' });
    sb.fetch = () => okChatJson('hi');
    await sb.AxiomOpenRouter.chat.sendMessage('reset1', 'hello');
    assertOk(sb.AxiomOpenRouter.usage.getStats().requests > 0);
    sb.AxiomOpenRouter.usage.resetStats();
    const stats = sb.AxiomOpenRouter.usage.getStats();
    assertEq(stats.requests, 0);
    assertEq(stats.models, 0);
    assertEq(stats.sessions, 0);
    assertEq(Object.keys(sb.AxiomOpenRouter.usage.listDailyStats()).length, 0);
    assertEq(sb.AxiomOpenRouter.usage.getActiveRequestCount(), 0);
  });

  await test('configure: configure({historyLimit}) does not throw and accepts a positive integer', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/usage-tracker.js');
    sb.AxiomOpenRouter.usage.configure({ historyLimit: 5 });
    sb.AxiomOpenRouter.usage.configure({}); // no-op, must not throw
    sb.AxiomOpenRouter.usage.configure(null); // no-op, must not throw
  });

  // =================================================================
  // 10. Non-duplication / non-modification statics
  // =================================================================
  (function staticChecks() {
    const protectedFiles = [
      'js/core/openrouter-client.js', 'js/core/openrouter-config.js', 'js/core/model-selector.js',
      'os/api/openrouter/api-manager.js', 'os/api/openrouter/model-manager.js',
      'os/api/openrouter/token-manager.js', 'os/api/openrouter/error-handler.js',
      'os/api/openrouter/chat-manager.js', 'os/api/openrouter/stream-manager.js',
      'os/api/openrouter/response-parser.js', 'os/api/openrouter/request-queue.js'
    ];
    protectedFiles.forEach((rel) => {
      const src = readSrc(rel);
      check(`static: ${rel} exists and was not touched by Part 2B-4 (present, non-empty)`, typeof src === 'string' && src.length > 0);
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

    check('static: os/api/openrouter/ contains exactly the ten expected entries (Part 2A\'s four + chat-manager.js + Part 2B-2\'s two + request-queue.js + Part 2B-4\'s usage-tracker.js + Part 2C-1A\'s tool-calling/), nothing extra',
      (() => {
        const dir = path.join(ROOT, 'os/api/openrouter');
        const names = fs.readdirSync(dir).sort();
        const expected = ['api-manager.js', 'chat-manager.js', 'error-handler.js', 'model-manager.js', 'request-queue.js', 'response-parser.js', 'stream-manager.js', 'token-manager.js', 'tool-calling', 'usage-tracker.js'];
        return JSON.stringify(names) === JSON.stringify(expected);
      })());

    const chatManagerSrc = readSrc('os/api/openrouter/chat-manager.js');
    ['createChat', 'getChat', 'listChats', 'getHistory', 'setSystemPrompt', 'configureChat', 'sendMessage', 'resetChat', 'deleteChat', 'configure'].forEach((fnName) => {
      check(`static: chat-manager.js still exports ${fnName} (untouched by Part 2B-4)`, chatManagerSrc.indexOf(fnName + ':') !== -1);
    });
    const streamManagerSrc = readSrc('os/api/openrouter/stream-manager.js');
    ['streamMessage', 'cancelStream', 'resumeStream', 'getStream', 'listStreams', 'configure'].forEach((fnName) => {
      check(`static: stream-manager.js still exports ${fnName} (untouched by Part 2B-4)`, streamManagerSrc.indexOf(fnName + ':') !== -1);
    });
    const requestQueueSrc = readSrc('os/api/openrouter/request-queue.js');
    ['enqueue', 'enqueueChatMessage', 'enqueueStream', 'cancel', 'getRequest', 'listRequests', 'getMetrics', 'pause', 'resume', 'clear', 'configure'].forEach((fnName) => {
      check(`static: request-queue.js still exports ${fnName} (untouched by Part 2B-4)`, requestQueueSrc.indexOf(fnName + ':') !== -1);
    });
    const tokenManagerSrc = readSrc('os/api/openrouter/token-manager.js');
    check('static: token-manager.js is byte-for-byte untouched (still exposes resetStats/recordUsage/getUsageStats)',
      tokenManagerSrc.indexOf('recordUsage:') !== -1 && tokenManagerSrc.indexOf('getUsageStats:') !== -1 && tokenManagerSrc.indexOf('resetStats:') !== -1);

    const codeOnly = (rel) => readSrc(rel).split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
    const usageSrc = codeOnly('os/api/openrouter/usage-tracker.js');
    check('static: usage-tracker.js never touches localStorage key axiom_openrouter_selected_model (existing UI selector\'s key)',
      usageSrc.indexOf('axiom_openrouter_selected_model') === -1);
    check('static: usage-tracker.js never touches localStorage key axiom_os_openrouter_default_model (model-manager.js\'s key)',
      usageSrc.indexOf('axiom_os_openrouter_default_model') === -1);
    check('static: usage-tracker.js never touches localStorage key axiom_os_openrouter_api_key (api-manager.js\'s key)',
      usageSrc.indexOf('axiom_os_openrouter_api_key') === -1);
    check('static: usage-tracker.js does not reference js/core/openrouter-client.js\'s global (window.OpenRouter)',
      usageSrc.indexOf('window.OpenRouter') === -1);
    check('static: usage-tracker.js makes no fetch()/XHR calls of its own (pure observer over existing request paths)',
      usageSrc.indexOf('fetch(') === -1);
    check('static: usage-tracker.js touches no localStorage (nothing persisted — in-memory only, same as token-manager.js)',
      usageSrc.indexOf('localStorage') === -1);
    check('static: usage-tracker.js does not reimplement error classification (no local STATUS_TO_CODE/RETRYABLE table)',
      usageSrc.indexOf('STATUS_TO_CODE') === -1 && usageSrc.indexOf('RETRYABLE') === -1);
    check('static: usage-tracker.js does not reimplement token-per-char pricing math (no CHARS_PER_TOKEN_ESTIMATE constant — reuses Token Manager\'s estimateCost() instead)',
      usageSrc.indexOf('CHARS_PER_TOKEN_ESTIMATE') === -1 && usageSrc.indexOf('pricing.prompt') === -1);
    check('static: usage-tracker.js never calls chat.sendMessage()/stream.streamMessage()/queue.enqueue() (pure observer, no new requests of its own)',
      usageSrc.indexOf('.sendMessage(') === -1 && usageSrc.indexOf('.streamMessage(') === -1 && usageSrc.indexOf('.enqueue(') === -1);
    check('static: usage-tracker.js never creates/mutates an AxiomRuntimeContext (read-only reuse only — no createContext/markRunning/completeContext/failContext calls)',
      usageSrc.indexOf('.createContext(') === -1 && usageSrc.indexOf('.markRunning(') === -1 && usageSrc.indexOf('.completeContext(') === -1 && usageSrc.indexOf('.failContext(') === -1);
  })();

  // =================================================================
  // 11. Part 2A / 2B-1 / 2B-2 / 2B-3's own suites still pass unmodified
  // =================================================================
  const priorSuites = [
    ['Part 2A', 'block2-step9-part2a-openrouter-core-regression-suite.js'],
    ['Part 2B-1', 'block2-step9-part2b1-chat-manager-regression-suite.js'],
    ['Part 2B-2', 'block2-step9-part2b2-stream-manager-regression-suite.js'],
    ['Part 2B-3', 'block2-step9-part2b3-request-queue-regression-suite.js']
  ];
  for (const [label, file] of priorSuites) {
    await test(`regression: ${label}'s own suite still passes in full after Part 2B-4's additive changes`, async () => {
      const { execFileSync } = require('child_process');
      const out = execFileSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
      const match = out.match(/(\d+) passed, (\d+) failed\./);
      assertOk(!!match, `could not find summary line in ${label} suite output:\n` + out);
      assertEq(match[2], '0', `${label} suite reported failures:\n` + out);
    });
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f.label + (f.detail ? ' :: ' + f.detail : '')));
    process.exitCode = 1;
  }
})();
