# Supabase backend setup — AXIOM

This project's frontend (`js/core/openrouter-client.js`, `js/pages/workspace.js`)
expects three Supabase Edge Functions to exist:

- `supabase/functions/openrouter-chat` — chat completions (streaming + non-streaming)
- `supabase/functions/openrouter-models` — model catalog
- `supabase/functions/analyze-file` — image OCR/caption, audio transcription

They didn't exist anywhere in the repo before this change. This doc is the
minimum you need to get them running locally and deployed. It assumes you
have **no Supabase project configured yet** — none of the steps below
require real credentials to exist in source control at any point.

---

## 1. Where `SUPABASE_URL` goes

- **Frontend (browser-safe):** set it as a host environment variable
  (e.g. Vercel → Project Settings → Environment Variables) named
  `SUPABASE_URL`. `npm run build` (→ `scripts/inject-env.js`) reads it from
  `process.env` at build time and writes it into `js/core/env.config.js`,
  which is git-ignored and never committed.
- **Local dev:** put it in your shell env or a local `.env` you don't
  commit, matching `.env.example`.
- **Edge Functions:** Supabase injects `SUPABASE_URL` into every Edge
  Function's runtime automatically — you do not need to set this one
  yourself with `supabase secrets set`.

## 2. Where `SUPABASE_ANON_KEY` goes

Same as `SUPABASE_URL` above — browser-safe, injected into
`js/core/env.config.js` at build time, and also auto-provided to Edge
Functions by the Supabase runtime. Never needs a manual secret.

## 3. Where `OPENROUTER_API_KEY` goes

**Server-only. Never in any frontend file, never in `env.config.js`, never
in `process.env` at build time.** It is read exclusively inside the Edge
Functions via `Deno.env.get('OPENROUTER_API_KEY')` (see
`supabase/functions/_shared/env.ts`). You set it once per environment with:

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx --project-ref <your-project-ref>
```

For local development, put it in `supabase/.env.local` (already covered by
Supabase CLI's default gitignore behavior for that path — double check it's
excluded before committing) and it's picked up by `supabase start` /
`supabase functions serve`.

**If this secret is missing, the functions do not crash or fall back to
anything insecure** — they return `500 { "error": "...", "code":
"NOT_CONFIGURED" }`. That's intentional (see `_shared/env.ts` `readEnv()`):
missing config fails loudly and safely instead of silently sending
`undefined` to OpenRouter or exposing internals.

## 4. How to run Supabase locally

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker.

```bash
# one-time
supabase login
supabase init          # only if this repo has never been `init`-ed — it already has supabase/config.toml, so skip if that file exists
supabase start          # boots local Postgres, Auth, Storage, Studio

# apply the schema (source of truth is db/schema.sql + db/agents-schema.sql,
# NOT a supabase/migrations folder — this project manages schema by hand)
psql "$(supabase status -o json | jq -r '.DB_URL')" -f db/schema.sql
psql "$(supabase status -o json | jq -r '.DB_URL')" -f db/agents-schema.sql

# set the one server-only secret for local functions
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx

# serve the three functions locally with hot reload
supabase functions serve --env-file supabase/.env.local
```

`supabase status` prints your local `SUPABASE_URL` (typically
`http://127.0.0.1:54321`) and `anon` key — use those for local frontend
testing per section 1/2.

## 5. How to deploy the Edge Functions

```bash
supabase link --project-ref <your-project-ref>   # once, connects this repo to a real project
supabase functions deploy openrouter-chat
supabase functions deploy openrouter-models
supabase functions deploy analyze-file
```

Or deploy all three at once: `supabase functions deploy`.

## 6. How to configure Supabase secrets

Run once per environment (local / staging / prod), after `supabase link`:

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
```

Verify what's set (values are never printed, only names) with:

```bash
supabase secrets list
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` do
**not** need to be set manually — the Supabase Edge Function runtime injects
all three automatically for every deployed/served function.

## 7. How the frontend connects to the functions

No change to the existing pattern — `js/core/openrouter-config.js` already
builds each endpoint as `${SUPABASE_URL}/functions/v1/<name>`, and
`js/core/openrouter-client.js` / `js/pages/workspace.js` already attach
`Authorization: Bearer <session.access_token>` and `apikey: <anon key>` on
every call. As soon as `SUPABASE_URL`/`SUPABASE_ANON_KEY` are set (section
1/2) and the three functions are deployed (section 5) with
`OPENROUTER_API_KEY` configured (section 3/6), the existing frontend code
works against them with no further changes.

---

## What each function actually does

| Function | Auth | Rate limit | Credits | Notes |
|---|---|---|---|---|
| `openrouter-chat` | Bearer session token, verified server-side | 30 req/min/user | Pre-checked + concurrency-capped via `begin_generation`/`end_generation`, charged via `deduct_credits` after the stream finishes | Forwards `tools`/`tool_choice` and preserves `tool_calls` verbatim — does not execute tools itself |
| `openrouter-models` | Bearer session token | — | — | 5-minute in-memory cache to avoid hammering OpenRouter |
| `analyze-file` | Bearer session token | 20 req/min/user | Pre-checked against `profiles.credits`, charged via `deduct_credits` | Images → vision model (OCR/caption); audio → audio-capable model (transcribe) |

All three use the `check_rate_limit`, `begin_generation`/`end_generation`,
and `deduct_credits` Postgres functions already defined in `db/schema.sql`
— no new tables or RPCs were added.
