# AXIOM — Block 2 → Step 6 → Part 6B: Live Runtime Validation

**Date:** 2026-08-01
**Method:** This is the one claim in this whole engagement that needed
more than reading source or running the existing suites — "does
registration actually work" can only be answered by actually running
the real code. So: built a Node `vm` harness that loads the **real,
unmodified production files** `automation.html` loads — not hand-rolled
mocks — in the exact order that page loads them, with a small, explicit
set of browser-API stand-ins where Node has no equivalent. Full list of
stand-ins used, so nothing is hidden:

- `localStorage` / `sessionStorage` — in-memory `Map`-backed
  implementations of the standard `Storage` interface.
- `BroadcastChannel` — a no-op stub (`postMessage`/`close` do nothing).
- `CustomEvent` / `dispatchEvent` / `addEventListener` — minimal stubs
  sufficient for code that constructs/dispatches events but doesn't
  depend on real event-bubbling semantics.
- `document` — a stub exposing `readyState`, `addEventListener`,
  `createElement`, `querySelector(All)`, and `body`, none of which do
  real DOM work.
- `fetch` — rejects every call (`network disabled in harness`), so any
  code path that depends on a real network response is **not**
  exercised by this harness.
- `navigator`, `location` — minimal static stand-ins.

**Files loaded, in `automation.html`'s real order:**
`axiom-brain.js`, `memory-engine.js`, `memory-manager.js`,
`browser-sandbox.js`, `browser-engine.js`, `browser-manager.js`,
`automation-engine.js`, `brain-automation-bridge.js`,
`automation-memory-bridge.js`, `automation-manager.js`,
`orchestrator.js`, `runtime-context.js`, `capability-router.js`,
`agent-registry-integration.js`, `workflow-planner.js`.

## Result: all fifteen files load without error

Every file logged `OK` on load. Two real code issues surfaced and were
resolved by adding stand-ins (not by changing source): `axiom-brain.js`
needed `global.addEventListener`; `brain-automation-bridge.js` needed
`CustomEvent`. Both are missing *browser* APIs in a *Node* environment —
not code defects — and are the same class of gap any Node-based test
harness for browser code has to bridge.

## Registration results (real `registerOnce()` calls, real subsystem objects)

```
[AgentRegistryIntegration] Registered agent "browser".
[AgentRegistryIntegration] Registered agent "brain".
[AgentRegistryIntegration] Registered agent "memory".
[AgentRegistryIntegration] Registered agent "automation".
[AgentRegistryIntegration] Registered agent "system".

agents registered: [ 'browser:idle', 'brain:idle', 'memory:idle',
                      'automation:idle', 'system:idle' ]
```

Five of the six documented agents (`browser`, `brain`, `memory`,
`automation`, `system`) registered successfully against their **real**
production subsystem objects (`AxiomBrowserManager`, `AxiomBrain`,
`AxiomMemoryManager`, `AxiomAutomationManager` — the actual files
`automation.html` loads), not test doubles. Each reports `idle` health,
meaning `probeHealth()`'s real call into the real subsystem (e.g.
`Brain.getState()`, `Memory.getOverview()`, `Automation.getStats()`)
succeeded without throwing.

## Analytics agent — Not Fully Verified

`registerAnalyticsAgent()` looks for `global.AxiomAnalyticsAutomation`,
defined in `js/pages/analytics-automation-ultimate.js` — an 802-line UI
module with 83 direct DOM/browser-API references (`document.*`,
`querySelector`, etc.), the kind of file this harness's minimal `document`
stub isn't built to support without substantially more stubbing effort
than the other nine subsystem files needed combined. I did not load the
real file in this pass. What **is** verified: `registerAnalyticsAgent()`
itself (the registration logic) is exercised against a lightweight mock
in the Part 2 regression suite, which passes — so the registration
*code path* is tested, just not against the real production Analytics
module. Marking the live registration of the real Analytics module
specifically as **Not Verified**, distinct from the other five which
are.

## Agent discovery returns real agents — confirmed

`AxiomOrchestrator.listAgents()` on the live, wired stack returns the
five real agents above with real capability lists pulled from each
subsystem's actual methods (e.g. the browser agent's tool list is built
from `AxiomBrowserToolRegistry.listTools()` when present, falling back
to a hardcoded list otherwise — confirmed by reading
`registerBrowserAgent()`, not assumed).

## Capability routing / workflow discovery — confirmed, see `EXECUTION_EVIDENCE.md`

Actually routing and executing through this real, live-registered agent
set is Phase D territory — full results, including a bug found and
fixed, are in `EXECUTION_EVIDENCE.md` rather than duplicated here.

## Runtime Context initializes — confirmed

`AxiomRuntimeContext` loaded and initialized with no dependency on any
of the subsystem files above (consistent with the Part 5 suite's
assertion that it doesn't require `AxiomOrchestrator` to be present,
let alone Brain/Memory/Browser/Automation).
