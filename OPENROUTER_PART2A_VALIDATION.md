# AXIOM — Block 2 / Step 9 / Part 2A: OpenRouter Core Foundation
## Validation Report

**Date:** 2026-08-06
**Deliverable:** `os/api/openrouter/{api-manager,model-manager,token-manager,error-handler}.js`,
global object `window.AxiomOpenRouter`, regression suite, this report.

---

## 1. Pre-implementation architecture audit

Before writing anything, the existing project (from
`AXIOM-Supabase-Integration-Part1-Core-Infrastructure.zip`) was audited
for infrastructure this Part is required to reuse rather than duplicate.

### 1.1 What already exists

| Concern | Existing module | Notes |
|---|---|---|
| Event Bus | `AxiomOrchestrator` (`os/core/orchestrator.js`) | In-process pub/sub: `on/once/off/emit/clear`, plus a `lifecycle` umbrella event. Not DOM-based by design. |
| Runtime Context | `AxiomRuntimeContext` (`os/core/runtime-context.js`) | Per-request/workflow in-memory execution state: `createContext/markRunning/completeContext/failContext`, auto-archival, auto-cleanup. Installs onto `AxiomOrchestrator` if present, else stands alone. |
| Logger | `AxLogger` (`os/shared/logger.js`) | `{log, warn, error}`, console fallback, never throws. |
| Analytics | `AxiomAnalyticsAutomation` (`js/pages/analytics-automation-ultimate.js`) | Real hook used elsewhere is `.addLog(msg, type)` (confirmed via its use in `os/core/agent-registry-integration.js`'s Analytics Agent). The `os/workspaces/analytics.js` "Analytics" workspace module, by contrast, is a pure UI iframe wrapper with no programmatic API — not a fit for reuse here. |
| Supabase | `AxiomSupabaseConnection` (`js/core/supabase/connection-manager.js`) | Owns the one `supabase-js` client + connection state machine + health monitor + reconnect backoff. Its documented pub/sub contract (`on/once/off/emit`, DOM `CustomEvent` forwarding, `AxiomOrchestrator.emit()` forwarding, optional `window.va()` analytics) is the template this Part's `api-manager.js` mirrors. |
| **Existing OpenRouter integration** | `js/core/openrouter-client.js` + `openrouter-config.js` + `model-selector.js` | **Found during the audit, not mentioned in the task brief.** See §2 — this is the single most important finding and shaped every design decision below. |

### 1.2 The existing OpenRouter integration, in detail

`js/core/openrouter-client.js` (`window.OpenRouter`) is the chat-UI's
OpenRouter client. Reading it closely:

- Every request (`fetchModels()`, `streamChat()`) goes through
  **Supabase Edge Functions** (`${SUPABASE_URL}/functions/v1/openrouter-chat`
  and `.../openrouter-models`), authenticated with the signed-in
  user's **Supabase session token** — never an OpenRouter key.
- `db/schema.sql` confirms the server side of this: a credits ledger,
  a per-request usage log written by the Edge Function, and rate
  limiting — all against the caller's Supabase account.
- The real OpenRouter API key lives only on the server (in the Edge
  Function's environment), by design, so the browser can never see or
  leak it.
- `js/core/model-selector.js` and `js/core/openrouter-config.js` are
  thin UI-tier companions: a static fallback model list, a
  `<select>` binder, and one `localStorage` key
  (`axiom_openrouter_selected_model`) for the user's dropdown choice.

**This is a different product surface than what Part 2A specifies.**
Part 2A's spec calls for an API Manager that can *"Validate API key.
Store/remove API key"* — i.e. the client holds and manages a real
OpenRouter key locally. That is structurally incompatible with the
existing credit-billed, key-hidden-server-side design: building it
*into* `js/core/openrouter-client.js` would mean either (a) silently
changing that pipeline's security model, which the task explicitly
forbids ("Do not modify... Supabase modules" — the credit-billing
Edge Function contract is part of that surface), or (b) quietly
introducing a second, incompatible code path inside a file that
currently has exactly one.

### 1.3 Decision

Part 2A is built as a **second, independent, opt-in OpenRouter
integration** — a "bring your own key" (BYOK) foundation for the
OS/agent runtime layer, living in the new `os/api/openrouter/`
directory the task specifies, under its own global namespace
(`window.AxiomOpenRouter`, distinct from `window.OpenRouter`), with
its own storage keys, talking to OpenRouter's real endpoints directly
instead of through Axiom's Edge Functions. This satisfies "do not
duplicate existing infrastructure" (nothing here re-implements the
credit-billed proxy, the model dropdown, or the streaming chat UI) and
"do not modify... Supabase modules" (the existing pipeline is
untouched and unaware this exists) while still delivering everything
Part 2A's spec asks for. The two integrations can coexist on the same
page indefinitely without conflict — verified in §5.

---

## 2. What was built

### 2.1 `os/api/openrouter/error-handler.js` — `window.AxiomOpenRouter.errors`

Pure classification, no network calls, no load-order dependency.

- `CODES` — stable string codes: `invalid_api_key`, `forbidden`,
  `not_found`, `model_unavailable`, `request_timeout`, `rate_limited`,
  `server_error`, `bad_gateway`, `service_unavailable`,
  `gateway_timeout`, `network_error`, `timeout`, `unknown`.
- `classify(input)` — accepts an `Error`, a fetch-`Response`-shaped
  object, an OpenRouter JSON error body, or a string. Handles, per
  spec: HTTP 401/403/404/408/429/500/502/503/504, `AbortError`
  timeouts, network failures (`TypeError: Failed to fetch` and
  friends), "invalid API key" and "model unavailable" message bodies.
  Never throws.
- `isRetryable(codeOrClassified)` — `true` for
  `request_timeout`/`rate_limited`/`5xx`/`network_error`/`timeout`;
  `false` for `invalid_api_key`/`forbidden`/`not_found`/
  `model_unavailable`/`unknown` (retrying those without changing
  something — the key, the model id, a permission — just fails again).
- `handle(input, context)` — `classify()` + log via `AxLogger` +
  emit `openrouter_error` on the shared bus, when `api-manager.js` is
  loaded (feature-detected; `classify()` alone has no side effects).

### 2.2 `os/api/openrouter/api-manager.js` — `window.AxiomOpenRouter` (core)

- **State machine:** `uninitialized -> no_key -> connecting -> connected | invalid_key | error -> disconnected`.
- `init(options?)` — resolves the Supabase-session-scoped storage
  namespace (§2.5), probes a stored key if one exists, emits
  `openrouter_initialized` exactly once.
- `setApiKey(key)` — validates against OpenRouter's `GET /api/v1/key`
  (the documented "get current API key" endpoint) *before* persisting
  anything; a rejected key is never written to storage.
- `removeApiKey()` / `hasApiKey()` / `validateApiKey(key?)`.
- `checkHealth()` — re-probes `GET /api/v1/key` (doubles as both key
  validation and the health-check spec item — OpenRouter has no
  separate ping endpoint); a transient failure moves state to `error`
  without discarding a previously-valid stored key.
- `getConnectionStatus()` / `getLastError()` / `getKeyInfo()` / `configure()`.
- Shared `on/once/off/emit` bus, mirroring
  `AxiomSupabaseConnection`'s contract exactly (§1.1), with the same
  three optional forwarding steps: DOM `CustomEvent` (`axiom:<event>`),
  `AxiomOrchestrator.emit()` (event name forwarded verbatim, since the
  five required event names are the documented public contract),
  and analytics (`AxiomAnalyticsAutomation.addLog` + `window.va`).
- `_internal` — a small set of helpers (`getStoredKey`, `withTimeout`,
  `withRuntimeContext`, `classifyError`, `BASE_URL`) exposed so
  `model-manager.js`/`token-manager.js` don't reimplement key storage,
  timeout handling, or error classification. Not part of the
  documented public contract.

### 2.3 `os/api/openrouter/model-manager.js` — `window.AxiomOpenRouter.models`

- `fetchModels(force?)` — `GET https://openrouter.ai/api/v1/models`
  (OpenRouter's real, public, unauthenticated catalog endpoint), 10-
  minute TTL cache, concurrent calls share one in-flight request.
- `refreshModels()` — `fetchModels(true)`, always bypasses cache.
- `getModels()` — synchronous read of the last cached list.
- `getDefaultModel()` / `setDefaultModel(id)` — own storage key
  `axiom_os_openrouter_default_model`; `setDefaultModel()` rejects an
  id outside the currently-loaded catalog (once one has loaded).
- `getModelMetadata(id)` / `getContextSize(id)` / `getPricing(id)` /
  `getCapabilities(id)` — normalized from OpenRouter's raw response
  (`context_length`, `pricing.{prompt,completion,request,image}` as
  USD-per-token, capabilities inferred from `architecture.input_modalities`
  and `supported_parameters`).

### 2.4 `os/api/openrouter/token-manager.js` — `window.AxiomOpenRouter.tokens`

- `countPromptTokens(text)` — documented `chars/4` approximation.
  **Not** a real tokenizer: the project has no build step and no
  vetted tokenizer dependency to wrap, so an exact BPE count is out of
  scope for this Part. `recordUsage()` is designed to be fed
  OpenRouter's own authoritative `usage.prompt_tokens` /
  `usage.completion_tokens` from a real response — the estimate exists
  only for pre-flight sizing before a request is sent.
- `recordUsage({model, promptTokens, completionTokens, requestId?})` —
  global + per-model running totals, a bounded 500-entry history ring.
- `getUsageStats(modelId?)` — global totals, or one model's.
- `estimateCost(modelId, promptTokens, completionTokens)` — reads live
  pricing from `model-manager.js` (feature-detected); returns `null`
  — never a silent `0` — when pricing is unknown, so callers can tell
  "free" from "we don't know."
- `resetStats()`.

### 2.5 Cross-cutting: Supabase reuse for key storage scoping

`api-manager.js` reads (read-only — `getSession()`, never any write
or auth call) the current session from the existing, unmodified
`AxiomSupabaseConnection.getClient()` to scope the locally-stored
OpenRouter key to the signed-in user
(`axiom_os_openrouter_api_key:<userId>`), so a shared/kiosk browser
can't leak one user's key into the next session. With no Supabase
client, or no session, it falls back to a single `:anonymous`
namespace — fully optional, never required, and never touches any
Supabase file.

---

## 3. Requirements coverage

| Spec item | Delivered as |
|---|---|
| Initialize OpenRouter | `AxiomOpenRouter.init()` |
| Validate API key | `AxiomOpenRouter.validateApiKey()` |
| Store/remove API key | `setApiKey()` / `removeApiKey()` / `hasApiKey()` |
| Connection status | `getConnectionStatus()` |
| Health check | `checkHealth()` |
| Fetch available models | `models.fetchModels()` |
| Cache model list | 10-min TTL cache, in-flight de-dupe |
| Refresh models | `models.refreshModels()` |
| Default model | `models.getDefaultModel()` / `setDefaultModel()` |
| Model metadata | `models.getModelMetadata()` |
| Context size | `models.getContextSize()` |
| Pricing | `models.getPricing()` |
| Capabilities | `models.getCapabilities()` |
| Prompt/completion/total tokens | `tokens.recordUsage()` → `{promptTokens, completionTokens, totalTokens}` |
| Usage statistics | `tokens.getUsageStats()` |
| Cost estimation | `tokens.estimateCost()` |
| 401/403/404/408/429/500/502/503/504 | `errors.classify()` — one branch each, tested individually |
| Timeout | `AbortError` → `timeout` |
| Network errors | `TypeError`/fetch-failure → `network_error` |
| Invalid API key | message-body detection → `invalid_api_key` (plus every real 401) |
| Model unavailable | message-body detection → `model_unavailable` |
| `window.AxiomOpenRouter` | assembled additively across all four files |
| `openrouter_initialized/connected/disconnected/error/models_loaded` | all five, verified reachable via `on()`, forwarded to Orchestrator + DOM |

---

## 4. Non-duplication / non-modification checklist

- `js/core/openrouter-client.js`, `openrouter-config.js`,
  `model-selector.js` — **not modified**, not imported, not required by
  any Part 2A file. Verified by the regression suite (§5, section 6).
- Browser (`os/core/browser-*.js`), Automation
  (`os/core/automation-*.js`), Memory (`os/core/memory-*.js`), Goal
  Manager (`os/core/goal-manager*.js`), Voice (`js/core/voice*.js`),
  Supabase (`js/core/supabase/*.js`) — **not touched**. Every file
  listed in the task's do-not-modify set was confirmed present and
  untouched on disk.
- No new global except `window.AxiomOpenRouter` and its four documented
  sub-namespaces (`.errors`, `.models`, `.tokens`, plus the core
  methods and `_internal`).
- No new `localStorage` key collides with an existing one — own
  prefix (`axiom_os_openrouter_*`) throughout, verified statically.
- No HTML file was edited. Wiring these four files into a page is a
  one-line-per-file `<script defer src="os/api/openrouter/...">`
  addition, same convention every prior `os/core/*` Part used (see
  `automation.html`'s script block) — deliberately left for the
  integrator to add on the page(s) that need it, since the task's
  file list didn't include any `.html` changes and none of the
  forbidden-to-touch pages needed editing to deliver this Part.
  Recommended load order: `error-handler.js`, `api-manager.js`,
  `model-manager.js`, `token-manager.js` (though every file degrades
  gracefully regardless of order — see §5, section 5).

---

## 5. Verification

### 5.1 New regression suite

`test-evidence/block2-step9-part2a-openrouter-core-regression-suite.js`
— real files loaded in a `vm` sandbox (same convention as
`test-evidence/supabase-part1-regression-suite.js` and
`block2-step6-part5-runtime-context-regression-suite.js`), every
network call mocked, no real network access used.

```
72 passed, 0 failed.
```

Full output: `test-evidence/block2-step9-part2a-openrouter-core-regression-output.txt`.

Coverage: all nine HTTP status codes individually, `AbortError`,
network-failure detection, invalid-key/model-unavailable message
sniffing, retryability set, key set/validate/remove/persist,
rejected-key-never-persisted, transient-failure-doesn't-discard-key,
bus pub/sub contract (`on`/`once`/`off`), Orchestrator/DOM/Analytics
forwarding, Supabase-session storage scoping (and its anonymous
fallback), optional Runtime Context wrapping, model fetch/cache/TTL/
refresh/in-flight-dedupe, per-model metadata/context/pricing/
capabilities, default-model validation against the loaded catalog,
storage-key collision avoidance, token accounting (global + per-
model), cost estimation (including the "unknown pricing → `null`, not
`0`" contract), stats reset, load-order independence across all four
files, all five required events firing and reaching subscribers, and
the non-duplication/non-modification statics from §4.

One defect was found and fixed during verification — entirely inside
this Part's own new test file, not in the delivered source: an
over-broad string check flagged `model-manager.js`'s header *comment*
(which names the legacy storage key in prose, to explain why it's
avoided) as if it were real code usage. Fixed to scan code lines only;
re-run confirmed 72/72. No file under `os/api/openrouter/` needed any
change.

### 5.2 Full existing suite run

All 36 pre-existing regression/audit files in `test-evidence/` were
re-run unmodified, in this same sandbox, after Part 2A's files were
added (no existing file was changed, so this is a clean "does adding
these new files break anything" check):

| Result | Count | Suites |
|---|---|---|
| ✅ Pass | 30 | `block2-step2-part2-brain-integration`, `block2-step3-part1-memory-foundation`, `block2-step3-part2-memory-integration`, `block2-step3-part3-memory-manager` (30/30), `block2-step4-part1-automation-foundation` (17/17), `block2-step4-part2-brain-automation-integration`, `block2-step4-part3-automation-memory-integration`, `block2-step4-part4-automation-manager`, `block2-step5-part1-browser-foundation` (21/21), `block2-step5-part2-navigation-session` (28/28), `block2-step5-part6a-browser-audit` (7/7), `block2-step5-part6b-error-recovery` (15/15), `block2-step6-part1-orchestrator` (21/21), `block2-step6-part2-agent-registry-integration` (18/18), `block2-step6-part3-capability-routing` (20/20), `block2-step6-part4-workflow-planner` (29/29), `block2-step6-part5-runtime-context` (42/42), `block2-step7-part2-task-planner` (21/21), `block2-step7-part3a..f-goal-manager-*` (35/35, 45/45, 37/37, 24/24, 35/35, 38/38), `block2-step8-part1-decision-engine` (41/41), `block2-step8-part2-planning` (28/28), `milestone11` (41/41), `milestone12` (19/19), `milestone13` (46/46), `milestone14-part1` (58/58), `supabase-part1` (51/51) |
| ❌ Fail (pre-existing, unrelated) | 6 | `block2-step1-coding-agent`, `block2-step1-part2-pipeline`, `milestone5`, `milestone6`, `milestone10` — all `Error: Cannot find module 'jsdom'` (this sandbox has no `node_modules`; `jsdom` is a devDependency never installed here, not something Part 2A introduces or depends on). `phase9-part1-static-audit` — 1441/1457, all 16 failures are `Asset resolves: *.html -> js/core/env.config.js`, a secrets file that is intentionally not present on disk (never committed; generated from `js/core/env.config.template.js` at deploy time), unrelated to OpenRouter. |

Every suite that plausibly touches anything this Part reuses —
Orchestrator, Runtime Context, Supabase, Analytics/Automation, Memory,
Browser, Goal Manager — passes at 100%. The 6 failing suites fail on
environment/tooling gaps that predate this delivery (confirmed: no
`package.json`/`node_modules` present at all in the extracted
project, and `env.config.js` absent by design), not on anything Part
2A added, and since Part 2A modified zero existing files, it could not
have caused them. Full per-suite console output:
`test-evidence/block2-step9-part2a-full-suite-run-output.txt`.

### 5.3 Fixes applied

None to delivered source. The only correction made anywhere in this
delivery was to this Part's own new regression suite (§5.1) — a false
positive in a static string check, not a defect in
`os/api/openrouter/*`.

---

## 6. Known limitations / follow-ups for a future Part

- `countPromptTokens()` is an approximation (§2.4) — a real tokenizer
  would need a vetted dependency this project doesn't currently have.
- No chat-completion request/streaming method is included in Part 2A
  by design — the spec scoped this Part to API/Model/Token/Error
  management only ("Core Foundation"); a `chat`/`completions` method
  belongs in a later Part that builds on this foundation.
- Wiring `<script>` tags into the actual OS shell/workspace HTML pages
  was left to the integrator (§4) since no page was in scope for this
  Part and the task's forbidden-to-modify list includes several pages
  this could plausibly have touched.
