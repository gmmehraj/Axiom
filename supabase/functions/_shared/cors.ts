// ============================================================
// AXIOM — Shared CORS headers for Supabase Edge Functions
// ------------------------------------------------------------
// Every function in this project (openrouter-chat, openrouter-models,
// analyze-file, and any future one) imports this instead of redefining
// its own header object, so a CORS policy change happens in one place.
//
// Access-Control-Allow-Origin is "*" because these functions are called
// from a static frontend with no cookie-based session (auth is a bearer
// token in the Authorization header, not a cookie), so a wildcard origin
// does not widen what a malicious page could do — it still needs a valid
// Supabase access token, which it can only get by actually signing in.
// If that ever changes (e.g. cookie-based auth is introduced), lock this
// down to an explicit allow-list instead.
// ============================================================

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

/** Standard preflight response — call at the top of every function. */
export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

/** JSON error response with CORS headers already attached. */
export function jsonError(
  status: number,
  error: string,
  code?: string,
  extra?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({ error, ...(code ? { code } : {}), ...(extra || {}) }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
}

/** JSON success response with CORS headers already attached. */
export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
