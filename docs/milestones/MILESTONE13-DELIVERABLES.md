# AXIOM AI OS — Milestone 13 Deliverables
Automation & Skills Engine

Milestones 4, 5, 8, 9, 10, 11 and 12 are preserved exactly as delivered.
This milestone adds one new layer on top of all of them — a namespaced
Skill Registry, a custom multi-agent Workflow Engine, a Trigger Scheduler
for scheduled/event-driven execution, a top-level Automation Engine,
Workflow History/logging, and a non-destructive Executive AI upgrade —
and changes nothing else in the runtime, UI, or visual layer.

---

## 1. Architecture Summary

Milestone 5 gave AXIOM `window.AxiomWorkflows`: three fixed, hard-coded
multi-agent recipes (`morning-briefing`, `research-and-remember`,
`quick-capture`). Useful, but closed — nobody could define a fourth one,
schedule any of them, or react to something happening elsewhere in the OS.
Milestone 11 separately gave the runtime a real dependency graph
(`AxiomTaskGraph`), an admission-controlled scheduler (`AxiomTaskScheduler`),
and a plugin namespace (`AxiomPluginRegistry`) — but all of that machinery
served the Job Manager's AI-planned, natural-language jobs, not an
arbitrary, user-authored, reusable procedure.

Milestone 13 fills exactly that gap, as a layer that sits **beside** the
fixed Milestone 5 workflows and **on top of** the exact same event bus,
Agent Manager, task graph and capability kit every earlier milestone
already built — it introduces no second event bus, no second agent
registry, and no edit to `agent-runtime.js`, `agent-manager.js`,
`task-graph.js`, `capability-kit.js`, or `executive-ai.js` themselves:

```
 Agent Event Bus (Milestone 4 — UNCHANGED)
 AxiomAgentManager.dispatch() (Milestone 4/9 — UNCHANGED)
 AxiomCapabilityKit.withCapability() (Milestone 5 — UNCHANGED retry/timeout)
 AxiomTaskGraph.fromPlan() (Milestone 11 — UNCHANGED dependency analysis)
    │
    ├──> AxiomSkillRegistry            (NEW) namespaced "skill.*" units of
    │       work — a plain function OR a pointer at an existing agent op —
    │       every invocation runs through the UNCHANGED capability kit
    │
    ├──> AxiomWorkflowEngine           (NEW) user-defined, persisted,
    │       multi-step workflows. Steps are reshaped (never re-derived)
    │       into the SAME {id, agentId, clause, dependsOn} shape
    │       AxiomTaskGraph already understands, then executed in
    │       dependency LAYERS — independent steps run concurrently
    │       (genuine multi-agent automation), chained steps run in order
    │
    ├──> AxiomTriggerScheduler         (NEW) WHEN something runs:
    │       interval / at-time timers, or a bus-event listener — fires
    │       a workflow or skill through the UNCHANGED capability kit
    │
    ├──> AxiomAutomationEngine         (NEW) the top-level object a user
    │       names: binds ONE trigger to ONE workflow, enable/disable/
    │       run-now, and nudges the EXISTING 'agent.automation' core
    │       agent (Milestone 4) via a normal dispatch() so its status
    │       genuinely reflects automation activity
    │
    ├──> AxiomWorkflowHistory          (NEW) read-only subscriber on the
    │       bus events the four modules above already emit — same
    │       pattern as Milestone 11's event-timeline.js
    │
    └──> executive-automation-extension.js (NEW) Object.assign onto the
            EXISTING window.AxiomExecutiveAI: reshapes an UNCHANGED
            AxiomTaskPlanner.createExecutionPlan() into a workflow and
            runs it — any natural-language request can become a live,
            dependency-ordered, multi-agent automation
```

Nothing in this list re-implements retry/timeout logic, dependency
resolution, agent dispatch, or Executive AI's own decomposition — every
module here is either a new, additive namespace or a thin adapter that
reshapes data for an existing engine to execute.

---

## 2. New Modules Added

All under `os/runtime/automation/` (new folder, no existing folder touched):

| File | Role |
|---|---|
| `skill-registry.js` (`window.AxiomSkillRegistry`) | Objective 2. Reusable AI Skills, namespaced under `skill.` (rejects any id in the reserved `agent.` core-agent namespace, and any id outside `skill.[a-z0-9-]+`). A skill is either a plain function or a pointer at an existing agent + op. Every `.invoke()` runs through the UNCHANGED `AxiomCapabilityKit.withCapability()` — retry/timeout/lifecycle events for free, one execution path for direct calls, workflow steps, and triggers alike. Also exposes an event-based front door (`bus.emit('skill:invoke', ...)`) so a caller with no JS reference can still invoke a skill, the same technique `plugin-registry.js` already used for registration. |
| `workflow-engine.js` (`window.AxiomWorkflowEngine`) | Objectives 3 and 5. User-defined, persisted, multi-step workflows. `.define()` validates and stores a step list; `.run()` reshapes the steps into the exact plan-step shape the UNCHANGED `AxiomTaskGraph.fromPlan()` already understands (for cycle detection and sequential/parallel/mixed classification), then executes in dependency LAYERS — every step whose dependencies have already succeeded runs concurrently with its layer-mates via `Promise.all`, giving genuine multi-agent parallelism when steps are independent and strict ordering when they are chained. A step whose dependency failed is skipped, not run, and the workflow reports failed. Each step runs through the UNCHANGED capability kit for bounded retries (Objective 7). |
| `trigger-scheduler.js` (`window.AxiomTriggerScheduler`) | Objective 4. Two firing mechanisms under one registry: **scheduled** (`interval`/`at`, plain timers) and **triggered** (`event`, a listener on the shared Agent Event Bus — no polling). `.schedule()`/`.cancel()`/`.pause()`/`.resume()`/`.list()`. Every firing — timer or event — runs through the UNCHANGED capability kit, so a flaky downstream workflow/skill gets bounded retries without this module reimplementing retry logic. Definitions persist to `localStorage` in the same bounded, best-effort pattern `job-manager.js` already uses. |
| `automation-engine.js` (`window.AxiomAutomationEngine`) | Objective 1. The top-level object a user actually names: `.create()` binds ONE trigger (via `AxiomTriggerScheduler`) to ONE workflow (an existing `workflowId`, or inline `steps` auto-defined through `AxiomWorkflowEngine`) and persists the record; `.enable()`/`.disable()` pause/resume the underlying trigger; `.run()` fires it manually on demand. Every create/manual-run also nudges the EXISTING `agent.automation` core agent (Milestone 4) via a normal `AxiomAgentManager.dispatch()` — best-effort, so an automation still runs correctly even if that dispatch is unavailable — so the Automation Agent's own status genuinely reflects automation activity without this module touching its internals. |
| `workflow-history.js` (`window.AxiomWorkflowHistory`) | Objective 6. A pure, read-only subscriber on the bus events `workflow-engine.js`/`trigger-scheduler.js`/`skill-registry.js` already emit — never calls into any of them. Correlates step-level events into bounded, persisted run records (`.runs()`, `.getRun()`, `.byWorkflow()`) plus separate trigger-firing and skill-invocation logs (`.triggers()`, `.skills()`). Same non-invasive shape as Milestone 11's `event-timeline.js`. |
| `executive-automation-extension.js` | Objective 8 (and 5, continued). The SAME non-destructive technique Milestone 11's `autonomous-executive.js` and Milestone 12's `executive-knowledge-extension.js` already used on `window.AxiomExecutiveAI` (`Object.assign`, zero edits to `executive-ai.js`). Adds `.runAsAutomation(text)`: reuses the UNCHANGED `AxiomExecutiveAI.needsClarification()` guard, then the UNCHANGED `AxiomTaskPlanner.createExecutionPlan()` to decompose the request — every `agentId`/`clause`/`dependsOn` is carried over verbatim into a workflow, never re-derived — and runs it through `AxiomWorkflowEngine`. Also listens for `automation:auto-request` on the bus (mirroring Milestone 11's `executive:auto-request`) so another agent/module can ask for an autonomous automation with no direct function call. |
| `m13-bootstrap.js` | Verifies every Milestone 13 module initialized and that `AxiomExecutiveAI.runAsAutomation` actually attached, extends `window.AxiomRuntime` with a `.automation` accessor (same additive pattern as `.knowledge` in Milestone 12), and adds `AxiomRuntime.selfTestM13()`. |

Load order added to `os-shell.html`, directly after the Milestone 12 block
and before `os/core/window-manager.js` — no existing `<script>` tag was
moved, reordered, or removed.

---

## 3. Objectives Checklist

| # | Objective | Status | Where |
|---|---|---|---|
| 1 | Add an Automation Engine | ✅ | `automation-engine.js` |
| 2 | Create reusable AI Skills | ✅ | `skill-registry.js` |
| 3 | Support custom workflows | ✅ | `workflow-engine.js` |
| 4 | Enable scheduled and triggered tasks | ✅ | `trigger-scheduler.js` (interval/at = scheduled, event = triggered) |
| 5 | Allow multi-agent automation | ✅ | `workflow-engine.js` (dependency-layer parallel execution) + `executive-automation-extension.js` (Executive-AI-authored multi-step automations) |
| 6 | Add workflow history and logs | ✅ | `workflow-history.js` |
| 7 | Improve task execution reliability | ✅ | Every skill/step/trigger firing runs through the unmodified Milestone 5 `AxiomCapabilityKit` for bounded retries + timeouts; failed dependencies short-circuit dependents instead of running on bad input |
| 8 | Integrate with Executive AI | ✅ | `executive-automation-extension.js` |

---

## 4. Reuse / No-Duplication Audit

- **Event Bus** — every Milestone 13 module emits on the existing
  `AxiomAgentRuntime.bus`; no second bus or event channel introduced.
  `workflow-history.js` is a pure subscriber and writes nothing back.
- **Agent Manager** — agent-backed skill/workflow steps dispatch through
  the unmodified `AxiomAgentManager.dispatch()` and await the existing
  `task:completed`/`task:failed` events, the exact pattern
  `capabilities/workflows.js` already established for agent hand-offs.
  `automation-engine.js` nudges the existing `agent.automation` core
  agent rather than adding a new one — still exactly 10 core agents.
- **Runtime / Task Graph** — `workflow-engine.js` calls the unmodified
  `AxiomTaskGraph.fromPlan()` for dependency resolution, cycle detection,
  and sequential/parallel/mixed classification; it never re-derives
  graph logic of its own.
- **Planner / Executive AI** — `executive-ai.js` and `task-planner.js`
  are not edited. `executive-automation-extension.js` reuses
  `AxiomExecutiveAI.needsClarification()` and
  `AxiomTaskPlanner.createExecutionPlan()` verbatim and reshapes their
  output; Executive AI's own `handle()` code path is untouched.
- **No duplicate systems** — retry/timeout/lifecycle logic is the
  existing `AxiomCapabilityKit.withCapability()`, reused by every
  invocation path in this milestone (skills, workflow steps, triggers)
  rather than three separate reliability mechanisms; dependency
  resolution is the existing `AxiomTaskGraph`, reused rather than
  reimplemented for custom workflows.
- **Backward compatibility** — `window.AxiomWorkflows` (Milestone 5's
  three fixed recipes) is untouched and still callable; nothing in this
  milestone renames, wraps, or shadows it.

---

## 5. Verification

Run:
```
node test-evidence/milestone13-regression-suite.js
```

The suite loads the REAL, unmodified runtime files for Milestones 4, 5, 8,
9, 10, 11, 12 and all seven Milestone 13 source files inside a Node `vm`
context, in the exact order added to `os-shell.html`, against light
in-memory fakes of the external backends (`AxiomAgents` memory store,
`AxiomBrowserLive`, `FileProcessing`) — the same approach every prior
milestone's suite has used. No runtime file was altered to make the
harness work.

**46/46 checks passed** (`test-evidence/milestone13-regression-output.txt`):

- Regression: Milestone 4/5's `selfTest()`, and `selfTestM8()` through
  `selfTestM12()`, all still pass unchanged; still exactly 10 core agents
  with no duplicates.
- Milestone 13's own built-in `selfTestM13()`: skill registration
  correctly rejects a reserved `agent.` id and a malformed id, registers
  and invokes a valid skill, rejects a duplicate id, and proves a
  permanently-failing skill is retried up to its configured bound then
  fails cleanly; a sequential (chained `dependsOn`) workflow and an
  independent-step workflow are correctly classified sequential/parallel
  and both complete; a cyclic-dependency workflow is rejected instead of
  hanging; an interval trigger fires on its own with no manual call, and
  an event trigger fires the instant its watched event is emitted, with
  no polling; a disabled automation does not fire on its trigger event,
  re-enabling it does, and it can also be run manually; workflow history
  recorded the run, the trigger firings, and the skill invocations;
  Executive AI turns both a single-clause and a multi-clause
  natural-language request into a running, completed automation, and the
  event-driven `automation:auto-request` front door autonomously starts
  one with no direct function call.
- Additional targeted regression checks (beyond the built-in self-test):
  a skill invoked purely via the `skill:invoke` bus event (no JS
  reference) completes; a diamond-shaped dependency graph (`root` →
  `left`/`right` → `join`) runs every step exactly once, proving no
  duplicate execution on a shared dependency; a step depending on a
  failed step is skipped rather than run and the workflow reports
  failed; a paused trigger does not fire while paused and fires again
  once resumed; every core singleton (bus, Agent Manager, Job Manager,
  Orchestrator, Executive AI, and all five new Milestone 13 modules) is
  confirmed to still be the same object after Milestone 13 loads, with
  no duplicate `*2`-style globals introduced.

`os-shell.html` also gained `AxiomRuntime.selfTestM13()` (`m13-bootstrap.js`),
a seventh self-test in the same shape as `selfTest()`/`selfTestM8()`/.../
`selfTestM12()`, for in-browser verification against a real Supabase-backed
`AxiomAgents` and live core agents — it registers and cleans up its own
temporary skills/workflows/triggers/automations, leaving no test residue.

---

## 6. Remaining Limitations

- **Triggers are re-armed from an in-memory index, not resumed from a
  precise elapsed time.** `trigger-scheduler.js` persists trigger
  *definitions* to `localStorage` (surviving a refresh conceptually), but
  the actual `setInterval`/`setTimeout` handles live only in the current
  page's memory — there is no bootstrap-time re-arming pass yet that
  reads persisted definitions back into live timers on load. A future
  milestone's bootstrap hook is the natural place to add that, the same
  way `job-manager.js`'s own `live` map is described as "an in-memory
  index over a persisted record."
- **Workflow execution is layer-parallel, not fully speculative.** Steps
  within a ready layer run concurrently, but the engine still waits for
  an entire layer to settle before starting the next — correct for any
  DAG, but not maximally concurrent for a graph where a later step could
  theoretically start the instant its own specific dependency (not the
  whole layer) finishes.
- **`automation-engine.js`'s nudge to `agent.automation` is best-effort
  and fire-and-forget** — it does not await or surface that agent's own
  result, since the actual work is the real workflow run happening in
  parallel; the nudge exists purely so the Automation Agent's OS-visible
  status reflects activity.
- **No cron-style recurring wall-clock schedule** (e.g. "every day at
  9am") — only a fixed millisecond `interval` or a one-shot `at` epoch
  timestamp. A daily schedule can be approximated today by an `at`
  trigger that re-schedules itself on completion, but that convenience
  wrapper doesn't exist yet.
- **`jsdom` was unavailable in this execution environment** (no package
  registry access, matching Milestones 11 and 12's own note), so
  verification used the same hand-built minimal `vm` shim rather than a
  full `jsdom` window/document — narrower than a full browser DOM,
  though it runs the identical unmodified source files in the identical
  load order.
