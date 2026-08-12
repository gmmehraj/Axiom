// ============================================================
// AXIOM — Supabase Edge Function: owner-api-status
// ------------------------------------------------------------
// Backs the "AXIOM API & Services / Owner Access" section of the
// existing admin.html page. Read-only status reporting for an
// already-authenticated admin — this function does NOT accept or
// store any configuration; it only reports whether the pieces the
// app depends on are reachable and configured.
//
// Auth: reuses the project's existing auth architecture exactly
// like openrouter-chat/openrouter-models/analyze-file do — same
// _shared/auth.ts bearer-token check — and then ADDITIONALLY
// requires the caller's profiles.role to be 'admin' (same column /
// same convention as js/core/auth.js's client-side gate on
// admin.html, and the same public.is_admin() the DB's RLS policies
// use). A non-admin, or a request with no/invalid session, gets a
// 403 { error: 'ACCESS_DENIED' } — the client-side redirect in
// auth.js is a UX nicety, this is the actual boundary.
//
// Contract (matches js/pages/admin-api-services.js):
//   POST body (optional): { targets?: ('supabase'|'openrouter'|'edge_functions')[] }
//                          omitted/empty -> run all checks
//   Headers:   Authorization: Bearer <supabase access_token>
//              apikey: <supabase anon key>
//   Success:   { role: 'admin', checkedAt: ISOString, supabase?: {...},
//                openrouter?: {...}, edgeFunctions?: {...} }
//   Error:     { error: string, code?: string } — 401 (bad/missing
//               session) or 403 (session valid, not an admin)
//
// SECRET SAFETY: OPENROUTER_API_KEY and SUPABASE_SERVICE_ROLE_KEY
// are read (via _shared/env.ts, which never logs values) only to (a)
// decide CONFIGURED vs NOT_CONFIGURED and (b) make an upstream
// OpenRouter request server-side. Neither value, nor any substring
// of either, is ever placed in a response body, header, or log line.
// Every STATUS field below is one of a fixed enum of safe strings —
// never raw error bodies from upstream, which could otherwise leak
// key fragments or infra details.
// ============================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { handleOptions, jsonError, jsonOk } from '../_shared/cors.ts';
import { readEnv, ENV_NAMES } from '../_shared/env.ts';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';

type Status =
  | 'CONNECTED'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR';

const OPENROUTER_KEY_INFO_URL = 'https://openrouter.ai/api/v1/key';

function safeFetchStatus(fn: () => Promise<Status>): Promise<Status> {
  // Every check funnels through here so a network hiccup or an
  // unexpected upstream shape degrades to a safe enum value instead
  // of throwing (which would otherwise risk an unhandled error body
  // — possibly containing upstream details — reaching the response).
  return fn().catch(() => 'UNAVAILABLE' as Status);
}

async function checkSupabase(supabaseAdmin: SupabaseClient) {
  const database: Status = await safeFetchStatus(async () => {
    const { error } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true });
    if (error) return 'SERVER_ERROR';
    return 'CONNECTED';
  });

  const storage: Status = await safeFetchStatus(async () => {
    const { error } = await supabaseAdmin.storage.listBuckets();
    if (error) return 'NOT_CONFIGURED';
    return 'CONNECTED';
  });

  return {
    connection: 'CONNECTED' as Status, // we only get here after a validated session, i.e. the API itself answered
    authentication: 'CONNECTED' as Status, // same — authenticateRequest() already succeeded
    database,
    storage,
  };
}

async function checkOpenRouter() {
  const envResult = readEnv([ENV_NAMES.OPENROUTER_API_KEY]);
  if (!envResult.ok) {
    return { keyConfigured: false, connection: 'NOT_CONFIGURED' as Status, modelsAvailable: null as number | null };
  }

  const key = envResult.values[ENV_NAMES.OPENROUTER_API_KEY];
  const connection: Status = await safeFetchStatus(async () => {
    const res = await fetch(OPENROUTER_KEY_INFO_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) return 'AUTHENTICATION_FAILED';
    if (res.status === 429) return 'RATE_LIMITED';
    if (!res.ok) return 'SERVER_ERROR';
    return 'CONNECTED';
  });

  return { keyConfigured: true, connection, modelsAvailable: null as number | null };
}

function checkEdgeFunctions() {
  // These three functions are deployed from the same project and share
  // the same two secrets (OPENROUTER_API_KEY, SUPABASE_SERVICE_ROLE_KEY)
  // via `supabase secrets set`, which is project-wide, not per-function
  // — so this function's own env visibility is an accurate proxy for
  // "would openrouter-chat / openrouter-models / analyze-file also see
  // these secrets". We do not invoke them here: an admin health-check
  // page should not spend the caller's/owner's credits or quota just to
  // render a status pill.
  const secretsResult = readEnv([ENV_NAMES.OPENROUTER_API_KEY, ENV_NAMES.SUPABASE_SERVICE_ROLE_KEY]);
  const configured: Status = secretsResult.ok ? 'CONNECTED' : 'NOT_CONFIGURED';

  return {
    'openrouter-chat': configured,
    'openrouter-models': configured,
    'analyze-file': configured,
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
  }

  const coreEnv = readEnv([ENV_NAMES.SUPABASE_URL, ENV_NAMES.SUPABASE_SERVICE_ROLE_KEY]);
  if (!coreEnv.ok) {
    // Server not configured at all — nothing to check against. Still a
    // safe, secret-free error body.
    return jsonError(500, 'Server not configured.', 'SERVER_NOT_CONFIGURED');
  }

  let auth;
  try {
    auth = await authenticateRequest(req, coreEnv.values.SUPABASE_URL, coreEnv.values.SUPABASE_SERVICE_ROLE_KEY);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.status, err.message, 'UNAUTHENTICATED');
    return jsonError(401, 'Authentication failed.', 'UNAUTHENTICATED');
  }

  const { user, supabaseAdmin } = auth;

  // Admin gate — same column/convention as the client-side check in
  // js/core/auth.js (renderAppShell) and public.is_admin() in db/schema.sql.
  // Uses the service-role client so this check is authoritative
  // regardless of RLS, mirroring how the rest of this project treats
  // service-role Edge Functions as the source of truth for privileged
  // reads.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || profile?.role !== 'admin') {
    return jsonError(403, 'Access denied.', 'ACCESS_DENIED');
  }

  let targets: string[] = ['supabase', 'openrouter', 'edge_functions'];
  if (req.method === 'POST') {
    try {
      const body = await req.json().catch(() => null);
      if (body && Array.isArray(body.targets) && body.targets.length > 0) {
        targets = body.targets.filter((t: unknown) =>
          typeof t === 'string' && ['supabase', 'openrouter', 'edge_functions'].includes(t),
        );
        if (targets.length === 0) targets = ['supabase', 'openrouter', 'edge_functions'];
      }
    } catch {
      // malformed body -> fall back to running everything
    }
  }

  const result: Record<string, unknown> = {
    role: 'admin',
    checkedAt: new Date().toISOString(),
  };

  if (targets.includes('supabase')) {
    result.supabase = await checkSupabase(supabaseAdmin);
  }
  if (targets.includes('openrouter')) {
    result.openrouter = await checkOpenRouter();
  }
  if (targets.includes('edge_functions')) {
    result.edgeFunctions = checkEdgeFunctions();
  }

  return jsonOk(result);
});
