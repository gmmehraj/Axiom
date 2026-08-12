# AXIOM Multi-Agent Collaboration Model
**Block 2 · Step 6 · Part 4**
**File:** `os/core/workflow-planner.js` · **Global:** `window.AxiomWorkflowPlanner`

## 1. The core rule: agents never call each other

Every agent registered with `AxiomOrchestrator.registerAgent()` (Part 1)
exposes exactly one thing to the outside world: a `handler(task)` function.
Nothing about a workflow changes that contract. A stage's handler receives
a `task` object — the same shape `dispatch()`/`route()` have always
produced — and returns a result. It never receives:

- a reference to `AxiomWorkflowPlanner` or the workflow record,
- a reference to any other agent,
- the raw Workflow Context object.

Collaboration between agents happens **only** through the Workflow
Planner's execution loop calling `AxiomOrchestrator.route()` (or
`dispatch()`) once per stage, exactly the way any other caller would.
`os/core/agent-registry-integration.js`'s isolation guarantee — one agent's
failure or misbehavior can't reach into another agent's internals — is
therefore preserved by construction, not by a new enforcement mechanism.

## 2. Example: sequential collaboration

```js
AxiomOrchestrator.createWorkflow({
  name: 'research-and-remember',
  stages: [
    { id: 'plan',      agentId: 'executive',
      input: (ctx) => ctx.trigger },

    { id: 'research',  capability: 'research', dependsOn: ['plan'],
      input: (ctx) => ctx.outputs.plan },

    { id: 'browse',    capability: 'browse',   dependsOn: ['research'], optional: true,
      input: (ctx) => ctx.outputs.research.findings },

    { id: 'remember',  capability: 'memory:write', dependsOn: ['browse', 'research'],
      input: (ctx) => ({ findings: ctx.outputs.research.findings, page: ctx.outputs.browse && ctx.outputs.browse.page }) },

    { id: 'summarize', agentId: 'executive', dependsOn: ['remember'],
      input: (ctx) => ctx.outputs }
  ]
});

AxiomOrchestrator.executeWorkflow(workflowId, { topic: "today's AI news" });
```

This is exactly the `Executive → Research → Browser → Memory → Executive`
shape from the execution order: Executive plans, Research and Browser each
do their part (Browser is `optional`, so a dead browsing backend degrades
the workflow instead of failing it), Memory persists the combined findings,
and Executive is called a second time — as an entirely separate stage, with
its own routing decision — to summarize. The Executive agent never knows
it's "the same agent as before"; each stage is an independent request.

## 3. Stage-to-agent routing

A stage names its agent one of two ways:

- **`agentId`** — pins the stage to one specific registered agent (e.g.
  `'executive'`). Optionally paired with `alternateAgentIds` for Part F
  failover.
- **`capability`** — lets the Capability Router (Part 3) pick whichever
  eligible, healthy agent currently offers that capability, using the same
  deterministic selection rules (`selectAgent()`) any other capability-based
  request would use. This is how a workflow stays agnostic to *which*
  concrete agent handles "research" or "browse" as the registry evolves.

Both paths go through the same `routeStage()` function in
`workflow-planner.js`, which builds a normal `AxiomOrchestrator.route()`
request (or `dispatch()` if `capability-router.js` isn't loaded) — nothing
about workflow stages bypasses the Part 1/Part 3 pipeline.

## 4. Payload isolation — what a stage actually sees

Each stage supplies its own `input(context)` function. Its return value —
not the `context` object — becomes `task.payload` for that stage's agent.
This is the mechanism behind "each stage receives only the context
required for that step": a stage that only needs one prior stage's output
can select exactly that:

```js
{ id: 'browse', capability: 'browse', dependsOn: ['research'],
  input: (ctx) => ctx.outputs.research.findings }   // not the whole context
```

Regression-tested directly: `test-evidence/block2-step6-part4-workflow-planner-regression-suite.js`
asserts a stage's handler observes exactly the value its own `input()`
returned, nothing more.

## 5. Optional stages and graceful degradation

`optional: true` lets a collaboration continue even when one participating
agent is unavailable — e.g. Browser being down shouldn't stop Research and
Memory from doing useful work. An optional stage that exhausts retries
(and, if configured, alternate agents) is marked `skipped` rather than
failing the whole workflow; stages that depend on it still run, and can
check `ctx.outputs.browse` for `undefined` inside their own `input()` if
they need to branch on whether that collaborator actually participated.

## 6. Isolation is also failure isolation

Because every stage is dispatched through the normal Orchestrator pipeline,
a stage's agent throwing, timing out, or being unhealthy is handled exactly
like any single-request failure would be (Part F recovery ladder — see
`WORKFLOW_ENGINE.md` §6) and can never propagate as an exception into
another agent's handler or into the Orchestrator's own event loop. This was
explicitly regression-tested: after a workflow with a permanently-failing
stage runs to completion (`status: 'failed'`), a fresh unrelated
`AxiomOrchestrator.route()` call in the same runtime still dispatches and
completes normally.
