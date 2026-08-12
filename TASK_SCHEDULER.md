# AXIOM Task Scheduler — How Part 3 Uses It
**Block 2 · Step 6 · Part 3**
**Underlying Scheduler:** `os/core/orchestrator.js` (Part 1, unchanged) · **Global:** `window.AxiomOrchestrator`

This document is the Part 3 companion to `ORCHESTRATOR_ARCHITECTURE.md`
§3.4 (which remains the canonical description of the Scheduler itself, and
is not repeated in full here). It covers exactly one thing: **how the
Capability Router and Dispatch Pipeline use the existing Scheduler**, and
why nothing about the Scheduler's own contract needed to change to support
capability routing.

## 1. The Scheduler's contract, unchanged

Every task, regardless of whether it arrived via the old
`AxiomOrchestrator.dispatch({ agentId | capability, ... })` or the new
`AxiomOrchestrator.route({ agentId | capability, ... })`, ends up as one
call to:

```js
AxiomOrchestrator.enqueue({ agentId, type, payload, priority, timeout, maxRetries, retryDelay })
```

`enqueue()` is the **only** function in the entire codebase that pushes
work into the Scheduler's priority queue. Part 3 does not add a second
queue, a second drain loop, or a second execution path — `prepareExecutionPlan(plan)`
exists specifically to turn an immutable `ExecutionPlan` into exactly the
request shape `enqueue()` already expects, and `route()` calls `enqueue()`
directly (not `dispatch()`, to avoid re-running agent resolution the Router
already did — see §2).

## 2. Why `route()` calls `enqueue()`, not `dispatch()`

`AxiomOrchestrator.dispatch()` (Part 1) already does its own agent
resolution (`resolveAgentId`) before calling `enqueue()`. The Capability
Router's whole job is to make a *better* version of that same decision
(deterministic multi-criteria selection instead of "first healthy match in
registration order", immutable plans, failover). Calling `dispatch()` from
inside `route()` would mean resolving the agent twice, with two different
algorithms, and risking the second resolution silently overriding the
Router's decision. Instead, `route()` resolves the agent exactly once
(`resolveExecutionPlan`), then calls `enqueue()` directly with the already-
decided `agentId` — still the Scheduler's own public entry point, still
enqueued (never executed inline), just without a redundant second
resolution pass. `AxiomOrchestrator.dispatch()` itself is completely
untouched and keeps working exactly as it did after Part 1 for any caller
that doesn't need capability routing.

## 3. What the Scheduler still owns entirely

Nothing here changes:

- **Priority-ordered insertion and FIFO tie-breaking** within the queue.
- **The drain loop** — deferred via `setTimeout(..., 0)`, never synchronous
  inside `enqueue()`/`route()`.
- **Timeout enforcement** per task.
- **Same-agent retry** (`maxRetries`/`retryDelay`) — this always runs to
  exhaustion *inside* the Scheduler before a `task_failed` lifecycle event
  is ever emitted. The Router only ever sees a task as failed after Part
  1 has already given up on retrying it against the same agent.
- **Cancellation semantics** — a running task can't be force-killed (no JS
  primitive for that); `cancel()` marks it cancelled and its eventual
  settlement is ignored. `AxiomOrchestrator.cancelRequest()` (Part 3) is a
  thin wrapper that calls the Scheduler's own `cancel(taskId, reason)` and
  then updates the Router's own request-level bookkeeping — it does not
  reimplement cancellation.

## 4. What Part 3 adds *around* the Scheduler, not inside it

| Part 3 concept | Scheduler equivalent | Relationship |
|---|---|---|
| `requestId` | `taskId` | 1:1 at creation; a capability-based failover creates a **new** `taskId` for the **same** `requestId`, so a request can span more than one task over its lifetime — the Scheduler has no concept of "request", only "task". |
| Router-level retry (`retryRequest`) | Scheduler-level retry (`maxRetries`) | Router-level retry re-runs the *planner* (can pick a new agent); Scheduler-level retry always re-runs the *same* task against the *same* agent. See `EXECUTION_PIPELINE.md` §4. |
| Failover (Part F) | — (no equivalent) | New concept, layered entirely on top: on `task_failed`, the Router may enqueue a brand-new task at a different agent before marking the request terminal. |
| `getQueueStatus()` | `getStats().tasks` | Adds a per-agent breakdown, computed live via `listTasks({ agentId, status })` — no separate counters that could drift from the Scheduler's own state. |

## 5. Scheduler flow with capability routing (sequence)

```
route(request)
   │
   ├─ resolveExecutionPlan(request)      [Capability Router, Part A/B]
   │
   ├─ validate(plan)                     [Dispatch Pipeline, Part C]
   │     └─ fails ──▶ standardized { accepted:false } (Part F), Scheduler never touched
   │
   ├─ prepare(plan) → enqueue(...)       [Dispatch Pipeline → Scheduler, Part 1]
   │     └─ Scheduler: insertByPriority → (deferred) drain → runTask
   │
   ├─ Scheduler emits task_started       ──▶ Router marks request 'running'
   │
   ├─ Scheduler emits task_completed     ──▶ Router marks request 'completed', done
   │        or
   └─ Scheduler emits task_failed        ──▶ Router attempts failover (Part F):
            (only after Part 1's own          success ──▶ new enqueue() at a different
             maxRetries is exhausted)                      agentId, request stays non-terminal
                                                  no alternate ──▶ request marked 'failed'
```

## 6. Explicitly out of scope for this pass

- No change to the Scheduler's priority/timeout/retry/cancel semantics.
- No second queue and no second drain loop.
- No UI changes — no `.html` file references `capability-router.js`.
