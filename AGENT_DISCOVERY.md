# AXIOM Orchestrator — Agent Discovery APIs
**Block 2 · Step 6 · Part 2** · part of `os/core/agent-registry-integration.js`

## Purpose
Block 2 · Step 6 · Part 1 gave the Orchestrator a registry
(`registerAgent`, `getAgent`, `listAgents`, `getHealthyAgents`). Those are
enough to *manage* agents, but a caller that wants to answer "what can this
system do right now" — before routing a request anywhere — has to hand-roll
filtering logic against `listAgents()` every time. This module adds that as
a first-class, read-only discovery layer.

## Design note: additive, not a fork
Every function below is assigned directly onto the existing
`window.AxiomOrchestrator` object, from `agent-registry-integration.js`,
**after** `orchestrator.js` has already built and exposed it. `orchestrator.js`
itself is never opened for edits. Two consequences of that:

- These APIs are only present once `agent-registry-integration.js` has
  loaded and run on top of `orchestrator.js` — a page that loads only Part 1
  does not get them.
- Every one of these functions is implemented purely in terms of Part 1's
  own already-public methods (`listAgents()`, `getAgent()`, `getStats()`,
  `getRuntimeState()`). None of them reach into registry internals, so
  Part 1's file and its regression suite are provably unaffected — verified
  by re-running `block2-step6-part1-orchestrator-regression-suite.js`
  unmodified (21/21 still passing) after adding this module.

## API Reference

### `AxiomOrchestrator.discoverAgents(filter?)`
Returns public agent snapshots (same shape as `listAgents()`), optionally
narrowed by an AND-ed filter object:

```js
AxiomOrchestrator.discoverAgents();
// -> all registered agents

AxiomOrchestrator.discoverAgents({ capability: 'navigate' });
// -> agents whose capabilities include 'navigate'

AxiomOrchestrator.discoverAgents({ health: 'healthy', status: 'idle' });
// -> healthy, currently-idle agents
```

Supported filter keys: `capability`, `tool`, `health`, `status`. Any
combination is allowed; an omitted key is not filtered on.

### `AxiomOrchestrator.discoverCapabilities()`
Returns a deduplicated, alphabetically sorted array of every capability tag
across every registered agent — e.g. `['analytics-enhancement', 'cleanup',
'conversation-management', 'navigate', ...]`. Useful for building a
capability picker or sanity-checking that an expected capability exists
before dispatching by capability.

### `AxiomOrchestrator.findAgentByCapability(capability)`
Shorthand for `discoverAgents({ capability })`. Returns every agent
(zero, one, or more) that declares the given capability — this is the same
matching rule `dispatch({ capability })` uses internally when resolving
which agent should receive a request, exposed here as a pure read so a
caller can inspect the candidate set before dispatching.

### `AxiomOrchestrator.getAgentHealth(id)`
Returns a focused health snapshot for one agent:

```js
AxiomOrchestrator.getAgentHealth('browser');
// -> { id: 'browser', name: 'Browser Agent', health: 'healthy',
//      status: 'idle', lastActiveAt: null }
```

Returns `null` for an unknown `id` rather than throwing, so a caller can
probe speculatively without a try/catch.

### `AxiomOrchestrator.getSystemHealth()`
Returns a single aggregate snapshot across every registered agent:

```js
AxiomOrchestrator.getSystemHealth();
// -> {
//      overall: 'healthy' | 'degraded' | 'unknown',
//      totalAgents: 6, healthy: 6, degraded: 0, unhealthy: 0,
//      runtimeState: 'running',
//      agents: [{ id, health, status }, ...],
//      timestamp: 1735689600000
//    }
```

`overall` is `'unknown'` only when zero agents are registered;
`'degraded'` if any agent is `degraded` or `unhealthy`; `'healthy'`
otherwise. This is the same object the `system` agent's
`get-system-health` task type returns (see `SYSTEM_REGISTRY.md`).

### `AxiomOrchestrator.listAvailableTools()`
Returns every distinct tool identifier across every registered agent, each
paired with the agent that owns it:

```js
AxiomOrchestrator.listAvailableTools();
// -> [{ tool: 'automation.run', agentId: 'automation' },
//     { tool: 'browser.navigate', agentId: 'browser' }, ...]
```

Sorted alphabetically by tool name. If the same tool name were ever
registered by two agents, the later registration's owner wins — in
practice this doesn't happen today since each subsystem's tool names are
namespaced by prefix (`browser.*`, `memory.*`, `automation.*`, ...).

## Health model this builds on
See `AGENT_REGISTRY.md` for the full `status`/`health` model. This module
adds one new health-maintenance behavior on top of it: a 20-second
read-only poll (`AxiomAgentRegistryIntegration.syncHealth()`, also callable
manually or via `startHealthPolling()`/`stopHealthPolling()`) that re-checks
each registered subsystem's own real health/status signal and calls
`AxiomOrchestrator.setAgentHealth(id, health)` accordingly — the same public
setter any external monitor would use. The registry itself still never
guesses; this poll is just a scheduled caller of that existing setter,
sourced from each subsystem's own already-public diagnostics.

## What discovery does *not* do
- It does not dispatch, route, or execute anything. Every function above is
  a pure read against current registry state.
- It does not grant or check permissions. `capabilities`/`permissions`/
  `tools` are bookkeeping fields the registry stores and reports (per
  `AGENT_REGISTRY.md`) — discovery surfaces them, it doesn't enforce them.
- It does not know about agents that haven't called `registerAgent()`
  (from this module or manually) — an unregistered subsystem simply isn't
  discoverable, by design.

## Future orchestration integration points
- A future phase that actually wires pages to dispatch through the
  Orchestrator can use `findAgentByCapability()` / `discoverAgents()` to
  build routing UI or capability-based fallback chains before ever calling
  `dispatch()`.
- `getSystemHealth()` is a natural feed for a future status widget or a
  pre-flight check ("don't let the user start a workflow while `automation`
  is `unhealthy`") — again, read-only, wiring it to any UI is out of scope
  for this pass.
- Additional discovery filters (e.g. by `permission`) can be added the same
  additive way this module added the first six — assigning a new function
  onto `AxiomOrchestrator` from another file, no edit to `orchestrator.js`
  required.
