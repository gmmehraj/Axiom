# AXIOM Runtime Context — Lifecycle
**Block 2 · Step 6 · Part 5**
**File:** `os/core/runtime-context.js`

## 1. States

```
CREATED   — just allocated by createContext(); nothing has touched it yet
READY     — validated / about to start work
RUNNING   — actively being used by an agent or workflow stage
WAITING   — parked, waiting on something external (another stage, an
            approval, a timer) without being fully paused
PAUSED    — explicitly suspended, expected to resume
COMPLETED — finished successfully                 ┐
FAILED    — finished with an error                 ├─ terminal
CANCELLED — finished by explicit cancellation      ┘
DESTROYED — fully removed from every store; absolute terminal state
```

## 2. Legal transitions

```
CREATED   ──▶ READY, CANCELLED, FAILED
READY     ──▶ RUNNING, CANCELLED, FAILED
RUNNING   ──▶ WAITING, PAUSED, COMPLETED, FAILED, CANCELLED
WAITING   ──▶ RUNNING, FAILED, CANCELLED
PAUSED    ──▶ RUNNING, CANCELLED, FAILED
COMPLETED ──▶ DESTROYED
FAILED    ──▶ DESTROYED
CANCELLED ──▶ DESTROYED
DESTROYED ──▶ (nothing — absolute terminal state)
```

Every arrow above is the *only* way status ever changes. There is no
direct field write anywhere in the module — even `updateContext(id,
{status: '...'})` routes through the same `transitionContext()` gate
(see `RUNTIME_CONTEXT.md` §4).

## 3. Illegal transitions fail safely

`transitionContext(contextId, toStatus, reason?)` never throws for a bad
request. It returns a result object instead:

```js
AxiomRuntimeContext.transitionContext(ctx.contextId, 'completed');
// context is still in CREATED — completed is not reachable directly from it
// => { success: false, error: 'illegal_transition', contextId, from: 'created', to: 'completed' }
```

Possible `error` values: `not_active` (context doesn't exist or is
already archived/destroyed), `unknown_status` (typo'd status name),
`illegal_transition` (real status, real context, just not a legal edge
from where it currently is). A no-op re-request of the current status
(`from === to`) succeeds trivially (`{ success: true, noop: true }`)
rather than being treated as an error.

Callers that don't care about the failure mode can use the convenience
shorthands, which all return the same result shape:

```js
markReady(contextId)
markRunning(contextId)
markWaiting(contextId, reason?)
pauseContext(contextId, reason?)
resumeContext(contextId)          // PAUSED/WAITING -> RUNNING
completeContext(contextId, result?)
failContext(contextId, reason?)
cancelContext(contextId, reason?)
```

`completeContext(id, result)` additionally merges `{ result }` into
`temporaryData` before transitioning, so the outcome of the work is
attached to the same snapshot a caller reads right after.

## 4. Reaching a terminal status triggers automatic cleanup

The moment a context transitions into `COMPLETED`, `FAILED`, or
`CANCELLED`, the engine immediately archives it (Part F — see
`CONTEXT_RECOVERY.md`) — moved out of the active pool, timers cleared,
metrics counted. This is what "automatically clean itself when tasks
complete" means in practice: no caller has to remember to clean up after
a workflow or a stage finishes, and a forgotten context can never
accumulate in the active pool past its terminal status.

`getActiveContexts()` reflects this immediately: a context is visible
there for `CREATED` through `PAUSED`/`WAITING`, and disappears from it in
the same synchronous call that reaches a terminal state. It remains
readable via `getContext()` (now served from the archive tier) until its
archive TTL expires or it's explicitly destroyed.

## 5. Timeouts

`createContext({ timeoutMs })` schedules a timer. If the context is still
active when the timer fires, it is auto-failed
(`failContext(id, 'timeout')`) — which triggers the same automatic
archival described above. A context that already reached a terminal
status before the timer fires is left alone (the timer is a no-op in
that case, not a double-transition).

## 6. Force-terminating a live context

`destroyContext(contextId, reason?)` can be called on a context in any
non-terminal status. Internally it routes through
`transitionContext(id, 'CANCELLED', reason)` first (never a raw status
write), then proceeds to full removal. This mirrors the same forceful
posture `cancelWorkflow()` uses in Part 4's Workflow Planner. Destroying
one context never touches any other context — sibling and parent
contexts are left exactly as they were (proven in the regression suite:
*"destroyContext() of one context never disturbs a sibling context"*).

See `CONTEXT_RECOVERY.md` for what "archived" actually means, how long
it lasts, and how a context can come back from it.
