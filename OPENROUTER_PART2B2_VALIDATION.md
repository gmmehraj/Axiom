# AXIOM — Block 2 / Step 9 / Part 2B-2: OpenRouter Stream Manager + Response Parser
## Validation Report

**Date:** 2026-08-06
**Deliverable:** `os/api/openrouter/stream-manager.js`,
`os/api/openrouter/response-parser.js`, new sub-namespaces
`window.AxiomOpenRouter.stream` / `window.AxiomOpenRouter.parser`,
regression suite, `CHANGELOG.md` entry, this report.

---

## 1. Pre-implementation architecture audit

### 1.1 What already exists, and what this Part reuses

| Concern | Existing module | Reused how |
|---|---|---|
| BYOK key, HTTP timeout/abort, error classification, base URL | `api-manager.js` (Part 2A) | `window.AxiomOpenRouter._internal.{getStoredKey, classifyError, BASE_URL}` — same surface chat-manager.js already uses. Streaming's own cancellation uses its own `AbortController` (a stream's lifetime is caller-controlled, not a fixed timeout), but every failure still runs through the same `classifyError()`. |
| Conversation state, request/param shaping | `chat-manager.js` (Part 2B-1) | See §1.2 — this is the direct dependency this Part builds on. |
| Token accounting | `token-manager.js` (Part 2A) | `AxiomOpenRouter.tokens.recordUsage()`, feature-detected, same as chat-manager.js. |
| Shared id generator | `AxiomMakeSeqId` (`os/shared/id-factory.js`) | Used for `streamId`/`requestId`, same convention as chat-manager.js's `chatId`/`requestId`; inline fallback of the same shape when absent. |
| Event bus | `AxiomOpenRouter.emit()` | Not called directly for Orchestrator/Analytics forwarding — reused transitively, exactly as chat-manager.js does. |
| Existing chat-UI OpenRouter client | `js/core/openrouter-client.js` + siblings | **Confirmed still present, still untouched.** Nothing in this Part imports, calls, or duplicates it. |

### 1.2 What Part 2B-1 already built, in detail

Re-read in full before writing anything:

- `chat-manager.js` owns per-`chatId` conversation state (`chats`
  map), and its `sendMessage()` builds a `POST /chat/completions`
  payload from that state via an internal `buildPayload(chat,
  overrides)` helper, then appends the user turn before sending and
  the assistant turn after a successful reply.
- Its public contract (`createChat`, `getChat`, `listChats`,
  `getHistory`, `setSystemPrompt`, `configureChat`, `sendMessage`,
  `resetChat`, `deleteChat`, `configure`) has **no way for a sibling
  file to append to or read the same mutable conversation state** —
  only sanitized snapshots (`getChat()`/`getHistory()`) were public.
  A streaming module needs to (a) build the exact same kind of
  request payload chat-manager.js already knows how to build, and (b)
  land a streamed reply in the SAME shared history `sendMessage()`
  writes to, so `getHistory()` doesn't silently omit or duplicate
  turns depending on which path produced them.

### 1.3 Decision: a small, additive `_internal` extension to chat-manager.js

Two ways to satisfy §1.2's requirement were considered:

1. **Duplicate.** Give stream-manager.js its own conversation-state
   store and its own message-array/param-shaping logic. Rejected —
   this is exactly the "duplicated infrastructure" both this task's
   brief and Part 2B-1's own report explicitly avoid, and it would
   split one conversation's history across two disconnected stores
   (`chat.getHistory()` would never see a streamed turn).
2. **Extend chat-manager.js additively**, the same way api-manager.js
   already exposes an `_internal` object specifically so
   model-manager.js/token-manager.js/chat-manager.js itself don't
   reimplement key storage or HTTP helpers (see
   `OPENROUTER_PART2A_VALIDATION.md` §1.2). Chosen.

Concretely, `chat-manager.js` gained:

- `buildPayload(chat, overrides, streamFlag)` — an **optional third
  parameter** on the function that already existed. Every existing
  call site (`sendMessage()`) still calls it with two arguments, so
  `streamFlag` is `undefined` there and `!!undefined === false` —
  `payload.stream` is still exactly `false` everywhere it already
  was. Confirmed by a fresh, unmodified re-run of Part 2B-1's own
  suite (§5.2).
- A new `ChatManager._internal` object — `getRawChat`, `buildPayload`,
  `appendUserTurn`, `appendAssistantTurn` — mirroring api-manager.js's
  own `_internal` convention. Not part of the documented public
  contract; every function already in `ChatManager`'s public object
  is byte-identical to Part 2B-1's delivered version.

This satisfies the same two standards Part 2B-1 held itself to:
"extend the existing foundation" (stream-manager.js reuses
chat-manager.js's real request-shaping logic and real conversation
store through this surface, not a reimplementation) and "do not
duplicate infrastructure" (stream-manager.js contains no
conversation-state storage, no message-array-building logic, and no
key/timeout/error-classification code of its own).

---

## 2. What was built

### 2.1 `os/api/openrouter/response-parser.js` — `window.AxiomOpenRouter.parser`

Pure, stateless, no network calls, no dependency on any other
`os/api/openrouter/*` file (same standalone convention as
`error-handler.js`):

- `normalizeChatResponse(json)` — full, non-streaming
  `/chat/completions` body → `{id, model, choices, usage, raw}`.
- `normalizeStreamChunk(json)` — one already-JSON-parsed SSE `data:`
  payload → `{id, model, index, delta, finishReason, usage, raw}`.
- `parseSSELine(line)` — one raw SSE line → `null` (blank/comment/
  non-`data:` field), `{done: true}` (the `[DONE]` sentinel), or
  `{json, raw}` / `{json: null, raw, parseError}` for a `data:` line
  (a malformed line never throws — it's reported, not fatal).
- `normalizeUsage(usage)`, `normalizeFinishReason(reason)`,
  `normalizeToolCalls(toolCalls)`, `normalizeMessage(message)`,
  `normalizeErrorResponse(body, status)`.
- Explicitly distinct from `error-handler.js`'s `classify()`/
  `handle()`: that classifies a *transport* failure (Error/Response/
  thrown value) into a retryable verdict; this only reshapes the JSON
  *body* OpenRouter returns. stream-manager.js and chat-manager.js
  still run the resulting `Error` through `error-handler.js` for the
  retryable verdict — this file doesn't replace or duplicate that.

### 2.2 `os/api/openrouter/stream-manager.js` — `window.AxiomOpenRouter.stream`

- **`streamMessage(chatId, content, callbacks?, overrides?)`** →
  `{streamId, promise}`. Appends the user turn (same "append before
  building the payload" ordering chat-manager.js's own §5.3 fix
  established), builds a `stream: true` payload via
  `chat._internal.buildPayload()`, opens the SSE connection, and
  incrementally applies each parsed chunk.
- **Real-time streaming**: every parsed delta is applied as soon as
  its SSE line is complete — including a delta that arrives split
  across two raw `read()`s (buffered and reassembled before parsing;
  verified directly, §5.1).
- **Partial token updates**: `onChunk(deltaText, accumulatedText,
  meta)` and the `openrouter_stream_chunk` bus event fire per chunk.
- **Progress callbacks**: `onProgress({streamId, chatId, chunkCount,
  charsReceived, elapsedMs})` fires alongside every chunk.
- **Cancel stream**: `cancelStream(streamId, reason?)` aborts the
  connection (`AbortController` + `reader.cancel()`), preserves
  `accumulatedContent`, fires `openrouter_stream_cancelled` +
  `onCancel`, and rejects the pending promise with a
  `stream_cancelled` usage error.
- **Resume stream**: `resumeStream(streamId, callbacks?)` re-opens a
  fresh HTTP leg (new `requestId`, same `streamId`) for a
  `cancelled`/`error` stream and continues appending onto the SAME
  `accumulatedContent` — see the file's own header comment ("A note
  on resume") for why this is the correct design given OpenRouter's
  API has no resumable-stream token, verified directly (§5.1: final
  content is the concatenation of both legs, and the shared history
  ends up with exactly one assistant turn, not one per leg).
- **Stream completion**: `onComplete(result)` / the resolved
  `streamMessage()`/`resumeStream()` promise / `openrouter_stream_finished`
  all carry `{chatId, streamId, requestId, model, message, usage,
  finishReason}`; the finished reply is written into chat-manager.js's
  own shared history via `chat._internal.appendAssistantTurn()`.
- **Tool-call streaming**: argument fragments across chunks are
  merged (by `index`) into one final `toolCalls` array on the
  finished message.
- **Graceful degradation**: `core_not_loaded` rejection (never a
  synchronous throw) if `api-manager.js` or chat-manager.js's
  `_internal` surface is missing; a synthesized single chunk if the
  runtime's `fetch()` Response has no readable-stream body; an
  idle-timeout abort (`configure({idleTimeoutMs})`) if a connection
  goes silent.

---

## 3. Requirements coverage

| Spec item | Delivered as |
|---|---|
| Real-time streaming | `stream.streamMessage()` opens the SSE connection and applies each chunk as it arrives |
| Partial token updates | `onChunk()` callback + `openrouter_stream_chunk` event, per chunk |
| Cancel stream | `stream.cancelStream(streamId, reason?)` |
| Resume stream | `stream.resumeStream(streamId, callbacks?)` |
| Stream completion | `onComplete()` / resolved promise / `openrouter_stream_finished` |
| Progress callbacks | `onProgress()` callback, per chunk |
| Normalize chat responses | `parser.normalizeChatResponse()` |
| Normalize streaming chunks | `parser.normalizeStreamChunk()` / `parser.parseSSELine()` |
| Normalize usage metadata | `parser.normalizeUsage()` |
| Normalize finish reasons | `parser.normalizeFinishReason()` |
| Normalize tool-call metadata | `parser.normalizeToolCalls()` (per-chunk) + stream-manager.js's `mergeToolCalls()` (cross-chunk accumulation) |
| Normalize error responses | `parser.normalizeErrorResponse()` |
| `openrouter_stream_started` | Fired before every HTTP leg (initial and each resume, the latter with `resumed: true`) |
| `openrouter_stream_chunk` | Fired per applied delta |
| `openrouter_stream_finished` | Fired once, on completion |
| `openrouter_stream_cancelled` | Fired by `cancelStream()` |

---

## 4. Non-duplication / non-modification checklist

- `js/core/openrouter-client.js`, `openrouter-config.js`,
  `model-selector.js` — **not modified**, not imported, not called.
- `os/api/openrouter/{api-manager,model-manager,token-manager,
  error-handler}.js` — **not modified.**
- `os/api/openrouter/chat-manager.js` — **its public contract is
  unmodified**; the one additive change (§1.3) is a new optional
  third parameter on an already-internal function plus a new
  `_internal` export object, both verified not to alter any existing
  call site's behavior (fresh 56/56 re-run of Part 2B-1's own suite).
- Browser, Automation, Memory, Goal Manager, Voice, Supabase files —
  **not touched.**
- No new global except `.stream` and `.parser` on the existing
  `window.AxiomOpenRouter`.
- No new `localStorage` key — verified statically (no
  `axiom_os_openrouter_api_key`, `axiom_os_openrouter_default_model`,
  or `axiom_openrouter_selected_model` literal appears in
  `stream-manager.js`'s code; `response-parser.js` touches
  `localStorage` and `fetch()` nowhere at all).
- No HTML file edited.

---

## 5. Verification

### 5.1 New regression suite

`test-evidence/block2-step9-part2b2-stream-manager-regression-suite.js`
— real files loaded in a `vm` sandbox (same convention as Part
2A's/2B-1's own suites), every network call (including the streamed
response body, via a fake `ReadableStream`-shaped `getReader()`
yielding real `TextEncoder`-encoded bytes) mocked; no real network
access used.

```
87 passed, 0 failed.
```

Coverage: standalone install with no load-order dependency;
`core_not_loaded` when chat-manager.js is absent, and separately when
api-manager.js is absent; `chat_not_found`/`invalid_message`/
`invalid_api_key` usage errors; 12 pure response-parser unit tests
(SSE line variants including malformed JSON, chunk/response/usage/
finish-reason/tool-call/error-body normalization, including
degrade-on-malformed-input cases); the full happy path
(`started`→`chunk`(s)→`finished` events, resolved promise shape,
`onChunk`/`onProgress`/`onComplete` callback shapes, a chunk whose SSE
line is split across two raw `read()`s reassembling correctly); the
streamed reply landing in chat-manager.js's own shared history
alongside the user turn; usage rolling into token-manager.js's
existing accounting; per-call overrides applying to the streamed
request only; a non-streaming-capable response body still resolving
via the single-chunk fallback; mid-stream cancellation (event +
callback + promise rejection + queryable partial content, and that
cancelling twice is a safe no-op the second time); resume continuing
the same `streamId`'s accumulated content under a new `requestId`
(and that resuming a still-active stream returns `null`); an HTTP 500
and a network failure both classified via the reused
`error-handler.js` and leaving the user's turn for retry without a
partial assistant turn; an idle (silent) connection being aborted by
the idle timeout; tool-call argument fragments merging correctly
across three chunks; the non-duplication/non-modification statics
from §4; and — as its own final test — a fresh subprocess run of Part
2B-1's own suite confirming **56/56**, unmodified in behavior.

No defect was found in the delivered source's final form. Two
authoring bugs were caught and fixed during development, before this
was considered a finished deliverable — see §5.3.

### 5.2 Full existing suite run

All regression/audit files in `test-evidence/` (including Part 2A's
own suite, Part 2B-1's own suite, and this Part's new one) were
re-run after `stream-manager.js`/`response-parser.js` were added:

| Result | Notes |
|---|---|
| ✅ Pass | Every suite Part 2B-1's own report listed as passing, still passes: `block2-step2-part2-brain-integration` through `milestone14-part1`, `supabase-part1` (51/51) — plus Part 2A's own suite (**72/72**, re-run after the two static-check updates), Part 2B-1's own suite (**56/56**, re-run after chat-manager.js's additive change), and this Part's new suite (**87/87**). |
| ❌ Fail (pre-existing, unrelated) | Identical failure set to Part 2A's and Part 2B-1's own reports: `block2-step1-coding-agent`, `block2-step1-part2-pipeline`, `milestone5`, `milestone6`, `milestone10` — `Error: Cannot find module 'jsdom'` (devDependency never installed in this sandbox). `phase9-part1-static-audit` — pre-existing failures against `env.config.js`, a secrets file intentionally absent from disk. This Part introduced no new failures and fixed none of these pre-existing ones (out of scope). |

### 5.3 Fixes applied

**To delivered source, during development (not post-hoc against a
finished deliverable):**

1. **Idle-timer gap on the first chunk.** `runStream()` initially
   armed the idle timer only up through the response headers arriving
   (`clearIdleTimer()` right after `fetch()` resolved), then only
   re-armed it *inside* `pump()`'s success branch — meaning a
   connection that opened fine but then produced zero bytes would
   never trip the idle timeout, since the very first `reader.read()`
   had no timer covering it. Caught by writing the idle-timeout test
   itself (§5.1) before the fix landed. Fixed by re-arming the timer
   immediately after obtaining the reader, before the first `pump()`
   call.
2. **Usage double-normalization.** `finishStream()`'s
   `normalizeUsageFallback()` expects a *raw* OpenAI-shaped
   `{prompt_tokens, completion_tokens, total_tokens}` block (it calls
   `parser.normalizeUsage()` on whatever it's given, exactly once —
   the same convention chat-manager.js's `sendMessage()` already
   uses on a raw response's `json.usage`). The initial implementation
   passed it an *already-normalized* `{promptTokens, ...}` block in
   two places — the streaming pump's `pendingUsage` (sourced from
   `parser.normalizeStreamChunk()`'s output instead of the raw SSE
   JSON) and the non-streaming-body fallback (sourced from
   `parser.normalizeChatResponse()`'s output instead of the raw JSON
   body) — silently zeroing every usage total. Caught immediately by
   the happy-path, token-accounting, and non-streaming-fallback tests
   (all initially failed with `expected N, got 0`). Fixed by keeping
   the raw `usage` block on the record in both places and only
   normalizing it once, at the point `finishStream()` consumes it;
   confirmed by a clean 87/87 re-run.

**To pre-existing test files:** one static assertion each in Part
2A's own suite and Part 2B-1's own suite ("`os/api/openrouter/`
contains exactly N expected files") — hardcoded counts that this
Part's two approved, in-scope new files would otherwise fail forever,
for no reason connected to an actual regression. Updated to the new
expected 7-file list; same precedent Part 2B-1 itself set for Part
2A's suite (see Part 2B-1's own validation report §5.3). No other
line in either suite was touched; both re-runs confirmed clean
(72/72, 56/56).

---

## 6. Known limitations / follow-ups for a future Part

- **"Resume" is reconnect-and-continue, not a true SSE resume.**
  OpenRouter's public `/chat/completions` API has no resumable-stream
  token, so `resumeStream()` re-issues the same logical request and
  keeps appending to whatever content the interrupted attempt had
  already gathered. This is the documented, tested behavior (§2.2,
  §5.1) — not a limitation to fix so much as a design constraint of
  the underlying API worth a future Part being aware of if OpenRouter
  ever adds a real resume primitive.
- **Tool-call name accumulation is `+=`-based.** `mergeToolCalls()`
  appends every chunk's `function.name` fragment, which matches
  observed provider behavior (name arrives whole in one chunk,
  arguments arrive incrementally) but would double up a name sent
  across multiple chunks with each carrying a fragment — no provider
  behind OpenRouter is currently known to do that; noted for a future
  Part if one ever does.
- **The non-streaming-body fallback and idle timeout don't compose.**
  If a runtime's `fetch()` lacks a readable-stream body *and* its
  `res.json()` call hangs indefinitely, nothing currently times that
  out — the idle timer only guards the readable-stream code path. Out
  of scope for this Part (every environment this codebase targets
  supports streaming bodies); a natural follow-up if that ever
  changes.
- Wiring `<script defer src="os/api/openrouter/stream-manager.js">`
  and `response-parser.js` tags into the actual OS shell/workspace
  HTML pages is left to the integrator, same as every prior Part in
  this family — no page was in scope for this Part.
