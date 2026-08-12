# AXIOM — Block 2 / Step 9 / Part 2B-3: OpenRouter Request Queue
## Validation Report

**Date:** 2026-08-06
**Deliverable:** `os/api/openrouter/request-queue.js`, new
sub-namespace `window.AxiomOpenRouter.queue`, regression suite,
`CHANGELOG.md` entry, this report.

---

## 1. Pre-implementation architecture audit

### 1.1 What already exists, and what this Part reuses

| Concern | Existing module | Reused how |
|---|---|---|
| Error classification / retryability verdict | `error-handler.js` (Part 2A) | `window.AxiomOpenRouter.errors.isRetryable()` and `_internal.classifyError()` — the exact classification chat-manager.js's/stream-manager.js's own rejections already carry. See §1.2 — there is no separate retry *scheduler* anywhere to reuse; this is the piece that gets reused. |
| Runtime Context | `AxiomRuntimeContext` via `api-manager.js`'s `_internal.withRuntimeContext` | Each dispatched attempt is wrapped via this helper, feature-detected — same helper `api-manager.js`'s own `validateApiKey()`/`checkHealth()` and `chat-manager.js`'s `doChatRequest()` already use. |
| Event bus / Analytics / Orchestrator forwarding | `AxiomOpenRouter.emit()` | Not reimplemented — every queue event goes through the existing `emit()`, which already forwards to `AxiomOrchestrator`, the Analytics automation surface, and a DOM `CustomEvent`, exactly as chat-manager.js/stream-manager.js already rely on. |
| Chat completion request path | `chat-manager.js` (Part 2B-1) | `enqueueChatMessage()` wraps `chat.sendMessage()` directly — no duplicate payload-building, no duplicate conversation state. |
| Streaming request path + real cancellation | `stream-manager.js` (Part 2B-2) | `enqueueStream()` wraps `stream.streamMessage()`, with its `cancel` hook wired straight to the existing `stream.cancelStream()` — a queued stream task cancelled or timed out gets stream-manager.js's own real abort, not a new one. |
| Shared id generator | `AxiomMakeSeqId` (`os/shared/id-factory.js`) | Used for `requestId`, same convention as every sibling's `chatId`/`streamId`/`requestId`; inline fallback of the same shape when absent. |
| Logger | `AxLogger` | Used the same defensive, feature-detected way as every sibling (`safeLog()`), only for internal, non-fatal issues (e.g. a caller-supplied `cancel()` hook throwing) — never load-bearing. |

### 1.2 What "reuse existing retry infrastructure" means here

Before writing anything, every file in `os/api/openrouter/` was
grepped for `retry`/`Retry`/`backoff`/`Backoff`. There is no existing
retry *scheduler* — chat-manager.js's and stream-manager.js's own
header comments both describe "a retry" as simply "the caller makes
a fresh `sendMessage()`/`streamMessage()` call." What **does**
already exist, and is the thing actually reused, is the retryability
**verdict**: `error-handler.js`'s `CODES`/`RETRYABLE` table, surfaced
publicly as `errors.isRetryable()` and internally as
`_internal.classifyError()`. Part 2B-3 asks that existing verdict on
every failure and only adds the scheduling *around* it (attempt
counting, backoff delay, re-queueing) — it does not add a second,
parallel classification of what counts as retryable.

A rejection from `chat.sendMessage()`/`stream.streamMessage()` is
already the output of `error-handler.js`'s `classify()` (confirmed by
reading both files' catch blocks) — so `request-queue.js`'s own
`classifyRejection()` helper detects an already-classified object
(has both a string `.code` and a boolean `.retryable`) and passes it
through unchanged, rather than re-deriving a code from an
already-final classification. A raw, non-classified rejection (e.g.
from a generic `enqueue()` task that isn't a chat/stream call) is run
through `_internal.classifyError()` exactly once, same as every
sibling does for its own raw fetch failures.

### 1.3 Decision: pure scheduling layer, no changes to any existing file

Unlike Part 2B-2 (which needed one small, additive extension to
chat-manager.js's `_internal` to reach shared conversation state),
Part 2B-3 needs nothing from any sibling file beyond what was already
public or already exposed via `_internal`/`errors`:

- `chat.sendMessage()` and `stream.streamMessage()` are both already
  callable, promise-returning functions from the outside — exactly
  the shape `enqueue()`'s `execute: () => Promise` primitive expects.
- `stream.cancelStream()` is already public and sufficient to give a
  queued, in-flight stream task real cancellation.
- `errors.isRetryable()` / `_internal.classifyError()` are already
  public/exposed and sufficient for retry decisions.

So **zero existing delivered source files were modified** by this
Part — confirmed in §4 and §5.2. The only file changes anywhere in
`os/api/openrouter/`'s test evidence are the same kind of
file-count-assertion updates Part 2B-1 and Part 2B-2 each made to the
suites that came before them (§5.3).

---

## 2. What was built

### 2.1 `os/api/openrouter/request-queue.js` — `window.AxiomOpenRouter.queue`

- **`enqueue(execute, options?)`** → `{requestId, promise}` — the
  generic primitive. Works fully standalone (no dependency on any
  other `os/api/openrouter/*` file); `execute` is `() => Promise`.
  `options`: `{priority=0, timeoutMs, maxRetries, retryBaseDelayMs,
  retryMaxDelayMs, cancel?, id?, meta?}`.
- **`enqueueChatMessage(chatId, content, options?)`** — queues
  `chat.sendMessage(chatId, content, options.overrides)`. Rejects
  with a `core_not_loaded` error (never throws synchronously) if
  `chat-manager.js` isn't loaded.
- **`enqueueStream(chatId, content, callbacks?, options?)`** — queues
  `stream.streamMessage(...)`, auto-wiring `cancel` to
  `stream.cancelStream()`. Rejects `core_not_loaded` if
  `stream-manager.js` isn't loaded.
- **Priority Queue** — an insertion-sorted array (priority desc,
  arrival sequence asc); `pending.shift()` always yields the next
  highest-priority, earliest-arrived request. Kept as a simple sorted
  array rather than a heap: queue sizes in this client are small (a
  handful of concurrent/queued OpenRouter calls), so the simpler,
  more auditable structure was chosen over a marginal complexity/perf
  trade a heap would add no observable benefit for here.
- **Parallel Requests** — `settings.maxConcurrent` (default 3) caps
  `runningCount`; `pump()` dispatches until the cap or the pending
  queue is exhausted. `configure({maxConcurrent})` takes effect
  immediately (calls `pump()`).
- **Retry Scheduling** — `scheduleRetry()` computes an exponential
  backoff (`retryBaseDelayMs * 2^(attempt-1)`, capped at
  `retryMaxDelayMs`, plus 0–250ms jitter) and re-queues the request
  after that delay, up to `maxRetries` attempts *beyond* the first
  (`maxRetries: 2` ⇒ 3 total attempts). Frees the request's
  concurrency slot while it waits (status `retrying`), so a
  backing-off request doesn't block other work from dispatching.
- **Timeout Handling** — `timeoutMs` per request (default from
  `settings.defaultTimeoutMs`, 30s); a `global.setTimeout` races the
  executor. On timeout, the request is failed with a
  `{code: 'timeout', retryable: true}` classified error (matching
  `error-handler.js`'s own `CODES.TIMEOUT` retryability), so a
  timed-out attempt flows through the exact same retry path as any
  other retryable failure. A late resolution/rejection of the actual
  executor promise, arriving after the timeout already settled that
  attempt, is detected via a per-dispatch token and silently ignored
  — no double-settle, no double-emit.
- **Cancellation** — `cancel(requestId, reason?)` handles all three
  live states: `queued` (spliced out of the pending array before it
  ever runs), `retrying` (pending retry timer cleared), and `running`
  (concurrency slot freed immediately, the task's own `cancel` hook
  invoked best-effort if supplied, and any later settlement of the
  real executor promise ignored via the same dispatch-token
  mechanism used for timeouts). `clear(reason?)` bulk-cancels every
  currently-queued (not running) request and returns the count.
- **Queue Metrics** — `getMetrics()` (running totals for
  enqueued/succeeded/failed/cancelled/retried/rate-limited, plus live
  `queued`/`running`/`retrying` counts, `paused`, and rate-limit
  state), `getRequest(requestId)` / `listRequests(filter?)` for
  per-request snapshots (status, attempt count, timestamps,
  wait/run durations, error, result).
- **Rate Limit Handling** — on a `429` (`classified.code ===
  'rate_limited'`), the queue sets a shared `rateLimitedUntil`
  cooldown (`rateLimitCooldownMs`, default 20s) that gates *all* new
  dispatch — not just that one request's own retry — since a 429
  means the whole client should slow down. `pump()` checks this gate
  before dispatching anything new; already-running requests are left
  to finish undisturbed. That request's own retry delay is also
  floored at the cooldown duration. **Known limitation** (see §6):
  neither `chat.sendMessage()` nor `stream.streamMessage()` surface
  response headers to their callers today, so this cooldown is a
  configurable fixed duration rather than one derived from
  OpenRouter's actual `Retry-After` header.
- **Request Ordering** — guaranteed by the priority-queue insertion
  rule above: equal-priority requests always dispatch in the order
  they were enqueued (or, after a retry wait, re-enter the pending
  array and are ordered the same way among whatever's pending then).
- `pause()` / `resume()` — a manual dispatch gate independent of the
  automatic rate-limit cooldown (both must be clear for `pump()` to
  dispatch).
- `configure({maxConcurrent, maxRetries, retryBaseDelayMs,
  retryMaxDelayMs, defaultTimeoutMs, rateLimitCooldownMs})`.
- Events (via the existing shared bus): `openrouter_queue_added`,
  `openrouter_queue_started`, `openrouter_queue_completed` (fires
  exactly once per request, on every terminal outcome), and
  `openrouter_retry` — the four required by this Part's brief —
  plus, following the precedent Part 2B-2 set of emitting more
  events than its own bare public-API list strictly implied,
  `openrouter_queue_timeout`, `openrouter_queue_rate_limited`, and
  `openrouter_queue_cancelled`.

---

## 3. Requirements coverage

| Requirement | Delivered as |
|---|---|
| Priority Queue | `insertPending()` — sorted array, priority desc / arrival seq asc |
| Parallel Requests | `settings.maxConcurrent` + `pump()`'s dispatch loop |
| Retry Scheduling | `scheduleRetry()` + `computeBackoff()`, gated by reused `isRetryableError()` |
| Timeout Handling | Per-request `timeoutMs` race in `dispatch()`, classified as retryable `timeout` |
| Cancellation | `cancel()` (queued/retrying/running) + `clear()` (bulk) |
| Queue Metrics | `getMetrics()` / `getRequest()` / `listRequests()` |
| Rate Limit Handling | Queue-wide `rateLimitedUntil` dispatch gate + floored retry delay on `429` |
| Request Ordering | FIFO among equal priority, guaranteed by insertion rule |
| Reuse existing retry infrastructure | `errors.isRetryable()` / `_internal.classifyError()` reused verbatim — see §1.2 |
| Events: `openrouter_queue_added` | Emitted synchronously from `enqueue()`, before dispatch |
| Events: `openrouter_queue_started` | Emitted from `dispatch()`, `attempt` reflects the 1-based try number |
| Events: `openrouter_queue_completed` | Emitted exactly once per request from `finalizeSuccess()`/`finalizeFailure()`/`cancel()`, `status` distinguishes outcome |
| Events: `openrouter_retry` | Emitted from `scheduleRetry()`, once per scheduled retry, with `delayMs`/`rateLimited`/the classified `error` |
| Regression tests | §5.1 |
| Run all suites | §5.2 |
| Fix verified defects | §5.3 |

---

## 4. Non-duplication / non-modification checklist

- No new HTTP call, key storage, or base URL — confirmed by static
  check: `request-queue.js` contains no `fetch(` call and touches no
  `localStorage` key at all (it is a fully stateless, in-memory
  scheduler; nothing about the queue's own state is persisted).
- No new error classification table — confirmed by static check: no
  `STATUS_TO_CODE`/`RETRYABLE` identifiers appear in
  `request-queue.js`'s code (comments referencing `error-handler.js`'s
  own table by name are excluded from that check, as they're
  documentation, not a reimplementation).
- No reference to `js/core/openrouter-client.js`'s global
  (`window.OpenRouter`) — confirmed by static check.
- `chat-manager.js`'s and `stream-manager.js`'s full public contracts
  (every documented exported function name) still present, confirmed
  both statically and by a full, unmodified re-run of each of their
  own regression suites (§5.2) — **56/56** and **87/87**.
- `os/api/openrouter/` contains exactly the eight expected files
  (Part 2A's four + `chat-manager.js` + `stream-manager.js` +
  `response-parser.js` + this Part's `request-queue.js`) — confirmed
  by directory listing.
- Every file in the Block 2 do-not-modify set (`os/core/browser-*.js`,
  `os/core/automation-*.js`, `os/core/memory-engine.js`,
  `os/core/memory-manager.js`, `os/core/goal-manager*.js`,
  `js/core/voice*.js`, `js/core/supabase/*.js`) confirmed still
  present on disk, untouched.
- No HTML file edited.

---

## 5. Verification

### 5.1 New regression suite

`test-evidence/block2-step9-part2b3-request-queue-regression-suite.js`
— real files loaded in a `vm` sandbox (same convention as every
prior Part's own suite), real (non-mocked) timers used throughout so
backoff/timeout/rate-limit *ordering* is genuinely exercised rather
than assumed; every network call mocked where `chat-manager.js`/
`stream-manager.js` are involved; no real network access used.

```
96 passed, 0 failed.
```
(Confirmed stable across 3 consecutive runs — see the note on a
timing-sensitive test fixed in §5.3.)

Coverage: standalone install/degrade paths for `enqueue()` (invalid
task, synchronous throw inside `execute()`, non-Promise return) with
zero other files loaded; priority ordering (higher priority runs
first despite later arrival) and FIFO ordering among equal priority;
`maxConcurrent` never exceeded and actually reached, plus a live
`configure()` bump unblocking more parallel dispatch; a retryable
failure (503) retried to success, a non-retryable failure (401)
failing on the first attempt with zero retries, `maxRetries`
exhaustion producing the correct total attempt count, and backoff
delay growing across successive retries; a hung task failing via
`timeoutMs` with a retryable `timeout` classification, a timed-out
task successfully retrying, and a late resolution after a timeout has
already settled the request being safely ignored; `cancel()` on an
unknown id, while queued (never actually runs), while running (the
supplied `cancel` hook is called, promise rejects immediately), while
waiting to retry (the pending retry never fires), and on an
already-completed request (returns `false`); `clear()` bulk-cancelling
every queued request; a 429 pausing dispatch of *other* queued work
until the cooldown elapses, the rate-limited retry delay being floored
at the cooldown, and `getMetrics()` reflecting the active cooldown;
`getMetrics()`/`getRequest()`/`listRequests()` tracking totals and
live per-request state correctly, including a `null` result for an
unknown id; `pause()`/`resume()` gating new dispatch without
disturbing already-running work; `enqueueChatMessage()`/
`enqueueStream()` both degrading to `core_not_loaded` when their
respective dependency is absent, `enqueueChatMessage()` actually
calling `chat.sendMessage()` and landing both turns in the real
shared conversation history, retrying a retryable chat-manager.js
failure and not retrying a non-retryable one, and cancelling a queued
(not-yet-dispatched) `enqueueStream()` task never actually opening a
real stream; all four required events plus the bus's existing
forwarding onto `AxiomOrchestrator.emit()`; `withRuntimeContext()`
being invoked for a dispatched attempt when `AxiomRuntimeContext` is
present; the non-duplication/non-modification statics from §4; and —
as its own final three tests — fresh subprocess re-runs of Part 2A's,
Part 2B-1's, and Part 2B-2's own suites, confirming **72/72**,
**56/56**, and **87/87** respectively, unmodified in behavior.

No defect was found in the delivered source's final form. Defects
were caught and fixed during development, before this was considered
a finished deliverable — see §5.3.

### 5.2 Full existing suite run

All regression/audit files in `test-evidence/` (including Part 2A's,
Part 2B-1's, and Part 2B-2's own suites, and this Part's new one)
were re-run after `request-queue.js` was added:

| Result | Notes |
|---|---|
| ✅ Pass | Every suite Part 2B-2's own report listed as passing, still passes — plus Part 2A's own suite (**72/72**, re-run after its static-check update), Part 2B-1's own suite (**56/56**, re-run after its static-check update), Part 2B-2's own suite (**87/87**, re-run after its static-check update), and this Part's new suite (**96/96**). |
| ❌ Fail (pre-existing, unrelated) | Identical failure set to every prior Part's own report: `block2-step1-coding-agent`, `block2-step1-part2-pipeline`, `milestone5`, `milestone6`, `milestone10` — `Error: Cannot find module 'jsdom'` (devDependency never installed in this sandbox). `phase9-part1-static-audit` — pre-existing failures against `env.config.js`, a secrets file intentionally absent from disk. Re-confirmed directly (§ below) rather than assumed. This Part introduced no new failures and fixed none of these pre-existing ones (out of scope). |

### 5.3 Fixes applied

**To delivered source, during development (not post-hoc against a
finished deliverable):**

1. **Off-by-one in retry-exhaustion counting.** The initial retry
   condition was `record.attempt < record.maxRetries`, which made
   `maxRetries: 2` allow only **1** retry (2 total attempts) instead
   of the intended 2 retries (3 total attempts) — a caller asking for
   "2 retries" would silently get fewer. Caught by the
   maxRetries-exhaustion test (expected 3 attempts, got 2) and the
   `openrouter_retry` event-count tests. Fixed by changing the
   condition to `record.attempt <= record.maxRetries`; confirmed by a
   clean re-run.

**To the new suite itself, during development:**

2. **Flaky backoff-growth assertion.** The "delay grows between
   successive retries" test originally used `retryBaseDelayMs: 10`,
   whose exponential steps (10ms, 20ms, 40ms) were small enough
   relative to the implementation's own 0–250ms jitter that a later,
   smaller-base delay could legitimately draw a larger jitter value
   than an earlier one, occasionally producing a non-monotonic
   sequence (e.g. `[253, 103, 287]`) that isn't a real defect — it's
   the test asserting more precision than jitter allows at that
   scale. Fixed by raising `retryBaseDelayMs` to 300ms, so each
   exponential step (300/600/1200ms) reliably dominates the jitter
   range; confirmed stable across 3 consecutive full-suite runs.
3. **Two event tests loaded `request-queue.js` standalone** (no
   `api-manager.js`), then asserted on bus-forwarded events —
   but the shared `emit()`/`on()` bus `request-queue.js`'s events
   travel over is itself defined by `api-manager.js`, not
   `request-queue.js`; with only `request-queue.js` loaded,
   `AxiomOpenRouter.emit` doesn't exist yet, so `busEmit()`'s own
   feature-detection correctly no-ops and no events are ever
   observed — a test-setup gap, not a product defect. Fixed by
   loading `error-handler.js` + `api-manager.js` alongside
   `request-queue.js` in those four tests (mirroring how every
   product-behavior test elsewhere in the suite already does this).

**To pre-existing test files:** one static assertion each in Part
2A's, Part 2B-1's, and Part 2B-2's own suites ("`os/api/openrouter/`
contains exactly N expected files") — hardcoded counts that this
Part's one approved, in-scope new file would otherwise fail forever,
for no reason connected to an actual regression. Updated to the new
expected 8-file list; same precedent Part 2B-1 set for Part 2A's
suite and Part 2B-2 set for both Part 2A's and Part 2B-1's suites. No
other line in any of the three suites was touched; all three re-runs
confirmed clean (72/72, 56/56, 87/87).

---

## 6. Known limitations / follow-ups for a future Part

- **Rate-limit cooldown is a fixed duration, not header-derived.**
  Neither `chat.sendMessage()` nor `stream.streamMessage()` surface
  the response's `Retry-After` header to their callers today (only
  status/body reach `error-handler.js`'s `classify()`). A future Part
  threading response headers through `chat-manager.js`/
  `stream-manager.js` would let `request-queue.js` size its rate-limit
  cooldown off the real header instead of the configurable
  `rateLimitCooldownMs` default.
- **Timeout on a plain `enqueue()`/`enqueueChatMessage()` task doesn't
  abort the underlying call, only the queue's wait on it.** Only
  `enqueueStream()` tasks get a true abort on timeout/cancel (via
  `stream.cancelStream()`), because `chat.sendMessage()` doesn't
  accept or expose an `AbortSignal`/cancel handle today. A future Part
  adding one to `chat-manager.js` (mirroring stream-manager.js's own
  `AbortController` usage) would let `enqueueChatMessage()` wire up a
  real `cancel` hook the same way `enqueueStream()` already does.
- **No persistence across a page reload.** The queue is purely
  in-memory, matching every sibling module's own convention (none of
  Parts 2A/2B-1/2B-2 persist their state either) — a queued-but-not-
  yet-dispatched request is lost on reload. Out of scope here; would
  need a deliberate, separately-reviewed design if ever required.
