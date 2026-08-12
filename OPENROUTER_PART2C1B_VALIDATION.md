# AXIOM — Block 2 / Step 9 / Part 2C-1B: OpenRouter Tool Calling — Tool Call Parser
## Validation Report

**Date:** 2026-08-08
**Deliverable:** `os/api/openrouter/tool-calling/tool-call-parser.js`,
new global `window.AxiomOpenRouterToolCallParser`, regression suite,
`CHANGELOG.md` entry, this report.

---

## 1. Pre-implementation architecture audit

Before writing anything, this Part's stated dependency list was
re-read in full: `tool-manager.js`, `tool-schema.js` (Part 2C-1A),
`chat-manager.js`, `response-parser.js`, `stream-manager.js`,
`RuntimeContext`, `AxLogger`, and the `AxiomOrchestrator` event bus.

### 1.1 What already exists, and what this Part reuses

| Concern | Existing module | Reused how |
|---|---|---|
| Tool-definition schema shape | `AxiomOpenRouterToolSchema.isValidToolName()` | Reused directly for call-name shape checks inside `validateToolCall()`. This Part does **not** re-implement tool-*definition* validation (`validateSchemaNode`/`validateObjectNode`/`validateArrayNode` stay exclusively in `tool-schema.js`). |
| Tool registry | `AxiomOpenRouterToolManager.hasTool()`/`.getTool()` | Reused directly to check a parsed call names a registered tool, and to read that tool's already-normalized `parameters` schema for argument-structure checks. This Part does **not** re-implement registration, storage, or lookup. |
| Raw `tool_calls`-shape reshaping | `response-parser.js`'s `normalizeToolCalls()`/`normalizeMessage()` | **Not called, not duplicated.** Confirmed disjoint: that function already reshapes one chunk's/message's worth of raw `tool_calls` into a stable per-chunk shape (arguments left as a raw string). This Part's own `parseToolCall()` accepts the exact same raw wire shape response-parser.js already accepts, so either the raw API value or response-parser.js's output can be fed into it — but this Part is the first to `JSON.parse()` the arguments string into an actual object, with a controlled non-throwing error path, and the first to check the result against the tool registry. |
| Streaming delta accumulation | `stream-manager.js`'s internal (unexported) `mergeToolCalls()` | **Not called — it's private — and not duplicated as a modification.** This Part's own `createAccumulator()` is a separate, opt-in, stateless-per-instance utility with the same general "merge by index" shape, built because the *goal* here (finalized-and-parsed calls) differs from stream-manager.js's own goal (a raw merged record for `finishStream()`'s message). `stream-manager.js` itself was not opened for writing — confirmed unmodified in §5 via hash. |
| Event bus | `AxiomOrchestrator.on()`/`.emit()` | Reused directly, same convention `tool-manager.js` already established for this Part — no local listener map, feature-detected, try/catched. |
| Logger | `AxLogger` | Same defensive `safeLog()` convention every sibling uses. |
| Model tool-support awareness | `model-manager.js`'s `getCapabilities(id).tools` | Not consulted — no model-awareness in this Part, same posture `tool-schema.js`/`tool-manager.js` already documented for themselves. |
| Runtime Context | `AxiomRuntimeContext` | Not touched — parsing/validating a tool call has no request to wrap and nothing worth tracking in a runtime context. |

### 1.2 Decision: argument-*instance* validation is new work, not a duplicate

`tool-schema.js`'s `validateParameters()` checks that a tool's
declared JSON-Schema *definition* is well-formed. It never sees an
actual arguments *value* — there was nothing to duplicate. Checking
whether a parsed-arguments object satisfies an already-registered
tool's schema (required keys present, primitive types match) is a
different, disjoint operation (schema-vs-definition vs.
schema-vs-instance), and this Part is the first with an actual
argument value in hand to check. Implemented as a small recursive
`validateArgumentsAgainstSchema()`, deliberately narrower than full
JSON Schema (required + primitive/array/object type-matching only,
matching the build spec's own "argument structure, required
parameters" wording) — additional properties on the arguments object
that aren't declared on the tool are not themselves treated as
errors, same "don't over-constrain what the spec didn't ask for"
posture `tool-schema.js` already took with unrecognized descriptive
schema keys.

### 1.3 Decision: normalized output extends, rather than narrows, the spec's shape

The build spec's Section 1 shows `{id, name, arguments, raw}` as the
target shape. Delivered exactly those four fields, plus two more
needed to satisfy Section 3 ("malformed JSON must return a controlled
parse error") without inventing a second return convention:
`argumentsRaw` (the original string/value before parsing) and
`parseError` (`null` on success, a message string on failure). A
`{success, errors}`-style wrapper (matching `tool-manager.js`'s
`registerTool()` convention) was considered and rejected — it would
mean every caller unwraps a call before it looks like the documented
shape at all; `parseError` on an otherwise-complete record was judged
closer to what "Output: `{id, name, arguments, raw}`" actually asks
for, while still making a parse failure impossible to silently miss.

### 1.4 Decision: "sufficient data" for streaming finalization = id + function name

The build spec says a partial call should only finalize "when
sufficient data is available," without defining that threshold. An
id and a (possibly still-growing) function name are the minimum
needed to identify *which* tool is being called and to correlate the
eventual tool-result message back to this call via its
`tool_call_id`. Arguments are deliberately **not** required to be
complete, syntactically-valid JSON before `finalize()` will return an
entry — Section 3's own controlled-parse-error path already handles
an incomplete/malformed arguments fragment safely, so `finalize()`
doesn't need a second, JSON-completeness-guessing gate on top of it.
A caller integrating this against a real stream would in practice
only call `finalize()` once, when `finish_reason` reports
`"tool_calls"` — at which point the arguments fragment is expected to
be complete, and a `parseError` on the result becomes a genuine
signal, not a false alarm from calling too early.

### 1.5 Decision: pure parsing/validation, no changes to any existing file

Same posture Parts 2B-1 through 2C-1A each set: this Part needed
nothing beyond what was already public
(`AxiomOpenRouterToolSchema.isValidToolName`,
`AxiomOpenRouterToolManager.hasTool`/`.getTool`,
`AxiomOrchestrator.on`/`.emit`, `AxLogger`). It never calls
`chat.sendMessage()`, `stream.streamMessage()`, `queue.enqueue()`, or
`AxiomRuntimeContext.createContext()`, and adds one new file
(`tool-call-parser.js`) to the existing `tool-calling/` subdirectory
rather than touching anything else in `os/api/openrouter/`. **Zero
existing delivered source files were modified** — confirmed in §4/§5
via exact byte-for-byte content hashes of every sibling this Part
reads from or near.

---

## 2. What was built

### `os/api/openrouter/tool-calling/tool-call-parser.js` — `window.AxiomOpenRouterToolCallParser`

- **`parseToolCall(rawToolCall)`** → `{id, name, arguments,
  argumentsRaw, parseError, raw}`. Accepts the OpenRouter/OpenAI raw
  wire shape (`{id, type, function:{name, arguments}}`) or the
  `tool_call_id` spelling; never throws on any input shape (`null`,
  `undefined`, a string, a partial object). Parses `arguments` via
  `JSON.parse()` only, wrapped in try/catch — valid JSON, an empty
  string, `null`/`undefined`, and an already-parsed object all
  resolve to a usable `{}`-or-parsed value with `parseError: null`;
  malformed JSON or a non-object JSON value (e.g. an array) resolves
  to a safe `{}` default with `parseError` set to a descriptive,
  non-throwing message.
- **`parseToolCalls(rawToolCalls)`** → one `parseToolCall()` result
  per input entry, same order, one-to-one — never drops an entry even
  when some are malformed. Fires the detected/parsed-or-failed event
  pair (below) for every entry.
- **`validateToolCall(parsedCall)`** → `{valid, errors: string[]}`.
  Checks call-name shape (via `AxiomOpenRouterToolSchema`), a clean
  argument parse, that the named tool is actually registered (via
  `AxiomOpenRouterToolManager`), and — when it is — that the parsed
  arguments satisfy that tool's required parameters and declared
  types. Degrades to a reported failure (never a throw) when
  `AxiomOpenRouterToolManager` isn't loaded. Never executes the tool.
- **`createAccumulator()`** → `{addDeltas, getPartials, finalize,
  reset}`, a caller-owned per-stream accumulator. `addDeltas()` merges
  one streaming delta's `tool_calls` fragment (keyed by `index`) into
  raw, still-unparsed internal state. `getPartials()` snapshots that
  raw state. `finalize()` runs every partial with an id + function
  name through `parseToolCall()` (firing the same detected/parsed-or-
  failed events `parseToolCalls()` does) and returns those results —
  a partial still missing an id or a name is skipped rather than
  finalized. `reset()` clears accumulated state for stream reuse.

---

## 3. Requirements coverage

| Required (build spec section) | Delivered as |
|---|---|
| §1 Normalize OpenRouter tool calls into `{id, name, arguments, raw}` | `parseToolCall()` — exact four fields present, plus `argumentsRaw`/`parseError` for §3's controlled-error requirement. |
| §2 Multiple tool calls, preserve order/id/name/arguments, never discard | `parseToolCalls()` — one-to-one array map, order-preserving, tested against a 3-entry batch including one malformed entry (all 3 still returned). |
| §3 Valid/empty/malformed/null/string/object arguments; malformed → controlled parse error, never execute | `parseArguments()` covers all six named cases; every path returns a value, never throws; `arguments` is treated as inert data everywhere (no `execute`/`handler`/`run`/`eval`/`Function` call site in the file — static + dynamic checks). |
| §4 Streaming: accumulate id/name/partial arguments, finalize only with sufficient data, don't break normal text streaming | `createAccumulator()` — merges by `index`; `finalize()` requires id+name (§1.4); does not touch `stream-manager.js` at all, confirmed unmodified by hash, so normal streaming is provably unaffected by this file's mere presence. |
| §5 Validate tool exists/name/argument structure/required params via Part 2C-1A's schema system, never execute | `validateToolCall()` — delegates name-shape to `AxiomOpenRouterToolSchema`, existence to `AxiomOpenRouterToolManager`, and does its own (new, non-duplicative — §1.2) argument-instance check against the registered tool's schema. |
| §6 Emit `openrouter_tool_call_detected`/`_parsed`/`_parse_failed` via existing `AxiomOrchestrator` | All three, exact names, correct payloads, verified via a tapped fake `AxiomOrchestrator`; confirmed never-throws with no `AxiomOrchestrator` loaded. |
| §7 No `eval()`/`Function()`/arbitrary code execution/shell execution | None anywhere in the file — static check (comment-stripped) + dynamic checks (a stray `execute` field on a raw call, and a function-typed value inside object-shaped arguments, both confirmed non-callable on the parsed result). |
| §9 Do not claim completion without real test results | See §5 — every number below is from an actual `node` run in this session, not asserted. |

---

## 4. Non-duplication / non-modification confirmation

- `tool-call-parser.js` contains no local re-implementation of tool-
  *definition* validation — `isValidToolName` is read from
  `AxiomOpenRouterToolSchema`, and the file defines no
  `validateTool()`/`validateSchemaNode()` of its own.
- `tool-call-parser.js` contains no local re-implementation of the
  tool registry — `hasTool`/`getTool` are read from
  `AxiomOpenRouterToolManager`, and the file defines no
  `registerTool()` of its own.
- `tool-call-parser.js` contains no local event-bus implementation
  (no `listeners` map, no local `on(event, fn)`) — it calls
  `AxiomOrchestrator.emit()` directly, confirmed by static check.
- `tool-call-parser.js`'s code (comments excluded) does not call
  `response-parser.js`'s `normalizeToolCalls()`, does not reach into
  `AxiomOpenRouter.stream`'s internal state, and does not call
  `model-manager.js`'s `getCapabilities()` — confirmed by static
  check (comment-stripped, so this file's own header prose explaining
  *why* those are disjoint/unneeded doesn't trip the check).
- `os/api/openrouter/tool-calling/` now contains exactly the three
  files (Part 2C-1A's `tool-schema.js`/`tool-manager.js`, unchanged,
  plus this Part's `tool-call-parser.js`) — confirmed via a directory
  listing assertion.
- Every Block 2 do-not-modify file (browser/automation/memory/goal-
  manager/voice/Supabase) confirmed still present on disk.
- Every existing `os/api/openrouter/*.js` file — including both Part
  2C-1A files — confirmed **byte-for-byte identical** (SHA-256 match
  against a hash captured immediately after Part 2C-1A's own
  deliverable was extracted, before this Part touched anything) to
  its pre-2C-1B state. No `.html` file edited.

---

## 5. Verification

### 5.1 New regression suite

`test-evidence/block2-step9-part2c1b-tool-call-parser-regression-suite.js`
— the real file loaded, together with its two Part 2C-1A
dependencies, in a `vm` sandbox (same convention as every prior
Part's own suite). No network calls anywhere in the delivered file,
so none needed mocking.

```
101 passed, 0 failed.
```

Coverage: single-call normalization (id/name/arguments/raw
extraction, `tool_call_id` spelling, never-throws on
null/undefined/non-object input); multiple tool calls (order
preservation, never-discard even with a malformed entry, `[]` on
non-array input); every argument-parsing case the build spec names
(valid JSON, empty string, undefined, `null`, malformed JSON, a
pre-parsed object, a JSON array as a controlled-error case) plus a
dynamic no-code-execution check; missing tool name (parses safely,
`validateToolCall()` reports it), missing tool id (parses safely,
still usable), unknown tool (`validateToolCall()` names it in the
error); streaming accumulation (partial-then-complete argument
assembly across three chunks, id preserved across chunks that omit
it, multiple concurrent call indices finalizing independently,
insufficient-data — no function name yet — never finalizing, `reset()`
clearing state, no throw on a non-array `addDeltas()` input, and the
early-finalize-with-incomplete-JSON case producing a controlled
`parseError` rather than a throw or a silent drop); event emission for
all three documented events with correct payloads and ordering
(`detected` always fires; exactly one of `parsed`/`parse_failed`
follows), confirmed never-throws with no `AxiomOrchestrator` loaded,
and confirmed the accumulator's own `finalize()` emits the same pair;
registry-aware validation (valid call passes, missing required
argument fails and names it, wrong argument type fails and names it,
an unrecognized extra argument is *not* itself an error, a malformed-
JSON call fails, and the degraded no-`ToolManager`-loaded path reports
failure rather than throwing); security statics (no `eval`/`Function`/
`child_process`/`localStorage`/`fetch` in code, `JSON.parse` is the
only parsing mechanism) plus the two dynamic function-stripping
checks from §4's summary; the full non-duplication/non-modification
static-check set from §4; and — as its own final section — fresh
subprocess re-runs of Part 2A's, 2B-1's, and 2B-2's own suites
(**72/72**, **56/56**, **87/87**), plus byte-for-byte SHA-256
confirmation that every file Part 2B-3, 2B-4, and 2C-1A's own suites
exercise (`tool-schema.js`, `tool-manager.js`, `request-queue.js`,
`usage-tracker.js`, `response-parser.js`, `stream-manager.js`,
`chat-manager.js`, `api-manager.js`, `error-handler.js`,
`token-manager.js`, `model-manager.js`) is unmodified by this Part.

### 5.2 Why Part 2B-3/2B-4/2C-1A's own suites were not re-executed live in this run

All three are correct and were not modified. Part 2B-3's own suite
*was* re-run standalone, directly, in this session and completed
cleanly:

```
96 passed, 0 failed.
```

but it — and therefore everything that nests it (2B-4, 2C-1A) —
leaves its child `node` process alive well past its printed summary
line, because `request-queue.js`'s regression suite wires a **real**
(unmocked) `global.setTimeout` into its sandbox for retry/backoff/
rate-limit-timer coverage (`test-evidence/block2-step9-part2b3-request-queue-regression-suite.js:62`,
exercising the real timer call sites at `request-queue.js:389,461,535`).
This is a pre-existing property of that suite (present before this
Part, not introduced by it). Confirmed directly: a fully detached
(`setsid`) background run of `block2-step9-part2b4-usage-tracker-regression-suite.js`
was left running for over 100 seconds after its output had visibly
stalled mid-way through nesting `block2-step9-part2b3-request-queue-regression-suite.js`
as a child process — that child sat at 0% CPU (asleep on a pending
timer, not looping) the entire time, past every point a plausible
backoff delay in `request-queue.js` would have elapsed, and was
terminated manually rather than left to find out how much longer.
Nested through 2B-4 and 2C-1A this compounds (each of 2B-4's own four
prior-suite subprocess calls, and each of 2C-1A's five, has to fully
resolve in sequence) far past what a single verification step here
can respect. Rather than either skip the check or let a run hang
indefinitely, this Part verified the thing that actually determines
whether Part 2C-1B could have broken any of them: **exact
byte-for-byte content hashes on every file those suites exercise**
(§4/§5.1) — a strictly stronger guarantee against "did this Part's
change affect that suite's inputs" than a re-run of suites whose own
source, and whose own dependencies' source, this Part never touched.
Part 2A/2B-1/2B-2/2B-3 — the suites in the dependency chain that
don't themselves nest a suite carrying this lingering-timer property
— were all re-run live in this session, for direct fresh-process
evidence.

### 5.3 Fixes applied

**To the delivered source (`tool-call-parser.js`):** one real defect
was found and fixed by the first full suite run — `parseArguments()`'s
"already an object" branch (build spec §3's "object arguments" case)
returned the caller's object by direct reference rather than a
deep clone, meaning a function-typed property attached to that object
would have survived into `parsed.arguments` still callable. Fixed to
route through the same JSON-round-trip `deepClone()` every other
returned value in this file already uses. Confirmed via a dedicated
test that a function-typed value inside object-shaped arguments is
now stripped, not preserved.

**To this Part's own new test file:** three issues, found and fixed
during development of the suite itself, none in the delivered source:
(1) a streaming test asserted `finalize()` would return nothing before
the arguments JSON was complete — corrected once the intended
behavior (§1.4: finalize on id+name, controlled `parseError` if JSON
is still incomplete) was worked through; the delivered code was
already correct. (2) an events test didn't clear the fake
`AxiomOrchestrator`'s emitted-event log after a `registerTool()` call
that itself legitimately emits `openrouter_tool_registered`, causing
a false failure — fixed by clearing the log at the right point; not a
parser defect. (3) a static regex checking for `AxiomOrchestrator.emit`
being called directly was too strict about the character distance
between the two tokens (real code assigns `Orchestrator =
global.AxiomOrchestrator` first, then calls `Orchestrator.emit(...)`
several lines later) — loosened to check both facts independently
rather than requiring them adjacent in the source text.

---

## 6. Known limitations / follow-ups for a future Part

- **No execution wiring.** This Part converts API data into
  structured, validated data and stops — nothing here dispatches a
  parsed/validated call to an actual callable implementation. That
  remains explicitly out of scope, same as Part 2C-1A's own registry.
- **No automatic stream integration.** `createAccumulator()` is an
  opt-in utility a future Part would need to wire to
  `stream-manager.js`'s own delta/finish-reason lifecycle (e.g. call
  `addDeltas()` from an `onChunk` callback and `finalize()` when
  `finishReason === "tool_calls"`) — this Part does not do that
  wiring itself, so as not to modify `stream-manager.js`.
- **Argument-instance validation is intentionally narrower than full
  JSON Schema** (required + primitive/array/object type-matching
  only, no `enum`/`pattern`/`minimum`/`maximum` instance checks),
  matching the build spec's own "argument structure, required
  parameters" wording. A future Part could extend
  `validateArgumentsAgainstSchema()` if a product need arises, without
  changing this Part's public contract.
