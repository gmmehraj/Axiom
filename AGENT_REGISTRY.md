# AXIOM Orchestrator — Agent Registry
**Block 2 · Step 6 · Part 1** · part of `os/core/orchestrator.js`

## Purpose
The Agent Registry is the Orchestrator's source of truth for "what agents
exist and what can each of them currently do." Any subsystem (or future
provider integration) that wants to receive work through
`AxiomOrchestrator.dispatch()` must register here first.

## Registering an agent

```js
const agent = AxiomOrchestrator.registerAgent({
  id: 'browser',                       // optional — auto-generated if omitted
  name: 'Browser Agent',
  capabilities: ['navigate', 'extract', 'screenshot'],
  permissions: ['browser:read', 'browser:navigate'],
  tools: ['browser.navigate', 'browser.extract'],
  handler: async (task) => {
    // task: { id, agentId, type, payload, priority, attempt, ... }
    return await someRealWork(task.payload);
  }
});
```

- `id` — optional. If omitted, one is generated from `name` + a random
  suffix. Must be unique; registering a duplicate `id` throws.
- `name` — display name. Defaults to `id`.
- `capabilities` — string tags used by `dispatch({ capability: '...' })`
  to find a matching agent when the caller doesn't name one directly.
- `permissions` — string tags describing what the agent is allowed to do.
  The registry stores and reports these; enforcing them against a
  specific action is left to the agent's own handler or a future policy
  layer — the registry's job here is bookkeeping, not an authorization
  engine.
- `tools` (or `supportedTools`) — the concrete tool identifiers this
  agent can execute, for discovery by callers or UI.
- `handler(task)` — **required.** Sync or async. Its return value (or
  resolved value) becomes `task.result` on success; a thrown error or
  rejection becomes `task.error` and drives the retry/failure path.

Registering emits an `agent_registered` event on the Event Bus and
returns a **public snapshot** of the agent record (never the internal
one — see "What's not exposed" below).

## Status vs. Health

Two separate fields, because they answer different questions:

| Field | Values | Answers |
|---|---|---|
| `status` | `idle`, `busy`, `disabled`, `error` | Is this agent currently doing something? |
| `health` | `healthy`, `degraded`, `unhealthy` | Should new work be routed to this agent at all? |

`status` is managed automatically by the scheduler (`idle` → `busy` while
a task runs → back to `idle`). `health` is not inferred automatically
except for one case: a task that times out sets its agent's health to
`degraded`, since a hung handler is itself evidence the agent may not be
reliable right now. Beyond that, agents (or an external monitor) call
`AxiomOrchestrator.setAgentHealth(id, health)` / `setAgentStatus(id,
status)` directly to report their own condition — the registry does not
guess.

`getHealthyAgents()` and capability-based routing (`dispatch({ capability
})`) both filter to `health === 'healthy' && status !== 'disabled'`, so
setting either field is the mechanism for taking an agent out of
rotation without unregistering it.

## Registry API

| Method | Description |
|---|---|
| `registerAgent(config)` | Adds a new agent. Throws on duplicate `id` or missing `handler`. |
| `unregisterAgent(id)` | Removes the agent and **cancels any of its queued/running tasks** (reason: `agent_unregistered`). Emits `agent_removed`. |
| `getAgent(id)` | Returns a public snapshot, or `null`. |
| `listAgents()` | Returns public snapshots of every registered agent. |
| `getHealthyAgents()` | `listAgents()` filtered to healthy, non-disabled agents. |
| `setAgentHealth(id, health)` | Updates `health`. Returns `false` if the agent doesn't exist. |
| `setAgentStatus(id, status)` | Updates `status`. Returns `false` if the agent doesn't exist. |

## What's not exposed

`getAgent()` / `listAgents()` return a **data snapshot**
(`id, name, capabilities, permissions, tools, status, health,
registeredAt, lastActiveAt, stats`) — never the internal record, and
never the `handler` function itself. This means nothing outside the
Scheduler can invoke an agent's handler directly; the only path to
executing an agent's work is through `dispatch()`/`enqueue()`.

## Agent lifecycle summary

```
registerAgent() ──▶ agent_registered event ──▶ idle, healthy
                                                    │
                                    task dispatched to this agent
                                                    ▼
                                                  busy
                                          (handler runs)
                                    ┌───────────────┴───────────────┐
                                success                          failure/timeout
                                    ▼                                 ▼
                                  idle                     idle (+ health: degraded
                                                             if the failure was a timeout)

unregisterAgent() ──▶ pending tasks for this agent cancelled ──▶ agent_removed event
```
