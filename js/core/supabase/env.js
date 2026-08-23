// ============================================================
// AXIOM — Supabase Integration Part 1: Environment Configuration
// ------------------------------------------------------------
// Reads window.__AXIOM_ENV__ (populated by js/core/env.config.js,
// generated at build time from real process.env values — see
// scripts/inject-env.js and js/core/env.config.template.js) and
// validates it before anything else in the Supabase foundation
// is allowed to use it.
//
// Deliberately dependency-free: this must be able to run before
// the Supabase SDK script, before the shared logger, before
// anything. It only ever reads globals and never throws — a
// misconfigured environment produces a structured, inspectable
// result instead of an uncaught exception at page load.
//
// Public API — window.AxiomSupabaseEnv:
//   read()      -> { url, anonKey, source }              raw values, unvalidated
//   validate()  -> { valid, errors: [...], url, anonKey } memoized after first call
//   isValid()   -> boolean shorthand for validate().valid
// ============================================================
(function (global) {
  'use strict';

  var PLACEHOLDER_MARKERS = ['__SUPABASE_URL__', '__SUPABASE_ANON_KEY__', ''];
  var URL_PATTERN = /^https:\/\/[a-z0-9-]+\.[a-z0-9.-]+(?::\d+)?\/?$/i;

  var memoizedResult = null;

  function safeLog(level, message) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') {
        global.AxLogger[level](message);
        return;
      }
    } catch (e) { /* fall through to console */ }
    try {
      if (global.console && typeof global.console[level] === 'function') {
        global.console[level](message);
      }
    } catch (e) { /* logging must never throw */ }
  }

  function read() {
    var env = (global.__AXIOM_ENV__ && typeof global.__AXIOM_ENV__ === 'object') ? global.__AXIOM_ENV__ : {};
    var url = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : (typeof global.SUPABASE_URL === 'string' ? global.SUPABASE_URL.trim() : '');
    var anonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY.trim() : (typeof global.SUPABASE_ANON_KEY === 'string' ? global.SUPABASE_ANON_KEY.trim() : '');
    return {
      url: url,
      anonKey: anonKey,
      source: global.__AXIOM_ENV__ ? 'window.__AXIOM_ENV__' : (url ? 'global' : 'unset')
    };
  }

  function isPlaceholder(value) {
    return PLACEHOLDER_MARKERS.indexOf(value) !== -1;
  }

  function validate() {
    if (memoizedResult) return memoizedResult;

    var raw = read();
    var errors = [];

    if (isPlaceholder(raw.url)) {
      errors.push(
        raw.url === '' ?
          'SUPABASE_URL is not set. window.__AXIOM_ENV__ was not found — js/core/env.config.js is ' +
          'missing (run `npm run build` / scripts/inject-env.js with SUPABASE_URL and SUPABASE_ANON_KEY ' +
          'set in the environment), or it loaded after this script.' :
          'SUPABASE_URL is still the template placeholder value — the build step that fills in ' +
          'js/core/env.config.js from real environment variables has not run.'
      );
    } else if (!URL_PATTERN.test(raw.url)) {
      errors.push('SUPABASE_URL ("' + raw.url + '") is not a valid https:// URL.');
    }

    if (isPlaceholder(raw.anonKey)) {
      errors.push(
        raw.anonKey === '' ?
          'SUPABASE_ANON_KEY is not set (see SUPABASE_URL error above for the same root cause).' :
          'SUPABASE_ANON_KEY is still the template placeholder value.'
      );
    } else if (raw.anonKey.length < 20) {
      // Real Supabase anon keys (legacy JWT or new sb_publishable_* format)
      // are always well over 20 characters. This just catches an obviously
      // truncated/typo'd value early rather than failing deep inside the SDK.
      errors.push('SUPABASE_ANON_KEY looks too short to be a real anon/publishable key.');
    }

    memoizedResult = {
      valid: errors.length === 0,
      errors: errors,
      url: errors.length === 0 ? raw.url : null,
      anonKey: errors.length === 0 ? raw.anonKey : null
    };

    if (!memoizedResult.valid) {
      safeLog('error', '[AxiomSupabaseEnv] Configuration invalid:\n  - ' + errors.join('\n  - '));
    }

    return memoizedResult;
  }

  function isValid() {
    return validate().valid;
  }

  // Test/ops hook only — lets a controlled reset happen if __AXIOM_ENV__ is
  // legitimately replaced after load (e.g. by a test harness). Not part of
  // normal runtime flow.
  function _resetForTests() {
    memoizedResult = null;
  }

  global.AxiomSupabaseEnv = {
    read: read,
    validate: validate,
    isValid: isValid,
    _resetForTests: _resetForTests
  };
})(typeof window !== 'undefined' ? window : globalThis);
