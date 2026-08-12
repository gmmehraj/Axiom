# AXIOM — Block 2 → Step 7 → Part 1: AI Runtime Integration

**Date:** 2026-08-01
**Scope:** One new registration (Coding Agent) added to
`os/core/agent-registry-integration.js`. No other source file changed
in this pass beyond that one. OpenRouter's live client was
investigated and deliberately **not** wired in — see below for exactly
why, verified rather than assumed.

## Phase A — Audit findings before any change was made

- **Coding Agent** already exists, but as
  `os/runtime/agent-definitions/coding-agent.js` — part of the
  **legacy** `os/runtime/` orchestration stack (the one
  `os-shell.html` uses), not this stack. Its `handler(task, ctx)`
  signature and context shape are specific to that stack's agent-manager
  and are not compatible with this stack's plain `handler(task)`
  contract. Rather than adapt that file, I registered a new, independent
  `coding` agent against the same real underlying toolkit
  (`os/runtime/capabilities/coding-toolkit.js`, `window.AxiomCodingToolkit`),
  which is self-contained and has no dependency on the legacy stack.
- **OpenRouter** (`window.OpenRouter`, defined in
  `js/core/openrouter-client.js`) is what `AxiomCodingToolkit` calls
  through for its model-dependent operations. Traced its real
  dependency chain before deciding whether to load it:
  `openrouter-client.js` requires `window.OpenRouterConfig`
  (`openrouter-config.js`) **and** bare top-level `supabaseClient` /
  `SUPABASE_ANON_KEY` identifiers from `supabase-config.js`, sharing the
  page's global scope — real authentication and per-request billing
  infrastructure, not a self-contained module. `automation.html` does
  not currently load `openrouter-client.js` or any of that chain.
  **Decision: did not add it in this pass.** Wiring it "safely" would
  need either (a) verifying it against a real Supabase project, which
  this environment doesn't have, or (b) fabricating a fake auth/session
  response to make it appear to work — which is exactly the kind of
  invented evidence this pass was told never to produce. What I verified
  instead: `AxiomCodingToolkit.hasClient()` correctly reports `false`
  when `window.OpenRouter` is absent, and every model-dependent
  operation fails or gracefully degrades rather than throwing an
  unhandled exception (see `AI_WORKFLOW_VALIDATION.md` for the actual
  captured behavior of each).
- Re-confirmed (unchanged from Part 6A/6B): `os/core/orchestrator.js`
  and `os/runtime/intelligence/orchestrator.js` are the only two files
  defining `window.AxiomOrchestrator`, they don't coexist on any single
  page, and `agent-registry-integration.js`'s `registerOnce()` already
  prevents duplicate registration for any agent id, including the new
  `coding` one (confirmed by re-running the Part 2 suite, 18/18 passing,
  after the new registration was added).

## Phase B — Agent registration, current real state

| Agent | Backed by | Registration result this pass |
|---|---|---|
| browser | `os/core/browser-manager.js` (real) | Unchanged, still registers — re-verified |
| brain | `os/core/axiom-brain.js` (real) | Unchanged, still registers — re-verified |
| memory | `os/core/memory-manager.js` (real) | Unchanged, still registers — re-verified |
| automation | `os/core/automation-manager.js` (real) | Unchanged, still registers — re-verified |
| analytics | `js/pages/analytics-automation-ultimate.js` (real) | Registration logic suite-covered; live registration against the real module not attempted (unchanged from Part 6B — see that pass's `LIVE_RUNTIME_VALIDATION.md` for why) |
| **coding** | `os/runtime/capabilities/coding-toolkit.js` (real) | **New this pass** — registers successfully, `healthy`, confirmed via live execution |
| system | Orchestrator's own stats | Unchanged, still registers — re-verified |

"Future Agents" (as named generically in the request) — no other
concrete subsystem in this repo currently exposes a real, loadable API
matching this pattern beyond the seven above. Nothing was invented to
fill that placeholder.

## No duplicate registration, no global conflicts (re-verified)

- `registerOnce()` checks `Orchestrator.getAgent(config.id)` before
  registering — confirmed working for `coding` exactly as it does for
  the other six, by the harness logging "Registered agent \"coding\"."
  exactly once across every run in this pass.
- No new global name was introduced — `registerCodingAgent()` is a
  function inside the existing `agent-registry-integration.js` IIFE, not
  a new top-level global.
- Confirmed via `grep` that `window.AxiomCodingToolkit` is defined in
  exactly one file in the repo — no collision.

## Regression re-verified after this change

All five Step 6 suites re-run against the current source: 21/21, 18/18,
20/20, 29/29, 42/42 — **130/130, unchanged**.
