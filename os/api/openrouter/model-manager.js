// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2A: OpenRouter Core Foundation
// Model Manager
// ------------------------------------------------------------
// Fetches and caches OpenRouter's model catalog (GET /models — a
// public, unauthenticated endpoint) and exposes per-model metadata
// (context size, pricing, capabilities) to the rest of the OS/agent
// runtime layer.
//
// Independent of, and never loaded by, js/core/model-selector.js
// (the existing chat-UI dropdown, which reads the smaller, proxied
// FALLBACK_MODELS list from js/core/openrouter-config.js). This file
// talks to OpenRouter's real /models endpoint directly and caches the
// full catalog (name, context_length, pricing, architecture) that the
// UI-tier selector doesn't need and doesn't fetch. Persists its
// default-model choice under its own storage key
// (axiom_os_openrouter_default_model) so it can never collide with
// the existing axiom_openrouter_selected_model key that
// js/core/model-selector.js already owns.
//
// Requires window.AxiomOpenRouter to already exist (api-manager.js
// loaded first) for the shared bus and request helpers; degrades to
// "cache-only, no live fetch" if api-manager.js isn't present, rather
// than throwing.
//
// Public API — window.AxiomOpenRouter.models:
//   fetchModels(force?)      -> Promise<Array<model>> (cached, TTL-based)
//   refreshModels()          -> Promise<Array<model>> (bypasses cache)
//   getModels()               -> Array<model>  (last cached list, sync)
//   getDefaultModel()         -> string
//   setDefaultModel(id)       -> boolean (false if id isn't in the cached catalog)
//   getModelMetadata(id)      -> model | null
//   getContextSize(id)        -> number | null
//   getPricing(id)            -> {prompt, completion, unit} | null
//   getCapabilities(id)       -> {text, vision, tools, jsonMode, ...} | null
// ============================================================
(function (global) {
  'use strict';

  var MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
  var CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — catalog changes rarely; avoids hammering the endpoint on every lookup
  var STORAGE_KEY_DEFAULT_MODEL = 'axiom_os_openrouter_default_model';
  var FALLBACK_DEFAULT_MODEL = 'openai/gpt-4o-mini';

  var cache = { models: [], byId: Object.create(null), fetchedAt: 0 };
  var inFlight = null;

  function safeLog(level, message) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') { global.AxLogger[level]('[AxiomOpenRouter:models] ' + message); return; }
    } catch (e) { /* fall through */ }
    try { if (global.console && typeof global.console[level] === 'function') global.console[level]('[AxiomOpenRouter:models] ' + message); } catch (e2) { /* ignore */ }
  }

  function busEmit(event, payload) {
    try {
      if (global.AxiomOpenRouter && typeof global.AxiomOpenRouter.emit === 'function') {
        global.AxiomOpenRouter.emit(event, payload);
      }
    } catch (e) { /* bus not installed — no-op */ }
  }

  function classifyAndReport(err, context) {
    try {
      var api = global.AxiomOpenRouter;
      if (api && api._internal && typeof api._internal.classifyError === 'function') {
        return api._internal.classifyError(err, context);
      }
      if (api && api.errors && typeof api.errors.handle === 'function') {
        return api.errors.handle(err, context);
      }
    } catch (e) { /* fall through */ }
    return { code: 'unknown', message: (err && err.message) || String(err), retryable: false };
  }

  // ---------- catalog normalization ----------

  function toNumberOrNull(v) {
    var n = typeof v === 'string' ? parseFloat(v) : v;
    return typeof n === 'number' && isFinite(n) ? n : null;
  }

  function normalizeModel(raw) {
    var id = raw.id;
    var pricing = raw.pricing || {};
    var arch = raw.architecture || {};
    var inputModalities = Array.isArray(arch.input_modalities) ? arch.input_modalities : (arch.modality ? String(arch.modality).split('->')[0].split('+') : ['text']);
    var supportedParams = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];

    return {
      id: id,
      name: raw.name || id,
      description: raw.description || '',
      vendor: (id.split('/')[0] || 'other'),
      contextSize: toNumberOrNull(raw.context_length),
      pricing: {
        // OpenRouter reports pricing as a decimal-string cost *per token*
        // in USD; kept as-is here (token-manager.js does the per-request
        // multiplication) rather than pre-multiplying to "per 1K/1M"
        // and silently picking a convention callers might not expect.
        prompt: toNumberOrNull(pricing.prompt),
        completion: toNumberOrNull(pricing.completion),
        request: toNumberOrNull(pricing.request),
        image: toNumberOrNull(pricing.image),
        unit: 'USD per token'
      },
      capabilities: {
        text: inputModalities.indexOf('text') !== -1 || inputModalities.length === 0,
        vision: inputModalities.indexOf('image') !== -1,
        audio: inputModalities.indexOf('audio') !== -1,
        tools: supportedParams.indexOf('tools') !== -1,
        jsonMode: supportedParams.indexOf('response_format') !== -1,
        streaming: true // every OpenRouter chat-completions model supports SSE streaming
      },
      topProvider: raw.top_provider || null,
      raw: raw
    };
  }

  function setCache(list) {
    cache.models = list;
    cache.byId = Object.create(null);
    list.forEach(function (m) { cache.byId[m.id] = m; });
    cache.fetchedAt = Date.now();
  }

  // ---------- fetching ----------

  function doFetch() {
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('fetch() is not available in this environment.'));
    }
    var api = global.AxiomOpenRouter;
    var timeoutMs = (api && api._internal && typeof api._internal.requestTimeoutMs === 'function') ? api._internal.requestTimeoutMs() : 15000;

    var doRequest = function () {
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutId = global.setTimeout(function () { if (controller) controller.abort(); }, timeoutMs);
      return fetch(MODELS_ENDPOINT, { method: 'GET', signal: controller ? controller.signal : undefined })
        .then(function (res) {
          global.clearTimeout(timeoutId);
          if (!res.ok) {
            var err = new Error('Failed to fetch OpenRouter models (HTTP ' + res.status + ').');
            err.status = res.status;
            throw err;
          }
          return res.json();
        }, function (err) { global.clearTimeout(timeoutId); throw err; });
    };

    var runner = (api && api._internal && typeof api._internal.withRuntimeContext === 'function')
      ? function () { return api._internal.withRuntimeContext('fetch-models', doRequest); }
      : doRequest;

    return runner().then(function (json) {
      var list = Array.isArray(json && json.data) ? json.data : [];
      var normalized = list.map(normalizeModel);
      setCache(normalized);
      safeLog('log', 'loaded ' + normalized.length + ' models.');
      busEmit('openrouter_models_loaded', { count: normalized.length, at: cache.fetchedAt });
      return normalized;
    }, function (err) {
      classifyAndReport(err, { op: 'fetchModels' });
      throw err;
    });
  }

  /**
   * Returns the cached model list, fetching first if the cache is
   * empty or stale (>CACHE_TTL_MS old). Concurrent calls while a
   * fetch is already in flight share the same in-flight promise
   * instead of firing duplicate requests.
   */
  function fetchModels(force) {
    var isStale = (Date.now() - cache.fetchedAt) > CACHE_TTL_MS;
    if (!force && cache.models.length && !isStale) {
      return Promise.resolve(cache.models.slice());
    }
    if (inFlight) return inFlight;
    inFlight = doFetch().then(
      function (list) { inFlight = null; return list; },
      function (err) { inFlight = null; throw err; }
    );
    return inFlight;
  }

  function refreshModels() {
    return fetchModels(true);
  }

  function getModels() {
    return cache.models.slice();
  }

  // ---------- default model ----------

  function getDefaultModel() {
    try {
      var saved = global.localStorage ? global.localStorage.getItem(STORAGE_KEY_DEFAULT_MODEL) : null;
      if (saved) return saved;
    } catch (e) { /* ignore — fall back to built-in default */ }
    return FALLBACK_DEFAULT_MODEL;
  }

  function setDefaultModel(modelId) {
    if (!modelId) return false;
    // Only enforce "must be in the cached catalog" once we actually
    // have a catalog loaded — before the first fetchModels() call,
    // callers are allowed to pre-seed a choice.
    if (cache.models.length && !cache.byId[modelId]) return false;
    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY_DEFAULT_MODEL, modelId);
    } catch (e) { return false; }
    return true;
  }

  // ---------- per-model lookups ----------

  function getModelMetadata(modelId) {
    return cache.byId[modelId] || null;
  }

  function getContextSize(modelId) {
    var m = cache.byId[modelId];
    return m ? m.contextSize : null;
  }

  function getPricing(modelId) {
    var m = cache.byId[modelId];
    return m ? m.pricing : null;
  }

  function getCapabilities(modelId) {
    var m = cache.byId[modelId];
    return m ? m.capabilities : null;
  }

  var ModelManager = {
    fetchModels: fetchModels,
    refreshModels: refreshModels,
    getModels: getModels,
    getDefaultModel: getDefaultModel,
    setDefaultModel: setDefaultModel,
    getModelMetadata: getModelMetadata,
    getContextSize: getContextSize,
    getPricing: getPricing,
    getCapabilities: getCapabilities
  };

  global.AxiomOpenRouter = global.AxiomOpenRouter || {};
  global.AxiomOpenRouter.models = ModelManager;
})(typeof window !== 'undefined' ? window : globalThis);
