# AXIOM — Block 2 / Step 9 / Part 2B-1: OpenRouter Chat Manager
## Validation Report

**Date:** 2026-08-06
**Deliverable:** `os/api/openrouter/chat-manager.js`, new sub-namespace
`window.AxiomOpenRouter.chat`, regression suite, this report.

---

## 1. Pre-implementation architecture audit

Before writing anything, the current project (from
`AXIOM-OpenRouter-Part2A-Core-Foundation.zip`) was audited to confirm
exactly what exists already and what Part 2B-1 must reuse rather than
duplicate.

### 1.1 What already exists

| Concern | Existing module | Reused how |
|---|---|---|
| Event Bus | `AxiomOrchestrator` (`os/core/orchestrator.js`) | Not called directly — reused transitively via `AxiomOpenRouter.emit()`, which already forwards to it. |
| Runtime Context | `AxiomRuntimeContext` (`os/core/runtime-context.js`) | Not called directly — reused transitively via `AxiomOpenRouter._internal.withRuntimeContext()`. |
| Logger | `AxLogger` (`os/shared/logger.js`) | Not called directly — reused transitively via `_internal.classifyError()`, which already logs. |
| Analytics | `AxiomAnalyticsAutomation` (`js/pages/analytics-automation-ultimate.js`) | Not called directly — reused transitively via `AxiomOpenRouter.emit()`. |
| Supabase Session | `AxiomSupabaseConnection` (`js/core/supabase/connection-manager.js`) | Not called directly — the BYOK key it scopes is read via `_internal.getStoredKey()`, which already resolves the session-scoped storage namespace api-manager.js set up. |
| **`AxiomOpenRouter` (Part 2A)** | `os/api/openrouter/{api-manager,model-manager,token-manager,error-handler}.js` | The direct dependency this Part builds on — see §1.2. |
| **Shared id generator** | `AxiomMakeSeqId` (`os/shared/id-factory.js`) | Used for `requestId`/`chatId` generation when present; feature-detected, with an inline fallback of the same shape Runtime Context itself uses, so there's no hard load-order dependency on it either. |
| **Existing chat-UI OpenRouter client** | `js/core/openrouter-client.js` + `openrouter-config.js` + `model-selector.js` | **Confirmed still present, still untouched, still the credit-billed/server-proxied surface documented in `OPENROUTER_PART2A_VALIDATION.md` §1.2.** Nothing in this Part imports, calls, or duplicates it. |

### 1.2 What Part 2A already built, in detail

Re-read in full before writing `chat-manager.js`:

- **`api-manager.js`** owns the BYOK key lifecycle and the shared
  `on/once/off/emit` bus, and exposes an `_internal` object
  specifically so sibling files don't reimplement key storage, HTTP
  timeout/abort handling, or error classification:
  `getStoredKey()`, `withTimeout()`, `withRuntimeContext()`,
  `classifyError()`, `BASE_URL`, `requestTimeoutMs()`.
- **`model-manager.js`** caches the model catalog and exposes
  `getDefaultModel()`/`setDefaultModel()` under its own storage key
  (`axiom_os_openrouter_default_model`) — read via its API, never via
  `localStorage` directly, from this Part.
- **`token-manager.js`** exposes `recordUsage()` and does its own
  cost estimation (via `models.getPricing()`), and is explicit that it
  wants OpenRouter's *real* `usage.prompt_tokens`/
  `usage.completion_tokens` fed to it, not the `chars/4` estimate — a
  real chat-completion response is exactly that authoritative source,
  so `chat-manager.js` feeds it directly.
- **`error-handler.js`** classifies HTTP 401/403/404/408/429/
  500/502/503/504, `AbortError` timeouts, and network failures into
  stable codes with a `retryable` flag — reused as-is via
  `_internal.classifyError()`, which already logs and emits
  `openrouter_error` on the shared bus. `chat-manager.js` adds **zero**
  new error-classification logic.

### 1.3 Decision

Part 2B-1 is built as a fifth, additive file in the same
`os/api/openrouter/` directory, installing onto the same
`window.AxiomOpenRouter` global under a new `.chat` sub-namespace —
never modifying, wrapping, or re-exporting any of the four Part 2A
files, and never touching `js/core/openrouter-client.js` or any
forbidden module. This satisfies "extend Part 2A" (every genuinely
shared concern — key storage, HTTP helpers, error classification,
default model, token accounting, the event bus — flows through Part
2A's existing, unmodified public/`_internal` surface) and "do not
duplicate infrastructure" (this file contains no HTTP-timeout code,
no error-classification code, no token-accounting code, and no
key-storage code of its own).

---

## 2. What was built

### 2.1 `os/api/openrouter/chat-manager.js` — `window.AxiomOpenRouter.chat`

**Conversation management** (works standalone, even without
`api-manager.js` loaded — see §2.2):

- `createChat(options?)` — `{chatId?, model?, systemPrompt?,
  temperature?, topP?, maxTokens?, stopSequences?}`. Auto-generates a
  `chatId` if none given; an explicit `chatId` that collides with an
  existing conversation is rejected (`null`) rather than silently
  overwriting its history.
- `getChat(chatId)` / `listChats()` / `deleteChat(chatId)`.
- `getHistory(chatId)` — the full user/assistant transcript.
- `setSystemPrompt(chatId, prompt)` / `configureChat(chatId, patch)` —
  independent per-conversation `model`/`temperature`/`topP`/
  `maxTokens`/`stopSequences`/`systemPrompt`.
- `resetChat(chatId, options?)` — clears turn history; keeps the
  system prompt by default, `{clearSystemPrompt: true}` to drop it.

**Chat completion:**

- `sendMessage(chatId, content, overrides?)` — builds
  `POST /chat/completions` from the conversation's system prompt +
  full history + saved params (with `overrides` applying to this call
  only, never persisted), sends it with the stored BYOK key, appends
  the assistant's reply to history, records usage, and resolves
  `{chatId, requestId, message, usage}`. Rejects with a small, stable
  set of usage-error codes (`chat_not_found`, `invalid_message`,
  `core_not_loaded`) for caller mistakes, and with Part 2A's
  classified error object (`invalid_api_key`, `network_error`,
  `server_error`, etc.) for anything that actually reached — or tried
  to reach — OpenRouter.
- Multiple concurrent conversations are fully independent: separate
  history, separate model/params, no shared mutable state — verified
  directly (§5.1) rather than assumed.
- Every finite-number/non-empty-array param check mirrors
  `js/core/openrouter-client.js`'s own "omit rather than send a
  default" convention: `temperature`/`top_p`/`max_tokens`/`stop` are
  absent from the request entirely when not set, never sent as `0`,
  `null`, or `[]`.

### 2.2 Graceful degradation

Same convention as `model-manager.js`/`token-manager.js`: conversation
*state* (`createChat`/`getHistory`/`resetChat`/`configureChat`/etc.)
works fully in-memory even if `api-manager.js` hasn't loaded yet.
Only `sendMessage()` — which genuinely needs the stored key, HTTP
helpers, and error classification — requires the Core Foundation, and
rejects with a clear `core_not_loaded` error (never throws
synchronously) if it isn't present. Load order between
`chat-manager.js` and its three Part 2A siblings is otherwise
irrelevant, verified directly.

---

## 3. Requirements coverage

| Spec item | Delivered as |
|---|---|
| Chat Completion | `chat.sendMessage()` → `POST /chat/completions` |
| Multi-turn Conversations | Full history replayed on every `sendMessage()` call |
| Conversation History | `chat.getHistory(chatId)` |
| Conversation IDs | `chat.createChat()` returns/accepts `chatId` |
| System Prompts | `chat.setSystemPrompt()` / `createChat({systemPrompt})` |
| User Messages | Appended to history by `sendMessage()` |
| Assistant Messages | Appended to history from the completion response |
| Temperature | `createChat({temperature})` / `configureChat()` / per-call override → `temperature` |
| Top-P | `...{topP}` → `top_p` |
| Max Tokens | `...{maxTokens}` → `max_tokens` |
| Stop Sequences | `...{stopSequences}` → `stop` (capped at 4) |
| Conversation Reset | `chat.resetChat(chatId, options?)` |
| Multiple concurrent conversations | Independent per-`chatId` state, verified in §5.1 |
| `openrouter_request_started` | Fired before every `sendMessage()` HTTP call |
| `openrouter_request_completed` | Fired on every successful reply, carries `usage` |
| `openrouter_chat_created` | Fired by `createChat()` |
| `openrouter_chat_reset` | Fired by `resetChat()` |

---

## 4. Non-duplication / non-modification checklist

- `js/core/openrouter-client.js`, `openrouter-config.js`,
  `model-selector.js` — **not modified**, not imported, not called.
  Verified present and unchanged; verified this file never references
  `window.OpenRouter`.
- `os/api/openrouter/{api-manager,model-manager,token-manager,
  error-handler}.js` (Part 2A) — **not modified.** `chat-manager.js`
  calls only their already-public/`_internal` surface. Re-run of Part
  2A's own regression suite: **72/72** (one static assertion in that
  suite was updated to expect this Part's approved new sibling file —
  see §5.3; the four Part 2A source files themselves are untouched).
- Browser (`os/core/browser-*.js`), Automation
  (`os/core/automation-*.js`), Memory (`os/core/memory-*.js`), Goal
  Manager (`os/core/goal-manager*.js`), Voice (`js/core/voice*.js`),
  Supabase (`js/core/supabase/*.js`) — **not touched.** Every file in
  the task's do-not-modify set was confirmed present and unchanged on
  disk.
- No new global except the `.chat` property on the existing
  `window.AxiomOpenRouter`.
- No new `localStorage` key of its own; the BYOK key and default
  model are read through Part 2A's existing accessor functions, never
  via `localStorage` directly — verified statically (no
  `axiom_os_openrouter_api_key`, `axiom_os_openrouter_default_model`,
  or `axiom_openrouter_selected_model` literal appears in
  `chat-manager.js`'s code).
- No HTML file was edited — wiring a fifth `<script>` tag is left to
  the integrator, same as Part 2A left its four (`OPENROUTER_PART2A_
  VALIDATION.md` §4); no page in the forbidden-to-modify set needed
  editing to deliver this Part.

---

## 5. Verification

### 5.1 New regression suite

`test-evidence/block2-step9-part2b1-chat-manager-regression-suite.js`
— real files loaded in a `vm` sandbox (same convention as Part 2A's
own suite and `supabase-part1-regression-suite.js`), every network
call mocked, no real network access used.

```
56 passed, 0 failed.
```

Coverage: standalone install with no load-order dependency; full
conversation-state management with only `chat-manager.js` loaded;
`sendMessage()` rejecting `core_not_loaded` without the Core
Foundation; `createChat`/`getChat`/`listChats`/`deleteChat`, duplicate
explicit-`chatId` rejection, `openrouter_chat_created`;
`setSystemPrompt`/`configureChat`; the outgoing request shape (system
prompt first, full history, `top_p`/`max_tokens`/`stop` field names,
`stream:false`) and that unset params are omitted entirely, not sent
as `0`/`null`; multi-turn history round-tripping across a second
`sendMessage()` call; resolved `{message, usage}` shape; per-call
`overrides` never mutating saved conversation config;
`openrouter_request_started`/`_completed` firing with a matching
`requestId` and correct `model`; `resetChat()` keeping vs. clearing
the system prompt per option, `openrouter_chat_reset`, and a safe
`false` (not a throw) for an unknown `chatId`; two and three
interleaved concurrent conversations staying fully independent and
correctly ordered; rejection codes for no stored key
(`invalid_api_key`), unknown chat (`chat_not_found`), and empty
content (`invalid_message`); an HTTP 500 and a network failure both
classified via the reused `error-handler.js`, emitting
`openrouter_error` on the shared bus, and leaving the user's turn in
history for retry without an assistant turn; usage rolling into
`token-manager.js`'s existing per-model accounting; default-model
fallback via `model-manager.js` when a chat has no model of its own,
and a separate default when `model-manager.js` isn't loaded at all;
`chat-manager.js` loaded *before* `api-manager.js` still working once
both are present; and the non-duplication/non-modification statics
from §4.

No defect was found in the delivered source during this pass. One
authoring bug was caught and fixed **before** the suite was considered
final (not a post-hoc "verified defect" against otherwise-shipped
code — see §5.3 for the distinction the task asks this report to
preserve).

### 5.2 Full existing suite run

All regression/audit files in `test-evidence/` (including Part 2A's
own suite and this Part's new one) were re-run after
`chat-manager.js` was added:

| Result | Count | Notes |
|---|---|---|
| ✅ Pass | 31 | Every suite Part 2A's own report listed as passing, still passes: `block2-step2-part2-brain-integration` through `milestone14-part1`, `supabase-part1` (51/51) — plus Part 2A's own suite (72/72, see §5.3) and this Part's new suite (56/56). |
| ❌ Fail (pre-existing, unrelated) | 6 | `block2-step1-coding-agent`, `block2-step1-part2-pipeline`, `milestone5`, `milestone6`, `milestone10` — `Error: Cannot find module 'jsdom'` (devDependency never installed in this sandbox; unrelated to this delivery). `phase9-part1-static-audit` — pre-existing failures against `env.config.js`, a secrets file intentionally absent from disk. Identical failure set to Part 2A's own report — this Part introduced no new failures and fixed none of these pre-existing ones (out of scope). |

### 5.3 Fixes applied

**To delivered source (`os/api/openrouter/chat-manager.js`):** none —
the ordering bug described below was caught and corrected during
initial development, before the file was considered a finished
deliverable, not as a fix to already-shipped code. Noted here for a
complete account of the work: `sendMessage()` originally built the
outgoing request payload *before* appending the new user turn to the
conversation's history, which would have silently sent every request
one turn behind. Caught immediately by the suite's own request-shape
assertions (`sendMessage() posts to /chat/completions with system
prompt + full history + params` and the multi-turn test), fixed by
reordering (append the turn, then build the payload), and confirmed
by a clean 56/56 re-run.

**To a pre-existing test file:** one assertion in Part 2A's own suite
— *"os/api/openrouter/ contains exactly the four required files,
nothing extra"* — hardcoded a 4-file expectation that this Part's
approved, in-scope fifth file would otherwise fail forever, for no
reason connected to an actual regression. Updated to expect
`chat-manager.js` alongside the original four (label updated to match).
The four Part 2A source files were not touched; re-run confirmed
72/72.

---

## 6. Known limitations / follow-ups for a future Part

- No streaming (SSE) support — `sendMessage()` is request/response
  only, per this Part's brief (Chat Completion + conversation *state*
  management). `model-manager.js` already marks every model
  `capabilities.streaming: true`, so adding a `streamMessage()` that
  reuses this same payload builder and conversation state is a
  natural, additive follow-up.
- `countPromptTokens()`'s `chars/4` approximation (Part 2A, §6 of its
  own report) is unchanged by this Part; `sendMessage()` always feeds
  `token-manager.js` OpenRouter's real `usage.*`, so the approximation
  is only ever exposed for pre-flight sizing, exactly as before.
- Wiring a `<script defer src="os/api/openrouter/chat-manager.js">`
  tag into the actual OS shell/workspace HTML pages is left to the
  integrator, same as Part 2A's four files (`OPENROUTER_PART2A_
  VALIDATION.md` §4) — no page was in scope for this Part.
