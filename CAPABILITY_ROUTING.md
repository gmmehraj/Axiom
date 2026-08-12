# AXIOM Capability Routing — Design & Algorithm
**Block 2 · Step 6 · Part 3**
**File:** `os/core/capability-router.js` · **Global:** `window.AxiomCapabilityRouter`
**Installs onto:** `window.AxiomOrchestrator` (additive only) · **API_VERSION:** `1.0.0`

## 1. What problem this solves

Part 1 built the registry/bus/scheduler. Part 2 populated the registry with
the real subsystems. Neither pass ever decided **who** should handle a
request — `dispatch()`'s capability matching is a single rule ("first
healthy, non-disabled agent with this capability, in registration order")
and nothing tracked *why* an agent was picked, planned the request ahead of
dispatch, or reacted when the chosen agent turned out to be unavailable.

This pass adds that decision layer: the **Capability Router**. Given a loose
request (`{ capability }`, or `{ agentId }`, or a `type` that already
matches a known capability), it deterministically resolves exactly one
agent, turns that decision into an immutable **execution plan**, and pushes
the plan through the **existing** Scheduler via the dispatch pipeline
(`validate → prepare → dispatch → monitor → complete/fail/retry/cancel`).

## 2. Where it sits

```
        caller
          │  AxiomOrchestrator.route({ capability, payload, priority, ... })
          ▼
   ┌───────────────────────────────────────────────────────────┐
   │                     Capability Router                     │
   │  analyzeRequest → resolveCapability → selectAgent          │
   │       → resolvePriority → resolveExecutionPlan (frozen)    │
   └───────────────────────────┬───────────────────────────────┘
                                │ immutable ExecutionPlan
                                ▼
   ┌───────────────────────────────────────────────────────────┐
   │                     Dispatch Pipeline                     │
   │   validate → prepare → dispatch(enqueue) → monitor         │
   │        ▲                                    │              │
   │        └──────── retry / alternate-agent ────┘ (Part F)    │
   └───────────────────────────┬───────────────────────────────┘
                                │ AxiomOrchestrator.enqueue()  (Part 1, unchanged)
                                ▼
                         Task Scheduler (Part 1)
                                │ agent.handler(task)
                                ▼
                     registered agent (Browser/Brain/Memory/
                     Automation/Analytics/... or any future agent)
```

The Router never calls a subsystem, never calls a handler, and never
enqueues anything except through `AxiomOrchestrator.enqueue()` — the same
public entry point the Scheduler itself exposes. `os/core/orchestrator.js`
and `os/core/agent-registry-integration.js` are not edited; every function
below is installed onto the existing `AxiomOrchestrator` object from the
outside, the same convention Part 2 used for its discovery API.

## 3. Capability Router (Part A)

| Function | Responsibility |
|---|---|
| `analyzeRequest(request)` | Normalizes a loose request into a stable shape (`requestId`, `agentId`, `capability`, `type`, `payload`, `requiredPermission`, retry/timeout/priority hints, `allowFailover`, `excludeAgents`). Throws a **structural** error only if the request is missing every one of `agentId`/`capability`/`type`. |
| `resolveCapability(analyzed)` | If `capability` was given, use it. If an explicit `agentId` was given, no capability lookup is needed. Otherwise, if `type` matches a capability already advertised by *some* registered agent (read from `AxiomOrchestrator.listAgents()` — never a hardcoded list), that `type` is treated as the capability. Otherwise throws a structural error. |
| `selectAgent(capability, options)` | Deterministic selection among every agent exposing `capability` — see §4. |
| `resolvePriority(analyzed)` | Normalizes the request's `priority` hint into the Scheduler's numeric convention, defaulting to `0` and clamping to `[-100, 100]` rather than letting a bad value silently corrupt queue order. |
| `resolveExecutionPlan(request)` | The single entry point that runs the four functions above and freezes the result into an `ExecutionPlan` — see §5. |

**No hardcoded subsystem references.** Every one of these functions reads
`AxiomOrchestrator.listAgents()` (directly, or via `discoverAgents()` when
Part 2 is loaded) to make its decision. Nothing in `capability-router.js`
contains the literal string `"browser"`, `"brain"`, etc.

## 4. Agent Selection Strategy (Part D)

`selectAgent(capability, { excludeAgents, requiredPermission })` is used
both for the initial routing decision and for Part F's failover. It is
**never random**. Candidates come from every agent advertising
`capability`; a candidate is **eligible** only if all of the following
hold:

1. not in `excludeAgents` (used by failover to avoid re-picking an agent
   that already failed for this request),
2. `status !== 'disabled'`,
3. `health !== 'unhealthy'` (a `'degraded'` agent is still eligible — it is
   simply ranked behind a healthy one, not excluded outright),
4. it has `requiredPermission`, if one was specified (exact match, or a
   granted permission ending in `:*` whose prefix matches, e.g.
   `"browser:*"` satisfies a required `"browser:navigate"`).

Eligible candidates are then sorted, in order, by:

1. **health** — `healthy` before `degraded`,
2. **availability** — `idle` before `busy` before `error`,
3. **current workload** — fewer `queued + running` tasks currently
   assigned to that agent (read live from `AxiomOrchestrator.listTasks()`),
4. **priority** — a router-local weight set via
   `AxiomOrchestrator.setAgentPriority(id, n)` (default `0`, higher wins;
   this is Router-owned metadata layered on top of the registry, not a
   field added to the Agent Registry's own record shape — orchestrator.js
   stays untouched),
5. **agent id, lexical order** — the final, fully deterministic tiebreaker.

The first agent after sorting is selected. If the eligible list is empty,
`selectAgent()` returns `null` and the caller (either `resolveExecutionPlan`
or Part F's failover) decides what happens next — see §7.

## 5. Execution Plan shape (Part B)

```js
{
  requestId:       'req-<ts>-<n>',
  agentId:         'browser',
  capability:      'navigate' | null,   // null only for explicit-agentId plans
  type:            'navigate',
  payload:         { url: '...' },
  priority:        0,                   // resolved, clamped
  timeout:         30000,
  retryPolicy:     { maxRetries: 1, retryDelay: 500 },   // frozen
  executionPath:   [ { step:'capability_router', ... },
                      { step:'agent_selected', agentId:'browser' },
                      { step:'scheduler_enqueue' } ],     // frozen
  allowFailover:   true,                // false for explicit-agentId requests
  excludeAgents:   [],                  // frozen
  requiredPermission: null,
  createdAt:       1735699200000
}
```

The plan object itself, `retryPolicy`, and `executionPath` are all
`Object.freeze()`d. A plan is built once by `resolveExecutionPlan()` and is
never mutated afterward — Part F's failover builds a **new** plan (merging
in the original's capability/failover-eligibility/tried-agent history) and
replaces the record's plan pointer; it does not write into the frozen
object. See `EXECUTION_PIPELINE.md` for the full request lifecycle this
plan flows through.

## 6. Defaults & bounds

| Setting | Default | Notes |
|---|---|---|
| `priority` | `0` | Clamped to `[-100, 100]`. |
| `timeout` | `30000` ms | Same default as the Part 1 Scheduler. |
| `maxRetries` | `1` | Same-agent retry, handled by the Part 1 Scheduler before a `task_failed` ever reaches the Router. |
| `retryDelay` | `500` ms | |
| `allowFailover` | `true` | Forced to `false` whenever the request pinned an explicit `agentId` — an explicit target is a caller decision the Router does not second-guess. |
| Max failover hops | `2` | See `EXECUTION_PIPELINE.md` §5 (Error Routing). |

## 7. Error routing summary

`selectAgent()` finding no eligible candidate, or an explicit `agentId`
that is not registered, are **not** treated as caller bugs — they are
routing/availability outcomes. `AxiomOrchestrator.route()` catches them and
returns a standardized `{ accepted: false, requestId, error }` result
instead of throwing. Only a structurally invalid request (no `agentId`, no
`capability`, and no resolvable `type` at all) throws synchronously, the
same posture `AxiomOrchestrator.dispatch()` already has today. Full detail
in `EXECUTION_PIPELINE.md` §5.
