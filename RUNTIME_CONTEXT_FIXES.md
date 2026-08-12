# Runtime Context — Architecture Debt Fixes

**Block 2 · Step 6 · Part 5 Stabilization Pass**
**Files:** `os/core/runtime-context.js`, `os/core/workflow-planner.js`

This document is the technical companion to the relevant `CHANGELOG.md`
entry: what was broken, why, exactly what changed, and how each fix is
proven by the regression suite. It exists to be read on its own by
someone auditing the diff before Part 6 (Production Validation &
Architecture Freeze).

Scope discipline for this pass: **fixes only**, no new capabilities, no
UI changes, and no changes to Browser, Brain, Memory, Automation,
Analytics, or OpenRouter. Every change below is confined to the two
files listed and their regression suites / docs.

---

## FIX 1 — Child Context Cleanup

### The bug

`childIndex` (a `parentContextId -> [childContextId, ...]` map) was
only ever written to, never pruned:

```js
// createContext() — the only place that touched childIndex before this pass
if (ctx.parentContextId) {
  var siblings = childIndex[ctx.parentContextId] || (childIndex[ctx.parentContextId] = []);
  siblings.push(contextId);
}
```

`destroyContext()` deleted the context from `activeById` and
`archivedById`, but never removed its id from `childIndex`. Two
consequences:

1. **Stale child ids in the parent's list.** `getChildContexts(parentId)`
   and `snapshot(parent).childContextIds` would keep listing children
   that had already been destroyed and no longer existed anywhere.
2. **Orphaned index keys.** If a destroyed context had children of its
   own, `childIndex[thatContextId]` (its list of children) stayed
   allocated forever — a key with no live context behind it.

Under any repeated create/destroy workload (exactly what a workflow
engine running many short-lived sub-tasks does), `childIndex` grows
without bound and never shrinks.

### The fix

```js
function pruneChildIndex(contextId, parentContextId) {
  if (parentContextId && childIndex[parentContextId]) {
    var siblings = childIndex[parentContextId].filter(function (id) { return id !== contextId; });
    if (siblings.length) {
      childIndex[parentContextId] = siblings;
    } else {
      delete childIndex[parentContextId];
    }
  }
  if (childIndex[contextId]) delete childIndex[contextId];
}
```

Called from `destroyContext()` right after the context is removed from
`activeById`/`archivedById`, so the two stores and the index are always
consistent with each other after a destroy completes.

Deliberately **not** changed: `destroyContext()` still does not cascade
to children. A destroyed parent's still-live children simply become
unreachable via `getParentContext()`/`getChildContexts()` (both already
handle a missing parent gracefully, returning `null`/`[]`). Cascading
destruction was not part of the verified debt and would be a behavior
change, not a bug fix.

### Proof

- `FIX 1: destroyContext() removes the destroyed id from its parent childIndex`
- `FIX 1: destroying a context with children prunes its own orphaned childIndex entry`
- `FIX 1: repeated create/destroy cycles never grow childIndex without bound` (500 cycles)
- `FIX 1: destroying one child never disturbs its siblings' visibility under the parent`

---

## FIX 2 — Automatic Cleanup

### The bug

`cleanupExpiredContexts()` was fully implemented and correct — it only
ever destroys entries in `archivedById` whose `expiresAt` has passed,
never touching `activeById`. `startAutoCleanup()`/`stopAutoCleanup()`
also existed, already idempotent (`startAutoCleanup()` always calls
`stopAutoCleanup()` first). The bug was simply that **nothing in the
codebase ever called `startAutoCleanup()`.** Archived contexts only
left memory if some external caller remembered to invoke
`cleanupExpiredContexts()` by hand.

### The fix

The module now calls `startAutoCleanup()` itself at the bottom of the
IIFE, immediately after installing its API:

```js
startAutoCleanup(
  typeof global.AXIOM_RUNTIME_CONTEXT_CLEANUP_INTERVAL_MS === 'number'
    ? global.AXIOM_RUNTIME_CONTEXT_CLEANUP_INTERVAL_MS
    : AUTO_CLEANUP_INTERVAL_MS
);
```

- **Configurable interval:** set `window.AXIOM_RUNTIME_CONTEXT_CLEANUP_INTERVAL_MS`
  before the script loads to change the startup interval; call
  `startAutoCleanup(customIntervalMs)` at any time afterward to
  reconfigure it live.
- **Safe startup:** guarded by `typeof global.setInterval === 'function'`
  — returns `false` rather than throwing in an environment without
  timers (e.g. certain sandboxed test harnesses). The handle is
  `unref()`'d where supported so it never holds a Node process open on
  its own.
- **Safe shutdown:** `stopAutoCleanup()` is idempotent — safe to call
  even when nothing is running (`autoCleanupHandle` is `null`-checked).
- **No duplicate timers:** `startAutoCleanup()` unconditionally calls
  `stopAutoCleanup()` before creating a new timer, so calling it twice
  (e.g. once automatically on load, once explicitly by a caller who
  wants a different interval) can never leave two intervals running.
- **New:** `isAutoCleanupRunning()` — cheap boolean status check,
  exposed both on `AxiomRuntimeContext` and mirrored onto
  `AxiomOrchestrator`.

### Proof

- `FIX 2: automatic cleanup starts as soon as the module loads`
- `FIX 2: automatic cleanup interval is configurable at load time`
- `FIX 2: automatic cleanup never removes an active (non-terminal) context`
- `FIX 2: startAutoCleanup() never leaves more than one timer running (no duplicate timers)`
- `FIX 2: stopAutoCleanup() is a safe no-op when nothing is running`
- `FIX 2: recovery still works normally after an automatic cleanup sweep has run`

---

## FIX 3 — Workflow Planner Integration

### The bug

`workflow-planner.js` maintained its own, entirely separate in-memory
context object per workflow run (`wf.context`), built by a private
`createContext(wf, trigger)` function:

```js
function createContext(wf, trigger) {
  return {
    workflowId: wf.id, trigger: trigger,
    state: Object.create(null), outputs: Object.create(null),
    metadata: { startedAt: Date.now(), stageCount: wf.stages.length },
    timestamps: Object.create(null)
  };
}
```

This was a second, parallel implementation of exactly what Runtime
Context (Part 5) exists to do: track temporary, in-flight execution
state for one request/workflow, with a lifecycle. Two systems meant two
sources of truth, two places to look for "what is this workflow doing
right now," and no way for anything outside Workflow Planner (e.g. a
future monitoring dashboard built against `AxiomRuntimeContext`) to see
workflow-in-flight state at all.

### The fix

`workflow-planner.js` is now a **caller** of Runtime Context, not a
second implementation of it.

- **create:** `executeWorkflow()` calls the renamed
  `createWorkflowContext(wf, trigger)`, which calls
  `AxiomRuntimeContext.createContext({ workflowId, metadata, state,
  temporaryData })`, then `markReady()` → `markRunning()`. The
  returned local object keeps the same shape callers already depend on
  (`state`, `outputs`, `metadata`, `timestamps`, `trigger`) plus a new
  `contextId` field tying it back to the real Runtime Context record —
  `snapshotWorkflow()` and every stage-input/stage-result function are
  unchanged and keep working against this local object exactly as
  before, so the *observable* workflow-execution contract (stage
  payloads, `result.context.outputs`, etc.) is unaffected.
- **update:** `syncWorkflowContext(ctx)` pushes the local object's
  current `state`/`outputs`/`timestamps` into the real Runtime Context
  via `updateContext()`, called after every stage completes.
- **destroy:** `finalizeWorkflowContext(ctx, workflowStatus, reason)`
  syncs one last time, transitions the Runtime Context to
  `completed`/`failed`/`cancelled` to match the workflow's own outcome,
  then calls `destroyContext()`. This is wired into all four exit
  points of `executeWorkflow()`: normal completion, a required stage
  failing, cancellation mid-loop, and cancellation while paused.

Sync/finalize calls are wrapped in try/catch and only ever `log`+continue
on failure — a Runtime Context sync problem (e.g. a stage produced a
non-JSON-safe result, see FIX 5) can never itself take down a workflow
run. The local `ctx.state`/`outputs`/`timestamps` remain authoritative
for stage execution; Runtime Context is the durable, queryable mirror
of that same data for anything else in the Orchestrator layer.

A workflow that is cancelled via `cancelWorkflow()` before
`executeWorkflow()` is ever called never had a context created for it
in the first place — there is nothing to leak.

### Proof

- `FIX 3: executeWorkflow() creates a real Runtime Context for the run and it is visible mid-flight`
- `FIX 3: a completed workflow's Runtime Context is destroyed (create -> update -> destroy lifecycle)`
- `FIX 3: a failed workflow's Runtime Context is finalized as failed, then destroyed`
- `FIX 3: a cancelled-before-start workflow never leaks an orphaned Runtime Context`
- `FIX 3: exactly one Runtime Context exists at a time per in-flight workflow run`
- Existing Part 4 suite (context propagation between stages, stage
  isolation, dependency ordering, pause/resume/cancel, retry/failover)
  — all still pass unmodified, proving the integration is behavior-
  preserving for every existing consumer of `wf.context`.

---

## FIX 4 — Naming Collision

### The bug

`workflow-planner.js` defined its own `createContext(wf, trigger)` —
unrelated to, but same-named as, `AxiomRuntimeContext.createContext()`.
Anyone reading a stack trace, grepping the codebase, or writing new
code against "the context API" had a real chance of calling or editing
the wrong one.

### The fix

The private helper is renamed to `createWorkflowContext()` (see FIX 3).
There is now exactly one `createContext` function in the codebase:
`AxiomRuntimeContext.createContext()` (also mirrored onto
`AxiomOrchestrator.createContext`). Confirmed by regression test that
statically greps `workflow-planner.js` source for a `createContext`
function definition and asserts none exists.

### Proof

- `FIX 3/4: workflow-planner.js no longer defines its own createContext (no naming collision)`

---

## FIX 5 — Clone Strategy

### The bug

```js
function safeClone(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    // fall back to a shallow copy
    if (Array.isArray(value)) return value.slice();
    var out = {};
    Object.keys(value).forEach(function (k) { out[k] = value[k]; });
    return out;
  }
}
```

Two distinct problems:

1. **The `try` branch doesn't actually catch what it thinks it does.**
   `JSON.stringify()` does not throw for functions or `undefined`
   inside a plain object — it silently *omits* those keys. Inside an
   array, `undefined`/functions are silently replaced with `null`. So
   the "successful" `JSON.parse(JSON.stringify(value))` path could
   already return **quietly corrupted data**, with no error and no
   fallback ever triggered. Only genuinely un-stringifiable input
   (circular references) reliably throws.
2. **The `catch` fallback made things worse, not safer.** A shallow
   copy (`value.slice()` / one level of `Object.assign`-style copy)
   still shares every nested object **by reference** with the original.
   Runtime Context's entire "read-only snapshot" guarantee
   (`getContext()` never returns the live object; `deepFreeze()` locks
   every level) depends on `safeClone()` actually producing an
   independent deep copy. A shallow-copied context slipping through
   into `snapshot()` and then `deepFreeze()` would either throw deep
   inside freeze logic on non-plain-object members, or — worse — freeze
   the top level while leaving nested objects mutable and shared with
   whatever produced them, silently breaking isolation between a
   context and its caller.

### The fix

`safeClone()` now validates the *entire* value shape up front, before
attempting to clone anything, and fails loudly instead of ever
returning corrupted or shared data:

```js
function assertJsonSafe(value, path, seen) {
  path = path || '$';
  if (value === null) return;
  var t = typeof value;
  if (t === 'function' || t === 'symbol' || t === 'bigint') throw jsonSafeError(path, t);
  if (t === 'undefined') throw jsonSafeError(path, 'undefined');
  if (t !== 'object') return; // string / number / boolean — safe
  if (seen.indexOf(value) !== -1) throw jsonSafeError(path, 'circular reference');
  seen = seen.concat([value]);
  if (Array.isArray(value)) {
    value.forEach(function (item, i) { assertJsonSafe(item, path + '[' + i + ']', seen); });
    return;
  }
  Object.keys(value).forEach(function (k) { assertJsonSafe(value[k], path + '.' + k, seen); });
}

function safeClone(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  assertJsonSafe(value, '$', []);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    throw jsonSafeError('$', (err && err.message) || String(err));
  }
}
```

This is the "validate + fail safely" option rather than the
"structured clone" option: **Runtime Context officially supports only
JSON-safe payloads** — plain objects/arrays and
strings/numbers/booleans/`null`. This is now documented in
`RUNTIME_CONTEXT.md` under "Supported payloads." Every call site that
feeds user-supplied data through `safeClone()` (`createContext()`,
`updateContext()`/`mergeInto()`, `cloneContext()`, `createChildContext()`,
`snapshot()`) inherits this validation automatically since they all
funnel through the same function — no per-call-site changes were
needed. A rejected payload throws *before* any partial mutation
happens (e.g. before a rejected child is linked into its parent's
`childIndex`, before a rejected `updateContext()` patch touches live
state), so a caller's existing, valid data is never left half-updated.

`reason` parameters passed to `failContext()`/`cancelContext()`/
`destroyContext()` are written directly into `ctx.metadata` without
going through `safeClone()` at assignment time, but are still subject
to the same validation the next time that context is snapshotted or
cloned — so callers should continue to pass simple strings for `reason`
(as every call site in this codebase already does).

### Proof

- `FIX 5: createContext() fails safely (throws) on a non-JSON-safe state payload instead of corrupting it`
- `FIX 5: updateContext() fails safely (throws) on a circular payload instead of a silent shallow copy` (and confirms the rejected patch never mutated real state)
- `FIX 5: an illegal clone payload never produces a partially-cloned or unfrozen snapshot`
- `FIX 5: createChildContext() propagates the same JSON-safe validation, and a rejected child is never linked into the parent`
- Workflow Planner's `syncWorkflowContext()` catching a real-world
  circular-reference rejection during the existing Part 4 suite
  (visible in `block2-step6-part4-workflow-planner-regression-output.txt`
  as a logged warning, not a failure) is a live demonstration of FIX 5
  operating exactly as designed: reject the bad payload, log it, keep
  the workflow running.

---

## Load-order change (consequence of FIX 3)

`workflow-planner.js` already threw if `AxiomOrchestrator` wasn't
loaded first. It now has the same requirement for `AxiomRuntimeContext`:

```js
var RuntimeContext = global.AxiomRuntimeContext;
if (!RuntimeContext) {
  throw new Error('AxiomWorkflowPlanner requires os/core/runtime-context.js to be loaded before workflow-planner.js.');
}
```

Any future page or bundle that loads `workflow-planner.js` must load
`orchestrator.js` and `runtime-context.js` first (order between those
two doesn't matter to each other, since `runtime-context.js` does not
require `orchestrator.js`, only mirrors onto it if present). No `.html`
file in this project currently references either of these two
`os/core/*.js` files directly (they are pre-wiring library modules, not
yet linked into any page), so this pass makes no UI changes.
