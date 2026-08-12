// ============================================================
// AXIOM — Environment configuration TEMPLATE
// ------------------------------------------------------------
// This file is safe to commit: it carries no real credentials.
// It documents the two environment variables the Supabase
// integration requires and shows the exact shape the runtime
// expects on `window.__AXIOM_ENV__`.
//
// HOW THIS BECOMES REAL CONFIG AT DEPLOY TIME
// --------------------------------------------
// AXIOM has no bundler/build step for its page scripts (plain
// <script defer> tags), so "environment variables" can't be
// inlined by a bundler the way they would be in a Vite/webpack
// app. Instead:
//
//   1. Set SUPABASE_URL and SUPABASE_ANON_KEY as real environment
//      variables on your host (Vercel Project Settings → Environment
//      Variables, or your shell for local work).
//   2. Run `npm run build` (see scripts/inject-env.js) before you
//      serve/deploy. It reads those two variables from process.env
//      and writes js/core/env.config.js (gitignored — never
//      committed) with the real values filled in, in this same
//      `window.__AXIOM_ENV__` shape.
//   3. Every HTML page loads js/core/env.config.js before any other
//      Supabase script, so the values are available synchronously
//      — no network round trip needed at page load, and nothing
//      hardcoded in source.
//
// If you deploy without running the build step, js/core/env.config.js
// won't exist and the browser will silently skip that <script> tag
// (missing local files 404 quietly for a plain <script> — no page
// crash). AxiomSupabaseEnv then reports a clear "not configured"
// validation error instead of the app quietly using a dead client.
//
// Local/manual alternative: copy this file to js/core/env.config.js
// and fill in real values yourself. That file is gitignored so your
// real key never gets committed by accident.
// ============================================================
window.__AXIOM_ENV__ = window.__AXIOM_ENV__ || {
  SUPABASE_URL: "__SUPABASE_URL__",
  SUPABASE_ANON_KEY: "__SUPABASE_ANON_KEY__"
};
