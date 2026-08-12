# AXIOM — Block 2 / Step 9 / Part 2B-4: OpenRouter Usage Tracker
## Validation Report

**Date:** 2026-08-08
**Deliverable:** `os/api/openrouter/usage-tracker.js`, new
sub-namespace `window.AxiomOpenRouter.usage`, regression suite,
`CHANGELOG.md` entry, this report.

---

## 1. Pre-implementation architecture audit

### 1.1 What already exists, and what this Part reuses

| Concern | Existing module | Reused how |
|---|---|---|
| Event bus / Analytics / Orchestrator forwarding | `AxiomOpenRouter.on()`/`.emit()` (Part 2A) | Not reimplemented. `usage-tracker.js` subscribes to the exact events chat-manager.js/stream-manager.js/request-queue.js already emit (`openrouter_request_started/_completed`, `openrouter_stream_started/_finished`, `openrouter_error`, `openrouter_retry`), and publishes its own `openrouter_usage_updated` back through the same `emit()` — which already forwards to `AxiomOrchestrator`, the Analytics automation surface, and a DOM `CustomEvent`. This file never talks to Analytics/Orchestrator directly, same convention as every sibling. |
| Token accounting / cost pricing | `token-manager.js` (Part 2A) | `tokens.estimateCost(model, promptTokens, completionTokens)` is called for every successful request. Token Manager's own global/per-model ledger (`recordUsage`/`getUsageStats`) is left completely alone — this file does not read, write, or duplicate it, and does not re-derive per-token pricing math of its own (no local `CHARS_PER_TOKEN_ESTIMATE`, no local pricing table). |
| Chat completion request path | `chat-manager.js` (Part 2B-1) | Purely observational — `openrouter_request_started`/`openrouter_request_completed` (and `openrouter_error` with `op: 'sendMessage'`) are the exact, already-documented event shapes this file listens to. `chat.sendMessage()` itself is never called by this file. |
| Streaming request path | `stream-manager.js` (Part 2B-2) | Purely observational — `openrouter_stream_started`/`openrouter_stream_finished` (and `openrouter_error` with `op: 'streamMessage'`). A resumed stream (`{resumed: true}`, stream-manager.js's own `resumeStream()` convention) is recognized and not double-counted. `stream.streamMessage()`/`cancelStream()` are never called by this file. |
| Retry scheduling | `request-queue.js` (Part 2B-3) | `openrouter_retry` is reused for the retries counter — the only event anywhere in the codebase that means "a retry happened." `openrouter_queue_completed` is deliberately **not** reused for counting requests/successes/failures (see §1.2 — it would double-count). |
| Runtime Context | `AxiomRuntimeContext` (read-only) | `getActiveRequestCount()` reads `listContexts({ownerAgent: 'openrouter', status: 'running'})` when Runtime Context is loaded — the same read-only reuse pattern `os/core/autonomous-decision-engine.js` already established (`getActiveContexts()`/`getContextMetrics()`), rather than creating a second, parallel context for the same in-flight request api-manager.js's own `withRuntimeContext('chat-completion', ...)` already wraps. Falls back to an internal pending-request count when Runtime Context isn't loaded. |
| Logger | `AxLogger` | Same defensive, feature-detected `safeLog()` every sibling already uses, for one non-fatal case: `AxiomOpenRouter.on` missing at load time. |

### 1.2 Decision: why `openrouter_queue_completed` is not used to count requests

Before writing anything, every request-shaped event `request-queue.js`
emits was re-read against what `enqueueChatMessage()`/`enqueueStream()`
actually wrap: `execute()` for a queued chat task **is**
`chat.sendMessage()` itself; for a queued stream task it **is**
`stream.streamMessage()`. That means every attempt `request-queue.js`
dispatches already, independently, fires
`openrouter_request_started`/`_completed` (or
`openrouter_stream_started`/`_finished`) from inside
chat-manager.js/stream-manager.js. If this file also counted
`openrouter_queue_completed`'s `succeeded`/`failed` outcome, every
queued request would be counted twice. So the request/success/failure
counters are sourced **only** from the chat/stream-level events, and
`openrouter_queue_completed` is not subscribed to at all — the one
piece of information it uniquely carries (a retry happened) already
has its own dedicated event, `openrouter_retry`, which is subscribed
to on its own. This was verified empirically, not just by reading
comments: §5.1's retry test asserts the exact expected counts (3
requests, 1 success, 2 failures, 2 retries for two failed attempts
then a third that succeeds) and would fail loudly on a double-count.

### 1.3 Decision: "session" means `chatId`

Every request-shaped event this file listens to already carries a
`chatId` (chat-manager.js's/stream-manager.js's own documented event
shape). Grepping `os/core/runtime-context.js` and every
`os/api/openrouter/*` file turned up no existing "session" concept to
reuse instead. Rather than inventing a second, parallel identifier
with its own lifecycle, per-session usage here means per-`chatId` —
the closest existing stable identifier for "one ongoing
conversation." Requests with no `chatId` (should not occur for the
events this file listens to, but handled defensively) roll into a
single `'unknown'` bucket rather than being silently dropped.

### 1.4 Decision: pure observer, no changes to any existing file

Same posture Part 2B-3 set: `usage-tracker.js` needs nothing from any
sibling file beyond what was already public —
`AxiomOpenRouter.on()`/`.emit()`, `tokens.estimateCost()`, and
(optionally) `AxiomRuntimeContext.listContexts()`. It never calls
`chat.sendMessage()`, `stream.streamMessage()`, or `queue.enqueue()`,
and never creates or mutates an `AxiomRuntimeContext` context of its
own. So **zero existing delivered source files were modified** by
this Part — confirmed in §4 and §5.2. The only file changes anywhere
in `os/api/openrouter/`'s test evidence are the same kind of
file-count-assertion updates every prior Part has made to the suites
that came before it (§5.3).

---

## 2. What was built

### 2.1 `os/api/openrouter/usage-tracker.js` — `window.AxiomOpenRouter.usage`

- **Tracked per bucket**: `requests`, `successes`, `failures`,
  `retries`, `promptTokens`, `completionTokens`, `totalTokens`,
  `costUsd`, `avgLatencyMs` (computed from an internal sum/count pair,
  `null` when no samples exist yet — never a misleading `0`).
- **`getStats()`** → global totals, plus `models`/`sessions` counts.
- **`getModelStats(modelId)`** / **`listModelStats()`** — per-model
  buckets.
- **`getSessionStats(sessionId)`** / **`listSessionStats()`** —
  per-`chatId` buckets.
- **`getDailyStats(dateKey?)`** / **`listDailyStats()`** — UTC
  `'YYYY-MM-DD'` buckets, default = today.
- **`getMonthlyStats(monthKey?)`** / **`listMonthlyStats()`** — UTC
  `'YYYY-MM'` buckets, default = this month.
- **`getActiveRequestCount()`** — in-flight count, Runtime-Context-
  backed when available, internal-map-backed fallback otherwise.
- **`resetStats()`** — zeroes every bucket and the internal pending-
  request map.
- **`configure({historyLimit})`** — bounds the internal pending-
  request map (default 2000 entries) so a page that never sees a
  matching completion for some requests can't grow it unboundedly.
- **Event**: `openrouter_usage_updated` `{trigger, requestId?,
  sessionId?, model?, totals, at}`, fired after every counted
  start/completion/failure/retry.
- Degrades gracefully: with no `AxiomOpenRouter.on()` present at load
  time, `install()` logs a warning and returns `false` rather than
  throwing; every read API still works and reports zeros/`null`.

---

## 3. Requirements coverage

| Required | Delivered as |
|---|---|
| Reuse Token Manager | `tokens.estimateCost()`, feature-detected, called per successful request — Token Manager's own ledger untouched. |
| Reuse Runtime Context | Read-only `listContexts({ownerAgent:'openrouter', status:'running'})` for `getActiveRequestCount()` — no context created/mutated. |
| Reuse Analytics | Via the existing `emit()` → `forwardToAnalytics()` path every `openrouter_*` event already travels — `openrouter_usage_updated` is no exception. |
| Reuse Logger | `safeLog()` via `AxLogger`, same defensive convention as every sibling. |
| Reuse Event Bus | `AxiomOpenRouter.on()`/`.emit()` — the sole way this file learns about requests and publishes results. |
| Track: Requests | `totals.requests` / per-model / per-session / daily / monthly, incremented on `openrouter_request_started` / non-resumed `openrouter_stream_started`. |
| Track: Successes | Incremented on `openrouter_request_completed` / `openrouter_stream_finished`. |
| Track: Failures | Incremented on `openrouter_error` filtered to `op ∈ {sendMessage, streamMessage}`. |
| Track: Retries | Incremented on `openrouter_retry`. |
| Track: Prompt / Completion / Total Tokens | From each success event's `usage.{promptTokens,completionTokens}` payload (already-parsed real API usage, not an estimate). |
| Track: Estimated Cost | `tokens.estimateCost()` per success, summed into every applicable bucket. |
| Track: Average Latency | `finishedAt/erroredAt − startedAt` per request, averaged per bucket. |
| Track: Per-model Usage | `getModelStats()` / `listModelStats()`. |
| Track: Per-session Usage | `getSessionStats()` / `listSessionStats()` (session = `chatId`, see §1.3). |
| Track: Daily Usage | `getDailyStats()` / `listDailyStats()`. |
| Track: Monthly Usage | `getMonthlyStats()` / `listMonthlyStats()`. |
| Publish: `openrouter_usage_updated` | Emitted after every counted event, `totals` = the same shape `getStats()` returns. |

---

## 4. Non-duplication / non-modification checklist

- `os/api/openrouter/{api-manager,model-manager,token-manager,
  error-handler,chat-manager,stream-manager,response-parser,
  request-queue}.js` — every documented public export of each still
  present (confirmed by static check, §5.1 §10); each Part's own
  suite re-run in full (§5.2) confirms unmodified behavior, not just
  unmodified exports.
- `usage-tracker.js` makes no `fetch()`/XHR call, touches no
  `localStorage` key, never calls
  `chat.sendMessage()`/`stream.streamMessage()`/`queue.enqueue()`,
  never creates/mutates an `AxiomRuntimeContext`, and does not
  reimplement error classification (`STATUS_TO_CODE`/`RETRYABLE`) or
  token-cost pricing math (`CHARS_PER_TOKEN_ESTIMATE`/
  `pricing.prompt`) — all confirmed by static source-text checks in
  the new suite.
- Every Block 2 do-not-modify file (browser/automation/memory/
  goal-manager/voice/Supabase) confirmed still present on disk.
- No HTML file edited.

---

## 5. Verification

### 5.1 New regression suite

`test-evidence/block2-step9-part2b4-usage-tracker-regression-suite.js`
— real files loaded in a `vm` sandbox (same convention as every prior
Part's own suite); every network call mocked; no real network access
used.

```
90 passed, 0 failed.
```

Coverage: standalone install/degrade with zero other files loaded
(including the `AxiomOpenRouter.on` missing at load time case); a
successful `sendMessage()` incrementing requests/successes and
recording real token counts with a non-negative `avgLatencyMs`; a
non-retryable 401 failure incrementing requests/failures and not
successes; an unrelated error (`validateApiKey()`'s own 401) never
being attributed to request tracking; a successful `streamMessage()`
incrementing requests/successes and tokens; a failed
`streamMessage()` incrementing failures; a resumed stream
(`{resumed:true}`) not counted as a second request; a queued chat
message retried twice before succeeding producing exactly 3 requests/
1 success/2 failures/2 retries; `costUsd` populated correctly once
model-manager.js pricing is loaded (cross-checked against the exact
expected dollar figure) and staying `0` — never `null`, never
throwing — with no pricing loaded; per-model/per-session/daily/
monthly buckets all rolling up the same completed request, including
`getDailyStats()`/`getMonthlyStats()` defaulting correctly to
today/this month; two different `chatId`s producing independent,
non-leaking session buckets; `getActiveRequestCount()` correctly
reporting 1 while a request is in flight and 0 once it settles, both
via the internal fallback (no Runtime Context loaded) and via a real
`AxiomRuntimeContext` (confirmed reading the same context
chat-manager.js's own request already created, not a second one);
`openrouter_usage_updated` firing with an accurate totals snapshot,
and travelling through the existing `AxiomOrchestrator` forwarding
exactly like every other `openrouter_*` event; `resetStats()` zeroing
every bucket type and the active-count fallback; `configure()`
accepting a positive integer and no-oping safely on empty/`null`
input; the full non-duplication/non-modification static-check set
from §4; and — as its own final four tests — fresh subprocess re-runs
of Part 2A's, Part 2B-1's, Part 2B-2's, and Part 2B-3's own suites,
confirming **72/72**, **56/56**, **87/87**, and **96/96**
respectively, unmodified in behavior.

No defect was found in the delivered source's final form.

### 5.2 Full existing suite run

All regression/audit files in `test-evidence/` (including Part 2A's,
Part 2B-1's, Part 2B-2's, Part 2B-3's own suites, and this Part's new
one) were re-run after `usage-tracker.js` was added:

| Result | Notes |
|---|---|
| ✅ Pass | Every suite Part 2B-3's own report listed as passing, still passes — plus Part 2A's own suite (**72/72**, re-run after its static-check update), Part 2B-1's own suite (**56/56**, re-run after its static-check update), Part 2B-2's own suite (**87/87**, re-run after its static-check update), Part 2B-3's own suite (**96/96**, re-run after its static-check update), and this Part's new suite (**90/90**). |
| ❌ Fail (pre-existing, unrelated) | Identical failure set to every prior Part's own report: `block2-step1-coding-agent`, `block2-step1-part2-pipeline`, `milestone5` (both `-regression-suite.js` and `-manual-commands.js`), `milestone6`, `milestone10` — `Error: Cannot find module 'jsdom'` (devDependency never installed in this sandbox). `phase9-part1-static-audit` — pre-existing failures against `env.config.js`, a secrets file intentionally absent from disk. Re-confirmed directly (§ above) rather than assumed. This Part introduced no new failures and fixed none of these pre-existing ones (out of scope). |

### 5.3 Fixes applied

No defect was found in `usage-tracker.js`'s delivered source during
development — the request/session/model/daily/monthly bucketing logic
matched its design on the first full suite run, including the
double-counting edge case §1.2 identifies (verified, not assumed).

**To pre-existing test files:** one static assertion each in Part
2A's, Part 2B-1's, Part 2B-2's, and Part 2B-3's own suites
("`os/api/openrouter/` contains exactly N expected files") — hardcoded
counts that this Part's one approved, in-scope new file would
otherwise fail forever, for no reason connected to an actual
regression. Updated to the new expected 9-file list; same precedent
Part 2B-1 set for Part 2A's suite, Part 2B-2 set for both Part 2A's
and Part 2B-1's suites, and Part 2B-3 set for all three. No other line
in any of the four suites was touched; all four re-runs confirmed
clean (72/72, 56/56, 87/87, 96/96).

---

## 6. Known limitations / follow-ups for a future Part

- **`avgLatencyMs` is computed only from requests this tracker itself
  observed the start of.** If `usage-tracker.js` is loaded/installed
  *after* a request is already in flight (e.g. installed dynamically
  mid-session), that request's completion will still be counted as a
  success/failure, but with no latency sample (its start was never
  seen). This only affects a request straddling the install moment,
  not steady-state tracking once installed at normal page-load time
  alongside its siblings.
- **No persistence.** Same posture as `token-manager.js`/
  `request-queue.js`: all counters are in-memory and reset on page
  reload. A future Part could add opt-in persistence (e.g. via the
  existing Supabase integration) without changing this file's public
  contract.
- **Session bucket cleanup.** `bySession`/`byModel`/`byDay`/`byMonth`
  maps grow for the lifetime of the page — there is no eviction for
  old sessions/days/months (mirrors `token-manager.js`'s own
  unbounded `byModel` map; only its `history` ring buffer is bounded).
  For a long-lived single-page session across many days this is a
  memory-growth consideration, not a correctness one; a natural
  follow-up if it becomes a problem in practice.
- **Rate-limited/cancelled queue outcomes are not separately
  surfaced.** `openrouter_queue_rate_limited`/`openrouter_queue_
  cancelled` are not currently reflected in usage stats (a cancelled
  queued request that never reached chat-manager.js/stream-manager.js
  is, correctly, not counted as a request at all — but there's no
  dedicated "cancelled" counter either, since the spec's tracked
  fields are requests/successes/failures/retries). A future Part
  could add one if queue-level cancellation visibility becomes a
  product requirement.
