// ============================================================
// AXIOM — Supabase Edge Function: openrouter-models
// ------------------------------------------------------------
// Contract (matches js/core/openrouter-client.js fetchModels()):
//   GET, no body.
//   Headers:   Authorization: Bearer <supabase access_token>
//              apikey: <supabase anon key>
//   Success:   { data: [ { id, name, ... }, ... ] }  — same shape
//              OpenRouter's own /models endpoint returns, so the
//              client's existing `json.data.map(...)` keeps working
//              unmodified.
//   Error:     { error: string, code?: string }
//
// This function does not touch credits or rate limits — listing models
// is free. It exists purely so OPENROUTER_API_KEY never has to reach
// the browser to fetch the catalog.
// ============================================================

import { handleOptions, jsonError, jsonOk } from '../_shared/cors.ts';
import { readEnv, ENV_NAMES } from '../_shared/env.ts';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

// Cache the upstream catalog in memory for the lifetime of the function
// instance — it changes rarely, and this avoids hitting OpenRouter (and
// spending a round trip) on every single page load across every user.
let cachedModels: { fetchedAt: number; body: unknown } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'GET') {
    return jsonError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
  }

  const env = readEnv([
    ENV_NAMES.SUPABASE_URL,
    ENV_NAMES.SUPABASE_SERVICE_ROLE_KEY,
    ENV_NAMES.OPENROUTER_API_KEY,
  ]);
  if (env.ok === false) {
    return jsonError(
      500,
      'Server is not configured yet. Missing required secret(s): ' + env.missing.join(', ') + '.',
      'NOT_CONFIGURED',
    );
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY } = env.values;

  try {
    await authenticateRequest(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.status, e.message, 'UNAUTHENTICATED');
    return jsonError(401, 'Authentication failed.', 'UNAUTHENTICATED');
  }

  if (cachedModels && Date.now() - cachedModels.fetchedAt < CACHE_TTL_MS) {
    return jsonOk(cachedModels.body);
  }

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    });
  } catch (networkErr) {
    console.error('[openrouter-models] network error contacting OpenRouter:', networkErr);
    // Serve a stale cache rather than fail outright, if we have one.
    if (cachedModels) return jsonOk(cachedModels.body);
    return jsonError(502, 'Could not reach the model provider. Try again shortly.', 'UPSTREAM_UNREACHABLE');
  }

  if (!upstream.ok) {
    let detail = `OpenRouter request failed (HTTP ${upstream.status}).`;
    try {
      const errJson = await upstream.json();
      detail = errJson?.error?.message || errJson?.error || detail;
    } catch {
      // ignore non-JSON error body
    }
    if (cachedModels) return jsonOk(cachedModels.body);
    return jsonError(upstream.status, detail, 'UPSTREAM_ERROR');
  }

  let json: unknown;
  try {
    json = await upstream.json();
  } catch {
    if (cachedModels) return jsonOk(cachedModels.body);
    return jsonError(502, 'Model provider returned an unreadable response.', 'UPSTREAM_ERROR');
  }

  cachedModels = { fetchedAt: Date.now(), body: json };
  return jsonOk(json);
});
