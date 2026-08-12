# AXIOM — Block 2 / Step 9 / Part 2C-1A: OpenRouter Tool Calling — Tool Registry & Schema Foundation
## Validation Report

**Date:** 2026-08-08
**Deliverable:** `os/api/openrouter/tool-calling/tool-manager.js`,
`os/api/openrouter/tool-calling/tool-schema.js`, new globals
`window.AxiomOpenRouterToolManager` / `window.AxiomOpenRouterToolSchema`,
regression suite, `CHANGELOG.md` entry, this report.

---

## 1. Pre-implementation architecture audit

Before writing anything, the existing `os/api/openrouter/` directory
and its siblings were read in full:
`api-manager.js`, `model-manager.js`, `token-manager.js`,
`error-handler.js`, `chat-manager.js`, `response-parser.js`,
`stream-manager.js`, `request-queue.js`, `usage-tracker.js`, plus
`os/core/orchestrator.js` (the `AxiomOrchestrator` event bus) and
`os/core/capability-router.js` (the established convention for a
new file calling `AxiomOrchestrator.emit()`/`.on()` directly rather
than building a second bus).

### 1.1 What already exists, and what this Part reuses

| Concern | Existing module | Reused how |
|---|---|---|
| Event bus | `AxiomOrchestrator.on()`/`.emit()` (`os/core/orchestrator.js`) | Reused **directly** — per this Part's own build spec ("Reuse AxiomOrchestrator Event Bus... Do NOT create another Event Bus"), `tool-manager.js` has no `on()`/local listener map of its own. It calls `AxiomOrchestrator.emit()` for `openrouter_tool_registered`/`_unregistered`/`_registration_failed`, feature-detected and try/catched exactly like `os/core/capability-router.js`'s own `var Orchestrator = global.AxiomOrchestrator;` convention. This is a deliberate departure from the `AxiomOpenRouter.on()/.emit()` sub-bus Part 2A-2B4 built and reused amongst themselves — the build spec named `AxiomOrchestrator` specifically, not `AxiomOpenRouter`, and the two are different objects with different purposes (`AxiomOpenRouter`'s bus is OpenRouter-request-lifecycle-scoped; `AxiomOrchestrator`'s is the whole-app coordination bus every `os/core/*` file already publishes onto). |
| Logger | `AxLogger` | Same defensive, feature-detected `safeLog()` every `os/api/openrouter/*` sibling already uses — console fallback, never throws. |
| Response-side tool-call parsing | `response-parser.js`'s `normalizeToolCalls()`/`normalizeMessage()` | **Not reused, not duplicated, not modified.** Audited and confirmed disjoint: `response-parser.js` parses `tool_calls` OUT of a model's response (data flowing OpenRouter → AXIOM). This Part validates/normalizes tool DEFINITIONS going INTO a request (data flowing AXIOM → OpenRouter). No field, helper, or regex is shared between the two directions. |
| Model tool-support awareness | `model-manager.js`'s `getCapabilities(id).tools` | **Not reused, not needed.** This Part has zero model-awareness — registration and schema validation are independent of which (if any) model will ultimately receive a tool definition. A future tool-calling Part that wants to filter `getToolDefinitions()`'s output by a target model's declared `tools` support can do so entirely from this Part's already-public API, with no change here. |
| Chat/Stream/Runtime Context | `chat-manager.js`, `stream-manager.js`, `AxiomRuntimeContext` | **Not touched.** Registration/schema work has no request to wrap, no response to parse, and nothing worth tracking in a runtime context — this Part never calls `doChatRequest()`, `chat.sendMessage()`, `stream.streamMessage()`, or `createContext()`. Wiring a registered tool's definitions into an actual outgoing chat/stream request, and dispatching a model's resulting `tool_calls` back to an implementation, is explicitly out of scope for Part 2C-1A (registry + schema foundation only) and is left to a future Part. |

### 1.2 Decision: two files, not one

The build spec calls for a **Tool Manager** (registry: register/
unregister/lookup/list) and a **Tool Schema** (validate/normalize)
as two separate globals — `window.AxiomOpenRouterToolManager` and
`window.AxiomOpenRouterToolSchema` — rather than one combined file.
This was kept as two files because the split maps directly onto a
real reuse boundary: `tool-schema.js` is pure, stateless, dependency-
free (no reference to `AxiomOrchestrator`/`AxLogger`/`AxiomOpenRouter`
anywhere in its code — confirmed by the new suite's own static
check), so it can be loaded and used standalone by a future Part that
only needs schema validation without pulling in a registry, an event
bus dependency, or a logger dependency. `tool-manager.js` is the only
file that depends on `tool-schema.js` (for validation/normalization)
and `AxiomOrchestrator`/`AxLogger` (for events/logging) — a clean,
one-directional dependency, matching the spec's own file list.

### 1.3 Decision: `getToolDefinitions()` returns the wire shape; `metadata` never leaves the registry

OpenRouter's `tools` request field expects
`{type:"function", function:{name, description, parameters}}` — it
has no concept of AXIOM-local `metadata`. `normalizeTool()` therefore
produces exactly that wire shape, with `metadata` deliberately
omitted (confirmed by the suite's own
`getToolDefinitions() entries omit the AXIOM-local metadata field`
check). Callers that need `metadata` back use `getTool()`/`getTools()`
instead, which return the full record including it.

### 1.4 Decision: registry stores validated, normalized data only — never a caller's original object, never anything callable

Every stored/returned field is deep-cloned via a JSON round-trip
(`JSON.parse(JSON.stringify(...))`). This was a deliberate security
choice, not just a convenience one: it guarantees three things at
once, all independently verified in §5:

1. A caller mutating an object they got back from `getTool()`/
   `getTools()`/`getToolDefinitions()` cannot corrupt the registry's
   internal state (classic aliasing bug class, closed off entirely).
2. The registry mutating its own internal state cannot be triggered
   by a caller later mutating the *original* object they passed into
   `registerTool()` — the stored record is a snapshot at registration
   time, not a live reference.
3. **No function-typed value can ever survive into or out of the
   registry.** `JSON.stringify()` silently drops function-typed
   properties, and `ToolSchema.validateTool()`'s own `isPlainObject()`
   check independently rejects a function anywhere a schema node is
   expected (a function's `typeof` is `'function'`, never `'object'`).
   The Tool Manager's own registration path additionally stores
   **only** the four documented fields (`name`, `description`,
   `parameters`, `metadata`) off of whatever object it's given — a
   stray `execute`/`handler` property some caller mistakenly attaches
   is silently dropped, never stored, never invoked. This closes the
   loop on the build spec's "Tool arguments remain data only" /
   "Never execute tools" requirements at the data-structure level, not
   just as a policy comment.

### 1.5 Decision: pure registry, no changes to any existing file

Same posture Parts 2B-1 through 2B-4 each set: this Part needed
nothing from any sibling beyond what was already public
(`AxiomOrchestrator.on`/`.emit`, `AxLogger`). It never calls
`chat.sendMessage()`, `stream.streamMessage()`, `queue.enqueue()`, or
`AxiomRuntimeContext.createContext()`, and adds one net-new
subdirectory (`os/api/openrouter/tool-calling/`) rather than touching
any existing file in `os/api/openrouter/`. **Zero existing delivered
source files were modified** by this Part's own source — confirmed in
§4/§5. The only changes anywhere else in the repo are the same kind
of file-count-assertion update every prior Part has made to the
suites that came before it (§5.3).

---

## 2. What was built

### 2.1 `os/api/openrouter/tool-calling/tool-schema.js` — `window.AxiomOpenRouterToolSchema`

- **`validateTool(tool)`** → `{valid, errors: string[]}`. Checks
  `name` (present, 1-64 chars of `[a-zA-Z0-9_-]`), `description`
  (optional, must be a string if present), `parameters` (required,
  validated recursively — see below), `metadata` (optional, must be
  a plain object if present).
- **`validateParameters(parameters)`** → `{valid, errors}`. Requires
  a top-level `{type: "object", properties?, required?}` shape, then
  recurses into every declared property. Supported leaf types:
  `string`, `number`, `integer`, `boolean`. Supported container
  types: `object` (recurses into `properties`, validates `required`
  is an array of strings each naming a declared property) and `array`
  (requires an `items` schema, recurses into it) — arbitrarily nested
  (object-of-array-of-object, etc., all covered by the suite).
- **`normalizeTool(tool)`** → the OpenRouter wire-format
  `{type:"function", function:{name, description, parameters}}`, with
  `properties`/`required` defaults filled in at every level, or
  `null` if `validateTool(tool)` is invalid. Never mutates its input.
- **`isValidToolName(name)`** → boolean, the same name rule
  `validateTool()` uses internally, exposed standalone.
- Stateless, synchronous, side-effect-free: no storage, no logging,
  no event emission, no network, no dependency on any other AXIOM
  global (confirmed by the suite's own dependency-free static check).

### 2.2 `os/api/openrouter/tool-calling/tool-manager.js` — `window.AxiomOpenRouterToolManager`

- **`registerTool(tool)`** → `{success, tool?, errors?}`. Delegates
  validation entirely to `AxiomOpenRouterToolSchema.validateTool()`
  (no local re-implementation of any validation rule). Rejects
  duplicate names without overwriting the original. Stores only the
  four documented fields, normalized-and-defaulted parameters, and a
  deep-cloned metadata — nothing else off the input object survives.
  Emits `openrouter_tool_registered` on success,
  `openrouter_tool_registration_failed` (with the schema's own error
  list) on any rejection — including the "no `AxiomOpenRouterToolSchema`
  loaded" degrade case.
- **`unregisterTool(name)`** → boolean. Removes from both the lookup
  map and the order list; emits `openrouter_tool_unregistered` on an
  actual removal, returns `false` (no event) for an unknown/invalid
  name.
- **`getTool(name)`** → deep-cloned record or `null`.
- **`hasTool(name)`** → boolean.
- **`getTools()`** → deep-cloned records, **registration order**
  preserved (not sorted, not keyed-object order — verified against an
  intentionally out-of-alphabetical registration sequence).
- **`getToolDefinitions()`** → deep-cloned OpenRouter wire-format
  entries, same registration order, `metadata` omitted per §1.3.
- **`clearTools()`** → empties both internal structures; no event
  (not in the spec's event list).
- Degrades gracefully: with no `AxiomOpenRouterToolSchema` loaded,
  `registerTool()` fails cleanly (`{success:false, errors:[...]}`,
  plus a failure event) rather than throwing; every read API
  (`getTools`/`getToolDefinitions`/`hasTool`) still works and reports
  empty. With no `AxiomOrchestrator` loaded, every method still works
  identically — events are simply never emitted (feature-detected,
  try/catched, confirmed never throws).

---

## 3. Requirements coverage

| Required | Delivered as |
|---|---|
| `registerTool`/`unregisterTool`/`getTool`/`hasTool`/`getTools`/`getToolDefinitions`/`clearTools` | All seven, exact names, on `window.AxiomOpenRouterToolManager`. |
| Tool structure `{name, description, parameters, metadata}` | Exactly these four fields are read from the input and stored; nothing else survives registration (§1.4). |
| Prevent duplicate tool names | `registerTool()` rejects a second registration under an already-used name, original left untouched. |
| Validate tools before registration | Every `registerTool()` call runs `ToolSchema.validateTool()` first; nothing is added to the registry on failure. |
| Preserve registration order | `getTools()`/`getToolDefinitions()` both iterate an explicit order array, verified against a non-alphabetical registration sequence. |
| Return normalized definitions | `getToolDefinitions()` returns `ToolSchema.normalizeTool()`'s wire-shape output exclusively. |
| Never execute tools | No `execute`/`handler`/`run`/`call`/`apply` call site anywhere in either file (static check); a stray callable field on a caller's input is silently dropped, never stored, never invoked (dynamic check). |
| Never use eval or dynamic code execution | No `eval(`, no `new Function(`, no `document.write`/dynamic `<script>` injection anywhere in either file's code (static check, comment-stripped so documentation prose naming these to explain their absence doesn't false-positive). |
| `window.AxiomOpenRouterToolSchema` — `validateTool`/`normalizeTool`/`validateParameters`/`isValidToolName` | All four, exact names. |
| Supported types: string/number/integer/boolean/object/array, required/optional properties, nested objects, arrays | All covered, including nested object-in-array and array-of-object combinations. |
| Reject: missing name, invalid name, missing parameters, invalid parameter types, malformed required arrays, malformed schemas | Each is its own dedicated test case in the suite (§5.1). |
| Reuse AxiomOrchestrator Event Bus, do not create another | `tool-manager.js` has no local `on()`/listeners map — confirmed by static check — and calls `AxiomOrchestrator.emit()` directly. |
| Emit `openrouter_tool_registered`/`_unregistered`/`_registration_failed` | All three, exact names, correct payload shapes, verified via a tapped fake `AxiomOrchestrator`. |
| DO NOT modify Browser/Automation/Memory/Goal Manager/Supabase/Voice/Living AI Core/UI | Confirmed: every protected file from prior Parts' own `doNotModify` list re-checked present on disk; no `.html` file touched; no file under `os/core/browser-*`, `os/core/automation-*`, `os/core/memory-*`, `os/core/goal-manager*`, `js/core/voice*`, `js/core/supabase/*` was opened for writing at any point in this Part. |
| Backward compatibility — existing OpenRouter Part 2A/2B functionality continues working | Fresh subprocess re-runs of all five existing suites, unmodified in behavior: **72/72, 56/56, 87/87, 96/96, 90/90** (§5.1, §5.2). |

---

## 4. Non-duplication / non-modification confirmation

- `tool-manager.js` contains no local re-implementation of JSON
  Schema validation (`validateSchemaNode`/`validateObjectNode`/
  `validateArrayNode` — all three live only in `tool-schema.js`) —
  confirmed by static source-text check.
- `tool-manager.js` contains no local event-bus implementation (no
  `listeners` map, no local `on(event, fn)` — it calls
  `AxiomOrchestrator.emit()` directly) — confirmed by static check.
- `tool-schema.js`'s code (comments excluded) references none of
  `AxiomOpenRouter`, `AxiomOrchestrator`, or `AxLogger` — it is fully
  standalone — confirmed by static check.
- Neither new file's code calls `response-parser.js`'s
  `normalizeToolCalls()` or `model-manager.js`'s `getCapabilities()`
  — confirmed by static check (comment-stripped, so this file's own
  header prose explaining *why* those are disjoint/unneeded doesn't
  trip the check).
- Every Block 2 do-not-modify file (browser/automation/memory/goal-
  manager/voice/Supabase) confirmed still present on disk.
- Every existing `os/api/openrouter/*.js` sibling confirmed still
  present on disk.
- `os/api/openrouter/` now contains exactly the nine existing files
  plus the one new `tool-calling/` subdirectory — confirmed via a
  directory listing assertion (updated, same precedent as every
  prior Part, in all five existing suites — see §5.3).
- `os/api/openrouter/tool-calling/` contains exactly the two Part
  2C-1A deliverables — confirmed via a directory listing assertion.
- No `.html` file edited.

---

## 5. Verification

### 5.1 New regression suite

`test-evidence/block2-step9-part2c1a-tool-registry-regression-suite.js`
— real files loaded in a `vm` sandbox (same convention as every prior
Part's own suite); no network calls anywhere in either delivered
file, so none needed mocking.

```
145 passed, 0 failed.
```

Coverage: schema validation across every reject case the build spec
names explicitly (missing name, invalid name, missing parameters,
invalid parameter types, malformed required arrays, malformed
schemas) plus the accept cases (nested objects, arrays, array-of-
object, all four primitive types, boundary-length names); schema
normalization (wire-shape output, default-filling, no input
mutation, `metadata` omission, recursive nested normalization);
tool-manager.js's degrade path with `tool-schema.js` NOT loaded
(fails cleanly, never throws, still emits the failure event); full
registration/lookup/unregistration/clear lifecycle; duplicate-name
rejection without overwrite; invalid-tool rejection without
registry pollution; registration-order preservation for both
`getTools()` and `getToolDefinitions()` against a deliberately
non-alphabetical sequence; deep-clone immutability in all four
directions (mutating a `getTool()`/`getTools()`/`getToolDefinitions()`
return value, and mutating the caller's original object *after*
registration — none of the four can affect the registry); event
emission for all three documented events with correct payloads, and
confirmed never-throws with no `AxiomOrchestrator` loaded at all;
security statics (no `eval`/`Function`/dynamic script loading/
network/`localStorage` in code) plus a dynamic check that a stray
`execute`/`handler` function attached to a tool by a caller is
silently dropped and never appears anywhere in any returned record,
list, or definitions array; the full non-duplication/non-
modification static-check set from §4; and — as its own final five
tests — fresh subprocess re-runs of Parts 2A's, 2B-1's, 2B-2's,
2B-3's, and 2B-4's own suites, confirming **72/72**, **56/56**,
**87/87**, **96/96**, and **90/90** respectively, unmodified in
behavior.

One defect was found and fixed during development of this suite
itself (not in the delivered source — see §5.3).

### 5.2 Full existing suite run

Every suite in `test-evidence/` was re-run after the two new files
were added, each run to completion individually (several of the
existing suites — 2B-3, 2B-4, and this Part's own new suite — launch
their prior siblings as real subprocesses for their own backward-
compatibility checks, which is inherently slow but was let run to
completion rather than truncated):

| Result | Notes |
|---|---|
| ✅ Pass | `block2-step9-part2a-openrouter-core` (**72/72**, re-run after its static-check update), `block2-step9-part2b1-chat-manager` (**56/56**, re-run after its static-check update), `block2-step9-part2b2-stream-manager` (**87/87**, re-run after its static-check update), `block2-step9-part2b3-request-queue` (**96/96**, re-run after its static-check update), `block2-step9-part2b4-usage-tracker` (**90/90**, re-run after its static-check update), and this Part's new `block2-step9-part2c1a-tool-registry` (**145/145**). Every other suite in `test-evidence/` that was passing before this Part still passes, confirmed by a full directory sweep. |
| ❌ Fail (pre-existing, unrelated) | `block2-step1-coding-agent`, `block2-step1-part2-pipeline`, `milestone5` (both its own suite and its manual-commands file), `milestone6`, `milestone10` — `Error: Cannot find module 'jsdom'` (devDependency never installed in this sandbox). `phase9-part1-static-audit` — pre-existing failures against `env.config.js`, a secrets file intentionally absent from disk. Identical failure set to every prior Part's own report. This Part introduced no new failures and fixed none of these pre-existing ones (out of scope). |

### 5.3 Fixes applied

**To the delivered source (`tool-manager.js`/`tool-schema.js`):** no
defect was found — the registry/schema logic matched its design on
the first full suite run.

**To this Part's own new test file:** two over-broad static string
checks, found and fixed during development of the suite itself, both
the same class of bug Part 2A's own suite fixed once before (see
`OPENROUTER_PART2A_VALIDATION.md` §5.3 / `CHANGELOG.md`): a raw
`/eval\(/`-style regex was matching this Part's own header comments
(`"No eval(), no Function()..."`, written to *document* the security
posture) as if they were real `eval(` call sites, and similarly for
`normalizeToolCalls`/`getCapabilities` mentioned in the header prose
explaining why they're *not* reused. Fixed by stripping `//` and
inline `/* */` comments before running every static string check —
confirmed the two intentionally-planted true-positive fixtures inside
§7's dynamic security tests still fail correctly (i.e., the fix
narrowed false positives without hiding real ones). No line in the
delivered source needed any change.

**To the four pre-existing sibling suites (Part 2A, 2B-1, 2B-2,
2B-4)** and **Part 2B-3's own suite**: one static assertion each
("`os/api/openrouter/` contains exactly N expected files/entries") —
updated to include the new `tool-calling` subdirectory entry,
same precedent Part 2B-1 set for Part 2A's suite and every subsequent
Part has repeated since. No other line in any of the five suites was
touched; all five re-runs confirmed clean (72/72, 56/56, 87/87,
96/96, 90/90).

---

## 6. Known limitations / follow-ups for a future Part

- **No execution wiring.** This Part is registry + schema only, per
  its own scope. Nothing here dispatches a model's `tool_calls`
  response to an actual implementation, and nothing here attaches
  `getToolDefinitions()`'s output to an outgoing `chat.sendMessage()`/
  `stream.streamMessage()` request. Both are natural next steps for a
  future Part ("Part 2C-1B" or similar) and would need to reuse
  `chat-manager.js`/`stream-manager.js`/`response-parser.js` the same
  way this Part reused `AxiomOrchestrator` — without modifying them.
- **No per-model filtering.** `getToolDefinitions()` returns every
  registered tool regardless of whether a target model's
  `model-manager.js` `getCapabilities(id).tools` reports tool-calling
  support at all. A future Part could add an opt-in filter without
  changing this Part's public contract.
- **No persistence.** Same posture as `token-manager.js`/
  `usage-tracker.js`: the registry is in-memory and reset on page
  reload. A future Part could add opt-in persistence without changing
  this file's public contract.
- **No JSON Schema features beyond the build spec's list.** `enum`,
  `default`, `minimum`/`maximum`, `pattern`, etc. are passed through
  verbatim by `normalizeTool()` (not stripped) but are not themselves
  validated — only `type`/`properties`/`required`/`items` are, per
  the build spec's explicit "Support" list. A future Part could add
  stricter validation of those extra keywords if a product need
  arises.
