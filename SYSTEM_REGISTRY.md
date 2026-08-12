# AXIOM Orchestrator — System Registry
**Block 2 · Step 6 · Part 2** · `os/core/agent-registry-integration.js`

## What this document is
A record of exactly which AXIOM subsystems are registered with the
Orchestrator by this pass, what each one exposes, where that information
came from, and how its health is determined. Every field below was read
from the named subsystem's own existing public API — nothing here was
invented for the registry.

## Registered agents

| Agent id | Source global | Registered by | Health probe |
|---|---|---|---|
| `browser` | `AxiomBrowserManager` (`os/core/browser-manager.js`) | `registerBrowserAgent()` | `Browser.health()` → real `healthy`/`degraded`/`unavailable` |
| `brain` | `AxiomBrain` (`os/core/axiom-brain.js`) | `registerBrainAgent()` | `Brain.getState()` resolves without throwing |
| `memory` | `AxiomMemoryManager` (`os/core/memory-manager.js`) | `registerMemoryAgent()` | `Memory.getOverview()` resolves without throwing |
| `automation` | `AxiomAutomationManager` (`os/core/automation-manager.js`) | `registerAutomationAgent()` | `Automation.getStats()` resolves without throwing |
| `analytics` | `AxiomAnalyticsAutomation` (`js/pages/analytics-automation-ultimate.js`) | `registerAnalyticsAgent()` | presence of `Analytics.state` |
| `system` | *(none — see below)* | `registerSystemAgent()` | always reports the Orchestrator's own liveness |

Registration is **best-effort per page**: each `register*Agent()` function
checks for its source global and returns `null` (registering nothing) if
that global isn't present. Most individual `.html` pages in this project
only load a subset of these subsystems (see "Per-page availability"
below), so on any given page some of these six agents simply won't be
registered — that's expected, not a bug.

Calling `AxiomAgentRegistryIntegration.registerAll()` again after the
first automatic pass is safe: `registerOnce()` checks
`AxiomOrchestrator.getAgent(id)` first and skips re-registering anything
already present.

## Capability map

| Agent | Capabilities |
|---|---|
| `browser` | `navigate`, `session-management`, `tab-management`, `history-read`, `diagnostics` |
| `brain` | `state-read`, `state-write`, `mood-tracking`, `activity-tracking`, `day-count`, `time-of-day` |
| `memory` | `conversation-management`, `memory-storage`, `memory-retrieval`, `session-tracking`, `metadata-summary`, `cleanup` |
| `automation` | `workflow-execution`, `workflow-queueing`, `workflow-monitoring`, `workflow-history`, `browser-automation-bridge` |
| `analytics` | `analytics-enhancement`, `automation-logging` |
| `system` | `system-diagnostics`, `runtime-status`, `agent-health-aggregation` |

`browser`'s `tools` list is read live from `AxiomBrowserToolRegistry.listTools()`
(`os/runtime/capabilities/browser-tool-registry.js`) when that registry has
loaded on the page, since it's already the canonical source of Browser
Agent tool names; otherwise it falls back to a short static list of the
same `BrowserManager` methods used by its handler. Every other agent's
`tools` list is a static array naming the exact subsystem methods its
`handler` forwards to — see each `register*Agent()` function in
`os/core/agent-registry-integration.js` for the literal mapping from task
`type` to subsystem method call.

`permissions` are declarative tags only (per `AGENT_REGISTRY.md`, the
registry does bookkeeping, not enforcement) chosen to mirror each
subsystem's own read/write or read/execute surface — they don't come from
a formal permissions file because none of these subsystems expose one
(Browser's own `os/core/browser-sandbox.js` permission store is scoped to
per-action/per-origin grants at call time, not a static list to read at
registration time).

## Why `system` has no source subsystem
Browser, Brain, Memory, Automation, and Analytics each already exist as a
single dedicated file with a clear public API. Nothing in the project
plays that same role for "the system as a whole" — there's no
`AxiomSystem` global. Rather than invent one or leave "System" out of the
registration required by this phase, `system` is registered as a thin,
honest aggregator:

- `system.getRuntimeInfo` returns the Orchestrator's own
  `getRuntimeState()` / `getStats()`, plus `AxiomRuntimeMonitor.report()`
  (`os/runtime/intelligence/runtime-monitor.js`) when that module happens
  to be loaded on the page — a real runtime-monitoring module from an
  earlier milestone, reused here rather than duplicated.
- `system.getSystemHealth` simply returns
  `AxiomOrchestrator.getSystemHealth()` (see `AGENT_DISCOVERY.md`) — i.e.
  the System agent's own diagnostic capability is the same aggregate view
  discovery already provides, not a second implementation of it.
- Its health probe always reports `healthy`, because the System agent's
  liveness *is* the Orchestrator's liveness — if `AxiomOrchestrator` didn't
  exist, `agent-registry-integration.js` would have already logged an
  error and exited before any agent (including `system`) got registered.

This is called out explicitly so a future pass doesn't mistake `system`
for a real subsystem wrapper the way the other five are — it's a registry-
level convenience, not a new engine.

## Health model
`status` (`idle`/`busy`/`disabled`/`error`) is entirely managed by the
Orchestrator's own scheduler, exactly as in Part 1 — this module never
touches it directly. `health` (`healthy`/`degraded`/`unhealthy`) is set:

1. **Once at registration time**, from the subsystem's real probe (see the
   table above), so `getSystemHealth()` is accurate immediately, not just
   after the first poll tick.
2. **Every 20 seconds thereafter**, via `syncHealth()` re-running the same
   probes and calling `AxiomOrchestrator.setAgentHealth(id, health)` — the
   same public setter documented in `AGENT_REGISTRY.md`. This can be
   started/stopped with `AxiomAgentRegistryIntegration.startHealthPolling()`
   / `stopHealthPolling()`, or triggered on demand with `syncHealth()`.

Mapping from a subsystem's own structured status (when it has one, like
`BrowserManager.health()`) to the registry's three-value model:

| Subsystem reports | Registry `health` |
|---|---|
| `'healthy'` | `healthy` |
| `'degraded'` | `degraded` |
| anything else (e.g. `'unavailable'`) | `unhealthy` |
| no structured status, call doesn't throw | `healthy` if it returned a value, `degraded` if `undefined`/`null` |
| call throws | `unhealthy` |

## Per-page availability (for context, not changed by this pass)
No `.html` file loads `os/core/orchestrator.js` or
`os/core/agent-registry-integration.js` yet — wiring either into a page is
a future integration step, unchanged from how Part 1 left it. For
reference, here is which of the five source subsystems each existing page
already loads directly (from each page's own `<script>` tags, unrelated to
the Orchestrator):

- `automation.html` — Browser, Brain, Memory, Automation (all four)
- `browser.html` — Browser, Brain, Memory
- `brain.html`, `memory.html`, `admin.html`, `agent-library.html`,
  `analytics.html`, `billing.html`, `playground.html`, `settings.html`,
  `studios.html`, `workspace.html` — Brain, Memory only
- `os-shell.html` — none of the five (it loads the separate, older
  `os/runtime/intelligence/orchestrator.js` agent system instead — see
  "A note on the other `AxiomOrchestrator`" below)

## A note on the other `AxiomOrchestrator`
`os/runtime/intelligence/orchestrator.js` also defines
`window.AxiomOrchestrator`, as part of an earlier, separate
agent-runtime system (`AxiomAgentRuntime` / `AxiomAgentManager` /
`AxiomTaskRouter`, wired into `os-shell.html`). That file is untouched by
this pass. `os/core/agent-registry-integration.js` is written against, and
only intended to load alongside, the Block 2 · Step 6 · Part 1
`os/core/orchestrator.js` described in `ORCHESTRATOR_ARCHITECTURE.md` — the
two `orchestrator.js` files are not currently loaded on the same page
together anywhere in the project, so this hasn't been a collision in
practice, but it's worth flagging before any future pass wires both
`os/core/*` and `os/runtime/intelligence/*` onto the same page.

## Future orchestration integration points
- Wiring `os/core/orchestrator.js` + `os/core/agent-registry-integration.js`
  into an actual page (starting with `automation.html`, which already
  loads all four non-Analytics subsystems) is the natural next step once
  the project is ready to move from "registration" to "execution."
- Once real execution flow through `dispatch()` is in scope, the handler
  bodies already written in `agent-registry-integration.js`'s
  `register*Agent()` functions are the intended forwarding logic — they
  were written now, dormant, specifically so that step is wiring, not new
  design.
- Analytics is registered from `AxiomAnalyticsAutomation`, which is a UI-
  enhancement module (`js/pages/analytics-automation-ultimate.js`), not a
  dedicated `os/core/*` analytics engine. If a dedicated Analytics engine
  is ever built, `registerAnalyticsAgent()` is the one function to repoint
  at it — nothing else in the registry needs to change.
