// ============================================================
// AXIOM — Shared request authentication for Edge Functions
// ------------------------------------------------------------
// Reuses the project's existing auth architecture: the frontend already
// signs users in via supabase-js (see js/core/supabase/auth-service.js)
// and sends the resulting session's access_token as a Bearer header on
// every Edge Function call (see js/core/openrouter-client.js
// authHeaders() and js/pages/workspace.js callAnalyzeFile()). This file
// does not invent a second auth system — it just validates that same
// token server-side with a service-role Supabase client, which is the
// standard pattern for Supabase Edge Functions.
// ============================================================

import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export interface AuthResult {
  user: User;
  /** Service-role client — bypasses RLS, use only for what the function needs. */
  supabaseAdmin: SupabaseClient;
}

/**
 * Validates the Authorization: Bearer <token> header against Supabase auth.
 * Returns the authenticated user + a service-role client on success, or
 * throws an AuthError the caller should translate into a 401 response.
 */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function authenticateRequest(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    throw new AuthError('Missing or malformed Authorization header.', 401);
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new AuthError('Missing bearer token.', 401);
  }

  // Service-role client so we can verify the token without also needing
  // the caller's anon key to line up, and so downstream DB calls
  // (credits, rate limits, usage logs) can use RPCs that expect an
  // authenticated service context.
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    throw new AuthError('Invalid or expired session. Please sign in again.', 401);
  }

  return { user: data.user, supabaseAdmin };
}
