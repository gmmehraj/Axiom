// ============================================================
// AXIOM — Supabase Integration Part 1: Connection Manager
// ------------------------------------------------------------
// Owns the single Supabase client instance and everything about
// its connection lifecycle: creation, health monitoring, offline
// detection, and automatic reconnect with backoff. Nothing else
// in the codebase should call `supabase.createClient()` directly.
//
// Purely additive: does not touch Runtime Context, Orchestrator,
// Browser, Goal Manager, Memory, or AI Runtime. Where those
// systems expose an already-documented, sanctioned extension
// point, this module uses it (see the "optional integrations"
// section below); it never reaches into their internals and
// every call into them is feature-detected and try/catched so
// this module works identically whether or not they're loaded.
//
// State machine:
//   unconfigured -> the env failed validation; terminal until the
//                    page reloads with a valid env.config.js
//   connecting   -> client created, first health probe in flight
//   connected    -> last health probe succeeded
//   degraded     -> browser reports online, but the last health
//                    probe failed (Supabase unreachable/erroring)
//   offline      -> browser reports navigator.onLine === false
//   reconnecting -> a backoff-scheduled retry is pending
//
// Public API — window.AxiomSupabaseConnection:
//   getClient()               -> the supabase-js client, or null if unconfigured
//   getState()                -> current state string
//   isOnline()                -> boolean (state === 'connected')
//   getLastError()             -> last classified error, or null
//   checkHealth()              -> Promise<boolean>, forces an immediate probe
//   on/once/off/emit           -> tiny pub/sub, same contract as AxiomOrchestrator's
//   configure(options)         -> override health-check interval / backoff caps (call before init)
// ============================================================
(function (global) {
  'use strict';

  var STATES = ['unconfigured', 'connecting', 'connected', 'degraded', 'offline', 'reconnecting'];

  var options = {
    healthCheckIntervalMs: 30000,
    healthCheckTimeoutMs: 8000,
    backoffBaseMs: 1000,
    backoffMaxMs: 30000,
    backoffFactor: 2,
    backoffJitter: 0.2
  };

  var state = 'unconfigured';
  var client = null;
  var lastError = null;
  var reconnectAttempts = 0;
  var healthTimer = null;
  var reconnectTimer = null;
  var listeners = {}; // event -> Array<fn>

  // ---------- tiny pub/sub (mirrors AxiomOrchestrator's documented bus contract) ----------

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
      try { subs[i](payload, event); } catch (e) { safeLog('error', '[AxiomSupabaseConnection] listener for "' + event + '" threw: ' + (e && e.message)); }
    }
    // Also re-emit as a single umbrella event, same pattern as Orchestrator's
    // `lifecycle` event, for anything that wants to observe all activity.
    var umbrella = (listeners['state'] || []).slice();
    if (event !== 'state') {
      for (var j = 0; j < umbrella.length; j++) {
        try { umbrella[j]({ event: event, payload: payload }, 'state'); } catch (e2) { /* ignore */ }
      }
    }

    // Optional, feature-detected integrations. Every one of these is
    // additive and never required — the module is fully functional with
    // none of them present.
    dispatchDomEvent(event, payload);
    forwardToOrchestrator(event, payload);
    forwardToAnalytics(event, payload);
  }

  function dispatchDomEvent(event, payload) {
    try {
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
        document.dispatchEvent(new CustomEvent('axiom:supabase:' + event, { detail: payload }));
      }
    } catch (e) { /* never let telemetry break the app */ }
  }

  function forwardToOrchestrator(event, payload) {
    try {
      if (global.AxiomOrchestrator && typeof global.AxiomOrchestrator.emit === 'function') {
        global.AxiomOrchestrator.emit('supabase:' + event, payload);
      }
    } catch (e) { /* Orchestrator absent or incompatible — ignore */ }
  }

  function forwardToAnalytics(event, payload) {
    // Vercel Analytics' documented custom-event API (window.va), already a
    // project dependency (@vercel/analytics in package.json). No-op until
    // the analytics script tag is actually present on a page.
    try {
      if (typeof global.va === 'function') {
        global.va('event', { name: 'axiom_supabase_' + event, data: { state: state } });
      }
    } catch (e) { /* ignore */ }
  }

  function safeLog(level, message) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') { global.AxLogger[level](message); return; }
    } catch (e) { /* fall through */ }
    try { if (global.console && typeof global.console[level] === 'function') global.console[level](message); } catch (e2) { /* ignore */ }
  }

  // ---------- state transitions ----------

  function setState(next, extra) {
    if (STATES.indexOf(next) === -1) return;
    var prev = state;
    state = next;
    if (prev !== next) {
      safeLog('log', '[AxiomSupabaseConnection] ' + prev + ' -> ' + next);
      emit('state-changed', Object.assign({ from: prev, to: next }, extra || {}));
    }
  }

  // ---------- error classification ----------

  function classifyError(err) {
    var message = (err && (err.message || err.toString && err.toString())) || 'Unknown error';
    var type = 'unknown';
    if (err && err.name === 'AbortError') type = 'timeout';
    else if (/network|fetch|failed to fetch/i.test(message)) type = 'network';
    else if (/auth|jwt|token|api ?key/i.test(message)) type = 'auth';
    else if (/config|url/i.test(message)) type = 'config';
    var classified = { type: type, message: message, at: Date.now() };
    lastError = classified;
    return classified;
  }

  // ---------- offline detection ----------

  function isBrowserOnline() {
    try {
      return typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' || navigator.onLine;
    } catch (e) {
      return true; // assume online if we can't tell — the health probe is the real source of truth anyway
    }
  }

  function attachOfflineDetection() {
    try {
      if (typeof global.addEventListener !== 'function') return;
      global.addEventListener('online', function () {
        safeLog('log', '[AxiomSupabaseConnection] browser reports online — probing');
        emit('browser-online', {});
        checkHealth();
      });
      global.addEventListener('offline', function () {
        safeLog('warn', '[AxiomSupabaseConnection] browser reports offline');
        emit('browser-offline', {});
        clearHealthTimer();
        clearReconnectTimer();
        setState('offline');
      });
    } catch (e) { /* no window/addEventListener in this environment — degrade silently */ }
  }

  // ---------- health monitoring ----------

  function clearHealthTimer() { if (healthTimer) { clearInterval(healthTimer); healthTimer = null; } }
  function clearReconnectTimer() { if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } }

  function withTimeout(promise, ms) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timeoutId = setTimeout(function () { if (controller) controller.abort(); }, ms);
    return { promise: promise(controller), cleanup: function () { clearTimeout(timeoutId); } };
  }

  function probeOnce() {
    var env = AxiomSupabaseEnv.validate();
    if (!env.valid || typeof fetch !== 'function') {
      return Promise.resolve(false);
    }
    var wrapped = withTimeout(function (controller) {
      return fetch(env.url.replace(/\/$/, '') + '/auth/v1/health', {
        method: 'GET',
        headers: { apikey: env.anonKey },
        signal: controller ? controller.signal : undefined
      });
    }, options.healthCheckTimeoutMs);

    return wrapped.promise
      .then(function (res) {
        wrapped.cleanup();
        return !!(res && res.ok);
      })
      .catch(function (err) {
        wrapped.cleanup();
        classifyError(err);
        return false;
      });
  }

  function checkHealth() {
    return probeOnce().then(function (healthy) {
      if (!isBrowserOnline()) {
        setState('offline');
        return healthy;
      }
      if (healthy) {
        reconnectAttempts = 0;
        clearReconnectTimer();
        setState('connected');
      } else {
        setState('degraded');
        scheduleReconnect();
      }
      return healthy;
    });
  }

  function startHealthMonitor() {
    clearHealthTimer();
    healthTimer = setInterval(checkHealth, options.healthCheckIntervalMs);
  }

  // ---------- automatic reconnect (exponential backoff + jitter) ----------

  function scheduleReconnect() {
    if (reconnectTimer) return; // already scheduled
    if (!isBrowserOnline()) { setState('offline'); return; }

    var delay = Math.min(options.backoffMaxMs, options.backoffBaseMs * Math.pow(options.backoffFactor, reconnectAttempts));
    var jitterRange = delay * options.backoffJitter;
    delay = delay + (Math.random() * jitterRange * 2 - jitterRange);
    delay = Math.max(options.backoffBaseMs, Math.round(delay));

    reconnectAttempts++;
    setState('reconnecting', { attempt: reconnectAttempts, delayMs: delay });

    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      checkHealth();
    }, delay);
  }

  // ---------- client creation ----------

  function createClient() {
    var env = AxiomSupabaseEnv.validate();
    if (!env.valid) {
      setState('unconfigured', { errors: env.errors });
      return null;
    }
    if (typeof global.supabase === 'undefined' || typeof global.supabase.createClient !== 'function') {
      classifyError(new Error('Supabase SDK (window.supabase) is not loaded. Check the CDN <script> tag runs before this file.'));
      setState('unconfigured', { errors: ['Supabase SDK not loaded'] });
      return null;
    }
    try {
      client = global.supabase.createClient(env.url, env.anonKey);
      return client;
    } catch (e) {
      classifyError(e);
      setState('unconfigured', { errors: [e.message] });
      return null;
    }
  }

  function init() {
    if (client) return client; // idempotent — init() may be called more than once safely
    setState('connecting');
    var created = createClient();
    if (!created) return null;

    attachOfflineDetection();
    if (!isBrowserOnline()) {
      setState('offline');
    } else {
      checkHealth();
    }
    startHealthMonitor();
    return created;
  }

  function configure(overrides) {
    if (overrides && typeof overrides === 'object') {
      Object.keys(overrides).forEach(function (key) {
        if (key in options) options[key] = overrides[key];
      });
    }
  }

  global.AxiomSupabaseConnection = {
    init: init,
    getClient: function () { return client; },
    getState: function () { return state; },
    isOnline: function () { return state === 'connected'; },
    getLastError: function () { return lastError; },
    checkHealth: checkHealth,
    configure: configure,
    on: on,
    once: once,
    off: off,
    emit: emit
  };
})(typeof window !== 'undefined' ? window : globalThis);
