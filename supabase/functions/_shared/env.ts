// ============================================================
// AXIOM — Shared environment/secret access for Edge Functions
// ============================================================

export interface MissingEnvError { missing: string[]; }

export type ReadEnvResult =
  | { ok: true; missing?: undefined; values: Record<string, string> }
  | { ok: false; missing: string[]; values?: undefined };

export function readEnv(names: string[]): ReadEnvResult {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const v = Deno.env.get(name);
    if (!v || !v.trim()) missing.push(name);
    else values[name] = v.trim();
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, values };
}

/** Secrets/configuration used by Supabase Edge Functions. */
export const ENV_NAMES = {
  SUPABASE_URL: 'SUPABASE_URL',
  SUPABASE_SERVICE_ROLE_KEY: 'SUPABASE_SERVICE_ROLE_KEY',
  OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
  ELEVENLABS_API_KEY: 'ELEVENLABS_API_KEY',
} as const;
