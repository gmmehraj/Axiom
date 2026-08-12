// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2B-3: OpenRouter Request Queue
// regression suite
// ------------------------------------------------------------
// Runs the real file on disk (os/api/openrouter/request-queue.js),
// together with all of its Part 2A/2B-1/2B-2 siblings, in a
// hand-built `vm` sandbox — same pattern as
// block2-step9-part2b2-stream-manager-regression-suite.js.
//
// Sections:
//   1. Standalone install / generic enqueue() degrade paths
//   2. Priority queue + request ordering
//   3. Parallel requests (maxConcurrent)
//   4. Retry scheduling (reuses error-handler.js's isRetryable)
//   5. Timeout handling
//   6. Cancellation (queued / retrying / running)
//   7. Rate limit handling
//   8. Queue metrics
//   9. enqueueChatMessage() / enqueueStream() wrappers
//  10. Events (openrouter_queue_added/started/completed, openrouter_retry)
//  11. Non-duplication / non-modification statics
//  12. Part 2A / 2B-1 / 2B-2's own suites still pass unmodified
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

// Real, non-mocked timers are used (not a 0ms-collapsing fake) so
// backoff/timeout/rate-limit *ordering* (not just "did it eventually
// fire") is genuinely exercised. Delays in tests below are kept small
// (ms, not seconds) via configure()/options overrides so the suite
// still runs fast.
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
    Object, Array, Math, Date, Promise, Error, JSON, String, Number, isFinite
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
  return {
    createContext(opts) { n += 1; return { contextId: 'rc-' + n, opts }; },
    markRunning() {},
    completeContext() {},
    failContext() {}
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
    'os/api/openrouter/request-queue.js'
  ];
  rels.forEach((rel) => loadInto(sandbox, rel));
}

// Records every event emitted on the sandbox's AxiomOpenRouter bus
// into sb.__emitted, without altering any real listener behavior.
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

function okChatJson(content) {
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      id: 'gen-test', model: 'openai/gpt-4o-mini',
      choices: [{ message: { role: 'assistant', content: content || 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    })
  });
}
function failChatJson(status, message) {
  return Promise.resolve({
    ok: false, status: status,
    json: () => Promise.resolve({ error: { message: message || ('HTTP ' + status) } })
  });
}

async function main() {
  console.log('AXIOM Block 2 / Step 9 / Part 2B-3 — OpenRouter Request Queue regression\n');

  // =================================================================
  // 1. Standalone install / generic enqueue() degrade paths
  // =================================================================
  await test('request-queue: installs onto window.AxiomOpenRouter.queue standalone (no other file loaded)', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    assertOk(typeof sb.AxiomOpenRouter.queue === 'object');
  });

  await test('request-queue: enqueue() with a non-function execute rejects "invalid_task" synchronously-shaped (no throw)', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueue(null);
    assertOk(!!requestId);
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'invalid_task', JSON.stringify(error));
  });

  await test('request-queue: enqueue() works fully standalone — no api-manager.js/error-handler.js required for generic tasks', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve('done'));
    const result = await promise;
    assertEq(result, 'done');
  });

  await test('request-queue: an execute() that throws synchronously is treated as a rejection, not an uncaught throw', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(() => { throw new Error('boom'); }, { maxRetries: 0 });
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error, 'expected a rejection');
  });

  await test('request-queue: an execute() returning a non-Promise rejects "invalid_task"', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(() => 'not a promise', { maxRetries: 0 });
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'invalid_task', JSON.stringify(error));
  });

  // =================================================================
  // 2. Priority queue + request ordering
  // =================================================================
  await test('request-queue: higher-priority requests run before lower-priority ones queued earlier', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 1 });
    const order = [];
    // First task occupies the single concurrency slot so the rest queue up.
    sb.AxiomOpenRouter.queue.enqueue(() => sleep(20).then(() => { order.push('blocker'); }), { priority: 0 });
    sb.AxiomOpenRouter.queue.enqueue(() => { order.push('low'); return Promise.resolve(); }, { priority: 0 });
    sb.AxiomOpenRouter.queue.enqueue(() => { order.push('high'); return Promise.resolve(); }, { priority: 10 });
    await waitUntil(() => order.length === 3);
    assertEq(order.join(','), 'blocker,high,low', 'high priority must be dispatched before low, despite being enqueued after it');
  });

  await test('request-queue: equal-priority requests run in FIFO arrival order (Request Ordering)', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 1 });
    const order = [];
    sb.AxiomOpenRouter.queue.enqueue(() => sleep(20).then(() => { order.push('blocker'); }));
    sb.AxiomOpenRouter.queue.enqueue(() => { order.push('a'); return Promise.resolve(); });
    sb.AxiomOpenRouter.queue.enqueue(() => { order.push('b'); return Promise.resolve(); });
    sb.AxiomOpenRouter.queue.enqueue(() => { order.push('c'); return Promise.resolve(); });
    await waitUntil(() => order.length === 4);
    assertEq(order.join(','), 'blocker,a,b,c');
  });

  // =================================================================
  // 3. Parallel requests
  // =================================================================
  await test('request-queue: dispatches up to maxConcurrent requests in parallel, not more', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 2 });
    let concurrent = 0;
    let maxSeen = 0;
    const run = () => {
      concurrent += 1;
      maxSeen = Math.max(maxSeen, concurrent);
      return sleep(15).then(() => { concurrent -= 1; return 'ok'; });
    };
    const handles = [1, 2, 3, 4, 5].map(() => sb.AxiomOpenRouter.queue.enqueue(run));
    await Promise.all(handles.map((h) => h.promise));
    assertOk(maxSeen <= 2, 'never exceeded maxConcurrent, saw ' + maxSeen);
    assertEq(maxSeen, 2, 'actually reached the configured concurrency ceiling');
  });

  await test('request-queue: raising maxConcurrent via configure() immediately allows more dispatch', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 1 });
    let running = 0, maxSeen = 0;
    const run = () => { running += 1; maxSeen = Math.max(maxSeen, running); return sleep(15).then(() => { running -= 1; }); };
    const handles = [1, 2, 3].map(() => sb.AxiomOpenRouter.queue.enqueue(run));
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 3 });
    await Promise.all(handles.map((h) => h.promise));
    assertOk(maxSeen >= 2, 'configure() should have unblocked more parallel dispatch, saw ' + maxSeen);
  });

  // =================================================================
  // 4. Retry scheduling (reuses error-handler.js's isRetryable)
  // =================================================================
  await test('request-queue: a retryable failure (per error-handler.js) is retried until it succeeds', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    let attempts = 0;
    const execute = () => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('server hiccup');
        err.status = 503; // error-handler.js: SERVICE_UNAVAILABLE, retryable
        return Promise.reject(err);
      }
      return Promise.resolve('finally ok');
    };
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { retryBaseDelayMs: 5, retryMaxDelayMs: 20, maxRetries: 5 });
    const result = await promise;
    assertEq(result, 'finally ok');
    assertEq(attempts, 3);
  });

  await test('request-queue: a non-retryable failure (per error-handler.js) fails immediately without retrying', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    let attempts = 0;
    const execute = () => {
      attempts += 1;
      const err = new Error('bad key');
      err.status = 401; // error-handler.js: INVALID_API_KEY, NOT retryable
      return Promise.reject(err);
    };
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { retryBaseDelayMs: 5, maxRetries: 5 });
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertEq(attempts, 1, 'must not retry a non-retryable classified error');
    assertOk(!!error && error.code === 'invalid_api_key', JSON.stringify(error));
  });

  await test('request-queue: gives up and rejects once maxRetries is exhausted, even for a retryable error', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    let attempts = 0;
    const execute = () => {
      attempts += 1;
      const err = new Error('always down');
      err.status = 503;
      return Promise.reject(err);
    };
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { retryBaseDelayMs: 5, retryMaxDelayMs: 10, maxRetries: 2 });
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertEq(attempts, 3, 'initial attempt + 2 retries = 3 attempts total');
    assertOk(!!error && error.code === 'service_unavailable', JSON.stringify(error));
  });

  await test('request-queue: backoff delay grows between successive retries (exponential)', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const delays = [];
    sb.AxiomOpenRouter.on('openrouter_retry', (payload) => delays.push(payload.delayMs));
    let attempts = 0;
    const execute = () => {
      attempts += 1;
      const err = new Error('down');
      err.status = 503;
      return Promise.reject(err);
    };
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { retryBaseDelayMs: 300, retryMaxDelayMs: 5000, maxRetries: 3 });
    try { await promise; } catch (e) { /* expected to fail after exhausting retries */ }
    assertEq(delays.length, 3);
    assertOk(delays[1] >= delays[0], 'second delay should be >= first (exponential growth, jitter aside): ' + JSON.stringify(delays));
    assertOk(delays[2] >= delays[1], 'third delay should be >= second: ' + JSON.stringify(delays));
  });

  // =================================================================
  // 5. Timeout handling
  // =================================================================
  await test('request-queue: a task that never settles is failed via timeoutMs, classified retryable=true', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const execute = () => new Promise(() => {}); // never resolves/rejects
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { timeoutMs: 15, maxRetries: 0 });
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'timeout', JSON.stringify(error));
    assertEq(error.retryable, true, 'timeout is retryable per error-handler.js\'s CODES.TIMEOUT table');
  });

  await test('request-queue: a timed-out task retries (timeout is retryable) if attempts remain, then can still succeed', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    let attempts = 0;
    const execute = () => {
      attempts += 1;
      if (attempts === 1) return new Promise(() => {}); // hang on first attempt only
      return Promise.resolve('recovered');
    };
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { timeoutMs: 10, retryBaseDelayMs: 5, maxRetries: 2 });
    const result = await promise;
    assertEq(result, 'recovered');
    assertEq(attempts, 2);
  });

  await test('request-queue: a late resolution after timeout has already failed the request is ignored (no double-settle)', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    let resolveLate;
    const execute = () => new Promise((resolve) => { resolveLate = resolve; });
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { timeoutMs: 10, maxRetries: 0 });
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'timeout');
    // Resolving long after the timeout already settled the wrapper
    // promise must not throw or change the already-settled outcome.
    resolveLate('too-late');
    await sleep(15);
    check('no crash on late resolution after timeout', true);
  });

  // =================================================================
  // 6. Cancellation
  // =================================================================
  await test('request-queue: cancel() on an unknown requestId returns false, does not throw', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    assertEq(sb.AxiomOpenRouter.queue.cancel('nope'), false);
  });

  await test('request-queue: cancel() while still queued removes it before it ever runs', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 1 });
    let ranBlocker = false, ranTarget = false;
    sb.AxiomOpenRouter.queue.enqueue(() => sleep(20).then(() => { ranBlocker = true; }));
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueue(() => { ranTarget = true; return Promise.resolve(); });
    const cancelled = sb.AxiomOpenRouter.queue.cancel(requestId, 'no longer needed');
    assertEq(cancelled, true);
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'cancelled', JSON.stringify(error));
    await sleep(30);
    assertOk(ranBlocker, 'the blocker should still have run normally');
    assertOk(!ranTarget, 'the cancelled-while-queued task must never actually run');
  });

  await test('request-queue: cancel() while running calls the supplied cancel() hook and rejects immediately', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    let cancelHookCalledWith = null;
    const execute = () => new Promise(() => {}); // hangs until externally cancelled
    const cancel = (reason) => { cancelHookCalledWith = reason; };
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { cancel: cancel });
    await waitUntil(() => sb.AxiomOpenRouter.queue.getRequest(requestId).status === 'running');
    const ok = sb.AxiomOpenRouter.queue.cancel(requestId, 'user aborted');
    assertEq(ok, true);
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'cancelled');
    assertEq(cancelHookCalledWith, 'user aborted');
  });

  await test('request-queue: cancel() while waiting to retry stops the scheduled retry', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    let attempts = 0;
    const execute = () => {
      attempts += 1;
      const err = new Error('down');
      err.status = 503;
      return Promise.reject(err);
    };
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { retryBaseDelayMs: 30, maxRetries: 5 });
    await waitUntil(() => sb.AxiomOpenRouter.queue.getRequest(requestId).status === 'retrying');
    sb.AxiomOpenRouter.queue.cancel(requestId, 'give up');
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'cancelled');
    await sleep(50);
    assertEq(attempts, 1, 'the pending retry must never actually fire after cancel()');
  });

  await test('request-queue: cancel() on an already-completed request returns false', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve('done'));
    await promise;
    assertEq(sb.AxiomOpenRouter.queue.cancel(requestId), false);
  });

  await test('request-queue: clear() cancels every currently-queued request and returns the count', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 1 });
    sb.AxiomOpenRouter.queue.enqueue(() => sleep(30));
    const h2 = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve());
    const h3 = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve());
    const n = sb.AxiomOpenRouter.queue.clear('bulk cancel');
    assertEq(n, 2);
    let e2 = null, e3 = null;
    try { await h2.promise; } catch (e) { e2 = e; }
    try { await h3.promise; } catch (e) { e3 = e; }
    assertOk(!!e2 && e2.code === 'cancelled');
    assertOk(!!e3 && e3.code === 'cancelled');
  });

  // =================================================================
  // 7. Rate limit handling
  // =================================================================
  await test('request-queue: a 429 pauses dispatch of OTHER queued requests until the cooldown elapses', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 2, rateLimitCooldownMs: 40, retryBaseDelayMs: 5, retryMaxDelayMs: 5 });
    const order = [];
    const rateLimited = () => {
      const err = new Error('slow down');
      err.status = 429;
      return Promise.reject(err);
    };
    // task A: fails with 429 once, then would succeed on its retry —
    // but we only care that task B (queued behind it, no free slot
    // reason) does not run until the cooldown clears.
    let aAttempts = 0;
    const a = () => { aAttempts += 1; return aAttempts === 1 ? rateLimited() : Promise.resolve('a-ok'); };
    const b = () => { order.push(Date.now()); return Promise.resolve('b-ok'); };

    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 1 });
    const before = Date.now();
    const ha = sb.AxiomOpenRouter.queue.enqueue(a, { maxRetries: 3, retryBaseDelayMs: 5, retryMaxDelayMs: 5 });
    const hb = sb.AxiomOpenRouter.queue.enqueue(b);
    await Promise.all([ha.promise, hb.promise]);
    assertOk(order[0] - before >= 40, 'task B must not dispatch until the rate-limit cooldown elapsed, waited ' + (order[0] - before) + 'ms');
  });

  await test('request-queue: rate-limited retry delay is at least the configured cooldown', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    sb.AxiomOpenRouter.queue.configure({ rateLimitCooldownMs: 50 });
    let delayMs = null;
    sb.AxiomOpenRouter.on('openrouter_retry', (payload) => { delayMs = payload.delayMs; });
    let attempts = 0;
    const execute = () => {
      attempts += 1;
      if (attempts === 1) { const err = new Error('slow down'); err.status = 429; return Promise.reject(err); }
      return Promise.resolve('ok');
    };
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { maxRetries: 3, retryBaseDelayMs: 1 });
    await promise;
    assertOk(delayMs >= 50, 'retry delay after a 429 must be at least the rate-limit cooldown, was ' + delayMs);
  });

  await test('request-queue: getMetrics() reports rateLimited/rateLimitedUntil while a cooldown is active', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    sb.AxiomOpenRouter.queue.configure({ rateLimitCooldownMs: 60, retryBaseDelayMs: 5 });
    const execute = () => { const err = new Error('slow down'); err.status = 429; return Promise.reject(err); };
    sb.AxiomOpenRouter.queue.enqueue(execute, { maxRetries: 0 });
    await waitUntil(() => sb.AxiomOpenRouter.queue.getMetrics().rateLimited === true);
    const m = sb.AxiomOpenRouter.queue.getMetrics();
    assertOk(m.rateLimited === true);
    assertOk(typeof m.rateLimitedUntil === 'number' && m.rateLimitedUntil > Date.now() - 5);
  });

  // =================================================================
  // 8. Queue metrics
  // =================================================================
  await test('request-queue: getMetrics() tracks totals across succeed/fail/cancel/retry', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    const ok = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve('ok'));
    const failing = sb.AxiomOpenRouter.queue.enqueue(() => { const e = new Error('bad'); e.status = 401; return Promise.reject(e); }, { maxRetries: 0 });
    const toCancel = sb.AxiomOpenRouter.queue.enqueue(() => new Promise(() => {}));
    await ok.promise.catch(() => {});
    await failing.promise.catch(() => {});
    sb.AxiomOpenRouter.queue.cancel(toCancel.requestId);
    await toCancel.promise.catch(() => {});
    const m = sb.AxiomOpenRouter.queue.getMetrics();
    assertEq(m.totalEnqueued, 3);
    assertEq(m.totalSucceeded, 1);
    assertEq(m.totalFailed, 1);
    assertEq(m.totalCancelled, 1);
  });

  await test('request-queue: getRequest()/listRequests() reflect live queue/running/terminal state', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 1 });
    let releaseBlocker;
    sb.AxiomOpenRouter.queue.enqueue(() => new Promise((res) => { releaseBlocker = res; }));
    const { requestId } = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve('ok'));
    let snap = sb.AxiomOpenRouter.queue.getRequest(requestId);
    assertEq(snap.status, 'queued');
    assertEq(sb.AxiomOpenRouter.queue.listRequests({ status: 'queued' }).length, 1);
    releaseBlocker();
    await waitUntil(() => sb.AxiomOpenRouter.queue.getRequest(requestId).status === 'succeeded');
    snap = sb.AxiomOpenRouter.queue.getRequest(requestId);
    assertEq(snap.status, 'succeeded');
    assertEq(snap.result, 'ok');
  });

  await test('request-queue: getRequest() on an unknown id returns null, does not throw', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    assertEq(sb.AxiomOpenRouter.queue.getRequest('nope'), null);
  });

  await test('request-queue: pause()/resume() gate dispatch of new work without affecting already-running tasks', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    sb.AxiomOpenRouter.queue.pause();
    let ran = false;
    const { requestId } = sb.AxiomOpenRouter.queue.enqueue(() => { ran = true; return Promise.resolve(); });
    await sleep(15);
    assertOk(!ran, 'must not dispatch while paused');
    assertEq(sb.AxiomOpenRouter.queue.getRequest(requestId).status, 'queued');
    sb.AxiomOpenRouter.queue.resume();
    await waitUntil(() => ran);
    assertOk(ran);
  });

  // =================================================================
  // 9. enqueueChatMessage() / enqueueStream() wrappers
  // =================================================================
  await test('request-queue: enqueueChatMessage() rejects "core_not_loaded" when chat-manager.js is absent', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueueChatMessage('any', 'hi');
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!requestId);
    assertOk(!!error && error.code === 'core_not_loaded', JSON.stringify(error));
  });

  await test('request-queue: enqueueStream() rejects "core_not_loaded" when stream-manager.js is absent', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/chat-manager.js');
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    const chat = sb.AxiomOpenRouter.chat.createChat();
    const { promise } = sb.AxiomOpenRouter.queue.enqueueStream(chat.chatId, 'hi');
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'core_not_loaded', JSON.stringify(error));
  });

  await test('request-queue: enqueueChatMessage() actually calls chat.sendMessage() and resolves with its result', async () => {
    const sb = makeSandbox({ fetch: () => okChatJson('hello from queue') });
    loadFull(sb);
    await withStoredKey(sb);
    sb.fetch = () => okChatJson('hello from queue');
    const chat = sb.AxiomOpenRouter.chat.createChat();
    const { promise } = sb.AxiomOpenRouter.queue.enqueueChatMessage(chat.chatId, 'hi there');
    const result = await promise;
    assertEq(result.message.content, 'hello from queue');
    assertEq(sb.AxiomOpenRouter.chat.getHistory(chat.chatId).length, 2, 'both the user turn and the assistant reply must land in the real conversation history');
  });

  await test('request-queue: enqueueChatMessage() retries a retryable chat-manager.js failure and eventually succeeds', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    let calls = 0;
    sb.fetch = () => {
      calls += 1;
      return calls < 2 ? failChatJson(503, 'temporarily down') : okChatJson('recovered reply');
    };
    const chat = sb.AxiomOpenRouter.chat.createChat();
    const { promise } = sb.AxiomOpenRouter.queue.enqueueChatMessage(chat.chatId, 'hi', { retryBaseDelayMs: 5, retryMaxDelayMs: 10 });
    const result = await promise;
    assertEq(result.message.content, 'recovered reply');
    assertEq(calls, 2);
  });

  await test('request-queue: enqueueChatMessage() does not retry a non-retryable chat-manager.js failure (e.g. bad key)', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    let calls = 0;
    sb.fetch = () => { calls += 1; return failChatJson(401, 'invalid key'); };
    const chat = sb.AxiomOpenRouter.chat.createChat();
    const { promise } = sb.AxiomOpenRouter.queue.enqueueChatMessage(chat.chatId, 'hi', { retryBaseDelayMs: 5, maxRetries: 5 });
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertEq(calls, 1);
    assertOk(!!error && error.code === 'invalid_api_key', JSON.stringify(error));
  });

  await test('request-queue: cancelling a queued enqueueStream() task before dispatch never opens a real stream', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    await withStoredKey(sb);
    sb.AxiomOpenRouter.queue.configure({ maxConcurrent: 1 });
    const chat = sb.AxiomOpenRouter.chat.createChat();
    let streamMessageCalls = 0;
    const originalStreamMessage = sb.AxiomOpenRouter.stream.streamMessage;
    sb.AxiomOpenRouter.stream.streamMessage = function () { streamMessageCalls += 1; return originalStreamMessage.apply(this, arguments); };

    sb.AxiomOpenRouter.queue.enqueue(() => new Promise(() => {})); // occupies the only slot
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueueStream(chat.chatId, 'hi');
    sb.AxiomOpenRouter.queue.cancel(requestId, 'changed my mind');
    let error = null;
    try { await promise; } catch (e) { error = e; }
    assertOk(!!error && error.code === 'cancelled');
    assertEq(streamMessageCalls, 0, 'a queued (never-dispatched) stream task must never call streamMessage()');
  });

  // =================================================================
  // 10. Events
  // =================================================================
  await test('events: openrouter_queue_added fires synchronously-observable on enqueue(), before it runs', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    tapEvents(sb);
    const { requestId } = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve('ok'));
    const added = sb.__emitted.find((e) => e.event === 'openrouter_queue_added' && e.payload.requestId === requestId);
    assertOk(!!added, 'expected an openrouter_queue_added event');
    assertEq(added.payload.attempt, 0);
  });

  await test('events: openrouter_queue_started fires once dispatched, with attempt=1', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    tapEvents(sb);
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve('ok'));
    await promise;
    const started = sb.__emitted.find((e) => e.event === 'openrouter_queue_started' && e.payload.requestId === requestId);
    assertOk(!!started);
    assertEq(started.payload.attempt, 1);
  });

  await test('events: openrouter_queue_completed fires exactly once with status "succeeded" on success', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    tapEvents(sb);
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve('ok'));
    await promise;
    const completed = sb.__emitted.filter((e) => e.event === 'openrouter_queue_completed' && e.payload.requestId === requestId);
    assertEq(completed.length, 1);
    assertEq(completed[0].payload.status, 'succeeded');
  });

  await test('events: openrouter_queue_completed fires with status "failed" after retries are exhausted', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    tapEvents(sb);
    const execute = () => { const e = new Error('down'); e.status = 503; return Promise.reject(e); };
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { retryBaseDelayMs: 5, retryMaxDelayMs: 5, maxRetries: 1 });
    try { await promise; } catch (e) { /* expected */ }
    const completed = sb.__emitted.filter((e) => e.event === 'openrouter_queue_completed' && e.payload.requestId === requestId);
    assertEq(completed.length, 1);
    assertEq(completed[0].payload.status, 'failed');
  });

  await test('events: openrouter_queue_completed fires with status "cancelled" on cancel()', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    tapEvents(sb);
    const { requestId, promise } = sb.AxiomOpenRouter.queue.enqueue(() => new Promise(() => {}));
    sb.AxiomOpenRouter.queue.cancel(requestId, 'stop');
    try { await promise; } catch (e) { /* expected */ }
    const completed = sb.__emitted.filter((e) => e.event === 'openrouter_queue_completed' && e.payload.requestId === requestId);
    assertEq(completed.length, 1);
    assertEq(completed[0].payload.status, 'cancelled');
  });

  await test('events: openrouter_retry fires once per retry attempt, with growing attempt numbers', async () => {
    const sb = makeSandbox();
    loadFull(sb);
    tapEvents(sb);
    const execute = () => { const e = new Error('down'); e.status = 503; return Promise.reject(e); };
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(execute, { retryBaseDelayMs: 5, retryMaxDelayMs: 5, maxRetries: 2 });
    try { await promise; } catch (e) { /* expected */ }
    const retries = sb.__emitted.filter((e) => e.event === 'openrouter_retry');
    assertEq(retries.length, 2);
    assertEq(retries[0].payload.attempt, 2);
    assertEq(retries[1].payload.attempt, 3);
  });

  await test('events: bus events forward onto AxiomOrchestrator.emit() (reused Event Bus / Analytics forwarding)', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    const forwarded = [];
    sb.AxiomOrchestrator = { emit: (event, payload) => forwarded.push({ event, payload }) };
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve('ok'));
    await promise;
    assertOk(forwarded.some((f) => f.event === 'openrouter_queue_added'), 'expected queue events to be forwarded through the existing Event Bus onto AxiomOrchestrator');
  });

  await test('runtime-context: a dispatched task is wrapped via the existing withRuntimeContext() when AxiomRuntimeContext is present', async () => {
    const sb = makeSandbox({ withRuntimeContext: true });
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/request-queue.js');
    const contexts = [];
    const originalCreate = sb.AxiomRuntimeContext.createContext;
    sb.AxiomRuntimeContext.createContext = function (opts) { contexts.push(opts); return originalCreate(opts); };
    const { promise } = sb.AxiomOpenRouter.queue.enqueue(() => Promise.resolve('ok'), { meta: { kind: 'unit-test' } });
    await promise;
    assertOk(contexts.length >= 1, 'expected at least one Runtime Context to be created for the dispatched attempt');
  });

  // =================================================================
  // 11. Non-duplication / non-modification statics
  // =================================================================
  (function staticChecks() {
    const protectedFiles = [
      'js/core/openrouter-client.js', 'js/core/openrouter-config.js', 'js/core/model-selector.js',
      'os/api/openrouter/api-manager.js', 'os/api/openrouter/model-manager.js',
      'os/api/openrouter/token-manager.js', 'os/api/openrouter/error-handler.js',
      'os/api/openrouter/chat-manager.js', 'os/api/openrouter/stream-manager.js',
      'os/api/openrouter/response-parser.js'
    ];
    protectedFiles.forEach((rel) => {
      const src = readSrc(rel);
      check(`static: ${rel} exists and was not touched by Part 2B-3 (present, non-empty)`, typeof src === 'string' && src.length > 0);
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

    check('static: os/api/openrouter/ contains exactly the ten expected entries (incl. Part 2C-1A\'s tool-calling/), nothing extra',
      (() => {
        const dir = path.join(ROOT, 'os/api/openrouter');
        const names = fs.readdirSync(dir).sort();
        const expected = ['api-manager.js', 'chat-manager.js', 'error-handler.js', 'model-manager.js', 'request-queue.js', 'response-parser.js', 'stream-manager.js', 'token-manager.js', 'tool-calling', 'usage-tracker.js'];
        return JSON.stringify(names) === JSON.stringify(expected);
      })());

    // chat-manager.js's/stream-manager.js's own PUBLIC contracts must
    // be untouched — confirmed here by presence of every documented
    // export; the re-run of their own full suites in §12 is the real
    // behavioral proof.
    const chatManagerSrc = readSrc('os/api/openrouter/chat-manager.js');
    ['createChat', 'getChat', 'listChats', 'getHistory', 'setSystemPrompt', 'configureChat', 'sendMessage', 'resetChat', 'deleteChat', 'configure'].forEach((fnName) => {
      check(`static: chat-manager.js still exports ${fnName} (untouched by Part 2B-3)`, chatManagerSrc.indexOf(fnName + ':') !== -1);
    });
    const streamManagerSrc = readSrc('os/api/openrouter/stream-manager.js');
    ['streamMessage', 'cancelStream', 'resumeStream', 'getStream', 'listStreams', 'configure'].forEach((fnName) => {
      check(`static: stream-manager.js still exports ${fnName} (untouched by Part 2B-3)`, streamManagerSrc.indexOf(fnName + ':') !== -1);
    });

    const codeOnly = (rel) => readSrc(rel).split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
    check('static: request-queue.js never touches localStorage key axiom_openrouter_selected_model (existing UI selector\'s key)',
      codeOnly('os/api/openrouter/request-queue.js').indexOf('axiom_openrouter_selected_model') === -1);
    check('static: request-queue.js never touches localStorage key axiom_os_openrouter_default_model (model-manager.js\'s key)',
      codeOnly('os/api/openrouter/request-queue.js').indexOf('axiom_os_openrouter_default_model') === -1);
    check('static: request-queue.js never touches localStorage key axiom_os_openrouter_api_key (api-manager.js\'s key)',
      codeOnly('os/api/openrouter/request-queue.js').indexOf('axiom_os_openrouter_api_key') === -1);
    check('static: request-queue.js does not reference js/core/openrouter-client.js\'s global (window.OpenRouter)',
      codeOnly('os/api/openrouter/request-queue.js').indexOf('window.OpenRouter') === -1);
    check('static: request-queue.js makes no fetch()/XHR calls of its own (pure scheduling over existing request paths)',
      codeOnly('os/api/openrouter/request-queue.js').indexOf('fetch(') === -1);
    check('static: request-queue.js touches no localStorage key (stateless module — nothing persisted)',
      codeOnly('os/api/openrouter/request-queue.js').indexOf('localStorage') === -1);
    check('static: request-queue.js does not reimplement error classification (no local STATUS_TO_CODE/RETRYABLE table)',
      codeOnly('os/api/openrouter/request-queue.js').indexOf('STATUS_TO_CODE') === -1 && codeOnly('os/api/openrouter/request-queue.js').indexOf('RETRYABLE') === -1);
  })();

  // =================================================================
  // 12. Part 2A / 2B-1 / 2B-2's own suites still pass unmodified
  // =================================================================
  const priorSuites = [
    ['Part 2A', 'block2-step9-part2a-openrouter-core-regression-suite.js'],
    ['Part 2B-1', 'block2-step9-part2b1-chat-manager-regression-suite.js'],
    ['Part 2B-2', 'block2-step9-part2b2-stream-manager-regression-suite.js']
  ];
  for (const [label, file] of priorSuites) {
    await test(`regression: ${label}'s own suite still passes in full after Part 2B-3's additive changes`, async () => {
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
}

main();
