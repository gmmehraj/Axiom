# AXIOM — Block 2 / Step 9 / Part 2C-2A: OpenRouter Tool Calling — AXIOM Tool Registry Discovery Bridge

**Date:** 2026-08-08
**Scope:** Additive only — one new module (`os/api/openrouter/tool-calling/axiom-tool-registry-bridge.js`), one new regression suite, this changelog entry, `OPENROUTER_PART2C2A_VALIDATION.md`, and test evidence output log. No existing delivered source file's public contract was modified. The bridge is strictly READ-ONLY and performs DISCOVER → NORMALIZE → VALIDATE → EXPOSE without tool execution or dynamic code evaluation.

## What this Part is

Part 2C-2A builds a safe, read-only bridge between OpenRouter Tool Calling (`AxiomOpenRouterToolManager` / `AxiomOpenRouterToolSchema`) and the authoritative existing AXIOM capability/tool infrastructure (`AxiomOrchestrator`). It dynamically discovers tools across all registered AXIOM agents, normalizes capability names into OpenRouter-compliant function names, resolves collisions deterministically without silent overwrites, preserves metadata & availability states, and feeds validated tool definitions into `AxiomOpenRouterToolManager`.

## Added

- **`os/api/openrouter/tool-calling/axiom-tool-registry-bridge.js`** — `window.AxiomOpenRouterToolRegistryBridge`:
  - `initialize(options)` — Initializes bridge, runs initial discovery, emits `openrouter_axiom_registry_initialized`.
  - `discoverTools()` — Queries `AxiomOrchestrator.listAgents()`, normalizes names, performs collision safety checks, maps parameter schemas & availability metadata, registers with `AxiomOpenRouterToolManager`, emits `openrouter_axiom_tools_discovered`.
  - `getTool(name)` / `hasTool(name)` / `getTools()` / `getToolDefinitions()` — Read-only accessors for discovered bridge tools and OpenRouter wire format definitions.
  - `refresh()` — Re-queries `AxiomOrchestrator`, updates snapshot deterministically, emits `openrouter_axiom_registry_refreshed`.
  - `getStatus()` / `destroy()` — Status inspector and teardown helper.
- **`test-evidence/block2-step9-part2c2a-axiom-tool-registry-bridge-regression-suite.js`** — 50-assertion test suite.
- **`test-evidence/block2-step9-part2c2a-axiom-tool-registry-bridge-regression-output.txt`** — Clean execution log of the regression suite.
- **`OPENROUTER_PART2C2A_VALIDATION.md`** — Comprehensive validation report.

# AXIOM — Block 2 / Step 9 / Part 2C-1B: OpenRouter Tool Calling — Tool Call Parser

**Date:** 2026-08-08
**Scope:** Additive only — one new file
(`os/api/openrouter/tool-calling/tool-call-parser.js`) in Part 2C-1A's
existing `tool-calling/` subdirectory, one new regression suite, this
changelog entry, and `OPENROUTER_PART2C1B_VALIDATION.md`. No existing
delivered source file's public contract was modified — this Part does
not call `chat.sendMessage()`, `stream.streamMessage()`,
`queue.enqueue()`, or `response-parser.js`'s `normalizeToolCalls()`,
does not read `stream-manager.js`'s internal state, and creates no
`AxiomRuntimeContext`. Does not touch Browser (`os/core/browser-*.js`),
Automation (`os/core/automation-*.js`), Memory
(`os/core/memory-engine.js`, `os/core/memory-manager.js`), Goal
Manager (`os/core/goal-manager*.js`), Voice (`js/core/voice*.js`), or
Supabase (`js/core/supabase/*.js`, `js/core/supabase-config.js`) — all
verified unchanged by byte-for-byte SHA-256 checks (see
`OPENROUTER_PART2C1B_VALIDATION.md`).

## What this Part is

Part 2C-1A gave AXIOM a place to *declare* a tool
(`window.AxiomOpenRouterToolManager`/`AxiomOpenRouterToolSchema`), but
nothing yet to make sense of a tool call a model actually sends back.
Part 2C-1B is that piece: `window.AxiomOpenRouterToolCallParser`
normalizes OpenRouter's raw `tool_calls` wire shape into AXIOM's
internal `{id, name, arguments, raw}` form, parses (never executes)
the `arguments` JSON with a controlled non-throwing error path,
validates a parsed call against Part 2C-1A's own registry, and
accumulates streaming tool-call deltas into finalized calls. Parsing
and validation only — dispatching a validated call to an actual
callable implementation remains out of scope, left to a future Part.

## Added

- **`os/api/openrouter/tool-calling/tool-call-parser.js`** —
  `window.AxiomOpenRouterToolCallParser`:
  - `parseToolCall(rawToolCall)` / `parseToolCalls(rawToolCalls)` —
    normalize one or many raw `tool_calls` entries into
    `{id, name, arguments, argumentsRaw, parseError, raw}`, order-
    preserving, never discarding an entry, never throwing on any
    input shape.
  - `validateToolCall(parsedCall)` — `{valid, errors}`, checking call-
    name shape (via `AxiomOpenRouterToolSchema`), tool existence (via
    `AxiomOpenRouterToolManager`), and — new in this Part — that the
    parsed arguments satisfy the registered tool's required
    parameters and declared types.
  - `createAccumulator()` — a caller-owned, stateful-per-instance
    utility (`addDeltas`/`getPartials`/`finalize`/`reset`) for
    streaming tool-call deltas, finalizing a call once it has an id
    and a function name.
  - Emits `openrouter_tool_call_detected` / `_parsed` / `_parse_failed`
    on the existing `AxiomOrchestrator` bus (no new pub/sub).
  - No `eval()`, no `Function()`, no dynamic code execution, no shell
    access, no network calls, no `localStorage` — argument parsing
    uses `JSON.parse()` exclusively, wrapped in try/catch.

## Verification

- New suite
  `test-evidence/block2-step9-part2c1b-tool-call-parser-regression-suite.js`:
  **101/101 passing** — full section list in
  `OPENROUTER_PART2C1B_VALIDATION.md` §5.1.
- Part 2A's, 2B-1's, 2B-2's, and 2B-3's own suites re-run live, fresh
  subprocesses: **72/72**, **56/56**, **87/87**, **96/96**. Part
  2B-4's and 2C-1A's own suites were not re-executed live in this
  session — both nest Part 2B-3's suite, which was confirmed (via a
  detached background run left going for 100+ seconds) to leave its
  child process asleep on a pending real `setTimeout` well past its
  printed summary, a pre-existing property of `request-queue.js`'s
  regression suite unrelated to this Part — see
  `OPENROUTER_PART2C1B_VALIDATION.md` §5.2. Instead, every file those
  suites exercise was confirmed byte-for-byte unmodified by SHA-256
  hash against its state immediately after Part 2C-1A's own
  deliverable was extracted.
- One defect found and fixed, scoped to the delivered source: the
  argument-parsing path's "already an object" case (build spec's
  "object arguments" input) returned the caller's object by direct
  reference instead of a deep clone, so a function-typed property on
  that object would have survived into `parsed.arguments` still
  callable. Fixed to route through the same JSON-round-trip
  `deepClone()` every other value in this file already uses.
- Three issues found and fixed in this Part's own new test file
  (incorrect test expectations / an event-log not cleared / an
  over-strict static regex) — none in the delivered source. Full
  detail in `OPENROUTER_PART2C1B_VALIDATION.md` §5.3.

---

# AXIOM — Block 2 / Step 9 / Part 2C-1A: OpenRouter Tool Calling — Tool Registry & Schema Foundation

**Date:** 2026-08-08
**Scope:** Additive only — one new subdirectory
(`os/api/openrouter/tool-calling/`) holding two new files
(`tool-manager.js`, `tool-schema.js`), one new regression suite, this
changelog entry, and `OPENROUTER_PART2C1A_VALIDATION.md`. No existing
delivered source file's public contract was modified — this Part
does not call `chat.sendMessage()`, `stream.streamMessage()`,
`queue.enqueue()`, or `response-parser.js`'s `normalizeToolCalls()`,
and creates no `AxiomRuntimeContext`. Does not touch Browser
(`os/core/browser-*.js`), Automation (`os/core/automation-*.js`),
Memory (`os/core/memory-engine.js`, `os/core/memory-manager.js`),
Goal Manager (`os/core/goal-manager*.js`), Voice
(`js/core/voice*.js`), or Supabase (`js/core/supabase/*.js`,
`js/core/supabase-config.js`) — all verified unchanged by static
regression checks (see `OPENROUTER_PART2C1A_VALIDATION.md`).

## What this Part is

Parts 2A through 2B-4 built the OpenRouter connection, chat, and
streaming pipeline, plus request-queueing and usage tracking — but
none of them give a caller a place to *declare* a tool an OpenRouter
model could be offered via the standard `tools` request field. Part
2C-1A is that foundation: a schema validator/normalizer
(`window.AxiomOpenRouterToolSchema`) and a registry built on top of
it (`window.AxiomOpenRouterToolManager`). Registration and schema
validation only — no tool is ever executed, and no existing request/
response pipeline is wired to a registered tool yet. That wiring is
explicitly left to a future Part.

## Added

- **`os/api/openrouter/tool-calling/tool-schema.js`** —
  `window.AxiomOpenRouterToolSchema`. Stateless, dependency-free
  validation/normalization of OpenRouter-compatible function
  schemas:
  - `validateTool(tool)` / `validateParameters(parameters)` —
    `{valid, errors}`, rejecting missing/invalid names, missing/
    malformed parameters, invalid parameter types, and malformed
    `required` arrays, at any nesting depth.
  - `normalizeTool(tool)` — produces the OpenRouter wire shape
    `{type:"function", function:{name, description, parameters}}`
    with defaults filled in (`properties: {}`, `required: []`), or
    `null` for an invalid tool.
  - `isValidToolName(name)` — the same `[a-zA-Z0-9_-]{1,64}` name
    rule, exposed standalone.
  - Supports `string`/`number`/`integer`/`boolean`/`object`/`array`,
    including arbitrarily nested objects-in-arrays and
    arrays-of-objects.
- **`os/api/openrouter/tool-calling/tool-manager.js`** —
  `window.AxiomOpenRouterToolManager`. The registry:
  `registerTool()` / `unregisterTool()` / `getTool()` / `hasTool()` /
  `getTools()` / `getToolDefinitions()` / `clearTools()`.
  - Duplicate names rejected without overwriting the original.
  - Every stored/returned record is a deep clone (JSON round-trip) —
    a caller can never corrupt the registry by mutating a value they
    got back, and a stray callable field (e.g. an `execute`/`handler`
    function some caller mistakenly attaches) is silently dropped,
    never stored, never invoked.
  - Registration order preserved across `getTools()` and
    `getToolDefinitions()`.
  - Degrades gracefully with no `AxiomOpenRouterToolSchema` and/or no
    `AxiomOrchestrator` loaded — never throws.

## Events

`openrouter_tool_registered`, `openrouter_tool_unregistered`,
`openrouter_tool_registration_failed` — emitted directly onto the
existing `AxiomOrchestrator.emit()` bus (feature-detected, no local
event bus built). Not routed through `AxiomOpenRouter.on()`/`.emit()`
— this Part's build spec calls for `AxiomOrchestrator` specifically.

## Reuse (no duplication)

- **Event Bus** — calls `AxiomOrchestrator.emit()` directly, same
  convention `os/core/capability-router.js` and every other
  `os/core/*` orchestration-layer file already uses. No second bus
  was built.
- **Logger** — every log line goes through `AxLogger`, console
  fallback, same defensive convention as every `os/api/openrouter/*`
  sibling.
- **Response-side tool-call parsing (`response-parser.js`)** — read,
  confirmed disjoint (parses `tool_calls` OUT of a response; this
  Part validates tool DEFINITIONS going INTO a request), not reused
  and not duplicated.
- **Model capabilities (`model-manager.js`)** — read, confirmed not
  needed for pure schema/registration; no model-awareness anywhere in
  this Part.

## Verification

- New suite
  `test-evidence/block2-step9-part2c1a-tool-registry-regression-suite.js`:
  **145/145 passing.**
- All existing regression/audit suites re-run: every suite that was
  passing before this Part still passes, including fresh subprocess
  re-runs of Part 2A's (**72/72**), Part 2B-1's (**56/56**), Part
  2B-2's (**87/87**), Part 2B-3's (**96/96**), and Part 2B-4's
  (**90/90**) own suites, unmodified in behavior; the same
  pre-existing, unrelated failures as every prior Part's own report
  (missing `jsdom` devDependency, intentionally-absent secrets file)
  — no new failures, none fixed (out of scope). See
  `OPENROUTER_PART2C1A_VALIDATION.md` §5 for the full account.
- Two defects found and fixed, both scoped entirely to this Part's
  own new test file (not the delivered source): over-broad static
  string checks that matched this Part's own header-comment prose
  (documenting why `eval()`/`normalizeToolCalls()`/`getCapabilities()`
  are *not* used) as if they were real code references. Fixed by
  stripping comments before every static string check — same class
  of fix Part 2A's own suite made once before. No source file under
  `os/api/openrouter/` required any change.

---

# AXIOM — Block 2 / Step 9 / Part 2B-4: OpenRouter Usage Tracker

**Date:** 2026-08-08
**Scope:** Additive only — one new file
(`os/api/openrouter/usage-tracker.js`), one new regression suite,
this changelog entry, and `OPENROUTER_PART2B4_VALIDATION.md`. No
existing delivered source file's public contract was modified — this
Part adds no new fields/parameters to any prior Part's public
function, it only *listens to* what Parts 2A/2B-1/2B-2/2B-3 already
emit on the shared bus (`openrouter_request_started/_completed`,
`openrouter_stream_started/_finished`, `openrouter_error`,
`openrouter_retry`) and *reads* `tokens.estimateCost()`. Does not
touch Browser (`os/core/browser-*.js`), Automation
(`os/core/automation-*.js`), Memory (`os/core/memory-engine.js`,
`os/core/memory-manager.js`), Goal Manager
(`os/core/goal-manager*.js`), Voice (`js/core/voice*.js`), or
Supabase (`js/core/supabase/*.js`, `js/core/supabase-config.js`) —
all verified unchanged by static regression checks (see
`OPENROUTER_PART2B4_VALIDATION.md`).

## What this Part is

Part 2A's `token-manager.js` already tracks raw token counts and cost
per request/model; Part 2B-3's `request-queue.js` already tracks
queue-level metrics (enqueued/succeeded/failed/cancelled/retried).
Neither one answers "how much OpenRouter usage has happened, broken
down by conversation, by day, by month, with success/failure/retry
counts and latency alongside the tokens and cost?" — that cross-
cutting rollup is Part 2B-4: a `window.AxiomOpenRouter.usage`
sub-namespace that is a pure OBSERVER over the request lifecycle
Parts 2A/2B-1/2B-2/2B-3 already built. It adds no new HTTP, retry,
streaming, or queueing logic — it subscribes to the existing shared
bus and rolls what it hears into running global, per-model,
per-session, daily, and monthly counters.

## Added

- **`os/api/openrouter/usage-tracker.js`** —
  `window.AxiomOpenRouter.usage`:
  - Tracks, per completed/failed request: **requests**, **successes**,
    **failures**, **retries**, **prompt tokens**, **completion
    tokens**, **total tokens**, **estimated cost (USD)**, and
    **average latency (ms)**.
  - Rolled up four ways: **global totals**, **per-model**
    (`getModelStats(modelId)` / `listModelStats()`), **per-session**
    (`getSessionStats(sessionId)` / `listSessionStats()` — "session"
    means `chatId`, the closest existing stable identifier for "one
    ongoing conversation"; there is no separate session concept
    anywhere else in the codebase to reuse), **daily**
    (`getDailyStats(dateKey?)` / `listDailyStats()`, UTC
    `'YYYY-MM-DD'`, defaults to today), and **monthly**
    (`getMonthlyStats(monthKey?)` / `listMonthlyStats()`, UTC
    `'YYYY-MM'`, defaults to this month).
  - `getStats()` — global totals snapshot, plus `models`/`sessions`
    counts (how many distinct buckets exist).
  - `getActiveRequestCount()` — in-flight (not yet settled) request
    count. Reads `AxiomRuntimeContext.listContexts({ownerAgent:
    'openrouter', status: 'running'})` when Runtime Context is loaded
    (read-only — never creates/mutates a context of its own, same
    precedent `os/core/autonomous-decision-engine.js` already set for
    read-only Runtime Context reuse), falling back to an internal
    pending-request count otherwise.
  - `resetStats()` / `configure({historyLimit})`.
  - Event: **`openrouter_usage_updated`** — `{trigger, requestId?,
    sessionId?, model?, totals, at}` — fired after every counted
    request start/completion/failure/retry, so a listener can stay
    current without polling. Published through the existing
    `AxiomOpenRouter.emit()`, which already forwards to
    `AxiomOrchestrator`/Analytics/a DOM `CustomEvent` — this file
    never talks to Analytics/Orchestrator directly.
  - **What counts as a "request"**: exactly the request-shaped event
    pairs chat-manager.js/stream-manager.js already emit
    (`openrouter_request_started/_completed`,
    `openrouter_stream_started/_finished`). A resumed stream
    (`{resumed: true}`) is not double-counted. `request-queue.js`'s
    own `openrouter_queue_completed` is deliberately **not** used to
    count requests/successes/failures — a queued task's `execute()`
    IS `chat.sendMessage()`/`stream.streamMessage()`, so counting
    both would double-count every queued request; each individual
    attempt (including retries) is counted once, via the
    chat/stream-level events, and `openrouter_retry` is reused for
    the separate retries counter. Failures are attributed via
    `openrouter_error`, filtered to `op === 'sendMessage' ||
    op === 'streamMessage'` only, so unrelated errors (key
    validation, health checks, model-catalog fetches) are never
    counted as a tracked request's failure.
  - **Cost**: reuses `tokens.estimateCost(model, promptTokens,
    completionTokens)` (Part 2A) for every successful request's cost
    figure — does not re-derive pricing math or duplicate Token
    Manager's own global/per-model token ledger.
  - Degrades gracefully like every sibling: if
    `AxiomOpenRouter.on` isn't present at load time (api-manager.js
    not yet loaded), `install()` logs a warning and no-ops rather
    than throwing; all read APIs still work, reporting zeros.
- `test-evidence/block2-step9-part2b4-usage-tracker-regression-suite.js`
  (+ `...-regression-output.txt`) — **90/90 passing**, including a
  full re-run of Part 2A's (72/72), Part 2B-1's (56/56), Part
  2B-2's (87/87), and Part 2B-3's (96/96) own suites, unmodified in
  behavior.
- `OPENROUTER_PART2B4_VALIDATION.md`.

## Changed (additive only)

- `test-evidence/block2-step9-part2a-openrouter-core-regression-suite.js`,
  `test-evidence/block2-step9-part2b1-chat-manager-regression-suite.js`,
  `test-evidence/block2-step9-part2b2-stream-manager-regression-suite.js`,
  `test-evidence/block2-step9-part2b3-request-queue-regression-suite.js`:
  one static assertion in each ("`os/api/openrouter/` contains
  exactly N expected files") updated to include this Part's one new,
  approved, in-scope sibling file — same precedent Part 2B-1 set for
  Part 2A's suite, Part 2B-2 set for both Part 2A's and Part 2B-1's
  suites, and Part 2B-3 set for all three. No other line in any
  pre-existing suite was touched.

## Not touched

- `js/core/openrouter-client.js`, `openrouter-config.js`,
  `model-selector.js` — untouched, not imported, not called.
- `os/api/openrouter/{api-manager,model-manager,token-manager,
  error-handler,chat-manager,stream-manager,response-parser,
  request-queue}.js` — untouched; every documented public export of
  each verified still present, and each Part's own regression suite
  re-run in full.
- Every file in the Block 2 do-not-modify set (browser/automation/
  memory/goal-manager/voice/Supabase) — untouched.
- No HTML file edited. No `localStorage` key read or written by
  `usage-tracker.js` (in-memory only, same convention as
  `token-manager.js`). No `fetch()`/XHR call made by
  `usage-tracker.js` directly — it never calls
  `chat.sendMessage()`/`stream.streamMessage()`/`queue.enqueue()`
  itself. No `AxiomRuntimeContext` context created or mutated by
  `usage-tracker.js` — read-only reuse only.

## Verification

- New suite: **90 passed, 0 failed**.
- Part 2B-3's own suite, re-run after this Part's changes:
  **96 passed, 0 failed** (identical to its original report).
- Part 2B-2's own suite, re-run after this Part's changes:
  **87 passed, 0 failed** (identical to its original report).
- Part 2B-1's own suite, re-run after this Part's changes:
  **56 passed, 0 failed** (identical to its original report).
- Part 2A's own suite, re-run after this Part's changes:
  **72 passed, 0 failed** (identical to its original report).
- Full existing `test-evidence/` sweep: same pre-existing, unrelated
  failures as Part 2B-3's own report documented (missing `jsdom`
  devDependency; `phase9-part1-static-audit` against an
  intentionally-absent secrets file) — no new failures, none fixed
  (out of scope). See `OPENROUTER_PART2B4_VALIDATION.md` §5 for the
  full account.

---

# AXIOM — Block 2 / Step 9 / Part 2B-3: OpenRouter Request Queue

**Date:** 2026-08-06
**Scope:** Additive only — one new file
(`os/api/openrouter/request-queue.js`), one new regression suite,
this changelog entry, and `OPENROUTER_PART2B3_VALIDATION.md`. No
existing delivered source file's public contract was modified —
this Part adds no new fields/parameters to any prior Part's public
function, it only *calls into* what Parts 2A/2B-1/2B-2 already
expose (`_internal.classifyError`, `_internal.withRuntimeContext`,
`errors.isRetryable`, the shared `emit()`/`on()` bus,
`chat.sendMessage()`, `stream.streamMessage()`/`cancelStream()`).
Does not touch Browser (`os/core/browser-*.js`), Automation
(`os/core/automation-*.js`), Memory (`os/core/memory-engine.js`,
`os/core/memory-manager.js`), Goal Manager
(`os/core/goal-manager*.js`), Voice (`js/core/voice*.js`), or
Supabase (`js/core/supabase/*.js`, `js/core/supabase-config.js`) —
all verified unchanged by static regression checks (see
`OPENROUTER_PART2B3_VALIDATION.md`).

## What this Part is

Parts 2B-1 and 2B-2 each built one request path (`sendMessage()`,
`streamMessage()`) whose own header comments describe "a retry" as
simply "the caller manually calls the function again" — there was no
scheduling layer above either one: no way to cap how many OpenRouter
calls run at once, prioritize one over another, back off and retry
automatically, or time out and cancel a call that's queued but hasn't
started yet. Part 2B-3 is that scheduling layer: a
`window.AxiomOpenRouter.queue` sub-namespace that sits in front of
(and reuses) `chat.sendMessage()`/`stream.streamMessage()` — or any
arbitrary `() => Promise` — and adds priority ordering, bounded
parallelism, retry scheduling (reusing `error-handler.js`'s existing
retryability verdict, not a new classification of its own), timeout
handling, cancellation, queue-wide 429 cooldown handling, and queue
metrics.

## Added

- **`os/api/openrouter/request-queue.js`** —
  `window.AxiomOpenRouter.queue`:
  - `enqueue(execute, options?)` → `{requestId, promise}` — the
    generic primitive. `execute: () => Promise` is required; works
    fully standalone with zero dependency on any other
    `os/api/openrouter/*` file (useful for tests, and for queuing any
    other async work through the same scheduler).
    `options`: `{priority=0, timeoutMs, maxRetries,
    retryBaseDelayMs, retryMaxDelayMs, cancel?, id?, meta?}`.
  - `enqueueChatMessage(chatId, content, options?)` — queues
    `chat.sendMessage()`. Degrades to a `core_not_loaded` rejection
    (never a synchronous throw) if `chat-manager.js` isn't loaded,
    same convention as stream-manager.js's own dependency checks.
  - `enqueueStream(chatId, content, callbacks?, options?)` — queues
    `stream.streamMessage()`, with `cancel` wired straight to
    `stream.cancelStream()` — a queued stream task cancelled (by
    `cancel()` or by hitting `timeoutMs`) gets a *real* abort, not
    just a "queue stops waiting on it" no-op. Degrades to
    `core_not_loaded` if `stream-manager.js` isn't loaded.
  - **Priority queue** — higher `priority` always dispatches before
    lower, regardless of arrival order; equal-priority requests run
    strictly FIFO (**Request Ordering**).
  - **Parallel requests** — `maxConcurrent` (default 3) caps how many
    dispatched attempts run at once; raising it via `configure()`
    immediately unblocks more dispatch.
  - **Retry scheduling** — on a retryable failure (per
    `errors.isRetryable()` / `_internal.classifyError()` — the exact
    same verdict chat-manager.js/stream-manager.js's own rejections
    already carry), schedules a re-attempt after an exponential
    backoff + jitter delay, up to `maxRetries`. Reuses the existing
    classification; does not reimplement or second-guess it.
  - **Timeout handling** — `timeoutMs` per task; a task that doesn't
    settle in time is failed with a `timeout`-coded, retryable error
    (so it flows through the same retry scheduling above) and, for
    `enqueueStream()` tasks, triggers a real `cancelStream()`.
  - **Cancellation** — `cancel(requestId, reason?)` works whether the
    request is still queued, waiting between retries, or actively
    running; a running cancellation invokes the task's `cancel` hook
    (if supplied) best-effort and frees its concurrency slot
    immediately. `clear(reason?)` bulk-cancels everything still
    queued.
  - **Queue metrics** — `getMetrics()` (totals for
    enqueued/succeeded/failed/cancelled/retried/rate-limited, current
    queued/running/retrying counts, pause state, active rate-limit
    cooldown), `getRequest(requestId)` / `listRequests(filter?)` for
    per-request snapshots.
  - **Rate limit handling** — a `429` pauses dispatch of *new* work
    queue-wide for a configurable cooldown (`rateLimitCooldownMs`,
    default 20s) — not just a longer backoff on that one request —
    since a 429 is OpenRouter asking the whole client to slow down,
    not just that one call. Already-running requests are left to
    finish. Documented limitation: neither `chat.sendMessage()` nor
    `stream.streamMessage()` surface response headers to their
    callers today, so the cooldown is a configurable fixed duration
    rather than one derived from OpenRouter's actual `Retry-After`
    header — a natural follow-up if a future Part threads response
    headers through.
  - `pause()` / `resume()` — manual dispatch gate, independent of the
    automatic rate-limit cooldown.
  - `configure({maxConcurrent, maxRetries, retryBaseDelayMs,
    retryMaxDelayMs, defaultTimeoutMs, rateLimitCooldownMs})`.
  - Events: `openrouter_queue_added`, `openrouter_queue_started`,
    `openrouter_queue_completed` (fires exactly once per request, on
    every terminal outcome — succeeded/failed/cancelled),
    `openrouter_retry` — plus, following the same precedent Part
    2B-2 set of emitting more events than its own bare public-API
    list strictly required, `openrouter_queue_timeout`,
    `openrouter_queue_rate_limited`, `openrouter_queue_cancelled`.
  - Each dispatched attempt is optionally wrapped via
    `_internal.withRuntimeContext()` (feature-detected — the same
    Runtime Context helper `api-manager.js`'s own
    `validateApiKey()`/`checkHealth()` and `chat-manager.js`'s
    `doChatRequest()` already use) for observability; orthogonal to
    any Runtime Context usage already happening inside the wrapped
    task itself.
- `test-evidence/block2-step9-part2b3-request-queue-regression-suite.js`
  (+ `...-regression-output.txt`) — **96/96 passing**, including a
  full re-run of Part 2A's (72/72), Part 2B-1's (56/56), and Part
  2B-2's (87/87) own suites, unmodified in behavior.
- `OPENROUTER_PART2B3_VALIDATION.md`.

## Changed (additive only)

- `test-evidence/block2-step9-part2a-openrouter-core-regression-suite.js`,
  `test-evidence/block2-step9-part2b1-chat-manager-regression-suite.js`,
  `test-evidence/block2-step9-part2b2-stream-manager-regression-suite.js`:
  one static assertion in each ("`os/api/openrouter/` contains
  exactly N expected files") updated to include this Part's one new,
  approved, in-scope sibling file — same precedent Part 2B-1 set for
  Part 2A's suite, and Part 2B-2 set for both Part 2A's and Part
  2B-1's suites. No other line in any pre-existing suite was touched.

## Not touched

- `js/core/openrouter-client.js`, `openrouter-config.js`,
  `model-selector.js` — untouched, not imported, not called.
- `os/api/openrouter/{api-manager,model-manager,token-manager,
  error-handler,chat-manager,stream-manager,response-parser}.js` —
  untouched; every documented public export of each verified still
  present, and each Part's own regression suite re-run in full.
- Every file in the Block 2 do-not-modify set (browser/automation/
  memory/goal-manager/voice/Supabase) — untouched.
- No HTML file edited. No `localStorage` key read or written by
  `request-queue.js` (it is a stateless, in-memory scheduler). No
  `fetch()`/XHR call made by `request-queue.js` directly.

## Verification

- New suite: **96 passed, 0 failed** (3 consecutive runs, to confirm
  no timing-based flakiness in the retry/timeout/rate-limit tests).
- Part 2B-2's own suite, re-run after this Part's changes:
  **87 passed, 0 failed** (identical to its original report).
- Part 2B-1's own suite, re-run after this Part's changes:
  **56 passed, 0 failed** (identical to its original report).
- Part 2A's own suite, re-run after this Part's changes:
  **72 passed, 0 failed** (identical to its original report).
- Full existing `test-evidence/` sweep: same pre-existing, unrelated
  failures as Part 2B-2's own report documented (missing `jsdom`
  devDependency; `phase9-part1-static-audit` against an
  intentionally-absent secrets file) — no new failures, none fixed
  (out of scope). See `OPENROUTER_PART2B3_VALIDATION.md` §5 for the
  full account.

---

# AXIOM — Block 2 / Step 9 / Part 2B-2: OpenRouter Stream Manager + Response Parser

**Date:** 2026-08-06
**Scope:** Additive only — two new files
(`os/api/openrouter/stream-manager.js`,
`os/api/openrouter/response-parser.js`), one new regression suite,
this changelog entry, and `OPENROUTER_PART2B2_VALIDATION.md`. No
existing delivered source file's public contract was modified — see
"Changed (additive only)" below for the one small, additive,
backward-compatible extension made to `chat-manager.js` so
stream-manager.js could reuse its request-shaping logic and shared
conversation history instead of duplicating either. Does not touch
Browser (`os/core/browser-*.js`), Automation
(`os/core/automation-*.js`), Memory (`os/core/memory-engine.js`,
`os/core/memory-manager.js`), Goal Manager
(`os/core/goal-manager*.js`), Voice (`js/core/voice*.js`), or
Supabase (`js/core/supabase/*.js`, `js/core/supabase-config.js`) —
all verified unchanged by static regression checks (see
`OPENROUTER_PART2B2_VALIDATION.md`).

## What this Part is

Part 2B-1's own validation report (§6, "Known limitations /
follow-ups for a future Part") called out exactly this: *"No
streaming (SSE) support... adding a `streamMessage()` that reuses
this same payload builder and conversation state is a natural,
additive follow-up."* Part 2B-2 is that follow-up: a
`window.AxiomOpenRouter.stream` sub-namespace for real-time SSE
streaming, and a `window.AxiomOpenRouter.parser` sub-namespace for
normalizing every response shape (full responses, streaming chunks,
raw SSE lines, usage, finish reasons, tool calls, error bodies) that
streaming and chat completion both touch.

## Added

- **`os/api/openrouter/stream-manager.js`** —
  `window.AxiomOpenRouter.stream`:
  - `streamMessage(chatId, content, callbacks?, overrides?)` →
    `{streamId, promise}`. Opens a `POST /chat/completions` request
    with `stream: true` using chat-manager.js's own conversation
    state/params, reads the SSE body incrementally, and resolves once
    the reply is complete.
  - Real-time streaming via `onChunk`/`onProgress`/`onComplete`/
    `onError`/`onCancel` callbacks, in addition to shared-bus events.
  - `cancelStream(streamId, reason?)` — aborts the in-flight
    connection, preserves partial content, rejects the pending
    promise with a `stream_cancelled` usage error.
  - `resumeStream(streamId, callbacks?)` — reconnects a cancelled/
    errored stream and continues appending to the same accumulated
    content under the same `streamId` (see the file's header comment,
    "A note on resume", for why this is a reconnect-and-continue
    design rather than a byte-exact SSE resume — OpenRouter's public
    API has no resumable-stream token).
  - `getStream(streamId)` / `listStreams(chatId?)` — inspect live/
    finished stream state.
  - `configure({idleTimeoutMs})` — aborts a stream that goes silent
    for too long.
  - Events: `openrouter_stream_started`, `openrouter_stream_chunk`,
    `openrouter_stream_finished`, `openrouter_stream_cancelled`.
  - A finished stream's reply is appended into chat-manager.js's own
    shared per-`chatId` history (via the new `chat._internal`, below)
    — `getHistory()`/`listChats()` see a streamed turn exactly like a
    non-streamed one.
  - Degrades to a clearly-coded `core_not_loaded` rejection (never a
    synchronous throw) if `api-manager.js` or `chat-manager.js`'s
    `_internal` surface isn't loaded; falls back to a single
    synthesized chunk if the runtime's `fetch()` doesn't expose a
    readable-stream response body.
- **`os/api/openrouter/response-parser.js`** —
  `window.AxiomOpenRouter.parser`: `normalizeChatResponse()`,
  `normalizeStreamChunk()`, `parseSSELine()`, `normalizeUsage()`,
  `normalizeFinishReason()`, `normalizeToolCalls()`,
  `normalizeMessage()`, `normalizeErrorResponse()`. Pure, stateless,
  makes no network calls — same standalone convention as
  `error-handler.js`.
- `test-evidence/block2-step9-part2b2-stream-manager-regression-suite.js`
  (+ `...-regression-output.txt`) — **87/87 passing.**
- `OPENROUTER_PART2B2_VALIDATION.md`.

## Changed (additive only)

- **`os/api/openrouter/chat-manager.js`**:
  - `buildPayload(chat, overrides)` gained an optional third
    parameter, `streamFlag` — `buildPayload(chat, overrides,
    streamFlag)`. Every existing call site (`sendMessage()`) still
    calls it with two arguments, so `payload.stream` there is still
    exactly `false`, byte-for-byte as before — reconfirmed by a fresh
    56/56 run of Part 2B-1's own suite (§ below).
  - Added `ChatManager._internal`, exposing `getRawChat`,
    `buildPayload`, `appendUserTurn`, `appendAssistantTurn` — mirrors
    api-manager.js's own `_internal` pattern (Part 2A). This is what
    lets stream-manager.js reuse chat-manager.js's exact
    message-array/param-shaping logic and its shared per-`chatId`
    history, instead of a second, divergent implementation. **Not**
    part of the documented public contract; every function already in
    `ChatManager`'s public object (`createChat`, `getChat`,
    `listChats`, `getHistory`, `setSystemPrompt`, `configureChat`,
    `sendMessage`, `resetChat`, `deleteChat`, `configure`) is
    unchanged — verified both statically (their names/signatures are
    all still present) and behaviorally (Part 2B-1's full suite still
    passes, 56/56, unmodified except for the one file-count assertion
    below).
- `test-evidence/block2-step9-part2a-openrouter-core-regression-suite.js`
  and `test-evidence/block2-step9-part2b1-chat-manager-regression-suite.js`:
  one static assertion in each ("`os/api/openrouter/` contains
  exactly N expected files") updated to include this Part's two new,
  approved, in-scope sibling files — same precedent Part 2B-1 itself
  set when it updated Part 2A's suite for its own new file (see Part
  2B-1's own validation report §5.3). No other line in either
  pre-existing suite was touched.

## Not touched

- `js/core/openrouter-client.js`, `openrouter-config.js`,
  `model-selector.js` — untouched, not imported, not called.
- `os/api/openrouter/{api-manager,model-manager,token-manager,
  error-handler}.js` — untouched.
- Every file in the Block 2 do-not-modify set (browser/automation/
  memory/goal-manager/voice/Supabase) — untouched.
- No HTML file edited.

## Verification

- New suite: **87 passed, 0 failed.**
- Part 2B-1's own suite, re-run after this Part's changes:
  **56 passed, 0 failed** (identical to its original report).
- Part 2A's own suite, re-run after this Part's changes:
  **72 passed, 0 failed** (identical to its original report).
- Full existing `test-evidence/` sweep: same pre-existing,
  unrelated failures as Part 2B-1's own report documented (missing
  `jsdom` devDependency; `phase9-part1-static-audit` against an
  intentionally-absent secrets file) — no new failures, none fixed
  (out of scope). See `OPENROUTER_PART2B2_VALIDATION.md` §5 for the
  full account.

---

# AXIOM — Block 2 / Step 9 / Part 2B-1: OpenRouter Chat Manager

**Date:** 2026-08-06
**Scope:** Additive only — one new file (`os/api/openrouter/chat-manager.js`),
one new regression suite, and this changelog entry. No existing
delivered source file was modified. Does not touch Browser
(`os/core/browser-*.js`), Automation (`os/core/automation-*.js`),
Memory (`os/core/memory-engine.js`, `os/core/memory-manager.js`),
Goal Manager (`os/core/goal-manager*.js`), Voice
(`js/core/voice*.js`), or Supabase (`js/core/supabase/*.js`,
`js/core/supabase-config.js`) — all verified unchanged by static
regression checks (see `OPENROUTER_PART2B1_VALIDATION.md`). One
assertion inside Part 2A's own regression suite
(`test-evidence/block2-step9-part2a-openrouter-core-regression-suite.js`)
was updated to account for this Part's approved new sibling file —
see "Fixes applied" below; nothing under `os/api/openrouter/` from
Part 2A was changed.

## What this Part is

Part 2A ("Core Foundation") deliberately scoped out an actual
chat-completion request path — see its `OPENROUTER_PART2A_VALIDATION.md`
§6: *"No chat-completion request/streaming method is included in
Part 2A by design... a `chat`/`completions` method belongs in a later
Part that builds on this foundation."* Part 2B-1 is that Part: a
`window.AxiomOpenRouter.chat` sub-namespace that adds real chat
completions and multi-turn conversation management, built entirely on
top of what Part 2A (and, transitively, the wider AXIOM runtime)
already provides — no new infrastructure of its own.

### New files

- **`os/api/openrouter/chat-manager.js`** — `window.AxiomOpenRouter.chat`.
  - `createChat(options?)` / `getChat(chatId)` / `listChats()` /
    `deleteChat(chatId)` — multiple independent, concurrent
    conversations, each with its own history, model, and generation
    params. A duplicate explicit `chatId` is rejected (returns `null`)
    rather than silently clobbering an existing conversation.
  - `sendMessage(chatId, content, overrides?)` — appends the user
    turn, POSTs the full running history (+ system prompt + saved
    params, with optional one-off `overrides` that never mutate the
    saved conversation config) to `POST /chat/completions`, appends
    the assistant's reply, and resolves `{chatId, requestId, message,
    usage}`. Reuses, rather than reimplements:
    - `AxiomOpenRouter._internal.getStoredKey()` for the BYOK key,
    - `AxiomOpenRouter._internal.withTimeout()` for abortable fetch,
    - `AxiomOpenRouter._internal.withRuntimeContext()` for optional
      Runtime Context wrapping (feature-detected),
    - `AxiomOpenRouter._internal.classifyError()` — Part 2A's
      error-handler.js — for HTTP/timeout/network classification on
      failure (this file adds zero new error-classification logic),
    - `AxiomOpenRouter.models.getDefaultModel()` for the fallback
      model when neither the conversation nor the call specifies one,
    - `AxiomOpenRouter.tokens.recordUsage()` to roll a completed
      request's real `usage.prompt_tokens`/`usage.completion_tokens`
      into Part 2A's existing token accounting,
    - `AxiomOpenRouter.emit()` — the same shared bus api-manager.js
      installs — for every event this file fires, so DOM/Orchestrator/
      Analytics forwarding keeps working unchanged.
    On failure, the optimistically-appended user turn is kept (not
    rolled back), so a retry continues the real conversation instead
    of silently resending a "lost" message; no assistant turn is
    added.
  - `getHistory(chatId)` — full transcript (user + assistant turns).
  - `setSystemPrompt(chatId, prompt)` / `configureChat(chatId, patch)`
    — system prompt, `temperature`, `topP` (sent as `top_p`),
    `maxTokens` (sent as `max_tokens`), and `stopSequences` (sent as
    `stop`, capped at 4 entries) are all per-conversation, settable
    independently of `sendMessage()`. Unset params are omitted from
    the outgoing request entirely (no silent `0`/`null`), matching
    the same convention `js/core/openrouter-client.js` already uses
    for `temperature`.
  - `resetChat(chatId, options?)` — clears a conversation's turn
    history so the next `sendMessage()` starts fresh without a new
    `chatId`; keeps the system prompt by default (`{clearSystemPrompt:
    true}` to drop it too).
  - Degrades gracefully, same convention as model-manager.js/
    token-manager.js: with only `chat-manager.js` loaded, conversation
    state management (`createChat`/`getHistory`/`resetChat`/etc.)
    works fully in-memory; `sendMessage()` rejects with a clear
    `core_not_loaded` error (rather than throwing) until
    `api-manager.js` is also present. Load order between the two is
    otherwise irrelevant — verified in the regression suite.

### Events (on the existing `AxiomOpenRouter` shared bus)

- `openrouter_request_started` — `{chatId, requestId, model, at}`,
  fired right before the HTTP call.
- `openrouter_request_completed` — `{chatId, requestId, model, usage,
  at}`, fired on a successful reply.
- `openrouter_chat_created` — `{chatId, model, at}`, fired by
  `createChat()`.
- `openrouter_chat_reset` — `{chatId, at}`, fired by `resetChat()`.

(A failed request does not get its own `_failed` event — it's
classified and emitted as `openrouter_error` by the reused
`classifyError()`, the same path api-manager.js's own
`checkHealth()`/`setApiKey()` failures already use, so listeners have
exactly one error event to subscribe to across the whole
`AxiomOpenRouter` surface.)

### Non-duplication / non-modification

- `js/core/openrouter-client.js` (the existing credit-billed,
  server-proxied chat-UI client) — **not modified, not imported, not
  reused as an implementation** (this file talks to OpenRouter
  directly, BYOK, same as its Part 2A siblings). Verified unchanged by
  the regression suite.
- Browser, Automation, Memory, Goal Manager, Voice, Supabase — **not
  touched**, verified present and unchanged on disk.
- No new global except the `.chat` sub-namespace on the existing
  `window.AxiomOpenRouter`.
- No new `localStorage` key — this file holds only in-memory
  conversation state; it reads the stored API key via
  `_internal.getStoredKey()` and the default model via
  `models.getDefaultModel()` rather than touching either one's
  storage key directly (verified statically).

### Fixes applied

None to newly delivered source. One pre-existing assertion in Part
2A's regression suite —
*"os/api/openrouter/ contains exactly the four required files, nothing
extra"* — was updated to expect this Part's approved fifth sibling
file (`chat-manager.js`) alongside the original four, since it was
otherwise a guaranteed false failure caused by legitimate, in-scope
growth of that directory, not a real regression. The four Part 2A
files themselves were not touched; re-run confirmed 72/72.

### Verification

- New suite `test-evidence/block2-step9-part2b1-chat-manager-regression-suite.js`:
  **56 passed, 0 failed.**
- Full existing suite re-run after adding this Part's file: same
  baseline as Part 2A's own report (30 pre-existing suites pass, 6
  fail on pre-existing, unrelated environment gaps — missing `jsdom`
  devDependency and an intentionally-absent `env.config.js` secrets
  file — neither introduced by this Part). Part 2A's own suite:
  **72/72** (after the one static-assertion update above).
- See `OPENROUTER_PART2B1_VALIDATION.md` for the full report.

# AXIOM — Supabase Integration · Part 1: Core Infrastructure

**Date:** 2026-08-05
**Scope:** Additive only. Does not modify Runtime Context
(`os/core/runtime-context.js`), Agent Orchestrator
(`os/core/orchestrator.js`, `os/runtime/intelligence/orchestrator.js`),
Browser (`os/core/browser-*.js`), Goal Manager
(`os/core/goal-manager*.js`), Memory (`os/core/memory-engine.js`,
`os/core/memory-manager.js`), or AI Runtime (`os/runtime/**`). New
files only, plus one existing file rewritten in place
(`js/core/supabase-config.js` — see FIX 1 below) and one line added
to 16 HTML pages' script lists (new `<script>` tags, nothing removed
or reordered around them).

## What this Part is

Every page already loaded `js/core/supabase-config.js` to get a
`supabaseClient`, but that file (a) hardcoded the project URL and
anon key directly in source and (b) had no connection lifecycle at
all — no reconnect, no health check, no offline awareness, no
structured error handling. This Part replaces that with a real
foundation, reusing what already exists (`window.AxLogger`, the
`AxiomOrchestrator` event bus contract, `window.va` if present) and
duplicating none of it.

### New files

- **`js/core/supabase/env.js`** — `window.AxiomSupabaseEnv`.
  Reads `window.__AXIOM_ENV__` and validates it: both
  `SUPABASE_URL` and `SUPABASE_ANON_KEY` present, non-placeholder,
  URL well-formed, key long enough to plausibly be real. Never
  throws; a bad environment produces `{ valid: false, errors: [...] }`
  with a human-readable reason for each problem, logged once via
  `AxLogger` (falls back to `console` if `AxLogger` isn't loaded yet).
- **`js/core/supabase/connection-manager.js`** — `window.AxiomSupabaseConnection`.
  Owns the one `supabase-js` client instance. State machine:
  `unconfigured -> connecting -> connected | degraded | offline | reconnecting`.
  Health monitoring polls `${SUPABASE_URL}/auth/v1/health` every 30s
  (configurable via `configure()`). Offline detection uses
  `navigator.onLine` plus `online`/`offline` browser events.
  Automatic reconnect uses exponential backoff (1s base, ×2 factor,
  30s cap, ±20% jitter), resetting on the next successful probe.
  Errors are classified (`network` / `auth` / `config` / `timeout` /
  `unknown`) and exposed via `getLastError()`. Ships its own tiny
  pub/sub (`on`/`once`/`off`/`emit`) with the same no-duplicate-
  subscription / safe-re-entrancy contract documented in
  `EVENT_BUS.md` for `AxiomOrchestrator`, so callers already familiar
  with that bus don't have to learn a second shape.
- **`js/core/supabase/auth-service.js`** — `window.AxiomSupabaseAuth`.
  Authentication service foundation + session manager: wires
  `onAuthStateChange` once (idempotent `init()`), tracks the last
  known session, and computes time-to-expiry, emitting
  `expiring-soon` (≤5 min remaining) and `expired`. Session
  *persistence* is intentionally left to `supabase-js` itself (it
  already persists to `localStorage` and auto-refreshes) — this
  module is an observability layer on top, not a second competing
  store.
- **`js/core/env.config.template.js`** — checked-in, safe (no real
  values), documents the required shape of `window.__AXIOM_ENV__`.
- **`scripts/inject-env.js`** — build-time script. Reads
  `SUPABASE_URL` / `SUPABASE_ANON_KEY` from `process.env` and writes
  `js/core/env.config.js` (gitignored) from the template. Exits 1
  with a clear message if either variable is missing.
- **`.env.example`**, **`.gitignore`** — new. `.gitignore` excludes
  the generated `js/core/env.config.js` so a real credential can
  never be committed by accident.
- **`test-evidence/supabase-part1-regression-suite.js`** — 51/51
  passing (see `SUPABASE_PART1_VALIDATION.md`).

### FIX 1 — Hardcoded credentials removed

`js/core/supabase-config.js` used to declare
`const SUPABASE_URL = "https://zdskilffkwpwyszmhvov.supabase.co"` and
a real-looking anon key directly in source — exactly the pattern
`test-evidence/phase9-part1-static-audit-suite.js` check #10 ("No
hardcoded secrets / plaintext API keys") exists to catch. It's now a
7-line shim: it calls `AxiomSupabaseConnection.init()` and reads
`AxiomSupabaseEnv.validate()`, still assigning the results to the
exact same bare top-level `const supabaseClient` /
`const SUPABASE_URL` / `const SUPABASE_ANON_KEY` identifiers so the
four files that already depend on them as shared-scope bare
identifiers — `js/core/openrouter-config.js`,
`js/core/openrouter-client.js`, `js/pages/billing-checkout.js`,
`js/pages/workspace.js` — needed zero changes. **If the previously
hardcoded key was ever deployed to a real Supabase project, rotate
it** — an anon key is designed to be public (RLS is the real
boundary), but shipping the project URL and key together in a
public repo is still worth cycling as routine hygiene.

### HTML changes (16 pages)

`admin.html`, `agent-library.html`, `analytics.html`,
`automation.html`, `billing.html`, `brain.html`, `browser.html`,
`index.html`, `login.html`, `memory.html`, `os-shell.html`,
`playground.html`, `register.html`, `settings.html`, `studios.html`,
`workspace.html` — each gets four new `<script defer>` tags inserted
between the existing Supabase CDN `<script>` and
`js/core/supabase-config.js`:

```html
<script defer src="js/core/env.config.js"></script>
<script defer src="js/core/supabase/env.js"></script>
<script defer src="js/core/supabase/connection-manager.js"></script>
<script defer src="js/core/supabase/auth-service.js"></script>
<script defer src="js/core/supabase-config.js"></script>
```

Nothing else on any page moved. `js/core/env.config.js` doesn't
exist until `npm run build` is run with `SUPABASE_URL` /
`SUPABASE_ANON_KEY` set — a plain `<script>` tag pointing at a
missing local file fails silently in the browser (404, no page
crash), and `AxiomSupabaseEnv` reports the resulting "not configured"
state clearly instead of the app quietly holding a dead client.

### Deliberately deferred to a later Part

- **Memory reuse**: `window.AxiomMemoryManager`'s public surface is
  conversation/session memory for the AI chat feature specifically —
  there's no generic event-log API on it to reuse without extending
  Memory itself, which this Part is explicitly not allowed to do.
  Connection/auth diagnostics are not persisted there.
- **Runtime Context**: intentionally not touched or called into —
  it's one of the six protected systems for this Part.
- **`js/core/auth.js`** (the existing login/register/logout DOM
  wiring): untouched. It still talks to `supabaseClient` directly,
  which continues to work unchanged. Migrating it onto
  `AxiomSupabaseAuth` is Part 2+ scope.

## Regression Coverage

`test-evidence/supabase-part1-regression-suite.js`: **51/51 passing**
— environment validation (5 cases + memoization), connection state
machine (unconfigured / missing-SDK / connected / degraded / offline
/ reconnect scheduling), error classification, pub/sub contract
(dedupe, `once`, `off`), auth session tracking + idempotent `init()`,
backward-compatible bare-identifier access for all four legacy
consumer files, no-hardcoded-credential static scan across every new
file, and correct script load order on all 16 HTML pages. Full run
log in `SUPABASE_PART1_VALIDATION.md`.

All 32 previously-passing regression suites re-run unmodified and
still pass — see `SUPABASE_PART1_VALIDATION.md` for the full
per-suite breakdown (exact assertion counts where each suite reports
them; several report `ALL CHECKS PASSED` without a numeric count).
The same 5 suites already failing before this Part for an unrelated,
pre-existing reason (`Cannot find module 'jsdom'` — no network access
to install it in this offline sandbox, exactly as already documented
for the Phase 9/10 suites) remain in that same state, untouched by
this Part: `block2-step1-coding-agent-regression-suite.js`,
`block2-step1-part2-pipeline-regression-suite.js`,
`milestone10-regression-suite.js`, `milestone5-regression-suite.js`,
`milestone6-regression-suite.js`.

## What Was Preserved

- Runtime Context, Agent Orchestrator, Browser, Goal Manager, Memory,
  and AI Runtime — byte-for-byte untouched.
- Every existing consumer of `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
  `supabaseClient` as bare top-level identifiers — unchanged call
  sites, unchanged behavior.
- All prior regression suites — passing/failing status identical to
  before this Part (see above).

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 8 · Part 2: Intelligent Planning

**Date:** 2026-08-05
**Scope:** Zero new files in `os/core/`; extends the existing
`os/core/decision-engine.js` / `window.AxiomCognitiveDecisionEngine`
(Part 1) in place — no second Decision/Planning Engine global was
created. Required dependencies unchanged from Part 1
(`os/core/orchestrator.js`, `os/core/runtime-context.js`,
`os/core/goal-manager.js`, `os/core/capability-router.js`). Soft
dependency (enriches, degrades gracefully without it): `os/core/goal-
manager-learning.js` (Step 7 Part 3E) — powers the `"learning"` plan
strategy, historical-success-rate scoring, and estimated per-
capability duration; without it, those default to a neutral 0.5 score
and a fixed baseline duration, and the `"learning"` strategy is simply
omitted from `generateAlternativePlans()`. One new regression suite
added (`test-evidence/block2-step8-part2-planning-regression-suite.js`,
28/28 passing). All prior applicable regression suites re-run
unmodified and still pass; see `STEP8_PART2_VALIDATION.md` for the
full run, including the six pre-existing, unrelated `jsdom`-dependent
suites that were already failing in this offline sandbox before this
Part (no network access to install `jsdom`) and remain unaffected.

## What this Part is

Part 1 stops at recommendation: a Decision Object names candidate
capabilities/agents and creates independent Goal Manager records, but
never says in what order, or how much in parallel, those goals should
run, nor which of several valid execution shapes is the best bet
before anything is dispatched. This Part adds that layer, still
analysis/recommendation only:

- **Execution Plan Generation** — `generateExecutionPlan(input,
  options)` converts a Decision Object (or a bare `{ goalIds: [...] }`
  / `{ goals: [...] }`) into an ordered `ExecutionPlan` of steps.
  `strategy: 'sequential'` gives one goal per step, in
  `AxiomGoalManager.getGoalExecutionOrder()`'s own authoritative order
  — unchanged, never recomputed. `strategy: 'parallel'` groups that
  same authoritative order into dependency-safe waves (a goal's wave
  = 1 + the deepest wave among its own in-set prerequisites, read via
  `AxiomGoalManager.getGoalDependencies()`), so independent goals
  share a step while a real dependency still forces its own later
  step. `strategy: 'learning'` defers entirely to
  `AxiomGoalManagerLearning.recommendGoalOrder()` (Step 7 Part 3E)
  when loaded.
- **Alternative Plan Generation** — `generateAlternativePlans(input,
  options)` builds every strategy currently available, scores each
  (see below), and returns all of them plus which one scored highest
  and a comparative reason for each rejection.
- **Planning Factors** — execution cost, estimated duration (plan-
  shape-aware: sequential sums per-goal durations, parallel sums the
  per-wave maximum), capability availability
  (`AxiomOrchestrator.discoverCapabilities()`), agent availability
  (`AxiomCapabilityRouter.selectAgent()`), dependency complexity (from
  the same dependency graph the wave-grouping already reads), system
  load (`AxiomOrchestrator.getStats()` +
  `AxiomRuntimeContext.getContextMetrics()`), and historical success
  rate (`AxiomGoalManagerLearning.getStrategyStats()`, neutral 0.5
  when unavailable).
- **Plan Scoring** — `scorePlan(plan)` / every plan returned by
  `generateExecutionPlan()`/`generateAlternativePlans()` carries
  `reliability`, `efficiency`, `completionProbability`,
  `resourceUsage`, and an overall `confidence`, all in `[0, 1]`.
- **Decision Explanation** — `explainPlan(selected, rejected)` is a
  plain string builder (no model) describing why the selected plan
  won, why each alternative didn't, the step-by-step expected
  execution path, and the estimated completion time.
- **Planning Events** — `planning_started` / `planning_completed` /
  `planning_failed` / `plan_selected`, emitted through the existing
  `AxiomOrchestrator` Event Bus, verified disjoint from every existing
  event name in `os/core` (including Part 1's own `decision_*`
  names).
- **`plan(input, options)`** — the main entry point: normalizes input,
  opens/closes one real `AxiomRuntimeContext` record for the planning
  call, generates + scores + explains + selects, records planning
  history, and emits the four events above. Never dispatches, routes,
  prepares, or admits a goal — goals created upstream by `decide()`
  are left exactly where they were, in `pending` (regression-tested).

## Reuse verification

No scheduling, routing, orchestration, retry, recovery, or execution
logic is duplicated. `AxiomGoalManager.getGoalExecutionOrder()` remains
the single source of truth for valid goal order and the single place a
dependency cycle is ever detected; this Part's wave-grouping is a
read-only reinterpretation of that already-validated order via
`getGoalDependencies()`, not a second topological sort. Goal Manager
Learning's strategy ledger, scoring, and reordering
(`getStrategyStats()`, `recommendGoalOrder()`) are called verbatim; no
second success/failure counter exists in this file. Analytics remains
reachable only indirectly, as whatever capability an `analytics`-
classified goal's plan step happens to recommend — through the exact
same `discoverCapabilities()`/`selectAgent()` calls every other
capability goes through — exactly Part 1's own posture.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 8 · Part 1: Cognitive Decision Engine (Foundation)

**Date:** 2026-08-05
**Scope:** One new file added (`os/core/decision-engine.js`,
`window.AxiomCognitiveDecisionEngine`), zero existing files modified.
Required dependencies: `os/core/orchestrator.js` (Event Bus),
`os/core/runtime-context.js`, `os/core/goal-manager.js` (Step 7 Parts
3A/3B), and `os/core/capability-router.js` (Step 6 Part 3). Soft
dependency (enriches, not required): `os/core/agent-registry-
integration.js` (Step 6 Part 2) — its `Orchestrator.discoverCapabilities
()` install is what capability discovery reads; without it, capability/
agent recommendation degrades to empty arrays rather than failing. One
new regression suite added
(`test-evidence/block2-step8-part1-decision-engine-regression-suite.js`,
41/41 passing). All prior applicable regression suites re-run
unmodified and still pass; see `STEP8_PART1_VALIDATION.md` for the
full run, including the five pre-existing, unrelated `jsdom`-dependent
suites that were already failing in this offline sandbox before this
Part (no network access to install `jsdom`) and remain unaffected.

## What this Part is

Step 7 built goal creation (Part 3A/3B), automatic capability-aware
admission of already-created goals (Part 3C), execution with retry
(Part 3D), learned reordering (Part 3E), and stall/failure recovery
(Part 3F) — but every one of those still needs a caller (a human, or
another module) to have already turned a raw request into a goal, a
capability, or a task list. Nothing in the stack reads an unstructured
user REQUEST and works out what it means before Goal Manager or Task
Planner ever run. This Part is that front door — analysis and
read-only recommendation only, no execution:

- **Intent Detection** — `detectIntent(text)` scores a request against
  a fixed 13-category taxonomy (`conversation`, `browser`,
  `automation`, `workspace`, `memory`, `reasoning`, `coding`,
  `research`, `planning`, `search`, `analytics`, `system`, `unknown`)
  using plain keyword/phrase matching (no machine learning — the same
  posture Part 3F's own validation report documents for its own
  decision logic). Multiple intents per request are supported, each
  with its own confidence score; the highest-scoring one is flagged
  `isPrimary`.
- **Context Extraction** — `extractContext(text)` pulls entities
  (quoted phrases and capitalized multi-word phrases), keywords
  (stopword-filtered), imperative commands (matched against a fixed
  action-verb list), URLs, file names, application names (matched
  against the LIVE agent registry first via
  `AxiomOrchestrator.listAgents()`), dates, and times.
- **Goal Generation** — every detected intent (up to
  `options.maxIntents`) is handed to `AxiomGoalManager.createGoal()`
  UNCHANGED — no goal data model, status machine, or Runtime Context
  wiring is reimplemented. `options.dryRun` skips this step entirely
  for pure analysis.
- **Capability Discovery** — `matchCapabilities()` is this module's
  own small copy of task-planner.js's own live-registry word-overlap
  scorer: every capability considered comes from
  `AxiomOrchestrator.discoverCapabilities()` at call time, never a
  hardcoded list. A brand-new capability registered at runtime becomes
  recommendable with zero code changes to this file (regression-
  tested).
- **Agent Recommendation** — `AxiomCapabilityRouter.selectAgent()` is
  called VERBATIM to name the best current agent for a recommended
  capability (regression-tested to return the identical agent a direct
  `selectAgent()` call would). `route()`/`dispatch()`/`prepare()` are
  never called — recommendation only, never dispatch (regression-
  tested).
- **Decision Object** — `decide()` returns one structured, frozen
  record: detected intents + confidence, extracted context,
  recommended goals/capabilities/agents, and a short human-readable
  reasoning summary.
- **Events** — `decision_started`, `decision_completed`,
  `decision_failed`, published through the real, unmodified
  `AxiomOrchestrator` Event Bus.

## Naming collision, called out explicitly

The brief asked for the global `window.AxiomDecisionEngine`. That name
is already claimed by `os/core/autonomous-decision-engine.js` (Step 7
Part 3C) for a different concept entirely — goal-graph admission
scheduling (deciding which already-queued goal runs next), not intent
detection. Installing onto that name here would silently overwrite or
be silently blocked by Part 3C depending on `<script>` load order —
exactly the "Naming Collision" failure class `goal-manager.js`'s own
header documents avoiding (citing `RUNTIME_CONTEXT.md` FIX 4) by
picking a disjoint name instead of reusing one already claimed on the
shared global surface. Following that same, already-established
project convention, this Part installs as the disjoint
`window.AxiomCognitiveDecisionEngine`. Regression-tested: both globals
coexist correctly when loaded together, and Part 3C's own
`window.AxiomDecisionEngine.selectNextGoal()` is unaffected. Every
event this module emits (`decision_started` / `decision_completed` /
`decision_failed`) was checked against every existing `emit('...')`
call in `os/core` — no collisions (Part 3C's own events are all
`decisionengine_*`, a disjoint namespace).

## Files changed

| File | Change |
|---|---|
| `os/core/decision-engine.js` | **New.** `window.AxiomCognitiveDecisionEngine`. |
| `CHANGELOG.md` | New entry prepended. Nothing else in the file altered. |
| `test-evidence/block2-step8-part1-decision-engine-regression-suite.js` | **New.** 41 assertions. |
| `STEP8_PART1_VALIDATION.md` | **New.** Validation report for this Part. |

No other file in the project was modified. In particular,
`os/core/orchestrator.js`, `os/core/runtime-context.js`,
`os/core/goal-manager.js`, `os/core/capability-router.js`,
`os/core/agent-registry-integration.js`, and
`os/core/autonomous-decision-engine.js` are byte-for-byte unchanged —
verified both programmatically (the new suite's "installs cleanly...
without editing any dependency" test does a `readFileSync` diff of six
dependencies before/after load) and by inspection.

Consistent with the convention Step 7's Parts already established,
this Part does not add its own `<script>` tag to any `.html` file.
Wiring the Cognitive Decision Engine into a live page is left to
whichever future Part is explicitly scoped to do that.

## What this Part explicitly does NOT do (per the brief)

- Does not decompose a goal into an ordered/parallel task graph
  (`task-planner.js`'s own job, untouched, never called).
- Does not pick which already-created goal runs next out of a queue
  (Part 3C's own job, untouched).
- Does not route, dispatch, retry, or execute any capability request —
  `selectAgent()` (a pure, read-only lookup) is the only Capability
  Router entry point called; `route()`/`prepare()`/`dispatch()` are
  never invoked (regression-tested).
- Does not implement machine learning — every score in this file is a
  plain keyword/phrase match count.

---
# AXIOM — Phase 10 · Part 2 · Block 2 · Step 7 · Part 3F: Adaptive Execution & Recovery Layer

**Date:** 2026-08-05
**Scope:** One new file added (`os/core/goal-manager-recovery.js`,
`window.AxiomGoalManagerRecovery`), zero existing files modified.
Required dependencies: `os/core/orchestrator.js` (Event Bus),
`os/core/runtime-context.js`, and `os/core/goal-manager.js` (Step 7
Parts 3A/3B). Optional, soft-checked dependencies:
`os/core/autonomous-decision-engine.js` (Part 3C),
`os/core/decision-engine-execution-bridge.js` (Part 3D), and
`os/core/goal-manager-learning.js` (Part 3E) — all three enrich this
module when loaded but none is required. One new regression suite
added
(`test-evidence/block2-step7-part3f-goal-manager-recovery-regression-suite.js`,
38/38 passing). All prior applicable suites re-run unmodified and
still pass; see `STEP7_PART3F_VALIDATION.md` for the full run.

## What this Part is

Parts 3A–3E gave the Goal Manager stack a durable Goal Record, a
validated status machine, dependencies, a computed queue, eligibility-
aware admission, real dispatch with a bounded first-line retry, and
learned reordering — but nothing in that stack ever watched an
in-flight goal for going quiet, told a permanently-impossible goal
apart from a merely-unlucky one once Part 3D's own retry budget was
spent, or repaired the dependency graph so a goal that depends on a
dead goal is not blocked forever. This Part is exactly that adaptive
layer, and adds nothing else:

- **Monitors active goal execution in real time** — `checkGoalHealth()`
  / `monitorActiveGoals()` read the same three sources of truth every
  other Part already reads: `AxiomGoalManager.getGoal()`,
  `AxiomRuntimeContext.getContext()` via the Goal Record's own
  `contextId`, and — when Part 3D is loaded —
  `AxiomDecisionEngineExecutionBridge.getExecution()`. No second,
  independently-ticking status is kept; the only new bookkeeping is a
  last-observed-activity timestamp per goal, fed by existing events.
- **Detects stalled goals** — a RUNNING goal with no observed activity
  for longer than `getStallThresholdMs()` (default 30s, explicit
  caller-set knob, same posture as Part 3D's `maxExecutionRetries`).
- **Detects blocked goals** — reuses Part 3A/3B's own
  `isGoalBlocked()` (and Part 3C's own `evaluateGoal()` reason string
  when loaded) verbatim.
- **Detects repeated execution failures** — reuses the Goal Record's
  own `retryCount` (already incremented by Part 3A's `retryGoal()`
  across a retry lineage) against a configurable
  `getMaxRecoveryAttempts()` ceiling (or a per-goal
  `metadata.maxRecoveryAttempts` override), plus Part 3D's own
  `decisionengine_execution_exhausted` event when that Part is loaded.
- **Automatically retries recoverable goals using the existing retry
  system** — `attemptRecovery()` calls Part 3A's own `retryGoal()`
  (mints a fresh Goal Record; never mutates the failed one — the exact
  call Part 3D's own `attemptRetry()` already makes) and, when Part 3C
  is loaded, re-enters it through `AxiomDecisionEngine.admitGoal()`.
  Recoverability is decided by reusing Part 3C's own `evaluateGoal()`
  reason string on the freshly-minted retry candidate — never a second
  capability/agent-availability check invented locally.
- **Reorders remaining goals when execution conditions change** —
  calls Part 3E's own `optimizeGoalScheduling()` when loaded, falling
  back to Part 3B's own `runGoalScheduler()` otherwise; triggered
  automatically after every recovery/skip.
- **Skips goals that become impossible while allowing dependent goals
  to continue when appropriate** — a permanently-impossible goal
  (Part 3C reports no agent anywhere advertises the required
  capability) is cancelled via Part 3A's own `cancelGoal()`.
  Dependents that explicitly opted the dependency out via
  `metadata.optionalDependencies` (a new, caller-declared-only
  metadata convention, mirroring how Part 3C's
  `resolveGoalCapability()` and Part 3D's `metadata.maxRetries`
  already read caller-supplied metadata) are unblocked via Part 3B's
  own `removeGoalDependency()`; every other dependent is left exactly
  as blocked as `isGoalBlocked()` already says it is.
- **Resumes interrupted execution after recovery** — without Part 3D
  loaded, a stalled goal is the SAME Goal Record: paused via Part 3B's
  own `pauseGoal()`, then immediately resumed via Part 3B's own
  `resumeGoal()` (`goal_resumed`). With Part 3D loaded, its stuck plan
  is cancelled via Part 3D's own `cancelExecution()`, and — because
  that settles asynchronously, never inside the same call stack — this
  module waits for Part 3D's own `decisionengine_execution_cancelled`
  event before recovering the goal as a fresh attempt via
  `attemptRecovery()` (`goal_recovered`). A successful recovery also
  re-links any goal that depended on the now-dead original onto the
  fresh retry via `addGoalDependency()`/`removeGoalDependency()`.
- **Emits exactly four new lifecycle events** — `goal_recovered`,
  `goal_resumed`, `goal_skipped`, `goal_blocked` — verified (by static
  scan across every other file under `os/core/`) not to collide with
  any `goalmgr_*` / `goal_task_*` / `decisionengine_*` /
  `goalmgrlearn_*` name already in use anywhere in this project.
- **No machine learning of any kind** — every decision here is a
  plain threshold/comparison over existing counters and timestamps
  (idle time vs. a configured threshold, `retryCount` vs. a configured
  ceiling, a reason string vs. a fixed substring). No model, no
  training step, no fitted parameter.

## Files changed

| File | Change |
|---|---|
| `os/core/goal-manager-recovery.js` | **New.** `window.AxiomGoalManagerRecovery`. |
| `CHANGELOG.md` | New entry prepended (this one). Nothing else in the file altered. |
| `test-evidence/block2-step7-part3f-goal-manager-recovery-regression-suite.js` | **New.** 38 assertions. |
| `STEP7_PART3F_VALIDATION.md` | **New.** |

No other file in the project was modified. `os/core/orchestrator.js`,
`os/core/runtime-context.js`, `os/core/goal-manager.js`,
`os/core/task-planner.js`, `os/core/autonomous-decision-engine.js`,
`os/core/decision-engine-execution-bridge.js`,
`os/core/goal-manager-learning.js`, `automation.html`, and every
pre-existing regression suite file are unchanged — verified both by
this Part's regression suite (a byte-for-byte content comparison
before/after load) and manually. Following the same convention Parts
3A–3E already established, this Part does not add a `<script>` tag for
itself to `automation.html`.

## Regression Coverage Added

- load-order guards (refuses to install without `AxiomOrchestrator`,
  `AxiomRuntimeContext`, or `AxiomGoalManager` present; installs
  cleanly and edits none of its dependencies both WITH the full Part
  3C/3D/3E stack present and with ONLY `goal-manager.js` present)
- `setStallThresholdMs()` / `getStallThresholdMs()` and
  `setMaxRecoveryAttempts()` / `getMaxRecoveryAttempts()` round-trip
  and reject invalid input
- `checkGoalHealth()` correctly marks a long-idle RUNNING goal
  stalled and a freshly-started one not stalled; reports `blocked`
  via `isGoalBlocked()` verbatim; reports `impossible` only when Part
  3C is loaded and only for a real no-agent-advertises-capability
  reason, and is always `false` (graceful degrade) without Part 3C
- `monitorActiveGoals()` covers every non-terminal goal, skips
  terminal ones, de-dupes `goal_blocked` across repeated sweeps
  (fires again only after unblock-then-reblock), and cancels +
  `goal_skipped`s a permanently-impossible goal
- `startMonitoring()` / `stopMonitoring()` / `isMonitoring()` drive a
  real sweep on an interval and stop cleanly
- a stalled goal with no Bridge loaded is paused then resumed
  (`goal_blocked` → `goal_resumed`, same Goal Record, left Queued
  without Part 3C — the same posture the rest of the stack already
  has without Part 3C)
- a stalled goal with the Bridge loaded has its stuck execution
  cancelled and — once cancellation settles asynchronously — is
  recovered as a fresh Goal Record with a new plan (`goal_recovered`)
- `attemptRecovery()` mints a retry via the existing retry system,
  enqueues it without Part 3C or re-admits it through
  `AxiomDecisionEngine.admitGoal()` with Part 3C, relinks a dependent
  from the dead original onto the fresh retry, declines for a
  non-Failed/Cancelled goal, escalates to `skipGoal()` at the
  configured (or per-goal metadata) ceiling without forcing a second
  status transition on an already-terminal goal, and skips immediately
  — never mints an endless series of doomed retries — when the fresh
  retry candidate is itself permanently impossible
- `decisionengine_execution_exhausted` automatically triggers recovery
  exactly once per exhaustion event; `goalmgr_failed` triggers
  recovery only when the Bridge is NOT loaded, and is confirmed to
  never double-fire alongside the Bridge's own `attemptRetry()` when
  it is loaded
- `skipGoal()` cancels the target, releases only
  `metadata.optionalDependencies`-declared dependents (a hard
  dependent stays blocked), and triggers the existing
  scheduler/reorder path as a side effect
- `reorderRemainingGoals()` calls Part 3E's `optimizeGoalScheduling()`
  when loaded and Part 3B's `runGoalScheduler()` otherwise
- `goal_recovered`/`goal_resumed`/`goal_skipped`/`goal_blocked` never
  collide with any existing `emit('...')` anywhere else in `os/core`
- every read-path result is frozen; `getRecoveryMetrics()` tracks
  exact counts across a stall + recover + skip scenario;
  `getRecoveryHistory()` supports a limit and is most-recent-first

## Regression Results

`node test-evidence/block2-step7-part3f-goal-manager-recovery-regression-suite.js`
— 38/38 passing. Every other suite under `test-evidence/` was re-run
unmodified after this change; results are unchanged from Part 3E's own
run (all still-runnable suites pass; the same suites that already
failed on missing `jsdom`/unrelated modules in this sandbox before this
Part still fail identically, for the identical pre-existing reason —
none of them load any file this Part touches). Full findings in
`STEP7_PART3F_VALIDATION.md`.

---
# AXIOM — Phase 10 · Part 2 · Block 2 · Step 7 · Part 3E: Goal Manager Learning Layer

**Date:** 2026-08-03
**Scope:** One new file added (`os/core/goal-manager-learning.js`,
`window.AxiomGoalManagerLearning`), zero existing files modified.
Required dependencies: `os/core/orchestrator.js` (Event Bus),
`os/core/runtime-context.js`, and `os/core/goal-manager.js` (Step 7
Parts 3A/3B). Optional, soft-checked dependencies:
`os/core/autonomous-decision-engine.js` (Part 3C) and
`os/core/decision-engine-execution-bridge.js` (Part 3D) — both enrich
this module when loaded but neither is required. One new regression
suite added
(`test-evidence/block2-step7-part3e-goal-manager-learning-regression-suite.js`,
35/35 passing). All prior applicable suites re-run unmodified and
still pass; see `STEP7_PART3E_VALIDATION.md` for the full run.

## What this Part is

The learning layer requested on top of Parts 3A–3D. Before this Part,
every scheduling and admission decision in this lineage was made fresh
from the goal graph and live system state alone — nothing remembered
whether a given kind of goal had historically succeeded, failed, or
run quickly. This module adds exactly that memory, and nothing else:

- **Records execution history** — listens ONLY to events
  `goal-manager.js` itself already emits (`goalmgr_completed` /
  `goalmgr_failed` / `goalmgr_cancelled` / `goalmgr_retried`), so a
  goal driven entirely by hand through `AxiomGoalManager`'s own status
  machine is learned from exactly as much as one dispatched
  autonomously through Parts 3C/3D. `getExecutionHistory()` exposes
  the bounded, append-only ledger (goalId, strategy, priority,
  outcome, duration, retry count, reason), filterable and
  most-recent-first, the same discipline every prior Part's own
  History already uses.
- **Tracks successful strategies and tracks failures** — grouped by
  "strategy", which is simply whatever capability a goal already
  declares on its own metadata. Reuses
  `AxiomDecisionEngine.resolveGoalCapability()` verbatim when Part 3C
  is loaded; a local fallback reads the identical two metadata keys
  when it is not. No goal-type, capability, or agent-id table is
  hardcoded anywhere in this file. `listStrategyStats()` /
  `listFailingStrategies()` expose the running counts, most/least
  successful first.
- **Recommends a better execution order** — `recommendGoalOrder()`
  takes Part 3B's own `getGoalExecutionOrder()` (the real,
  cycle-checked topological + priority + age order) as given and only
  ever swaps two ADJACENT entries, and only when they share the same
  priority tier and neither is a dependency of the other — a
  swap-safety guarantee proved once in the file's own header comment
  rather than re-verified with a second topological sort or a
  transitive-closure walk.
- **Optimizes future goal scheduling** — `optimizeGoalScheduling()` is
  the learned-order counterpart of Part 3B's own `runGoalScheduler()`:
  identical Pending/Waiting filter, identical per-goal `scheduleGoal()`
  call, identical `{ scheduled, blocked }` return shape — only the
  order goals are offered to `scheduleGoal()` in is different.
- **Improves prioritization using historical data** —
  `getRecommendedPriority()` is a read-only, advisory suggestion
  (never applied automatically) bucketed onto Part 3A's own
  `GOAL_PRIORITY` enum from a strategy's Laplace-smoothed historical
  success rate. `applyRecommendedPriority()` is the explicit,
  caller-invoked opt-in that calls Part 3B's existing
  `setGoalPriority()`.
- **No machine learning of any kind** — every number this module
  produces is a plain, auditable statistic over counts it keeps itself
  (a Laplace-smoothed success proportion and an arithmetic-mean
  duration). There is no model, no training step, and no persisted
  weights beyond running counts.
- **Reuses existing analytics and Runtime Context** —
  `getLearningMetrics()` composes `AxiomGoalManager.getGoalMetrics()`,
  `AxiomRuntimeContext.getContextMetrics()`, and — only when those
  modules are loaded — `AxiomDecisionEngine.getDecisionMetrics()` /
  `AxiomDecisionEngineExecutionBridge.getExecutionMetrics()`, adding
  only the new strategy-level counters this Part itself introduces.
  Nothing any of those modules already computes is re-derived here.

## Files changed

| File | Change |
|---|---|
| `os/core/goal-manager-learning.js` | **New.** `window.AxiomGoalManagerLearning`. |
| `CHANGELOG.md` | New entry prepended (this one). Nothing else in the file altered. |
| `test-evidence/block2-step7-part3e-goal-manager-learning-regression-suite.js` | **New.** 35 assertions. |
| `STEP7_PART3E_VALIDATION.md` | **New.** |

No other file in the project was modified. `os/core/orchestrator.js`,
`os/core/runtime-context.js`, `os/core/goal-manager.js`,
`os/core/task-planner.js`, `os/core/autonomous-decision-engine.js`,
`os/core/decision-engine-execution-bridge.js`, `automation.html`, and
every pre-existing regression suite file are unchanged — verified both
by this Part's regression suite (a byte-for-byte content comparison
before/after load) and manually. Following the same convention Parts
3A–3D already established, this Part does not add a `<script>` tag
for itself to `automation.html`; wiring the Step 7 stack into a page is
left to whichever future part is scoped to do that.

## Regression Coverage Added

- load-order guards (refuses to install without `AxiomOrchestrator`,
  `AxiomRuntimeContext`, or `AxiomGoalManager` present; installs
  cleanly and edits none of its dependencies both WITH the full Part
  3C/3D stack present and with ONLY `goal-manager.js` present)
- manually-driven goals (no Decision Engine/Bridge loaded) are
  recorded on completion, failure, cancellation, and retry, correctly
  attributing a retry to the ORIGINAL goal's strategy
  (`goalmgr_retried`'s `retryOf`)
- a goal with no capability metadata is grouped under the fixed
  `'general'` key — never an invented per-goal key
- autonomously-executed goals (full Part 3C/3D stack) are recorded via
  `goal-manager.js`'s own events, including exhausted-retry tracking
  (Part 3D enrichment) — and exhausted-retry tracking is simply absent
  (no throw) when Part 3D is not loaded
- `getStrategyStats()` for a never-seen strategy returns a neutral
  0.5 score / zero-sample snapshot; the score is verified to be an
  exact, hand-computable Laplace-smoothed proportion, not an opaque
  model output
- `listStrategyStats()` sorts most-successful-first;
  `listFailingStrategies()` only returns strategies at/above a caller
  threshold
- `recommendGoalOrder()` reorders two independent, same-priority goals
  toward the historically stronger strategy; never reorders across
  priority tiers; never violates a real dependency edge; a
  high-enough `setSwapThreshold()` is a true no-op (churn control)
- `optimizeGoalScheduling()` queues goals in the learned order and
  reports blocked goals exactly like `runGoalScheduler()`
- `getRecommendedPriority()` declines with too little history; bucket
  s HIGH for a strong track record and LOW for a poor one;
  `applyRecommendedPriority()` actually calls `setGoalPriority()` and
  emits `goalmgrlearn_priority_applied`, and is a no-op when already
  at the recommendation
- `getLearningMetrics()` folds in the real `getGoalMetrics()` /
  `getContextMetrics()` results (and `getDecisionMetrics()` /
  `getExecutionMetrics()` when those modules are loaded) without
  re-deriving any of them
- every read-path result is frozen; input validation on
  `setSwapThreshold()` / `setMinSamplesForRecommendation()`;
  `getExecutionHistory()` filtering/limit behavior

## Regression Results

`node test-evidence/block2-step7-part3e-goal-manager-learning-regression-suite.js`
— 35/35 passing. Every other suite under `test-evidence/` was re-run
unmodified after this change; results are unchanged from Part 3D's own
run (all still-runnable suites pass; the same five suites that already
failed on missing `jsdom` in this sandbox before this Part still fail
identically, for the identical pre-existing reason — none of them load
any file this Part touches). Full findings in
`STEP7_PART3E_VALIDATION.md`.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 7 · Part 3D: Decision Engine -> Autonomous Task Planner Execution Bridge

**Date:** 2026-08-03
**Scope:** One new file added
(`os/core/decision-engine-execution-bridge.js`,
`window.AxiomDecisionEngineExecutionBridge`), zero existing files
modified. Reuses Step 7 Part 2's Task Planner
(`os/core/task-planner.js`), Part 3A/3B's Goal Manager
(`os/core/goal-manager.js`), and Part 3C's Decision Engine
(`os/core/autonomous-decision-engine.js`) entirely through their
existing public APIs. One new regression suite added
(`test-evidence/block2-step7-part3d-execution-bridge-regression-suite.js`,
24/24 passing). All prior applicable suites re-run unmodified and
still pass; see `STEP7_PART3D_VALIDATION.md` for the full run.

## What this Part is

The connective layer requested between Part 3C's Decision Engine and
Part 2's Autonomous Task Planner. Before this Part, admitting a goal
(`AxiomDecisionEngine.admitGoal()` / `runDecisionCycle()`) only ever
flipped its status to Running — nothing then turned that goal into
actual work, and nothing ever reported the outcome back. This module
closes that gap and nothing else:

- **Automatically executes selected goals** — listens for the Decision
  Engine's own `decisionengine_admitted` event and, for every goal it
  fires for, automatically dispatches it. No caller action required
  beyond running the Decision Engine as already documented.
- **Converts goals into executable task plans** — by calling
  `AxiomOrchestrator.executeGoal(goal.description || goal.title)`,
  Part 2's own installed entry point. Decomposition, capability
  matching, sequencing/parallelism, and dispatch are 100%
  `task-planner.js`'s existing logic.
- **Triggers the existing Task Planner** — via `executeGoal()`/
  `cancelGoal()`/`retryGoal()`/`getGoalStatus()`, the same four methods
  `task-planner.js` already installs onto `AxiomOrchestrator` for any
  external caller. None of Part 2's decomposition, dispatch, retry, or
  Runtime Context logic is reimplemented.
- **Monitors execution & tracks progress** — listens to `task-planner.js`'s
  own `goal_task_*` events, re-reads the authoritative plan snapshot via
  `getGoalStatus()`, and mirrors task counts onto the Goal Record.
- **Handles retries and failures** — on a failed plan, retries the
  whole GOAL (not just its failed clauses — Part 2's own `retryGoal()`
  already does that at the plan level) as a fresh Goal Record via
  `AxiomGoalManager.retryGoal()`, bounded by a configurable
  `setMaxExecutionRetries()` (default 2, overridable per-goal via
  `metadata.maxRetries`). Retries are re-admitted through
  `AxiomDecisionEngine.admitGoal()` — never a bypass of its own
  eligibility checks. Exhausted retries are left Failed and reported
  via `decisionengine_execution_exhausted`, never silently dropped.
- **Updates Runtime Context** — exclusively as a side effect of
  `AxiomGoalManager.updateGoalMetadata()`, which already syncs the Goal
  Record's own Runtime Context. This module never references
  `AxiomRuntimeContext` directly (verified by regression test).
- **Publishes execution events** — `decisionengine_execution_started`,
  `_progress`, `_completed`, `_failed`, `_cancelled`, `_retry`, and
  `_exhausted`, all on the same shared Event Bus every other module in
  this stack already publishes to.

No goal-type, capability, or agent-id table exists anywhere in this
file — every decision it makes is a live read over the Goal Record,
the plan snapshot, or a caller-set knob.

## Files changed

| File | Change |
|---|---|
| `os/core/decision-engine-execution-bridge.js` | **New.** `window.AxiomDecisionEngineExecutionBridge`. |
| `CHANGELOG.md` | New entry prepended (this one). Nothing else in the file altered. |
| `test-evidence/block2-step7-part3d-execution-bridge-regression-suite.js` | **New.** 24 assertions. |
| `STEP7_PART3D_VALIDATION.md` | **New.** |

No other file in the project was modified. `os/core/orchestrator.js`,
`os/core/runtime-context.js`, `os/core/capability-router.js`,
`os/core/agent-registry-integration.js`, `os/core/goal-manager.js`,
`os/core/task-planner.js`, `os/core/autonomous-decision-engine.js`,
`automation.html`, and every pre-existing regression suite file are
unchanged — verified both by this Part's regression suite (a
byte-for-byte content comparison before/after load) and manually.
Following the same convention Parts 3A–3C already established, this
Part does not add a `<script>` tag for itself (or for Part 3C, which
likewise has none yet) to `automation.html`; wiring the Step 7 stack
into a page is left to whichever future part is scoped to do that.

## Regression Coverage Added

- load-order guards (refuses to install without `AxiomOrchestrator`,
  `task-planner.js`'s installed methods, `AxiomGoalManager`, or
  `AxiomDecisionEngine` present; installs cleanly and edits none of
  its four dependencies once all are present)
- an admitted goal is automatically dispatched to the real Task
  Planner and reaches Completed; a never-admitted goal is never
  dispatched
- multi-clause goals decompose and execute sequentially through the
  real Task Planner (both agents actually invoked)
- never double-dispatches the same admitted goal
- progress is mirrored onto the Goal Record's own metadata as tasks
  complete; Runtime Context sync happens only via
  `updateGoalMetadata()`, never a direct `AxiomRuntimeContext`
  reference
- `decisionengine_execution_started` / `_progress` are published on
  the shared Event Bus
- a failed plan fails the Goal Record and publishes
  `decisionengine_execution_failed`
- goal-level retries are bounded by `setMaxExecutionRetries()`
  (module default) and by a goal's own `metadata.maxRetries`
  (per-goal override); exhausted retries publish
  `decisionengine_execution_exhausted` and leave every attempt Failed
- retries are re-admitted exclusively through
  `AxiomDecisionEngine.admitGoal()`, never a direct
  `markGoalRunning()` bypass
- `cancelExecution()` cancels the in-flight plan and the Goal Record
  ends up Cancelled exactly once; a safe no-op when there is nothing
  in flight
- non-duplication guards: dispatched task counts match
  `AxiomOrchestrator.decomposeGoal()` called directly; `dispatchGoal()`
  never transitions a Goal Record the Decision Engine hasn't admitted
- read APIs (`getExecutionForPlan()`, frozen snapshots,
  `getExecutionMetrics()`) verified accurate

`test-evidence/block2-step7-part3d-execution-bridge-regression-suite.js`:
24/24 passing.

## Full regression run (this pass)

Every suite under `test-evidence/` was re-run after this change:

- `block2-step7-part3d-execution-bridge-regression-suite.js`: 24/24 ✅ (new)
- `block2-step7-part3c-decision-engine-regression-suite.js`: 37/37 ✅
- `block2-step7-part3b-goal-scheduling-regression-suite.js`: 45/45 ✅
- `block2-step7-part3a-goal-manager-regression-suite.js`: 35/35 ✅
- `block2-step7-part2-task-planner-regression-suite.js`: 21/21 ✅
- `block2-step6-part5-runtime-context-regression-suite.js`: 42/42 ✅
- `block2-step6-part4-workflow-planner-regression-suite.js`: 29/29 ✅
- `block2-step6-part3-capability-routing-regression-suite.js`: 20/20 ✅
- `block2-step6-part2-agent-registry-integration-regression-suite.js`: 18/18 ✅
- `block2-step6-part1-orchestrator-regression-suite.js`: 21/21 ✅
- `block2-step5-part6b-error-recovery-regression-suite.js`: 15/15 ✅
- `block2-step5-part6a-browser-audit-regression-suite.js`: 7/7 ✅
- `block2-step5-part2-navigation-session-regression-suite.js`: 28/28 ✅
- `block2-step5-part1-browser-foundation-regression-suite.js`: 21/21 ✅
- `block2-step4-part4-automation-manager-regression-suite.js`: pass ✅
- `block2-step4-part3-automation-memory-integration-regression-suite.js`: pass ✅
- `block2-step4-part2-brain-automation-integration-regression-suite.js`: pass ✅
- `block2-step4-part1-automation-foundation-regression-suite.js`: 17/17 ✅
- `block2-step3-part3-memory-manager-regression-suite.js`: 30/30 ✅
- `block2-step3-part2-memory-integration-regression-suite.js`: pass ✅
- `block2-step3-part1-memory-foundation-regression-suite.js`: pass ✅
- `block2-step2-part2-brain-integration-regression-suite.js`: pass ✅
- `milestone11-regression-suite.js`: 41/41 ✅
- `milestone12-regression-suite.js`: 19/19 ✅
- `milestone13-regression-suite.js`: 46/46 ✅
- `milestone14-part1-regression-suite.js`: 58/58 ✅
- `phase9-part1-static-audit-suite.js`: 1381/1381 ✅

Five suites (`block2-step1-coding-agent-regression-suite.js`,
`block2-step1-part2-pipeline-regression-suite.js`,
`milestone5-regression-suite.js`, `milestone6-regression-suite.js`,
`milestone10-regression-suite.js`) fail to even start in this sandbox
with `MODULE_NOT_FOUND: jsdom` — a missing `devDependency` in this
environment, not listed in `package.json` and unrelated to this
change: none of them load `goal-manager.js`, `task-planner.js`,
`autonomous-decision-engine.js`, or this Part's new file at all, and
the same five fail identically with this Part's file removed. Flagged
here rather than silently skipped; not something in scope for this
Part to fix.

## What Was Preserved

- Every Part 2/3A/3B/3C guarantee — unchanged. This Part is additive
  only: it subscribes to existing Event Bus events and calls existing
  public methods; it edits no other file.
- Snapshot immutability (`deepFreeze` on every read path this module
  exposes) — consistent with the rest of the Step 7 stack.
- The "no hardcoded workflow" guarantee — this file contains no
  goal-type, capability, or agent-id literal.
- All existing Step 6 and Step 7 regression suites — still passing
  unmodified.

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 7 · Part 3C: Autonomous Decision Engine

**Date:** 2026-08-03
**Scope:** One new file added (`os/core/autonomous-decision-engine.js`,
`window.AxiomDecisionEngine`), zero existing files modified. Reuses
Step 6's Runtime Context (`os/core/runtime-context.js`) and Capability
Router (`os/core/capability-router.js`) and Step 7 Part 3A/3B's Goal
Manager (`os/core/goal-manager.js`) entirely through their existing
public APIs. One new regression suite added
(`test-evidence/block2-step7-part3c-decision-engine-regression-suite.js`,
37/37 passing). All prior applicable suites re-run unmodified and
still pass; see `STEP7_PART3C_VALIDATION.md` for the full run.

## What this Part is

An autonomous decision layer that automatically selects "the next
goal" by evaluating, on every call, entirely from live state:

- **Active goals & dependencies** — via `AxiomGoalManager`'s existing
  `getGoalExecutionOrder()` / `isGoalBlocked()` / `getGoal()`.
- **Runtime Context** — via `AxiomRuntimeContext.getActiveContexts()`
  / `getContextMetrics()`, the live in-flight-context count used as
  the system-load signal.
- **Dependencies** — a goal blocked on an unresolved prerequisite is
  never selected; an independent branch behind a blocked goal (e.g. a
  diamond dependency) is still considered rather than the whole scan
  stopping at the first ineligible candidate.
- **Available agents** — via `AxiomOrchestrator.listAgents()` /
  `discoverAgents()`, read-only, only to distinguish "no agent for
  this capability at all" from "agents exist but none are eligible
  right now" in the diagnostic reason string.
- **Capabilities** — the capability a goal needs is read off the
  goal's own `metadata.capability` (or `metadata.requiredCapability`)
  — never a literal in this file. A capability with zero agents
  registered for it is simply not yet satisfiable; registering a
  matching agent at runtime makes previously-ineligible goals eligible
  with no code change, verified by regression test.

No hardcoded workflow exists anywhere in this file: there is no
goal-type -> capability table, no capability -> agent-id table, and no
fixed multi-step sequence. Agent selection for a required capability
is delegated entirely to `AxiomCapabilityRouter.selectAgent()` — the
exact health/availability/workload/priority-ranked logic real dispatch
already uses — so this module's notion of "an agent is available" can
never disagree with what would actually happen if the goal were
routed.

## New file

- **`os/core/autonomous-decision-engine.js`** — same load-order-guard
  and standalone-global posture every Block 2 `os/core/*.js` module
  already uses (requires `AxiomOrchestrator`, `AxiomRuntimeContext`,
  `AxiomGoalManager`, and `AxiomCapabilityRouter` loaded first; installs
  nothing onto `AxiomOrchestrator`, exactly like `goal-manager.js`
  already documents and for the identical collision-avoidance reason).

  - **PART A** — shared local helpers (`isPlainObject`, `deepFreeze`,
    ...), no shared mutable state imported from elsewhere.
  - **PART B — Runtime Context evaluation**: `getSystemLoad()` (a pure
    read: running-goal count + live active-context count/peak from the
    real Runtime Context registry), `setMaxConcurrentGoals(n)` /
    `getMaxConcurrentGoals()` — an optional, caller-set concurrency
    ceiling (default: unbounded; this module never hardcodes a
    concurrency limit).
  - **PART C — Capability & agent evaluation**: `resolveGoalCapability()`
    (reads goal metadata only), `resolveGoalAgent()` (delegates to
    `AxiomCapabilityRouter.selectAgent()`, distinguishes "no agent
    registered for this capability" from "agents registered but none
    eligible" for a clearer decision trail).
  - **PART D — Single-goal evaluation**: `evaluateGoal(goalId)` — one
    deep-frozen diagnostic combining goal-graph eligibility (blocked/
    paused/terminal/not-yet-schedulable), capability/agent
    availability, and system-load capacity into a single `eligible`
    boolean plus a human-readable `reason`.
  - **PART E — Ranking & selection**: `rankCandidateGoals(filter)`
    (reuses Part 3B's own `getGoalExecutionOrder()` for ordering — no
    second ordering scheme), `selectNextGoal(filter)` (first fully
    eligible candidate in that order, or `null`).
  - **PART F — Admission**: `admitGoal(goalId)` composes Part 3B's own
    `scheduleGoal()` / `markGoalRunning()` — the identical two calls an
    external caller already had to make by hand — never drives
    `transitionGoal()` directly and never duplicates status-machine
    logic.
  - **PART G — Decision cycle & history**: `runDecisionCycle(filter)`
    — the single autonomous entry point: reuses Part 3B's
    `runGoalScheduler()` to admit every unblocked Pending/Waiting goal
    into the queue, then selects and admits ONE goal into Running via
    Part F. `getDecisionHistory(limit)` / `getDecisionMetrics()` — a
    bounded, append-only decision log and counters, same discipline
    `goal-manager.js`/`runtime-context.js` already use for their own
    history/metrics.

  New events on the existing Orchestrator Event Bus, all prefixed
  `decisionengine_` (own namespace, no collision with `goalmgr_*` or
  bare `goal_*`): `decisionengine_admitted`, `decisionengine_deferred`,
  `decisionengine_idle`, `decisionengine_cycle_complete`.

## Non-duplication verification

- **`os/core/goal-manager.js`** — not edited. This module never calls
  `transitionGoal()` directly; every status change goes through
  `scheduleGoal()`/`markGoalRunning()`, verified by test to still
  produce exactly the `pending -> queued -> running` history
  `goal-manager.js`'s own machine already produces unassisted.
- **`os/core/capability-router.js`** — not edited. Agent selection is
  never re-implemented; `evaluateGoal()`'s `agentId` is verified by
  test to be byte-identical to a direct
  `AxiomCapabilityRouter.selectAgent()` call for the same capability.
- **`os/core/runtime-context.js`** — not edited. No new Runtime
  Context records are created by this file; it only reads
  `getActiveContexts()`/`getContextMetrics()`, the same records
  `goal-manager.js` already creates one-per-goal.
- **`os/runtime/scheduler/task-scheduler.js`** — not referenced,
  imported, or loaded. This remains the one real agent-runtime job
  scheduler in the stack; this module's "decision cycle" only ever
  drives a goal's own status via the calls above, never a job queue.
- No second queue, no second status machine, no second event
  namespace, no goal-type/capability/agent hardcoded table anywhere in
  this file.


# AXIOM — Phase 10 · Part 2 · Block 2 · Step 7 · Part 3B: Autonomous Goal Management System — Scheduling & Prioritization

**Date:** 2026-08-03
**Scope:** One existing file extended (`os/core/goal-manager.js`), zero
files replaced. No Part 3A code was deleted or rewritten — every new
part (F–J below) was appended alongside the untouched Part A–E
foundation, and `snapshotGoal()` was extended (additive fields only)
to surface the new state. One new regression suite added
(`test-evidence/block2-step7-part3b-goal-scheduling-regression-suite.js`,
45/45 passing). Part 3A's own suite was re-run byte-for-byte unmodified
and still passes 35/35.

## Why this stays inside `goal-manager.js`, and nothing else

Before writing any code, the existing scheduler/planner surface area
was re-audited:

- `os/runtime/scheduler/task-scheduler.js` already owns
  `window.AxiomTaskScheduler`, a real job scheduler for
  `AxiomAgentRuntime`/`AxiomJobManager` work — a different subsystem,
  different queue, different lifecycle. Not touched, not reused, not
  duplicated.
- `os/core/task-planner.js` (Step 7 Part 2) already owns its own
  `planGoal`/`executeGoal`/`cancelGoal`/`retryGoal` for its flat,
  single-run "goal plan" concept, installed directly onto
  `AxiomOrchestrator`. Still not touched.
- `os/core/workflow-planner.js` and `os/core/capability-router.js`
  still own hand-authored stage graphs and capability
  dispatch/failover respectively. Still not touched.

None of those own **scheduling/prioritization of the durable,
hierarchical goal record** Part 3A introduced. That gap — priority
levels, a goal queue, dependency tracking with circular-dependency
detection, automatic goal ordering, scheduling, pause/resume,
cancel/retry, and duplicate-goal prevention, all scoped to
`AxiomGoalManager`'s own goal record — is the entire, real scope of
this Part. It is implemented as five new parts inside the same file
(`os/core/goal-manager.js`), reusing the exact registry
(`goalsById`), snapshot (`snapshotGoal`), event bus
(`Orchestrator.emit`), and status transition machine
(`transitionGoal`) Part 3A already built — no second queue, no second
scheduler, no second status machine, no second event namespace.

## Extended file

- **`os/core/goal-manager.js`** — same `window.AxiomGoalManager`
  global, same load-order guards, same standalone-global posture (still
  installs nothing onto `AxiomOrchestrator`). New surface:

  - **PART F — Priority levels**: `GOAL_PRIORITY` (`LOW:1, NORMAL:5,
    HIGH:8, CRITICAL:10`, a closed enum — same posture as
    `GOAL_STATUS`). `createGoal({ priority })` defaults to `NORMAL` and
    rejects any value outside the enum. `setGoalPriority(goalId,
    priority)` re-prioritizes a non-terminal goal.
  - **PART G — Dependency tracking & circular dependency detection**:
    `addGoalDependency(goalId, dependsOnGoalId)` /
    `removeGoalDependency(...)` maintain a `dependsOn`/`dependents`
    edge index alongside `childIndex` (same "external map next to the
    registry" shape, nothing stored as loose fields on the goal
    record). Self-dependency and any direct or transitive cycle is
    refused with a thrown error and the graph is left unmodified — a
    DFS from the proposed prerequisite checks whether the dependent
    goal is already reachable before the edge is added.
    `getGoalDependencies(goalId)` reports each prerequisite's live
    `satisfied` state; `isGoalBlocked(goalId)` is true while any
    dependency isn't `Completed`.
  - **PART G (cont.) — Automatic goal ordering**:
    `getGoalExecutionOrder(filter)` — Kahn's-algorithm topological
    sort over non-terminal goals honoring `dependsOn` edges, tie-broken
    by priority (desc) then `createdAt` (asc). A pure, computed read
    over the existing registry — no separate ordering structure is
    kept in sync, same discipline `listGoals()` already established.
  - **PART H — Goal queue & scheduling**: `getGoalQueue()` — the
    `Queued` goals ordered by priority then age, computed on read
    (not a second array to keep in sync with `transitionGoal`).
    `enqueueGoal(goalId)`, `dequeueNextGoal()` (pops the queue head and
    calls `markGoalRunning` on it — reuses the real transition
    machine), `scheduleGoal(goalId)` (admits an unblocked
    Pending/Waiting goal to `Queued`, or parks a blocked one in
    `Waiting`), and `runGoalScheduler(filter)` (drives every eligible
    goal through `scheduleGoal` in automatic-ordering order).
  - **PART I — Pause / Resume / Cancel / Retry**: `pauseGoal(goalId,
    reason)` (Running/Queued → Waiting, flagged `isPaused`),
    `resumeGoal(goalId)` (Waiting → Queued, only for a goal `pauseGoal`
    parked — refuses a dependency-blocked Waiting goal with a pointer
    to `scheduleGoal`/`runGoalScheduler` instead, so the two "why is
    this Waiting" reasons never get silently conflated).
    `cancelGoal` is Part 3A's own function, untouched. `retryGoal(goalId,
    options)` requires a `Failed`/`Cancelled` goal and creates a
    **new** goal (never resurrects the terminal record — terminal
    statuses still have zero outgoing transitions) carrying forward
    title/description/metadata/parentId/priority and the original's
    dependency edges, linked back via `retryOf`/`retryCount`.
  - **PART J — Duplicate goal prevention**: `createGoal({ dedupeKey
    })` is opt-in and backward-compatible (omit it, nothing changes).
    A second `createGoal` call with the same `(parentId, dedupeKey)`
    while the first is still non-terminal returns the **existing**
    goal (flagged `duplicate: true`) instead of minting a second one;
    once the original reaches a terminal status, the key is free
    again.
  - `snapshotGoal()` gained additive, backward-compatible fields:
    `priority`, `dependsOn`, `dependents`, `isPaused`, `pausedAt`,
    `pauseReason`, `dedupeKey`, `retryOf`, `retryCount`. No existing
    field was renamed, removed, or reshaped.
  - `TRANSITIONS[PENDING]` gained one new legal edge, `PENDING ->
    WAITING`, so a dependency-blocked goal that was never queued can be
    parked without a fake `Queued`/`Running` detour. Every other edge
    in the transition table (and therefore every Part 3A illegal-
    transition guarantee) is unchanged.

## Non-duplication verification

- **`os/runtime/scheduler/task-scheduler.js`** — not referenced,
  imported, or loaded by this file. `getGoalQueue()`/`scheduleGoal()`/
  `runGoalScheduler()` operate purely over `AxiomGoalManager`'s own
  `goalsById` registry; no job/agent-runtime queue is touched or
  reimplemented.
- **`os/core/task-planner.js`** — not required to load, and this Part
  still installs nothing onto `AxiomOrchestrator`, so it cannot collide
  with `task-planner.js`'s own `planGoal`/`executeGoal`/`cancelGoal`/
  `retryGoal`. Verified directly: a test asserts
  `AxiomOrchestrator.scheduleGoal`/`addGoalDependency` stay `undefined`
  after Part 3B loads.
- **`os/core/workflow-planner.js` / `os/core/capability-router.js`** —
  not referenced, imported, or loaded by this file. No stage-graph or
  dispatch/failover logic exists here.
- **Runtime Context** — Part 3B introduces zero new
  `AxiomRuntimeContext` calls; it drives status changes exclusively
  through Part 3A's existing `transitionGoal()`, which already
  syncs/finalizes the goal's one Runtime Context record. `retryGoal()`
  creates its follow-up goal via the existing `createGoal()`, so the
  new goal gets its own context the same way every goal always has.

## Regression suite

`test-evidence/block2-step7-part3b-goal-scheduling-regression-suite.js`
— 45/45 assertions passing. Covers: priority defaults/validation/
mutation, queue ordering and exclusion, enqueue/dequeue (including the
empty-queue case), dependency add/remove/idempotency/self-dependency/
unknown-goal rejection, satisfied-flag transitions, direct and
transitive circular dependency rejection (graph left unmodified on
refusal), automatic ordering (simple, satisfied-dependency, no-
dependency/priority-only, and diamond-graph cases), scheduling
(unblocked admission, blocked parking, re-admission after the
dependency resolves, and the batch scheduler), pause/resume happy path
and both refusal cases (wrong status; Waiting-but-not-paused), cancel
(proving Part 3A's function is untouched), retry (Failed and Cancelled
sources, rejection of a non-terminal goal, dependency-edge carry-
forward, chained retryCount), duplicate prevention (same-key reuse,
per-parent scoping, terminal-frees-the-key, and the no-dedupeKey
default), snapshot immutability, the "installs nothing onto
Orchestrator" guarantee, and that every new event fires.

## Bug found and fixed during this pass's own testing

**Defect:** none in `os/core/goal-manager.js` itself.

**Test-file-only issue caught and fixed:** three assertions in the new
suite used `assert.deepStrictEqual(order, [id])`/`([id, id])` against
arrays derived from `.map()` over deep-frozen snapshots. Node's
`assert` module reports these as "Values have same structure but are
not reference-equal" — the exact same quirk Part 3A's own validation
report already documented and fixed for its immutability test.
Replaced with explicit `.length` + index equality checks. No product
code was involved; verified by re-running the suite after the fix
(45/45 passing) and confirming the underlying ordering/dependency
logic itself was correct throughout (the failing assertions'
diagnostic output showed the actual array contents already matched
expectations).

## Full regression run (existing suites, applicable to this stack)

Re-run after this change, in the same sandbox:

| Suite | Result |
|---|---|
| `block2-step6-part1-orchestrator-regression-suite.js` | 21/21 passing |
| `block2-step6-part2-agent-registry-integration-regression-suite.js` | 18/18 passing |
| `block2-step6-part3-capability-routing-regression-suite.js` | 20/20 passing |
| `block2-step6-part4-workflow-planner-regression-suite.js` | 29/29 passing |
| `block2-step6-part5-runtime-context-regression-suite.js` | 42/42 passing |
| `block2-step7-part2-task-planner-regression-suite.js` | 21/21 passing |
| `block2-step7-part3a-goal-manager-regression-suite.js` (unmodified) | 35/35 passing |
| `block2-step7-part3b-goal-scheduling-regression-suite.js` (new) | 45/45 passing |
| `block2-step2-part2-brain-integration-regression-suite.js` | all passing |
| `block2-step3-part1-memory-foundation-regression-suite.js` | all passing |
| `block2-step3-part2-memory-integration-regression-suite.js` | all passing |
| `block2-step3-part3-memory-manager-regression-suite.js` | 30 passed, 0 failed |
| `block2-step4-part1-automation-foundation-regression-suite.js` | 17 passed, 0 failed |
| `block2-step4-part2-brain-automation-integration-regression-suite.js` | all passing |
| `block2-step4-part3-automation-memory-integration-regression-suite.js` | all passing |
| `block2-step4-part4-automation-manager-regression-suite.js` | all passing |
| `block2-step5-part1-browser-foundation-regression-suite.js` | 21 passed, 0 failed |
| `block2-step5-part2-navigation-session-regression-suite.js` | 28 passed, 0 failed |
| `block2-step5-part6a-browser-audit-regression-suite.js` | 7 passed, 0 failed |
| `block2-step5-part6b-error-recovery-regression-suite.js` | 15 passed, 0 failed |
| `milestone11-regression-suite.js` | 41/41 passing |
| `milestone12-regression-suite.js` | 19/19 passing |
| `milestone13-regression-suite.js` | 46/46 passing |
| `milestone14-part1-regression-suite.js` | 58/58 passing |
| `phase9-part1-static-audit-suite.js` | 1379/1379 passing |

**Pre-existing, unrelated failures (not caused by this change):**
`block2-step1-coding-agent-regression-suite.js`,
`block2-step1-part2-pipeline-regression-suite.js`,
`milestone5-regression-suite.js`, `milestone5-manual-commands.js`,
`milestone6-regression-suite.js`, and `milestone10-regression-suite.js`
each fail identically with `Cannot find module 'jsdom'` — a sandbox
dependency not installed in this environment, unrelated to
`goal-manager.js`. Confirmed none of the six reference
`os/core/goal-manager.js`, and this is the same class of pre-existing
failure Part 3A's own validation report already documented for four of
these six suites. Out of scope per "fix only verified defects" — a
missing sandbox dependency is not a defect in the Goal Management
System.

## Deliberately out of scope for Part 3B

- Automatic goal decomposition (free text → sub-goals/tasks) — still
  `task-planner.js`'s `decomposeGoal()`, untouched.
- Actually *executing* a scheduled/dequeued goal's underlying work —
  `dequeueNextGoal()`/`scheduleGoal()` drive the goal's own status
  machine (exactly what a caller driving `markGoalRunning()` by hand
  already did in Part 3A); wiring that to real dispatch stays
  `capability-router.js`'s job.
- Any retention/archival policy for terminal or retried goals — a
  retried goal's original terminal record is kept forever, same
  no-eviction policy Part 3A already committed to.
- A priority *decay*/aging policy (e.g. auto-promoting a goal that's
  been queued too long) — `getGoalQueue()`'s ordering is a pure,
  static function of the priority and `createdAt` recorded at
  creation/`setGoalPriority()` time.

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 7 · Part 3A: Autonomous Goal Management System — Foundation

**Date:** 2026-08-03
**Scope:** One new file added (`os/core/goal-manager.js`), one script
tag added to `automation.html`. No existing file's logic was modified.
One new regression suite added (`test-evidence/block2-step7-part3a-
goal-manager-regression-suite.js`, 35/35 passing). One real bug found
and fixed during this pass's own testing (below).

## Why this file, and nothing else

Before writing any code, the existing "goal" surface area was audited
end to end:

- `os/core/task-planner.js` (Step 7 Part 2) already turns ONE free-text
  goal into a flat, capability-routed task list (`planGoal`/
  `executeGoal`), with its own `GOAL_STATUS` (`planned`/`running`/
  `completed`/`failed`/`cancelled`) scoped to that single run.
- `os/core/runtime-context.js` (Step 6 Part 5) already owns the one
  real ephemeral execution-state/context engine, with its own
  `CONTEXT_STATUS` state machine and parent/child contexts.
- `os/core/workflow-planner.js` (Step 6 Part 4) already runs hand-
  authored, sequential-only stage graphs.
- `os/core/capability-router.js` (Step 6 Part 3) already resolves and
  dispatches a single capability request, with retry/failover.

None of those own a **durable, hierarchical goal record**: a goal with
a stable id, real parent/child sub-goals, caller-attached metadata,
and a lifecycle a caller can drive independent of whether that goal is
ever decomposed into capability-routed tasks at all. That gap — Goal
data model, IDs, parent/child goals, metadata, the seven-state status
model (Pending/Queued/Running/Waiting/Completed/Failed/Cancelled), a
Goal Registry, and a Goal History — is the entire, real scope of this
Part. Decomposition, dispatch, retry/failover, and multi-stage
execution are explicitly **not** re-implemented; they stay exactly
where Step 6/7 already put them.

## New file

- **`os/core/goal-manager.js`** — exposes `window.AxiomGoalManager`.
  Requires `orchestrator.js` (Event Bus) and `runtime-context.js`
  already loaded; refuses to install (logs and returns) otherwise,
  same convention every other Part in this stack follows.
  - **Goal data model**: `{ id, parentId, childIds, title,
    description, metadata, status, contextId, result, error,
    createdAt, updatedAt, startedAt, finishedAt }`. Every read returns
    a deep-frozen snapshot — the live record in the registry never
    leaks out directly, same discipline as `runtime-context.js`'s
    `snapshot()`.
  - **Goal creation / IDs**: `createGoal(options)` — a monotonic
    `goal_<timestamp>_<counter>` id, same shape as `runtime-context.js`'s
    own `makeId()`.
  - **Parent/child goals**: `createChildGoal(parentId, options)`,
    `getChildGoals(goalId)`, `getParentGoal(goalId)`. `createGoal()`
    rejects an `options.parentId` that doesn't exist rather than
    silently creating an orphaned link.
  - **Goal metadata**: arbitrary JSON-safe data on every goal;
    `updateGoalMetadata(goalId, patch)` merges into existing metadata
    without dropping other keys, and is rejected (loudly) for
    non-JSON-safe input — see "Bug found and fixed" below.
  - **Goal status** — all seven required states, with a validated
    transition table (illegal transitions are refused with
    `{ success:false }`, never silently coerced, same posture
    `runtime-context.js`'s `CONTEXT_STATUS` transitions already hold):
    `Pending -> Queued -> Running -> {Waiting, Completed, Failed,
    Cancelled}`, with `Waiting -> Queued` so a blocked goal can be
    re-admitted without ever pretending it kept running while blocked.
    Convenience wrappers: `markGoalQueued`, `markGoalRunning`,
    `markGoalWaiting`, `completeGoal`, `failGoal`, `cancelGoal`, plus
    the generic `transitionGoal(goalId, status, detail)`.
  - **Goal Registry**: `goalsById` (module-private) plus
    `getGoal`/`listGoals(filter)`/`getChildGoals`/`getParentGoal`.
    Unlike Runtime Context's active/archived split, goals are durable
    records — this Part never evicts a goal, terminal or not (a
    deliberate policy choice, left open rather than guessed at for a
    future part).
  - **Goal History**: a bounded (2000-entry), append-only log of every
    `created` / `transition` / `metadata_updated` event across every
    goal that has ever existed, independent of (and outliving) any
    single goal's current state — `getGoalHistory(filter, limit)`.
  - **Runtime Context integration**: exactly one real
    `AxiomRuntimeContext` record per goal, created alongside the goal
    (`createGoalRuntimeContext`), synced on every status/metadata
    change (`syncGoalRuntimeContext`), and finalized + destroyed once
    the goal reaches a terminal status (`finalizeGoalRuntimeContext`)
    — the identical create/sync/finalize/destroy shape
    `task-planner.js`'s own `createGoalContext`/`syncGoalContext`/
    `finalizeGoalContext` already established for goal-shaped work.
    Every call goes straight through the real, unmodified
    `os/core/runtime-context.js` public API; none of its own
    lifecycle/clone/freeze/transition-validation logic is
    reimplemented here.
  - **Event Bus**: publishes on the existing `AxiomOrchestrator`
    Event Bus (`emit`/`on`), namespaced `goalmgr_*` (`goalmgr_created`,
    `goalmgr_child_created`, `goalmgr_queued`, `goalmgr_running`,
    `goalmgr_waiting`, `goalmgr_completed`, `goalmgr_failed`,
    `goalmgr_cancelled`, `goalmgr_metadata_updated`) — see "Naming
    decisions" below for why not the bare `goal_*` names.

## Naming decisions (read before extending this file)

`task-planner.js` already fully claims the "Goal" namespace on the
shared `AxiomOrchestrator` singleton — `.planGoal`, `.executeGoal`,
`.cancelGoal`, `.retryGoal`, `.getGoalStatus`, `.getGoalTasks`,
`.listGoals`, `.GOAL_STATUS`, `.GOAL_TASK_STATE` — for its own,
differently-shaped "goal plan" concept (a flat, single-run task list
keyed by `planId`). This module's "goal" is a different, hierarchical,
long-lived record keyed by `goalId`. Reusing any of those names on
`Orchestrator` — even `cancelGoal`, even `listGoals`, even
`GOAL_STATUS` — would silently overwrite or be silently blocked by
`task-planner.js`'s own install, exactly the class of bug
`RUNTIME_CONTEXT.md`'s FIX 4 ("Naming Collision") already documents
and fixes for `createContext`.

Rather than invent a second set of awkwardly-prefixed Orchestrator
method names to dodge that, **`goal-manager.js` installs nothing onto
`AxiomOrchestrator` at all.** It is reachable only as
`window.AxiomGoalManager`, and reaches the Event Bus / Runtime Context
the same way any external caller would — through
`AxiomOrchestrator.emit`/`on` and `AxiomRuntimeContext`'s public API —
never by mutating `Orchestrator`'s own surface. For the same reason,
every event this module publishes is prefixed `goalmgr_` rather than
the bare `goal_*`/`goal_task_*` names `task-planner.js` already emits
on the same shared bus.

Verified directly: `test-evidence/block2-step7-part3a-goal-manager-
regression-suite.js` loads `goal-manager.js` and `task-planner.js` in
the same sandbox and asserts (a) neither module's `Orchestrator`
surface is touched by the other, (b) `goalmgr_completed` and
`task-planner.js`'s `goal_completed` never cross-fire for the same
piece of work, and (c) `task-planner.js`'s own pre-existing regression
posture (`route`, `enqueue`, `TASK_STATUS`) is unaffected by
`goal-manager.js` being loaded alongside it.

## Bug found and fixed during this pass's own testing

**`safeClone()` silently dropped non-JSON-safe metadata instead of
rejecting it.** The first implementation was a bare
`JSON.parse(JSON.stringify(value))` wrapped in try/catch — but, as
`RUNTIME_CONTEXT.md`'s own FIX 5 already documents for the exact same
pattern in `runtime-context.js`'s history, `JSON.stringify()` does not
throw for functions, symbols, or `undefined` values inside an object —
it silently drops them. A regression test
(`updateGoalMetadata(): rejects non-JSON-safe metadata instead of
silently corrupting it`) caught this immediately: passing
`{ fn: function () {} }` returned success with the key quietly
missing, instead of failing. Replaced with `assertJsonSafe()`, a
recursive validator (mirroring `runtime-context.js`'s own) that walks
the value first and throws a descriptive, `nonSerializable`-flagged
error for functions/symbols/bigints/`undefined`/circular references
before any clone is attempted — the same "fail loudly" posture
`runtime-context.js` already committed to.

## `automation.html`

One script tag added, immediately after `os/core/task-planner.js`:

```html
<script defer src="os/core/goal-manager.js"></script>
```

Same load-order convention as every other Part in this stack:
`orchestrator.js` and `runtime-context.js` (both already above it) are
its only hard dependencies; it does not require and does not touch
`capability-router.js`, `agent-registry-integration.js`,
`workflow-planner.js`, or `task-planner.js`.

## Regression Coverage Added

`test-evidence/block2-step7-part3a-goal-manager-regression-suite.js`
— 35/35 passing:
- load-order guards (refuses to install without `orchestrator.js` /
  `runtime-context.js`) and confirmation that nothing is installed
  onto `AxiomOrchestrator`
- goal creation, unique ids, default status/title, JSON-safe metadata
  storage, deep-frozen snapshot immutability
- parent/child linkage both directions, rejection of an unknown
  `parentId`, root-only listing
- metadata merge semantics and the non-JSON-safe rejection above
- full happy-path lifecycle (Pending → Queued → Running → Completed),
  a Waiting → Queued round-trip, Failed and early-Cancelled paths
- illegal transitions refused from a terminal status and from a
  skipped-Queued attempt, with no goalmgr event ever emitted for a
  refused transition
- unknown goal id / unknown status string both throw
- Goal Registry filtering by status/parentId/rootOnly, and terminal
  goals staying queryable (never evicted by this Part)
- Goal History ordering (most-recent-first), filtering, and limiting
- Runtime Context integration: one context per goal, state/metadata
  sync on every change, finalize+destroy on Completed and on
  Cancelled, independent contexts for parent vs. child goals
- Event Bus: `goalmgr_created`/`goalmgr_child_created` on creation,
  exactly one `goalmgr_<status>` per transition in order, no event
  for a refused transition
- `getGoalMetrics()` totals/byStatus across a mixed batch
- three collision/isolation checks with `task-planner.js` loaded in
  the same sandbox (see "Naming decisions" above)

## What Was Preserved

`os/core/orchestrator.js`, `os/core/runtime-context.js`,
`os/core/capability-router.js`, `os/core/agent-registry-integration.js`,
`os/core/workflow-planner.js`, and `os/core/task-planner.js` are none
of them edited by this pass. Every existing regression suite for those
files was re-run unmodified after this change:

- `block2-step6-part1-orchestrator-regression-suite.js`: 21/21 passing
- `block2-step6-part2-agent-registry-integration-regression-suite.js`: 18/18 passing
- `block2-step6-part3-capability-routing-regression-suite.js`: 20/20 passing
- `block2-step6-part4-workflow-planner-regression-suite.js`: 29/29 passing
- `block2-step6-part5-runtime-context-regression-suite.js`: 42/42 passing
- `block2-step7-part2-task-planner-regression-suite.js`: 21/21 passing

Four suites in `test-evidence/` (`block2-step1-coding-agent-*`,
`block2-step1-part2-pipeline-*`, `milestone5-*`, `milestone6-*`) fail
in this sandbox with `MODULE_NOT_FOUND` for an unrelated Node
dependency that isn't installed here — verified pre-existing (they
fail identically with `goal-manager.js` absent entirely, and none of
them reference `os/core/goal-manager.js`, `automation.html`, or any
file this Part touches). Out of scope for this Part; left unmodified
per "fix only verified defects."

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 7 · Part 2: Autonomous AI Task Planning & Execution

**Date:** 2026-08-03
**Scope:** One new file added (`os/core/task-planner.js`), one script
tag added to `automation.html`. No existing file's logic was modified.
One new regression suite added (`test-evidence/block2-step7-part2-
task-planner-regression-suite.js`, 21/21 passing). Two real bugs found
and fixed during this pass's own testing (both below).

## Why this file, and nothing else

Before writing any code, the existing stack was audited end to end:

- `os/core/orchestrator.js` (Part 1) already has a full scheduler with
  automatic retries, priority admission, and lifecycle events.
- `os/core/capability-router.js` (Part 3) already resolves a single
  capability request to an agent, dispatches it through the Scheduler,
  and automatically retries + fails over to an alternate agent (up to
  2 hops) on failure.
- `os/core/runtime-context.js` (Part 5) already provides the one real
  execution-history/context system.
- `os/core/workflow-planner.js` (Part 4) already runs a **hand-
  authored** `stages` array in dependency order — but strictly one
  stage at a time (see its own Part A/B comments), and nothing
  anywhere in `os/core/*` takes a free-text goal and decides what the
  stages should be in the first place.

That last gap — automatic decomposition of a goal into tasks, plus
genuine parallel execution where the goal doesn't require ordering —
is the entire, real scope of this Part. Everything else the brief
asks for (assignment via the Agent Orchestrator + Capability Router,
retry/failure recovery, execution history, event/log integration) was
already built in Step 6 and is reused as-is, not reimplemented.

A second, separate lineage exists in this repository
(`os/runtime/intelligence/task-planner.js` + `os/runtime/intelligence/
orchestrator.js`, an "AI OS" milestone stack loaded only by
`os-shell.html`). `automation.html` — the page Step 7 Part 1 continued
— explicitly does not load it. This Part stays entirely inside the
`os/core/*` lineage Part 1–7.1 already established, and the new global
is deliberately named `AxiomAutonomousTaskPlanner` (not
`AxiomTaskPlanner`) so it can never collide with that other lineage's
existing global, even though no single page currently loads both.

## New file

- **`os/core/task-planner.js`** — installs `AxiomOrchestrator.planGoal()`,
  `.executeGoal()`, `.cancelGoal()`, `.retryGoal()`, `.getGoalStatus()`,
  `.getGoalTasks()`, `.listGoals()`, plus a standalone
  `window.AxiomAutonomousTaskPlanner`. Requires `orchestrator.js`,
  `capability-router.js`, `agent-registry-integration.js`, and
  `runtime-context.js` already loaded; refuses to install (logs and
  returns) otherwise, same convention every other Part in this stack
  follows.
  - **Goal decomposition**: splits free text into clauses on
    sequencing words/punctuation (`then`, `;`, `after that`) versus
    `and`/comma. Sequencing words chain the resulting clauses'
    tasks with `dependsOn`; `and`/comma clauses stay independent.
    Each clause is matched against whatever
    `Orchestrator.discoverCapabilities()` reports *live* — no
    capability or subsystem name is hardcoded, so a newly registered
    agent becomes plannable with zero changes to this file.
  - **Assignment/dispatch**: every task is submitted through the
    existing `Orchestrator.route()` — this file never calls
    `enqueue()` directly and never talks to an agent handler itself.
  - **Parallel + sequential execution**: a wave-scheduler
    (`tick()`) admits every task whose dependencies are satisfied in
    the same pass, so independent clauses genuinely run concurrently
    (verified by the regression suite: two agents' handlers are
    provably both in flight at once); dependent tasks wait for their
    prerequisite's terminal state first. `workflow-planner.js`'s own
    one-stage-at-a-time engine is untouched.
  - **Task states**: Pending, Waiting, Queued, Running, Completed,
    Failed, Cancelled — new at the per-task level (installed as
    `Orchestrator.GOAL_TASK_STATE`, deliberately not reusing the name
    of the pre-existing, unrelated scheduler-level `TASK_STATUS`).
  - **Failure recovery**: relies entirely on capability-router.js's
    already-existing per-task retry + alternate-agent failover; adds
    only what only makes sense at the graph level — a task whose
    dependency never completed is marked Cancelled rather than
    dispatched into a request that could never succeed, and
    `retryGoal()` re-plans and re-executes only the clauses that
    actually failed, never the ones that already succeeded.
  - **Runtime Context integration**: one real `AxiomRuntimeContext`
    per goal run, created/synced/finalized/destroyed on every exit
    path — the identical shape `workflow-planner.js`'s own Runtime
    Context integration already uses, reused rather than duplicated.

## Changed files

- `automation.html` — one `<script defer src="os/core/task-planner.js">`
  tag added, after `workflow-planner.js` and before `os/shared/
  logger.js`, with a comment documenting its dependencies. Nothing
  else in the file was changed.

## Bugs found and fixed within the new code (not pre-existing)

1. **`cancelGoal()` race on a Running task.** Calling
   `Orchestrator.cancelRequest()` synchronously fires `task_failed` ->
   `route_failed` (via `Orchestrator.cancel()`) *before*
   capability-router.js sets its own request record's status to
   `'cancelled'`. This module's `route_failed` handler was reading
   that transient `'failed'` status, so a task cancelled while Running
   could land as **Failed** instead of **Cancelled**. Found by the
   regression suite's own cancellation test asserting the previously-
   Running task's final state, not just its dependent's. Fixed by
   marking the task Cancelled and removing it from the pending-request
   map *before* calling `cancelRequest()`, so the nested event simply
   finds nothing left to do.
2. **Spurious "context does not exist" log after cancellation.**
   `cancelGoal()` unconditionally called `tick()` a second time after
   the reentrant tick from bug (1) had already finalized and destroyed
   the goal's Runtime Context, producing a caught-but-noisy sync
   failure. Fixed with an early return in `tick()` once a plan is
   finalized, and by skipping the trailing `tick()` call in
   `cancelGoal()` when finalization already happened synchronously.

## Verification performed

- New suite: `test-evidence/block2-step7-part2-task-planner-
  regression-suite.js` — **21/21 assertions passing**. Covers: load-
  order guards; sequential vs. parallel decomposition; live (not
  hardcoded) capability matching, including the unresolvable-clause
  case; Pending -> Waiting -> Queued -> Running -> Completed/Failed/
  Cancelled transitions via emitted events; true concurrent dispatch
  of independent tasks (provable start-order, not just parallel-
  looking timing); dependency-blocked cascade cancellation; the flaky-
  agent test asserting the underlying Scheduler's own retry budget is
  respected and never duplicated; `cancelGoal()` on a Running task;
  `retryGoal()` re-running only the failed clause; Runtime Context
  create/sync/destroy with no leak; and no duplicate
  `route_completed`/`route_failed` listeners across concurrent goals.
- Full existing suite re-run, unmodified: every Block 2 / Step 6 suite
  this Part builds on passes unchanged —
  `block2-step6-part1-orchestrator` 21/21,
  `block2-step6-part2-agent-registry-integration` 18/18,
  `block2-step6-part3-capability-routing` 20/20,
  `block2-step6-part4-workflow-planner` 29/29,
  `block2-step6-part5-runtime-context` 42/42 — proving
  `orchestrator.js`, `capability-router.js`,
  `agent-registry-integration.js`, `runtime-context.js`, and
  `workflow-planner.js` are all still byte-for-byte behaviorally
  unchanged.
- Four unrelated suites in this sandbox
  (`block2-step1-coding-agent`, `block2-step1-part2-pipeline`,
  `milestone5`, `milestone6`, `milestone10`) fail to even start here —
  all with the identical `Cannot find module 'jsdom'`, a missing npm
  dependency in this environment, unrelated to any file this Part
  touched (none of them load or reference `os/core/task-planner.js`,
  `os/core/orchestrator.js`, or `automation.html`). Pre-existing
  environment limitation, not a regression from this pass.

## Investigated, deliberately not implemented, and why

- **Editing `workflow-planner.js` to make its own engine support
  parallel stages.** Would have meant changing Step 6 Part 4's
  execution loop and re-verifying its already-passing 29/29 suite
  against a behavior change. Building the new parallel-capable
  scheduler as an additive layer on top of `capability-router.js`'s
  `route()` (which already supports N concurrent in-flight requests)
  achieves the brief's "sequential and parallel" requirement without
  touching or risking that file at all.
- **A second `AxiomOrchestrator.enqueue()`-based dispatch path.**
  Every task in this module goes through `route()`, not `enqueue()`
  directly — using the capability layer means every task automatically
  gets the existing retry/timeout/failover pipeline for free, instead
  of this file re-implementing any part of it.

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 7 · Part 1: AI Runtime Integration

**Date:** 2026-08-01
**Scope:** One new agent registration, one real bug found and fixed
within it, everything else verification only. Six documents added:
`AI_RUNTIME_INTEGRATION.md`, `AGENT_CAPABILITIES.md`,
`MULTI_AGENT_EXECUTION.md`, `AI_WORKFLOW_VALIDATION.md`,
`STEP7_PART1_REPORT.md`, plus this entry.

## Changed files

- `os/core/agent-registry-integration.js` — added `registerCodingAgent()`
  (Part F), wrapping the real `os/runtime/capabilities/coding-toolkit.js`
  (`window.AxiomCodingToolkit`) using the exact same
  `registerOnce`/`safeInvoke`/health-probe pattern as the five existing
  registrations. Wired into `boot()`'s aggregation. Six capabilities
  registered: `project-search`, `file-navigation`, `code-explanation`,
  `refactor-proposal`, `bug-investigation`, `project-analysis`.

## Bug found and fixed within the new code (not pre-existing)

The initial handler passed whole `task`/`payload` objects as the first
positional argument to `explainCode()`, `proposeRefactor()`, and
`investigateBug()`, whose real signatures take a plain string
(code/description) first. Found via this pass's own live-execution
verification, before being documented as working. Fixed to pass
`payload.code`/`payload.description` correctly, with `{ task: ... }` as
the options argument. Re-verified live post-fix; Part 2 regression suite
re-run at 18/18, full Step 6 suite re-run at 130/130 — both unchanged.

## Investigated, deliberately not implemented, and why

- **OpenRouter live-client wiring**: real dependency chain traced
  (`openrouter-client.js` → `openrouter-config.js` + Supabase auth/
  billing globals). Not wired in — doing so "safely" would require a
  real Supabase project or fabricated auth responses, both outside this
  pass's rules. The Coding Agent works correctly without it, degrading
  gracefully or failing cleanly on model-dependent operations, confirmed
  live.
- **Capability names from the task brief that don't match real code**
  (Browser search/extract, Memory forget, Brain summarize/reason/plan/
  reflect, Automation schedule, Analytics collect/report/metrics) —
  checked each against the real subsystem files; most don't exist.
  Brain in particular has no reasoning capability of any kind in this
  codebase. Not implemented — that would be new functionality, not
  integration. Documented honestly in `AGENT_CAPABILITIES.md`.

## Verification

- All five Step 6 regression suites re-run against the final source:
  21/21, 18/18, 20/20, 29/29, 42/42 — 130/130, unchanged.
- Real multi-agent workflow chain (Browser → Brain → Memory →
  Automation) executed against the live stack: completed, all four
  stages, real subsystems.
- Real Coding → Brain → Automation chain executed: correctly failed at
  the coding stage due to a separate, pre-existing, undocumented-until-now
  dependency (the workspace-search subsystem, `window.AxiomAgents`, not
  loaded on this page) — with correct downstream-skip behavior, not a
  crash.
- Confirmed via source that no agent handler (including the new one)
  ever calls another agent or the Orchestrator directly — all
  cross-agent flow goes through `AxiomOrchestrator`/
  `AxiomWorkflowPlanner`, with zero exceptions found.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 6 · Part 6B: Live Runtime Verification & Bug Fix

**Date:** 2026-08-01
**Scope:** One real bug found via live execution and fixed. Everything
else in this pass is verification only. Seven documents added:
`LIVE_RUNTIME_VALIDATION.md`, `RUNTIME_INTEGRATION.md`,
`PERFORMANCE_RESULTS.md`, `MEMORY_VALIDATION.md`,
`EXECUTION_EVIDENCE.md`, `STEP6_PART6B_REPORT.md`, plus this entry.

## Bug fixed

`os/core/workflow-planner.js` — `routeStage()` always overwrote a
stage's dispatched `task.type` with a `'workflow_stage:<id>'` tracking
label, discarding any real operation type. Every
`agent-registry-integration.js` agent handler switches on `task.type`,
so any workflow stage targeting one of those agents by `agentId` could
never succeed — confirmed as the universal case, not an edge case, via
a real `executeWorkflow()` call against real registered agents (the
first time this integration had ever actually been executed end-to-end
rather than tested in isolation). Fixed by adding an optional
`stage.type` field to `normalizeStage()` and using it in `routeStage()`
when present, falling back to the exact previous behavior when absent —
purely additive, zero behavior change for any existing workflow
definition. Confirmed via source grep that nothing else in the codebase
matches on the old always-present `'workflow_stage:'` prefix, and via
the regression suite that no existing passing assertion depended on it,
before making the change. Re-verified: the same real workflow that
failed before the fix now completes in 5ms; Part 4 regression suite
re-run at 29/29, unchanged.

## Live execution evidence (new this pass — no source changes for these)

Built a Node `vm` harness loading the real, unmodified production chain
`automation.html` actually loads (ten real subsystem files plus the five
Step 6 files, in that page's real script order) with a documented,
minimal set of browser-API stand-ins (`localStorage`, `BroadcastChannel`,
`CustomEvent`, a `document` stub). Real, measured results:

- Five of six documented agents (browser, brain, memory, automation,
  system) register successfully against their real subsystem objects.
  Analytics not attempted (its real module is UI-heavy; registration
  logic itself is already suite-covered against a mock).
- Real `dispatch()`: 3ms. Real `route()`: 1ms. Real `executeWorkflow()`
  (post-fix): 5ms.
- Real cancel/retry/shutdown/restart/unknown-agent error paths all
  confirmed against the live stack.
- Real throughput: 2,000 tasks dispatched to a real agent, drained in
  2,916ms (686 tasks/sec), finished-task retention capped at exactly
  1,000 — confirming the Part 6A stabilization fix holds under real,
  not synthetic, load.

All 130 pre-existing regression assertions re-run against the final
state of the source: unchanged, all still passing.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 6 · Part 6B: Stabilization Pass

**Date:** 2026-08-01
**Scope:** Two implemented changes, both verified against the real
source. No redesign, no new features, no public API changes. Full
detail in `STEP6_STABILIZATION_REPORT.md`.

## Changed files

- `automation.html` — added five `<script defer>` tags (`orchestrator.js`,
  `runtime-context.js`, `capability-router.js`,
  `agent-registry-integration.js`, `workflow-planner.js`) wiring the
  Step 6 stack into the page `SYSTEM_REGISTRY.md` documents as the
  intended integration target. `os-shell.html` is untouched and still
  loads only the legacy `os/runtime/intelligence/orchestrator.js` stack
  — no page now loads both, so the pre-existing
  `window.AxiomOrchestrator` name collision between the two orchestrator
  implementations does not occur anywhere.
- `os/core/orchestrator.js` — added `MAX_COMPLETED_TASK_HISTORY` (1000)
  and automatic pruning of finished task records at all five terminal-
  transition points. Queued/running tasks are never affected.
  `clearTaskHistory()`'s existing behavior is unchanged (now shares its
  terminal-status check with the new pruning logic instead of
  duplicating it).
- `os/core/workflow-planner.js` — added `MAX_COMPLETED_WORKFLOW_HISTORY`
  (1000) and automatic pruning of finished workflow records at all six
  terminal-transition points. Active (created/validated/running/paused)
  workflows are never affected. This file previously had no bounding
  mechanism of any kind.

## Verification

- All 130 assertions across the five Step 6 regression suites re-run
  against the modified source: 21/21, 18/18, 20/20, 29/29, 42/42 — all
  still passing, no suite required modification.
- Two new stress scripts written and run against the modified source
  confirming the fix: dispatching 5,000 tasks caps finished-task
  retention at exactly 1,000 while a concurrently-running task and a
  queued backlog remain untouched; running 1,700 workflows (1,500 then
  200 more after starting a long-running one) caps finished-workflow
  retention at exactly 1,000 while the in-flight workflow remains
  present and `running` throughout.
- A load-order simulation confirms the five newly-wired
  `automation.html` scripts load in the correct dependency order with
  no exceptions and no global-name collisions.

## Behavior change (the only one, and it's the one explicitly scoped)

`getTask(id)` / `getWorkflow(id)` now return `undefined` for a
finished record old enough to have aged out of the 1,000-entry window,
instead of returning it indefinitely. Same trade-off
`capability-router.js` already makes for its own history. No other
public API shape changed.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 6 · Part 6A: Production Certification Pass

**Date:** 2026-08-01
**Scope:** Verification only — no source files under `os/core/` were
modified. Six documents added: `ARCHITECTURE_AUDIT.md`,
`SYSTEM_CERTIFICATION.md`, `DEPENDENCY_GRAPH.md`,
`PERFORMANCE_VALIDATION.md`, `MEMORY_AUDIT.md`,
`STEP6_VALIDATION_REPORT.md`.

## Summary

Certification pass over `orchestrator.js`, `agent-registry-integration.js`,
`capability-router.js`, `workflow-planner.js`, and `runtime-context.js`.
All 130 assertions across the five Step 6 regression suites re-executed
against the real source and confirmed passing. Full dependency graph
rebuilt from source across all 30 files in `os/core/` — confirmed
one-directional, no circular references. Three original stress/timing
scripts written and run in this pass (task-history growth at N=3,000,
enqueue-scaling timing at N=2,000–16,000, full-drain verification).

## Verified findings (no code changed)

- Two unbounded in-memory history stores (`orchestrator.js`'s
  `Scheduler.tasksById`, `workflow-planner.js`'s `workflowsById`),
  empirically confirmed via stress test, not fixed pending a retention-
  policy decision — see `MEMORY_AUDIT.md`.
- O(n²)-consistent task-enqueue scaling, confirmed via timing, judged
  low-impact at realistic queue depths — see `PERFORMANCE_VALIDATION.md`.
- None of the five Step 6 files are loaded by any `.html` shell in this
  repository; `os-shell.html` loads a separate `os/runtime/`
  orchestration stack instead — see `DEPENDENCY_GRAPH.md` and
  `SYSTEM_CERTIFICATION.md`.

No defects were fixed in this pass. The two memory findings have a
proposed minimal fix (mirroring the existing `HISTORY_LIMIT` pattern
already used by `capability-router.js` and `runtime-context.js`)
withheld pending confirmation, since it changes lookup behavior for
aged-out records — see `MEMORY_AUDIT.md` for detail.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 6 · Part 5: Runtime Context Engine

**Date:** 2026-08-01
**Scope:** Orchestrator only. One new file, `os/core/runtime-context.js`
(`window.AxiomRuntimeContext`, `API_VERSION 1.0.0`), additively mirrored
onto `window.AxiomOrchestrator` when present, on top of Part 1
(`orchestrator.js`), Part 3 (`capability-router.js`), and Part 4
(`workflow-planner.js`). No changes to any of those three files, to
`os/core/agent-registry-integration.js`, or to any Browser/Brain/Memory/
Automation/Analytics/System file. No OpenRouter integration. No UI
changes — no `.html` file references the new module. Full design writeup
in `RUNTIME_CONTEXT.md`, `CONTEXT_LIFECYCLE.md`, and
`CONTEXT_RECOVERY.md`.

## Summary
Parts 1–4 gave the Orchestrator agent registration, routing/dispatch, and
multi-stage workflow collaboration — but no single place tracked
temporary, in-flight execution state that any of those layers could
read and write through a common, isolated, lifecycle-managed API. This
pass adds a Runtime Context Engine: one isolated context per
request/workflow, with a validated state machine, parent/child support
for sub-workflows, and fully automatic archival/cleanup once a context's
work is done. It is in-memory only and explicitly not Memory, not
Browser History, and not Brain storage — everything it tracks is
designed to disappear once the work it belonged to finishes.

## Added

**`os/core/runtime-context.js`** (new file, `window.AxiomRuntimeContext`)
- **Part A — Runtime Context Engine:** `createContext()`,
  `destroyContext()`, `getContext()`, `updateContext()`, `cloneContext()`,
  `clearContext()`. Each context carries `contextId`, `workflowId`,
  `requestId`, `ownerAgent`, `createdAt`, `updatedAt`, `status`,
  `metadata`, `state`, `temporaryData`.
- **Part B — Context Isolation:** every `createContext()` call is fully
  independent — no two contexts ever share object references. Parent/
  child support via `createChildContext()`, `getChildContexts()`,
  `getParentContext()`, and `getContextsByWorkflow()`; a child inherits
  identity (`workflowId`) but never inherits `state`/`temporaryData` by
  reference or by value. `cloneContext()` deep-copies a context's data
  into a brand-new, independent `contextId`. All reads (`getContext()`
  and friends) return deep-frozen immutable snapshots — the engine's
  live objects are never exposed to a caller.
- **Part C — Context Lifecycle:** `CREATED → READY → RUNNING ⇄
  WAITING/PAUSED → COMPLETED/FAILED/CANCELLED → DESTROYED`, enforced by
  `transitionContext()` and a fixed adjacency table. Illegal transitions
  fail safely — they return `{ success:false, error:'illegal_transition'
  }` and leave status unchanged, never throw. Shorthands: `markReady()`,
  `markRunning()`, `markWaiting()`, `pauseContext()`, `resumeContext()`,
  `completeContext()`, `failContext()`, `cancelContext()`.
- **Part D — Context Synchronization:** the same immutable-snapshot
  contract from Part B is the mechanism by which Workflow Planner and
  Capability Router (or anything else) will be able to read/update
  Runtime Context safely in a future part — this pass adds the API
  surface without modifying either of those files.
- **Part E — Monitoring APIs:** `listContexts()`, `getContextMetrics()`,
  `getActiveContexts()`, `getContextHistory()`, `getContextStatus()`,
  tracking `createdCount`/`destroyedCount`/`completedCount`/
  `failedCount`/`cancelledCount`/`peakConcurrent`/`active`/`archived`.
- **Part F — Cleanup & Recovery:** reaching a terminal status
  auto-archives a context immediately (out of `getActiveContexts()`, into
  a TTL-bound recoverable tier). `recoverContext()` restores an archived
  context to `READY`; `archiveContext()` archives on demand;
  `cleanupExpiredContexts()` permanently destroys only archived contexts
  past their TTL and never touches an active one; `createContext({
  timeoutMs })` auto-fails a context that overstays its budget.
  `startAutoCleanup()`/`stopAutoCleanup()` wrap the sweep in an optional
  background interval.
- New lifecycle events on the existing `AxiomOrchestrator` event bus:
  `context_created`, `context_updated`, `context_cleared`,
  `context_status_changed`, `context_completed`, `context_failed`,
  `context_cancelled`, `context_archived`, `context_recovered`,
  `context_destroyed`.
- Unlike Parts 3 and 4, this module does **not** require
  `AxiomOrchestrator` to already be loaded — it works standalone as
  `window.AxiomRuntimeContext` and only mirrors its API onto
  `AxiomOrchestrator` additively when that global happens to be present.

## Testing
`test-evidence/block2-step6-part5-runtime-context-regression-suite.js` —
28 tests, 28 passing (`block2-step6-part5-runtime-context-regression-
output.txt`). Covers: standalone operation without Orchestrator loaded,
additive installation onto `AxiomOrchestrator`, full field population,
immutable/frozen snapshots, merge semantics of `updateContext()`,
`clearContext()`/`cloneContext()` isolation, every legal lifecycle edge,
illegal-transition safety, `DESTROYED` terminality, parent/child
isolation (including rejecting an unknown parent), workflow-scoped
lookups, automatic archival on terminal status, recovery (including the
"never archived" case), TTL-based expiry cleanup that leaves active
contexts untouched, timeout-driven auto-failure, force-destroy of a live
context, destroy-one-doesn't-disturb-a-sibling, monitoring counters, and
the full `context_*` event sequence.

## Verified
- ✓ Context isolation — no shared references between any two contexts.
- ✓ Parent/child relationships — linked both directions, no state leak.
- ✓ Immutable snapshots — every read is deep-frozen; mutation attempts
  have zero effect on engine state.
- ✓ Lifecycle validation — all 9 states, every legal edge exercised,
  every illegal edge fails safely.
- ✓ Automatic cleanup — terminal status ⇒ immediate archival ⇒
  TTL-based destruction, verified never to touch a still-active context.
- ✓ Recovery — archived → `READY`, expired/never-archived → `null`, no
  throw.
- ✓ No Browser, Brain, Memory, Automation, or Analytics file changed.
- ✓ No UI/`.html` file changed.
- ✓ No console errors in the regression run.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 6 · Part 4: Multi-Agent Collaboration & Workflow Orchestration

**Date:** 2026-08-01
**Scope:** Orchestrator only. One new file, `os/core/workflow-planner.js`
(`window.AxiomWorkflowPlanner`, `API_VERSION 1.0.0`), installed additively
onto the existing `window.AxiomOrchestrator`, on top of Part 1
(`orchestrator.js`) and Part 3 (`capability-router.js`). No changes to
either of those files, `os/core/agent-registry-integration.js`, or any
Browser/Brain/Memory/Automation/Analytics/System file. No OpenRouter
integration. No UI changes — no `.html` file references the new module.
Full design writeup in `WORKFLOW_ENGINE.md`, `MULTI_AGENT_COLLABORATION.md`,
and `WORKFLOW_CONTEXT.md`.

## Summary
Parts 1–3 gave a single request a real routing/dispatch/failover pipeline,
but every request still ended with exactly one agent producing exactly one
answer. This pass adds a Workflow Planner that lets several agents
collaborate, in dependency order, on one user-facing request — each stage
still reaching its agent only through `AxiomOrchestrator.route()`/
`dispatch()`, so no agent ever calls another agent directly and no agent
handler ever receives a reference to another agent.

## Added

**`os/core/workflow-planner.js`** (new file, `window.AxiomWorkflowPlanner`)
- **Part A — Workflow Planner:** `createWorkflow()`, `validateWorkflow()`,
  `optimizeWorkflow()`, `executeWorkflow()`, `pauseWorkflow()`,
  `resumeWorkflow()`, `cancelWorkflow()`. A workflow is a named, ordered set
  of stages; `createWorkflow()` structurally validates (duplicate ids,
  unknown `dependsOn` targets, circular dependencies) before a workflow can
  ever be executed.
- **Part B — Agent Collaboration:** sequential, dependency-ordered stage
  execution. Each stage's `input(context)` function decides exactly what
  slice of the shared Workflow Context reaches that stage's agent as its
  task payload — the agent itself never sees the context object or any
  other agent.
- **Part C — Shared Context:** an in-memory-only `context` object
  (`trigger`, `state`, `outputs`, `metadata`, `timestamps`) created fresh by
  `executeWorkflow()` and discarded at workflow completion; this module
  never calls `AxiomMemoryEngine` or any storage API.
- **Part D — Dependency Resolution:** `dependsOn` on each stage, resolved
  via topological sort (`optimizeWorkflow()` also groups the same order
  into independent "waves" for inspection). Circular dependencies and
  references to unknown stage ids throw a structural error at
  `createWorkflow()` time, before any agent is ever dispatched.
- **Part E — Workflow Monitoring:** `getWorkflow()`, `listWorkflows()`,
  `getWorkflowStatus()`, `getWorkflowMetrics()`, `getActiveWorkflows()`,
  tracking `pending`/`running`/`completed`/`failed`/`skipped`/`cancelled`
  per stage and per workflow.
- **Part F — Failure Recovery:** a failing stage is retried (up to
  `stage.maxRetries`), then fails over to `stage.alternateAgentIds` (if
  any), then is skipped if `stage.optional`, and only then fails the
  workflow gracefully — marking downstream stages `skipped` and emitting
  `workflow_failed` — without ever throwing out of the execution loop.
- New lifecycle events on the existing `AxiomOrchestrator` event bus:
  `workflow_created`, `workflow_validated`, `workflow_optimized`,
  `workflow_started`, `workflow_stage_started`, `workflow_stage_completed`,
  `workflow_stage_failed`, `workflow_stage_skipped`, `workflow_paused`,
  `workflow_resumed`, `workflow_cancelled`, `workflow_failed`,
  `workflow_completed`.
- Falls back to `AxiomOrchestrator.dispatch()` when `capability-router.js`
  is not loaded on a given page, so the module has exactly one hard
  dependency (Part 1) and one soft dependency (Part 3).

**`test-evidence/block2-step6-part4-workflow-planner-regression-suite.js`**
(new) — 22 assertions against the real, unmodified `orchestrator.js` +
`capability-router.js` + `workflow-planner.js` in a `vm` sandbox: dependency
resolution and circular-dependency detection, full sequential collaboration
with context propagation, per-stage payload isolation, optional-stage
skipping, required-stage graceful failure, retry recovery, alternate-agent
recovery, pause/resume/cancel at stage boundaries, monitoring accuracy, the
no-router fallback path, and lifecycle event ordering. All 22 pass; see
`test-evidence/block2-step6-part4-workflow-planner-regression-output.txt`.

## Changed
Nothing in `os/core/orchestrator.js`, `os/core/capability-router.js`, or
`os/core/agent-registry-integration.js`. Part 1/Part 2/Part 3 regression
suites re-run unmodified and still pass (21/21, 18/18, 20/20 respectively).

## Not Done (explicitly out of scope per this order)
- No true concurrent/parallel stage execution — `optimizeWorkflow()`
  computes the parallelizable "waves" and documents them, but
  `executeWorkflow()` still runs one stage at a time. Documented as the
  seed for a future parallel-execution pass, not implemented here.
- No UI. No OpenRouter. No Browser/Brain/Memory/Automation/Analytics/System
  changes.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 6 · Part 3: Capability Routing & Intelligent Task Dispatch

**Date:** 2026-08-01
**Scope:** Routing only. One new file, `os/core/capability-router.js`
(`window.AxiomCapabilityRouter`, `API_VERSION 1.0.0`), installed additively
onto the existing `window.AxiomOrchestrator`. No changes to
`os/core/orchestrator.js` or `os/core/agent-registry-integration.js`, and no
changes to any Browser/Brain/Memory/Automation/Analytics/System file. No
OpenRouter integration. No UI changes — no `.html` file references the new
module. Full design writeup in `CAPABILITY_ROUTING.md`,
`EXECUTION_PIPELINE.md`, and `TASK_SCHEDULER.md`.

## Summary
Part 1 built the registry/bus/scheduler; Part 2 populated the registry with
the real subsystems. Neither pass ever decided *who* should run a request —
`dispatch()`'s capability match is a single "first healthy agent in
registration order" rule with no planning step, no deterministic
tie-breaking, and no reaction to a chosen agent failing mid-flight. This
pass adds that decision layer on top, entirely via new functions installed
onto the existing `AxiomOrchestrator` object (the same convention Part 2
used for `discoverAgents()` etc.) — `orchestrator.js` itself stays
byte-for-byte the file Part 1 left it as.

## Added

**`os/core/capability-router.js`** (new file, `window.AxiomCapabilityRouter`)
- **Part A — Capability Router:** `analyzeRequest()`, `resolveCapability()`,
  `selectAgent()`, `resolvePriority()`, `resolveExecutionPlan()`. Reads
  candidate agents exclusively from `AxiomOrchestrator.listAgents()`/
  `discoverAgents()` — no subsystem name is ever hardcoded.
- **Part B — Execution Planner:** `resolveExecutionPlan()` produces an
  `Object.freeze()`d plan (`requestId`, `agentId`, `capability`, `priority`,
  `timeout`, `retryPolicy`, `executionPath`) that cannot be mutated after
  creation; `retryPolicy` and `executionPath` are frozen independently.
- **Part C — Dispatch Pipeline:** `validate()`, `prepare()`, an internal
  `dispatch()` step that always calls the existing
  `AxiomOrchestrator.enqueue()` (never a bypass of the Part 1 Scheduler),
  plus `monitorRequest()`/`getTaskStatus()`, `cancelRequest()`, and
  `retryRequest()`. `complete()`/`fail()` are handled reactively, wired
  once to the Scheduler's own `task_completed`/`task_failed` events rather
  than polled.
- **Part D — Agent Selection Strategy:** deterministic multi-criteria
  ranking — eligibility (not disabled, not unhealthy, has any required
  permission) → health → availability → live workload
  (`listTasks({agentId,status})`) → router-local agent priority
  (`setAgentPriority()`/`getAgentPriority()`) → lexical agent id as the
  final tiebreaker. Never random.
- **Part E — Runtime Monitoring:** `getTaskStatus(requestId)`,
  `getTaskMetrics()` (queued/running/completed/failed/retried/cancelled/
  failedOver counters), `getExecutionHistory(limit)` (bounded, newest
  first), `getQueueStatus()` (per-agent queued/running, computed live —
  no separate counters that can drift from the Scheduler's own state).
- **Part F — Error Routing:** on a Scheduler `task_failed` event (i.e.
  after Part 1's own same-agent `maxRetries` is already exhausted), the
  Router attempts an alternate healthy agent exposing the same capability
  (excluding every agent already tried, capped at 2 failover hops),
  otherwise marks the request `failed` and emits `route_failed` — never
  throws, never touches the Orchestrator's runtime state.
- `AxiomOrchestrator.route(request)` is the single end-to-end entry point:
  Capability Router → Execution Planner → Dispatch Pipeline. It rethrows
  only for structurally invalid input (mirroring `dispatch()`'s existing
  posture); every routing/availability outcome — unknown `agentId`, no
  eligible agent, an agent that later errors out — comes back as a
  standardized `{ accepted:false, requestId, error }` result instead.

**`test-evidence/block2-step6-part3-capability-routing-regression-suite.js`** (new file)
- Loads the real, unmodified `orchestrator.js` and the real
  `capability-router.js` in a `vm` sandbox with small stand-in test agents
  (this suite's job is the routing contract, independent of which real
  subsystems a given page happens to load — those are covered by the
  Part 2 suite). 20/20 assertions passing, covering: immutable plan
  shape, capability inference, permission-based eligibility, deterministic
  workload/priority/lexical tie-breaking, successful and explicit-agent
  routing through the real Scheduler, alternate-agent failover, graceful
  no-agent-available failure, structural-vs-routing error posture,
  cancel/retry through the real Scheduler, metrics, history, queue status,
  and containment of a synchronously-throwing handler.

## Verified
- Part 1's regression suite (21/21) and Part 2's regression suite (18/18)
  both still pass unmodified against the untouched `orchestrator.js` and
  `agent-registry-integration.js` — see `test-evidence/`.
- `AxiomOrchestrator.dispatch()`/`registerAgent()` continue to work exactly
  as before; `route()` is purely additive.
- Manual end-to-end check with all three modules loaded in load order
  (`orchestrator.js` → `agent-registry-integration.js` →
  `capability-router.js`) against mock `AxiomBrowserManager`/`AxiomBrain`
  globals: `route({ capability: 'navigate', ... })` resolves to the real
  `browser` agent, runs through the real Scheduler, and completes.

## Explicitly out of scope for this pass
- No OpenRouter or any other AI-provider wiring.
- No UI changes — no `.html` file references `capability-router.js`.
- No changes to Browser Engine, Brain, Memory, Automation, Analytics, or
  System internals, and no changes to `os/core/orchestrator.js` or
  `os/core/agent-registry-integration.js`. Every capability in this pass
  is installed onto the existing `AxiomOrchestrator` object from the
  outside, so Part 1's and Part 2's files and regression suites remain
  valid and untouched.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 6 · Part 2: Agent Registry Integration

**Date:** 2026-08-01
**Scope:** Registration only. One new file, `os/core/agent-registry-integration.js`
(`window.AxiomAgentRegistryIntegration`, `API_VERSION 1.0.0`). No changes to
`os/core/orchestrator.js` or to any Browser/Brain/Memory/Automation/Analytics
file. No OpenRouter integration. No UI changes — no `.html` file references
the new module. No execution routing changed: nothing in this pass calls
`AxiomOrchestrator.dispatch()` against any of the newly registered agents.
Full design writeup in `AGENT_DISCOVERY.md` and `SYSTEM_REGISTRY.md`.

## Summary
Block 2 · Step 6 · Part 1 built the Orchestrator (registry, event bus,
scheduler, lifecycle) but registered nothing. This pass connects the five
existing AXIOM subsystems (Browser, Brain, Memory, Automation, Analytics) —
plus a thin System aggregator — to that registry, reading each agent's
capabilities/permissions/tools from the subsystem's own already-public API.
Every subsystem is completely untouched: this module only ever *calls* their
existing methods (inside dormant task handlers that nothing invokes yet) and
*reads* their existing health/diagnostics signals. Registration is
best-effort per subsystem — a page that only loads a subset of the
subsystems (see `SYSTEM_REGISTRY.md`) simply registers that subset; nothing
is fabricated for an absent global.

## Added

**`os/core/agent-registry-integration.js`** (new file, `window.AxiomAgentRegistryIntegration`)
- **Part A — Browser Agent Registration:** registers `browser` from
  `AxiomBrowserManager`, reading its real tool list from
  `AxiomBrowserToolRegistry.listTools()` when present, and mapping its real
  `health()` (`healthy`/`degraded`/`unavailable`) onto the registry's
  `healthy`/`degraded`/`unhealthy` health model.
- **Part B — Brain Agent Registration:** registers `brain` from
  `AxiomBrain`. Brain exposes no dedicated `health()`, so liveness is
  derived from whether `getState()` resolves without throwing.
- **Part C — Memory Agent Registration:** registers `memory` from
  `AxiomMemoryManager`, using `getOverview()` (which exercises the
  underlying engine) as its health probe.
- **Part D — Automation Agent Registration:** registers `automation` from
  `AxiomAutomationManager`, using `getStats()` as its health probe.
- **Part E — Analytics & System Registration:** registers `analytics` from
  `AxiomAnalyticsAutomation` when present. Registers `system` as a thin,
  honest aggregator (Orchestrator's own runtime stats plus
  `AxiomRuntimeMonitor.report()` when loaded) since no single existing file
  plays the role of a canonical "System" subsystem — see
  `SYSTEM_REGISTRY.md` for that design decision.
- **Part F — Agent Discovery APIs:** adds `discoverAgents(filter)`,
  `discoverCapabilities()`, `findAgentByCapability(capability)`,
  `getAgentHealth(id)`, `getSystemHealth()`, and `listAvailableTools()`
  directly onto the existing `AxiomOrchestrator` object. These are pure
  additions built entirely on Part 1's own already-public methods
  (`listAgents`, `getAgent`, `getHealthyAgents`, `getStats`) — `orchestrator.js`
  itself is not edited, so Part 1's file and regression suite remain valid
  and untouched.
- **Health sync:** a read-only 20s poll (`syncHealth()`, also callable
  manually) that re-probes each registered subsystem's real status and
  updates its registry `health` field. Never routes or executes tasks.

**`test-evidence/block2-step6-part2-agent-registry-integration-regression-suite.js`** (new file)
- Loads the real, unmodified `orchestrator.js` and
  `agent-registry-integration.js` in a `vm` sandbox with mock subsystem
  globals and exercises: full/partial subsystem registration, real
  capability/tool/health data on each registered agent, health-status
  mapping (`healthy`/`degraded`/`unavailable` → registry health),
  registration idempotency, that registration never invokes a handler
  (no execution-flow change), that a manually-issued `dispatch()` against
  a registered agent correctly forwards to the mock subsystem, every
  discovery API, health-sync re-probing, and that Part 1's own API
  (manual `registerAgent()`) is unaffected. 18/18 assertions passing.

## Verified (no changes needed)
- `os/core/orchestrator.js` — not edited. Its own regression suite
  (`block2-step6-part1-orchestrator-regression-suite.js`) still passes
  21/21 unmodified, confirming Part 1 behavior is unaffected.
- `os/core/browser-manager.js`, `os/core/axiom-brain.js`,
  `os/core/memory-manager.js`, `os/core/automation-manager.js` — none
  were opened for edits. This module only reads their existing public
  methods.
- No `.html` file was changed. `os/core/agent-registry-integration.js` is
  not yet `<script>`-included anywhere, consistent with
  `os/core/orchestrator.js` itself not being wired into any page yet —
  wiring both into pages together is left for a future integration step.

## Explicitly out of scope for this pass
- No OpenRouter or any other AI-provider wiring.
- No execution routing change — nothing calls `dispatch()` against
  `browser`/`brain`/`memory`/`automation`/`analytics`/`system` in this
  pass. Registered handlers are dormant until a future orchestration
  phase actually dispatches work to them.
- No changes to Browser Engine, Brain, Memory, Automation, or Analytics
  internals. Those subsystems can still be called directly exactly as
  before; nothing about their existing behavior changed.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 6 · Part 1: Agent Orchestrator Core

**Date:** 2026-08-01
**Scope:** New orchestration layer only. One new file, `os/core/orchestrator.js`
(`window.AxiomOrchestrator`, `API_VERSION 1.0.0`). No changes to any existing
file. No OpenRouter integration. No UI changes — no `.html` file references
the new module yet. Browser Engine, Brain, Memory, and Automation are
untouched and remain fully usable directly, exactly as before this pass.
Full design writeup in `ORCHESTRATOR_ARCHITECTURE.md`, `AGENT_REGISTRY.md`,
and `EVENT_BUS.md`.

## Summary
Every subsystem built so far exists as its own independent global
(`AxiomBrain`, `AxiomMemoryEngine`, `AxiomAutomationManager`,
`AxiomBrowserManager`) connected only by point-to-point bridge files. This
pass adds a coordination layer that sits above those subsystems: agents
register themselves with the Orchestrator (id, name, capabilities,
permissions, supported tools, status, health); requests are routed to an
agent by explicit id or by capability match; every request flows through a
real task scheduler (priority, timeout, retry, cancel) instead of executing
immediately; and the full runtime/task/agent lifecycle is delivered through
a dedicated in-process event bus. Nothing about how Browser, Brain, Memory,
or Automation work today changed — they can still be called directly, and
none of them have been wired to route through the Orchestrator in this pass.

## Added

**`os/core/orchestrator.js`** (new file, `window.AxiomOrchestrator`)
- **Part A — Orchestrator Core:** `dispatch()` as the single routing entry
  point (by `agentId` or by `capability`), `init()`, `startup()`/`shutdown()`,
  `getRuntimeState()`.
- **Part B — Agent Registry:** `registerAgent()`, `unregisterAgent()`,
  `getAgent()`, `listAgents()`, `getHealthyAgents()`, plus
  `setAgentHealth()`/`setAgentStatus()`. Public agent objects are data
  snapshots only — the registered `handler` function is never exposed
  outside the module.
- **Part C — Event Bus:** `on()`, `once()`, `off()`, `emit()`. Duplicate
  `on()`/`once()` subscriptions for the same function are ignored; a
  throwing listener is caught per-listener and cannot break `emit()` for
  the rest of the subscribers.
- **Part D — Task Scheduler:** `enqueue()` (also reachable via
  `dispatch()`), `cancel()`, `retry()`, priority-ordered queueing, per-task
  `timeout`, and `maxRetries`/`retryDelay`. Verified that `dispatch()`
  never runs a handler synchronously on the caller's stack — every task is
  still `queued`/`running`, never `completed`, in the same tick
  `dispatch()` returns.
- **Part E — Runtime Lifecycle:** `startup`, `shutdown`,
  `agent_registered`, `agent_removed`, `task_started`, `task_completed`,
  `task_failed` events, plus a rolled-up `lifecycle` event for observing
  all of them at once. `shutdown()` cancels every agent's
  in-flight/queued tasks before flipping runtime state so nothing is
  silently orphaned.

**`test-evidence/block2-step6-part1-orchestrator-regression-suite.js`** (new file)
- Loads the real, unmodified `orchestrator.js` in a `vm` sandbox and
  exercises registry validation, event-bus duplicate/once/throwing-listener
  behavior, capability-based routing, the queued→running→completed/failed
  task lifecycle, retries, timeouts, priority ordering, cancellation, and
  shutdown/startup. 21/21 assertions passing.

## Verified (no changes needed)
- `os/core/axiom-brain.js`, `os/core/memory-engine.js`,
  `os/core/automation-manager.js`, `os/core/browser-manager.js` — none
  reference or depend on the Orchestrator; none were opened for edits.
  Confirmed by re-reading each module's public API surface before writing
  `orchestrator.js`, and by not modifying any of these files.
- No `.html` file was changed. `os/core/orchestrator.js` is not yet
  `<script>`-included anywhere — wiring it into pages is left for a future
  integration step, consistent with how this project has sequenced
  "foundation" passes before "integration" passes for prior subsystems
  (e.g. `BROWSER_FOUNDATION.md` → `BROWSER_INTEGRATION_REPORT.md`).

## Regression Evidence
- New: `block2-step6-part1-orchestrator-regression-suite.js` — 21/21 passing.
- No existing suite was re-run for this pass since no existing file was
  touched; see prior CHANGELOG entries below for Browser Engine evidence,
  which remains valid and unaffected.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 5 (Part 6B): Browser Error Recovery & Production Certification

**Date:** 2026-08-01
**Scope:** Error-recovery and runtime-resilience hardening pass over the Browser Engine, immediately following Part 6A. No new features, no UI changes, no changes outside `os/core/browser-manager.js`, `os/runtime/capabilities/browser-tool-registry.js`, and their regression evidence. Full findings in `ERROR_RECOVERY_REPORT.md`, `BROWSER_CERTIFICATION.md`, and `BROWSER_PRODUCTION_REPORT.md`.

## Summary
Audited every `BrowserManager` and `BrowserToolRegistry` entry point for what happens when the layer beneath it (`AxiomBrowserEngine`, `AxiomBrowserSandbox`) fails, throws, or returns malformed data. Two genuine, previously-uncaught defects were found and fixed. The rest of the pass is defensive hardening: converting "this would crash the caller if X ever throws" into "this returns a safe fallback or standardized envelope if X throws," verified against a hostile fake Engine whose every method throws, not just inspected by eye.

## Fixed

**`os/core/browser-manager.js` — `resolveSessionId()` / `resolveTabId()`**
- **Bug:** both resolvers call `Engine.getActiveSessionId()` / `Engine.getActiveTab()` directly and run at the top of nearly every `NavigationAPI`/`TabAPI`/`SessionAPI` method, *before* that method's own logic. An exception thrown by the Engine here (corrupted internal state, a bug, a mid-restart call) was not caught by anything and propagated straight out of `BrowserManager.navigate()`, `.back()`, `.tabs.create()`, etc. — the one entry point Part D certification requires to never crash.
- **Fix:** both resolvers now run through the new `safeCall()` wrapper and fail safe (`'default'` session id, `null` tab id) instead of throwing.
- Found by the new hostile-Engine regression suite, not by inspection — the bug would not have been caught by reading the navigate()/back()/etc. bodies alone, since those already looked guarded.

**`os/runtime/capabilities/browser-tool-registry.js` — `executeTool()`**
- **Bug:** every failure path (unknown tool, missing `BrowserManager`, a sandbox exception, a handler that throws synchronously or returns a rejected promise) threw or rejected. A caller that didn't attach `.catch()` — and neither `BrowserAgent` nor `BrowserBridge` guarantees that for every call path — got an unhandled promise rejection instead of a recoverable result.
- **Fix:** every failure path now resolves a standardized `{ ok:false, code, reason, tool }` envelope. `executeTool()` is now guaranteed to resolve, never reject.

## Added

**`os/core/browser-manager.js` — standardized error envelope & safe-call wrapper (Part A)**
- `errEnvelope(code, reason, extra)` — the `{ ok:false, code, reason, error }` shape now used consistently by `executeBrowserOp()` and any call site returning an error object.
- `safeCall(op, fn, fallback)` — wraps a Browser operation so a thrown exception logs, emits `browser:error`, and returns a safe fallback instead of propagating. Applied to every `NavigationAPI`, `SessionAPI`, `HistoryAPI`, and `TabAPI` method, plus the two resolvers above.
- `restoreSession()` now validates the snapshot's shape before calling the Engine and fails safe (`null`) on a malformed snapshot or an Engine exception — this is the primary "browser restart" recovery path per Part C, so it can no longer throw past `BrowserManager`.
- `executeBrowserOp()` (`dispatchBrowserOp()` internally) is wrapped end-to-end so it always resolves a standardized envelope; it can no longer produce a rejected promise for any input, including unsupported ops.

**`os/core/browser-manager.js` — stale in-flight navigation detection (Part C)**
- `NAV_TIMEOUT_MS` (30s), `getStaleNavigations()`, `sweepStaleNavigations()` — if the Engine (or a hung renderer/iframe) never emits a settling event for a navigation, `diagnostics()` now sweeps it after the timeout instead of reporting a phantom in-flight navigation forever. Surfaced as `diagnostics().timedOutNavigationsSwept`.
- `API_VERSION` bumped `1.1.0` → `1.2.0`.

**`test-evidence/block2-step5-part6b-error-recovery-regression-suite.js`** (new file)
- Loads the real `browser-manager.js` and `browser-tool-registry.js` against a deliberately hostile fake Engine whose every method throws, plus a fake Engine that never settles a navigation. 15/15 assertions passing. This is the suite that found the `resolveSessionId`/`resolveTabId` bug above — inspection alone had missed it.

## Verified (no changes needed)
- `os/core/browser-sandbox.js` — `validateUrl()`/`validateOrigin()` already wrap `new URL()` in try/catch and fail closed (`valid:false`) on malformed input.
- `os/runtime/capabilities/browser-bridge.js` — already has its own ack-timeout (6s) and frame-open-timeout (4s) with reject-with-clear-message on both, and `BrowserAgent` already converts any rejection from this path into a graceful, non-crashing result via its own top-level try/catch.
- `os/runtime/agent-definitions/browser-agent.js` — already wraps its entire operation dispatch in try/catch and returns `{ ok:false, ... }` on any failure; no change needed.
- `os/core/browser-engine.js` — the `StorageAdapter` (its only `localStorage` touchpoint) already catches JSON-parse failures and falls back to the caller-supplied default. Two functions in this file do intentionally `throw` on invalid input (`createTab()` on an unknown `sessionId`, `restoreSession()` on a malformed snapshot) — this is a deliberate fail-fast internal contract, not a bug, and is exactly what `BrowserManager`'s new `safeCall()` wrapping exists to catch at the one public gateway. Not otherwise modified.
- `os/core/browser-brain-bridge.js` / `os/core/browser-memory-bridge.js` — both subscribe via `Engine.onChange()`, whose dispatcher (`os/core/browser-engine.js`) already isolates each listener in its own try/catch, so a bug in either bridge's event handler cannot crash the Engine or any other listener. Not otherwise modified this pass — see `ERROR_RECOVERY_REPORT.md` for what a deeper pass over these two files would still need to check.

## Regression Evidence
- New: `block2-step5-part6b-error-recovery-regression-suite.js` — 15/15 passing.
- Re-run clean, no regressions: `block2-step5-part6a-browser-audit-regression-suite.js` (7/7 — the API-version assertion was updated to `1.2.0` to match the intentional bump above), `block2-step5-part1-browser-foundation-regression-suite.js` (21/21), `block2-step5-part2-navigation-session-regression-suite.js` (21/21).

---



**Date:** 2026-08-01
**Scope:** Full production audit of the Browser Engine (`BrowserManager`, `BrowserEngine`, `BrowserSandbox`, `BrowserToolRegistry`, `BrowserBridge`, `BrowserAgent`, Navigation/Session/Tab/History Managers). No new browser features, no UI redesign, no changes outside the Browser Engine. Detailed findings in `PERFORMANCE_AUDIT.md` and `BROWSER_DIAGNOSTICS.md`. Regression evidence: `test-evidence/block2-step5-part6a-browser-audit-regression-suite.js` (7/7 passing), plus the unmodified Part 1 (21/21) and Part 2 (21/21) suites re-run clean against this pass.

## Summary
A full read-through of every Browser Engine module against the Part A–D checklist in the execution order. Architecture confirmed sound (`BrowserManager` remains the single public gateway; no duplicate browser logic across modules). Two real, previously-unnoticed defects were found and fixed during the audit — both existed prior to this pass and were never exercised by the existing engine-only regression suites, since neither tested `BrowserManager` itself. One real rendering-performance issue was found and fixed. Four new diagnostics APIs were added per Part D.

## Fixed

**`os/core/browser-manager.js` — `NavigationAPI.navigate()`**
- **Bug:** called `Engine.navigation.navigate(url, sid, tid)`. The engine's `NavigationManager.navigate()` (`os/core/browser-engine.js`) signature is `(sessionId, tabId, input)` — the arguments were in the wrong order. Every navigation that took this branch silently failed (`{ ok: false, reason: 'navigation-failed' }`).
- **Fix:** corrected the call to `Engine.navigation.navigate(sid, tid, url)`.
- Not previously caught because the Part 1/Part 2 regression suites exercise `browser-engine.js` directly and never drove a navigation through `BrowserManager.navigate()` itself.

**`os/core/browser-manager.js` — `getMetrics()` / `diagnostics()` active-tab counting**
- **Bug:** computed active tab count from `activeSession.tabs`. The real Engine session record (`SessionAPI.getActiveSession()` → `Engine.getSession()`) stores its tab ids under `tabIds`, not `tabs` — only the no-session fallback object used `tabs`. Against a real session this always read `undefined`, so `getMetrics().activeTabs` silently reported `0` regardless of how many tabs were actually open.
- **Fix:** added a shared `activeTabCount()` helper that checks both `tabIds` and `tabs` shapes correctly. Used by both `getMetrics()` and the new `diagnostics()`.

**`js/pages/browser-live.js` — redundant tab-strip re-renders and per-render listener churn**
- **Issue:** `renderTabs()` tore down and rebuilt every tab node's DOM via `innerHTML` and re-attached two fresh `click` listeners per tab on every call. A single navigation lifecycle fires this twice (`tab:navigated` at start, `tab:status` at completion), so every navigation did double the DOM/listener work it needed to, and the work scaled with total tab count even though at most one tab actually changed.
- **Fix:** replaced per-tab listeners with a single delegated `click` listener on the tab strip container, wired once in `init()` — re-rendering no longer creates or discards listeners. Added `scheduleRenderTabs()`, an `requestAnimationFrame`-coalesced scheduler, so multiple `renderTabs()` triggers within the same frame collapse into a single repaint. The one-time initial render on load remains synchronous for immediate first paint.

## Added

**`os/core/browser-manager.js` — Browser Diagnostics API (Part D)**
- `health()` — `{ status: 'healthy'|'degraded'|'unavailable', checks: { engine, sandbox, brainBridge, memoryBridge }, timestamp }`.
- `diagnostics()` — consolidated view: health, active sessions/tabs, total tabs across sessions, live event-listener count, in-flight-navigation count, metrics, performance, engine stats.
- `getPerformance()` — navigation timing (`sampleCount`, `lastMs`, `avgMs`, `minMs`, `maxMs`, capped at the last 50 samples), tab/session switch counts, success rate.
- `getRuntimeInfo()` — API version, engine/sandbox load state, uptime, start time, user agent, active session id.
- Instrumentation hooks into the existing `Engine.onChange` dispatcher (no new event subscriptions, no duplicated wiring) and cleans up its own in-flight timing entry when a tab closes mid-navigation, so it cannot leak.
- `API_VERSION` bumped `1.0.0` → `1.1.0`.

**`test-evidence/block2-step5-part6a-browser-audit-regression-suite.js`** (new file)
- First regression suite to load and exercise `browser-manager.js` itself (previous suites covered `browser-engine.js` only), using the same VM-shim pattern as the Part 1/Part 2 suites.

## Verified (no changes needed)
- `BrowserManager` remains the single public browser gateway; no caller bypasses it to talk to `AxiomBrowserEngine` directly outside of `browser-live.js` (which owns the live iframe by design) and the bridge/agent files that call through `BrowserManager` correctly.
- No duplicate browser-state logic: exactly one `tabs` Map, one `sessions` Map, one `history` array, one event bus, confirmed by reading every consumer.
- `closeTab()` / `endSession()` release their Map entries correctly; a closed tab is fully removed from both `session.tabIds` and the `tabs` Map, and `endSession()` closes every one of its tabs before deleting the session record. No orphaned entries found.
- `os/runtime/capabilities/browser-bridge.js`'s `postMessage` ack listener and frame-poll `setInterval` both clean up correctly on every resolution path (success, timeout, and send-error) — no leaks found.
- `os/workspaces/browser.js` embeds `browser.html` in its own iframe per open, so there is no cross-instance renderer-listener leak to guard against.

## Summary
Part 5 finalizes `BrowserManager` (`window.AxiomBrowserManager`, version `1.0.0`) as the single public gateway for browser automation and introduces a strict execution pipeline:
`BrowserToolRegistry` → `BrowserSandbox` → `Permission Check` → `BrowserManager` → `Browser Engine`.

## Added

**`os/core/browser-sandbox.js`** (new file)
- Security guardrails & permissions module (`window.AxiomBrowserSandbox`).
- Protocol allowlisting (`http:`, `https:`, `about:blank`, `axiom:`).
- Hazardous scheme blocking (`javascript:`, `data:`, `file:`, `vbscript:`, `blob:`).
- Permission check layer (`grantPermission`, `revokePermission`, `hasPermission`, `checkPermission`).

**`os/runtime/capabilities/browser-tool-registry.js`** (new file)
- Centralized Browser Tool Registry (`window.AxiomBrowserToolRegistry`).
- Capability discovery methods: `getTools()`, `listTools()`, `getSchema(name)`, `hasTool(name)`.
- Standardized OpenAI / OpenRouter compatible function-calling schemas for tools: `browser_navigate`, `browser_go_back`, `browser_go_forward`, `browser_refresh`, `browser_search`, `browser_open_tab`, `browser_close_tab`, `browser_switch_tab`, `browser_read_history`, `browser_manage_sessions`, `browser_extract_content`.

**`BROWSER_PUBLIC_APIS.md`** (new file)
- Complete technical API reference manual for public Browser APIs.

**`AGENT_BROWSER_INTEGRATION.md`** (new file)
- Architectural guide for AI Agent tool-calling, security model, and OpenRouter integration extension points.

## Modified

**`os/core/browser-manager.js`**
- Versioned public surface (`API_VERSION: '1.0.0'`).
- Integrated `BrowserSandbox` validation and `checkPermission` rules across navigation requests.

**`os/runtime/agent-definitions/browser-agent.js`**
- Updated `agent.browser` handler to execute browser operations via `AxiomBrowserToolRegistry`.

**`browser.html` & `automation.html`**
- Included `<script defer src="os/core/browser-sandbox.js"></script>` and `<script defer src="os/runtime/capabilities/browser-tool-registry.js"></script>`.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 5 (Part 4): Browser ↔ Automation Integration

**Date:** 2026-08-01
**Scope:** Integrate the Browser Engine with the Automation Engine using `BrowserManager` (`os/core/browser-manager.js`) as the single public entry point for all browser operations. No UI redesign, no OpenRouter connection, no autonomous AI browsing, maintaining full backward compatibility. Full architecture writeup in `AUTOMATION_BROWSER_INTEGRATION.md`.

## Summary
Part 4 creates `BrowserManager` (`window.AxiomBrowserManager` & `window.BrowserManager`) as the central facade for browser automation. All browser operations from Automation Engine steps, AI Agents, and external bridges route through `BrowserManager`'s Navigation, Session, History, Browser Events, Tab, and Metrics APIs.

## Added

**`os/core/browser-manager.js`** (new file)
- Single public entry point for browser automation (`window.AxiomBrowserManager` and `window.BrowserManager`).
- **Navigation API** (`navigate`, `back`, `forward`, `refresh`, `stop`, `redirect`, `getCurrentUrl`, `getNavigationStatus`).
- **Session API** (`createSession`, `closeSession`, `restoreSession`, `switchSession`, `getActiveSession`, `getSessionMetadata`).
- **History API** (`readHistory`, `clearHistory`, `getRecentPages`, `getNavigationTimeline`, `getHistoryMetadata`).
- **Browser Events API** (`on`, `off`, `emit`, emitting `navigation:started`, `navigation:completed`, `navigation:failed`, `page:loaded`, `session:changed`, `tab:changed`, `browser:error`, `loading:progress`).
- **Tab API** (`create`, `close`, `switch`, `getActive`, `list`, `duplicate`, `reorder`).
- **Metrics API** (`getMetrics`, `getStats`) exposing navigation counters, error rates, and active tab/session counts.
- **Execution Helper** (`executeBrowserOp(op, params)`).

**`AUTOMATION_BROWSER_INTEGRATION.md`** (new file)
- Complete technical documentation of Block 2 – Step 5 – Part 4 architecture, APIs, and workflow integration flows.

## Modified

**`os/core/automation-engine.js`**
- Updated `runStep()` to recognize browser step types (`'Browser Automation'`, `'Navigate'`, `'Browser Action'`, `'Browser Search'`, `'Page Fetch'`).
- Routes browser steps directly through `BrowserManager.executeBrowserOp()`, capturing navigation metrics and logs cleanly.

**`os/core/automation-manager.js`**
- Added `browser` accessor on `AxiomAutomationManager` (`getManager()`, `executeOp()`, `getStatus()`).

**`os/runtime/capabilities/browser-bridge.js`**
- Updated `AxiomBrowserBridge.command()` same-window fast path to route operations through `AxiomBrowserManager` while preserving full fallback compatibility.

**`os/runtime/agent-definitions/browser-agent.js`**
- Updated `agent.browser` handler to route browser operations through `AxiomBrowserManager` / `AxiomBrowserBridge`.

**`automation.html` & `browser.html`**
- Added `<script defer src="os/core/browser-manager.js"></script>` in correct dependency order.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 5 (Part 3): Browser Integration Layer

**Date:** 2026-08-01
**Scope:** Connect the Block 2 / Step 5 Browser Engine (Parts 1-2) to the
Brain, Memory, existing Browser UI, and Browser Agent Bridge, plus real
session persistence. No UI redesign, no OpenRouter connection, no
autonomous browsing, no changes to Automation/Analytics/AI Core. Full
findings in `BROWSER_INTEGRATION_REPORT.md`.

## Summary
Auditing the Browser Engine against the four "connect it up" sub-briefs
found that Part C (Browser UI Integration) was already fully done in
Part 1 — `browser-live.js` already held no state of its own and already
routed every control through the engine — so this pass focused on the
three integrations that genuinely didn't exist yet: Brain, Memory, and a
real "restore my last session" flow, plus closing a real gap in the
Browser Agent Bridge left open by Part 2. It also found and fixed one
concrete regression: a legacy decorative script was silently deleting
the real browser `<iframe>` shortly after every page load.

## Added

**`os/core/browser-brain-bridge.js`** (new file)
- Follows the exact convention `brain-automation-bridge.js` already
  established: a guarded, no-op-if-either-side-missing module that
  subscribes to `AxiomBrowserEngine.onChange()` and writes a single live
  `Brain.browser` status pointer via `Brain.setState()` — never a second
  copy of tabs/history.
- Rebuilds `sessionId`/`activeTabId`/`url`/`title`/`canGoBack`/
  `canGoForward`/`tabCount`/`blocked`/`phase` from the engine's own
  `getSnapshot()` on every session/tab/navigation event, so Brain never
  sees a hand-reconstructed value the engine didn't already compute.
- Tracks a `navigating` flag and `lastError` (`{reason, tabId, input, at}`)
  from the real `navigation:started/completed/cancelled/failed` events —
  the error reason is always the engine's own, never invented.
- Seeds once on load from whatever session is already active, so the
  Brain doesn't start blank until the next real event.
- Public surface: `getStats() -> {eventsObserved}`, `destroy()`.

**`os/core/browser-memory-bridge.js`** (new file)
- Follows the exact convention `automation-memory-bridge.js` already
  established: the engine is the producer, `AxiomMemoryEngine` is the
  persistent store, every record is a direct reflection of a real event.
- One `browser-visit` Memory record per real `history:recorded` event
  (which only fires for genuine forward navigations — back/forward/
  refresh replays are explicitly excluded by the engine itself), keyed by
  the engine's own `{url, title, time}` — stable id
  `browser-visit:<time>:<url>`, so a later revisit gets its own distinct
  record rather than a duplicate or an overwrite.
- One `browser-session` Memory record per session id (`browser-session:
  <sessionId>`), rebuilt from `engine.getSession()` + `engine.listTabs()`
  on every session/tab event and overwritten in place — always reflects
  a session's *current* tabs/metadata, never a growing log. A local
  `sessionCache` keeps each session's last-known shape so the record can
  still describe what a session contained at the moment it receives
  `session:ended` (the engine deletes a session's data before that event
  fires).
- Historical visits from before this bridge existed are deliberately not
  bulk-imported on load — only new visits going forward are recorded, to
  avoid a one-time mass import every time this file loads.
- Public surface: `listVisits(opts?)`, `listSessions(opts?)`,
  `getSessionRecord(sessionId)`, `getStats()`, `destroy()` — same plain
  equality/sort/paginate helpers `AxiomAutomationMemoryBridge` already
  uses, no semantic search.

## Changed

**`js/pages/browser-live.js`**
- Session Persistence (Part E): `init()` now calls the engine's existing
  (Part 2, previously never-invoked) `loadSessionSnapshot()`/
  `restoreSession()` to restore the last-saved session under a fixed key
  (`'default'`) instead of always starting blank, and `beforeunload` now
  calls `persistSessionSnapshot()` to save it again. A restored tab is
  rendered directly (no re-navigation, no history/loading event spam),
  matching the behavior `restoreSession()` was already documented to
  expect from its caller. The engine's own `defaultSessionId`/
  `activeSessionId` bookkeeping is left untouched — the page's one unused
  fresh default session is simply never surfaced, rather than calling
  `endSession()` on it and leaving `defaultSessionId` pointing at a
  deleted session.
- New `saveSession` added to both the same-window (`AxiomBrowserLive`)
  and postMessage (`save-session`) public surfaces, for a future explicit
  "save session" UI action.
- No markup, styling, or existing method signatures changed.

**`js/pages/browser-studio-ultimate.js`** — bug fix, not a redesign
- `enhanceBrowser()` used to unconditionally run ~200ms after every
  `browser.html` load and set `viewport.innerHTML = ''` on the *real*
  `.ax-browser-viewport` — deleting the live `<iframe id="axBrowserFrame">`
  and its empty/loading/blocked states that `browser-live.js` holds
  references to, and replacing them with a static mock placeholder driven
  by three hardcoded fake tabs (`'Axiom AI OS'`, `'GitHub'`,
  `'Documentation'`) with no connection to the real engine. This silently
  broke live navigation on every visit to the Browser workspace: once
  the timer fired, further engine-driven UI updates wrote to now-detached
  DOM nodes and the person was stuck looking at the fake placeholder.
- Fixed with a one-line guard: `enhanceBrowser()` now returns immediately
  if `#axBrowserFrame` (the real engine-backed iframe) exists, so the
  legacy mock overlay never runs on `browser.html`. `studios.html`'s
  `enhanceStudios()` path is untouched. No layout, markup, or styling for
  either page was changed — this removes duplicated/conflicting browser
  state per the integration objective, it does not redesign anything.

**`os/runtime/capabilities/browser-bridge.js`**
- The same-window fast path's `command()` switch was missing the Part 2
  ops `stop-loading`/`duplicate-tab`/`reorder-tab` even though
  `browser-live.js` already exposed them on `AxiomBrowserLive` and
  already handled them over `postMessage` — a same-window Browser Agent
  (running directly on `browser.html`) could not reach them. Added all
  three, plus convenience methods `stopLoading()`/`duplicateTab(tabId)`/
  `reorderTab(tabId, index)` alongside the existing ones.

**`os/runtime/agent-definitions/browser-agent.js`**
- Added `'stop-loading'`, `'duplicate-tab'`, `'reorder-tab'` to the
  handler's op switch (calling the newly-exposed bridge methods) and to
  the agent's declared `capabilities` list, so the Browser Agent can
  actually use the full Navigation & Tab Manager surface Part 2 built,
  not just Part 1's original op set.

**`browser.html`**
- Added `<script>` tags for `os/core/browser-brain-bridge.js` and
  `os/core/browser-memory-bridge.js`, loaded right after
  `os/core/browser-engine.js` and before `js/pages/browser-live.js` —
  the same engine → brain-bridge → memory-bridge ordering already used
  by `automation.html` for the Automation Engine's equivalent bridges.
  Scoped to `browser.html` only, matching the existing precedent that
  `brain-automation-bridge.js`/`automation-memory-bridge.js` are likewise
  only loaded on `automation.html`, not on every page.

## Verified
- ✓ All new/changed files pass `node --check` (syntax-valid).
- ✓ The Block 2 / Step 5 / Part 1 and Part 2 regression suites test
  `os/core/browser-engine.js` directly in a Node VM sandbox — this pass
  made no changes to that file, so both suites are unaffected.
- ✓ `browser-live.js`'s existing public surfaces
  (`AxiomBrowserLive`.*, the `postMessage` command set) kept every prior
  method's exact behavior; only additive methods (`saveSession`) and
  additive internal restore/persist calls in `init()`/`beforeunload`
  were added.
- ✓ No duplicate Browser state: Brain gets one live-status pointer
  (`Brain.browser`), Memory gets one record per session (overwritten in
  place) and one per genuinely-new visit — neither bridge keeps a second
  copy of tabs/history/bookmarks alongside the engine's own.
- ✓ No duplicate history/Memory entries: visit records are keyed by
  `<time>:<url>` from the engine's own history entry; session records are
  keyed by `sessionId` and always overwritten, never appended.
- ✓ No visual regressions: `browser-studio-ultimate.js`'s fix is a single
  early-return guard; no markup/CSS/layout touched on either page it
  serves.
- ✓ No console errors expected from the new bridges on pages that don't
  have `AxiomBrowserEngine` loaded — both are guarded no-ops in that case,
  matching every other bridge in this codebase.

## Remaining work (see `BROWSER_INTEGRATION_REPORT.md` §7)
1. No UI for browsing Memory's new `browser-visit`/`browser-session`
   records yet (e.g. a "recent browsing" panel on `memory.html`) —
   read helpers (`listVisits`/`listSessions`) are ready for one.
2. No UI surfaces `Brain.browser` yet (e.g. a "browsing" status card on
   `brain.html`) — the state is live and ready to be read.
3. Session persistence uses one fixed key (`'default'`); multi-window/
   multi-account session persistence needs a real key scheme, per Part
   2's own note that `getActiveSessionId()`/`setActiveSessionId()` already
   support more than one visible session even though nothing creates a
   second one yet.
4. Real web automation / OpenRouter-powered browsing — explicitly out of
   scope per the master order, same as Parts 1 and 2.

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 5 (Part 2): Navigation & Session Manager

**Date:** 2026-08-01
**Scope:** Navigation Manager, Session Manager, Tab Manager, History
Manager, URL Validation, and Loading Lifecycle Manager, all as additive
architecture on top of the Block 2 / Step 5 / Part 1 Browser Engine. No
UI redesign, no OpenRouter connection, no autonomous browsing, no changes
to Brain/Memory/Automation/Analytics/AI Core. Full findings in
`NAVIGATION_SESSION_REPORT.md`.

## Summary
Auditing Part 1's `os/core/browser-engine.js` against this pass's six
sub-briefs found real, working navigation/tabs/sessions/history already
in place — this is a genuine extension, not a rebuild. The one real gap:
`normalizeUrl()` had no explicit protocol allowlist — a `javascript:`/
`data:`/`vbscript:`/`file:` input only avoided being passed straight
through by regex coincidence (it didn't match the `https://` or
bare-domain patterns, so it fell into the search-query branch), not by
deliberate design. Everything else in this pass — stop-loading, redirect
handling, relative-path resolution, session active-tracking/metadata/
serialize/restore/persist, tab duplicate/reorder, history back/forward-
stack + stats accessors, and the granular loading-lifecycle phase model —
is new capability layered on the exact same internal state Part 1 built,
with zero duplicate state and zero changes to any Part 1 method's
existing signature or return value.

## Added

**`os/core/browser-engine.js`** (extended, same module)
- **Navigation Manager** (`engine.navigation.*`, plus new flat methods
  `validateUrl`, `stopLoading`, `reportRedirect`) — `validateUrl(input,
  contextUrl?)` classifies input (`valid`/`invalid`/`search`) without
  mutating state; a `BLOCKED_PROTOCOLS` check now runs before every other
  rule so `javascript:`/`data:`/`vbscript:`/`file:` input is refused
  outright (`navigate()` returns `null` and leaves the tab's `url`
  completely untouched, exactly like Part 1's empty-input case).
  `normalizeUrl(input, contextUrl?)` — Part 1's original function —
  delegates to `validateUrl` and keeps returning exactly what it always
  returned for a single-argument call. Relative paths (`/pricing`)
  resolve against the navigating tab's current origin, but only when
  `navigate()` supplies that context internally — a bare
  `normalizeUrl('/about')` call still falls through to a search query,
  unchanged from Part 1. `stopLoading()` cancels an in-flight navigation
  (no-op once settled). `reportRedirect()` updates the current history
  entry in place instead of pushing a new one. `engine.navigation.navigate()`
  is a new, additive entry point returning `{ok, url, reason}` for future
  callers, alongside the untouched original `engine.navigate()`.
- **Session Manager** (`engine.sessions.*`, plus new flat methods) — a
  new `activeSessionId` pointer (`getActiveSessionId`/
  `setActiveSessionId`), independent of any single session's own
  `activeTabId`, for a future multi-window UI. `updateSessionMetadata()`
  merges into a new `metadata` field on each session. `serializeSession()`/
  `restoreSession()` really save and rebuild a session's tabs (into a
  brand-new session, never overwriting one) without spamming global
  history. `persistSessionSnapshot()`/`loadSessionSnapshot()`/
  `listPersistedSessionKeys()` are real, callable persistence hooks
  behind the same namespaced `StorageAdapter` Part 1 built — verified to
  round-trip through `localStorage` to an independent engine instance —
  but nothing calls them automatically; a session stays exactly as
  ephemeral as Part 1 left it unless a caller explicitly persists it.
- **Tab Manager** (`engine.tabs.*`, plus new flat methods) —
  `duplicateTab()` (copies state into a new tab, inserted next to its
  source, refused across sessions) and `reorderTabs()` (moves a tab
  within its session, clamping out-of-range indices).
- **History Manager** (`engine.history.*`, plus new flat methods) —
  `getBackStack()`/`getForwardStack()` expose a tab's existing nav stack
  as plain arrays; `getHistoryStats()` aggregates real per-host visit
  counts from the same history log, built for Memory's later use.
- **Loading Lifecycle Manager** (`engine.loadingLifecycle.*`) — a
  granular phase model (`started → connecting → loading →
  [redirecting] → content-ready → completed`, or `failed`/`cancelled`)
  layered on top of Part 1's coarse `tab.status`, driven by the exact
  same `reportLoading`/`reportLoaded`/`reportBlocked`/`reportError` calls
  `browser-live.js` already makes plus the new `stopLoading()`. `started`/
  `connecting` are explicitly placeholder-timed — no real DNS/connection
  data is available to this architecture, as allowed by the spec.
- All five namespaces are thin wrappers around the same `tabs`/`sessions`
  Maps and `history`/`bookmarks`/`downloads` arrays Part 1 already had —
  `engine.tabs.create()` and `engine.createTab()` mutate the identical
  state (verified in the regression suite). Every Part 1 flat method is
  still present, unchanged, for full backward compatibility.

## Changed

**`js/pages/browser-live.js`**
- Added `stopLoading()`/`duplicateTab()`/`reorderTab()` wrapper functions
  (thin calls into the engine), exposed on `window.AxiomBrowserLive`.
- Added three `postMessage` ops — `stop-loading`, `duplicate-tab`,
  `reorder-tab` — to the existing command handler, same ack contract as
  every other op.
- `onEngineChange` now also refreshes the tab strip on the new
  `tab:duplicated`/`tab:reordered` events (grouped with the existing
  `tab:closed`/`tab:status` handling) — neither changes what the active
  tab is showing, so no `<iframe>` reload is triggered.
- **No markup, layout, or visual changes.** No new buttons, menus, or
  panels were added to `browser.html` — the new Tab Manager capabilities
  are reachable via `AxiomBrowserLive`/`postMessage` for a future UI or
  Agent integration to wire up, per "do not redesign the UI."

**`browser.html`** — no changes needed; `os/core/browser-engine.js` was
already loaded by Part 1 and this pass's additions all live inside that
same file.

## Not changed (explicitly out of scope)

- Brain, Memory, Automation, Analytics, AI Core, OpenRouter, and all
  existing layouts/styling — untouched, as required.
- `os/runtime/capabilities/browser-bridge.js` / `browser-agent.js` — still
  only know the Part 1 command set; teaching the Browser Agent the new
  `stop-loading`/`duplicate-tab`/`reorder-tab` ops is Agent-side work.
- No automatic/continuous session persistence — the new persist/restore
  hooks are real but opt-in only (see "Remaining work" below).
- No real web automation, no OpenRouter wiring — same as Part 1.

## Validation
`test-evidence/block2-step5-part2-navigation-session-regression-suite.js`
— 28 checks, all passing, loading the real, unmodified (post-Part-2)
`os/core/browser-engine.js` in a Node `vm` sandbox. Covers: all four
blocked protocols rejected by `validateUrl()`/`normalizeUrl()` and a
blocked `navigate()` leaving tab state untouched; `engine.navigation.navigate()`'s
rich result shape; relative-path resolution against a real tab origin,
and the exact-Part-1-behavior fallback when no context is given; the
full loading-lifecycle phase sequence for a real navigation, both failure
paths landing on `'failed'` while `status` still distinguishes why,
`stopLoading()`'s mid-flight-only contract, and `reportRedirect()`
updating history in place; `duplicateTab()`/`reorderTabs()` including
cross-session refusal and out-of-range clamping; active-session tracking
independent of per-session active tabs, metadata merge, serialize/restore
into a genuinely new session with the correct active tab preserved,
persist/load round-tripping through `localStorage` to an independent
engine instance, and an explicit check that nothing auto-persists;
`getBackStack()`/`getForwardStack()`/`getHistoryStats()`; the namespaced
manager surfaces operating on the identical state as the flat methods (no
duplicate state); exactly one `tab:navigated`/`navigation:started` pair
per `navigate()` call (no duplicate events); `init()` called five times
still yielding exactly one default session (no duplicate session
creation); and a realistic multi-feature workflow running end-to-end
without throwing. **Re-ran the full Part 1 suite (21 checks) against this
same, now-extended engine file at the end of the Part 2 suite — all still
pass unchanged, confirming zero regressions to the existing Browser UI.**

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 5 (Part 1): Browser Engine Foundation

**Date:** 2026-07-31
**Scope:** Build the Browser Engine architecture only — lifecycle, tabs,
sessions, navigation, history, browser state (loading/blocked/error). No
real web automation, no OpenRouter wiring, no UI redesign. Full findings
in `BROWSER_FOUNDATION.md`.

## Summary
Auditing `browser.html` / `js/pages/browser-live.js` found a fully working
browser workspace (tabs, back/forward, bookmarks, history, downloads,
reading mode, link/image extraction) but **no separate browser
architecture at all** — every piece of state lived as module-closure
arrays mixed directly into the DOM code that manipulates the live
`<iframe>`. That made the state impossible to reuse from anywhere that
isn't `browser.html`'s exact markup, which is a real gap given that
`os/runtime/capabilities/browser-bridge.js` (used by the Browser Agent
from Brain, Automation, and Memory's pages) already depends on this state
existing somewhere stable. This pass extracts that state into a new,
headless `os/core/browser-engine.js` — following the same convention as
`os/core/memory-engine.js` and `os/core/automation-engine.js` — and turns
`browser-live.js` into a thin DOM renderer on top of it.

## Added

**`os/core/browser-engine.js`** (new module — `window.AxiomBrowserEngine`)
- **Lifecycle** — `init()` is idempotent (a second call returns the same
  default session, mirroring the Memory/Automation engines' pattern) and
  performs a one-time migration of the three legacy localStorage keys
  `browser-live.js` used to write directly (`axiom-browser-bookmarks`,
  `axiom-browser-history`, `axiom-browser-downloads`) into a namespaced,
  schema-versioned store (`axiom:browser:v1:*`) so upgrading never
  discards a person's saved bookmarks/history/downloads.
- **Sessions** (`createSession`/`getSession`/`listSessions`/`endSession`)
  — a session groups tabs. The default session (created by `init()`) is
  the one visible browser workspace; `createSession({ background: true })`
  makes an isolated session with its own tabs, entirely separate from
  what the person is looking at — the integration point a future
  autonomous browsing agent will use so its browsing never disturbs the
  user's open tabs.
- **Tabs** (`createTab`/`closeTab`/`switchTab`/`getActiveTab`/`listTabs`)
  — same per-tab navigation stack (`hist`/`histIndex`) `browser-live.js`
  always used, now owned by the engine. Closing the last tab in a session
  still auto-opens a fresh blank one (same behavior as before, verified
  in the regression suite).
- **Navigation** (`navigate`/`goBack`/`goForward`/`refresh`,
  `normalizeUrl`) — the exact url-normalization rules `browser-live.js`
  always used (bare domain → `https://`, anything else → a DuckDuckGo
  search), moved here verbatim so every caller agrees on them.
- **Browser state** — a small status model per tab
  (`empty`/`loading`/`loaded`/`blocked`/`error`) driven by
  `reportLoading`/`reportLoaded`/`reportBlocked`/`reportError`, called by
  the DOM renderer only after the real `<iframe>` actually settles — the
  engine never assumes a navigation succeeded on its own.
- **History / bookmarks / downloads** — moved here verbatim from
  `browser-live.js` (same shapes), now behind the namespaced storage
  adapter instead of three separate ad-hoc localStorage calls.
- **Pub/sub** (`onChange(fn)`) — emits granular events
  (`session:started`/`ended`, `tab:created`/`switched`/`closed`/
  `navigated`/`status`, `bookmark:added`/`removed`, `history:recorded`/
  `cleared`, `download:recorded`/`downloads:cleared`,
  `engine:initialized`) so any page or subsystem can react to browser
  state without polling. A throwing listener is isolated and cannot break
  other listeners or the engine itself.
- `getSnapshot(sessionId)` — same shape `browser-live.js`'s old
  `getSnapshot()` always returned, so
  `os/runtime/capabilities/browser-bridge.js` and `browser-agent.js` need
  zero changes. `getState()`/`getStats()` added for debugging and future
  Agent introspection.

## Changed

**`js/pages/browser-live.js`**
- No longer holds any browser state of its own. Rewritten as a DOM
  renderer over `window.AxiomBrowserEngine`: every function that used to
  read/mutate the local `tabs`/`activeTabId`/`bookmarks`/`history`/
  `downloads` arrays now calls the matching engine method, and a single
  `onEngineChange` subscription drives the existing tab strip / bookmarks
  panel / history panel rendering.
- The public surfaces this file exposes are **unchanged**:
  `window.AxiomBrowserLive` has the exact same method names/signatures as
  before, and the `postMessage` command handler (`axiom-browser-command`
  → `axiom-browser-ack`) has the exact same ops and payload shapes. No
  changes were needed in `browser-bridge.js` or `browser-agent.js`.
- No markup, layout, or visual styling touched — same `browser.html`,
  same IDs, same CSS.

**`browser.html`**
- Added `<script defer src="os/core/browser-engine.js">` immediately
  before the existing `js/pages/browser-live.js` include.

## Not changed (explicitly out of scope)

- No real web automation — navigation still only resolves because a real
  `<iframe>` in `browser-live.js` loads it and reports back; the engine
  itself never reaches out to the network on its own initiative.
- No OpenRouter / AI wiring.
- Tabs and sessions are still ephemeral (not persisted across a hard
  reload) — same behavior as before. See `BROWSER_FOUNDATION.md` §5 for
  why this is flagged as remaining work rather than done here.

## Validation
`test-evidence/block2-step5-part1-browser-foundation-regression-suite.js`
— 21 checks, all passing, loading the real, unmodified
`os/core/browser-engine.js` in a Node `vm` sandbox. Covers: idempotent
`init()`; background/agent session isolation from the default session;
tab lifecycle including the "closing the last tab reopens a blank one"
and "closing a non-active tab leaves the active tab alone" behaviors;
`switchTab()` correctly rejecting a foreign session's tab id; url
normalization; back/forward walking the real per-tab history stack
including forward-stack truncation on a new navigation; the
loading/loaded/blocked/error status model and its effect on
`getSnapshot().blocked`; `getSnapshot()`'s shape matching the pre-Engine
version exactly; bookmarks/history/downloads CRUD; persistence to a
**second, independent engine instance** reading the same localStorage
(proving writes go through the storage layer, not an in-process array);
one-time legacy-key migration that does not re-apply on a later reload;
pub/sub delivery and unsubscribe; a throwing listener not breaking
others; and a full realistic multi-tab session running end-to-end
without throwing.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 4 (Part 4): Automation Manager

**Date:** 2026-07-31
**Scope:** Build one centralized Automation Manager — Queue Manager,
Workflow Manager, Execution Monitor, Status API, History API — as the
single enforced surface for starting automation runs. No new storage, no
engine business-logic changes, no UI changes. Full findings in
`AUTOMATION_MANAGER.md`.

## Summary
Parts 1-3 built three real, independent pieces (the execution engine, the
Brain connector, the Memory connector) but nothing centralized them, and
nothing enforced any policy at the point a run actually starts. Auditing
the objective's "no duplicate execution" requirement against
`js/pages/automation-runtime-ui.js`'s `#runWorkflowNow` handler and
`enqueueRun()` found a real gap: neither guards against a double-click
starting two runs of the same workflow at once. This pass adds a new
composing Manager module whose enforced `run.start()`/`run.retry()` close
that gap, alongside read-only Execution Monitor and Status API layers and
Workflow/Queue/History passthroughs.

## Added

**`os/core/automation-manager.js`** (new module —
`window.AxiomAutomationManager`)
- **Workflow Manager** (`workflows.*`) — direct passthrough to
  `AxiomAutomationBuilderEngine`'s existing workflow CRUD.
- **Queue Manager** (`queue.*`) — `getState()` passthrough plus
  `listPending()`/`listRunning()` filters over the engine's own
  `listRuns()`.
- **Run control** (`run.*`) — `start(workflowId, opts)` and
  `retry(runId, opts)` are the enforced entry points: each refuses to
  start a new run when a real in-flight run (`queued`/`running`/`paused`)
  of the same workflow already exists (`reason: 'duplicate-in-flight'`,
  returning the real existing run), unless the caller explicitly passes
  `opts.force: true`. `cancel`/`pause`/`resume`/`get`/`list` are direct
  passthroughs — no duplicate concern applies to stopping or resuming an
  existing run.
- **Execution Monitor** (`monitor.*`) — `getActiveRuns()` /
  `getRunProgress(runId)` derive `elapsedMs`/`stepIndex`/`stepCount`/
  `percentComplete` read-only from fields the engine already tracks
  (nothing stored, nothing guessed); `getErrorRecoveryStats()` derives
  real counts (step retries observed, runs recovered after a retry, runs
  failed after retries) from the engine's own run history.
- **Status API** (`status.*`) — `getStatus()` rolls up real queue state +
  engine stats + active-run count + this Manager's own counters (plus
  Brain's live automation pointer, read-only, if `AxiomBrain` is present);
  `getWorkflowStatus(id)` reports a workflow's in-flight state and last
  run.
- **History API** (`history.*`) — direct passthrough to
  `AxiomAutomationMemoryBridge`'s existing `listExecutionHistory`/
  `getExecutionHistory`/`listActions` — the Manager stores no history of
  its own.
- `getStats()` / `onChange()` (passthrough to the engine's own pub/sub) /
  `destroy()` exposed for tests and page teardown.

No changes were needed to `os/core/automation-engine.js`,
`os/core/brain-automation-bridge.js`, or `os/core/automation-memory-bridge.js`
themselves — the gap this pass found was a missing policy layer (the
duplicate-execution guard), not a missing engine capability.

## Changed

**`automation.html`**
- Added `<script defer src="os/core/automation-manager.js">` immediately
  after `os/core/automation-memory-bridge.js`, where
  `os/core/automation-engine.js` and `os/core/automation-memory-bridge.js`
  are both already loaded earlier on the page.

## Not changed (explicitly out of scope)

- `js/pages/automation-runtime-ui.js`'s `#runWorkflowNow` handler still
  calls `AxiomAutomationBuilderEngine.enqueueRun()` directly — it does not
  yet route through `AxiomAutomationManager.run.start()`, so the existing
  button does not yet benefit from the new duplicate-execution guard.
  Rewiring that click handler is a UI change and was not requested for
  this pass ("Do NOT change existing UI").

## Validation
`test-evidence/block2-step4-part4-automation-manager-regression-suite.js`
— 39 checks, all passing, loading the real, unmodified `memory-engine.js`,
`automation-engine.js`, `automation-memory-bridge.js`, and
`automation-manager.js` in a Node `vm` sandbox and driving everything
through `AxiomAutomationManager`'s own public API. Covers: Workflow
Manager passthrough and pre-flight rejection of a draft/unknown workflow;
a normal run genuinely executing end-to-end; the core "double-click"
scenario — a second `run.start()` on the same in-flight workflow refused
with the real existing run returned, confirmed against the engine that
only one run was ever enqueued, and `opts.force` genuinely bypassing the
guard; `run.retry()` carrying the identical guard; `cancel`/`pause`/
`resume` passthrough reaching the real engine; Execution Monitor
reporting real derived progress while in flight and `null` once settled;
Status API numbers matching the engine's own directly; History API
returning the Part 3 bridge's real stored records; and `getStats`/
`onChange`/`destroy`. Re-ran the Part 1 automation-foundation suite (17
checks), the Part 2 brain-automation suite (29 checks), the Part 3
automation-memory suite (30 checks), and all three Memory suites
(foundation, brain-memory, memory-manager — 35 + 28 + 30 checks)
afterward to confirm no regression.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 4 (Part 3): Connect Memory to Automation

**Date:** 2026-07-31
**Scope:** Persist automation history — execution history, results, errors,
runtime, metadata, and user actions (pause/resume) — into `AxiomMemoryEngine`
(`os/core/memory-engine.js`), and support browsing that history. No vector
memory, no AI reasoning. Full findings in `AUTOMATION_MEMORY_REPORT.md`.

## Summary
Part 2 connected the Brain to Automation, but Brain only ever holds the
single most-recently-observed run as a live status pointer — once the next
run started, the previous run's outcome was gone from shared state. This
pass adds a direct Automation -> Memory connector so every run's real
outcome, results, errors, and runtime are durably stored and browsable,
independent of whatever the Brain's live pointer currently shows.

## Added

**`os/core/automation-memory-bridge.js`** (new module —
`window.AxiomAutomationMemoryBridge`)
- Subscribes to `AxiomAutomationBuilderEngine.onChange()` and writes one
  `automation-run` Memory record per run the moment it reaches a genuinely
  terminal status (`success` / `failed` / `cancelled`) — not one record per
  intermediate step or queue tick. Each record carries the run's real
  `steps` (label/type/status/attempts/error/result), run-level `error`,
  `duration` (verbatim from the engine, never recomputed), and metadata
  (`runId`, `workflowId`, `workflowName`, `trigger`, `queuedAt`).
- Writes a separate `automation-action` Memory record for each real
  `paused` event and each real paused -> running (resume) transition —
  the only pause/resume signals the engine actually emits. A cancellation
  has no separate observable "requested" event from the engine, so it is
  captured inside that run's own terminal history record instead of being
  invented as a standalone action.
- Stable record ids (`automation-run:<runId>`) make re-observing the same
  terminal run idempotent — `AxiomMemoryEngine.addMemory()` overwrites in
  place rather than duplicating, which also makes the startup seed pass
  (backfilling any run that finished before this bridge was subscribed on
  the current page load) safe to re-run.
- `listExecutionHistory(opts?)` / `getExecutionHistory(runId)` /
  `listActions(opts?)` expose plain equality/sort/paginate browsing over
  the stored history — no embeddings, no semantic search, matching
  `AxiomMemoryManager`'s existing non-semantic read-layer conventions.
  Because storage goes through the standard `AxiomMemoryEngine.addMemory`/
  `queryMemories` API, this history is also reachable from any page (e.g.
  the Memory page) via `AxiomMemoryManager.findMemories({ type:
  'automation-run' })` without further wiring.
- `getStats()` / `destroy()` exposed for tests and page teardown, mirroring
  `brain-automation-bridge.js`'s and `brain-memory-bridge.js`'s existing
  shape.

No changes were needed to `os/core/automation-engine.js` or
`os/core/memory-engine.js` themselves — unlike Part 2, this pass found no
gap in either engine's existing public API (`onChange`, `listRuns`,
`addMemory`, `queryMemories`, `getMemory` already covered everything
required).

## Changed

**`automation.html`**
- Added `<script defer src="os/core/automation-memory-bridge.js">`
  immediately after `os/core/brain-automation-bridge.js`, where
  `os/core/memory-engine.js` and `os/core/automation-engine.js` are both
  already loaded earlier on the page.

## Validation
`test-evidence/block2-step4-part3-automation-memory-integration-regression-suite.js`
— 30 checks, all passing, loading the real, unmodified `memory-engine.js`,
`automation-engine.js`, and `automation-memory-bridge.js` in a Node `vm`
sandbox and driving them through the engines' real public APIs (no
shortcuts into `AxiomMemoryEngine.addMemory()` to fake a result). Covers a
genuinely successful run's stored results/runtime, a genuinely failing
run's real run- and step-level errors, pause/resume producing their own
action records with the real step they occurred at, a cancellation being
captured in the run's own terminal record rather than a fabricated
standalone action, workflow/status filtering and pagination, stable-id
overwrite idempotency, and a freshly-loaded bridge instance backfilling
existing terminal runs on seed. Re-ran the Part 1 automation-foundation
suite (17 checks), the Part 2 brain-automation suite (29 checks), and all
three Memory suites (foundation, brain-memory, memory-manager — 35 + 28 +
30 checks) afterward to confirm no regression.

## Explicitly out of scope
No changes to the Automation page's run-history table or any new history
browsing UI (`js/pages/automation-runtime-ui.js` and `memory-ultimate.js`
are untouched) — this pass adds the real persistence and a stable read API
for it; a UI to browse it is a separate task. No vector search, embeddings,
or AI summarization of stored history. No change to Brain's own live
`automation` status pointer (`brain-automation-bridge.js`) or to the
unrelated agent-collaboration workflow system in
`os/runtime/capabilities/workflows.js`.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 4 (Part 2): Connect Brain to Automation

**Date:** 2026-07-31
**Scope:** Connect `AxiomBrain` (`os/core/axiom-brain.js`) to
`AxiomAutomationBuilderEngine` (`os/core/automation-engine.js`, Part 1) so
the Brain receives live automation events: workflow started, running,
paused, completed, failed, cancellation, and queue updates. No UI redesign,
no new pages. Full findings in `AUTOMATION_INTEGRATION_REPORT.md`.

## Summary
Part 1 built a real automation execution engine, but nothing connected it
to the Brain — a workflow could run, fail, retry, or get cancelled and the
shared AI state object had no idea. This pass adds the missing connector.
Auditing the objective's checklist against Part 1's engine surfaced one
real gap first: the run lifecycle had no `paused` state at all, so
"workflow paused" had nothing honest to connect to — the minimal fix is
included below rather than fabricating a status that could never fire.

## Added

**`os/core/brain-automation-bridge.js`** (new module —
`window.AxiomBrainAutomationBridge`)
- Subscribes to `AxiomAutomationBuilderEngine.onChange()` and writes a new
  `automation` field on `AxiomBrain`'s state: `status` (`idle | queued |
  running | paused | success | failed | cancelled`), `runId`,
  `workflowId`, `workflowName`, and `queue` (`pending`/`running`/
  `concurrency`).
- Every write is a direct reflection of a real `run:create` / `run:update`
  / `queue` event the engine already emitted — nothing is invented, and
  workflow-*definition* bookkeeping events (`workflow:create/update/
  delete`, `init`, `import`) are deliberately not surfaced, since the
  objective is live run activity, not the workflow catalog.
- De-duplicates on `runId + status` so a redundant emit of the same status
  never produces a spurious Brain `change` tick; queue counts are written
  on every real `queue` event since repeated identical counts are accurate
  current state, not a duplicate to filter.
- `getStats()` / `destroy()` exposed for tests and page teardown, mirroring
  `brain-memory-bridge.js`'s existing shape.

**`os/core/automation-engine.js`** — `pauseRun(runId)` / `resumeRun(runId)`
(genuine addition, not previously possible)
- A run can now only be paused while `'running'`; the pause is cooperative
  and only takes effect at the next step boundary (never mid-step, same
  pattern already used for cancellation) — the run's status only flips to
  `'paused'` once it has actually stopped advancing.
- `resumeRun()` continues execution from exactly the step it was paused
  at; every step still genuinely runs — nothing is skipped or marked done
  without executing.
- `cancelRun()` extended to accept a `'paused'` run: cancelling a parked
  run wakes it via its pause-wait promise so it can observe the
  cancellation and unwind, instead of leaving it stuck forever.
- Crash/reload recovery on `init()` now treats a run left `'paused'` from a
  previous page load the same as `'queued'`/`'running'` — recovered as
  `'failed'` with an explicit "interrupted" reason, never silently
  resumed or reported successful.

## Changed

**`os/core/axiom-brain.js`** — extended, not replaced
- Added `automation` to `DEFAULT_STATE`, additive alongside the existing
  `activeModel` / `activeConversationId` / `toolActive` / `activeTool`
  fields from Block 2 · Step 2 · Part 2.

**`automation.html`**
- Added `<script defer src="os/core/brain-automation-bridge.js">`
  immediately after `os/core/automation-engine.js` (with
  `os/core/axiom-brain.js` already loaded earlier on the page).

## Validation
`test-evidence/block2-step4-part2-brain-automation-integration-regression-suite.js`
— 29 checks, all passing, loading the real unmodified modules in a Node
`vm` sandbox and driving them through the engine's real public API (no
shortcuts into `AxiomBrain.setState()`). Covers started/running/completed,
pause-and-resume (including that a paused run's step index genuinely stops
advancing), a genuinely-failing run (`Condition` step evaluated false),
cancellation of both a running and a paused run, queue updates under a
concurrency-1 burst, rejection of `pauseRun()` on an already-settled run,
and bridge `destroy()` cleanup. Re-ran Part 1's own regression suite
(17 checks) afterward to confirm no regression from the engine change.

## Explicitly out of scope
No changes to the Automation page's visual builder, canvas, run-history
table, or any new pause/resume UI control; no change to the unrelated
agent-collaboration workflow system (`os/runtime/capabilities/
workflows.js`) or the separate Milestone 13 `os/runtime/automation/
automation-engine.js`; no writes from automation events into
`AxiomMemoryEngine`.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 4 (Part 1): Build the Automation Engine Foundation

**Date:** 2026-07-31
**Scope:** Replace the Automation page's placeholder execution logic
(a static "Recent Workflow Runs" table with hardcoded rows, and a
"Publish Workflow" button that only showed a toast) with a real
execution engine underneath the existing Visual Automation Builder UI.
Full findings in `AUTOMATION_FOUNDATION.md`.

## Summary
The Automation page (`automation.html` + `js/pages/automation-part9.js`)
already had a working drag-and-drop canvas, integrations grid, API
Builder, and Webhook Builder — but nothing under any of it. Publishing
a workflow did nothing but show a toast; the run history table was five
rows of fixed markup that never changed no matter what a user did. This
pass adds the missing execution layer without touching the canvas,
tabs, integrations, API Builder, or Webhook Builder logic.

## Added

**`os/core/automation-engine.js`** (new module — `window.AxiomAutomationBuilderEngine`)
- Workflow storage — steps captured from the canvas, CRUD, draft/active
  state, persisted to `localStorage` (namespaced, schema-versioned,
  same `StorageAdapter` pattern as `os/core/memory-engine.js`).
- Execution queue — FIFO with bounded concurrency (default 2); runs
  beyond the concurrency limit genuinely wait their turn instead of
  firing instantly.
- Task/run lifecycle — one state machine per run: `queued` → `running`
  → `success` / `failed` / `cancelled`. No step is ever marked done
  without actually running; a run's final status is derived from what
  its steps actually did.
- Execution state — per-run and per-step status, timestamps, duration,
  and a `currentStepIndex` pointer, all readable via `getRun()` /
  `listRuns()`.
- Cancellation — cooperative: a cancel request is checked between
  steps and interrupts an in-flight step's wait, so `cancelRun()`
  actually stops execution rather than only flipping a label.
- Error recovery — steps that stand in for network-backed actions
  (API Call, Webhook, AI Generate, Send Email, GitHub, Slack, Google
  Drive, WhatsApp) get one retry with backoff; a run-level `retryRun()`
  re-queues a fresh attempt cloned from a failed or cancelled run.
- Logging — structured, timestamped, capped log lines per run
  (`run.logs`), covering queueing, each step attempt, retries,
  failures, cancellation, and completion.
- Crash/reload honesty — a run left `queued` or `running` from a
  previous page load (tab closed mid-run) is recovered as `failed`
  with an explicit "interrupted" reason on `init()`, never silently
  reported as successful and never silently resumed.
- `getStats()` / `getQueueState()` — real counts (active workflows,
  runs today, failed runs today, pending/running) for the page's stat
  cards, not fixed numbers.
- `onChange(fn)` — pub/sub so the UI reacts to every mutation without
  polling.

**`js/pages/automation-runtime-ui.js`** (new module)
- Reads the live canvas nodes on publish and persists them as a real
  workflow through the engine; "Publish Workflow" now does something.
- New "Run Now" button (disabled until a workflow is published) enqueues
  a real run.
- Renders "Recent Workflow Runs" from `engine.listRuns()` — no
  hardcoded rows; the table starts empty and fills in as runs execute.
- Per-run Cancel / Retry actions wired to `cancelRun()` / `retryRun()`.
- Stat cards (Active Workflows / Total Runs Today / Failed Runs) driven
  by `engine.getStats()`.

## Changed

**`js/pages/automation-part9.js`**
- `initPublish()` no longer just toasts "Workflow published" — it
  dispatches an `axiom:automation:publish-request` event that
  `automation-runtime-ui.js` handles. This file still owns the canvas,
  tabs, integrations grid, API Builder, and Webhook Builder, unchanged.

**`automation.html`**
- Loads `os/core/automation-engine.js` (alongside the other `os/core`
  engines) and `js/pages/automation-runtime-ui.js` (after
  `automation-part9.js`).
- Added a disabled-until-published "Run Now" button next to "Publish
  Workflow".
- Replaced the five hardcoded "Recent Workflow Runs" rows with an empty
  `<tbody id="axRunsTableBody">`, rendered live; the existing
  `#axRunsEmpty` empty-state div (previously dormant/`hidden` with no
  code to ever un-hide it) is now actually toggled.
- Added an "Actions" column to the runs table for Cancel/Retry.
- Replaced the three hardcoded stat-card numbers with live ids
  (`axMetricActiveWorkflows`, `axMetricRunsToday`, `axMetricFailedRuns`).

## Explicitly out of scope (per spec)
- Real external integrations (Slack/GitHub/Email/etc. actually calling
  out over the network) — steps run through a local, honest simulated
  action layer that still does real async work and can really fail, so
  the engine (queueing, lifecycle, retries, cancellation, logging) is
  real even though the network calls it will one day make are not.
- Any change to the canvas, tabs, integrations grid, API Builder, or
  Webhook Builder markup/behavior.
- The unrelated agent-collaboration workflow system in
  `os/runtime/capabilities/workflows.js` (task-router/agent-manager
  bus) — a different subsystem, not touched.

## Verified
`test-evidence/block2-step4-part1-automation-foundation-regression-suite.js`
(17/17 passing, output in the matching `-output.txt`) loads the real,
unmodified engine module in a Node `vm` sandbox with real timers (no
stubbed/instant execution) and exercises: workflow CRUD, publish,
successful end-to-end run lifecycle with real timestamps/duration/logs,
retry-then-succeed, a step that fails all attempts genuinely failing
the run, a condition step failing honestly when unmet, queued-run
cancellation, in-flight cancellation, retry-from-failed, live queue
counts, workflow deletion, export/import round-trip, state surviving a
simulated reload, and honest recovery of an interrupted run.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 3 (Part 3): Build the Memory Manager

**Date:** 2026-07-31
**Scope:** Add a stable, read-oriented Memory Manager API in front of the
Part 1 foundation (`os/core/memory-engine.js`) and the Part 2 connector
(`os/core/brain-memory-bridge.js`). Full findings in
`MEMORY_MANAGER_REPORT.md`.

## Summary
Part 1 built persisted storage; Part 2 connected the Brain to it. Neither
gave consumers a retrieval-focused API — every page had to slice, sort,
and aggregate the engine's raw arrays itself, with no session browsing
and no protection against duplicate writes at the call site. This pass
adds that layer without touching either existing module.

## Added

**`os/core/memory-manager.js`** (new module — `window.AxiomMemoryManager`,
`API_VERSION` `1.0.0`)
- `getConversation(id, opts)` / `listConversations(opts)` — single and
  paginated conversation lookup with agent/project/title/active filters
  and recent/oldest sorting.
- `findMemories(filter, opts)` — the engine's own `queryMemories()`
  filter shape, plus sorting (recent/oldest/importance/confidence) and
  pagination.
- `listSessions(opts)` / `getSession(id)` — browse every known session
  (active and ended), with derived `status` and `durationMs`.
- `getMetadataSummary()` / `getOverview()` — tag/agent/project/type
  counts, importance/confidence distributions, and a dashboard-sized
  top-N summary merged with engine stats.
- `runCleanup()` — drives the engine's existing `cleanup()` and reports
  a before/after breakdown (`memoriesRemoved`, `sessionsRemoved`)
  instead of a bare boolean.
- `registerMemory(record)` / `ensureConversation(id, extra)` — dedupe-
  guarded write-adjacent helpers: an exact `(text, agent, project,
  type)` match or an existing conversation id is returned as-is rather
  than duplicated.
- `onChange(fn)` — passthrough to the engine's own pub/sub, so Manager
  reads never drift from engine writes.

**12 HTML pages** — `os/core/memory-manager.js` added after
`memory-engine.js`/`brain-memory-bridge.js`: `memory.html`, `admin.html`,
`workspace.html`, `browser.html`, `agent-library.html`, `studios.html`,
`playground.html`, `analytics.html`, `billing.html`, `settings.html`,
`automation.html`, `brain.html`.

**`test-evidence/block2-step3-part3-memory-manager-regression-suite.js`**
(new, Node `vm`-based, no jsdom) — 30 assertions across 7 groups: API
surface/back-compat, conversation lookup, memory filtering, session
browsing, metadata retrieval, cleanup reporting, and duplicate/
performance checks (50x repeated idempotent calls, 2,000-record
filter+sort under 1s). All 30 passing — see
`test-evidence/block2-step3-part3-memory-manager-regression-output.txt`.

## Not changed
- `os/core/memory-engine.js` — untouched, same public API as Part 1/2.
- `os/core/brain-memory-bridge.js` — untouched, same behavior as Part 2.
- No vector search, embeddings, semantic memory, or long-term AI
  reasoning added — out of scope per spec (Version 2).

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 3 (Part 2): Connect Brain to Memory

**Date:** 2026-07-31
**Scope:** Connect `AxiomBrain` to `AxiomMemoryEngine` — Brain as producer,
Memory as persistent store. Full findings in `MEMORY_INTEGRATION_REPORT.md`.

## Summary
Part 1 built a real memory foundation; a separate earlier pass made
`AxiomBrain` reflect real AI-pipeline state. Nothing connected the two —
`AxiomMemoryEngine` was only ever loaded on `memory.html`, and no listener
anywhere turned a Brain state change or a real chat message into a Memory
write. This pass adds that connector and closes the single-page gap.

## Added

**`os/core/brain-memory-bridge.js`** (new module — `window.AxiomBrainMemoryBridge`)
- Records real user prompts and AI responses from `axiom:message-appended`
  (already dispatched by `js/core/app.js` for every rendered chat bubble)
  into `AxiomMemoryEngine.addMessage()`, tagged with the Brain's live
  `activeModel`.
- Records the active conversation's real start/end from `conversation:*`
  events on the Agent Event Bus DOM mirror.
- Keeps conversation metadata (active model, tool state) in sync via the
  new `updateConversationMeta()`, and refreshes the Memory session
  heartbeat on every real Brain change (`touchSession()`).
- Records AI lifecycle events (activity/tool transitions) as short-lived,
  ttl-bearing memory entries — an activity log, not permanent long-term
  memory — written once per genuine transition, never per Brain tick.
- Dedup guards throughout: a `Set` of already-recorded message ids, a
  `hasConversation()` check before ever creating a conversation record,
  and signature comparisons before any metadata/lifecycle write.

## Changed

**`os/core/memory-engine.js`** (extended, Part 1's existing API untouched)
- Added `hasConversation(id)` and `updateConversationMeta(id, patch)` so a
  producer (the bridge) can check for and attach live metadata to a
  conversation without touching message history or any other field.

**12 HTML pages** — `os/core/memory-engine.js` (where missing) and
`os/core/brain-memory-bridge.js` added right after
`js/core/ai-state-manager.js`, so every page that carries the Brain
(`memory.html`, `admin.html`, `workspace.html`, `browser.html`,
`agent-library.html`, `studios.html`, `playground.html`, `analytics.html`,
`billing.html`, `settings.html`, `automation.html`, `brain.html`) now also
carries Memory and the connector — previously only `memory.html` had the
Memory engine loaded at all.

## Validation
`test-evidence/block2-step3-part2-memory-integration-regression-suite.js` —
29 checks, all passing, against the real unmodified files. The two prior
regression suites (Brain↔AI, Memory Foundation) were re-run unmodified and
still pass in full. See `MEMORY_INTEGRATION_REPORT.md` for the complete
before/after audit and validation table.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 3 (Part 1): Build the Memory Foundation

**Date:** 2026-07-31
**Scope:** Memory system only — no UI redesign, no new AI capabilities, no
unrelated pages touched. Full findings in `MEMORY_FOUNDATION.md`.

## Summary
An audit of the Memory page found that, despite a fully-built UI (timeline,
crystals view, knowledge graph, tags, filters, pin/importance/confidence
meters, import/export), there was no real memory system underneath it at
all: a single hardcoded 15-item array served as both "long-term archive"
and "short-term cache," nothing was ever written to disk, the "Working
Memory" panel was three static strings, the short-term-cache metric was
`Math.random()`-jittered, and — the clearest placeholder found — the Add
Memory modal's **Save button had no click handler at all**. This pass adds
a real memory foundation and wires the existing page to it, without
touching its markup or visuals.

## Added

**`os/core/memory-engine.js`** (new module — `window.AxiomMemoryEngine`)
- Storage layer: a single namespaced, schema-versioned `StorageAdapter`
  (localStorage-backed today, swappable later) that every read/write funnels
  through.
- Session memory: session create/resume (30-minute idle TTL), heartbeat,
  30-day retention before purge.
- Conversation history: `startConversation` / `addMessage` /
  `getConversationHistory` / `listConversations`, with a 500-message-per-
  conversation lifecycle cap that trims the oldest messages first.
- Message indexing: non-semantic `Map<key, Set<id>>` indices by tag, agent,
  project, and type, kept in sync on every write — explicitly no
  embeddings or vector store, per spec.
- Metadata storage: importance, confidence, tags, agent, project, type,
  pinned, plus lifecycle fields (`createdAt`, `updatedAt`,
  `lastAccessedAt`, `accessCount`, optional `ttl`).
- Memory lifecycle: `addMemory` / `touchMemory` / `updateMemory` /
  `deleteMemory` (removes from every index, not just the store).
- Memory cleanup: a `cleanup()` pass (auto-run every 5 minutes and at
  startup, and callable on demand) that closes stale sessions, purges
  sessions past retention, expires ttl-bearing ephemeral memories, and
  re-applies the message-history cap.
- State management: `onChange(fn)` pub/sub over every mutation, plus
  `getStats()`, `exportAll()` / `importAll()`.

## Fixed — mock data / placeholders removed

**`js/pages/memory-ultimate.js`**
- The 15-item `MEMORY_ITEMS` mock is now `SEED_MEMORY_ITEMS`, written
  through `engine.addMemory()` exactly once (only when the engine has zero
  stored memories) so real data is never overwritten on reload.
- `state.memories` is now read from `engine.queryMemories({})` and
  refreshed on every `memory:*` change event, instead of being the only
  copy of the data.
- Pinning (table pin buttons and the detail overlay's Pin/Unpin button) now
  calls `engine.updateMemory(id, { pinned })` — previously a pin reverted
  on refresh.
- Opening the memory detail overlay now calls `engine.touchMemory(id)`,
  recording a real access.
- Export now calls `engine.exportAll()` (a full backup of sessions,
  conversations, messages, and memories) instead of serializing only the
  currently-visible table rows.
- The "Short-Term Cache" metric now reads `engine.getStats().shortTermCacheLoad`
  (real working-memory load) instead of a `Math.random()` walk.

**`memory.html`**
- Loads `os/core/memory-engine.js` ahead of `memory-world.js` /
  `memory-ultimate.js`.
- The Add Memory modal's **Save Memory button, which previously had no
  click handler at all**, now has stable field ids (`addMemoryContent`,
  `addMemoryAgent`) and an id (`addMemoryModalSave`) wired in
  `memory-ultimate.js` to actually call `engine.addMemory()`.

## Test evidence

`test-evidence/block2-step3-part1-memory-foundation-regression-suite.js` —
loads the real, unmodified `os/core/memory-engine.js` under a hand-rolled
`vm`/localStorage shim (no network access needed) and exercises session
lifecycle, conversation history + capping, memory CRUD + metadata +
indexing, TTL-based cleanup, pub/sub, export/import, and cross-instance
persistence (a second engine instance reads back what a first instance
wrote). 35 checks, all passing — see the matching `-output.txt`.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 2 (Part 2): Connect the Brain to the AI

**Date:** 2026-07-31
**Scope:** Connect `AxiomBrain` to real AI runtime events (request/streaming/
response already real via the Milestone 3 Bridge — this pass adds error,
tool execution, active model, active conversation) and remove fabricated
"thinking" content from the `brain.html` dashboard that wasn't backed by a
real event. No UI redesign, no new pages. Full findings in
`BRAIN_INTEGRATION_REPORT.md`.

## Summary
An audit of every producer/consumer around `AxiomBrain` found that request
started / streaming / response completed / response cancelled were already
real (Milestone 3's `AxiomConversationBridge` → `ai-state-manager.js` →
`AxiomBrain`) — no simulated timer stood in for any of them. The real gaps:
`error` was silently remapped to `idle` (a defect already flagged in a code
comment as a documented gap), tool/capability execution and the active
model/conversation had no path into the Brain at all, and `brain.html`'s
`brain-ultimate.js` ran a 2-second timer that fabricated reasoning steps,
plan progress, predictions, and emotion drift via `Math.random()` regardless
of whether the AI was doing anything — a genuine fake-thinking-indicator
defect.

## Added

**`os/core/axiom-brain.js`**
- `activity` now models `'error'` as a real state (was
  `idle/listening/thinking/speaking/learning` only).
- Four new fields, written only from real events: `activeModel`,
  `activeConversationId`, `toolActive`, `activeTool`.

**`js/core/ai-state-manager.js`**
- Fixed the documented gap: `error` now reaches `AxiomBrain` as `'error'`
  instead of being masked as `'idle'`.
- New Input 3 (tool execution): listens for the Agent Event Bus's existing
  `axiom:agent-event` DOM mirror; `capability:loading` sets
  `toolActive`/`activeTool`, `success/failure/cancelled/timeout` clear them.
  A `capability:retry` does not clear tool state (the next attempt's
  `capability:loading` is always what actually ends it), verified by test.
- New Input 4 (active model): listens for the new `axiom:model-changed`
  event, writes `activeModel`; seeds it from `ModelSelector` on load.
- New Input 5 (active conversation): listens for `conversation:*` events,
  writes `activeConversationId` from `payload.conversationId`, clears it on
  that conversation's `conversation:done`.

**`js/core/model-selector.js`**
- Added `notifyModelChanged()`: dispatches `axiom:model-changed` on every
  real selection change (manual dropdown, `setSelectedModel()`, and once at
  init to seed the current value) — never speculative, never timed.

## Fixed — fake thinking indicators removed

**`js/pages/brain-ultimate.js`**
- Added `isRealAIActive()` (reads `AxiomBrain`'s real `toolActive`/
  `activity`). Reasoning feed, plan progress, prediction drift, and goal
  progress now all gate on it — no more narrating fabricated "thinking"
  content on a fixed timer while genuinely idle.
- When a reasoning-feed entry is added during a real tool call, it now
  names the actual capability ("Running `coding:generate`") instead of
  picking a random canned line.
- Learning-section metrics only advance during the Brain's real
  `'learning'` activity, not just "busy."
- Knowledge-coverage and emotion-tile values — for which no real telemetry
  exists anywhere in this project — had their unconditional
  `Math.random()` re-rolls removed outright rather than merely gated, and
  now hold their last rendered value.
- The `AxiomBrain.on('change', ...)` handler now logs real activity-log
  entries on real activity/tool transitions, not just two canned lines
  once at boot.

## Deliberately left unchanged

- `AxiomConversationBridge` (request/streaming/response/cancel path) —
  already fully real, out of scope.
- `conversation-stream.js`, `conversation-manager.js`, `capability-kit.js`
  — already the real sources of the events this pass consumes; not
  modified, only listened to.
- `brain-ultimate.js`'s decorative-only SVG pulse animation — pure visual
  flourish, doesn't claim anything about AI cognition.
- Knowledge-coverage / emotion drift: no real signal exists yet for either;
  wiring a truthful version (e.g. real sentiment analysis) is new-feature
  work, out of scope here.

## Validation

`test-evidence/block2-step2-part2-brain-integration-regression-suite.js`
(new) — 28 checks, all passing. Loads the real, unmodified `axiom-brain.js`
and `ai-state-manager.js` and drives them with the exact event shapes the
real runtime produces (no jsdom install possible offline in this sandbox —
uses a small hand-rolled `vm`-based DOM/window shim instead, same real
files under test either way). Covers: tool-execution start/success/failure/
cancel/timeout, a retry sequence that must NOT falsely clear tool state
mid-flight, active-conversation set/clear, active-model updates, the
error-activity fix, a burst of interleaved concurrent tool + conversation
events settling with no duplicate/stuck state, and unrelated bus noise
(`agent:status`, `task:started`) correctly ignored.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 1 (Part 2): Reliable AI Execution Pipeline

**Date:** 2026-07-31
**Scope:** Coding Agent request → response pipeline reliability only —
request validation, model selection, streaming lifecycle, response
parsing, cancellation, timeout handling, retry behavior, error recovery,
token usage tracking, context handling. No UI redesign, no new
capabilities, no changes to other agents. Full findings in
`AI_PIPELINE_REPORT.md`.

## Summary
Part 1 (below) made the Coding Agent's live model calls reachable at all.
This pass audited the resulting pipeline end-to-end against every other
agent that talks to a real backend (Browser, Memory, Planner, File) and
found the Coding Agent was the **only** one whose live calls bypassed
`AxiomCapabilityKit.withCapability()` — the shared wrapper that gives every
other agent a real timeout, bounded retries, and uniform lifecycle events.
Concretely: a hung or slow-to-respond stream had no timeout, so the
in-flight promise could sit pending forever. The task queue's internal
`_processing` flag never cleared in that case, so the agent silently
stopped draining new requests even though the manager's 15s stall
heartbeat cosmetically reset its displayed status to idle — a real
"stuck pipeline, looks fine from the outside" defect.

## Fixed

**`os/runtime/capabilities/coding-toolkit.js`**
- `completeText()` now routes every live call through
  `AxiomCapabilityKit.withCapability()` (same pattern as
  `browser-agent.js` / `memory-agent.js` / `planner-agent.js` /
  `file-agent.js`), with a 45s default timeout and up to 2 retries for
  transient failures. A cancelled request is still never retried —
  `withCapability` re-throws a cancellation untouched, verified by test.
- Added `estimateUsage()` — a dependency-free ~4-chars/token estimate for
  prompt and completion text. `completeText()` now resolves
  `{ text, usage }` instead of a bare string; every downstream op
  (`explainCode`, `proposeRefactor`, `investigateBug`) and the agent's
  `generate` op forward `usage` on their result.
- `streamOnce()` (the single live-call unit, now retryable) guards the
  client's response: a non-string/`null` payload from `onDone` is coerced
  to `''` instead of propagating as a silent non-string result
  (response-parsing hardening).
- Added `buildMessages()`: optional `task.system` (system prompt) and
  `task.history` (prior `{role, content}` turns) are now threaded into
  `generate`, `explainCode`, `proposeRefactor`, and `investigateBug`,
  ahead of the current prompt — additive only, omitting both reproduces
  the exact single-message behavior from before.

**`os/runtime/agent-definitions/coding-agent.js`**
- Added request validation up front: `generate`'s prompt and every other
  op's primary text/code/description field is rejected with a clear
  `{ ok:false, error }` (no network call at all) if it exceeds a 20,000
  character ceiling.
- `ctx` (agent/bus) is now passed into every toolkit call, so
  capability-kit's `capability:loading/success/failure/retry/timeout`
  events are correctly attributed to `agent.coding` on the shared bus.
- A request can opt into its own `timeoutMs`/`retries` budget
  (`task.timeoutMs`, `task.retries`), defaulting to the toolkit's
  standard values when omitted.
- Token usage is folded into `ctx.agent.stats.tokens` (`prompt`,
  `completion`, `total`, cumulative) after every live op, and an
  `agent:token-usage` event is emitted on the bus per request — visible
  without inspecting individual task results.

## Verified clean, no change needed
- Task serialization, single-flight `_processing` guard, and cross-task
  isolation (Part 1's regression suite) — unchanged, re-verified.
- `refactor` still never auto-applies (`requiresConfirmation: true,
  applied: false`, unconditionally).
- Manager-level stall heartbeat (`agent-manager.js`, 15s) — left as-is;
  now genuinely redundant with the pipeline's own timeout rather than
  being the only thing standing between a hung stream and a wedged queue.

## Validation
- New `test-evidence/block2-step1-part2-pipeline-regression-suite.js` —
  13 checks, all passing: oversized-request validation rejects before any
  network call, a hung stream is timed out rather than pending forever,
  a transient failure is retried and a cancellation is never retried,
  token usage is estimated and accumulates on the agent, system/history
  context reaches the client in the right order, and a burst of
  concurrent requests all complete exactly once with the agent settling
  back to idle.
- Existing `test-evidence/block2-step1-coding-agent-regression-suite.js`
  (Part 1, 11 checks) and `test-evidence/milestone5-regression-suite.js`
  (23 checks) — re-run, 0 regressions.
- `test-evidence/milestone6-regression-suite.js` has one pre-existing,
  unrelated failure (a stale `file-processing.js` path in a File Agent
  check) confirmed present in the untouched project before this pass —
  left alone as out of scope for a Coding-Agent-only step.

---

# AXIOM — Phase 10 · Part 2 · Block 2 · Step 1 (Part 1): Stabilize the Coding Agent

**Date:** 2026-07-31
**Scope:** Coding Agent foundation only — architecture, prompt/task pipeline,
model integration, cancellation. No UI redesign, no new capabilities, no
changes to other agents. Full findings in `CODING_AGENT_AUDIT.md`.

## Summary
Audited the Coding Agent's full request lifecycle (`agent-runtime.js`,
`agent-manager.js`, `coding-agent.js`, `coding-toolkit.js`, `task-router.js`).
Found and fixed one critical, previously-unnoticed defect: the Coding Agent's
live model calls were completely unreachable. Everything else in the
lifecycle — task queueing, serialization, cancellation propagation, status
transitions, error handling, init/shutdown — was already correctly built and
needed no changes. See the audit doc for full method and findings.

## Fixed

**`os/runtime/capabilities/coding-toolkit.js`, `os/runtime/agent-definitions/coding-agent.js`**
- The Coding Agent looked for a model client at `window.OpenRouterClient` or
  `window.AxiomOpenRouter`, calling `.complete({ messages })` on whichever it
  found. **Neither global exists anywhere in this project** — the real,
  loaded client is `window.OpenRouter`, and it only exposes a callback/
  streaming `.streamChat()`, not `.complete()`. Result: `generate` always
  silently fell back to a canned placeholder note (`live: false`), and
  `explain-code`/`refactor`/`bug-investigation` always returned/threw "no
  model client available" — unconditionally, on every page, regardless of
  configuration. This was previously invisible because the fallback always
  returned `ok: true`, so nothing looked broken without inspecting `live`.
- Added `completeText()` to the toolkit: a Promise wrapper around the real
  `OpenRouter.streamChat`, with model resolution (explicit → `ModelSelector`
  → safe default) and an honest `hasClient()` availability check.
- Wired real cancellation on top: an `AbortController` tied to the runtime's
  existing cooperative `task.cancelled` flag now actually aborts the
  in-flight request when a task is cancelled, instead of only discarding a
  result that kept running unseen in the background.
- Updated every call site (`generate`, `explain-code`, `refactor`,
  `bug-investigation`) to use the fix and pass the in-flight task through.

## Verified clean, no change needed
- Task serialization: `Agent._drain()`'s `_processing` flag already prevents
  a single agent from running two tasks (or making two client calls)
  concurrently — confirmed with a new regression check.
- Error handling in the Coding Agent's handler already wraps every op in
  try/catch and returns a structured `{ ok:false, error }` rather than
  throwing past the runtime.
- Agent init (`offline → initializing → idle`) already routes failures
  through `fail()` rather than rejecting the caller.
- `refactor` still never auto-applies (`requiresConfirmation: true,
  applied: false`, unconditionally) — unchanged, re-verified.

## Validation
- New `test-evidence/block2-step1-coding-agent-regression-suite.js` — 11
  checks, all passing: init, live `generate`/`explain-code` reaching a
  (mocked) real client, no duplicate/overlapping client calls, real
  cancellation, graceful no-client and unsupported-op handling.
- Existing `test-evidence/milestone6-regression-suite.js` — all 52 checks
  still pass, 0 regressions.
- Project-wide `node --check` syntax scan (all `.js`, excluding
  `_archive/`) — 0 errors.
- No live browser, Supabase session, or OpenRouter network round-trip was
  available in this environment — see `CODING_AGENT_AUDIT.md` §3 for exactly
  what was and wasn't verified.

## Not modified
- No UI, no new agent capabilities, no changes to any other agent.
- `workspace.html` still doesn't load `openrouter-client.js` (pre-existing;
  flagged as a limitation in the audit doc rather than changed here, since
  it's a page-level script-include decision outside this step's scope).

---

# AXIOM — Phase 10 · Part 2 · Block 1 Step 3 (Part 2): Stabilize JavaScript Initialization

**Date:** 2026-07-31
**Scope:** Application startup only. No page redesign, no CSS, no business logic.
Full findings in `INITIALIZATION_AUDIT.md`.

## Summary
Audited every page's script-loading order and every `DOMContentLoaded`/
`window.onload` handler across `js/core/`, `js/pages/`, `js/bridges/`,
`components/`, and the `os/` shell/runtime tree for duplicate initialization,
duplicate event registration, repeated timers/polling, and race conditions. One
confirmed defect was found and fixed; everything else checked came back clean or
already self-guarded. See the audit doc for the full method and file-by-file
findings, including what was and wasn't in scope for this pass.

## Fixed

**`js/pages/settings-i18n.js`**
- Removed a dead `document.addEventListener('DOMContentLoaded', refreshOutputVoices)`
  registered from inside `renderVoiceSelectors()`. That function only ever runs from
  inside the page's own top-level `DOMContentLoaded` handler further down the same
  file, so by the time this line executed, `DOMContentLoaded` had already fired on
  `document` — the listener could never trigger. It was inert dead code, not a
  visible duplicate-run bug: `refreshOutputVoices()` is also called directly a few
  lines later, and the async voice-list case is separately covered by
  `speechSynthesis.onvoiceschanged`.
- This was the only file in the project with more than one `DOMContentLoaded`
  registration in the same script.

## Verified clean, no change needed
- No HTML page includes the same `<script src>` twice (checked all 16 pages).
- `components/app-init.js` (shared cross-page bootstrap for clock/search/quick
  command/notifications/dock) already guards against double-run via a
  `document.readyState === 'loading'` check. Single entry point.
- `#particles` background effect: both `js/core/script.js` and
  `components/premium-shell.js` touch it on pages that load both, but
  `premium-shell.js`'s `populateParticles()` already no-ops via
  `if (!holder || holder.childElementCount) return;` once `script.js` (which loads
  first) has populated it. No double-population.
- `os-shell.html`'s shell (`os/core/window-manager.js`, `os/desktop/desktop-manager.js`,
  orchestrated by `os/core/part6-bootstrap.js`) — each module has one `init()` entry
  point behind one readiness check.
- `_archive/unused-legacy/ai-reactor-core.js` — confirmed not linked from any `.html`
  file, so its `DOMContentLoaded` handler is dead but not a live duplicate-init risk.
  Left untouched (archived, not live code).
- All 155 project `.js` files pass a Node syntax check after the fix above.

## Not modified
- No CSS, no page redesign, no business logic.
- No files were deleted.

---

# AXIOM — Phase 10 · Part 2 · Block 1 Step 3: Stabilize Global CSS

**Date:** 2026-07-31
**Scope:** Global CSS stabilization only. No JS, no HTML, no UI redesign, no Design
Token changes. Full findings in `GLOBAL_CSS_AUDIT.md`.

## Summary
Audited every stylesheet for universal selectors, bare element selectors, global
utility conflicts, duplicate utility classes, specificity conflicts, and
page-to-page style leakage. Two files needed changes; everything else was verified
clean or intentionally global (see audit for the full breakdown, including 19
cross-file duplicate class names in `app.css`/`ax-redesign.css` that were reviewed
and left alone as an intentional base+override layering, not a bug).

## CSS files modified
- `styles/ax-redesign.css`
- `styles/vision-glass-theme.css`

## Changes

**`styles/ax-redesign.css`**
- Scoped the bare `h1, h2, h3, h4, h5, h6 {}` rule to
  `body.ax-redesign-active h1, ... h6` using the state class already present on
  every page that loads this file.
- Scoped the bare `a {}` / `a:hover {}` rules to `body.ax-redesign-active a` /
  `body.ax-redesign-active a:hover`.
- Scoped the bare `textarea, select {}` tail of the shared input-styling selector to
  `body.ax-redesign-active textarea, body.ax-redesign-active select` (the other
  class-qualified selectors in that group were left as-is).
- Scoped the `table {}`, `table th {}`, `table td {}`, and `table tr:hover td {}`
  rules to `body.ax-redesign-active table` / `... table th` / `... table td` /
  `... table tr:hover td`.
- `html, body {}` was deliberately left unscoped (page singletons, not a leak risk).
- No selector's matched element set changed — this raises specificity only, so there
  is no visual difference on any page.

**`styles/vision-glass-theme.css`**
- Merged two separate `body {}` rule blocks (background/color, and
  font-family/line-height/letter-spacing) into one. No property values changed.

## Verified unchanged
- Every page renders against the same selector-to-element matches as before.
- Theme switching, RTL layout, and responsive breakpoints untouched (no rules in
  `rtl.css`, `motion-tokens.css`, or any responsive/theme file were edited).
- AI Core (`ai-identity.css`, `os/core/ai-avatar.css`) untouched.
- Design Token System (`design-tokens.css`) untouched.

---

# AXIOM — Phase 10 · Part 2 · Block 1 Step 2: Remove Dead CSS

**Date:** 2026-07-30
**Scope:** Cleanup-only pass. No layout, color, spacing, JS, or Design Token changes.
Full audit methodology and the complete list of retained-but-flagged selectors are in
`CSS_AUDIT.md`.

## CSS files modified
- `styles/app.css`
- `styles/ax-redesign.css`
- `styles/ax-chat.css`
- `styles/rtl.css`

## Dead selectors removed

**`styles/app.css`** — an orphaned pre-rebrand component library (container/wrapper
classes and full components superseded when the UI moved to `ax-`-prefixed markup;
their live singular/item counterparts, e.g. `.dash-stat`, `.recent-card`,
`.plan-card`, were left untouched):
- `.app-nav`, `.app-nav-label`, `.app-topbar-spacer`
- `.dash-stats` grid + `.dash-stat-top/-icon/-delta/-num/-label`
- `.recent-grid`, `.recent-thumb`, `.recent-meta`, `.recent-meta p`
- `.quick-grid`, `.pg-layout`
- Legacy chat template: `.chat-window`, `.chat-msg`, `.chat-avatar`, `.chat-bubble`,
  `.chat-typing`
- `.prompt-bar` + `.prompt-bar textarea` rules, `#jvVoiceHint`
- `.gen-controls`, `.field-inline`, `.gen-output-grid`, `.credit-meter`
- `.plan-card-name`, `.plan-card-price`
- `.usage-bar`, `.usage-bar-fill`, `.invoice-table` (+ `th`/`td`)
- `.settings-tabs`, `.form-grid`, `.toggle-row`, `.toggle-row-copy`
- Entire legacy `.switch`/`.switch-track` toggle-switch implementation
- `.avatar-upload`, `.btn-danger`
- 4 `@media` breakpoint blocks that only targeted the removed grid containers above

**`styles/ax-redesign.css`** — dead half of several `.ax-foo, .foo` compatibility
pairs (verified individually per selector — which side was dead varied by component,
it was not a consistent "ax-prefix = old" or "ax-prefix = new" rule; an initial
assumption that the `ax-`-prefixed side was always the live one turned out to be
wrong for the button family and was corrected before any edits were made):
- `.metric-card`, `.core-stage-panel`
- `.ax-btn-ghost`, `.ax-btn-lg` (bare `.btn-ghost`/`.btn-lg` are the live ones)
- `.btn-danger` (bare) (`.ax-btn-danger` is the live one)
- `.switch-track`, `.switch input` and their `:checked` variants (bare `.switch` is
  never used; `.ax-switch …` scoped versions are live)
- `.settings-tabs`, `.ax-progress`/`.usage-bar` (+ `-fill`), `.invoice-table` (+
  `th`/`td`)
- `.preview-modal`, `.preview-panel`, `.preview-head`, `.preview-body` (superseded
  by the live `.ax-modal-*`/`.agent-modal-*` system, which already existed in the
  same shared rules)

**`styles/ax-chat.css`**
- Empty `:root {}` block (zero properties)

**`styles/rtl.css`** — found during a final cross-file consistency pass, after
noticing this file wasn't caught by the main automated audit: its rules combine
`body.rtl` (always-present, genuinely live) with a second class in a compound
selector like `body.rtl .app-topbar-spacer { … }`. The automated check used "any
class in the selector is used" logic, so `body.rtl` being live made the whole
compound selector register as "used" even when the second class was dead. Caught by
re-checking every already-removed class name against every CSS file (not just the
ones flagged unused originally) before finalizing:
- `body.rtl .app-topbar-spacer { order: 0; }` — dead, `.app-topbar-spacer` no longer exists
- `body.rtl .dash-stat-num` and `body.rtl .invoice-table td:nth-child(3)` — dropped
  from a grouped LTR-isolation rule; the live `body.rtl code`/`body.rtl pre` part of
  that same rule was kept

## Keyframes removed
- `@keyframes typingDot` (`app.css`) — only used by the now-removed `.chat-typing span`

## Duplicate selectors merged
None merged this pass. The apparent duplicates found (`.toast` in `ax-redesign.css`,
`@keyframes axNotifPulse` in `os-shell.css`/`ax-topbar.css`) turned out to be either a
genuine cascade conflict (different properties, both still contributing to the
computed style) or a cross-file duplication that would require changing which
stylesheet is linked from which HTML page — both out of scope for a cleanup-only
pass. See `CSS_AUDIT.md` for details. Several other apparent duplicates were false
positives (a shared base rule + legitimate per-variant overrides, e.g.
`.ax-glass-1, .ax-glass-2, .ax-glass-3 { shared }` followed by individual overrides).

## Estimated CSS reduction
- `app.css`: 402 → 288 lines (‑28%, 21.5KB → 14.6KB)
- `ax-redesign.css`: 1,178 → 1,151 lines (‑2.3%, 30.9KB → 30.4KB)
- `ax-chat.css`: 1,003 → 1,001 lines
- `rtl.css`: 77 → 74 lines
- **Total non-archived CSS: 12,549 → 12,403 lines (‑1.2%), 376.6KB → ~369KB**

Reduction was kept conservative on purpose: a large set of unused selectors (design-
system/utility layers in `ax-design-system.css`/`ax-premium-polish.css`, and several
fully-built but uncalled components in `os-shell.css`/`ax-workspace.css`/
`ax-chat.css`/`ax-pages.css`/`accessibility.css`/`window-manager.css`/
`wallpaper-engine.css`/`brain.css`/`vision-glass-theme.css`) had no evidence of being
superseded by anything else, so they were left in place and documented in
`CSS_AUDIT.md` under "Retained selectors requiring further product/dev review"
instead of deleted.

## Not modified
- Design Token System (Step 1) — untouched
- All layouts, colors, spacing values — unchanged
- JavaScript / business logic — untouched
- Every removal was individually verified against the full HTML/JS corpus (including
  dynamic `classList.add()`/template-literal class construction) before deletion; no
  live selector was removed

---

# AXIOM — Phase 10 · Part 2 · Block 1 Step 1: Lock the Design Token System

**Date:** 2026-07-30
**Scope:** First step of the master execution roadmap. Stabilize the design-token foundation only — no layout, logic, or JS changes. Verified the existing token architecture against the live codebase before touching anything, per the brief.

## Verification performed before any change

- Confirmed which files declare `:root`: 9 CSS files, all legitimate (one pair is a `prefers-reduced-motion` override, not a duplicate).
- Confirmed `styles/design-tokens.css` is in fact `@import`ed by `base.css`, `ax-redesign.css`, `ax-design-system.css`, `os-shell.css`, and `vision-glass-theme.css` — i.e. it **is** live on every page today. This contradicts design-tokens.css's own header, which still claimed (from an earlier phase) that it was "not yet a live dependency of any page." That claim is now corrected in the file itself.
- Confirmed `styles/premium-os.css` is genuinely orphaned: not linked from any HTML file, not `@import`ed by any live CSS file, and not referenced by any JS file. Archived it.
- Confirmed `styles/os-environment.css` is orphaned from HTML/CSS the same way, but is referenced in a comment by `js/core/os-environment.js` as backing an unfinished ambient-lighting feature (Module 10). Left in place, untouched, rather than archived — moving it felt like a judgment call outside "only modify CSS architecture," so it's flagged here for a deliberate decision in a later phase instead.
- Diffed every custom-property name across all `styles/*.css` files: 295 unique names, 96 defined in more than one place, of which 90 currently resolve to genuinely different values depending on which file wins the cascade on a given page (not just renamed the same value).

## Changes made this pass

1. **Archived `styles/premium-os.css`** to `_archive/unused-legacy/styles/premium-os.css`. Confirmed zero pages or scripts reference it before moving.
2. **`styles/design-tokens.css`** (canonical file, unchanged in scope/ownership):
   - Corrected the stale "not yet a live dependency" claim in the header.
   - Corrected the `--text-hi` / `--text-lo` legacy aliases (§11) to match what's actually rendering (`base.css`'s literal `#FFFFFF` / `rgba(255,255,255,.70)`) instead of a theoretical `var(--ax-text)` mapping nothing currently uses.
   - Added a note next to the `--a-violet`/`--a-cyan`/`--a-pink`/`--a-coral`/`--a-gold`/`--a-teal` aliases (§11) explaining that the app-page family and the vision-page family both override this row with different, intentional values of their own — not resolved further, to avoid a color regression on either family.
3. **`styles/ai-identity.css`**: removed the `--ax-ai-accent*` block (6 properties). It was a workaround written when `design-tokens.css` wasn't yet linked anywhere; that's no longer true (see above), so the block was a confirmed-safe, byte-for-byte duplicate of `design-tokens.css` §12. The per-state accent tokens (`--ax-ai-state-*`), which are unique to this file, are untouched.
4. **`styles/base.css`, `styles/ax-redesign.css`, `styles/os-shell.css`, `styles/vision-glass-theme.css`**: added comment-only annotations (no value changes) marking which of their `:root` entries are intentional, currently-rendering overrides of a canonical token with a different value, and why. No CSS rule, selector, or value in any of these four files was altered.

## Explicitly NOT changed, and why

- **The V8 (`ax-redesign.css`) vs. V11 (`ax-design-system.css`/`os-shell.css`) radius, elevation/shadow, glass, and font-size scale conflict.** `design-tokens.css` already documents this as a real, unresolved design divergence (not a typo) and explicitly says migrating the 12 V8 pages onto V11's values "must be decided in Part 2" since the values genuinely differ. Doing that now would change on-screen radii, shadows, and type sizes across 12 pages — a color/visual regression, which this step's brief rules out. Left as-is; flagged for an explicit design decision in a future phase.
- **The app-page vs. vision-page monochrome/status-color split** for `--a-violet`/`--a-cyan`/`--a-pink`/`--a-coral`/`--a-gold`/`--a-teal`. Same reasoning — collapsing either family onto the other, or onto `design-tokens.css`'s row, changes what's currently on screen.
- **`styles/os-environment.css`** — left in place, not archived (see verification notes above).
- **Duplicate `@import url("design-tokens.css")` lines** across 5 different files. Technically redundant (the browser dedupes by resolved URL, so there's no double-loading in practice), but consolidating them into a single import point touches 5 files' load order for a purely cosmetic win with no functional upside — left alone per "do not force change" / minimize unnecessary risk.

## Remaining design-token work (for later Phase 10 blocks)

1. Decide whether/how to migrate the 12 V8 app pages onto the V11 radius/elevation/glass/type scale (or vice versa) — a real visual-design decision, not a mechanical one.
2. Decide whether the app-page monochrome accent family and the vision-page status-color accent family should ever be unified, or are permanently two intentional themes.
3. Decide the long-term fate of `styles/os-environment.css` (wire it up, or archive it alongside `premium-os.css`).
4. Optional, low-priority: consolidate the 5 redundant `@import url("design-tokens.css")` lines into a single import point.

See `TOKEN_AUDIT.md` for the full token hierarchy and per-page override table.
# AXIOM — Phase 10 · Part 2: Final Release Candidate

**Date:** 2026-07-30
**Scope:** Final end-to-end validation ahead of public deployment. No new features, no behavior changes — verification and documentation only.

## What was run this phase

1. Full re-run of the mechanical checks from Phase 9 Part 2, from
   scratch: `node --check` on all 155 JS files (0 errors), JSON
   validity on all 11 JSON files (0 errors), i18n key parity across 9
   locales vs. `en.json`'s 148 keys (0 missing/extra anywhere), and a
   `src=`/`href=` reference scan across all 16 HTML pages (0 broken).
2. **New this phase:** a JS-level navigation check — every
   `"*.html"` string literal referenced anywhere in the 155 JS files
   (89 total) resolved against the real filesystem. One near-miss
   found and traced: `dashboard.html` in `components/premium-shell.js`
   is a fallback label used only when the app is served at its root
   URL (empty `location.pathname`) — applied to a CSS class and an
   internal label lookup, never used as an actual link or redirect
   target. Confirmed not a broken navigation path.
3. Re-ran `test-evidence/phase9-part1-static-audit-suite.js`
   unmodified — 1302/1302 passed. Re-ran
   `test-evidence/milestone14-part1-regression-suite.js` unmodified —
   58/58 passed.
4. Re-attempted installing `jsdom` to unblock the remaining milestone
   suites (5, 5-manual-commands, 6, 10–13) — still fails with no
   registry access in this environment, same as every prior phase.
   Their scope is unchanged from Phase 9.
5. Re-audited for hardcoded secrets (`sk-`, `sk_live_`, `AIzaSy`,
   PEM private-key headers) across all JS files — none found. Manually
   reviewed all three third-party config files
   (`supabase-config.js`, `razorpay-config.js`, `openrouter-config.js`)
   — the Supabase anon key and Razorpay *test* Key ID present are
   expected/safe client-side values, not leaked secrets.
6. Recounted the design-system inventory from scratch (independent of
   any earlier phase's numbers): 177 uniquely-named CSS custom
   properties, 88 uniquely-named `@keyframes` animations, 30
   accessibility rules — matches the Phase 9 Part 2 addendum's
   corrected recount exactly, confirming no drift since that pass.

## New documentation added this phase

- `DEPLOYMENT_GUIDE.md` — hosting model, backend service
  configuration (Supabase/Razorpay/OpenRouter), and a pre-launch
  checklist that separates what's already verified from what still
  needs a real browser/staging pass.
- `PROJECT_DOCUMENTATION.md` — architecture overview of the actual
  repository layout, written from direct inspection this phase (pages,
  the `os/` runtime subsystem, config surface, i18n, design system, QA
  infrastructure).
- `FINAL_AUDIT_REPORT.md` — the full results table for this phase's
  checks, plus an explicit, itemized list of what could not be
  verified in this sandboxed environment (live UI rendering, live
  AI/billing service calls, cross-device visual QA, the `jsdom`-gated
  suites).

## What this phase does *not* claim

Consistent with every prior phase's honesty policy: this pass did not
open the app in a browser, did not click through any page, and did
not exercise the OpenRouter chat, Supabase auth, or Razorpay checkout
flows against live services — this environment has no browser and no
network access to reach them. Every check above is either a static/
mechanical verification that was actually run, or an explicit note
that something needs a real staging environment before it can be
called launch-verified. See `FINAL_AUDIT_REPORT.md` for the complete,
itemized breakdown.

## Known limitations (carried forward, re-confirmed this phase)

Unchanged from Phase 9 Part 2 — see `FINAL_AUDIT_REPORT.md` and
`DEPLOYMENT_GUIDE.md` for the current, complete list. None are new
regressions; all are environment-imposed and documented rather than
silently carried.

---



**Date:** 2026-07-30 (same-day re-check, separate pass)

The Phase 9 Part 2 section below was already present in the uploaded
project. Rather than repackage it unread, this pass independently
re-ran the checks it claims, from scratch, in this environment:

- `node --check` on all 155 project JS files — **0 syntax errors**,
  reproduced.
- JSON.parse on all 11 JSON files — **0 invalid**, reproduced.
- i18n key parity, `en.json` (148 keys) vs. all 9 other locale files —
  **0 missing / 0 extra in every locale**, reproduced independently
  with a separate script.
- `src=`/`href=` reference scan across all 16 HTML pages against the
  real filesystem — **0 broken references**, reproduced.
- Re-ran `test-evidence/phase9-part1-static-audit-suite.js` unmodified
  — **1302/1302 checks passed**, reproduced.
- Re-ran `test-evidence/milestone14-part1-regression-suite.js`
  unmodified against the real event bus / agent manager / skill
  registry / plugin registry — **58/58 checks passed**, reproduced.
- Debug-artifact claims spot-checked directly: the one
  `console.log('Hello World')` in `workspace-ultimate.js` is confirmed
  to sit inside a static markdown string assigned to a demo
  `<textarea>`, not executable code; the `alert(` in `auth.js` is
  confirmed to be a last-resort UI fallback; the `'builtin:debugger'`
  hit is confirmed to be an agent catalog id string, not a `debugger;`
  statement. No `TODO`/`FIXME`/`HACK`/`XXX` found.

**One discrepancy found and corrected:** the design-token and
`@keyframes` counts below (previously reported as 189 tokens / 64
animations) don't reproduce exactly with a straightforward recount —
a plain scan of `styles/design-tokens.css` finds 177 uniquely-named
custom properties (197 total declarations, including re-declarations
inside media/breakpoint blocks), and a project-wide scan for unique
`@keyframes` names finds 88, not 64. This looks like a counting-method
difference (e.g. unique vs. total, or scoped vs. project-wide) rather
than a regression — nothing was deleted between phases — but the
exact figures below should be read as superseded by this note rather
than re-verified as-is. No functional issue follows from this either
way.

**No files were modified in this pass beyond these three docs.**
Everything else in this changelog (below) is carried over unchanged
from the version already in the uploaded project.

---

# AXIOM — Phase 9 · Part 2: Final Stability & Release Candidate

**Date:** 2026-07-30
**Scope:** Final regression pass on top of Phase 9 Part 1. No redesign, no new features — verification and, where something genuinely warranted it, cleanup only.

## Same honesty policy as every prior phase note

No browser or live network in this environment, so nothing below claims
a live-rendered, cross-device visual pass that didn't happen. Everything
here is either a mechanical check that was actually run, with output
saved to `test-evidence/`, or an explicit note about what couldn't be
checked and why.

## What was run

1. Re-ran the Phase 9 Part 1 static audit suite
   (`test-evidence/phase9-part1-static-audit-suite.js`) against the
   current tree, unmodified — **1302/1302 checks passed**. Output saved
   to `test-evidence/phase9-part2-rc-static-audit-output.txt`.
2. Re-ran the Milestone 14 Part 1 runtime regression suite
   (`test-evidence/milestone14-part1-regression-suite.js`) against the
   real, unmodified AI runtime (event bus, agent manager, skill
   registry, plugin registry) — **58/58 checks passed**. Output saved
   to `test-evidence/phase9-part2-rc-runtime-regression-output.txt`.
3. Independently re-verified, directly against the files on disk
   (not just by re-running the existing scripts): `node --check` on
   all 155 project JS files, JSON validity on all 11 JSON files
   (including full i18n key-parity across all 9 non-English locale
   files against `en.json` — 0 missing / 0 extra keys in every one),
   HTML tag-balance on all 16 top-level pages, CSS brace-balance on
   all CSS files, and a scan of every `src=`/`href=` reference in
   every HTML page against the real filesystem — zero broken
   references found.
4. Reviewed every `console.log`/`debugger`/`alert(`-shaped hit across
   the codebase by hand (not just counted) to separate real debug
   leftovers from intentional code:
   - All `console.log` calls are consistent, namespaced initialization
     markers (e.g. `[BrainUltimate] Initialized`) already established
     in earlier phases — not new, not accidental.
   - The one bare `console.log('Hello World')` (in
     `workspace-ultimate.js`) is inert placeholder text inside a
     markdown-editor demo textarea, never executed — not live code.
   - The only `alert(` call (`auth.js`) is an intentional last-resort
     fallback when neither a dedicated error box nor a toast function
     is available on the page — not a debug leftover.
   - No `debugger` statements exist outside one unrelated string
     literal (`'builtin:debugger'`, an agent catalog entry name).
   - No `TODO`/`FIXME`/`HACK`/`XXX` markers remain in any JS file.

## What was **not** removed, and why

- **`js/core/dev-config.js`** (loaded on 13 pages) is a self-gated
  local preview helper, not shipped debug code: it only activates on
  `localhost`/`127.0.0.1`/`file://` and is a documented, hard no-op on
  any real deployed hostname regardless of its internal flag. Removing
  it would delete a working, safety-gated developer convenience for no
  production benefit, which conflicts with "preserve all existing
  functionality." Left in place, exactly as flagged and kept in Phase
  9 Part 1.
- **`_archive/unused-legacy/`** — already excluded from every live page
  (confirmed again this pass: zero references from any HTML/CSS/JS to
  that folder; the one grep hit that looked like a match was
  `is_archived`, a Supabase column name, not a path reference). Nothing
  to remove here since it was never wired in.
- **`test-evidence/`** — this is the project's QA paper trail, not
  shipped application code (no HTML page references anything under
  it). Kept, and two new output files were added to it (see above)
  rather than overwriting the Phase 9 Part 1 evidence.

## Remaining known limitations (unchanged from Phase 9 Part 1)

1. The Milestone 5 / 5-manual-commands / 6 / 10 / 11 / 12 / 13
   regression suites still require `jsdom`, which still can't be
   installed in this environment (no network access to the package
   registry) — re-confirmed this pass by attempting the install path
   again, same `MODULE_NOT_FOUND` result. Their scope is unchanged
   from before, so this is not a new regression.
2. Live third-party integration behavior (Supabase auth, Razorpay
   checkout, OpenRouter model calls) remains untestable without live
   credentials and network access. Code paths are syntax- and
   reference-checked but not exercised against the real services.
3. True cross-device/cross-browser visual QA still needs a live
   browser this environment doesn't have.
4. The cosmetic color-consistency items tracked in
   `docs/VISUAL-AUDIT-PROGRESS.md` and the `ax-premium-polish.css`
   `!important` audit are both still open, exactly as carried forward
   in Phase 9 Part 1 — neither is a functional blocker and neither was
   in scope for a stability/regression pass.

## What was preserved

No page was redesigned, no feature was added or removed, and no
existing JS, CSS, or HTML file's behavior was changed in this pass —
every mechanical check that could be run came back clean, so there was
nothing to fix. The only additions are two new test-evidence output
files and this changelog entry, `QA_REPORT.md`, and `RELEASE_NOTES.md`.

---

# AXIOM — Phase 9 · Part 1: Comprehensive QA & Regression Testing

## Scope note (read this first)

Same honesty policy as every prior phase note. This environment has
no browser, no headless renderer, and no screenshot tool — so "test
every page across desktop, tablet, and mobile" could not be done as
literal manual/visual QA in a live browser. What this pass **could**
do, and did do, mechanically:

1. Every one of the 145 project JS files (`_archive/` and
   `test-evidence/` excluded) checked with `node --check` for syntax
   errors.
2. Every inline `<script>` block across all 16 top-level HTML pages
   extracted and syntax-checked the same way.
3. Every `src=`/`href=` reference in every HTML page resolved against
   the real filesystem to catch broken links / missing assets.
4. Every HTML page parsed with a tag-stack checker to catch unclosed
   or mismatched tags (comments stripped first, `<script>`/`<style>`
   bodies skipped so JS/CSS content couldn't produce false `<`/`>`
   matches).
5. Every `id="…"` attribute checked for duplicates within its page
   (HTML comments excluded, so commented-out markup can't produce a
   false positive).
6. Every `onclick="fn(...)"` handler in every page resolved against
   the real set of globally-defined functions across all JS files.
7. Every CSS file checked for balanced `{`/`}`.
8. Every JSON file (locale files, config, etc.) parsed for validity.
9. Every top-level page checked for a `viewport` meta tag (the one
   mechanically-verifiable baseline for responsive layout).
10. A scan for hardcoded plaintext API keys/secrets and insecure
    (`http://`) external URLs.

All of the above is captured in a new, runnable, read-only script —
`test-evidence/phase9-part1-static-audit-suite.js` — rather than just
asserted in prose, so it can be re-run and re-verified independently.
Result: **1302/1302 checks passed**, output saved verbatim to
`test-evidence/phase9-part1-static-audit-output.txt`.

The existing Milestone 14 Part 1 runtime regression suite (the one
that loads the real, unmodified AI runtime — agents, orchestrator,
executive AI, conversation manager, autonomous OS layer, knowledge
graph, automation/skills engine, plugin foundation — inside a Node
`vm` sandbox) was re-run unchanged as a regression check against this
phase's audit. Result: **58/58 checks passed**, no change from the
Phase 8 baseline. Output saved to
`test-evidence/phase9-part1-runtime-regression-output.txt`.

## What this pass found

Zero defects. Every category above passed on the first run, with no
file changes required:

- No JS syntax errors (0/145 files).
- No broken asset/script/stylesheet references in any of the 16 pages.
- No unclosed or mismatched HTML tags.
- No duplicate element IDs (one apparent duplicate in `register.html`
  — `emailCta` — was investigated and confirmed to be a false
  positive: one occurrence is inside an HTML comment describing a
  future toggle, not live markup).
- No dangling `onclick` handlers — every one resolves to a real,
  defined function.
- No CSS brace mismatches across 30 stylesheets.
- No invalid JSON across 11 files, including all 11 locale files.
- `viewport` meta tag present on all 16 pages.
- No hardcoded plaintext API keys or insecure `http://` URLs.

A secondary manual pass specifically hunted for the classic "shared
script, page-specific element" bug — a `document.getElementById(...)`
call in a JS file shared across pages, targeting an ID that doesn't
exist on the page the script is actually running on (a common source
of runtime `TypeError: Cannot read properties of null`). 46 candidate
call sites were reviewed by hand:

- `js/core/auth.js`'s `regName`/`regEmail`/`regPassword`/
  `loginEmail`/`loginPassword` lookups are all inside
  `if (registerForm) { … }` / `if (loginForm) { … }` blocks keyed off
  a form that only exists on `register.html`/`login.html` — safe on
  every other page.
- `js/pages/analytics-automation-ultimate.js`'s `axSimToggle`,
  `axSimReset`, `axClearLogs`, `axLogContainer`, `axExportLogs`,
  `axDebugToggle`, `axDebugStep`, `axSaveVersion` lookups target
  elements the same function creates via `innerHTML` and inserts into
  the DOM immediately beforehand — not stale references.
- The remaining call sites are all scoped to a freshly-created or
  already-verified parent element (`card.querySelector(...)`,
  `chip.querySelector(...)`, etc.), not a bare page-wide lookup.

No fix was needed anywhere in this list.

## Why no bug-fix entries this time

Phases 2 through 8 already worked through color consistency, motion,
accessibility, architecture, and code-quality passes on this
codebase, each with its own mechanically-verified regression suite.
Phase 9 Part 1 re-validated that work holds together as a whole
system rather than assuming it does, and it does. That's a genuine QA
result, not a skipped audit — see `QA_REPORT.md` for the full
breakdown and for what's explicitly out of reach without a live
browser in this environment.

## What was preserved

- No page was redesigned. No feature was added or removed.
- No JS, CSS, or HTML content was modified — this was a verification
  pass, and verification found nothing to change.
- The only new files are the audit script and its output logs under
  `test-evidence/`, plus this changelog entry and `QA_REPORT.md`.

## Remaining items (carried forward, not in scope for this phase)

These were already open before this phase and are explicitly outside
"QA/regression, no redesign" — listed here so they aren't lost:

1. `docs/VISUAL-AUDIT-PROGRESS.md` Phases A–F (non-standard purple/
   neon color remnants in `memory-ultimate.js`,
   `analytics-automation-ultimate.js`, `brain-ultimate.js`, and a few
   CSS files) — still open, unchanged by this phase.
2. `styles/ax-premium-polish.css`'s ~136 `!important` declarations in
   responsive breakpoints — flagged in Phase 8 Part 2 as likely safe
   to prune given cascade order, but still needs a real cross-page
   visual regression pass across breakpoints, which requires a live
   browser this environment doesn't have.
3. The Milestone 5, 5-manual-commands, 6, and 10 regression suites
   still need `jsdom` to run (no network access to install it here);
   they were not re-attempted this phase since nothing in their scope
   changed.

---

# AXIOM — Phase 8 · Part 2: Code Quality & Maintainability

## Scope note (read this first)

Same honesty policy as every prior phase note: AXIOM is now a 244-file,
~55,000-line codebase with no bundler and no build step — every page
loads its scripts via static, manually-ordered `<script>` tags, and
the only automated verification available in this environment is 4
Node-runnable regression suites (Milestones 11, 12, 13, 14-Part-1 —
23 checks total across them, 164 assertions). The Milestone 5, 5's
manual-commands, 6, and 10 suites need `jsdom`, which could not be
installed here (no network access to the package registry); their
load lists were updated to match the changes below, but they could
not be executed to confirm.

Given that, this pass was bounded to changes that could be
**mechanically verified against real, unmodified behavior** — not
just read and reasoned about:

- Every split or consolidated file was checked with `node --check`
  for syntax, then the full 4-suite regression battery was re-run
  after every meaningful change (not just once at the end), so a
  regression would be caught at the moment it was introduced.
- One regression *was* caught this way (see "A refactor that was
  caught and reverted" below) — left in as evidence the verification
  step is real, not decorative.
- Where a change could not be fully verified this way (the large,
  UI-only files with no Node-side test coverage), it was left alone
  rather than guessed at. See "Deferred to Part 3."

## Modules created

**`os/runtime/agent-definitions/`** — replaces the single 671-line
`os/runtime/agent-definitions.js` with 12 files:
- `_shared.js` — the `tick()`/`has()` helpers every agent handler uses.
- `_assemble.js` — collects every agent spec into the same
  `window.AxiomAgentDefinitions` / `window.AxiomAgentDefinitionsById`
  globals the rest of the runtime already depends on.
- One file per core agent: `assistant-agent.js`, `browser-agent.js`,
  `memory-agent.js`, `planner-agent.js`, `research-agent.js`,
  `coding-agent.js`, `vision-agent.js`, `voice-agent.js`,
  `automation-agent.js`, `file-agent.js`.

Verified behavior-identical by loading the original file and the full
split in parallel Node `vm` sandboxes and diffing every spec field
(including handler source, whitespace differences excluded) — zero
mismatches. All 13 HTML pages that referenced the old single file, and
all 7 test harnesses that `load()`ed it, were updated to the new
12-file load order; the old file was then deleted.

**`os/shared/logger.js`** — new `window.AxLogger` with `log`/`warn`/
`error` methods. One choke point for what was previously 93 scattered
`console.log/warn/error(...)` calls across 36 files, each guarded
individually against a missing/partial `console`. Every call site kept
its exact original arguments — this only changes *where* the call
goes, not what gets logged or when.

**`os/shared/id-factory.js`** — new `window.AxiomMakeSeqId(prefix)`
factory. Replaces 6 independent, byte-identical inline id generators
(`prefix + '-' + Date.now().toString(36) + '-' + (++seq).toString(36)`,
each module keeping its own `seq` counter from 0) with one shared
implementation. See "A refactor that was caught and reverted" for the
7th file that looked like a match but wasn't.

Both `os/shared/` files are loaded once, ahead of the runtime files
that use them (`os-shell.html` and the corresponding test harnesses),
the same way `os/runtime/agent-definitions/_shared.js` is.

## Files refactored

**Logger standardization** (all in `os/runtime/`, 36 files, 93 call
sites) — `console.log/warn/error(` → `AxLogger.log/warn/error(`,
arguments unchanged: `agent-runtime.js`, `runtime-bootstrap.js`,
`agent-manager.js`, `executive/executive-ai.js`,
`executive/m9-bootstrap.js`, `automation/automation-engine.js`,
`automation/skill-registry.js`,
`automation/executive-automation-extension.js`,
`automation/workflow-engine.js`, `automation/m13-bootstrap.js`,
`automation/trigger-scheduler.js`, `automation/workflow-history.js`,
`intelligence/planner-intelligence.js`,
`intelligence/dynamic-workflow.js`, `intelligence/orchestrator.js`,
`intelligence/error-recovery.js`, `intelligence/runtime-monitor.js`,
`intelligence/job-manager.js`, `intelligence/browser-intelligence.js`,
`intelligence/m8-bootstrap.js`, `scheduler/autonomous-executive.js`,
`scheduler/task-scheduler.js`, `scheduler/m11-bootstrap.js`,
`scheduler/plugin-registry.js`, `scheduler/resource-monitor.js`,
`scheduler/event-timeline.js`, `capabilities/planner-store.js`,
`knowledge/m12-bootstrap.js`, `knowledge/executive-knowledge-extension.js`,
`conversation/conversation-stream.js`, `conversation/conversation-memory.js`,
`conversation/conversation-manager.js`, `conversation/m10-bootstrap.js`,
`conversation/conversation-context.js`, `plugins/plugin-manager.js`,
`plugins/m14-bootstrap.js`, `plugins/plugin-loader.js`.

**uid() de-duplication** (6 files) — inline generator replaced with
`var uid = window.AxiomMakeSeqId('<prefix>');`:
`executive/executive-ai.js` (`exec`), `automation/automation-engine.js`
(`auto`), `automation/skill-registry.js` (`skill-inv`),
`automation/executive-automation-extension.js` (`exec-auto`),
`automation/trigger-scheduler.js` (`trg`),
`scheduler/autonomous-executive.js` (`auto-exec`).

**Documentation (JSDoc)** added to the public API surface of the
three most-referenced runtime modules — `agent-manager.js` (16
functions: `register`, `unregister`, `get`, `list`, `discover`,
`findByCapability`, `activate`, `deactivate`, `registerDefaults`,
`start`, `stop`, `route`, `dispatch`, `cancel`, `status`, `snapshot`),
`agent-runtime.js` (the `Agent` constructor and its public prototype
methods: `setStatus`, `init`, `shutdown`, `enqueue`, `cancelQueued`,
`cancelCurrent`, `cancel`, `fail`, `describe`), and `task-router.js`
(`addRule`, `removeRule`, `rules`, `route`, `explain`). Comments only —
no logic touched.

**HTML pages** (all 13: `memory.html`, `admin.html`, `workspace.html`,
`browser.html`, `agent-library.html`, `os-shell.html`, `studios.html`,
`playground.html`, `analytics.html`, `billing.html`, `settings.html`,
`automation.html`, `brain.html`) — the single
`agent-definitions.js` `<script>` tag replaced with the 12-file split
sequence; `os-shell.html` additionally gained `logger.js` and
`id-factory.js` tags (the only page that loads the runtime files that
need them).

**Test harnesses** (7: `milestone5-regression-suite.js`,
`milestone5-manual-commands.js`, `milestone6-regression-suite.js`,
`milestone10-regression-suite.js`, `milestone11-regression-suite.js`,
`milestone12-regression-suite.js`, `milestone13-regression-suite.js`,
`milestone14-part1-regression-suite.js`) — `load()` sequences updated
to match the HTML changes above, so they keep testing the real,
current files in the real, current order.

## A refactor that was caught and reverted

`os/runtime/scheduler/task-scheduler.js` looked like a 7th match for
the `id-factory.js` consolidation — same `var seq = 0` /
`prefix + Date.now().toString(36) + (++seq).toString(36)` shape as the
other 6. It was converted the same way, and only *then* did re-running
the Milestone 11 suite fail:

```
HARNESS ERROR: ReferenceError: seq is not defined
    at Object.schedule (os/runtime/scheduler/task-scheduler.js:202:14)
```

`seq` in this file is not only the id counter — it's reused as a
per-task FIFO sequence number (`task.seq = ++seq`, later read back as
a sort tie-breaker: `a.seq - b.seq`). Removing the local `seq`
variable silently broke that second, unrelated use. Reverted to its
original single-file implementation; `id-factory.js`'s header comment
now documents this specific file as intentionally excluded, with the
reason. All 4 regression suites were re-run after the revert and
passed at the same counts as before the attempt (41/41, 19/19, 46/46,
58/58) — nothing else was affected.

## Investigated, consolidation deferred: the 11 `escapeHtml()` implementations

Part 1 flagged this as "not behaviorally identical" without fully
characterizing the differences. This pass read all 11 implementations
side by side and found three distinct groups, not one bug plus ten
matches:

1. **6 files** (`os/core/memory-world.js`,
   `js/bridges/workspace-chat-bridge.js`,
   `js/bridges/agent-chat-bridge.js`, `js/pages/agent-library.js`,
   `js/pages/browser-live.js`, `js/pages/workspace.js`) escape all
   five characters (`& < > " '`) via a regex + character map, and
   agree on output for normal string input — but differ on whether
   they wrap the input in `String(...)` first, so they'd disagree on
   `null`/`undefined` input specifically.
2. **2 files** (`js/pages/admin.js`, `js/pages/billing-checkout.js`)
   escape the same five characters via chained `.replace()` calls
   instead of a map, with a `String(...)` wrap — output-equivalent to
   group 1 for normal input.
3. **3 files with real, distinct behavior**: `js/pages/ax-chat-core.js`
   uses the DOM (`div.textContent = text; return div.innerHTML`),
   which does not escape `"`/`'` the way the others do; 
   `js/pages/ai-workspace-ultimate.js` never escapes `'` at all (only
   `& < > "`); and `js/pages/workspace-ultimate.js` has the bug Part 1
   noted — its character map sends `<`, `>`, and `"` to themselves
   instead of to entities, so only `&` and `'` actually get escaped.

Per this phase's brief ("do NOT modify business logic"), fixing the
two confirmed bugs (`ai-workspace-ultimate.js`'s missing apostrophe,
`workspace-ultimate.js`'s three unescaped characters) or changing
`ax-chat-core.js`'s DOM-based approach would change what each page
outputs today — that's a behavior change, not a refactor, however
clearly it looks like a bug. Left untouched and documented here for a
phase whose brief explicitly allows fixing bugs.

## Deferred to Part 3

- The `escapeHtml()` bug fixes + consolidation above, once a phase
  brief permits behavior changes.
- Every other duplicated helper Part 1 flagged (`init()` patterns
  across workspace modules) — not investigated this pass; time went
  to the items above instead.
- Splitting large **UI-bearing** files (`os/core/ai-core.js` — 1043
  lines, `js/core/os-shell.js` — 864 lines, `js/pages/workspace-ultimate.js`
  — 1231 lines, and others) into smaller modules. `agent-definitions.js`
  was a safe split because its output is fully checkable in Node (a
  data array + handler functions, no DOM). These files render UI and
  wire up 12+ pages' worth of visual/interactive behavior with no
  headless test coverage in this project and no browser available in
  this environment — splitting them means editing `<script>` tags
  across every page that loads them with no way to visually confirm
  nothing broke. Same caution Part 1 applied to the `!important`
  cleanup in `ax-premium-polish.css`.
- Trimming each page's script list (still loading the full ~30-file
  `os/runtime/*` stack regardless of whether that page uses it) —
  flagged by Part 1, not addressed here; same reasoning as above.
- `styles/os-shell.css` (2155 lines) and the other large stylesheets —
  no CSS was touched this pass.
- Broader JSDoc coverage — this pass documented the 3 most-referenced
  runtime modules' public APIs; the other ~33 `os/runtime/` files and
  everything in `js/core/` / `js/pages/` still have only their
  existing file-level banner comments.

## Verification

Before touching anything:
```
Milestone 11: 41/41 checks passed.
Milestone 12: 19/19 checks passed.
Milestone 13: 46/46 checks passed.
Milestone 14-Part-1: 58/58 checks passed.
```
After every change in this pass (agent-definitions split, logger
swap, uid() consolidation including the caught-and-reverted attempt,
JSDoc additions):
```
Milestone 11: 41/41 checks passed.
Milestone 12: 19/19 checks passed.
Milestone 13: 46/46 checks passed.
Milestone 14-Part-1: 58/58 checks passed.
```
Identical counts throughout — no check gained, lost, or changed
meaning. `node --check` was run on every modified/created `.js` file
after every edit. Milestones 5, 5-manual-commands, 6, and 10 could not
be run in this environment (see Scope note) — their `load()` lists
were updated to match, but that update is unverified.

## Phase 8 completion summary

Part 1 (file/folder organization, dead-code archival, duplication
inventory) plus Part 2 (this pass: one monolithic file safely split
into 12, a shared logger replacing 93 scattered console calls, 6
duplicate id generators consolidated into 1 shared factory, JSDoc
added to 3 core modules' public APIs, and a full, honest inventory of
what's still duplicated or undocumented) close out Phase 8's "Code
Quality & Maintainability" objectives to the extent they could be done
**and verified** without a browser, a bundler, or network access in
this environment. The largest remaining opportunities — UI-file
splitting, per-page script trimming, and the `escapeHtml()` bug fixes
— are called out above rather than attempted blind, consistent with
every prior phase's scope notes.

---

# AXIOM — Phase 8 · Part 1: Architecture Cleanup

## Scope note (read this first)

Same honesty policy as the Phase 7 note below: AXIOM is a 231-file,
~54,000-line codebase assembled across 14+ milestones, most pages
loading 40-80 `<script>` tags. A blind, unverified "clean up
everything" pass over that surface area is how real regressions get
introduced, so this pass was deliberately bounded to changes that
could be **mechanically verified**:

- Every file move was paired with a rewrite of every `src=`/`href=`
  reference to it, then a script confirmed every local reference in
  every HTML file still resolves to a real file on disk.
- Every CSS `@import` was re-checked after the move (this caught a
  real bug — see below — and it was fixed, not just flagged).
- Total line count of all `.js`/`.css`/`.html` content was diffed
  before and after (54,340 lines both times): confirms no code was
  added, deleted, or rewritten — only paths changed.
- "Dead file" candidates were checked three ways (static HTML
  references, `@import` chains, and dynamic string-based loading in
  JS) before being archived, because a first-pass grep alone produced
  false positives (e.g. `design-tokens.css` looked unreferenced until
  its `@import` chain from six other stylesheets was found).

Nothing in this pass touches JS logic, CSS rules, or HTML markup —
only file locations and the paths that point at them.

## Folder structure

The project previously kept ~50 active JS/CSS files loose at the
project root alongside the 16 HTML pages. Reorganized into:

- `styles/` — all site CSS (previously split between root and
  `styles/`; `app.css`, `rtl.css`, `os-shell.css` moved in,
  `styles.css` moved in and renamed `base.css` to match what it
  actually is — the base stylesheet, not "generic styles").
- `js/core/` — site-wide bootstrap/shared scripts loaded on nearly
  every page (`auth.js`, `app.js`, `core-ui.js`, `i18n.js`, config
  files, `os-state-engine.js`, `accessibility.js`, etc. — 20 files).
- `js/pages/` — page-specific controllers (`workspace.js`,
  `admin.js`, `agent-library.js`, the `*-ultimate.js` page modules,
  etc. — 19 files).
- `js/bridges/` — the three cross-page messaging bridges
  (`conversation-bridge.js`, `agent-chat-bridge.js`,
  `workspace-chat-bridge.js`).
- `docs/` — the milestone deliverables docs (`docs/milestones/`) and
  audit notes (`docs/audits/`), out of the project root.
- `db/` — the two SQL files, with `Schema.SQL` renamed `schema.sql`
  (was the only PascalCase filename in the project; the one comment
  in `admin.js` referencing it by name was updated to match).

`os/`, `components/`, `locales/`, `test-evidence/`, and `assets/` were
already reasonably organized and were left as-is.

All 16 HTML pages had their `<link>`/`<script>` tags updated to the
new paths (222 individual reference updates across the pages). No
page's script/style load order was changed — only the paths.

## Dead code / assets removed

Moved to `_archive/unused-legacy/` (kept, not deleted, in case
something outside this repo depends on them — flag for deletion in
Part 2 once confirmed safe):

- `ai-reactor-core.js` / `ai-reactor-core.css` — no `<script>`/`<link>`
  tag, no dynamic loader, no `@import` anywhere.
- `agent-library.css` — same; `agent-library.html` never linked it.
- `theme.css` (root) — already flagged `ORPHANED` in a comment inside
  `design-tokens.css` from a prior audit; confirmed still true.
- `workspace.css` (root) — not linked by `workspace.html` (which uses
  `styles/ax-workspace.css` instead).
- `styles/os-interface.css`, `styles/workspace-os.css`,
  `styles/conversation-bridge.css` — no `<link>` tag and no `@import`
  from any live stylesheet (checked the full `@import` graph, not
  just direct references).

Two files that looked orphaned on a first pass turned out **not** to
be dead and were left in place: `styles/design-tokens.css` and
`styles/premium-os.css` are both pulled in via `@import` from several
other stylesheets rather than linked directly from HTML. Also left
alone: `os/workspaces/*.js`, which load dynamically via a
`os/workspaces/${workspaceId}.js` template string in
`os/core/workspace-manager.js` rather than a static `<script>` tag —
grepping for the literal filename would have wrongly flagged these as
unused.

## Bug found and fixed during the move

Moving `styles.css` → `styles/base.css` and `os-shell.css` →
`styles/os-shell.css` broke their `@import url("styles/design-tokens.css")`
line, which was written when the file lived at the project root — now
that the importing file lives inside `styles/` itself, the import
needed to become a same-folder reference. Fixed to
`@import url("design-tokens.css")` in both files and re-verified the
full import graph resolves.

## Duplication identified, not yet merged

`escapeHtml()` is independently defined in 11 files (`ax-chat-core.js`,
`workspace-chat-bridge.js`, `ai-workspace-ultimate.js`,
`agent-chat-bridge.js`, `os/core/memory-world.js`, `admin.js`,
`agent-library.js`, `billing-checkout.js`, `workspace.js`,
`browser-live.js`, `workspace-ultimate.js`) and a `uid()`/ID-generator
helper appears in 12. These are real duplication, but the
implementations are **not** behaviorally identical — e.g.
`workspace-ultimate.js`'s version maps `<`/`>`/`"` to themselves
instead of HTML entities (so it doesn't actually escape those
characters), while the other 10 do. Consolidating these into one
shared helper would silently change behavior on at least that one
page, which conflicts with "preserve all existing functionality."
Left as-is and documented rather than merged blind — see Remaining
Work.

## Remaining work for Part 2

- Reconcile the 11 `escapeHtml()` implementations: confirm which
  behavioral differences (if any) are intentional per-page vs. bugs,
  fix the ones that are bugs, then consolidate into one shared
  `js/core/dom-utils.js` helper.
- Same treatment for the duplicated `uid()`/ID-generator and `init()`
  patterns found across the runtime/workspace modules.
- Trim each HTML page's script list — most pages load the entire
  `os/runtime/*` stack (30+ files) regardless of whether that page
  uses it; worth auditing per-page actual usage before Part 1's
  restructuring is extended into lazy-loading or bundling.
- Consider deleting (vs. archiving) the 8 files now in
  `_archive/unused-legacy/` once confirmed nothing external depends
  on them.
- A few code comments (e.g. in `os-interface.js`) still reference the
  now-archived `styles/os-interface.css` by name; harmless (comments
  only) but worth a pass to update or remove.
- No `.js` file in this project uses ES modules or a bundler — actual
  duplicate *logic* (not just duplicate file locations) can't be
  removed via `import`/`export` without introducing a build step,
  which is a bigger decision than this cleanup pass should make
  unilaterally.

---

# AXIOM — Phase 7 · Part 2: Accessibility Compliance & Polish

## Scope note (read this first)

AXIOM is a 231-file, ~54,000-line codebase. This pass did **not** attempt
a line-by-line audit of every file — that isn't achievable with real
verification in one pass, and claiming otherwise would just mean
unverified changes. Instead, this pass:

1. Verified Part 1's foundation (focus rings, skip links, `.sr-only`,
   toast live-region, motion tokens) was still intact and load-bearing.
2. Measured actual WCAG 2.2 contrast ratios (via the relative-luminance
   formula, not eyeballing) for every color token in
   `styles/design-tokens.css` and every hardcoded color in the files
   touched below, and fixed the ones that failed.
3. Traced real user flows end-to-end (auth error → is it announced?
   settings toggle → does its checkbox have a name? AI reply streams in
   → does a screen reader user ever find out?) rather than pattern-matching
   on markup in isolation.
4. Left a written trail of what's still open (see **Remaining Items**)
   instead of marking the whole app "AA compliant."

Nothing below changes layout, removes a feature, or alters business
logic — every change is additive (an attribute, a CSS rule, a token
value) or a same-appearance value substitution (a color swapped for a
different color at the same position in the same design language).

## Color contrast fixes (WCAG 1.4.3 / 1.4.11)

- **`styles/design-tokens.css`** — `--ax-text-tertiary` was
  `rgba(255,255,255,.35)`, measuring **3.07:1** against `--ax-bg`
  (fails the 4.5:1 AA minimum for normal text). This token isn't
  decorative — it's used for form field labels (`.field label`),
  section eyebrows, table headers (`table th`), status badges, and
  body copy (`.ax-sub-tertiary`) across `ax-redesign.css` and
  `ax-pages.css`. Changed to `#7C7C7C`, verified at **4.88:1** on
  `--ax-bg` and **4.52:1** on the lightest surface it's used against
  (`--ax-surface-3`). This is a single-token fix with app-wide reach.
  The Purple Aurora accent colors (`--ax-glow` #A855F7, `--ax-glow-2`
  #EC4899) were checked too — both already pass AA (5.15:1 / 5.78:1)
  and were left untouched, per the brief to preserve the identity.
- **`components/notifications-center.js`** — this component builds its
  panel CSS from hardcoded `rgba(255,255,255,N)` literals rather than
  the shared tokens, so the token fix above didn't reach it. Measured
  and fixed 7 occurrences against the panel's actual `#111` background:
  unread-count badge, header action buttons, and inactive tab labels
  (all `.35` → 2.71:1, now `.62` → 7.06:1); message body text (`.4` →
  3.29:1, now `.65` → 7.73:1); timestamp (`.25` → 1.81:1, now `.55` →
  5.63:1); empty-state text (`.15` → 1.25:1, now `.55` → 5.63:1);
  footer link (`.3` → 2.22:1, now `.62` → 7.06:1); default priority
  indicator dot (`.3` → 2.22:1, now `.45` → 3.97:1, meets the 3:1 floor
  for non-text UI components under 1.4.11).

## Screen reader / AI interaction fixes

- **`app.js`** — the main chat window (`#chatWindow`, used on
  `playground.html`) had no live-region coverage at all: a screen
  reader user sending a message and getting a reply would hear
  nothing. Added:
  - An announce call inside `addChatMessage()` for any non-streaming
    assistant message (covers error messages, the "didn't get a
    response" fallback, and any future non-streaming call site) —
    routed through the same `window.AxiomA11y.announce()` shared live
    region Part 1 built for toasts.
  - A separate announce call in `streamAssistantReply`'s `onDone`,
    firing once with the complete text when a streamed reply finishes
    — deliberately *not* wired to fire on every token, since the
    bubble updates via `requestAnimationFrame`-batched writes many
    times a second and announcing each one would make the chat
    unusable with a screen reader.
- **`playground.html`** — `#chatWindow` labeled `role="region"
  aria-label="Conversation"` so it's identifiable as a landmark
  distinct from the surrounding page chrome. `#chatInput` (the
  message textarea) given `aria-label="Message Axiom"` — its
  `placeholder` text disappears on input and isn't a reliable
  accessible name for all assistive tech.
- **`settings.html`** — 5 toggle switches (Two-factor authentication,
  Generation complete, Product updates, Billing alerts, Weekly digest)
  are real `<input type="checkbox">` elements, but their visible label
  text lives in a sibling `<strong>`, not inside the `<label>` wrapping
  the checkbox — so each one had an empty accessible name (a screen
  reader announced only "checkbox, not checked," with no indication of
  what it controlled). Added a matching `aria-label` to each checkbox.
  No visual or behavioral change.
- **`browser.html`**, **`workspace.html`** — 2 icon-only buttons ("New
  Tab", "New page") relied solely on the `title` attribute for their
  name, which isn't reliably exposed by all screen readers/on touch.
  Added matching `aria-label` alongside the existing `title`.

## Reduced motion (WCAG 2.3.3 / user preference)

- **`styles/accessibility.css`** — added a blanket
  `@media (prefers-reduced-motion: reduce)` rule that zeroes
  `animation-duration`, `animation-iteration-count`, and
  `transition-duration` on every element, plus disables smooth
  scrolling. Part 1's `motion-tokens.css` already zeroes every
  `--motion-duration-*` variable, which covers the token-based system,
  but can't reach components that animate with hardcoded values —
  e.g. `notifications-center.js`'s inline `animation: axNotifIn .2s
  cubic-bezier(...)`. This rule is loaded last on every page (same
  position as the rest of `accessibility.css`) so it wins that tie
  without editing every component individually. No visible effect for
  users who haven't enabled "reduce motion."

## Responsive / touch accessibility (WCAG 2.5.8)

- **`styles/accessibility.css`** — icon-only controls under 24×24px
  (`.icon-btn`, `.ax-dock-item`, `.ax-topbar-item`,
  `.ax-notif-trigger`, and small `icon-btn` variants like
  `.ax-browser-icon-btn-sm` at 26px) get an invisible 44×44px hit-area
  overlay under `(pointer: coarse)` or narrow viewports, via a
  `::after` pseudo-element. Visual size and desktop layout are
  unchanged; this only affects tap-target area on touch input.

## Forms

- **`styles/accessibility.css`** — added `[aria-invalid="true"] {
  outline: 1.5px dashed var(--ax-error) }` so any input a form's
  validation JS marks invalid gets a visible, non-color-only error
  indicator (WCAG 1.4.1), and a focus-visible ring fix for
  `.ax-switch` so the pill shape doesn't clip the ring.
- Re-verified `login.html` / `register.html` (Part 1's work): labels
  are correctly associated via `for`/`id`, and `#authError` already
  carries `role="alert" aria-live="assertive"` — both still intact,
  no changes needed.

## Verified, left unchanged (checked, not touched)

- `ax-dialogs.js`'s `confirmDialog`/`promptDialog` — already
  `role="dialog" aria-modal="true"`, wired to `AxiomA11y.trapFocus()`,
  closes on Escape, restores focus to the trigger on close. No gaps
  found.
- `auth.js`'s error handling — already routes through the
  `role="alert"` box confirmed above.
- Icon buttons carrying visible adjacent text (e.g. "Bookmarks",
  "Launch" buttons in `browser.html` / `agent-library.html`) — their
  accessible name comes from the visible text, so no `aria-label`
  needed; left as-is.

## Remaining items (not covered by this pass)

1. **`components/notifications-center.js`'s `render()` never actually
   builds the trigger button or panel/list markup into the DOM** — it
   only injects a `<style>` block; `container.querySelector('.ax-notif-trigger')`
   resolves to `null`. This was discovered while fixing the color
   values in that same file. It's a missing-markup/business-logic gap,
   not an accessibility-attribute gap, so it's out of scope for this
   pass (the brief excludes new features/business logic) — flagged
   with an inline code comment for whoever picks it up. Once that
   markup exists, it will need `role="dialog"` or a listbox pattern,
   `aria-expanded` on the trigger, and keyboard support for the tabs —
   none of which can be added to elements that aren't rendered yet.
2. **Full-app icon-only-button sweep** — this pass checked and fixed
   every `.icon-btn`-class button missing a name (2 found, both fixed)
   and spot-checked the prompt-bar buttons on `playground.html`
   (already labeled by Part 1). It did not exhaustively scan all 231
   files for every possible unlabeled icon button outside that class
   naming convention — a worthwhile follow-up with more time budget.
3. **`--ax-border-strong` (`rgba(255,255,255,.15)`, 1.43:1)** — used
   widely as a decorative panel/card border, which doesn't require
   3:1 under 1.4.11. It's *also* used in a few places as the only
   visual distinction on interactive element states (e.g. some
   input borders); a full pass would need to separate "purely
   decorative" from "conveys state" usages file-by-file before
   changing the value app-wide. Not done here — flagged for a
   follow-up.
4. **Automated axe-core / Lighthouse pass** — everything in this
   changelog was checked by tracing markup and computing contrast
   ratios by hand (formula-verified, not eyeballed), not by running an
   automated accessibility scanner against rendered pages in a
   browser, since this environment can't render the app live. A real
   axe-core run against all 16 pages would likely surface additional
   items and should happen before calling this "AA compliant" rather
   than "AA-pass-in-progress."

## What was preserved

- All layouts, grid structures, and responsive breakpoints — unchanged.
- The Purple Aurora accent palette (`--ax-glow`, `--ax-glow-2`, and
  every gradient built from them) — untouched; both already pass AA
  where used as text.
- All existing animations — unchanged in duration/easing for users who
  haven't enabled reduced motion; only behavior added, not removed.
- All JS hooks, `data-*` attributes, IDs, and event bindings — untouched.
- Part 1's entire foundation (`accessibility.css`, `accessibility.js`,
  `motion-tokens.css`, skip links, focus rings, toast live region) —
  verified intact, extended rather than replaced.

# AXIOM — Phase 7 · Part 1: Accessibility Foundation

Scope for this pass: a keyboard-and-screen-reader accessibility audit and
remediation across all 16 pages, without changing any page's layout,
visual styling, animation, or feature behavior. Every change below is
additive (new attributes, a new shared stylesheet/script) or a
same-appearance semantic correction (e.g. `role="heading"` instead of
changing a heading's HTML tag, which would have changed its font size).

## Files added

- `styles/accessibility.css` — global focus-visible rings (keyboard-only,
  invisible to mouse/touch users), `.sr-only` / `.sr-only-focusable`
  utilities, skip-link styling, and a rule that shows the floating dock's
  existing hover tooltip on keyboard focus too.
- `accessibility.js` — three small, page-agnostic behaviors loaded on
  every page: Enter/Space activation for the app's `role="button"`
  `<div>` controls, a reusable `AxiomA11y.trapFocus()` helper, and a
  `MutationObserver` that mirrors new toast text into a shared
  `aria-live="polite"` region so toast notifications are announced.

## Files modified

**Every one of the 16 HTML pages** got the same baseline treatment —
listed once here rather than per file:
- `index.html`, `login.html`, `register.html`, `admin.html`,
  `agent-library.html`, `analytics.html`, `automation.html`,
  `billing.html`, `brain.html`, `browser.html`, `memory.html`,
  `os-shell.html`, `playground.html`, `settings.html`, `studios.html`,
  `workspace.html`
  - Added a skip-to-main-content link as the first focusable element.
  - Linked `styles/accessibility.css` and `accessibility.js`.
  - Ensured the page's main landmark has a stable `id` and
    `tabindex="-1"` so the skip link actually moves focus, not just
    scroll position.

Plus page-specific fixes:
- `login.html`, `register.html` — added a missing `<main>` landmark
  around the auth card; added `role="alert" aria-live="assertive"` to
  the inline auth-error message container so validation/API errors are
  announced when `auth.js` populates them.
- `agent-library.html`, `os-shell.html`, `playground.html`,
  `workspace.html` — added a visually hidden (`.sr-only`) `<h1>` page
  title; these app-shell pages previously had no `<h1>` at all.
- `admin.html`, `analytics.html` — corrected heading hierarchy
  (`<h1>` was followed directly by `<h3>` with no `<h2>`) using
  `role="heading" aria-level="2"` on the existing `<h3>` elements,
  rather than changing the tag, since `styles/ax-pages.css` styles
  `.ax-chart-header h3` specifically and retagging would have shrunk
  those headings visually.
- `memory.html` — same heading-level fix for the "Add Memory" modal
  title; also gave that modal `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby`, and labeled its `✕` close button
  (`aria-label="Close dialog"`).
- `agent-library.html` — gave the `#agentEditor` modal
  `role="dialog"`/`aria-modal`/`aria-labelledby`, labeled its `✕`
  close button, and added `aria-label="Add to favorites"` plus
  `aria-pressed="false"` to the four icon-only favorite/star toggle
  buttons, which previously had no accessible name at all.
- 12 shared-dock pages (`admin`, `agent-library`, `analytics`,
  `automation`, `billing`, `brain`, `browser`, `memory`, `playground`,
  `settings`, `studios`, `workspace`) — the floating dock `<nav>` now
  consistently carries `role="navigation" aria-label="Main navigation"`;
  the topbar's notification-bell trigger, command-palette button, and
  profile avatar (all `<div>`-based click targets) now have
  `role="button"`, `tabindex="0"`, and `aria-label`; the topbar search
  input has an explicit `aria-label` instead of relying on `placeholder`
  alone.
- `browser.html`, `playground.html`, `workspace.html` — 23 icon-only
  `<button>` elements that had a `title` attribute but no visible text
  or `aria-label` (undo/redo, formatting toolbar, browser back/forward/
  refresh, chat sidebar/artifact toggles, attach/mic/send) now also
  carry a matching `aria-label`, so their accessible name doesn't
  depend solely on `title` (which some assistive tech and all touch
  interfaces skip).
- `components/ax-dialogs.js` — `confirmDialog()`/`promptDialog()` now
  trap Tab focus inside the modal and return focus to whatever
  triggered them on close, via the new `AxiomA11y.trapFocus()` helper.
  (These already had `role="dialog"`, `aria-modal`, initial focus, and
  Escape-to-close from earlier work — this pass only added the trap
  and focus return.)
- `components/quick-command.js` — the ⌘⇧K command palette now exposes
  `role="dialog"`, and its input/results are wired as a proper
  `role="combobox"` / `role="listbox"` / `role="option"` pattern with
  `aria-selected` and `aria-activedescendant` kept in sync with the
  existing arrow-key selection logic; added the same focus trap/return
  as above; decorative icon SVGs marked `aria-hidden="true"`.
- `components/universal-search.js` — same `role="dialog"` /
  `role="listbox"` / `role="option"` treatment and focus trap/return as
  the command palette above.

## Verification

- Confirmed every `<main>`/`</main>` and `<body>`/`</body>` pair is
  balanced on all 16 pages after editing (one landmark-conversion bug
  in `login.html` was caught this way and fixed).
- Syntax-checked all 44 root-level `.js` files plus the three modified
  `components/*.js` files — all parse cleanly.
- No CSS selector, class name, id used by existing JS, inline `style=`
  attribute, or script tag order was changed; every edit either added
  a new attribute/element or changed a tag's ARIA role without
  changing its HTML tag or class.

## Remaining work for Part 2

- **Keyboard arrow-navigation in Universal Search** (`⌘K` /
  `components/universal-search.js`): unlike the command palette, this
  component only supports Enter-selects-first-result today; adding
  Up/Down navigation is a logic change, deferred out of this
  foundation pass to keep Part 1 to additive/non-behavioral fixes.
- **Notifications Center** (`components/notifications-center.js`):
  this component currently only injects a `<style>` block — it has no
  code path that renders the notification list or trigger markup, so
  it does not appear to open on click in its current state on any
  page. This looks like a pre-existing functional gap rather than
  something introduced or touched by this pass; flagging it here
  since it will need real markup before it can be made accessible
  (ARIA roles, focus management, live-region announcements for new
  notifications).
- **Deep JS-generated content audit**: pages like `workspace.html`,
  `brain.html`, `automation.html`, and `os-shell.html` render large
  amounts of UI dynamically from `os/runtime/*`, `workspace-ultimate.js`,
  `brain-ultimate.js`, and similar "ultimate" modules. This pass
  covered every static HTML element across all 16 pages plus the
  shared dialog/menu components, but did not trace every runtime code
  path that injects markup at runtime (chat messages, agent cards,
  automation nodes, brain visualizations). Recommend an automated
  axe-core or Lighthouse accessibility scan of each page *after*
  its dynamic content has loaded, to catch anything generated purely
  in JS.
- **Color contrast audit**: this pass focused on structure, labels,
  and keyboard operability per the stated objectives; a systematic
  contrast-ratio check (WCAG 1.4.3) against `color-report.txt` /
  the design tokens was not performed and should be Part 2's next
  objective.
- **Live regions for async state changes** outside of toasts (e.g.
  loading skeletons in `workspace.html`'s `#axDocSkeleton`,
  streaming AI responses) are not yet announced to screen readers.
- **Full keyboard walkthrough with a screen reader** (VoiceOver/NVDA)
  of each page's primary task flow — this pass was a structural/code
  audit; a manual AT pass is recommended before sign-off.

---



Continues from Phase 6 Part 1 (Frontend Performance Optimization, below).
Scope for this pass: AI Core rendering/animation cost, streaming
responsiveness, animation-loop hygiene (rAF vs setInterval), and a
memory/duplicate-request audit across the runtime layer. No visual
output, features, or business logic changed — every change here is
either a cache/dedupe of work the browser was already doing, or a
batching of DOM writes that were already happening, to the same
final result.

## Files modified

- `os/core/ai-core.js` — AI Core canvas renderer
- `os/core/ai-avatar.js` — holographic avatar (eye-tracking, talk animation)
- `os/wallpapers/wallpaper-engine.js` — OS shell background renderer
- `app.js` — main chat streaming path
- `ai-workspace-ultimate.js` — model-compare streaming path

## Runtime optimizations

### 1. AI Core bloom pass — cached instead of recomputed every frame
`drawBloom()` in `ai-core.js` was applying a full-canvas `ctx.filter =
blur(...)` — the single most expensive operation anywhere in the render
loop — on every animation frame (up to 60×/sec), even though its input
(a solid disc sized/colored from the current state's `energy` and
`plasmaColor`) never changes except on a state transition or resize.
The blurred bitmap is now computed once into an offscreen canvas and
cached by a key of `[canvas size, color, energy]`; every frame after
that just composites the cached bitmap (a cheap `drawImage`), and the
blur only reruns when the key actually changes. Pixel output is
identical — same blur radius, same color, same composite mode — only
the redundant per-frame recomputation is gone.

### 2. AI Core resize handling — debounced
`resize()` reallocates the canvas backing store and resets the 2D
context transform — not cheap. It was wired directly to the `resize`
event, which fires continuously (many times per second) while a window
is being dragged or the OS shell's layout is being resized. It's now
debounced (120ms of quiet before it runs), so a drag-resize triggers one
reallocation when it settles instead of dozens while it's in motion.

### 3. AI Core / Wallpaper Engine — paused while the tab is hidden
`ai-core.js`'s main rAF loop had no `visibilitychange` handling, unlike
several sibling files (`os-environment.js`, `os-shell.js`,
`os-state-engine.js`, `agent-chat-bridge.js`) that already pause their
loops when `document.hidden`. Added the same pattern here: the loop now
cancels on hide and resumes on return (respecting the existing
sleep/offline pause logic, so it won't fight with an intentional pause).
`wallpaper-engine.js`'s continuous canvas renderers (aurora flow,
particles, gradient mesh, time-of-day) had the same gap — added the
identical pause/resume. Both now stop burning CPU/GPU/battery on
animations nobody can see while a tab is backgrounded.

### 4. Streaming chat — batched to one DOM write per frame, not per token
In `app.js`'s `streamAssistantReply()`, every single SSE token was
triggering `bubble.textContent = fullText` (a full reflow of the
growing message) followed by `chatWindow.scrollTop =
chatWindow.scrollHeight` (forces a synchronous layout read). On a fast
stream, several tokens can arrive within one 16ms frame — each one was
getting its own reflow + layout pass. Updates are now batched: the
latest text is stored and a single `requestAnimationFrame` flush is
scheduled per frame, so a burst of tokens between paints produces one
DOM write instead of N. `onDone` does a final synchronous write of the
complete text first, so the message is never left showing a stale
partial string if a batched frame was still pending when the stream
ended. Rendered result is byte-identical to before.

The same batching was applied to `ai-workspace-ultimate.js`'s
`runCompareModel()`, which streams multiple models side-by-side in
Compare mode — this one benefits more, since it can have several of
these reflow-per-token loops running concurrently.

### 5. AI Avatar eye-tracking — batched to one transform write per frame
`ai-avatar.js`'s cursor-follow eyes were recomputing and writing
`style.transform` inside the raw `mousemove` handler, which can fire
far more often than the display refreshes (especially on high-polling-
rate mice/trackpads). Now the latest event is stored and applied via a
single `requestAnimationFrame` callback per frame, cutting redundant
style writes between paints without changing how the eyes track.

## Memory improvements

No memory leaks were found and "fixed" as such — the codebase was
already reasonably disciplined here (e.g. `window-manager.js`'s window
drag/resize listeners are correctly paired with
`removeEventListener` on drag-end). The improvements in this pass are
about *avoided* work rather than *reclaimed* leaks:

- The AI Core's bloom cache (above) also means one less full-size
  offscreen canvas + blur buffer being churned every frame — real
  savings in transient allocation/GC pressure, not just CPU time.
- Pausing the AI Core and Wallpaper Engine loops on tab-hide (above)
  stops both from continuing to allocate per-frame drawing state
  (particle position updates, gradient objects, etc.) for a screen
  nobody is looking at — the highest-impact "memory usage while idle"
  win available without restructuring either component.
- The streaming-response batching (above) means a long assistant reply
  no longer forces the browser to retain N intermediate full-string
  copies and N forced layout trees in quick succession — only the
  current pending string is held between frames.

## What was audited but found already correct (no change needed)

- **Duplicate API requests**: Traced every `fetchModels()` call site —
  `model-selector.js` calls it exactly once from `init()`, and
  `agent-library.js`'s call is on a separate page that never loads
  `model-selector.js`. No redundant concurrent fetches found.
- **Runtime heartbeats/monitors** (`runtime-monitor.js`'s `tick()`,
  `agent-manager.js`'s heartbeat, `axiom-brain.js`'s periodic `emit()`,
  the various `os/runtime/*` schedulers): all are local, in-memory
  bookkeeping on multi-second/minute intervals — no network calls, no
  duplication across instances. Left untouched; converting any of these
  to event-driven updates would be a logic change, not a performance
  fix, and is out of scope ("do not modify business logic").
- **Event-listener cleanup**: Spot-checked `window-manager.js`'s
  drag/resize handling — `removeEventListener` is correctly called for
  every corresponding `addEventListener`. No leak.

## Performance benchmark summary

These are directional, reasoned-through estimates based on what each
change removes from the hot path — not measured Lighthouse/DevTools
Performance-panel numbers (no browser profiling environment was
available in this pass; see Part 1's changelog for the same caveat on
its script-loading estimates).

| Change | Frequency before | Frequency after | Expected impact |
|---|---|---|---|
| AI Core bloom blur | every frame (~60/sec) | only on state change / resize | Largest single win in this pass — removes the most expensive canvas op from the steady-state frame budget entirely |
| AI Core resize | every `resize` event (dozens/sec while dragging) | once, 120ms after movement stops | Eliminates redundant canvas reallocation storms during window drag |
| AI Core / Wallpaper idle | continuous, tab hidden or not | paused while `document.hidden` | ~100% CPU/GPU/battery savings for these two loops whenever the tab is backgrounded |
| Chat stream reflow | once per SSE token | once per animation frame (≤ token rate) | Prevents reflow count from scaling with token rate on fast streams; biggest gain on long, quickly-generated replies and on Compare mode's concurrent streams |
| Avatar eye tracking | once per `mousemove` event | once per animation frame | Removes redundant style writes on high-frequency pointer input |

## Phase 6 completion summary

Phase 6 is now complete across both parts:

- **Part 1** (Frontend Performance Optimization): deferred 578
  render-blocking `<script>` tags across all 16 pages, added missing
  `preconnect` hints, and audited (without touching) unused CSS/JS,
  event-listener counts, and image/video loading.
- **Part 2** (AI & Runtime Performance, this pass): removed the AI
  Core's per-frame blur recomputation, debounced its resize handling,
  added tab-visibility pausing to the AI Core and Wallpaper Engine,
  batched streaming-chat and eye-tracking DOM writes to animation
  frames, and audited API-request patterns, runtime heartbeats, and
  listener cleanup for duplication/leaks (none found beyond what's
  already fixed above).

Everything shipped in both parts is a loading-order, caching, batching,
or idle-pause change — no markup, styling, animation timing/easing,
business logic, or user-facing behavior was altered. Remaining
opportunities from both parts (orphaned CSS/JS verification, CSS-usage
purge, `resize`/`scroll` listener consolidation, and now: real
before/after profiling with browser DevTools to replace the directional
estimates above with measured numbers) are consolidated as the open
backlog for whatever comes after Phase 6.

---

# AXIOM — Phase 6 · Part 1: Frontend Performance Optimization

Continues from Phase 5 Part 2 (AI Motion & Premium Polish, below).
Scope for this pass: audit and improve script/asset loading performance
across all 16 HTML entry points without changing any markup structure,
visual design, animations, or application logic.

## Files modified

All 16 HTML entry points:
- `admin.html`, `agent-library.html`, `analytics.html`, `automation.html`,
  `billing.html`, `brain.html`, `browser.html`, `index.html`, `login.html`,
  `memory.html`, `os-shell.html`, `playground.html`, `register.html`,
  `settings.html`, `studios.html`, `workspace.html`

No CSS or JS files needed modification for this pass — see "What was
audited but left alone" below for why.

## Performance optimizations applied

### 1. Deferred all render-blocking `<script>` tags (578 tags across 16 files)
Every page was loading its full script chain — in `os-shell.html`'s case,
**84 separate `<script src="...">` tags** — as classic, synchronous,
render-blocking scripts. Each one halts HTML parsing and any pending
paint until it finishes downloading *and* executing, one after another.
Added the `defer` attribute to every one of these (578 total, all pages
combined) so the browser can parse the full document and paint the page
without stalling on script execution, while scripts still run in their
original relative order, right before `DOMContentLoaded` — same order
guarantees as before, just off the parser's critical path.

Two categories were intentionally left untouched:
- The 4 inline `<script>` blocks (in `brain.html`, `login.html`,
  `memory.html`, `settings.html`) — these were manually reviewed and
  don't reference any globals from the now-deferred scripts at their
  top level (they either wait for `DOMContentLoaded` or only touch
  static DOM nodes), so reordering them relative to the deferred scripts
  is safe.
- `playground.html`'s two KaTeX CDN scripts, which already had `defer`.

### 2. Added `preconnect` resource hints for third-party origins
`fonts.googleapis.com` / `fonts.gstatic.com` already had preconnect hints
in every page. Added the same for the other external origins actually
used:
- `https://cdn.jsdelivr.net` (Supabase client, KaTeX) — added to all 16 pages
- `https://checkout.razorpay.com` — added to `billing.html`
- `https://unpkg.com` (three.js) — added to `playground.html`

This lets the browser start the DNS/TLS handshake for these origins
immediately instead of waiting until the parser reaches the first
request that needs them.

## What was audited but intentionally left alone (and why)

- **Unused CSS/JS removal**: Cross-referenced every `.css`/`.js` file
  against every HTML `<link>`/`<script>` tag and every `@import`.
  `design-tokens.css` looked orphaned by this method but is actually
  pulled in via `@import` in six other stylesheets — it's live. A
  further ~8 CSS files (`agent-library.css`, `ai-reactor-core.css`,
  `styles/os-environment.css`, `styles/os-interface.css`,
  `styles/premium-os.css`, `styles/workspace-os.css`, `theme.css`,
  `workspace.css`) and ~9 JS files (`ai-reactor-core.js`, the eight
  files under `os/workspaces/`) show up as unreferenced by this static
  check. I did not delete them: static grep-based reference checking
  can't rule out dynamic `import()`/`fetch`-based loading, and the risk
  of silently breaking a feature outweighs the modest byte savings.
  Flagging these as the highest-confidence candidates for Part 2, where
  they can be verified against the runtime module loader before removal.
- **Images/video**: There are no `<img>` tags anywhere in the project.
  The only media element is the autoplay hero `<video>` in `index.html`,
  which is above-the-fold content the design intentionally shows
  immediately — lazy-loading or deferring it would change first-paint
  behavior, so it was left as-is.
- **DOM/reflow/event-listener consolidation**: Counted 459
  `addEventListener` calls and 21 `setInterval` calls across the
  codebase (7 `resize` listeners, 4 `scroll` listeners, spread across
  different files/components). None were exact duplicate registrations
  within a single file, so there's nothing safe to mechanically dedupe.
  Consolidating the `resize`/`scroll` listeners behind a single shared,
  debounced event bus is a real opportunity but requires per-component
  review to confirm no listener relies on independent throttling —
  scoped for Part 2.
- **CSS minification/pruning of unused selectors**: No automated
  purge was run. Doing this safely requires a real usage graph (class
  names generated dynamically in JS strings won't show up in a plain
  grep-based check), and an incorrect purge would directly violate the
  "no visual changes" requirement. Recommend a build-time tool (e.g.
  PurgeCSS with the JS files as its content source, then a manual visual
  diff) for Part 2 rather than a hand-rolled pass.

## Estimated improvement

`os-shell.html`, `playground.html`, and `billing.html` had the most
sequential blocking scripts (84, 49, and 43 respectively) and should see
the largest gains — meaningfully earlier first paint / Largest
Contentful Paint, since the browser no longer stalls parsing on ~40-90
sequential script executions before it can render. Pages with only a
handful of scripts (`index.html`, `login.html`, `register.html`) will
see a smaller but still measurable improvement. These are directional
estimates from the shape of the change (removing synchronous parser-
blocking work), not measured Lighthouse numbers — Part 2 should include
a before/after Lighthouse or WebPageTest run per page to quantify actual
deltas.

## Remaining work for Part 2

1. Verify the ~8 orphaned CSS files and ~9 orphaned JS files listed
   above against the runtime module loader, then delete confirmed-dead
   ones.
2. Consolidate duplicate/overlapping `resize` and `scroll` listeners
   behind a shared, debounced dispatcher.
3. Run a proper CSS-usage audit (PurgeCSS or similar) across all 36
   stylesheets with a manual visual regression pass.
4. Byte-size audit + minification pass on the largest JS bundles
   (`workspace-ultimate.js` 60K, `ai-workspace-ultimate.js` 52K,
   `memory-ultimate.js` / `analytics-automation-ultimate.js` 40K each).
5. Measure real before/after metrics (Lighthouse/WebPageTest) per page
   to replace the directional estimates above with numbers.

---

# AXIOM — Phase 5 · Part 2: AI Motion & Premium Polish

Continues from Phase 5 Part 1 (Motion System Standardization, below).
Scope for this pass: refine the AI Core, AI Avatar, Brain page, and
ambient/environment animations — glow transitions, particle timing,
breathing effects, thinking animations, and loading/streaming/AI
state transitions — plus complete `prefers-reduced-motion` coverage
and animation performance across the components those animations
live in. No markup, layout, features, or business logic changed.

## Files modified

- `ai-reactor-core.css`
- `os/core/ai-avatar.css`
- `os/core/ai-core.js`
- `os/core/memory-world.css`
- `styles/brain.css`
- `styles/ax-chat.css`
- `premium-polish.js`
- `styles/ax-premium-polish.css`

## What prompted this

Auditing the AI-presence surfaces (Core, Avatar, Brain, ambient
environment, chat streaming/typing cues) against the four stated
goals — glow/breathing/particle/thinking motion quality, natural
state transitions, complete reduced-motion coverage, and animation
performance — turned up a mix of genuine bugs and gaps, not just
things to retune:

1. **Dead state overrides in the AI Core.** `ai-reactor-core.css`
   set `filter: brightness(...)` directly on `.reactor-core[data-state="heavy"]`
   (and `error`/`idle`), but `filter` was *also* driven by the
   `axCoreBreathe` keyframes on the base `.reactor-core` rule. In
   CSS, once a property is animated, the animation's computed value
   wins over a plain declaration on that same property for the
   animation's whole duration — so those per-state brightness/
   saturation values were never actually painted. Only
   `animation-duration` was doing anything; every state bar
   `thinking` looked identical in brightness. The same bug existed
   on `.ax-energy-pulse`'s per-state `opacity:` overrides against
   the `axEnergyPulse` keyframes.
2. **A typo silently killed the reduced-motion change listener.**
   `premium-polish.js`'s `initReducedMotion()` set up the *initial*
   check correctly (`'(prefers-reduced-motion: reduce)'`) but the
   listener for *live changes* queried
   `'(precedes-reduced-motion: reduce)'` — an invalid media feature
   name. `matchMedia` on an invalid query just never matches, so the
   `change` listener never fired: a user who toggled their OS
   setting mid-session (rather than having it set before load) never
   saw the app respond, and neither did any of the JS-driven cursor/
   parallax/dock effects that read the same flag.
3. **JS-driven transform effects had no reduced-motion awareness at
   all.** The cursor-tilt/shimmer, parallax, and dock-magnification
   effects in `premium-polish.js` write `transform` directly from
   `mousemove` handlers. CSS media queries can't reach an inline
   style set from JS, so these kept running at full strength
   regardless of the setting — only the CSS `animation`/`transition`
   properties elsewhere in the app were actually covered.
4. **Several ambient/decorative loops had no reduced-motion rule at
   all.** `motion-tokens.css`'s global duration-zeroing only reaches
   animations that reference `var(--motion-duration-*)`; ambient
   loops were deliberately left on literal durations in Part 1 (see
   that section below) to keep their organic, non-uniform feel —
   but several of those literal-duration loops were never given
   their own explicit reduced-motion rule either, so they simply
   kept looping at full speed no matter the setting: the Brain
   page's live-badge pulse, graph edge-flow, and node-pulse
   (`styles/brain.css`); the memory crystal float
   (`os/core/memory-world.css`); and two chat composer cues, the
   active-mic pulse and voice waveform bars (`styles/ax-chat.css`).
5. **Abrupt, un-tellable-apart transitions.** The AI Core's particle
   field added new particles with a smooth fade-in (via the existing
   life-based alpha ramp) but *removed* excess particles on a state
   change by instantly `pop()`-ing them off the array — a hard cut
   in the opposite direction from how they arrived. The AI Avatar's
   "thinking" mood used `animation: none` (a static glow, like every
   other mood), so "the AI is thinking" and "the AI is in some other
   state" were only ever told apart by hue, never by any sense of
   active processing.
6. **Avoidable per-frame work.** The cursor-tilt and dock-
   magnification handlers ran a `getBoundingClientRect()` + style
   write per tracked element on *every* raw `mousemove` event with
   no frame budget, and the dock handler additionally rewrote an
   identical inline `transition` string onto every dock item on
   every one of those events.

## What changed

**AI Core (`ai-reactor-core.css`)**
- Rerouted the breathing loop's per-state brightness/saturation/
  scale-amplitude through CSS custom properties
  (`--core-breathe-base/-sat/-amp/-sat-amp/-scale-amp`) that the
  `axCoreBreathe` keyframes now read, instead of a `filter:`
  override that was silently discarded. `heavy`/`error`/`idle` now
  visibly differ in brightness and breathing depth, not just speed.
- Same fix for the energy pulse: added `--core-pulse-peak`, read by
  the `axEnergyPulse` keyframes, so `thinking`/`heavy`/`error` pulse
  at their intended peak opacity instead of all sharing whatever the
  keyframes' own literal values happened to be.
- Added `.ax-energy-pulse` to the `prefers-reduced-motion` block
  (previously absent — it kept pulsing at full speed regardless of
  the setting); it now shows its state-appropriate opacity at rest
  with the loop stopped, rather than snapping to invisible.
- Added `will-change: filter, transform` on `.reactor-core` (the
  properties its own breathing loop already animates) as a
  compositor hint.

**AI Core particle field (`os/core/ai-core.js`)**
- `drawParticles`: a state change that lowers the particle target no
  longer `pop()`s the excess off instantly. Excess particles are
  marked `dying`, age through the existing life/maxLife alpha curve
  at 3x speed, and are only removed once fully faded — mirroring how
  new particles already ease in, so the field thins out over roughly
  a second instead of visibly snapping to a smaller count.

**AI Avatar (`os/core/ai-avatar.css`)**
- `mood-thinking` now runs its own `axiomThinkPulse` (brightness
  only, 1.1s) instead of `animation: none`, so "thinking" reads as
  active processing rather than a static color swap — folded into
  the existing reduced-motion block, which already turns it off
  along with the ring/particle loops.
- Added `will-change: transform` to the continuously-spinning rings
  and orbiting particles.

**Brain page (`styles/brain.css`)**
- Added a `prefers-reduced-motion` block stopping the live-badge
  pulse, graph edge-flow dash animation, and node-pulse loop — none
  of which had any reduced-motion coverage before.

**Ambient / chat (`os/core/memory-world.css`, `styles/ax-chat.css`)**
- Added a `prefers-reduced-motion` rule for the memory-crystal float
  loop.
- Added the active-mic pulse (`.ax-prompt-btn.mic.active`) and voice
  waveform bars (`.ax-voice-wave span`) to the existing
  reduced-motion block in `ax-chat.css`, which already covered
  typing dots, the streaming cursor, and the thinking-avatar breathe
  but missed these two.

**Global JS motion (`premium-polish.js`, `styles/ax-premium-polish.css`)**
- Fixed the `'(precedes-reduced-motion: reduce)'` typo — the live
  change listener now actually fires.
- `initReducedMotion()` now runs first in the init sequence (it used
  to run fourth), and exposes its result as a shared
  `isReducedMotion()` read used by every other effect below it.
- Cursor-tilt/shimmer and mouse-parallax: the two now check
  `isReducedMotion()` and no-op when set; both are also coalesced
  from "do a full DOM read+write on every raw `mousemove`" into
  "record the latest event, apply once per animation frame" via
  `requestAnimationFrame`, cutting the forced-layout work to at most
  once per frame regardless of mouse polling rate.
- Dock magnification: same reduced-motion gate and rAF coalescing.
  Also stopped rewriting an identical inline `transition` string
  onto every dock item on every `mousemove` — that value never
  changed, so it's now a single CSS rule
  (`.ax-dock-magnify .ax-dock-item`) built from the standard motion
  tokens (`--motion-duration-instant` + `--motion-ease-spring`,
  the same 100ms/spring curve as the old literal
  `0.1s cubic-bezier(.34,1.56,.64,1)`) instead of a per-frame inline
  write.
- Mobile dock hide/show on scroll: now skips the tween under reduced
  motion (jumps straight to the shown/hidden state) while keeping
  the show/hide behavior itself, since that's a functional
  affordance, not decoration.
- Added a small reduced-motion CSS fallback in
  `ax-premium-polish.css` for the two purely decorative JS-driven
  layers (`[data-parallax]`, `.ax-cursor-track`) as defense in depth
  for the brief window before `initReducedMotion()` has run once —
  deliberately scoped to exclude `.ax-dock-item`, which also carries
  a normal `:hover` lift/scale that reduced-motion guidance doesn't
  ask to remove.

## Accessibility updates

- `prefers-reduced-motion: reduce` now has complete coverage across
  every animated component touched in this pass: AI Core (breathing,
  energy pulse, hologram rings — the pulse gap is newly closed),
  AI Avatar (rings, particles, new thinking pulse), Brain page
  (badge pulse, graph edges, node pulse — newly added), memory
  crystals (newly added), chat mic/voice-wave cues (newly added),
  and every JS-driven `transform` effect in `premium-polish.js`
  (cursor tilt, parallax, dock magnification, mobile dock tween —
  previously untouched by any reduced-motion check at all).
- The reduced-motion *live toggle* (OS setting changed mid-session,
  or the in-app settings toggle) now actually works end-to-end; it
  was silently broken by the media-query typo described above.

## Performance

- Mouse-tracked transform effects (cursor tilt/shimmer, parallax,
  dock magnification) went from "layout read + style write on every
  raw mousemove" to "at most once per animation frame," which
  matters most on high-polling-rate mice and trackpads where
  mousemove can fire well above 60Hz.
- Removed a per-mousemove, per-dock-item inline `transition` string
  write that recreated the same value on every event; it's now one
  static CSS rule.
- Added `will-change` hints on the handful of elements that animate
  continuously for the app's entire session (AI Core breathing loop,
  avatar rings/particles) so the compositor doesn't have to
  re-evaluate layer promotion every frame.

## Deliberately left untouched

- `os/core/living-environment.js` and its injected transition rules
  were reviewed and already had explicit, correct
  `prefers-reduced-motion` handling (including a live `matchMedia`
  listener) from an earlier pass — no gap found, no change made.
- `os/core/motion-system.js`'s spring-physics engine and
  `os/core/axiom-brain.js`'s state store are logic, not visuals —
  out of scope per the "no business logic" constraint, untouched.
- Ambient/decorative literal durations that Part 1 deliberately left
  un-tokenized (aurora drift, particle float, etc.) are still
  un-tokenized here for the same reason: collapsing them to shared
  tokens would make the ambient motion read as mechanical. This pass
  only added the reduced-motion coverage they were missing, not new
  token values.

## Phase 5 completion summary

Part 1 unified every duration/easing value in the app behind one
motion-token system and established the baseline
`prefers-reduced-motion` handling. Part 2 closes the remaining gaps
that only showed up once you looked specifically at the AI-presence
surfaces: two real bugs (dead per-state filter/opacity overrides on
the Core, and a typo that broke the reduced-motion live-toggle),
reduced-motion coverage extended to every remaining animated
component in scope (Core, Avatar, Brain, ambient crystal float, chat
mic/voice cues, and all JS-driven transform effects), a more natural
particle fade-out and a genuine thinking-state pulse for the Avatar,
and reduced per-frame DOM work on every mouse-tracked effect. Phase
5 is now complete: one consistent motion system, applied correctly,
respected everywhere the OS setting says it should be.

---

# AXIOM — Phase 5 · Part 1: Motion System Standardization

Continues from Phase 4 Part 3 (Product UX Polish). Scope for this
pass is CSS-level motion only: durations, easing curves, delays, and
hover/press scale values across every stylesheet in the project.
No markup, layout, component behavior, or application logic changed.
No features were added.

## What prompted this

An audit of the 32 CSS files that use `transition`/`animation` (206
`transition` and 127 `animation` declarations) turned up two separate
problems:

1. **Raw, uncoordinated values.** Durations were hand-written all
   over the place — `.12s`, `.15s`, `.2s`, `.22s`, `.24s`, `.25s`,
   `.26s`, `.28s`, `.3s`, `.35s`, and more, all doing the same job of
   "quick UI feedback" with no shared meaning. Easing was similarly
   scattered: 11 different `cubic-bezier(...)` curves plus bare
   `ease`/`ease-in`/`ease-out`/`linear` used interchangeably.

2. **Multiple, conflicting local token systems.** Five files had
   independently invented their own motion custom properties, with
   overlapping names that held *different values*:
   - `styles/design-tokens.css` defined `--ax-dur-fast: 180ms`,
     `--ax-dur-normal: 320ms`, `--ax-dur-slow: 520ms` — with a
     comment noting these were already known to be stale against a
     separate "V8" set (150/250/400ms) defined elsewhere.
   - `styles/ax-redesign.css` separately defined `--ax-duration-fast:
     150ms`, `--ax-duration-base: 250ms`, `--ax-duration-slow: 400ms`
     (that "V8" set, under different names).
   - `styles/ax-chat.css` defined a third, scoped set:
     `--ax-dur-fast: 120ms`, `--ax-dur-med: 220ms`, `--ax-dur-slow:
     360ms`.
   - `os-shell.css` redefined `--ax-ease-smooth` locally as
     `cubic-bezier(.4,0,.2,1)`, while `design-tokens.css` and
     `ax-chat.css` each defined the *same-named* variable as
     `cubic-bezier(.19,1,.22,1)` — three different curves behind one
     name, resolved only by whichever cascade happened to win.
   - `--ease` itself was defined twice with two different values
     (`styles.css`: `cubic-bezier(.22,1,.36,1)`; `design-tokens.css`:
     aliased to the conflicting `--ax-ease-smooth` above).
   - `styles/ax-playground-composer.css` *used* `--ax-dur-fast`,
     `--ax-dur-med`, and `--ax-ease-standard` without defining any of
     them, silently depending on cascade from files that may not
     always be loaded first.

## What changed

**New file: `styles/motion-tokens.css`** — the single source of
truth for every duration, easing curve, delay, and hover/press scale
value used anywhere in the app. Linked first, before any other
project stylesheet, in all 16 HTML entry points.

Tokens (durations match the existing spring-based JS motion system
in `os/core/motion-system.js` — `DURATIONS.fast/normal/slow/reveal`
— so CSS and JS transitions now agree on timing):

| Token | Value | Use |
|---|---|---|
| `--motion-duration-instant` | 100ms | active/press micro-feedback |
| `--motion-duration-fast` | 150ms | buttons, chips, tooltips |
| `--motion-duration-base` | 250ms | default — hover, color, opacity, border |
| `--motion-duration-slow` | 400ms | cards, dropdowns, panels, toasts |
| `--motion-duration-reveal` | 600ms | modals, page transitions |
| `--motion-ease-standard` | `cubic-bezier(.4,0,.2,1)` | default curve |
| `--motion-ease-decelerate` | `cubic-bezier(0,0,.2,1)` | entrances |
| `--motion-ease-accelerate` | `cubic-bezier(.4,0,1,1)` | exits |
| `--motion-ease-emphasized` | `cubic-bezier(.19,1,.22,1)` | premium expo-out reveals |
| `--motion-ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | overshoot — buttons, dock |
| `--motion-ease-linear` | `linear` | spinners, progress bars |
| `--motion-delay-stagger` | 40ms | per-item step for JS `staggerIn()` |
| `--motion-scale-press` / `-press-strong` | 0.97 / 0.95 | pressed state |
| `--motion-scale-hover` / `-hover-strong` | 1.02 / 1.05 | hover lift |

A `prefers-reduced-motion: reduce` block zeroes out all duration
tokens in one place, so every component that uses them respects the
user's OS setting automatically instead of needing its own media
query.

**Removed the five conflicting local definitions** listed above
(21 duplicate/conflicting declarations across `design-tokens.css`,
`os-shell.css`, `ax-redesign.css`, `ax-chat.css`, `styles.css`) and
repointed all 232 existing usages of the old names
(`--ax-dur-fast/med/normal/slow`, `--ax-duration-fast/base/slow/enter`,
`--ax-ease-smooth/spring/out/in/standard`, `--ax-snappy`, `--ax-ease`,
`--ease`) to the new canonical tokens.

**Tokenized remaining literal values.** Across all 32 CSS files: 342
raw duration values and 273 raw easing keywords/curves inside
`transition`/`animation` declarations were replaced with the nearest
matching token (nearest-neighbor bucketing against the table above).
24 hover/press `scale(...)` values inside `:hover`/`:active` rules
were replaced with the new scale tokens.

**Deliberately left untouched:** 104 duration values outside the
50–700ms range. These are ambient/decorative loop animations —
background aurora drift, particle float, breathing glows, spinner
sweeps — where the specific value (1.2s, 2.4s, 6s, 9s, etc.) is
part of the organic, non-uniform feel of the "living environment"
effects, not an interaction timing that needed standardizing.
Collapsing those to a shared handful of values would have made the
ambient motion look mechanical. `@keyframes` blocks were left in
place file-by-file rather than merged into one shared file — several
share the same name (`axRingSpin`, `axNotifPulse`) across files that
aren't guaranteed to load together, and merging them carried more
regression risk than the small amount of duplication was worth.

## Net effect

- One motion system instead of five, for both CSS and JS.
- ~11 easing curves and dozens of ad hoc durations reduced to 6
  duration tokens and 6 easing tokens, applied consistently to
  buttons, cards, dialogs, menus, sidebars, and panels.
- No visual behavior should change dramatically — most literal
  values snapped to their nearest token (typically within 30–50ms
  or an equivalent curve), and the three previously-conflicting
  `--ax-ease-smooth` definitions are now one value everywhere
  instead of whichever the cascade happened to pick.
- `prefers-reduced-motion` is now honored globally.
- No HTML structure, JS logic, or feature surface changed.

# AXIOM — Phase 4 · Part 3: Product UX Polish

Continues directly from Phase 4 Part 2 (Workspace and Studio
Refinement). Nothing from Part 1, Part 2, or any earlier phase was
redone or reverted. This pass is scoped to `browser.html`,
`memory.html`, `agent-library.html`, and the four scripts that were
the only remaining users of native `alert()`/`confirm()`/`prompt()`
dialogs anywhere in the project (`agent-library.js`, `workspace.js`,
`ax-chat-core.js`, `auth.js`) — no other page's markup, styles, or
behavior changed.

The brief was polish, not rebuilding: every change below is
markup/CSS/small-function-body only. No drag-and-drop, tab-switching,
Supabase queries, file upload/download logic, or agent CRUD logic was
rewritten — only *how* their existing success/error/confirmation
feedback is presented to the user.

## Key finding

Auditing `memory.html` turned up a real (pre-existing, not introduced
by this pass) functional bug worth fixing rather than polishing around:
`memory-ultimate.js`'s `buildMemoryUI()` runs ~100ms after page load
and replaces the *entire* `innerHTML` of `.app-content-inner` with a
JS-generated memory dashboard. The static `#addMemoryModal` markup was
a child of that same container, so it was being silently destroyed
before a user could ever open it — the "+ Add Memory" button
(`#memoryAddBtn`, rendered by that same JS) already had a working
click listener pointing at `#addMemoryModal` by id, but the element
was gone by the time anyone could click it. Fixed by moving the modal
to a top-level sibling of `.app-body` — the same placement
`agent-library.html` already uses for `#agentEditor` — so it survives
the rewrite. No JS logic changed; the existing open-listener in
`memory-ultimate.js` now simply finds its target.

## Files Modified

| File | Type of change |
|---|---|
| `components/ax-dialogs.js` | **New.** Shared `showToast` / `confirmDialog` / `promptDialog` helpers, built entirely on the `.toast-stack`/`.toast` and `.ax-modal-overlay`/`.ax-modal(-head/body/foot)` CSS already defined once in `styles/ax-redesign.css` — no new visual language, same markup shape as the existing `#agentEditor` modal. `showToast` only defines itself if a page hasn't already loaded one from `app.js`, so pages that use both never get two competing implementations. |
| `agent-library.js` | `deleteEditorAgent()`'s native `confirm()` replaced with `await confirmDialog(...)`. |
| `workspace.js` | 5 native `alert()` calls → `showToast(..., 'error')`; 2 native `prompt()` calls (new-workspace name, file rename) → `await promptDialog(...)`; 1 native `confirm()` (file delete) → `await confirmDialog(...)`. All 8 call sites were already inside `async` handlers, so no restructuring was needed beyond `await`ing a promise instead of reading a synchronous return value. |
| `ax-chat-core.js` | Conversation-delete's native `confirm()` replaced with `await confirmDialog(...)` (handler converted to `async`); falls back to native `confirm()` if `confirmDialog` isn't loaded on some future page, so this file stays safe to include anywhere. |
| `auth.js` | `authError()`'s `alert()` fallback (only reached when `#authError` is absent — currently unreachable in practice, see Remaining Items) now prefers `showToast(message, 'error')` when available, native `alert()` only as a last resort. |
| `browser.html`, `memory.html`, `agent-library.html`, `workspace.html`, `playground.html`, `login.html`, `register.html` | Added `<script src="components/ax-dialogs.js"></script>` immediately after `auth.js`. |
| `agent-library.html` | *(no markup change — see Key Finding for `agent-library.js`'s companion bug: its `showToast(...)` calls were previously dead code, since this page never loaded `app.js` — the only file that used to define `showToast`. Loading `ax-dialogs.js` here makes those existing calls fire for the first time.)* |
| `memory.html` | `#addMemoryModal` moved out of `.app-content-inner` (see Key Finding) and rebuilt on `.ax-modal-overlay`/`.ax-modal-head/body/foot` instead of one-off inline styles (hardcoded `#111` background, `z-index:9999`, manual blur/shadow) — now visually consistent with `agent-library.html`'s `#agentEditor`. Filter row (`All Memory`/`Recent`/`Saved`/`Pinned`) converted from `.btn.btn-outline`/`.btn-ghost` with an inline rgba "active" override to the `.filter-bar`/`.chip`/`.chip.active` pattern `agent-library.html` already established for the same kind of control. Added a small page-scoped `<style>` block for `.ax-chart-header-wrap`/`.ax-chart-header-actions` (same values as `automation.html`'s local copy from Phase 4 Part 2 — kept page-scoped rather than promoted into `ax-redesign.css`, to avoid a shared-file change touching every page that loads it in a UX-polish pass). |
| `browser.html` | 7 repeated inline `style="width:...px;height:...px;border-radius:...px;"` attributes on toolbar/URL-bar icon buttons replaced with two new page-scoped classes, `.ax-browser-icon-btn` (32px, toolbar) and `.ax-browser-icon-btn-sm` (26px, URL bar) — exact same pixel values as before, so no visual change, just one definition instead of seven. Separately (bigger fix): `.ax-browser-toolbar`, `.ax-browser-tabs`, `.ax-browser-url`, and `.ax-browser-viewport` had **no CSS anywhere in the project** — confirmed with a project-wide search across every `.css` file — so the toolbar's back/forward/refresh/tabs/new-tab buttons were rendering as plain stacked block elements instead of a row, and the URL bar had no pill styling. Added real layout CSS for all four, plus `.ax-loader-ring` (used for the page's loading spinner; its only existing rule lives in `os-shell.css`, which this page doesn't load, and that rule depends on `--ax-accent`/`--ax-ease-smooth`, which aren't defined here either — see the token-file finding below). New CSS uses literal `rgba(255,255,255,.xx)` values matching this file's own existing palette and the already-loaded `.ax-topbar` pill pattern, deliberately avoiding `var(--ax-*)` given the finding below. |
| `admin.html` | Added `<script src="admin.js"></script>` after `auth.js`. `admin.js` already existed, fully written and defensive (guards on missing elements, try/catch around its Supabase calls, waits for the `axiom:profile-ready` event `auth.js` already dispatches), with its `[data-admin-total-users]`/`[data-admin-generations-24h]`/`[data-admin-active-subs]`/`[data-admin-users-body]` target hooks already present in `admin.html`'s static markup — the only thing missing was the `<script>` tag including it. Every metric on the admin dashboard has been stuck on its static placeholder (`—`, "Loading…") since whenever this page was built. |
| `CHANGELOG.md` | This entry. |

## Objective-by-objective

- **Replace remaining native browser dialogs with the existing toast/modal system** — done for every `alert()`/`confirm()`/`prompt()` in the project except one file: `os/desktop/desktop-manager.js` (three `prompt()` calls, used only by `os-shell.html`). That file wasn't part of this brief's named scope (Browser/Memory/Agent Library) and implements a full desktop-style file/folder manager that this pass didn't otherwise touch — flagged below for its own pass rather than edited without full context on its file-creation flow.
- **Standardize spacing/typography/cards/buttons/dialogs/forms/navigation** — the two concrete gaps found (the ad-hoc `#addMemoryModal` and the un-classed filter-button "active" state on `memory.html`) are now built on the same components `agent-library.html` already uses. Cards, typography, and navigation on all three named pages were already using the shared `.ax-metric-card`/`.ax-chart-card`/`.ax-dock`/`.ax-topbar` components from earlier phases — no further changes needed there.
- **Improve Browser, Memory, Agent Library, and remaining pages** — Browser: de-duplicated icon-button sizing. Memory: fixed the broken Add-Memory modal and its filter row. Agent Library: fixed the dead `showToast` calls by finally giving the page a toast implementation to call. Admin: fixed a missing `<script>` tag that meant the entire admin dashboard (user count, 24h generations, active subscriptions, recent-users table) had never loaded real data. "Remaining pages": `workspace.html`, `playground.html`, `login.html`, and `register.html` picked up the shared dialog system as a byproduct of fixing the `alert()`/`confirm()`/`prompt()` calls that live in scripts those pages load. `analytics.html` was audited (metric cards, charts, trend badges) and found already consistent with the shared `.ax-metric-card`/`.ax-chart-card`/`.ax-metric-trend` components — no changes needed there.
- **Ensure all pages share one consistent interaction pattern** — every confirm/prompt/error-toast in the project (bar the one flagged file) now goes through the same three functions and the same two CSS components, instead of five different files each doing their own thing (three flavors of native dialog, one page with a dead toast call, one page with a hand-styled modal).
- **Preserve functionality and performance** — verified: every edited JS function keeps the exact same control flow (same early-returns, same success/error branches), just reading a resolved promise instead of a synchronous native-dialog return value. All `id`s, `data-*` attributes, and class hooks referenced by companion scripts (`browser-live.js`, `browser-studio-ultimate.js`, `memory-ultimate.js`, `agents-ultimate.js`, `workspace-ultimate.js`) are unchanged — confirmed by grep against each script after every edit. HTML tag balance (`<div>`/`</div>`, `<script>`/`</script>`, `<button>`/`</button>`) and JS syntax (`node --check`) were verified on every touched file.
- **No new features** — `confirmDialog`/`promptDialog`/`showToast` are drop-in replacements for the browser APIs they replace, with the same call-and-resolve contract (`promptDialog` returns `null` on cancel/empty input, exactly like `window.prompt`). The "Save Memory" button in the rebuilt modal still has no click handler, exactly as before this pass — flagged below rather than invented.

## What Was Preserved

- All layouts, grid structures, and responsive breakpoints not explicitly listed above — unchanged.
- All Supabase calls, file upload/download/rename/delete logic in `workspace.js`, agent CRUD logic in `agent-library.js` (via `AxiomAgents`), and conversation list rendering in `ax-chat-core.js` — untouched; only their dialog/toast calls changed.
- `memory-ultimate.js`, `agents-ultimate.js`, `browser-live.js`, `browser-studio-ultimate.js`, `workspace-ultimate.js` — none of these companion scripts were edited.
- No new features, no unrelated pages touched, no existing Phase 1–4·Part 2 work redone.

## Remaining Items for Phase 5

0. **Major finding, deliberately not fixed this pass — needs its own phase, not a footnote:** neither `styles/design-tokens.css` nor `styles/premium-os.css` is linked by *any* HTML page in the project (verified by grepping every `.html` file for both filenames — zero matches). Both files define `--ax-border`, `--ax-text`, `--ax-font`, `--ax-ease-smooth`, `--ax-text-secondary`, `--ax-text-tertiary`, and others. `styles/ax-redesign.css` — which every page in the project loads — references several of these same variable names (e.g. its shared `input[type="text"]`/`textarea`/`select` rule uses `border: 1px solid var(--ax-border)`, `color: var(--ax-text)`, `font-family: var(--ax-font)`) without ever defining them itself. Per the CSS spec an undefined `var()` falls back to the property's inherited or initial value rather than breaking the page outright, which is almost certainly why this has gone unnoticed — text remains visible (color is inherited), but border-radius and border-color on every plain text input/textarea/select in the entire app are not receiving their intended token values. This wasn't fixed here because: (a) it touches every page in the project, not the three named in this brief; (b) the safe fix (linking `design-tokens.css` first, before `ax-redesign.css`, on all ~14 pages) needs visual verification on a real browser to confirm no fallback value is being relied on elsewhere in a way that linking the token file would change for the worse; (c) it's a big enough blast radius to deserve its own reviewed pass rather than a line-item in a page-scoped polish sweep. Flagging prominently rather than either silently patching 14 files or silently ignoring it.
1. **`os/desktop/desktop-manager.js`** (used by `os-shell.html`) still has 3 native `prompt()` calls for file/folder creation and rename in its desktop-style file manager. Out of this brief's named scope and not otherwise touched this pass — worth its own dialog-replacement sweep once someone owns a full pass over `os-shell.html`.
2. **`memory.html`'s "Save Memory" button** has never had a click handler (checked both the original static-HTML script and `memory-ultimate.js` — neither wires it). Left as-is per "no new features"; flagged so whoever owns memory persistence next knows the button is currently inert, not just newly-relocated.
3. **`auth.js`'s `alert()` fallback path is still effectively unreachable** — `authError()` only fires inside `loginForm`/`registerForm` submit handlers, both of which only exist on `login.html`/`register.html`, both of which always render `#authError`. The `showToast` preference added this pass is harmless but won't currently be exercised; low priority to chase further.
4. **`memory.html`'s filter chips (`All Memory`/`Recent`/`Saved`/`Pinned`) have no click handler either**, same as before this pass — `memory-ultimate.js` renders its own `<select id="memFilter">` dropdown instead once it rewrites the page, so the static chips are a pre-JS-load visual only. Not a regression from this pass; flagged for whoever eventually reconciles the static markup with the runtime-generated UI on this page.
5. Consider promoting `.ax-chart-header-wrap`/`.ax-chart-header-actions` (now duplicated with identical values in `automation.html` and `memory.html`) into `ax-redesign.css` proper, now that a second page wants the exact same pattern — deferred this pass per the same reasoning Phase 4 Part 2 used for `.ax-node-*`/`.ax-calm`.
6. **`ai-reactor-core.js`/`ai-reactor-core.css`** (a "V8" particle-sphere renderer, per its own header comment) aren't referenced — statically or dynamically — by any HTML page or any other script in the project; confirmed via a project-wide reference sweep. Unlike `admin.js`, this looks like superseded code (the current `ai-avatar.js`/`ai-core.js` pair is what's actually loaded everywhere) rather than a missing wire-up, so it wasn't touched — flagged as a deletion candidate for whoever owns cleanup, rather than guessed at.

# AXIOM — Phase 4 · Part 2: Workspace and Studio Refinement

Continues directly from Phase 4 Part 1 (Playground UX Refinement).
Nothing from Part 1 or any earlier phase was redone or reverted. This
pass is scoped to `studios.html`, `automation.html`, and `workspace.html`
— no other page's markup, styles, or behavior changed, and none of the
three touched files' companion scripts (`browser-studio-ultimate.js`,
`automation-part9.js`, `workspace-ultimate.js`, `workspace-os.js`) were
edited; all changes are HTML/CSS only, made compatible with what those
scripts already expect from the DOM.

The brief was refinement, not rebuilding: every objective below was
addressed through layout/CSS changes and dormant (hidden-by-default)
markup for empty/loading states. No drag-and-drop, tab-switching,
integration-toggle, endpoint/webhook creation, or document-editing
logic was rewritten or removed.

## Key finding

Auditing `workspace.html` turned up a latent bug worth flagging rather
than quietly working around: `workspace-ultimate.js`'s `wireSidebarNav()`
and `loadMonacoEditor()` both look up the "Tools" section label via
`document.querySelector('.ax-workspace-nav-label:last-child')` to append
an Explorer / Code Editor nav item after it. `:last-child` requires the
label to be the *last child of its parent*, but the actual last child of
`.ax-workspace-sidebar` is the "Canvas" button — so this selector never
matched anything, even before this pass. It's pre-existing, harmless
(the `if (toolsLabel)` guard no-ops safely), and out of scope for a
refinement brief, so it wasn't touched — flagged below for Phase 5.
An early draft of this pass nearly made it worse by inserting a hidden
empty-state `<div>` after the Canvas button; caught in review and
reverted before it could compound the issue.

---

## Files Modified

| File | Type of change |
|---|---|
| `studios.html` | Reorganized the 2×2 studio-switcher card grid (`#studioNav` / `.studio-nav-card`) into a single-row, horizontally-scrollable toolbar. Cards now lay out via CSS grid-in-grid (icon spanning two rows, name/sub stacked, count trailing) instead of a tall vertical stack, so the same DOM child order (icon → name → sub → count) that both the static markup and `browser-studio-ultimate.js`'s dynamically-appended Document/Presentation cards use "just works" with no JS change. Wrapped `#studioNav` in a `.studio-toolbar-wrap` container (added, not restructured — `#studioNav` itself, its id, and every `data-studio` attribute are untouched). |
| `automation.html` | Replaced five repeated inline `style="flex-wrap:wrap; gap:12px;"` / `style="display:flex; gap:6px; margin-left:auto;"` pairs with two shared classes (`.ax-chart-header-wrap`, `.ax-chart-header-actions`) — same rendered result, one definition. Added skeleton-loading placeholder cards inside `#axIntegrationGrid` (uses the existing `.ax-skeleton` shimmer from `ax-redesign.css`) so the grid doesn't flash empty before `automation-part9.js` replaces its `innerHTML` on `DOMContentLoaded`. Added dormant (`hidden`) empty-state blocks for the integrations grid, API endpoint list, webhook list, and recent-runs table, all built on one new local `.ax-panel-empty` pattern. Added subtle dividers between palette sections (Triggers/Actions/Logic/Integrations) and restyled the canvas's "drag items here" hint as a dashed callout instead of plain text. |
| `workspace.html` | Added a page-scoped `<style>` block (new — this file previously had none) rather than editing `ax-workspace.css`/`ax-workspace-ultimate.css`, since both are shared with `playground.html` and any change there would be out of this brief's scope. Added item counts to the "Pages"/"Tools" sidebar section labels and a left accent bar on the active page item for clearer selection. Added a dormant loading-skeleton block for the document area, matching the shimmer treatment used elsewhere. Added a visual divider between the formatting toolbar groups and the utility group (split screen/comments/more) on the right. |
| `CHANGELOG.md` | This entry. |

---

## Objective-by-objective

- **Reorganize `studios.html` into a cleaner toolbar + overflow layout** — the four (later six, once `browser-studio-ultimate.js` runs) studio-switcher cards now sit in one scrollable row instead of a grid that had to be force-resized via an inline `gridTemplateColumns` write; overflow is handled by natural horizontal scroll (hidden scrollbar) rather than cramming more columns into the same width.
- **Improve `automation.html` workflow readability** — palette groups are visually separated, the canvas hint reads as an intentional callout, and header actions are consistent across all five tab panels instead of five separately-authored inline styles.
- **Improve `workspace.html` visual hierarchy and consistency** — section labels now carry counts, the active page is unambiguous at a glance (accent bar, not just a background tint), and toolbar groups are visually grouped by function.
- **Polished empty states where needed** — added for the four automation lists/grids that are either populated at runtime or editable down to zero items (integrations, API endpoints, webhooks, workflow runs). Left out of `studios.html` (every tool grid is static and always populated — nothing in this pass makes them emptiable) and out of `workspace.html`'s sidebar specifically (see Key Finding above for why an empty-state there was reverted).
- **Standardize loading states** — `automation.html`'s `#axIntegrationGrid` and `workspace.html`'s document area now both use the same shimmer pattern (`.ax-skeleton`, already defined once in `ax-redesign.css` and shared by all three pages) rather than each page inventing its own.
- **Preserve all functionality and responsiveness** — verified: `data-studio` attributes, `#studioNav`/`#axIntegrationGrid`/`#axAutomationTabs` ids, all `ax-tab`/`ax-tab-panel` pairs, and every button/input id referenced by `automation-part9.js`, `browser-studio-ultimate.js`, and `workspace-ultimate.js` are unchanged. Tag balance was checked programmatically across all three files after every edit.
- **No new features** — the empty-state blocks are markup + CSS only, `hidden` by default, and no new JS was written to toggle them; they simply give any future toggle (or a developer's own testing) a matching visual instead of an unstyled blank div.

---

## What Was Preserved

- All layouts, grid structures, and responsive breakpoints not explicitly listed above — unchanged.
- All drag-and-drop, tab-switching, palette, integration-toggle, endpoint/webhook creation, and copy-to-clipboard behavior in `automation-part9.js` — untouched, still keyed to the same ids/classes.
- All JS hooks, `data-*` attributes, ids, and event bindings in `browser-studio-ultimate.js` and `workspace-ultimate.js` — untouched.
- No new features, no unrelated pages touched, no existing Phase 1–4·Part 1 work redone.

---

## Remaining Items for Phase 5

1. **`.ax-workspace-nav-label:last-child` in `workspace-ultimate.js`** (see Key Finding) — the selector never matches, so the Explorer/Monaco-editor nav items it's meant to inject never appear via that path. Fixing it is a one-line JS change (`:last-of-type`, or simply targeting the second `.ax-workspace-nav-label` directly) but is out of scope for an HTML/CSS refinement pass — flagged for whoever owns `workspace-ultimate.js` next.
2. Consider promoting `automation.html`'s new local `.ax-panel-empty` and `workspace.html`'s local doc-skeleton pattern into a shared stylesheet if more pages end up needing the same dormant empty/loading treatment, rather than each page carrying its own copy.
3. `studios.html`'s new toolbar row hasn't been checked at very narrow (< 360px) widths with all six cards present (four static + two injected by `browser-studio-ultimate.js`) — the horizontal scroll should degrade gracefully, but wasn't visually verified in this pass.

---



Continues directly from Phase 3 Part 2 (AI Presence Polish). Nothing
from Phase 3, 2, or 1 was redone or reverted. This pass is scoped
entirely to `playground.html` and the stylesheets/scripts it alone
loads — no other page's markup, styles, or behavior changed.

The brief was refinement, not rebuilding: every objective below was
addressed by improving CSS (layout, spacing, typography, motion) and
one small, purely-presentational JS addition. No streaming logic,
model integration, credit handling, or existing feature was rewritten
or removed — `app.js`'s send/stream/regenerate/edit pipeline and
`ai-workspace-ultimate.js`'s composer/canvas/compare/fork engine are
untouched apart from the one line noted below.

## Key finding

Auditing the Playground surfaced that a large share of the composer
and message-tooling markup that `ai-workspace-ultimate.js` builds at
runtime — quick-tools row, attachment tray/chips, model switcher and
dropdown, compare-mode banner/grid, canvas panel, capture modal,
message action bar polish states, edit-in-place box, fork/branch tabs,
follow-up suggestion chips, and in-bubble code/diagram blocks — had
**no matching CSS anywhere in the project** and was rendering on
unstyled browser defaults. Closing that gap was the single biggest
lever for "premium AI chat experience," so it's the bulk of this pass.

---

## Files Modified

| File | Type of change |
|---|---|
| `styles/ax-chat.css` | Added shared motion tokens (`--ax-ease-out`, `--ax-ease-standard`, `--ax-dur-fast/med/slow`) and a `prefers-reduced-motion` gate used across the Playground; added themed scrollbars for the chat window/sidebar; widened chat-window padding and capped message width for readability on large screens; refined avatar sizing/gradient and added an `.is-thinking` breathing state; refined bubble padding/typography; gave the typing indicator a label slot and dot grouping; refined the composer's focus/transition timing and added an `.is-drag-over` affordance for file drops; added a pure-CSS "ready" state for the send button via `:has()` once the composer has text. |
| `styles/ax-playground-composer.css` | **New file.** Styles every previously-unstyled runtime-built element: quick-tools row, compare banner, attachment tray/chips, model switcher chip + dropdown, message action polish (model tag, edit box/actions, done-state), fork/branch tabs, suggestion chips, code blocks + run output + Mermaid diagram blocks, compare-mode grid/cards, canvas panel, and the camera/screen capture modal. All values are derived from the existing dark/glass token language already used by `ax-chat.css` and `ax-chat-sidebar.css` (same radii, border/blur treatment, and `cubic-bezier(.19,1,.22,1)` panel easing) so nothing reads as a bolt-on. |
| `app.js` | One function touched: `createTypingMessage()` now renders a "Thinking" label next to the existing dot animation and marks the assistant avatar `.is-thinking` for a subtle breathing glow. No other logic in the function, or anywhere else in the file, changed — the same `axiom:chat-state` events fire at the same points, and streaming/regenerate/edit/credits code is untouched. |
| `playground.html` | Added one `<link>` for `styles/ax-playground-composer.css`, ordered after `ax-workspace-ultimate.css` so it can finish what that file's runtime output needs. No markup, script tags, or IDs changed. |

---

## Objective-by-objective

- **Premium layout, spacing, typography** — wider chat-window padding, a max message width so long replies stay readable on ultrawide screens, tightened bubble line-height/letter-spacing, and a more considered avatar treatment.
- **Message presentation** — code blocks, Mermaid diagrams, code-run output, compare-mode cards, the model tag, and the inline edit box all now have real styling instead of default browser chrome.
- **Input area / composer / attachments** — quick-tools row, attachment tray + chips (image thumbnail, PDF/file icon, OCR sub-status), drag-and-drop highlight, and the model switcher chip + dropdown are now fully styled and match the composer's glass treatment.
- **Clear "AI is thinking" state** — the existing `.ax-typing` bubble now carries a "Thinking" label, the assistant avatar breathes gently while a reply is pending, and the whole composer gets a slow ambient scan-line glow (`.ax-prompt-wrap.is-answering`) driven by the existing `axiom:chat-state` events — no new events or state were introduced.
- **Standardized loading/streaming/response animations** — one shared set of easing/duration tokens now backs message-in, typing dots, streaming cursor, attachment/tab transitions, dropdown/canvas/capture-modal reveals, and the send-ready state; a single `prefers-reduced-motion` block calms all of them together.
- **No new features** — every class styled in this pass was already being created by `ai-workspace-ultimate.js`; this pass gave existing, already-wired functionality its intended look rather than adding new capability.
- **No unrelated pages touched** — `ax-chat.css`, `ax-playground-composer.css`, and the one `app.js` function are only ever loaded/exercised by `playground.html`; verified no other `.html` file in the project links `ax-chat.css` or `ai-workspace-ultimate.js`.

## Remaining Work / Notes for Part 2

- The camera/screen capture modal and canvas panel are now styled but weren't visually exercised end-to-end in this pass (no getUserMedia in this environment) — worth a manual pass with camera/screen permissions granted.
- `ax-workspace.css`'s standalone `.ax-code-block` rules (used elsewhere in the app, not loaded on this page) were left alone; if a future phase merges chat surfaces, reconcile the two code-block skins.
- Send-button "ready" state uses `:has()` (Chrome/Edge/Safari 15.4+/Firefox 121+); on unsupported browsers the button simply keeps its existing default styling — no functional loss.

---

# AXIOM — Phase 3 · Part 2: AI Presence Polish

Continues directly from Phase 3 Part 1 (AI Core & AI Avatar Visual
Unification). Nothing from Part 1, Phase 2, or Phase 1 was redone or
reverted. Part 1 established Purple Aurora as the one AI-identity
accent and flagged five specific gaps in its "Remaining Work for Part
2" section; this pass closes three of them (reduced motion on the
Core, contrast tuning on the living environment, and a documented
scope decision on the fourth) and applies a general glow/timing polish
pass on top.

---

## Files Modified

| File | Type of change |
|---|---|
| `os/core/ai-core.js` | Added a `prefers-reduced-motion` gate for the canvas rAF loop; added a state-reflecting `title`/`aria-label` on the Core element. |
| `os/core/ai-avatar.js` | Added the same reduced-motion gate; disables cursor-follow eye tracking and calms the talking-mouth flicker under it. |
| `os/core/ai-avatar.css` | Added an explicit component-owned reduced-motion block; added a second soft glow layer (bloom) to idle + all mood states; upgraded mood-transition easing. |
| `os/core/living-environment.js` | Per-time-of-day blend alpha and activity-brightness tuning for contrast; added an explicit (defense-in-depth) reduced-motion guard. |

No HTML, no `os-shell.css`, no `ai-identity.css`, no other page was
touched — everything needed for this pass lived in the four files
above.

---

## Motion improvements

**The real gap: JS-driven motion CSS can't reach.** Part 1 correctly
noted that the app already has app-wide `prefers-reduced-motion`
wildcard rules (`styles.css`, `styles/ax-redesign.css`,
`os-shell.css`) that zero out `animation`/`transition` durations —
but a wildcard CSS rule can only ever touch `animation` and
`transition` properties. It can't reach a hand-rolled
`requestAnimationFrame` loop or a `setInterval`, and this surface has
three of those:

- **`ai-core.js`**'s ~800-line canvas engine (ring rotation, breathing
  scale, particle drift/lifecycle) is entirely rAF-driven. Added a
  `matchMedia('(prefers-reduced-motion: reduce)')` check with a live
  `change` listener; under reduced motion, the three per-frame deltas
  (`ringAngle`, `breathPhase`, `time`) and the particle
  position/lifecycle updates are scaled to ~18% speed instead of full
  speed. **Deliberately not stopped outright** — this is the
  highest-traffic, most-recognizable state indicator in the app, and
  a fully frozen canvas plus a fully frozen `.ax-core-dot` pulse (the
  latter already stops under the existing CSS wildcard) would leave a
  first-time user with nothing to signal "the AI is doing something
  right now." Color, particle count, energy, lighting, and waveform
  per state are all untouched, so every state is exactly as
  identifiable as before — just calm instead of busy.
- **`ai-avatar.js`**'s cursor-follow eye parallax (a `mousemove`
  listener moving the eyes toward the pointer) is now **skipped
  entirely** under reduced motion, not damped. This one specific
  effect — content that continuously moves in response to pointer
  position across the whole page — is close to the textbook
  vestibular-trigger pattern reduced-motion exists to opt out of, so
  it gets an off switch rather than a smaller number.
- **`ai-avatar.js`**'s talking-mouth flicker (a `setInterval`
  randomizing mouth size while `mood-speaking` is active) is calmed
  rather than removed — removing it would make the "speaking" state
  silently unreadable. Interval slowed from 110ms to 320ms, and the
  random size range narrowed, so it reads as a gentle pulse instead
  of a rapid flicker.

**Defense-in-depth, not new gaps.** `living-environment.js`'s motion
(palette-transition CSS, activity-driven animation-duration) was
already fully covered by the existing wildcards — verified by
confirming every page that loads this script also loads
`ax-redesign.css`, which carries the wildcard rule. It still got an
explicit local `matchMedia` guard so the per-activity speed-up class
is never even computed under reduced motion, rather than relying
entirely on another file's rule to suppress it after the fact.

**Timing/easing polish.** `ai-avatar.css`'s mood-state transitions
(box-shadow/background on a state change) were using a flat `ease`
curve at 0.6s/0.8s. Swapped for `cubic-bezier(.16, 1, .3, 1)` at
0.7s/0.8s — the same decelerate-style curve family used for
enter/exit choreography in `motion-system.js` — so a mood change
settles into place instead of linearly fading in and out.

---

## Accessibility improvements

- **Reduced motion, per component, not just inherited.** In addition
  to the JS gates above, `ai-avatar.css` now carries its own explicit
  `@media (prefers-reduced-motion: reduce)` block that turns the ring
  spin, particle orbit, and idle-breathing animations fully off. This
  is intentionally redundant with the app-wide wildcard — it means
  this component's reduced-motion behavior doesn't depend on load
  order or on `ax-redesign.css` being the file that happens to be
  present on whatever page mounts the avatar next.
- **First-time-user recognizability via text, not just color.** The
  Core's visual state label (`.ax-core-state-label`) is deliberately
  small/low-opacity ambient chrome, not a headline — so a first-time
  user relying on color alone has no fallback. `ai-core.js` now sets
  a `title` and `aria-label` on `#axiomCore` on every state change
  (`"AXIOM AI — Thinking"`, etc.), giving a plain-text, zero-visual-
  risk way to confirm what a glow/color means on hover, independent
  of having learned the Purple Aurora palette yet.
- Every color/contrast/motion change above was additive or
  scale-only — no `aria-*`, role, or DOM structure that existed
  before this pass was removed or renamed.

---

## AI presence refinements

- **Ambient background contrast, tuned per time-of-day.** Part 1's
  living-environment aurora used one flat blend alpha (`55`, ~33%)
  for every palette. The four palettes are not equally bright —
  `morning` (`#FFD9A0` / `#FFB37A` / `#FF8FA3`) and `evening`
  (`#FF8FA3` / `#A78BFA` / `#FBBF24`) are light, warm pastels;
  `night` (`#3B82F6` / `#6366F1` / `#1E1B4B`) is mostly dark indigo —
  so the same flat alpha meant morning/evening contributed
  noticeably more effective luminance behind foreground text than
  night did, and could locally reduce contrast wherever a blurred
  blob happened to sit under a heading or unbacked label. Replaced
  with a per-palette alpha (`morning`/`evening`: `40` ≈25%; `day`:
  `52` ≈32%, close to the original; `night`: `66` ≈40%, bumped up
  since dark hues otherwise barely register) so the environment's
  contribution stays closer to even across all four themes instead
  of tracking raw palette brightness.
- **Activity brightness boost, same tuning.** The `state-thinking` /
  `state-listening` / `state-speaking` classes apply a
  `saturate()/brightness()` boost via CSS `filter` while the AI is
  active. That boost was a flat value regardless of time of day —
  barely noticeable layered on the dark `night` palette, but a
  bigger relative contrast hit layered on the already-light
  `morning`/`evening` ones. The filter values now read a
  `--axiom-env-boost` custom property (via `calc()`) that
  `applyPalette()` sets per time-of-day: `0.55` for morning/evening,
  `1` (unchanged) for day/night.
- **Glow, layered instead of flattened.** Added a second, wide,
  low-alpha glow layer behind the existing tight glow on the
  avatar's idle face and all four mood states — a standard two-layer
  bloom (one sharp near-light, one soft far-light) that reads as more
  dimensional/premium than a single flat `box-shadow`. The original
  tight glow's own radius and alpha — the thing each state is
  actually told apart by — is unchanged, so distinguishability is
  identical to Part 1; only the depth around it changed.

## Reviewed, deliberately left unchanged

- **`os/core/theme-engine.js`** — re-checked against this pass's
  "readability across themes" objective in case its `aurora`
  color-theme preset was relevant. It isn't: as Part 1 already
  documented, this is a user-selectable accent theme happening to
  share a word with "Purple Aurora," not part of AI identity or the
  time-of-day ambient system this pass targets. Left untouched, same
  conclusion as Part 1.
- **`os/core/motion-system.js`** — the app's general-purpose
  interactive-motion engine (drag inertia, magnetic cursor, dock
  elasticity, panel enter/exit). Confirmed it has no
  `prefers-reduced-motion` handling of its own either, but it isn't
  one of the three named surfaces for this pass (AI Avatar / AI Core
  / Ambient background) — it's shared by dock, panels, and other UI
  well outside AI presence. Touching its spring physics to add a
  motion gate is real behavior-shaping work on code used everywhere
  in the Shell, not a re-skin, so it's flagged below for its own pass
  rather than folded in here.
- **`ai-reactor-core.js` / `.css`** — Part 1 confirmed these are
  orphaned (not linked from any page). Still orphaned; still not
  worth reskinning or deleting inside an AI-*presence* pass. Decision
  (delete vs. revive) remains open, as Part 1 flagged.
- **`os/core/ai-core.js`'s draw functions** (`drawAmbientGlow`,
  `drawBloom`, etc.) — the actual glow *rendering* is inside the
  ~800-line canvas engine Part 1 deliberately didn't touch. This pass
  continues that boundary: the reduced-motion gate scales existing
  per-frame deltas from outside those functions, but no glow radius,
  gradient stop, or blend mode inside them was touched. "Improve glow
  intensity" for the Core specifically would mean editing that
  engine's internals, which is a bigger, separate piece of work.

---

## What Was Preserved

- All layouts, grid structures, and responsive breakpoints —
  unchanged.
- Every state's particle count, ring speed, energy value, `lighting`
  label, `pulse` flag, and `waveform` type in `ai-core.js` — untouched.
- All mood/state color values from Part 1 — untouched; this pass only
  added a second glow layer alongside them.
- The full Part 1 AI-identity token system (`styles/ai-identity.css`)
  — not modified, only consumed via the new `--axiom-env-boost`
  calc() and the existing `--ax-ai-accent*` variables.
- No new features, no new AI states, no new components, no unrelated
  pages touched.

---

## Phase 3 completion summary

Phase 3 set out to unify and polish the AI's visual presence across
AXIOM without touching business logic. Part 1 gave every AI-identity
surface (Avatar, Core, Brain page, Shell dock point) one consistent
Purple Aurora accent and fixed the dead-token bug that was silently
breaking Phase 2's earlier work. Part 2 closes the loop on the two
things a pure re-skin can't fix by itself: motion that a CSS-only
reduced-motion rule can't reach (both AI surfaces' JS-driven effects,
handled with scale-not-stop gates so states stay readable), and
ambient-background contrast that a flat per-palette value couldn't
account for (tuned per time-of-day instead). Combined with the
glow-layering and easing polish, every AI presence surface named in
the Phase 3 brief — AI Avatar, AI Core, ambient background — now has
explicit, own-component reduced-motion support and a calmer, more
consistent read across all four times of day, without any change to
`ai-core.js`'s render engine, any AI state's meaning, or any
business logic anywhere in the app.

**Open items carried forward** (none blocking, all previously flagged
or newly identified as separate-scope during this pass):
1. `os/core/motion-system.js` has no `prefers-reduced-motion` handling
   — real gap, but shared far beyond AI presence; needs its own pass.
2. `ai-reactor-core.js` / `.css` — still orphaned; delete-vs-revive
   decision still open from Part 1.
3. Glow *intensity* inside `ai-core.js`'s canvas engine itself
   (`drawAmbientGlow`, `drawBloom`) was not tuned this pass — doing so
   safely means editing the ~800-line render engine Phase 3 has twice
   now deliberately left alone.
4. The remaining `VISUAL-AUDIT-PROGRESS.md` items
   (`memory-ultimate.js`, `analytics-automation-ultimate.js`) are
   still open and still out of scope for an AI-visuals/AI-presence
   pass.
5. `styles/design-tokens.css`'s V8/V11 conflicts remain undecided,
   as flagged at the end of Part 1.

# AXIOM — Phase 3 · Part 1: AI Core & AI Avatar Visual Unification

Continues directly from Phase 1 (Design Token Consolidation) and Phase 2
(AI Identity & Inline Style Migration / Visual Consistency & CSS
Cleanup). Nothing from those parts was redone or reverted. This pass
unifies the AI Avatar, the AI Core, the Brain page, and the Shell's
ambient environment under one AI identity — Purple Aurora — without
changing any application logic or adding new features.

---

## The bug this pass found and fixed first

Before touching any color, I checked whether the Purple Aurora AI
identity established in Phase 2 was actually reaching the screen. It
wasn't: `styles/design-tokens.css` — the only place `--ax-ai-accent`
and its variants (`--ax-ai-accent-soft`, `-glow`, `-bg`, `-border`,
`-gradient`) were defined — is explicitly documented in its own header
as "the AUDIT OUTPUT, not yet a live dependency of any page," and
indeed no HTML file links it. So every `var(--ax-ai-accent...)`
reference already written into `styles/brain.css` and `automation.html`
during Phase 2 has been silently resolving to nothing since it landed —
borders, glows, and accent text on the Brain page and elsewhere have
been running on an undefined custom property this whole time.

**Fix:** added `styles/ai-identity.css`, a small, live stylesheet that
defines just the AI-identity token family (same values as
`design-tokens.css` §12 — nothing new invented) plus a per-state accent
vocabulary (see below), and linked it on every page that mounts the AI
Avatar or AI Core, immediately before those components' own
stylesheets. This is deliberately scoped to only the AI-identity slice
of tokens, not a full `design-tokens.css` migration — that file's
header itself flags several genuine, still-unresolved conflicts
between the app's two token systems (V8/V11) that are out of scope for
an AI-visuals pass and would risk regressing unrelated pages.

---

## Files Modified

| File | Type of change |
|---|---|
| `styles/ai-identity.css` | **New.** Live Purple Aurora tokens + per-state accent vocabulary shared by the Avatar and the Core. |
| `os/core/ai-avatar.css` | Recolored from ad hoc teal (`#6EE7B7`) to Purple Aurora; calm/low-glow idle state; distinct purple-family moods; panel now uses shared glass tokens. |
| `os/core/ai-core.js` | Data-only edit: the 14 `STATES` entries' `ringColor` / `plasmaColor` / `glowColor` values recolored to the shared palette. No rendering logic, particle counts, speeds, energy values, or labels touched. |
| `os-shell.css` | `.ax-core-dot` and `.ax-topbar-model .dot` (the "Axiom AI" chip) recolored from off-token green to Purple Aurora; added a subtle ambient identity halo behind `.ax-core`. |
| `os-shell.html` | Added `<link>` for `styles/ai-identity.css`, before `os-shell.css`. |
| `styles/brain.css` | Card surfaces (`brain-nav-card`, `brain-metric-card`, `brain-feed`, `viz-stage` border) switched from duplicated literal glass values to the shared `--ax-glass-*` tokens already live via `styles/ax-redesign.css`, so Brain's glass material is provably the same material as the rest of the app, not a lookalike. |
| `memory.html`, `admin.html`, `workspace.html`, `browser.html`, `agent-library.html`, `studios.html`, `playground.html`, `analytics.html`, `billing.html`, `settings.html`, `automation.html`, `brain.html` | Added `<link>` for `styles/ai-identity.css` immediately before the existing `os/core/ai-avatar.css` link (the fix described above). No other changes on these pages. |

---

## AI Avatar improvements

- **Calm resting/idle state:** the avatar's default face is now a soft,
  slow-breathing low-opacity purple glow (`axiomIdleBreathe`, 6s cycle)
  instead of a constant bright teal glow. This is what's visible the
  large majority of the time — whenever the AI isn't actively doing
  something — so it's tuned to sit quietly in the corner rather than
  compete for attention while someone works.
- **Distinct, identity-consistent states:** `mood-thinking` (deep
  violet), `mood-listening` (cool indigo), `mood-speaking` (warm
  fuchsia), and the previously-unstyled `mood-learning` (warm violet)
  each get their own hue within the same purple/violet/indigo family,
  so the avatar reads as one entity with different moods rather than
  unrelated colors bolted on state-by-state. (`mood-idle` needs no
  override — it's the calm base rule. `mood-happy`'s eye-shape rule was
  left as-is; it's pre-existing and not driven by any current state
  input, so this pass didn't touch its reachability.)
- Panel background/border/blur/shadow now reference the same
  `--ax-glass-bg` / `--ax-glass-border` / `--ax-glass-blur` /
  `--ax-glass-shadow` tokens used elsewhere in the app (via
  `styles/ax-redesign.css`, already live on all 12 pages), plus the new
  AI-identity border/glow, instead of a one-off dark panel color.
- No markup, class names, or `os/core/ai-avatar.js` behavior changed —
  every fix above is CSS-only, layered on top of the exact same DOM the
  script already builds and the exact same `mood-` classes it already
  toggles.

## Brain page improvements

- Confirmed and fixed the root cause (missing live tokens, above) that
  was silently breaking Phase 2's existing purple migration — `brain.css`
  itself needed no color-meaning changes, its Purple Aurora accent
  usage was already correct on paper.
- Card chrome (`brain-nav-card`, `brain-metric-card`, `brain-feed`,
  `viz-stage`) now pulls its glass background/border/blur/shadow from
  the same shared tokens the rest of the app's glass surfaces use,
  rather than independently-maintained literal values that happened to
  currently match.
- Audited `brain-ultimate.js` against the older `VISUAL-AUDIT-PROGRESS.md`
  note flagging `#A855F7` / `#EC4899` purple/pink drift in this file:
  that drift is no longer present — the file's per-step feed colors
  (`#60A5FA` blue, `#6EE7B7` teal, `#FBBF24` amber) are a confidence/
  step-type legend for the reasoning trace, not AI-identity chrome, and
  were left untouched. The stale note can be considered resolved.

## AI Core visual updates

- All 14 states in `os/core/ai-core.js` (`idle`, `thinking`, `speaking`,
  `listening`, `researching`, `coding`, `generating`, `automation`,
  `memory`, `warning`, `error`, `offline`, `sleep`, `learning`) now use
  a single, deliberately distinct palette drawn from the purple/violet/
  indigo family:

  | State | Color | Why |
  |---|---|---|
  | idle | `#A855F7` @ low alpha | calm, base identity |
  | thinking | `#9333EA` | deep violet, focused |
  | speaking | `#D946EF` | warm fuchsia, expressive |
  | listening | `#818CF8` | cool indigo, receptive |
  | researching | `#6366F1` | deep indigo, searching |
  | coding | `#7C3AED` | electric violet, technical |
  | generating | `#E9D5FF` | brightest/lightest, creating |
  | automation | `#A855F7` @ low energy | base identity, steady |
  | memory | `#C4B5FD` | soft violet (paired with the existing gold "memory crystal" sparkle, unchanged) |
  | learning | `#C084FC` | warm violet, growth |
  | sleep | `#A855F7` @ near-zero alpha | dormant but still "alive" |
  | **warning** | `#FBBF24` (unchanged) | semantic status color, not identity |
  | **error** | `#EF4444` (unchanged) | semantic status color, not identity |
  | **offline** | `#9CA3AF` (unchanged) | means "unavailable," deliberately *not* the identity color, unlike `sleep` |

  `warning`/`error`/`offline` were intentionally left as they were —
  they already carry specific, established meaning everywhere else in
  AXIOM (amber = warning, red = error), and repainting them purple would
  make the Core lie about its own status.
- Only the three color fields per state were touched. Particle counts,
  ring speeds, energy values, `lighting` labels, `pulse` flags, and
  `waveform` types are byte-for-byte unchanged, and so is every line of
  the ~800-line canvas rendering engine that reads them.
- Shell's `.ax-core-dot` and the topbar's "Axiom AI" model chip dot
  (`.ax-topbar-model .dot`) were both hardcoded teal/green — recolored
  to the same Purple Aurora accent so the Core's own chrome doesn't
  contradict the identity it now renders.
- Added a subtle ambient halo (`.ax-core::before`, a low-opacity radial
  Purple Aurora gradient, no independent animation) behind the Core's
  fixed dock point, so the Shell's ambient environment reads as the
  same light source as the Avatar/Brain rather than a separate glow.

## Reviewed, deliberately left unchanged

- **`ai-reactor-core.js` / `ai-reactor-core.css`** — confirmed via
  project-wide search to be orphaned: not linked from any `.html` file
  (only referenced from `theme.css`, which is itself already documented
  as orphaned). Left untouched rather than redesigned, per "don't touch
  unrelated/unused code" — flagged below for cleanup rather than reskin.
- **`os/core/living-environment.js`** (the time-of-day aurora palette
  used across pages) — this is the closest thing to a second "ambient
  environment" candidate, but its palettes are tied to time-of-day
  (morning/day/evening/night), not AI identity, and already contain
  complementary violet/indigo entries (`#A78BFA`, `#6366F1`). Reworking
  its activity-linked color blending would mean changing render logic,
  not just re-skinning data, so it was left alone this pass — see
  "Remaining work" below.
- **`os/core/theme-engine.js`**'s `aurora` theme preset (`--ax-accent:
  '#6EE7B7'`) — this is a *user-selectable color theme* named "Aurora,"
  unrelated to the "Purple Aurora" AI-identity name beyond the
  coincidental word. It's a feature (pick-your-own-accent theming), not
  part of the AI's own identity, so it was left as the designer's
  original teal, not converted.
- **`.ax-status-dot.online`, `.ax-metric-trend` (up), `.ax-topbar-status
  .dot.online`, `.ax-acc-status .dot.active`** in `os-shell.css` — all
  genuine green "success/online" status indicators (per the existing
  app-wide rule: green = success), not AI-identity markers by
  coincidence of also being a similar teal. Left untouched.

---

## What Was Preserved

- All layouts, grid structures, and responsive breakpoints — unchanged.
- All JS behavior: `ai-avatar.js`'s state machine, blinking/eye-tracking/
  talking-mouth logic, and `ai-core.js`'s entire rendering engine
  (particles, ribbons, halos, reflections, bloom) are untouched — only
  the color *data* they read changed.
- No new features, no new states, no new components.
- No unrelated pages redesigned. No Phase 1/Phase 2 work redone.

---

## Remaining Work for Part 2

1. **`os/core/living-environment.js`** — if the brief wants the Shell's
   time-of-day ambient palette itself (not just the Core's halo) to
   lean further into Purple Aurora during active AI states, that needs
   an actual blend-logic change in `applyActivity()`, not just a data
   edit — worth scoping as its own small piece of work.
2. **`ai-reactor-core.js` / `.css`** — confirmed orphaned/dead code this
   pass. Worth a decision in Part 2: delete, or revive as an alternate
   Core visualization — either way it shouldn't keep sitting in the
   tree unlinked and undocumented.
3. **`VISUAL-AUDIT-PROGRESS.md`**'s remaining Phase A/B items
   (`memory-ultimate.js`, `analytics-automation-ultimate.js`) are still
   open — neither file is an AI-identity surface (they're regular pages
   that should go *blue*, per the existing rule), so they're still out
   of scope for an AI-visuals pass and remain queued for their own
   sweep.
4. Canvas-driven animation in `ai-core.js` has no
   `prefers-reduced-motion` guard (unlike the CSS animations elsewhere,
   which are already covered by the wildcard reduced-motion rule in
   `styles/ax-redesign.css` / `os-shell.css`). Flagged rather than
   fixed this pass, since pausing a live `requestAnimationFrame` loop
   safely is a logic change, not a re-skin, and this file's ~800 lines
   of render logic weren't otherwise touched here.
5. Consider formally deprecating `styles/design-tokens.css`'s
   still-open V8/V11 conflicts (radius, surface, accent) now that the
   AI-identity slice has a live home — that file's original scope was
   always broader than this AI-visuals brief.
# AXIOM — Phase 2 · Part 2: Visual Consistency & CSS Cleanup

Continues directly from Phase 1 (Design Token Consolidation) and Phase 2
Part 1 (AI Identity & Inline Style Migration). Nothing from those parts
was redone or reverted — this pass only touches the files below.

---

## Files Modified

| File | Type of change |
|---|---|
| `automation.html` | Token-backed accent classes, `!important` removed, mismatched colors fixed, purple applied to genuine AI steps |
| `studios.html` | Hardcoded hex/rgba → design-token references (values unchanged) |
| `billing.html` | Added `.ax-calm` scope for a quieter background |
| `settings.html` | Added `.ax-calm` scope for a quieter background |
| `styles/ax-premium-polish.css` | New `.ax-calm` rules (additive only, no existing rules touched) |
| `styles/ax-workspace-ultimate.css` | One stray off-token purple fixed on a workspace flow node |

`workspace.html` itself needed no changes — its only inline styles are
layout-related (`display:none`, `margin-left:auto`, etc.), not color.

---

## Color Rule Applied

Purple Aurora = AI identity · Blue = analytics/selection · Green = success
· Amber = warnings · Red = errors.

**automation.html**
- The workflow canvas's `AI Analyze Content` step and the `Inbox Triage
  Agent` icon were recolored from green to the `--ax-ai-accent` purple
  token — these are the two elements that are actually an AI acting,
  as opposed to a status or a third-party integration.
- The active-tab indicator and the `.selected` workflow-node border were
  both using `var(--ax-accent, #6EE7B7))` — a neutral token name with a
  *green* fallback that doesn't match `--ax-accent`'s real value
  (`#E8E8E8`). Both are now blue (`--ax-info`), consistent with how
  "currently selected" is already indicated elsewhere in the app (e.g.
  `studios.html`'s `.studio-nav-card.active`).
- `File Organizer Agent`'s icon used an off-token reddish hex
  (`#F2657A`) while its own badge said "Active" (success/green) — icon
  and status disagreed. Fixed to the success token so they match.
- The node-remove (delete) button used the same off-token `#F2657A`;
  standardized to `--ax-error` (`#EF4444`).
- Schedule / Condition / Save-to-Workspace canvas nodes now use new
  `.ax-node-success` / `.ax-node-warning` / `.ax-node-info` /
  `.ax-node-error` / `.ax-node-ai` classes instead of repeated inline
  `style="border-color:…"` + `style="background:…;color:…"` pairs.

**studios.html**
- No color *meaning* changes — the four studio categories (Image/blue,
  Video/red, Audio/green, 3D/blue) are a categorical palette, not a
  status/AI signal, so they were left as-is. All matching hex/rgba
  literals were swapped for the equivalent `var(--ax-token, …)` so the
  page is reading from the token system rather than hardcoding values
  that happen to match it.

**styles/ax-workspace-ultimate.css**
- `.ax-flow-input` used `rgba(167, 139, 250, .12)` — a leftover violet
  from the pre-Phase-1 palette (the same shade flagged in
  `VISUAL-AUDIT-PROGRESS.md` for `memory-ultimate.js` and others). This
  node type isn't an AI element, so it now uses
  `var(--ax-accent-blue-glow)` to match the rest of the flow-diagram
  palette.

---

## `!important` Rules Removed

| File | Before | After | How |
|---|---|---|---|
| `automation.html` | 1 (`.ax-workflow-node.selected`) | 0 | The rule only needed `!important` to beat inline `style="border-color:…"` on individual nodes. Moving those colors into the new `.ax-node-*` classes means `.ax-workflow-node.selected` (two classes) now naturally outranks a single-class rule — no override needed. |

`billing.html`, `settings.html`, `studios.html`, `workspace.html` had no
`!important` rules to begin with.

**Not touched:** `styles/ax-premium-polish.css` still carries ~136
`!important` declarations, all inside responsive (`@media`) breakpoints
that reset desktop styles for tablet/mobile. In this specific file the
cascade order alone (it loads after `ax-pages.css` / `ax-redesign.css`
on every page) would very likely make most of these safe to drop — but
that file is shared by all ~12 app pages, not just the five in this
brief, and I have no way to visually verify 12 pages × several
breakpoints in this pass. Flagged below for Phase 3 rather than risking
a global regression.

---

## Components Standardized

- New reusable accent classes in `automation.html`:
  `.ax-node-success`, `.ax-node-warning`, `.ax-node-info`,
  `.ax-node-error`, `.ax-node-ai` — token-backed, replace one-off inline
  color pairs.
- `body.ax-calm` scope (in `ax-premium-polish.css`) softens
  `.grain`, `.aurora span`, `.particle` opacity and `.ax-chart-card` /
  `.ax-metric-card` shadow depth. Applied only to `billing.html` and
  `settings.html` via a body class — animations, timings, and every
  other page are untouched.

---

## What Was Preserved

- All layouts, grid structures, and responsive breakpoints — unchanged.
- All animations (aurora drift, card entrance, hover transforms) —
  unchanged, only their amplitude is reduced under `.ax-calm`.
- All JS hooks, `data-*` attributes, IDs, and event bindings — untouched.
- No new features, no unrelated pages touched, no existing Phase 1 /
  Phase 2 Part 1 work redone.

---

## Remaining Items for Phase 3

1. **`styles/ax-premium-polish.css` `!important` cleanup** — ~136
   declarations, all in `@media` breakpoints, likely mostly redundant
   given load order, but needs a real cross-page visual regression pass
   (12+ pages) before removing at scale.
2. **`automation-part9.js`** populates the Integrations tab's grid at
   runtime — its icon colors weren't audited in this pass since it's a
   script, not one of the five named files; worth a follow-up sweep for
   the same success/warning/error/info consistency applied here.
3. **`VISUAL-AUDIT-PROGRESS.md`**'s Phase A/B/C items (purple remnants
   in `memory-ultimate.js`, `analytics-automation-ultimate.js`,
   `brain-ultimate.js`, `conversation-bridge.css`, `os-environment.css`,
   `dashboard-os.css`, `workspace-os.css`) are still open — none of
   those files are on the memory/brain/dashboard pages this brief
   covered, so they were left for their own pass.
4. Consider extracting the new `.ax-node-*` / `body.ax-calm` patterns
   into `design-tokens.css` proper if similar per-page accent classes
   keep recurring, rather than living in each page's inline `<style>`.

---

# AXIOM — Block 2 · Step 6 · Part 5 Stabilization Pass: Runtime Context Architecture Debt Resolution

Follows the Senior Architecture Review of Block 2 / Step 6 / Part 5
(Runtime Context Engine). Fixes five confirmed architectural debt items
ahead of Part 6 (Production Validation & Architecture Freeze). No new
features, no UI changes, no changes to Browser, Brain, Memory,
Automation, Analytics, or OpenRouter.

## Files Modified

- `os/core/runtime-context.js` — FIX 1, FIX 2, FIX 5
- `os/core/workflow-planner.js` — FIX 3, FIX 4
- `RUNTIME_CONTEXT.md` — documented the new payload restriction and the
  automatic cleanup scheduler
- `test-evidence/block2-step6-part5-runtime-context-regression-suite.js` — expanded
- `test-evidence/block2-step6-part4-workflow-planner-regression-suite.js` — expanded,
  now also loads `runtime-context.js` (new load-order dependency)

## FIX 1 — Child Context Cleanup

`destroyContext()` deleted a context from `activeById`/`archivedById`
but never touched `childIndex`, so:

- the destroyed id stayed listed in its parent's `childIndex[parentId]`
  array forever, and
- the destroyed context's own `childIndex[contextId]` (its list of
  children) stayed allocated as an orphaned key even though the context
  itself was gone.

Added `pruneChildIndex(contextId, parentContextId)`, called from
`destroyContext()`, which removes both. Verified with a 500-cycle
create/destroy loop showing zero residual entries.

## FIX 2 — Automatic Cleanup

`cleanupExpiredContexts()` existed but `startAutoCleanup()` was never
called anywhere, so archived contexts only left storage if something
remembered to sweep manually. The engine now starts its own scheduler
as soon as it loads (interval configurable via
`window.AXIOM_RUNTIME_CONTEXT_CLEANUP_INTERVAL_MS`, default 30s, and
reconfigurable at runtime via `startAutoCleanup(ms)`), added
`isAutoCleanupRunning()`, and `startAutoCleanup()` always stops any
existing timer first so repeated calls can never produce duplicates.
Cleanup only ever reads `archivedById`, never `activeById`, so it can
never affect a live context.

## FIX 3 — Workflow Planner Integration

Workflow Planner kept a private `wf.context` object per workflow run —
a second, parallel implementation of exactly what Runtime Context
already does. `executeWorkflow()` now creates a real Runtime Context
for every run, syncs it after each stage, and finalizes + destroys it
on every exit path (completed, failed, cancelled-mid-run,
cancelled-while-paused). `workflow-planner.js` now throws at load time
if `runtime-context.js` hasn't been loaded first — the same hard
dependency posture it already has on `orchestrator.js`.

## FIX 4 — Naming Collision

Workflow Planner's private `createContext(wf, trigger)` helper is
renamed to `createWorkflowContext()`. There is exactly one
`createContext` in the codebase now: `AxiomRuntimeContext.createContext()`.

## FIX 5 — Clone Strategy

`safeClone()` used to fall back to a **shallow copy** whenever
`JSON.parse(JSON.stringify(...))` failed — but `JSON.stringify()`
doesn't actually throw for most unsupported values (functions,
`undefined` inside arrays); it silently drops or nulls them, so data
could already be corrupted before the `catch` block ever ran. Replaced
with `assertJsonSafe()`, a recursive validator that fails loudly with a
descriptive error (functions, symbols, bigints, undefined, and circular
references are all rejected) rather than ever returning a corrupted or
partially-shared clone. Documented as an official "JSON-safe payloads
only" restriction in `RUNTIME_CONTEXT.md`.

## Regression Coverage Added

- create/destroy loops (500 cycles, no childIndex growth)
- parent-child cleanup (parent list pruned, own orphaned entry pruned,
  sibling isolation preserved)
- auto cleanup timer (starts on load, configurable interval, never
  touches active contexts)
- duplicate timer prevention (repeated `startAutoCleanup()` calls never
  produce more than one live timer)
- workflow context integration (Runtime Context created per run, synced
  per stage, destroyed on completed/failed/cancelled paths, exactly one
  Runtime Context per in-flight workflow, no orphaned context for a
  workflow cancelled before it ever started)
- illegal clone payloads (`createContext`, `updateContext`,
  `createChildContext` all fail safely instead of corrupting state)
- recovery after cleanup (`recoverContext()` still works normally once
  an automatic sweep has run)

`test-evidence/block2-step6-part5-runtime-context-regression-suite.js`:
42/42 passing. `test-evidence/block2-step6-part4-workflow-planner-regression-suite.js`:
29/29 passing. `test-evidence/phase9-part1-static-audit-suite.js`:
1370/1370 passing (whole-project syntax/lint audit, unaffected files
confirmed unchanged).

## What Was Preserved

- Snapshot immutability (`deepFreeze` on every read path) — unchanged.
- Parent/child isolation semantics — unchanged, now leak-free.
- Lifecycle transition validation — unchanged.
- Browser, Brain, Memory, Automation, Analytics, OpenRouter, and every
  `.html`/UI file — untouched.
- All existing Part 4 and Part 5 regression tests — still passing
  unmodified (only new tests were appended; no existing assertions were
  weakened or removed).

---

# AXIOM — Block 2 / Step 9 / Part 2A: OpenRouter Core Foundation

**Date:** 2026-08-06
**Scope:** Additive only — four new files under `os/api/openrouter/`,
one new regression suite, and this changelog entry. No existing file
was modified. Does not touch Browser (`os/core/browser-*.js`),
Automation (`os/core/automation-*.js`), Memory
(`os/core/memory-engine.js`, `os/core/memory-manager.js`), Goal
Manager (`os/core/goal-manager*.js`), Voice (`js/core/voice*.js`), or
Supabase (`js/core/supabase/*.js`, `js/core/supabase-config.js`) — all
verified unchanged by static regression checks (see
`OPENROUTER_PART2A_VALIDATION.md`).

## What this Part is

A new, opt-in "bring your own key" (BYOK) OpenRouter foundation for
the OS/agent runtime layer — separate from the existing
`js/core/openrouter-client.js` chat-UI integration, which proxies
every request through Supabase Edge Functions and never exposes a
real OpenRouter key to the browser. This Part lets a user supply
their own OpenRouter key and talk to OpenRouter directly, with its
own storage keys, its own endpoints, and its own global namespace, so
it cannot collide with or change the existing pipeline. Full
rationale in `OPENROUTER_PART2A_VALIDATION.md`.

### New files

- **`os/api/openrouter/error-handler.js`** — `window.AxiomOpenRouter.errors`.
  Pure classification of HTTP 401/403/404/408/429/500/502/503/504,
  `AbortError` timeouts, network failures, and invalid-key/model-
  unavailable response bodies into `{code, status, message, retryable}`.
  No network calls, no dependency on load order.
- **`os/api/openrouter/api-manager.js`** — `window.AxiomOpenRouter`
  (core). Connection state machine
  (`uninitialized -> no_key -> connecting -> connected | invalid_key | error | disconnected`),
  `setApiKey()` / `removeApiKey()` / `hasApiKey()` / `validateApiKey()`
  against OpenRouter's `GET /api/v1/key`, a 60s health monitor, and the
  shared `on/once/off/emit` bus (mirrors
  `js/core/supabase/connection-manager.js`'s documented pub/sub
  contract: DOM `CustomEvent` + `AxiomOrchestrator.emit()` forwarding
  + optional analytics, all feature-detected).
- **`os/api/openrouter/model-manager.js`** — `window.AxiomOpenRouter.models`.
  `fetchModels()`/`refreshModels()` against OpenRouter's public
  `GET /api/v1/models`, 10-minute TTL cache with in-flight de-duping,
  `getDefaultModel()`/`setDefaultModel()` (own storage key,
  `axiom_os_openrouter_default_model` — never
  `axiom_openrouter_selected_model`, which
  `js/core/model-selector.js` already owns), and
  `getModelMetadata()`/`getContextSize()`/`getPricing()`/`getCapabilities()`.
- **`os/api/openrouter/token-manager.js`** — `window.AxiomOpenRouter.tokens`.
  `countPromptTokens()` (documented chars/4 approximation —
  OpenRouter's own `usage.prompt_tokens`/`usage.completion_tokens` are
  the authoritative source `recordUsage()` is meant to be fed),
  `recordUsage()` (global + per-model running totals), `getUsageStats()`,
  `estimateCost()` (reads live pricing from model-manager.js, returns
  `null` — never a silent `0` — when pricing is unknown), `resetStats()`.

### Events

`openrouter_initialized`, `openrouter_connected`, `openrouter_disconnected`,
`openrouter_error`, `openrouter_models_loaded` — fired on
`window.AxiomOpenRouter`'s own bus and forwarded verbatim to
`AxiomOrchestrator.emit()` (when loaded) and as `axiom:<event>` DOM
`CustomEvent`s.

### Reuse (no duplication)

- **Event Bus** — forwards onto `AxiomOrchestrator.emit()` rather than
  building a second orchestration bus.
- **Runtime Context** — wraps `validateApiKey()`/`checkHealth()`/
  `fetchModels()` in `AxiomRuntimeContext.createContext()` for
  observability, when the engine is loaded; falls straight through
  otherwise.
- **Logger** — every log line goes through `AxLogger`, console fallback.
- **Analytics** — forwards to `AxiomAnalyticsAutomation.addLog()` and
  `window.va()` when present, same pattern as
  `connection-manager.js`.
- **Supabase** — reads (never modifies) `AxiomSupabaseConnection`'s
  current session to scope the locally-stored API key per signed-in
  user; falls back to an anonymous namespace with no Supabase present.

### Verification

- New suite `test-evidence/block2-step9-part2a-openrouter-core-regression-suite.js`:
  **72/72 passing.**
- All 36 existing regression/audit suites re-run: **30 pass cleanly**;
  6 fail on pre-existing environment gaps unrelated to this change
  (missing `jsdom` devDependency, missing `js/core/env.config.js`
  secrets file) — see `OPENROUTER_PART2A_VALIDATION.md` for the full
  per-suite table. No existing file was modified, so this Part could
  not have caused those 6 failures.
- One defect found and fixed, scoped entirely to this Part's own new
  test file: an over-broad static string check flagged a documentation
  *comment* in `model-manager.js` that mentions the legacy storage key
  by name (to explain why it isn't used) as if it were real usage.
  Fixed to scan code lines only. No source file under `os/api/openrouter/`
  required any change.
