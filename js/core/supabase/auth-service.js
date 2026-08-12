// ============================================================
// AXIOM — Supabase Integration Part 1: Auth Service Foundation
// ------------------------------------------------------------
// A thin, read-oriented layer over supabase-js's own auth module:
// tracks the current session reactively, re-broadcasts changes
// through the same event surface as the Connection Manager
// (DOM CustomEvents + Orchestrator bus, both feature-detected),
// and gives future parts one place to read session/expiry state
// from instead of each page re-wiring `onAuthStateChange` itself.
//
// This is explicitly a FOUNDATION, not a rewrite of the existing
// login/register/logout UI wiring in js/core/auth.js — that file
// is untouched and keeps working exactly as before (it talks to
// `supabaseClient` directly, which js/core/supabase-config.js
// still provides for backward compatibility). Part 2+ can migrate
// that wiring onto this service; Part 1 only lays the foundation.
//
// Session persistence itself is intentionally NOT reimplemented
// here — supabase-js already persists the session to localStorage
// and handles token refresh internally. This module adds an
// observability layer on top (time-to-expiry, an "expiring soon"
// signal) rather than a second, competing persistence mechanism.
//
// Public API — window.AxiomSupabaseAuth:
//   init()                -> wires up onAuthStateChange (idempotent)
//   getSession()           -> Promise<Session|null>
//   getUser()               -> Promise<User|null>
//   isAuthenticated()       -> Promise<boolean>
//   getTimeToExpiryMs()     -> number|null (based on last known session)
//   on/once/off/emit        -> same tiny pub/sub contract as the Connection Manager
// ============================================================
(function (global) {
  'use strict';

  var initialized = false;
  var lastSession = null;
  var listeners = {};
  var expiryCheckTimer = null;
  var EXPIRY_WARNING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  var EXPIRY_CHECK_INTERVAL_MS = 60 * 1000;
  var warnedForCurrentSession = false;

  function on(event, fn) {
    if (typeof fn !== 'function') return function () {};
    if (!listeners[event]) listeners[event] = [];
    if (listeners[event].indexOf(fn) === -1) listeners[event].push(fn);
    return function () { off(event, fn); };
  }
  function once(event, fn) {
    if (typeof fn !== 'function') return function () {};
    var wrapper = function (payload, evt) { off(event, wrapper); fn(payload, evt); };
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
      try { subs[i](payload, event); } catch (e) { safeLog('error', '[AxiomSupabaseAuth] listener for "' + event + '" threw: ' + (e && e.message)); }
    }
    try {
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
        document.dispatchEvent(new CustomEvent('axiom:supabase:auth-' + event, { detail: payload }));
      }
    } catch (e) { /* ignore */ }
    try {
      if (global.AxiomOrchestrator && typeof global.AxiomOrchestrator.emit === 'function') {
        global.AxiomOrchestrator.emit('supabase:auth-' + event, payload);
      }
    } catch (e) { /* ignore */ }
  }

  function safeLog(level, message) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') { global.AxLogger[level](message); return; }
    } catch (e) { /* fall through */ }
    try { if (global.console && typeof global.console[level] === 'function') global.console[level](message); } catch (e2) { /* ignore */ }
  }

  function client() {
    return (global.AxiomSupabaseConnection && global.AxiomSupabaseConnection.getClient()) || null;
  }

  function getSession() {
    var c = client();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (res) {
      var session = (res && res.data && res.data.session) || null;
      lastSession = session;
      return session;
    }).catch(function (err) {
      safeLog('error', '[AxiomSupabaseAuth] getSession() failed: ' + (err && err.message));
      return null;
    });
  }

  function getUser() {
    return getSession().then(function (session) { return session ? session.user : null; });
  }

  function isAuthenticated() {
    return getSession().then(function (session) { return !!session; });
  }

  function getTimeToExpiryMs() {
    if (!lastSession || !lastSession.expires_at) return null;
    return (lastSession.expires_at * 1000) - Date.now();
  }

  function checkExpiryWarning() {
    var remaining = getTimeToExpiryMs();
    if (remaining === null) return;
    if (remaining <= 0) {
      emit('expired', { at: Date.now() });
      warnedForCurrentSession = false;
      return;
    }
    if (remaining <= EXPIRY_WARNING_WINDOW_MS && !warnedForCurrentSession) {
      warnedForCurrentSession = true;
      emit('expiring-soon', { remainingMs: remaining });
    }
  }

  function init() {
    if (initialized) return;
    var c = client();
    if (!c) {
      // Connection isn't ready yet (unconfigured env, or init() not called
      // yet) — retry once the Connection Manager reports it's connected.
      if (global.AxiomSupabaseConnection && typeof global.AxiomSupabaseConnection.once === 'function') {
        global.AxiomSupabaseConnection.once('state-changed', function (payload) {
          if (payload && payload.to === 'connected') init();
        });
      }
      return;
    }
    initialized = true;

    try {
      c.auth.onAuthStateChange(function (event, session) {
        lastSession = session || null;
        warnedForCurrentSession = false;
        emit('changed', { event: event, hasSession: !!session });
      });
    } catch (e) {
      safeLog('error', '[AxiomSupabaseAuth] onAuthStateChange wiring failed: ' + (e && e.message));
    }

    getSession(); // prime lastSession without waiting on the first auth event

    if (expiryCheckTimer) clearInterval(expiryCheckTimer);
    expiryCheckTimer = setInterval(checkExpiryWarning, EXPIRY_CHECK_INTERVAL_MS);
  }

  global.AxiomSupabaseAuth = {
    init: init,
    getSession: getSession,
    getUser: getUser,
    isAuthenticated: isAuthenticated,
    getTimeToExpiryMs: getTimeToExpiryMs,
    on: on,
    once: once,
    off: off,
    emit: emit
  };
})(typeof window !== 'undefined' ? window : globalThis);
