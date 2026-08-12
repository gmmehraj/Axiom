# AXIOM Orchestrator — Architecture
**Block 2 · Step 6 · Part 1**
**File:** `os/core/orchestrator.js` · **Global:** `window.AxiomOrchestrator` · **API_VERSION:** `1.0.0`

## 1. What problem this solves

Before this pass, every AXIOM subsystem was its own independent global —
`AxiomBrain`, `AxiomMemoryEngine`, `AxiomAutomationManager`,
`AxiomBrowserManager` — plus a set of point-to-point bridge files
(`browser-brain-bridge.js`, `automation-memory-bridge.js`, etc.) that wire
exactly two of those globals together. That works, but it has two costs:

- **No single place to ask "what can run right now?"** A caller has to
  already know which specific global owns the capability it wants.
- **No shared execution policy.** Priority, timeout, retry, and
  cancellation were each subsystem's own problem, if they existed at all.

The Orchestrator is a coordination layer that sits **above** the existing
subsystems. It does not replace or modify any of them — Browser, Brain,
Memory, and Automation are frozen, untouched, and remain fully usable
directly, exactly as before.

## 2. Where it sits

```
        ┌─────────────────────────────────────────────┐
        │                 AxiomOrchestrator             │
        │  ┌───────────┐ ┌───────────┐ ┌─────────────┐  │
        │  │  Agent    │ │  Event    │ │   Task      │  │
        │  │  Registry │ │  Bus      │ │   Scheduler │  │
        │  └───────────┘ └───────────┘ └─────────────┘  │
        └───────────────────────┬───────────────────────┘
                                 │ agent.handler(task)
        ┌────────────┬──────────┼──────────┬────────────┐
        │            │          │          │            │
   AxiomBrain  AxiomMemory  AxiomAutomation  AxiomBrowser  (future agents:
   (untouched) Engine        Manager          Manager       OpenRouter, etc.)
               (untouched)   (untouched)      (untouched)
```

Any subsystem — or any future agent — that wants to participate in
orchestration registers itself as an **agent** with a `handler(task)`
function. The Orchestrator never reaches into a subsystem's internals; it
only ever calls the handler the subsystem chose to expose.

## 3. Core components

### 3.1 Orchestrator Core (Part A)
The public surface (`init`, `dispatch`, `startup`, `shutdown`, plus the
registry/bus/scheduler methods re-exported on the same object). `dispatch()`
is the one call every subsystem should route through instead of calling
another subsystem's global directly:

```js
AxiomOrchestrator.dispatch({
  agentId: 'browser',        // or: capability: 'navigate'
  type: 'navigate',
  payload: { url: 'https://example.com' },
  priority: 5,
  timeout: 15000,
  maxRetries: 1
});
```

`dispatch()` resolves an `agentId` (explicit, or by matching `capability`
against registered agents' `capabilities` lists, preferring a healthy,
non-disabled agent) and hands the request to the Task Scheduler. It never
calls a handler itself.

### 3.2 Agent Registry (Part B) — see `AGENT_REGISTRY.md`
Agents register with an id, name, capabilities, permissions, supported
tools, status, and health. The registry is the source of truth for
"what agents exist" and "which of them are currently able to do work."

### 3.3 Event Bus (Part C) — see `EVENT_BUS.md`
A small in-process pub/sub (`emit`/`on`/`off`/`once`) independent of the
DOM. Every lifecycle event (task started/completed/failed, agent
registered/removed, startup/shutdown) is delivered through it.

### 3.4 Task Scheduler (Part D)
Every dispatched request becomes a task and is **enqueued**, never run
inline. A drain loop (deferred via `setTimeout(..., 0)`, not called
synchronously from `dispatch()`) pulls the highest-priority queued task
and invokes its agent's handler. Supports:

- `priority` — higher runs first; ties are FIFO.
- `timeout` — a task that doesn't settle in time is marked `timed_out`.
- `maxRetries` / `retryDelay` — a failed or timed-out task is
  automatically re-queued up to `maxRetries` times before being marked
  `failed` for good.
- `cancel(taskId)` — removes a queued task, or marks a running one
  cancelled so its eventual settlement is ignored.
- `retry(taskId)` — manually re-queue a task that finished `failed` or
  `timed_out`.

### 3.5 Runtime Lifecycle (Part E)
`startup()` and `shutdown()` control whether `dispatch()` accepts new work.
`shutdown()` cancels every agent's in-flight/queued tasks before flipping
state, so nothing is silently orphaned. Both are idempotent. The module
auto-calls `startup()` on load (same convention as `AxiomBrain`), so pages
that only ever call `dispatch()`/`registerAgent()` don't need to remember
an init step; pages that want to pre-register a fixed agent set can call
`AxiomOrchestrator.init({ agents: [...] })` instead.

## 4. Task lifecycle (state machine)

```
        enqueue()
           │
           ▼
       ┌────────┐   handler resolves            ┌───────────┐
       │ queued │ ─────────────────────────────▶ │ completed │
       └────────┘                                 └───────────┘
           │  scheduler picks it up
           ▼
       ┌────────┐   handler throws/rejects,
       │running │   attempt > maxRetries         ┌────────┐
       └────────┘ ─────────────────────────────▶ │ failed │
           │                                      └────────┘
           │  timeout elapses, attempt > maxRetries
           │─────────────────────────────────────▶ ┌───────────┐
           │                                        │ timed_out │
           │                                        └───────────┘
           │  handler throws/rejects/times out,
           │  attempt <= maxRetries
           └───────────────────▶ back to queued (after retryDelay)

  cancel(taskId) at any point before a terminal state ──▶ cancelled
```

## 5. Design decisions worth calling out

- **Nothing executes synchronously inside `dispatch()`.** This was an
  explicit spec requirement ("do not execute tasks immediately") and is
  verified by regression test (a task is still `queued`/`running`, never
  `completed`, in the same tick `dispatch()` returns).
- **The scheduler cannot force-kill a running promise.** JavaScript has
  no primitive for that. `cancel()` on a running task marks it cancelled
  and the scheduler ignores its eventual resolution/rejection — no
  `task_completed`/`task_failed` fires for a cancelled task — but the
  handler's own code keeps running to completion in the background. Agent
  authors whose work is genuinely abortable should honor an
  `AbortSignal`-style convention inside their own handler if they need
  true cancellation; this is a documented extension point, not something
  the Orchestrator can guarantee generically.
- **Public agent/task objects never expose the raw handler function** —
  `getAgent()`/`listAgents()` return data snapshots only, so nothing
  outside the registry can invoke an agent's handler except the
  scheduler itself.
- **A misbehaving event-bus listener can't break `emit()`** — each
  listener call is wrapped individually; an exception is logged via
  `reportError()` and iteration continues.

## 6. Extension points for future AI providers (OpenRouter, etc.)

Per this phase's explicit scope, **no AI-provider integration is included
here.** The Orchestrator was designed so that adding one later is a
pure *addition*, not a change to this file:

1. **Register it as an agent.** A future `OpenRouterAgent` module would
   call `AxiomOrchestrator.registerAgent({ id: 'openrouter', capabilities:
   ['chat-completion', 'tool-call'], handler: async (task) => { ... } })`
   from its own file — `orchestrator.js` needs no edits.
2. **Route existing AI calls through `dispatch({ capability:
   'chat-completion', ... })`** instead of calling
   `js/core/openrouter-client.js` directly, once that migration is in
   scope. Until then, `openrouter-client.js` is untouched and keeps
   working exactly as it does today.
3. **Health/permissions are already modeled.** A provider agent can
   report `health: 'degraded'` (e.g. on rate-limit) via
   `setAgentHealth()`, and `getHealthyAgents()`/capability-routing will
   automatically stop selecting it until it recovers.
4. **Task timeout/retry are already generic.** Network-bound provider
   calls are exactly the kind of task this scheduler's timeout/retry
   support was built for.

## 7. Explicitly out of scope for this pass

- No OpenRouter or any other AI-provider wiring.
- No UI changes — no `.html` file references `orchestrator.js` yet; wiring
  it into pages is a future integration step, matching how prior
  foundation-then-integration passes in this project were sequenced.
- No changes to Browser Engine, Brain, Memory, or Automation internals.
  Those subsystems can still be called directly exactly as before; nothing
  about their existing behavior changed.
