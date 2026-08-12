# AXIOM — Project Documentation

**Version:** 1.0.0 (per `package.json`)
**As of:** Phase 10 Part 2 release candidate, 2026-07-30

This document describes what's actually in the repository, based on
direct inspection of the codebase for this phase — it is not
reconstructed from earlier phase notes.

## 1. What AXIOM is

Per `package.json`'s own description: a credit-based AI studio/
playground with a chat assistant, Supabase-backed auth and billing via
Razorpay. It's built as a static multi-page app — no framework, no
bundler.

## 2. Top-level layout

| Path | Contents |
|---|---|
| `*.html` (16 files) | One HTML file per page/route — see §3 |
| `js/core/` | Shared infrastructure: app bootstrap, auth, i18n, accessibility, config for Supabase/Razorpay/OpenRouter, voice control, script/state management |
| `js/pages/` | Per-page logic, one or more files per page (≈10,200 lines across 19 files) |
| `js/bridges/` | Glue modules connecting the chat, workspace, and conversation systems together |
| `os/` | The "AXIOM OS" runtime — a larger subsystem (95 JS files) implementing agents, plugins, automation, and a virtual desktop shell (see §4) |
| `styles/` | Design tokens, theming, accessibility rules, per-feature stylesheets |
| `locales/` | `en.json` plus 9 translated locale files, all at full key parity |
| `components/` | Shared UI chrome, e.g. `premium-shell.js` (nav labels, topbar/sidebar enhancement) |
| `db/` | Database schema / migrations for Supabase |
| `test-evidence/` | Regression and static-audit scripts plus their saved output, used as this project's QA paper trail |
| `docs/` | Milestone deliverable write-ups and design-audit notes from earlier phases |
| `_archive/` | Legacy/unused code, confirmed not referenced by any live page |

## 3. Pages

`index.html`, `login.html`, `register.html`, `os-shell.html`,
`workspace.html`, `playground.html`, `agent-library.html`,
`billing.html`, `settings.html`, `admin.html`, `analytics.html`,
`automation.html`, `brain.html`, `browser.html`, `memory.html`,
`studios.html`.

Every page loads `components/premium-shell.js` for shared chrome
(confirmed by direct grep — 12 of the 16 pages reference it directly;
the remainder inherit it via the OS shell).

## 4. The `os/` runtime

This is the largest and most structurally distinct part of the
codebase (95 files). It implements:

- **Agent system** — `os/runtime/agent-manager.js`, plus an
  `agent-definitions/` catalog (`js/core/agents-catalog.js` lists 24
  agent/tool entries).
- **Plugin system** — `os/runtime/plugins/` (`plugin-manager.js`,
  `plugin-manifest.js`), with a separate `plugin-registry.js` under
  `os/runtime/scheduler/`.
- **Automation** — `os/runtime/automation/` (workflow engine,
  trigger scheduler, skill registry).
- **Intelligence layer** — `os/runtime/intelligence/` (dynamic
  workflow orchestration, error recovery, runtime monitoring).
- **Knowledge layer** — `os/runtime/knowledge/` (semantic search,
  knowledge graph, memory summarizer, duplicate detector).
- **Desktop shell** — `os/core/` (window manager, workspace manager,
  snap zones, theme engine, motion system) gives the OS-style
  multi-window feel referenced by `os-shell.html`.

Each of these areas has a corresponding regression suite in
`test-evidence/` (Milestones 5, 6, 10–14), which is the project's own
internal versioning scheme for this runtime's development.

## 5. Configuration surface

Three external services are wired in via `js/core/*-config.js` files
— see `DEPLOYMENT_GUIDE.md` for what each needs before a production
deploy: Supabase (auth, database, Edge Functions), Razorpay (billing),
and OpenRouter (proxied through Supabase Edge Functions, so no
OpenRouter key lives in this repo).

## 6. Internationalization

`locales/en.json` is the reference locale (148 keys). 9 additional
locale files (`ar`, `de`, `es`, `fr`, `hi`, `ja`, `ta`, `ur`,
`zh-Hans`) are maintained at full key parity — independently
re-verified this phase, 0 missing/extra keys in every file.
`locales/_registry.js` wires them into the app.

## 7. Design system

`styles/design-tokens.css` centralizes 177 uniquely-named custom
properties (colors, spacing, radii, shadows, typography, transitions)
consolidated from what were originally 8 separate stylesheets — see
the file's own header comment for the consolidation history.
`styles/accessibility.css` carries 30 `focus-visible` /
`prefers-reduced-motion` / `aria-*` rules. 88 uniquely-named
`@keyframes` animations exist across the stylesheets in total.

## 8. QA / test infrastructure

`test-evidence/` holds hand-written regression and static-audit
scripts (no external test framework) plus their last-run output. Two
suites run cleanly in this environment with plain Node
(`phase9-part1-static-audit-suite.js` — 1302 checks;
`milestone14-part1-regression-suite.js` — 58 checks against the real
runtime). The remaining milestone suites (5, 5-manual-commands, 6,
10–13) require `jsdom`, which this sandboxed environment cannot
install (no package-registry network access) — see
`FINAL_AUDIT_REPORT.md` for the reproduction of that limitation.

## 9. Known limitations

See `FINAL_AUDIT_REPORT.md` §"What could not be verified in this
environment" and `DEPLOYMENT_GUIDE.md` §4 for the full pre-launch
checklist. In short: everything checkable without a browser or live
network has been checked and is clean; live UI behavior, live AI/
billing flows, and cross-device visual QA still need a real staging
environment before this is launch-verified end-to-end.
