# AXIOM — Block 2 → Step 7 → Part 1: Agent Capabilities

**Date:** 2026-08-01
**Method:** Every capability listed as "real" below is backed by an
actual method in the actual subsystem file, confirmed by reading that
file directly and, where practical, by an actual live call in this
pass's harness (see `AI_WORKFLOW_VALIDATION.md`). The task instructions
for this pass listed a specific set of capability names per subsystem
(navigate/search/extract/tabs/history for Browser,
remember/recall/search/forget for Memory, summarize/reason/plan/reflect
for Brain, workflow/execute/schedule for Automation,
collect/report/metrics for Analytics). I checked each one against the
real code rather than assuming the list was already accurate — several
names in that list don't correspond to anything that exists in this
codebase. Per this pass's own rule ("never fabricate evidence"), I'm
not implementing new functionality to match an aspirational name and
I'm not claiming a name is supported when it isn't. What follows is
what's actually there.

## Browser (`os/core/browser-manager.js`, real, already registered)

| Requested name | Real equivalent | Status |
|---|---|---|
| navigate | `navigate` (via `NavigationAPI`) | Real, registered, capability `navigate` |
| history | `read-history` (`HistoryAPI.getRecentPages`) | Real, registered, capability `history-read` |
| tabs | `create-tab` (`TabAPI.create`) | Partially real — `TabAPI` also has `close`/`switch`/`duplicate`/`reorder`, but only `create-tab` is currently exposed through the registered handler's switch statement; the others exist in `browser-manager.js` but aren't wired into the agent handler |
| search | — | **Not real.** No content/page-search method exists in `browser-manager.js`. Not implemented in this pass — would be new functionality. |
| extract | — | **Not real.** No page-content-extraction method exists. Not implemented in this pass. |

Also real but not in the requested list: `back`, `forward`, `refresh`,
`create-session`, `diagnostics` — all registered and working (see
`EXECUTION_EVIDENCE.md` from the prior pass for a live `diagnostics`
call).

## Memory (`os/core/memory-manager.js`, real, already registered)

| Requested name | Real equivalent | Status |
|---|---|---|
| remember | `register-memory` (`Memory.registerMemory`) | Real, registered |
| recall | `get-conversation` / `find-memories` | Real, registered |
| search | `find-memories` | Real, registered (same underlying op as "recall" above — the codebase doesn't distinguish them) |
| forget | — | **Not real.** No targeted delete/forget-a-specific-memory method exists. The closest real operation is `run-cleanup` (`Memory.runCleanup()`), a bulk cleanup pass, not a per-item forget. Registered as `run-cleanup`, not renamed to "forget" since it isn't the same operation. |

Also real but not in the requested list: `list-conversations`,
`get-overview` — both registered and working.

## Brain (`os/core/axiom-brain.js`, real, already registered)

| Requested name | Real equivalent | Status |
|---|---|---|
| summarize | — | **Not real.** |
| reason | — | **Not real.** |
| plan | — | **Not real.** |
| reflect | — | **Not real.** |

None of these four exist anywhere in `axiom-brain.js`. Reading the file
confirms why: Brain is a lightweight mood/state/activity tracker (get
state, set state, day count, time of day) — it has no language-model
reasoning capability of any kind, and never has. The requested names
describe LLM-style reasoning operations that would need to be built from
scratch on top of a model client (the same `OpenRouter` client discussed
in `AI_RUNTIME_INTEGRATION.md`). Building that is new functionality —
explicitly out of scope for an integration pass ("this is NOT a
redesign... only integrate existing systems"). What's real and already
registered: `get-state`, `set-state`, `day-count`, `time-of-day`.

## Automation (`os/core/automation-manager.js`, real, already registered)

| Requested name | Real equivalent | Status |
|---|---|---|
| workflow | `run-workflow` (`Automation.run`) | Real, registered |
| execute | `run-workflow` | Real — same operation as "workflow" above |
| schedule | — | **Not real** as a distinct operation. `automation-manager.js` has `queue`/`run.start`/`run.retry`, which is closer to "execute now" or "enqueue" than "schedule for later" — no time-based scheduling method exists. |

Also real but not in the requested list: `get-status`, `get-stats` —
both registered and working.

## Analytics (`js/pages/analytics-automation-ultimate.js`, real, registration logic suite-covered, live registration not attempted — see `AI_RUNTIME_INTEGRATION.md`)

| Requested name | Real equivalent | Status |
|---|---|---|
| collect | — | **Not real.** No `collect()`-style method. |
| report | — | **Not real.** No `report()`-style method. |
| metrics | — | **Not real.** No `metrics()`-style method. |

The real methods are `enhanceAnalytics()`, `enhanceAutomation()`, and
`addLog()` — already the exact three the existing
`registerAnalyticsAgent()` exposes as `enhance-analytics`,
`enhance-automation`, `add-log`. Nothing needed to change here; the
requested names just don't match what this file actually does.

## Coding (`os/runtime/capabilities/coding-toolkit.js`, real, **newly registered this pass**)

| Capability | Real method | Status |
|---|---|---|
| project-search | `Toolkit.projectSearch(query, limit)` | Real, registered — fails cleanly when the workspace-search subsystem (`window.AxiomAgents`) isn't loaded on the page, confirmed live |
| file-navigation | `Toolkit.fileNavigation(query, limit)` | Real, registered — same dependency as above |
| code-explanation | `Toolkit.explainCode(prompt, opts)` | Real, registered — requires a live OpenRouter client; fails cleanly without one, confirmed live |
| refactor-proposal | `Toolkit.proposeRefactor(prompt, instructions, opts)` | Real, registered — pre-checks for a client itself and returns a graceful "unavailable" note rather than failing, confirmed live |
| bug-investigation | `Toolkit.investigateBug(description, opts)` | Real, registered — same graceful-degradation pattern as refactor-proposal |
| project-analysis | `Toolkit.analyzeProject(query)` | Real, registered — depends on the same workspace-search subsystem as project-search |

## Capability discovery — confirmed automatic, no hardcoding

`AxiomCapabilityRouter` resolves capabilities by scanning
`Orchestrator.listAgents()`'s live `capabilities` arrays at call time
(confirmed by reading `capability-router.js` in the Part 6A pass) — it
required zero code changes to pick up the new `coding` agent's six
capabilities the moment `registerCodingAgent()` ran. Confirmed live in
this pass: `Orchestrator.listAvailableTools()` (from
`agent-registry-integration.js`, itself capability-agnostic — it just
iterates whatever's registered) correctly lists all six new
`coding.*` tools alongside the existing ones with no changes to that
function.
