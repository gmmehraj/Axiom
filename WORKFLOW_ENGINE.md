# AXIOM Workflow Engine — Design & Lifecycle
**Block 2 · Step 6 · Part 4**
**File:** `os/core/workflow-planner.js` · **Global:** `window.AxiomWorkflowPlanner`
**Installs onto:** `window.AxiomOrchestrator` (additive only) · **API_VERSION:** `1.0.0`
**Depends on:** `os/core/orchestrator.js` (hard) · `os/core/capability-router.js` (soft — used when present, falls back to `AxiomOrchestrator.dispatch()` otherwise)

## 1. What problem this solves

Parts 1–3 gave one request a real journey through the system — registry
lookup, capability resolution, an immutable execution plan, a dispatch
pipeline with retry/failover, and monitoring — but that journey always
ended at exactly one agent producing exactly one result. Nothing in the
Orchestrator understood a *multi-step* request: "have Research look
something up, then have Browser fetch a page, then have Memory save it,
then have Executive summarize what happened."

The Workflow Engine is that missing piece. A **workflow** is a named,
ordered collection of **stages**; each stage is routed through the same
`AxiomOrchestrator.route()`/`dispatch()` entry point any single request
would use, so a workflow is not a new execution mechanism, it's a
coordinator that calls the existing one repeatedly, in dependency order,
threading a shared **Workflow Context** through each call.

## 2. Where it sits

```
        caller
          │  AxiomOrchestrator.createWorkflow({ stages: [...] })
          ▼
   ┌────────────────────────────────────────────────────────────┐
   │                      Workflow Planner                      │
   │   createWorkflow → validateWorkflow → optimizeWorkflow      │
   │            (Part A: structural validation, dependency        │
   │             resolution / cycle detection, wave planning)     │
   └───────────────────────────┬────────────────────────────────┘
                                │ AxiomOrchestrator.executeWorkflow(id, trigger)
                                ▼
   ┌────────────────────────────────────────────────────────────┐
   │                    Workflow Execution Loop                  │
   │  for each stage, in dependency order:                       │
   │    input(context) → routeStage() → awaitStageOutcome()      │
   │         │                                    │               │
   │         │                     retry / alt-agent / skip       │
   │         │                          (Part F recovery)         │
   │         ▼                                    │               │
   │    AxiomOrchestrator.route()  ◄───────────────┘              │
   │      (Part 3, or dispatch() fallback — Part 1)               │
   └───────────────────────────┬────────────────────────────────┘
                                │ agent.handler(task)  — one agent, isolated
                                ▼
                      registered agent (Executive/Research/
                      Browser/Memory/... or any future agent)
```

The Workflow Planner never calls an agent handler directly and never
enqueues anything except through `AxiomOrchestrator.route()`/`dispatch()`.
`os/core/orchestrator.js` and `os/core/capability-router.js` are not
edited; every function below is installed onto the existing
`AxiomOrchestrator` object from the outside, the same convention Part 3
used for its routing API.

## 3. Workflow lifecycle

```
created ──validateWorkflow()──► validated
   │                                │
   └──────────────executeWorkflow()─┤
                                     ▼
                                  running ──pauseWorkflow()──► paused
                                     │  ▲                         │
                                     │  └─────resumeWorkflow()────┘
                                     │
                     ┌───────────────┼────────────────┐
                     ▼               ▼                ▼
                completed         failed          cancelled
```

- **created** — `createWorkflow()` has structurally validated the stage
  graph (no duplicate ids, no `dependsOn` targets that don't exist, no
  cycles) but nothing has run yet.
- **validated** — `validateWorkflow()` additionally confirmed every stage
  can currently resolve to *some* agent (an explicit `agentId` that's
  registered, or at least one agent offering the stage's `capability`).
  This is advisory: health/permission are still re-checked live by the
  Capability Router at each stage's actual dispatch time, since those can
  change between validation and execution.
- **running** — `executeWorkflow()` is walking the dependency-resolved
  stage order one stage at a time.
- **paused** — `pauseWorkflow()` was called; the execution loop parks
  between stage boundaries (never mid-stage) until `resumeWorkflow()` or
  `cancelWorkflow()`.
- **completed** — every stage reached `completed` or `skipped`.
- **failed** — a required (non-optional) stage exhausted Part F recovery;
  all not-yet-run stages are marked `skipped` and the workflow stops.
- **cancelled** — `cancelWorkflow()` was called; in-flight stages finish
  naturally (cooperative cancellation, checked at stage boundaries) and all
  remaining stages are marked `cancelled`.

## 4. Public API

| Function | Part | Responsibility |
|---|---|---|
| `createWorkflow(definition)` | A | Registers a new workflow; validates stage-graph structure up front. |
| `validateWorkflow(id)` | A | Re-checks structure + that every stage can currently resolve an agent. |
| `optimizeWorkflow(id)` | A | Computes the dependency-resolved order and independent execution "waves". |
| `executeWorkflow(id, trigger)` | A/B/D/F | Runs the workflow to a terminal state; returns a full snapshot. |
| `pauseWorkflow(id)` | A | Requests a pause at the next stage boundary. |
| `resumeWorkflow(id)` | A | Wakes a paused workflow back up. |
| `cancelWorkflow(id, reason?)` | A | Requests cancellation; resolves immediately if not yet running. |
| `getWorkflow(id)` | E | Full point-in-time snapshot (status, per-stage state, context). |
| `listWorkflows(filter?)` | E | All workflows, optionally filtered by status. |
| `getWorkflowStatus(id)` | E | Per-stage status counts for one workflow. |
| `getWorkflowMetrics()` | E | Aggregate workflow/stage counts across every workflow ever created. |
| `getActiveWorkflows()` | E | Workflows currently `running` or `paused`. |

See `MULTI_AGENT_COLLABORATION.md` for the stage/agent-isolation model, and
`WORKFLOW_CONTEXT.md` for the Workflow Context shape and propagation rules.

## 5. Dependency resolution (Part D)

Every stage may declare `dependsOn: [stageId, ...]`. `createWorkflow()` runs
a topological sort (`topologicalOrder()`) over the stage graph:

- **Unknown dependency** — a `dependsOn` entry that doesn't match any
  stage id throws a structural error immediately, before the workflow is
  even stored.
- **Circular dependency** — detected via a standard three-color
  (unvisited/visiting/done) DFS; a cycle throws with the exact cycle path
  in the error message (`a -> b -> a`) rather than hanging or silently
  dropping stages.
- **Execution order** — the sorted order is what `executeWorkflow()` walks
  sequentially. `optimizeWorkflow()` additionally groups that same order
  into "waves" — stages with no dependency relationship to each other —
  purely for inspection; see §7.

`requiredCapabilities`/`optionalCapabilities` on a stage (accepted by
`createWorkflow()`, not yet consumed as extra eligibility filters beyond
the primary `capability`/`agentId`) are reserved fields for a future
capability-router integration where a stage can demand more than one
capability from the same agent; documented here as a known extension
point, not implemented in this pass.

## 6. Failure recovery (Part F)

`runStageWithRecovery()` is the only place a stage's outcome is decided.
Order of recovery, per stage:

1. **Retry** — up to `stage.maxRetries` times, same agent.
2. **Alternate agent** — if the stage has `alternateAgentIds` and retries
   on the current agent are exhausted, the next id in that list is tried,
   with its own fresh retry budget.
3. **Skip** — if the stage is `optional: true` and every agent/retry
   option is exhausted, the stage is marked `skipped` (not `failed`) and
   the workflow continues to stages that depend on it.
4. **Graceful workflow failure** — otherwise, the stage is marked
   `failed`, the workflow status becomes `failed`, every not-yet-run stage
   is marked `skipped`, and `executeWorkflow()` returns normally (it never
   throws and never leaves a rejected promise hanging).

A stage's own request is dispatched with `maxRetries: 0` /
`allowFailover: false` at the Capability Router level — retry/failover is
owned entirely by this recovery ladder so there is exactly one place
deciding how many times a stage was actually attempted; without this, the
Scheduler's own transparent per-task retry would double up with the
Workflow Engine's and undercount attempts.

Because every branch above resolves to a stage status rather than a thrown
exception, a misbehaving or permanently-broken agent can never crash the
Orchestrator or leave a workflow execution unresolved — confirmed by
regression coverage (`test-evidence/block2-step6-part4-workflow-planner-regression-suite.js`).

## 7. optimizeWorkflow() and future parallelism

`optimizeWorkflow()` groups the topologically sorted stage order into
"waves": each wave is a list of stage ids whose dependencies were already
satisfied by earlier waves, so within a wave every stage is independent of
every other stage in it. This is exposed today purely as an inspectable,
documented plan (`{ workflowId, order, waves }`) — `executeWorkflow()`
still runs one stage at a time, in `order`, even across a single wave.
Sequential execution is what Part B of this order requires end to end;
`optimizeWorkflow()` is the seed a later pass could use to actually run a
wave's stages concurrently (e.g. via `Promise.all` over `routeStage()`)
without changing the dependency model at all.

## 8. Backward compatibility

- `os/core/orchestrator.js` — byte-for-byte unchanged.
- `os/core/capability-router.js` — byte-for-byte unchanged; used as-is via
  its public `route()`/event-bus contract.
- `os/core/agent-registry-integration.js` — untouched.
- Installation is additive and idempotent (`installWorkflowApi()` no-ops if
  `AxiomOrchestrator.createWorkflow` already exists), matching the
  convention `capability-router.js` established for `installRoutingApi()`.
- No Browser/Brain/Memory/Automation/Analytics/System file is imported,
  called, or modified. No `.html` file references `workflow-planner.js`.
- No network call, no OpenRouter integration.
