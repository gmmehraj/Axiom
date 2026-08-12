# AXIOM Runtime Context Engine
**Block 2 · Step 6 · Part 5**
**File:** `os/core/runtime-context.js` · **Global:** `window.AxiomRuntimeContext`
(also mirrored onto `window.AxiomOrchestrator` when that module is present)

## 1. What this is, and what it deliberately is not

Every request or workflow that flows through the Orchestrator generates
temporary in-flight data: which step it's on, what a stage produced,
scratch values a handler needs a moment later, whether it's currently
waiting on something. Before this part, nothing owned that data — Workflow
Planner (Part 4) kept a private `wf.context` on its own workflow record,
and Capability Router (Part 3) kept none at all. The Runtime Context
Engine is the missing, subsystem-agnostic home for exactly that class of
state.

It is explicitly **not**:

| It is not... | Because... |
|---|---|
| Permanent Memory (`memory-engine.js`, `memory-manager.js`) | Nothing here is ever written to storage, and Memory never reads from this module. Every context is designed to disappear. |
| Browser History | No navigation, tab, or URL state is modeled here at all. |
| Brain storage | No knowledge graph, no long-term reasoning artifacts. |

If a value needs to outlive the request/workflow that created it, it
belongs in Memory — not here. The Runtime Context Engine's job ends the
moment the work it was tracking ends.

## 2. Architecture

```
window.AxiomRuntimeContext                 window.AxiomOrchestrator (optional)
┌───────────────────────────────┐          ┌───────────────────────────────┐
│ createContext / getContext /   │  mirror  │ same method names installed   │
│ updateContext / cloneContext / │ ───────▶ │ additively, exactly like      │
│ clearContext / destroyContext  │          │ createWorkflow()/route() were │
├───────────────────────────────┤          └───────────────────────────────┘
│ createChildContext             │
│ getChildContexts/getParentCtx  │
├───────────────────────────────┤
│ transitionContext + shorthands │   Storage tiers:
│ (markReady, markRunning, ...)  │     activeById    — live, mutable, in-flight
├───────────────────────────────┤     archivedById  — terminal, TTL-bound, recoverable
│ listContexts/getContextMetrics │     history[]     — bounded audit log, survives DESTROYED
│ getActiveContexts/getHistory   │
├───────────────────────────────┤
│ recoverContext/archiveContext/ │
│ cleanupExpiredContexts         │
└───────────────────────────────┘
```

The module loads standalone — unlike `workflow-planner.js` and
`capability-router.js`, it does **not** throw if `AxiomOrchestrator` isn't
loaded yet, because a runtime context is a smaller, more primitive concept
than a workflow and callers may want it before the rest of the Orchestrator
stack exists. When `AxiomOrchestrator` *is* present, this file installs the
same API onto it (idempotently, same convention as Parts 3 and 4) purely
for convenience — the underlying engine and its storage are singular
either way; there is only ever one `AxiomRuntimeContext`.

Nothing in this file imports, requires, or mutates Browser, Brain, Memory,
Automation, Analytics, or any `.html`/UI file, and it makes no network
calls (no OpenRouter integration). `workflow-planner.js` and
`capability-router.js` are untouched — they are free to start calling
`AxiomOrchestrator.createContext()` etc. in a future part, but this part
does not wire that up for them.

## 3. The context object

```js
const ctx = AxiomRuntimeContext.createContext({
  workflowId: 'wf_123',      // optional — links this context to a Workflow Planner run
  requestId: 'req_456',      // optional — links to a single request/dispatch
  ownerAgent: 'executive',   // optional — which agent is currently driving this context
  metadata: { source: 'chat' },
  state: { step: 0 },
  temporaryData: {},
  timeoutMs: 30000,          // optional — auto-fail if still active after this long
  archiveTtlMs: 300000,      // optional — how long an archived context stays recoverable (default 5 min)
  parentContextId: null      // optional — see Section 5, Isolation
});
```

Every context carries: `contextId`, `workflowId`, `requestId`,
`ownerAgent`, `createdAt`, `updatedAt`, `status`, `metadata`, `state`,
`temporaryData` — plus `parentContextId`/`childContextIds`,
`archivedAt`/`expiresAt` once it leaves the active pool.

### Supported payloads

`metadata`, `state`, and `temporaryData` (and anything passed through
`patch.*` to `updateContext()`) must be **JSON-safe**: plain
objects/arrays and strings/numbers/booleans/`null`. Functions, `symbol`,
`bigint`, `undefined` (as a value inside an object/array), and circular
references are not supported and will cause the call to throw a
descriptive error rather than being silently dropped, nulled, or
shallow-copied by reference. This is deliberate: an earlier
implementation of `safeClone()` fell back to a shallow copy on
non-serializable input, which could hand back live, mutable references
from inside what is supposed to be a frozen, isolated snapshot — a
silent state-corruption bug. Fail loudly and validate up front instead.

## 4. Core API (Part A)

| Function | Purpose |
|---|---|
| `createContext(options)` | Allocate a new isolated context. Returns an immutable snapshot. |
| `getContext(contextId)` | Read the current snapshot (active, archived, or `null` if gone). |
| `updateContext(contextId, patch)` | Shallow-merge `patch.state` / `patch.metadata` / `patch.temporaryData` into the live context; a `patch.status` field is routed through the validated lifecycle transition rather than written directly. |
| `clearContext(contextId)` | Reset `state`/`temporaryData` to `{}` while preserving identity and status — for reusing a context across retries without a full destroy/recreate. |
| `cloneContext(contextId, overrides?)` | Deep-copy a context's data into a brand-new, independent `contextId` — used for parallel branches that must not share mutable state. |
| `destroyContext(contextId, reason?)` | Force-terminate and fully remove a context from every store. Safe no-op if it's already gone. |

`getContext()` (and every other read API) **never** returns the live
object — see Section 6.

## 5. Isolation (Part B)

Every `createContext()` call is fully independent: two contexts created
back-to-back share no object references, and mutating one's `state` can
never be observed by the other (proven in the regression suite — see
`test-evidence/block2-step6-part5-runtime-context-regression-suite.js`,
*"each createContext() call is fully isolated"*).

Parent/child support exists for sub-workflows and branch-outs:

```js
const child = AxiomRuntimeContext.createChildContext(parentContextId, {
  ownerAgent: 'research'
});
```

A child **inherits identity only** (`workflowId` by default, unless
overridden) — it does not inherit `state`/`temporaryData` by reference or
by value. `getChildContexts(parentContextId)` and
`getParentContext(contextId)` walk the relationship in either direction,
and `getContextsByWorkflow(workflowId)` scopes a lookup to everything
tied to one workflow, so contexts belonging to different workflows are
never visible through the same query.

`cloneContext()` provides the other half of isolation — deep duplication
into a new identity for parallel work that needs its own copy of the same
starting data.

## 6. Read-only snapshots (Part D — Synchronization)

`getContext()`, `listContexts()`, `getActiveContexts()`,
`getChildContexts()`, `getParentContext()`, and the return value of every
mutating call are all produced by the same `snapshot()` function: a deep
clone, deep-frozen with `Object.freeze` at every level. Callers — Workflow
Planner, Capability Router, or anything else — can read freely but can
never reach into and mutate the engine's internal state through a
returned object. All reads and writes go through the functions in Section
4; there is no other way to touch a context.

## 7. Monitoring (Part E)

| Function | Returns |
|---|---|
| `listContexts(filter?)` | All active + archived contexts, optionally filtered by `status`, `workflowId`, `requestId`, `ownerAgent`. |
| `getActiveContexts()` | Only contexts still in `CREATED`..`PAUSED` (never terminal-but-not-yet-archived — see `CONTEXT_LIFECYCLE.md`). |
| `getContextMetrics()` | `createdCount`, `destroyedCount`, `completedCount`, `failedCount`, `cancelledCount`, `peakConcurrent`, `active`, `archived`. |
| `getContextHistory(filter?, limit?)` | Bounded (1000-entry), most-recent-first audit log — survives past `DESTROYED`. |
| `getContextStatus(contextId)` | Cheap `{ contextId, status, updatedAt }` lookup without the cost of a full snapshot. |

See `CONTEXT_LIFECYCLE.md` for the state machine and
`CONTEXT_RECOVERY.md` for cleanup/archive/recover semantics (Part F).

## 8. Automatic cleanup (Part F)

`cleanupExpiredContexts()` sweeps `archivedById`, destroying only
contexts whose `archiveTtlMs` has elapsed — it never touches
`activeById`, so an in-flight context is never affected. The engine now
starts a scheduler for this automatically as soon as it loads (it used
to exist but nothing ever called it):

- **Interval:** `AUTO_CLEANUP_INTERVAL_MS` (30s) by default, overridable
  at load time via `window.AXIOM_RUNTIME_CONTEXT_CLEANUP_INTERVAL_MS`,
  and reconfigurable at runtime via `startAutoCleanup(customIntervalMs)`.
- **Safe startup:** guarded by `typeof setInterval === 'function'`, so
  it's a no-op (returns `false`) in an environment without timers rather
  than throwing; the returned handle is `unref()`'d where supported so
  it never holds a Node process open.
- **Safe shutdown:** `stopAutoCleanup()` clears the timer and is
  idempotent — safe to call even if nothing is running.
- **No duplicate timers:** `startAutoCleanup()` always calls
  `stopAutoCleanup()` first, so calling it again (e.g. to change the
  interval) can never result in two timers running concurrently.
- **Status:** `isAutoCleanupRunning()` reports whether the scheduler is
  currently active.

Both are mirrored onto `AxiomOrchestrator` alongside the rest of the API.
