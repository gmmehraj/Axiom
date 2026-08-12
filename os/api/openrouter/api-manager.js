// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2A: OpenRouter Core Foundation
// API Manager
// ------------------------------------------------------------
// Owns the OpenRouter *connection* lifecycle for the new os/api
// layer: storing/removing/validating a user-supplied OpenRouter API
// key, connection state, health checks, and the shared pub/sub bus
// that model-manager.js and token-manager.js publish onto.
//
// IMPORTANT — this is a second, independent OpenRouter integration,
// not a replacement for js/core/openrouter-client.js:
//   - js/core/openrouter-client.js (existing, untouched) is the
//     chat-UI integration: every request is proxied through Supabase
//     Edge Functions, which hold Axiom's own OpenRouter key
//     server-side and bill it against the signed-in user's credit
//     balance. The browser never sees a real OpenRouter key there.
//   - os/api/openrouter/* (this file and its siblings) is a new,
//     opt-in "bring your own key" (BYOK) foundation for the OS/agent
//     runtime layer: a user who supplies their own OpenRouter key
//     talks to OpenRouter directly, with no Axiom billing involved.
// The two are intentionally kept separate — different storage keys,
// different endpoints, different global namespaces — so this file
// cannot collide with or silently change the existing chat pipeline.
// See OPENROUTER_PART2A_VALIDATION.md for the full rationale.
//
// Purely additive, same convention as js/core/supabase/connection-
// manager.js and os/core/runtime-context.js: every integration with
// another subsystem (Orchestrator, Runtime Context, Logger,
// Analytics, Supabase) is feature-detected and try/catched, so this
// module is fully functional with none of them loaded, and never
// reaches into or modifies any of their internals.
//
// Public API — window.AxiomOpenRouter (api-manager.js portion):
//   API_VERSION
//   STATES
//   init(options?)                 -> connection state string
//   setApiKey(key)                 -> Promise<{valid, state}>  (stores + validates)
//   removeApiKey()                 -> void (clears key + resets state)
//   hasApiKey()                    -> boolean
//   validateApiKey(key?)           -> Promise<{valid, keyInfo?, error?}>
//   getConnectionStatus()          -> state string
//   getLastError()                 -> last classified error, or null
//   checkHealth()                  -> Promise<boolean>
//   configure(overrides)           -> void
//   on/once/off/emit               -> shared pub/sub (model-manager.js /
//                                      token-manager.js publish onto this)
// ============================================================
(function (global) {
  'use strict';

  var API_VERSION = '1.0.0';

  var BASE_URL = 'https://openrouter.ai/api/v1';
  var KEY_INFO_ENDPOINT = BASE_URL + '/key';

  var STATES = {
    UNINITIALIZED: 'uninitialized',
    NO_KEY: 'no_key',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    INVALID_KEY: 'invalid_key',
    DISCONNECTED: 'disconnected',
    ERROR: 'error'
  };

  var STORAGE_PREFIX = 'axiom_os_openrouter_api_key';
  var STORAGE_ANON_SUFFIX = 'anonymous';

  var options = {
    healthCheckIntervalMs: 60000,
    healthCheckTimeoutMs: 10000,
    requestTimeoutMs: 15000
  };

  var state = STATES.UNINITIALIZED;
  var lastError = null;
  var lastKeyInfo = null;
  var healthTimer = null;
  var storageNamespace = STORAGE_ANON_SUFFIX;
  var listeners = {}; // event -> Array<fn>

  // ---------- tiny pub/sub (mirrors AxiomOrchestrator's / AxiomSupabaseConnection's documented bus contract) ----------

  function on(event, fn) {
    if (typeof fn !== 'function') return function () {};
    if (!listeners[event]) listeners[event] = [];
    if (listeners[event].indexOf(fn) === -1) listeners[event].push(fn);
    return function () { off(event, fn); };
  }

  function once(event, fn) {
    if (typeof fn !== 'function') return function () {};
    var wrapper = function (payload, evt) {
      off(event, wrapper);
      fn(payload, evt);
    };
    return on(event, wrapper);
  }

  function off(event, fn) {
    if (!listeners[event]) return;
    if (!fn) { listeners[event] = []; return; }
    var idx = listeners[event].indexOf(fn);
    if (idx !== -1) listeners[event].splice(idx, 1);
  }

  function emit(event, payload) {
    var subs = (listeners[event] || []).slice();
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](payload, event); } catch (e) { safeLog('error', 'listener for "' + event + '" threw: ' + (e && e.message)); }
    }
    dispatchDomEvent(event, payload);
    forwardToOrchestrator(event, payload);
    forwardToAnalytics(event, payload);
  }

  function dispatchDomEvent(event, payload) {
    try {
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
        document.dispatchEvent(new CustomEvent('axiom:' + event, { detail: payload }));
      }
    } catch (e) { /* never let telemetry break the app */ }
  }

  function forwardToOrchestrator(event, payload) {
    try {
      if (global.AxiomOrchestrator && typeof global.AxiomOrchestrator.emit === 'function') {
        // Forwarded verbatim (not re-namespaced): the five events this
        // module emits — openrouter_initialized, openrouter_connected,
        // openrouter_disconnected, openrouter_error,
        // openrouter_models_loaded — are the documented public contract
        // per OPENROUTER_PART2A_VALIDATION.md, so a listener doing
        // AxiomOrchestrator.on('openrouter_connected', ...) works
        // identically to AxiomOpenRouter.on('openrouter_connected', ...).
        global.AxiomOrchestrator.emit(event, payload);
      }
    } catch (e) { /* Orchestrator absent or incompatible — ignore */ }
  }

  function forwardToAnalytics(event, payload) {
    // Same optional-analytics pattern as connection-manager.js (Vercel
    // Analytics' window.va), plus the in-app Analytics workspace's own
    // log surface (window.AxiomAnalyticsAutomation.addLog) when present
    // — reusing whichever analytics hook the page already has instead
    // of introducing a third one.
    try {
      if (typeof global.va === 'function') {
        global.va('event', { name: 'axiom_' + event, data: { state: state } });
      }
    } catch (e) { /* ignore */ }
    try {
      if (global.AxiomAnalyticsAutomation && typeof global.AxiomAnalyticsAutomation.addLog === 'function') {
        var logType = /error|disconnected|invalid/i.test(event) ? 'error' : 'info';
        global.AxiomAnalyticsAutomation.addLog('[OpenRouter] ' + event, logType);
      }
    } catch (e2) { /* ignore */ }
  }

  function safeLog(level, message, detail) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') {
        global.AxLogger[level]('[AxiomOpenRouter] ' + message, detail || '');
        return;
      }
    } catch (e) { /* fall through */ }
    try { if (global.console && typeof global.console[level] === 'function') global.console[level]('[AxiomOpenRouter] ' + message, detail || ''); } catch (e2) { /* ignore */ }
  }

  // ---------- error classification (delegates to error-handler.js when present) ----------

  function classifyError(input, context) {
    var classified;
    if (global.AxiomOpenRouter && global.AxiomOpenRouter.errors && typeof global.AxiomOpenRouter.errors.classify === 'function') {
      classified = global.AxiomOpenRouter.errors.classify(input);
    } else {
      // error-handler.js not loaded — minimal inline fallback so this
      // file never hard-depends on load order.
      classified = { code: 'unknown', status: (input && input.status) || null, message: (input && input.message) || String(input), retryable: false, at: Date.now(), raw: input || null };
    }
    lastError = classified;
    safeLog('error', classified.message, Object.assign({ code: classified.code }, context || {}));
    emit('openrouter_error', Object.assign({ error: classified }, context || {}));
    return classified;
  }

  // ---------- optional Runtime Context integration ----------
  // Wraps a network call in an AxiomRuntimeContext record (when the
  // engine is loaded) purely for observability — createContext() /
  // markRunning() / completeContext()/failContext(). Never required;
  // falls straight through to `fn()` otherwise.
  function withRuntimeContext(label, fn) {
    var RC = global.AxiomRuntimeContext;
    if (!RC || typeof RC.createContext !== 'function') return fn();
    var ctx;
    try {
      ctx = RC.createContext({ ownerAgent: 'openrouter', metadata: { op: label } });
      RC.markRunning(ctx.contextId);
    } catch (e) { return fn(); } // Runtime Context rejected/unavailable — degrade silently
    var settle = function (ok, payload) {
      try { ok ? RC.completeContext(ctx.contextId, { ok: true }) : RC.failContext(ctx.contextId, payload && payload.message); } catch (e2) { /* ignore */ }
    };
    return fn().then(
      function (result) { settle(true); return result; },
      function (err) { settle(false, err); throw err; }
    );
  }

  // ---------- optional Supabase reuse: per-user key storage namespace ----------
  // Reuses the existing, unmodified AxiomSupabaseConnection client to
  // scope the locally-stored OpenRouter key to the signed-in user, so
  // a shared/kiosk browser doesn't leak one user's key to the next
  // session. Best-effort and fully optional: with no Supabase client
  // (or no session), storage falls back to a single "anonymous"
  // namespace, same as before this integration existed.
  function refreshStorageNamespace() {
    try {
      var conn = global.AxiomSupabaseConnection;
      var client = conn && typeof conn.getClient === 'function' ? conn.getClient() : null;
      if (!client || !client.auth || typeof client.auth.getSession !== 'function') return;
      client.auth.getSession().then(function (res) {
        var uid = res && res.data && res.data.session && res.data.session.user && res.data.session.user.id;
        storageNamespace = uid || STORAGE_ANON_SUFFIX;
      }).catch(function () { /* keep previous/anonymous namespace */ });
    } catch (e) { /* Supabase absent/incompatible — anonymous namespace */ }
  }

  function storageKey() {
    return STORAGE_PREFIX + ':' + storageNamespace;
  }

  // ---------- API key storage ----------

  function readStoredKey() {
    try { return global.localStorage ? global.localStorage.getItem(storageKey()) : null; } catch (e) { return null; }
  }

  function writeStoredKey(key) {
    try { if (global.localStorage) global.localStorage.setItem(storageKey(), key); return true; } catch (e) { return false; }
  }

  function clearStoredKey() {
    try { if (global.localStorage) global.localStorage.removeItem(storageKey()); return true; } catch (e) { return false; }
  }

  function hasApiKey() {
    return !!readStoredKey();
  }

  // ---------- HTTP helper ----------

  function withTimeout(makeRequest, ms) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timeoutId = global.setTimeout(function () { if (controller) controller.abort(); }, ms);
    return makeRequest(controller ? controller.signal : undefined).then(
      function (res) { global.clearTimeout(timeoutId); return res; },
      function (err) { global.clearTimeout(timeoutId); throw err; }
    );
  }

  /**
   * Calls OpenRouter's "get current API key" endpoint with the given
   * key. This both validates the key AND doubles as the health-check
   * probe (a single round trip serves both jobs — no separate
   * "ping" endpoint exists on OpenRouter's public API).
   */
  function fetchKeyInfo(key) {
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('fetch() is not available in this environment.'));
    }
    return withRuntimeContext('validate-key', function () {
      return withTimeout(function (signal) {
        return fetch(KEY_INFO_ENDPOINT, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + key },
          signal: signal
        });
      }, options.healthCheckTimeoutMs).then(function (res) {
        if (!res.ok) {
          var err = new Error('OpenRouter key check failed (HTTP ' + res.status + ').');
          err.status = res.status;
          throw err;
        }
        return res.json().catch(function () { return {}; });
      });
    });
  }

  /**
   * Validates a key against OpenRouter directly (no Axiom backend
   * involved — this is the BYOK path). Does not mutate stored state;
   * callers that want to persist a validated key use setApiKey().
   */
  function validateApiKey(key) {
    var target = key || readStoredKey();
    if (!target) {
      return Promise.resolve({ valid: false, error: { code: 'invalid_api_key', message: 'No API key provided or stored.' } });
    }
    return fetchKeyInfo(target).then(
      function (json) {
        var info = (json && json.data) || json || null;
        lastKeyInfo = info;
        return { valid: true, keyInfo: info };
      },
      function (err) {
        var classified = classifyError(err, { op: 'validateApiKey' });
        return { valid: false, error: classified };
      }
    );
  }

  // ---------- state transitions ----------

  function setState(next, extra) {
    if (!next) return;
    var prev = state;
    state = next;
    if (prev !== next) {
      safeLog('log', prev + ' -> ' + next);
      if (next === STATES.CONNECTED) emit('openrouter_connected', Object.assign({ from: prev, to: next }, extra || {}));
      else if (prev === STATES.CONNECTED && (next === STATES.DISCONNECTED || next === STATES.ERROR || next === STATES.INVALID_KEY || next === STATES.NO_KEY)) {
        emit('openrouter_disconnected', Object.assign({ from: prev, to: next }, extra || {}));
      }
    }
  }

  // ---------- health monitoring ----------

  function clearHealthTimer() { if (healthTimer) { global.clearInterval(healthTimer); healthTimer = null; } }

  function checkHealth() {
    var key = readStoredKey();
    if (!key) {
      setState(STATES.NO_KEY);
      return Promise.resolve(false);
    }
    setState(state === STATES.CONNECTED ? STATES.CONNECTED : STATES.CONNECTING);
    return fetchKeyInfo(key).then(
      function (json) {
        lastKeyInfo = (json && json.data) || json || null;
        setState(STATES.CONNECTED);
        return true;
      },
      function (err) {
        var classified = classifyError(err, { op: 'checkHealth' });
        setState(classified.code === 'invalid_api_key' ? STATES.INVALID_KEY : STATES.ERROR);
        return false;
      }
    );
  }

  function startHealthMonitor() {
    clearHealthTimer();
    healthTimer = global.setInterval(checkHealth, options.healthCheckIntervalMs);
  }

  // ---------- public key lifecycle ----------

  function setApiKey(key) {
    if (typeof key !== 'string' || !key.trim()) {
      return Promise.resolve({ valid: false, error: { code: 'invalid_api_key', message: 'API key must be a non-empty string.' } });
    }
    var trimmed = key.trim();
    setState(STATES.CONNECTING);
    return validateApiKey(trimmed).then(function (result) {
      if (result.valid) {
        writeStoredKey(trimmed);
        setState(STATES.CONNECTED);
        startHealthMonitor();
      } else {
        setState(STATES.INVALID_KEY);
      }
      return Object.assign({ state: state }, result);
    });
  }

  function removeApiKey() {
    clearStoredKey();
    clearHealthTimer();
    lastKeyInfo = null;
    setState(STATES.NO_KEY);
  }

  function getConnectionStatus() {
    return state;
  }

  function getLastError() {
    return lastError;
  }

  function getKeyInfo() {
    return lastKeyInfo;
  }

  function configure(overrides) {
    if (overrides && typeof overrides === 'object') {
      Object.keys(overrides).forEach(function (k) { if (k in options) options[k] = overrides[k]; });
    }
  }

  // ---------- init ----------

  var initialized = false;

  function init(initOptions) {
    if (initOptions) configure(initOptions);
    refreshStorageNamespace();
    if (hasApiKey()) {
      setState(STATES.CONNECTING);
      checkHealth().then(function () { startHealthMonitor(); });
    } else {
      setState(STATES.NO_KEY);
    }
    if (!initialized) {
      initialized = true;
      emit('openrouter_initialized', { at: Date.now(), apiVersion: API_VERSION });
    }
    return state;
  }

  var AxiomOpenRouterApi = {
    API_VERSION: API_VERSION,
    STATES: STATES,

    init: init,
    setApiKey: setApiKey,
    removeApiKey: removeApiKey,
    hasApiKey: hasApiKey,
    validateApiKey: validateApiKey,
    getConnectionStatus: getConnectionStatus,
    getLastError: getLastError,
    getKeyInfo: getKeyInfo,
    checkHealth: checkHealth,
    configure: configure,

    // internal helpers exposed for the sibling Part 2A files only —
    // not part of the documented public contract, but required so
    // model-manager.js / token-manager.js can make authenticated
    // requests without re-implementing key storage or timeouts.
    _internal: {
      BASE_URL: BASE_URL,
      getStoredKey: readStoredKey,
      withTimeout: withTimeout,
      withRuntimeContext: withRuntimeContext,
      classifyError: classifyError,
      requestTimeoutMs: function () { return options.requestTimeoutMs; }
    },

    on: on,
    once: once,
    off: off,
    emit: emit
  };

  // Install onto the shared namespace without clobbering a sibling
  // Part 2A file that may have already attached itself (e.g.
  // error-handler.js loaded first) — same convention used throughout
  // os/core/* for layering multiple Parts onto one global.
  global.AxiomOpenRouter = Object.assign(global.AxiomOpenRouter || {}, AxiomOpenRouterApi);
})(typeof window !== 'undefined' ? window : globalThis);
