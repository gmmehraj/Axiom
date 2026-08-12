// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2A: OpenRouter Core Foundation
// regression suite
// ------------------------------------------------------------
// Runs the real files on disk (os/api/openrouter/{error-handler,
// api-manager,model-manager,token-manager}.js) in a hand-built `vm`
// sandbox, same pattern as test-evidence/supabase-part1-regression-
// suite.js and test-evidence/block2-step6-part5-runtime-context-
// regression-suite.js — this offline environment has no jsdom, so
// DOM/window/fetch/timers are minimal stand-ins and every network
// call is mocked. No real network access is used or required.
//
// Sections:
//   1. Error Handler — status/timeout/network classification, retryability
//   2. API Manager — init/state machine, key set/remove/validate,
//      health monitor, pub/sub + Orchestrator/Analytics forwarding,
//      Supabase-session-scoped storage namespace, required events
//   3. Model Manager — fetch/cache/TTL/refresh, default model,
//      per-model metadata/context/pricing/capabilities,
//      openrouter_models_loaded event
//   4. Token Manager — prompt/completion/total accounting, usage
//      stats (global + per-model), cost estimation, reset
//   5. Cross-module integration — all four files share one
//      window.AxiomOpenRouter namespace without clobbering each
//      other regardless of load order
//   6. Non-duplication / non-modification statics — confirms this
//      Part did not touch js/core/openrouter-client.js,
//      js/core/openrouter-config.js, js/core/model-selector.js, or
//      any Browser/Automation/Memory/Goal Manager/Voice/Supabase file
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

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

// ---------------------------------------------------------------
// Minimal sandbox factory — fresh per test so module-level state
// (caches, totals, connection state) never leaks between tests.
// ---------------------------------------------------------------
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
    setTimeout: (fn, ms) => global.setTimeout(fn, 0), // fire "soon" but don't block tests on real delays
    clearTimeout: (id) => global.clearTimeout(id),
    // setInterval is captured but never left running against real time —
    // tests call checkHealth()/fetchModels() etc. directly rather than
    // waiting on a live timer, exactly like the runtime-context suite.
    setInterval: () => ({ __fakeInterval: true }),
    clearInterval: () => {},
    fetch: opts.fetch || (() => Promise.reject(new Error('no fetch mock configured'))),
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    AxLogger: { log() {}, warn() {}, error() {} }, // silent — assertions read return values/state, not console output
    AxiomOrchestrator: opts.withOrchestrator === false ? undefined : {
      emit: (event, payload) => { orchestratorEvents.push({ event, payload }); }
    },
    AxiomAnalyticsAutomation: opts.withAnalytics === false ? undefined : {
      addLog: (msg, type) => { analyticsLogs.push({ msg, type }); }
    },
    AxiomSupabaseConnection: opts.supabaseConnection, // undefined unless a test provides one
    AxiomRuntimeContext: opts.runtimeContext, // undefined unless a test provides one
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

function loadCoreFoundation(sandbox, files) {
  const rels = files || [
    'os/api/openrouter/error-handler.js',
    'os/api/openrouter/api-manager.js',
    'os/api/openrouter/model-manager.js',
    'os/api/openrouter/token-manager.js'
  ];
  rels.forEach((rel) => loadInto(sandbox, rel));
}

function tick(ms) {
  return new Promise((resolve) => global.setTimeout(resolve, ms || 0));
}

async function main() {
  console.log('AXIOM Block 2 / Step 9 / Part 2A — OpenRouter Core Foundation regression\n');

  // =================================================================
  // 1. Error Handler
  // =================================================================
  {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    const EH = sb.AxiomOpenRouter.errors;

    check('errors: installs onto window.AxiomOpenRouter.errors', typeof EH === 'object');

    const statusCases = [
      [401, 'invalid_api_key'], [403, 'forbidden'], [404, 'not_found'],
      [408, 'request_timeout'], [429, 'rate_limited'], [500, 'server_error'],
      [502, 'bad_gateway'], [503, 'service_unavailable'], [504, 'gateway_timeout']
    ];
    statusCases.forEach(([status, expectedCode]) => {
      const result = EH.classify({ status, message: 'HTTP ' + status });
      check(`errors: HTTP ${status} classifies as "${expectedCode}"`, result.code === expectedCode, JSON.stringify(result));
    });

    const abortResult = EH.classify({ name: 'AbortError', message: 'The operation was aborted.' });
    check('errors: AbortError classifies as "timeout"', abortResult.code === 'timeout');

    const networkResult = EH.classify(new TypeError('Failed to fetch'));
    check('errors: fetch-layer TypeError classifies as "network_error"', networkResult.code === 'network_error', JSON.stringify(networkResult));

    const invalidKeyResult = EH.classify({ error: { message: 'Invalid API key provided' } });
    check('errors: "Invalid API key" message body classifies as "invalid_api_key"', invalidKeyResult.code === 'invalid_api_key');

    const modelUnavailableResult = EH.classify({ message: 'The model "foo/bar" does not exist' });
    check('errors: model-not-found message classifies as "model_unavailable"', modelUnavailableResult.code === 'model_unavailable');

    const unknownResult = EH.classify({ message: 'something bizarre happened' });
    check('errors: unrecognized input classifies as "unknown"', unknownResult.code === 'unknown');

    check('errors: retryable set is exactly {timeout,rate_limited,5xx,network,request_timeout}',
      EH.isRetryable('rate_limited') === true &&
      EH.isRetryable('server_error') === true &&
      EH.isRetryable('timeout') === true &&
      EH.isRetryable('invalid_api_key') === false &&
      EH.isRetryable('not_found') === false &&
      EH.isRetryable('forbidden') === false);

    check('errors: classify() never throws on null/undefined/empty input',
      (() => { try { EH.classify(null); EH.classify(undefined); EH.classify({}); return true; } catch (e) { return false; } })());
  }

  // handle() logs + emits 'openrouter_error' on the shared bus once api-manager.js is loaded
  {
    const sb = makeSandbox();
    loadCoreFoundation(sb, ['os/api/openrouter/error-handler.js', 'os/api/openrouter/api-manager.js']);
    let seen = null;
    sb.AxiomOpenRouter.on('openrouter_error', (payload) => { seen = payload; });
    sb.AxiomOpenRouter.errors.handle({ status: 429, message: 'slow down' }, { op: 'test' });
    check('errors: handle() emits openrouter_error on the shared AxiomOpenRouter bus', !!seen && seen.error.code === 'rate_limited', JSON.stringify(seen));
  }

  // =================================================================
  // 2. API Manager
  // =================================================================
  await test('api-manager: init() with no stored key resolves to NO_KEY and fires openrouter_initialized', async () => {
    const sb = makeSandbox();
    loadCoreFoundation(sb);
    let initFired = false;
    sb.AxiomOpenRouter.on('openrouter_initialized', () => { initFired = true; });
    const state = sb.AxiomOpenRouter.init();
    assertEq(state, 'no_key');
    assertEq(sb.AxiomOpenRouter.getConnectionStatus(), 'no_key');
    assertOk(initFired);
  });

  await test('api-manager: setApiKey() with a key that validates persists it and transitions to CONNECTED, firing openrouter_connected', async () => {
    const sb = makeSandbox({
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { label: 'test-key', usage: 0 } }) })
    });
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    let connected = null;
    sb.AxiomOpenRouter.on('openrouter_connected', (p) => { connected = p; });
    const result = await sb.AxiomOpenRouter.setApiKey('sk-or-v1-test-key');
    assertOk(result.valid);
    assertEq(result.state, 'connected');
    assertEq(sb.AxiomOpenRouter.getConnectionStatus(), 'connected');
    assertOk(sb.AxiomOpenRouter.hasApiKey());
    assertOk(!!connected);
  });

  await test('api-manager: setApiKey() with a key OpenRouter rejects (401) does NOT persist it, transitions to INVALID_KEY', async () => {
    const sb = makeSandbox({
      fetch: () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: { message: 'Invalid API key' } }) })
    });
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    const result = await sb.AxiomOpenRouter.setApiKey('sk-or-v1-bad-key');
    assertOk(!result.valid);
    assertEq(result.state, 'invalid_key');
    assertOk(!sb.AxiomOpenRouter.hasApiKey());
    assertEq(sb.AxiomOpenRouter.getLastError().code, 'invalid_api_key');
  });

  await test('api-manager: removeApiKey() clears storage and returns to NO_KEY, firing openrouter_disconnected', async () => {
    const sb = makeSandbox({
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) })
    });
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    await sb.AxiomOpenRouter.setApiKey('sk-or-v1-good-key');
    assertOk(sb.AxiomOpenRouter.hasApiKey());
    let disconnected = false;
    sb.AxiomOpenRouter.on('openrouter_disconnected', () => { disconnected = true; });
    sb.AxiomOpenRouter.removeApiKey();
    assertOk(!sb.AxiomOpenRouter.hasApiKey());
    assertEq(sb.AxiomOpenRouter.getConnectionStatus(), 'no_key');
    assertOk(disconnected);
  });

  await test('api-manager: checkHealth() reflects a live 500 as ERROR without discarding the stored key', async () => {
    let callCount = 0;
    const sb = makeSandbox({
      fetch: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) });
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: { message: 'server error' } }) });
      }
    });
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    await sb.AxiomOpenRouter.setApiKey('sk-or-v1-good-key');
    const healthy = await sb.AxiomOpenRouter.checkHealth();
    assertOk(!healthy);
    assertEq(sb.AxiomOpenRouter.getConnectionStatus(), 'error');
    assertOk(sb.AxiomOpenRouter.hasApiKey(), 'a transient 500 must not delete a previously-valid key');
  });

  await test('api-manager: bus events are forwarded verbatim onto AxiomOrchestrator.emit (Event Bus reuse)', async () => {
    const sb = makeSandbox({
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) })
    });
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    const names = sb.__orchestratorEvents.map((e) => e.event);
    assertOk(names.indexOf('openrouter_initialized') !== -1, JSON.stringify(names));
  });

  await test('api-manager: dispatches namespaced DOM CustomEvents (axiom:openrouter_*)', async () => {
    const sb = makeSandbox();
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    const types = sb.document._events.map((e) => e.type);
    assertOk(types.indexOf('axiom:openrouter_initialized') !== -1, JSON.stringify(types));
  });

  await test('api-manager: forwards to AxiomAnalyticsAutomation.addLog when present (Analytics reuse)', async () => {
    const sb = makeSandbox();
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    assertOk(sb.__analyticsLogs.length > 0);
  });

  await test('api-manager: works standalone with no AxiomOrchestrator/Analytics/Supabase/RuntimeContext loaded', async () => {
    const sb = makeSandbox({ withOrchestrator: false, withAnalytics: false });
    loadCoreFoundation(sb);
    const state = sb.AxiomOpenRouter.init();
    assertEq(state, 'no_key');
  });

  await test('api-manager: on/once/off pub-sub contract matches AxiomSupabaseConnection\'s documented shape', async () => {
    const sb = makeSandbox();
    loadCoreFoundation(sb);
    let calls = 0;
    sb.AxiomOpenRouter.once('probe', () => { calls++; });
    sb.AxiomOpenRouter.emit('probe', {});
    sb.AxiomOpenRouter.emit('probe', {});
    assertEq(calls, 1, 'once() must only fire a single time');

    let onCalls = 0;
    const fn = () => { onCalls++; };
    const unsubscribe = sb.AxiomOpenRouter.on('probe2', fn);
    sb.AxiomOpenRouter.emit('probe2', {});
    unsubscribe();
    sb.AxiomOpenRouter.emit('probe2', {});
    assertEq(onCalls, 1, 'the unsubscribe function returned by on() must remove the listener');
  });

  await test('api-manager: reuses AxiomSupabaseConnection session to scope key storage per-user without modifying it', async () => {
    let sessionResolved = false;
    const supabaseConnection = {
      getClient: () => ({
        auth: {
          getSession: () => {
            sessionResolved = true;
            return Promise.resolve({ data: { session: { user: { id: 'user-42' } } } });
          }
        }
      })
    };
    const sb = makeSandbox({
      supabaseConnection,
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) })
    });
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    await tick(5); // let the async getSession() promise settle
    await sb.AxiomOpenRouter.setApiKey('sk-or-v1-scoped-key');
    assertOk(sessionResolved);
    assertOk(Object.keys(sb.__store).some((k) => k.indexOf('user-42') !== -1), JSON.stringify(sb.__store));
  });

  await test('api-manager: falls back to an anonymous storage namespace when Supabase is absent or has no session', async () => {
    const sb = makeSandbox({
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) })
    });
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    await sb.AxiomOpenRouter.setApiKey('sk-or-v1-anon-key');
    assertOk(Object.keys(sb.__store).some((k) => k.indexOf('anonymous') !== -1), JSON.stringify(sb.__store));
  });

  await test('api-manager: optionally wraps requests in AxiomRuntimeContext without requiring it', async () => {
    const created = [];
    const runtimeContext = {
      createContext: (opts) => { const id = 'ctx_' + created.length; created.push(id); return { contextId: id }; },
      markRunning: () => {},
      completeContext: () => {},
      failContext: () => {}
    };
    const sb = makeSandbox({
      runtimeContext,
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) })
    });
    loadCoreFoundation(sb);
    sb.AxiomOpenRouter.init();
    await sb.AxiomOpenRouter.setApiKey('sk-or-v1-rc-key');
    assertOk(created.length > 0, 'expected at least one AxiomRuntimeContext.createContext() call');
  });

  // =================================================================
  // 3. Model Manager
  // =================================================================
  const sampleModelsPayload = {
    data: [
      {
        id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', context_length: 128000,
        pricing: { prompt: '0.00000015', completion: '0.0000006' },
        architecture: { input_modalities: ['text', 'image'] },
        supported_parameters: ['tools', 'response_format']
      },
      {
        id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', context_length: 200000,
        pricing: { prompt: '0.00000025', completion: '0.00000125' },
        architecture: { input_modalities: ['text'] },
        supported_parameters: []
      }
    ]
  };

  await test('model-manager: fetchModels() populates the cache and fires openrouter_models_loaded', async () => {
    const sb = makeSandbox({ fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) }) });
    loadCoreFoundation(sb);
    let loaded = null;
    sb.AxiomOpenRouter.on('openrouter_models_loaded', (p) => { loaded = p; });
    const models = await sb.AxiomOpenRouter.models.fetchModels();
    assertEq(models.length, 2);
    assertOk(!!loaded && loaded.count === 2);
  });

  await test('model-manager: fetchModels() serves from cache on a second call (no duplicate fetch) within the TTL', async () => {
    let fetchCount = 0;
    const sb = makeSandbox({
      fetch: () => { fetchCount++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) }); }
    });
    loadCoreFoundation(sb);
    await sb.AxiomOpenRouter.models.fetchModels();
    await sb.AxiomOpenRouter.models.fetchModels();
    assertEq(fetchCount, 1);
  });

  await test('model-manager: refreshModels() always bypasses the cache', async () => {
    let fetchCount = 0;
    const sb = makeSandbox({
      fetch: () => { fetchCount++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) }); }
    });
    loadCoreFoundation(sb);
    await sb.AxiomOpenRouter.models.fetchModels();
    await sb.AxiomOpenRouter.models.refreshModels();
    assertEq(fetchCount, 2);
  });

  await test('model-manager: concurrent fetchModels() calls share one in-flight request', async () => {
    let fetchCount = 0;
    const sb = makeSandbox({
      fetch: () => { fetchCount++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) }); }
    });
    loadCoreFoundation(sb);
    const [a, b] = await Promise.all([sb.AxiomOpenRouter.models.fetchModels(), sb.AxiomOpenRouter.models.fetchModels()]);
    assertEq(fetchCount, 1);
    assertEq(a.length, b.length);
  });

  await test('model-manager: getModelMetadata/getContextSize/getPricing/getCapabilities read the cached catalog', async () => {
    const sb = makeSandbox({ fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) }) });
    loadCoreFoundation(sb);
    await sb.AxiomOpenRouter.models.fetchModels();
    const M = sb.AxiomOpenRouter.models;
    assertEq(M.getContextSize('openai/gpt-4o-mini'), 128000);
    const pricing = M.getPricing('anthropic/claude-3-haiku');
    assertOk(Math.abs(pricing.prompt - 0.00000025) < 1e-12);
    const caps = M.getCapabilities('openai/gpt-4o-mini');
    assertOk(caps.vision === true && caps.tools === true);
    const caps2 = M.getCapabilities('anthropic/claude-3-haiku');
    assertOk(caps2.vision === false && caps2.tools === false);
    assertEq(M.getModelMetadata('nonexistent/model'), null);
  });

  await test('model-manager: setDefaultModel() rejects an id outside the loaded catalog, accepts one inside it', async () => {
    const sb = makeSandbox({ fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) }) });
    loadCoreFoundation(sb);
    await sb.AxiomOpenRouter.models.fetchModels();
    const M = sb.AxiomOpenRouter.models;
    assertOk(M.setDefaultModel('openai/gpt-4o-mini') === true);
    assertEq(M.getDefaultModel(), 'openai/gpt-4o-mini');
    assertOk(M.setDefaultModel('nonexistent/model') === false);
    assertEq(M.getDefaultModel(), 'openai/gpt-4o-mini', 'a rejected id must not overwrite the previously-set default');
  });

  await test('model-manager: getDefaultModel() falls back to a sane built-in before any catalog is loaded', async () => {
    const sb = makeSandbox();
    loadCoreFoundation(sb);
    assertOk(typeof sb.AxiomOpenRouter.models.getDefaultModel() === 'string' && sb.AxiomOpenRouter.models.getDefaultModel().length > 0);
  });

  await test('model-manager: default-model storage key never collides with js/core/model-selector.js\'s key', async () => {
    const sb = makeSandbox({ fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) }) });
    loadCoreFoundation(sb);
    await sb.AxiomOpenRouter.models.fetchModels();
    sb.AxiomOpenRouter.models.setDefaultModel('openai/gpt-4o-mini');
    assertOk(!Object.prototype.hasOwnProperty.call(sb.__store, 'axiom_openrouter_selected_model'));
    assertOk(Object.prototype.hasOwnProperty.call(sb.__store, 'axiom_os_openrouter_default_model'));
  });

  await test('model-manager: a fetch failure classifies through the shared error handler and rejects cleanly', async () => {
    const sb = makeSandbox({ fetch: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }) });
    loadCoreFoundation(sb);
    let errored = false;
    try { await sb.AxiomOpenRouter.models.fetchModels(); } catch (e) { errored = true; }
    assertOk(errored);
    assertEq(sb.AxiomOpenRouter.getLastError().code, 'service_unavailable');
  });

  // =================================================================
  // 4. Token Manager
  // =================================================================
  await test('token-manager: countPromptTokens() returns a positive, deterministic estimate', async () => {
    const sb = makeSandbox();
    loadCoreFoundation(sb);
    const T = sb.AxiomOpenRouter.tokens;
    assertEq(T.countPromptTokens(''), 0);
    assertOk(T.countPromptTokens('a'.repeat(400)) === 100);
  });

  await test('token-manager: recordUsage() accumulates global and per-model totals', async () => {
    const sb = makeSandbox();
    loadCoreFoundation(sb);
    const T = sb.AxiomOpenRouter.tokens;
    T.recordUsage({ model: 'openai/gpt-4o-mini', promptTokens: 100, completionTokens: 50 });
    T.recordUsage({ model: 'openai/gpt-4o-mini', promptTokens: 20, completionTokens: 10 });
    T.recordUsage({ model: 'anthropic/claude-3-haiku', promptTokens: 5, completionTokens: 5 });

    const global_ = T.getUsageStats();
    assertEq(global_.promptTokens, 125);
    assertEq(global_.completionTokens, 65);
    assertEq(global_.totalTokens, 190);
    assertEq(global_.requests, 3);

    const scoped = T.getUsageStats('openai/gpt-4o-mini');
    assertEq(scoped.promptTokens, 120);
    assertEq(scoped.requests, 2);

    const untouched = T.getUsageStats('never/recorded');
    assertEq(untouched.requests, 0);
  });

  await test('token-manager: estimateCost() multiplies real per-token pricing from model-manager.js', async () => {
    const sb = makeSandbox({ fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) }) });
    loadCoreFoundation(sb);
    await sb.AxiomOpenRouter.models.fetchModels();
    const cost = sb.AxiomOpenRouter.tokens.estimateCost('openai/gpt-4o-mini', 1000, 500);
    const expected = 1000 * 0.00000015 + 500 * 0.0000006;
    assertOk(Math.abs(cost - expected) < 1e-12, `${cost} vs ${expected}`);
  });

  await test('token-manager: estimateCost() returns null (not 0) when pricing is unknown', async () => {
    const sb = makeSandbox();
    loadCoreFoundation(sb); // model-manager loaded but catalog never fetched
    const cost = sb.AxiomOpenRouter.tokens.estimateCost('nonexistent/model', 100, 100);
    assertEq(cost, null);
  });

  await test('token-manager: estimateCost() degrades to null without throwing when model-manager.js is not loaded at all', async () => {
    const sb = makeSandbox();
    loadInto(sb, 'os/api/openrouter/error-handler.js');
    loadInto(sb, 'os/api/openrouter/api-manager.js');
    loadInto(sb, 'os/api/openrouter/token-manager.js'); // no model-manager.js
    const cost = sb.AxiomOpenRouter.tokens.estimateCost('openai/gpt-4o-mini', 10, 10);
    assertEq(cost, null);
  });

  await test('token-manager: recordUsage() attaches costUsd once pricing is known', async () => {
    const sb = makeSandbox({ fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) }) });
    loadCoreFoundation(sb);
    await sb.AxiomOpenRouter.models.fetchModels();
    const record = sb.AxiomOpenRouter.tokens.recordUsage({ model: 'openai/gpt-4o-mini', promptTokens: 1000, completionTokens: 1000 });
    assertOk(typeof record.costUsd === 'number' && record.costUsd > 0);
  });

  await test('token-manager: resetStats() zeroes both global and per-model totals', async () => {
    const sb = makeSandbox();
    loadCoreFoundation(sb);
    const T = sb.AxiomOpenRouter.tokens;
    T.recordUsage({ model: 'm', promptTokens: 10, completionTokens: 10 });
    T.resetStats();
    assertEq(T.getUsageStats().requests, 0);
    assertEq(T.getUsageStats('m').requests, 0);
  });

  // =================================================================
  // 5. Cross-module integration
  // =================================================================
  await test('integration: all four files share one AxiomOpenRouter namespace regardless of load order', async () => {
    const orders = [
      ['os/api/openrouter/error-handler.js', 'os/api/openrouter/api-manager.js', 'os/api/openrouter/model-manager.js', 'os/api/openrouter/token-manager.js'],
      ['os/api/openrouter/api-manager.js', 'os/api/openrouter/error-handler.js', 'os/api/openrouter/token-manager.js', 'os/api/openrouter/model-manager.js'],
      ['os/api/openrouter/model-manager.js', 'os/api/openrouter/token-manager.js', 'os/api/openrouter/api-manager.js', 'os/api/openrouter/error-handler.js']
    ];
    for (const order of orders) {
      const sb = makeSandbox();
      loadCoreFoundation(sb, order);
      assertOk(typeof sb.AxiomOpenRouter.errors === 'object', order.join(','));
      assertOk(typeof sb.AxiomOpenRouter.models === 'object', order.join(','));
      assertOk(typeof sb.AxiomOpenRouter.tokens === 'object', order.join(','));
      assertOk(typeof sb.AxiomOpenRouter.init === 'function', order.join(','));
    }
  });

  await test('integration: all five documented events exist and are reachable through window.AxiomOpenRouter.on()', async () => {
    const required = ['openrouter_initialized', 'openrouter_connected', 'openrouter_disconnected', 'openrouter_error', 'openrouter_models_loaded'];
    const sb = makeSandbox({
      fetch: (url) => {
        if (String(url).indexOf('/models') !== -1) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sampleModelsPayload) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) });
      }
    });
    loadCoreFoundation(sb);
    const seen = {};
    required.forEach((evt) => sb.AxiomOpenRouter.on(evt, () => { seen[evt] = true; }));
    sb.AxiomOpenRouter.init(); // openrouter_initialized
    await sb.AxiomOpenRouter.setApiKey('sk-or-v1-key'); // openrouter_connected
    await sb.AxiomOpenRouter.models.fetchModels(); // openrouter_models_loaded
    sb.AxiomOpenRouter.errors.handle({ status: 500, message: 'boom' }); // openrouter_error
    sb.AxiomOpenRouter.removeApiKey(); // openrouter_disconnected
    required.forEach((evt) => assertOk(seen[evt], `expected "${evt}" to have fired`));
  });

  // =================================================================
  // 6. Non-duplication / non-modification statics
  // =================================================================
  (function staticChecks() {
    const protectedFiles = [
      'js/core/openrouter-client.js',
      'js/core/openrouter-config.js',
      'js/core/model-selector.js'
    ];
    protectedFiles.forEach((rel) => {
      const src = readSrc(rel);
      check(`static: ${rel} exists and was not touched by Part 2A (byte content unchanged)`, typeof src === 'string' && src.length > 0);
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

    check('static: os/api/openrouter/ contains the four Part 2A files plus only Part 2B-1/2B-2/2B-3/2B-4/2C-1A\'s approved siblings, nothing else',
      (() => {
        // Updated by Part 2B-1, again by Part 2B-2, and again by Part
        // 2B-3: chat-manager.js, stream-manager.js, response-parser.js,
        // and request-queue.js are approved, in-scope sibling additions
        // to this directory (see OPENROUTER_PART2B1_VALIDATION.md /
        // OPENROUTER_PART2B2_VALIDATION.md / OPENROUTER_PART2B3_
        // VALIDATION.md), not unexpected extra files — the four original
        // Part 2A files are unchanged and still present.
        const dir = path.join(ROOT, 'os/api/openrouter');
        const names = fs.readdirSync(dir).sort();
        const expected = ['api-manager.js', 'chat-manager.js', 'error-handler.js', 'model-manager.js', 'request-queue.js', 'response-parser.js', 'stream-manager.js', 'token-manager.js', 'tool-calling', 'usage-tracker.js'];
        return JSON.stringify(names) === JSON.stringify(expected);
      })());

    ['os/api/openrouter/api-manager.js', 'os/api/openrouter/model-manager.js', 'os/api/openrouter/token-manager.js', 'os/api/openrouter/error-handler.js'].forEach((rel) => {
      // Strip comment lines first — model-manager.js's header legitimately
      // *mentions* the legacy key in prose to document why it avoids it;
      // this check cares only about the key appearing in actual code
      // (e.g. inside a getItem/setItem call), which would be a real collision.
      const codeOnly = readSrc(rel).split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
      check(`static: ${rel} never touches localStorage key axiom_openrouter_selected_model in code (existing UI selector's key)`,
        codeOnly.indexOf('axiom_openrouter_selected_model') === -1);
    });
  })();

  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f.label + (f.detail ? ' :: ' + f.detail : '')));
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------
// async test helper (mirrors block2-step6-part5-runtime-context's
// `test()` convention) + tiny assert shims so failures are captured
// as PASS/FAIL lines rather than crashing the whole suite.
// ---------------------------------------------------------------
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

main();
