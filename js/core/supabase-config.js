// ============================================================
// AXIOM — Supabase client configuration (Part 1 foundation shim)
// ------------------------------------------------------------
// This file used to hardcode SUPABASE_URL/SUPABASE_ANON_KEY and
// call supabase.createClient() directly. As of the Part 1 Core
// Infrastructure integration, both responsibilities moved to:
//   - js/core/supabase/env.js                (env read + validation)
//   - js/core/supabase/connection-manager.js  (client creation,
//     health monitoring, offline detection, auto-reconnect)
//
// This file now only declares the two bare top-level `const`s a
// handful of existing files rely on as shared-scope identifiers
// (not `window.` properties) — js/core/openrouter-config.js,
// js/core/openrouter-client.js, js/pages/billing-checkout.js, and
// js/pages/workspace.js all read SUPABASE_URL / SUPABASE_ANON_KEY
// this way. Kept as-is so none of those files needed to change.
//
// Load order (see any page's <head>, already updated):
//   1. Supabase SDK (CDN)
//   2. js/core/env.config.js            sets window.__AXIOM_ENV__
//   3. js/core/supabase/env.js          window.AxiomSupabaseEnv
//   4. js/core/supabase/connection-manager.js  window.AxiomSupabaseConnection
//   5. js/core/supabase/auth-service.js window.AxiomSupabaseAuth
//   6. js/core/supabase-config.js       <- this file
//
// No credentials are hardcoded anywhere in this file or its
// dependencies — see js/core/env.config.template.js and
// scripts/inject-env.js for how real values reach the browser.
// ============================================================
const supabaseClient = typeof AxiomSupabaseConnection !== 'undefined' && typeof AxiomSupabaseConnection.init === 'function'
  ? AxiomSupabaseConnection.init()
  : (typeof window !== 'undefined' && window.supabaseClient ? window.supabaseClient : null);

// Backward-compat bare identifiers for the handful of files listed
// above. Both are `null` when the environment failed validation —
// see AxiomSupabaseEnv.validate().errors (also logged to console)
// for exactly what's missing.
const _axiomEnv = typeof AxiomSupabaseEnv !== 'undefined' && typeof AxiomSupabaseEnv.validate === 'function'
  ? AxiomSupabaseEnv.validate()
  : (typeof window !== 'undefined' && window.__AXIOM_ENV__ ? { url: window.__AXIOM_ENV__.SUPABASE_URL || null, anonKey: window.__AXIOM_ENV__.SUPABASE_ANON_KEY || null, valid: !!window.__AXIOM_ENV__.SUPABASE_URL } : { url: null, anonKey: null, valid: false });

const SUPABASE_URL = _axiomEnv.url || (typeof window !== 'undefined' && window.SUPABASE_URL ? window.SUPABASE_URL : '');
const SUPABASE_ANON_KEY = _axiomEnv.anonKey || (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY ? window.SUPABASE_ANON_KEY : '');

if (typeof window !== 'undefined') {
  window.supabaseClient = supabaseClient;
  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
}

// Auth foundation starts as soon as the connection is (or becomes)
// available; safe no-op if the environment is unconfigured.
if (typeof AxiomSupabaseAuth !== 'undefined' && typeof AxiomSupabaseAuth.init === 'function') {
  AxiomSupabaseAuth.init();
}
