// ============================================================
// AXIOM — Shared environment/secret access for Edge Functions
// ------------------------------------------------------------
// Centralizes reads of Deno.env so there is exactly one place that
// knows the names of the required secrets, and one place that decides
// what "not configured yet" looks like. No function should call
// Deno.env.get() directly — go through getRequiredEnv()/getConfig()
// so a missing secret always fails the same safe way (a clear 500
// "server not configured" JSON error) instead of crashing with an
// unhandled exception or silently sending `undefined` to OpenRouter.
//
// IMPORTANT: this file never logs, returns, or echoes a secret's
// value anywhere — only whether it is present.
// ============================================================

export interface MissingEnvError {
  missing: string[];
}

/**
 * Reads a list of required env var names. Returns { ok: true, values }
 * if all are present and non-empty, or { ok: false, missing } listing
 * exactly which ones are absent — never the values themselves.
 */
export type ReadEnvResult =
  | { ok: true; missing?: undefined; values: Record<string, string> }
  | { ok: false; missing: string[]; values?: undefined };

export function readEnv(names: string[]): ReadEnvResult {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const name of names) {
    const v = Deno.env.get(name);
    if (!v || !v.trim()) {
      missing.push(name);
    } else {
      values[name] = v.trim();
    }
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true, values };
}

/** The three secrets every function in this project may need. */
export const ENV_NAMES = {
  SUPABASE_URL: 'SUPABASE_URL',
  // Deno edge runtime reserves the SUPABASE_ prefix for its own
  // auto-injected project vars in some environments; SUPABASE_SERVICE_ROLE_KEY
  // is still the documented/standard secret name for Supabase Edge Functions,
  // and is what `supabase secrets set` expects — see README for the exact
  // command. If your CLI version rejects the name, alias it (e.g.
  // PROJECT_SERVICE_ROLE_KEY) in both `supabase secrets set` and here.
  SUPABASE_SERVICE_ROLE_KEY: 'SUPABASE_SERVICE_ROLE_KEY',
  OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
} as const;
