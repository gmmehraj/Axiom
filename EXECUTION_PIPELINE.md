# AXIOM Execution Pipeline — Dispatch, Monitoring & Error Routing
**Block 2 · Step 6 · Part 3**
**File:** `os/core/capability-router.js` · **Global:** `window.AxiomCapabilityRouter`
**Installs onto:** `window.AxiomOrchestrator` (additive only) · **API_VERSION:** `1.0.0`

Companion to `CAPABILITY_ROUTING.md` (how an agent is chosen) and
`TASK_SCHEDULER.md` (how the underlying Part 1 Scheduler executes a task).
This document covers what happens to a request **after** an
`ExecutionPlan` exists: the dispatch pipeline, request-level monitoring, and
error routing / failover.

## 1. Public entry point

```js
const outcome = AxiomOrchestrator.route({
  capability: 'navigate',            // or: agentId: 'browser'
  payload: { url: 'https://example.com' },
  priority: 5,
  timeout: 15000,
  maxRetries: 1,
  requiredPermission: 'browser:navigate',   // optional
  allowFailover: true                       // default true; forced false for explicit agentId
});
// -> { accepted: true, requestId, taskId, agentId, plan }
// -> { accepted: false, requestId, error }   (never throws for routing/availability outcomes)
```

`route()` is the whole pipeline in one call: Capability Router
(`CAPABILITY_ROUTING.md`) → Execution Planner → Dispatch Pipeline below.
The six pipeline stages are also individually addressable for callers that
want to plan and dispatch as separate steps:

| Stage | Function | Does |
|---|---|---|
| validate | `AxiomOrchestrator.validateExecutionPlan(plan)` | Re-checks the plan's agent still exists, isn't disabled/unhealthy, and still has any required permission — an agent can go stale in the window between planning and dispatch. |
| prepare | `AxiomOrchestrator.prepareExecutionPlan(plan)` | Maps the immutable plan onto the mutable request shape `AxiomOrchestrator.enqueue()` expects. Never mutates the plan. |
| dispatch | *(internal `dispatchPlan`, driven by `route()`)* | The **only** place this module hands work to the Scheduler, and it always goes through `AxiomOrchestrator.enqueue()` — never a private/bypassed path. |
| monitor | `AxiomOrchestrator.monitorRequest(requestId)` / `getTaskStatus(requestId)` | Point-in-time status, cross-referencing the Scheduler's own task record so there is one source of truth. |
| complete / fail | *(internal, reactive)* | The Router never polls. It subscribes once to the Scheduler's own `task_started`/`task_completed`/`task_failed` events and updates its own request record from them. |
| retry | `AxiomOrchestrator.retryRequest(requestId)` | Explicit, caller-initiated re-plan of a finished (`failed`/`cancelled`) request — see §4. |
| cancel | `AxiomOrchestrator.cancelRequest(requestId, reason)` | Cancels the underlying task through the Scheduler's own `cancel()` — never a bypass — and marks the request terminal. |

## 2. Request lifecycle (state machine)

```
        route()
           │
   resolveExecutionPlan() throws (structural)? ──▶ rethrown to caller (caller bug)
           │  no
           ▼
       ┌─────────┐  validate() fails / enqueue() throws
       │ planned │ ─────────────────────────────────▶ standardized { accepted:false } (Part F)
       └─────────┘
           │  enqueue() succeeds
           ▼
       ┌────────┐   task_completed (from Scheduler)
       │ queued │ ───────────────────────────────────▶ ┌───────────┐
       └────────┘                                       │ completed │
           │  task_started (from Scheduler)              └───────────┘
           ▼
       ┌────────┐   task_failed, failover succeeds
       │running │ ───────────────────────────────────▶ back to queued (new agent, new task)
       └────────┘
           │  task_failed, no failover attempted/possible
           ▼
       ┌────────┐
       │ failed │ ──▶ retryRequest(requestId) ──▶ back to planned (new plan, may reuse the
       └────────┘                                  same agent or resolve a different one)

  cancelRequest(requestId) at any point before a terminal state ──▶ cancelled
```

Every non-terminal → terminal transition is driven by the Part 1 Scheduler's
own lifecycle events (`task_started`, `task_completed`, `task_failed`) —
the Router reacts to them via `AxiomOrchestrator.on(...)`, it never
re-implements queueing, timeouts, or same-agent retries. Same-agent
`maxRetries` (Part 1's own retry loop) always runs to exhaustion **before**
`task_failed` ever reaches the Router; everything described here as
"failover" or "retry" operates one level above that, only after Part 1 has
already given up on the originally-selected agent.

## 3. Runtime monitoring (Part E)

| Function | Returns |
|---|---|
| `getTaskStatus(requestId)` | `{ requestId, agentId, capability, taskId, status, task, failoverCount, triedAgents }` — `status` is the request-level state above; `task` is the Scheduler's own task record for cross-checking. |
| `getTaskMetrics()` | Running counters: `queued, running, completed, failed, retried, cancelled, failedOver, totalRequests`. |
| `getExecutionHistory(limit)` | Finished requests (`completed`/`failed`/`cancelled`), most recent first, bounded to the last 500 in memory; `limit` trims further. |
| `getQueueStatus()` | Per-agent `{ agentId, health, status, queued, running }`, computed live from `AxiomOrchestrator.listTasks()` (never a separate, driftable counter), plus the Scheduler's own aggregate `getStats().tasks`. |

All four are read-only and built entirely out of Part 1's already-public
`getTask`/`listTasks`/`listAgents`/`getStats` — no private Scheduler state
is reached into.

## 4. Retry vs. failover — two different mechanisms

It is worth being explicit that there are **two** retry-like behaviors in
this system, at two different layers:

- **Scheduler-level retry (Part 1, unchanged):** `maxRetries`/`retryDelay`
  on the task itself. Same agent, same task id, automatic, happens before
  `task_failed` is ever emitted. This is what `EXECUTION_PIPELINE.md`'s
  state diagram glosses over inside the `running` box.
- **Router-level retry (`retryRequest`, this module):** explicit,
  caller-initiated, re-runs the **planner** from scratch. For a
  capability-based request this can land on a different agent than the one
  that originally failed (a newly-healthy or newly-registered one is fair
  game); for an explicit-`agentId` request it stays pinned to that same
  agent, since the caller asked for it by name.
- **Failover (Part F, automatic):** happens *instead of* a router-level
  retry, at the moment a `task_failed` event arrives, without the caller
  having to do anything — see §5.

## 5. Error routing (Part F)

When the Scheduler reports `task_failed` for a request the Router is
tracking, and the request was cancelled by the caller, nothing further
happens (the cancellation already recorded its own terminal state). For any
other failure, the Router attempts:

1. **Alternate healthy agent.** If `plan.allowFailover` is true (i.e. the
   original request was capability-based, not pinned to an explicit
   `agentId`) and the request hasn't already used up its failover budget,
   `selectAgent(capability, { excludeAgents: triedAgents })` runs again,
   excluding every agent already tried for this request. If a candidate is
   found, a fresh `ExecutionPlan` is built and dispatched through the same
   `validate → enqueue` path — no bypass — and the request stays
   non-terminal (`queued` again) while the new attempt runs.
2. **Failover budget.** Capped at **2 hops** per request
   (`MAX_FAILOVER_HOPS`), so a capability with every agent simultaneously
   broken fails out in bounded time rather than looping.
3. **Graceful failure.** If failover isn't allowed, the budget is
   exhausted, or no alternate eligible agent exists, the request is marked
   `failed` with the triggering reason recorded, `getTaskMetrics().failed`
   is incremented, and a `route_failed` event is emitted on the Event Bus.
   No exception is thrown and the Orchestrator's own runtime state is
   never touched — a broken agent can never crash the Orchestrator or any
   other in-flight request.

`getTaskStatus(requestId).failoverCount` and `.triedAgents` make the whole
history inspectable after the fact, and every hop is also appended to the
(frozen, per-hop) `plan.executionPath` so `getExecutionHistory()` retains a
full trail, not just the final outcome.

## 6. Explicitly out of scope for this pass

- No OpenRouter or any other AI-provider wiring.
- No UI changes — no `.html` file references `capability-router.js`.
- No changes to Browser, Brain, Memory, Automation, Analytics, or System
  internals, and no changes to `os/core/orchestrator.js` or
  `os/core/agent-registry-integration.js`. Every capability in this
  document is installed onto the existing `AxiomOrchestrator` object from
  the outside, so Part 1's and Part 2's files and regression suites remain
  valid and untouched.
