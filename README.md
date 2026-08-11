# AXIOM AI Studio

Credit-based AI playground with a JARVIS-style assistant, Supabase auth/RLS, an in-browser "OS" runtime (agents, memory, browser automation, workflows), and Razorpay billing. Static frontend, OpenRouter for model access, Supabase for auth/data/Edge Functions.

```
AXIOM PROJECT
    ↓
GitHub (private repo)
    ↓
Vercel (static hosting + build step)
    ↓
Supabase (auth, database, Edge Functions)
    ↓
OpenRouter (model inference)
```

## Stack

- **Frontend:** plain HTML/CSS/JS, no bundler — pages load `<script defer>` tags directly (see `os-shell.html`, `index.html`, etc.)
- **Auth / DB:** Supabase (Postgres + RLS + Auth)
- **AI inference:** OpenRouter, proxied through Supabase Edge Functions so the API key never reaches the browser
- **Hosting:** Vercel (static output + a Node build step for env injection)
- **Billing:** Razorpay

## Project layout

```
index.html, login.html, register.html, os-shell.html, ...   Pages
js/core/          Shared frontend modules (auth, i18n, Supabase client, OpenRouter client)
js/pages/          Per-page controllers
js/bridges/        Integration glue
os/                In-browser "OS": window manager, desktop, agent runtime, automation,
                   memory/knowledge graph, scheduler, plugins, OpenRouter API layer
components/        Shared UI components (dialogs, search, notifications, etc.)
styles/            CSS (design tokens, theme, per-surface styles)
locales/           i18n strings
assets/            Static media
supabase/          Edge Functions (openrouter-chat, openrouter-models, analyze-file,
                   owner-api-status) + supabase/config.toml
db/                SQL schema (run manually in the Supabase SQL editor)
scripts/           Build tooling (env injection)
docs/              Setup guides, changelog, and historical build/validation reports
```

## Environment variables

See `.env.example` for the full list and `docs/SUPABASE_SETUP.md` for details on where each one goes.

| Variable | Used by | Where to set it |
|---|---|---|
| `SUPABASE_URL` | Frontend (build-time) + Edge Functions | Vercel env vars (frontend); auto-injected for Edge Functions |
| `SUPABASE_ANON_KEY` | Frontend (build-time) | Vercel env vars |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only | `supabase secrets set` |
| `OPENROUTER_API_KEY` | Edge Functions only | `supabase secrets set` |

None of these are committed to the repo. The frontend build step (`npm run build` → `scripts/inject-env.js`) reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` from the environment at build time and writes the git-ignored `js/core/env.config.js` — see `js/core/env.config.template.js` for the shape it produces.

## Setup

1. **Database:** in the Supabase SQL editor, run `db/schema.sql`, then `db/agents-schema.sql`.
2. **Edge Functions:** deploy everything under `supabase/functions/` with the Supabase CLI and set `OPENROUTER_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` as function secrets. Full steps in `docs/SUPABASE_SETUP.md`.
3. **Frontend env:** set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in your hosting provider's environment variables.
4. **Build:** `npm run build` (runs `scripts/inject-env.js`). Do this before serving/deploying — the app will simply skip loading Supabase config if this hasn't been run.

## Deploy to Vercel

1. Push this repo to a **private** GitHub repository.
2. Import it in Vercel.
3. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` under Project Settings → Environment Variables.
4. Set the build command to `npm run build` (already the default in `package.json`) with a static output — no separate output directory needed, since the build step only rewrites `js/core/env.config.js` in place.
5. Deploy. See `docs/DEPLOYMENT_GUIDE.md` for more detail.

## Docs

- `docs/SUPABASE_SETUP.md` — full Supabase + secrets walkthrough
- `docs/DEPLOYMENT_GUIDE.md` — deployment steps
- `docs/CHANGELOG.md`, `docs/RELEASE_NOTES.md`, `docs/PROJECT_DOCUMENTATION.md`
- `docs/reports/` — historical build, audit, and validation reports from development
- `docs/milestones/`, `docs/audits/` — milestone deliverables and design audits

## Security notes

- No secrets are committed anywhere in this repo. `js/core/env.config.js` (real Supabase URL/anon key) is generated at build time and is git-ignored.
- `OPENROUTER_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are used exclusively inside Supabase Edge Functions (`supabase/functions/_shared/env.ts`) and are never sent to the browser.
- `js/core/dev-config.js` provides a local-only auth bypass for UI preview; it is hard-gated to `localhost` / `127.0.0.1` / `file://` and is always off on any real deployed domain, regardless of its internal flag.
