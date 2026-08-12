# AXIOM AI OS — Milestone 11 Deliverables
Autonomous AI Operating System

Milestones 4, 8, 9 and 10 are preserved exactly as delivered. This milestone
adds one new coordination layer on top of all of them — a global scheduler,
task graph, event timeline, resource monitor, plugin registry, and an
additive extension to Executive AI — and changes nothing else in the
runtime, UI, or visual layer.

---

## 1. Architecture Summary

Milestone 9 gave AXIOM a single-shot brain: text in, Executive AI plans,
dispatches through the Orchestrator/Job Manager, supervises, and returns an
outcome — one request at a time, driven by a synchronous caller. Milestone
10 added conversational memory in front of that. What was still missing for
an "operating system" is everything that only matters once MULTIPLE pieces
of background work exist at once: which one runs first, what depends on
what across separate jobs (not just steps inside one job), a place to see
the whole runtime's shape and history, and a safe way for code outside this
codebase to add a new agent.

Milestone 11 adds exactly that, as a layer that sits **above** the Job
Manager and **beside** Executive AI, and changes how none of the following
already behave: the Event Bus, the Agent Manager, the Task Router, the Task
Planner, the Orchestrator, the Job Manager, or Executive AI's own
`handle()` / clarification / ledger / supervision pipeline.

```
 many requests, from the user OR from other agents
    │
    ▼
 AxiomExecutiveAI.scheduleAutonomous()   (NEW — additive extension)
    │  1. same needsClarification() guard Milestone 9 already uses
    │  2. AxiomTaskPlanner.createExecutionPlan()      <- UNCHANGED, M8
    │  3. AxiomTaskGraph.fromPlan()/.decideMode()      <- NEW, structural
    │     sequential/parallel decision from the real dependency graph
    ▼
 AxiomTaskScheduler.schedule(plan, opts)   (NEW)
    │  global priority queue: critical > high > normal > low
    │  cross-job dependsOn, bounded retries, cancellation
    │  admits into the Job Manager only when a concurrency slot is free
    ▼
 AxiomJobManager.createJob()             <- UNCHANGED, Milestone 8
    │
    ▼
 AxiomOrchestrator.run() -> AxiomAgentManager.dispatch()   <- UNCHANGED, M4/8
    │
    ▼
 existing bus events (job:*, orchestrator:*, executive:*)
    │
    ▼
 AxiomEventTimeline (NEW) — records EVERY bus event with a timestamp
 AxiomTaskGraph (NEW)      — turns a plan/run/scheduler queue into a graph
 AxiomResourceMonitor (NEW) — aggregates agent/queue/task/latency/browser data
 AxiomPluginRegistry (NEW) — validated front door onto AgentManager.register()
```

Nothing in this list plans a step, chooses an agent, dispatches a task, or
retries a step's own internal logic — those responsibilities still belong
entirely to the Milestone 4/8/9 modules that already had them. Milestone
11's five new modules do exactly one job each: **admit** work in priority
order, **describe** the shape of work as a graph, **record** what happened,
**report** on resource usage, and **let new agents in** safely.

---

## 2. New Modules Added

All under `os/runtime/scheduler/` (new folder, no existing folder touched):

| File | Role |
|---|---|
| `event-timeline.js` (`window.AxiomEventTimeline`) | Objective 4. A pure subscriber on the **existing** Event Bus (`bus.on('*', fn)`) — it invents no new events and never calls into any other module. Turns the bus's raw stream into a bounded (2,000 entries), queryable, `localStorage`-backed timeline: `.recent()`, `.since()`, `.byType()`, `.bySource()`, `.query()`. |
| `task-graph.js` (`window.AxiomTaskGraph`) | Objective 3. Reshapes data the Task Planner and Orchestrator already produce (`steps[].dependsOn`, live `status()`) into a normalized `{nodes, edges, roots, leaves, mode, order}` graph, for a single plan (`fromPlan`), a live run (`fromRun`), or the cross-job scheduler queue (`schedulerGraph`). Computes execution order via Kahn's algorithm and returns `null` (not a throw) on a cyclic graph. Never decomposes text itself — it only reads `AxiomTaskPlanner`'s and `AxiomOrchestrator`'s public output. |
| `task-scheduler.js` (`window.AxiomTaskScheduler`) | Objectives 1 and 5. The global admission layer: `.schedule(textOrPlan, {priority, dependsOn, retries})` returns `{taskId, promise}` immediately (background execution — never blocks the caller). Priority order (`critical`/`high`/`normal`/`low`) plus FIFO tie-break decides which queued task is admitted into the **existing** `AxiomJobManager.createJob()` next, bounded by a configurable `maxConcurrent`. Cross-task `dependsOn` (between separate scheduled tasks, distinct from the Orchestrator's own within-plan step dependencies) gates admission and cascades cancellation to dependents if an upstream task fails. `.cancel(taskId)` handles both not-yet-admitted (immediate) and already-running (delegates to `JobManager.cancelJob`) cases. Retries re-invoke the existing `JobManager.retryJob()` (which re-decomposes only the failed clauses), bounded the same way Executive AI bounds its own auto-retry loop. |
| `resource-monitor.js` (`window.AxiomResourceMonitor`) | Objective 6. Aggregates `AxiomAgentManager.snapshot()` (agent activity), `AxiomRuntimeMonitor.report()` (queue depth, task counts, latency — unchanged from Milestone 8, only read), `AxiomTaskScheduler.report()` (scheduler queue depth/counts), and real `window.performance` data (heap memory where Chrome exposes it, navigation/paint timing, and an opt-in async `sampleFrameRate()`) into one `.report()` call. Every browser-only field degrades to `null`/`[]` rather than throwing where the API isn't available. |
| `plugin-registry.js` (`window.AxiomPluginRegistry`) | Objective 8. A validated front door onto the **existing** `AxiomAgentManager.register()`/`.unregister()` — it performs no agent lifecycle work itself. Enforces that every plugin id is namespaced `plugin.*` (the ten core agents' `agent.*` namespace can never be claimed or overwritten), validates `id`/`name`/`version`, and rejects duplicate ids. Also listens on `plugin:register`/`plugin:unregister` bus events, so an external module never needs a direct JS reference to this file at all — only the ability to emit a structured event, per the brief's "all communication through structured runtime events" requirement. |
| `autonomous-executive.js` | Objectives 2 and 7. Extends **the same `window.AxiomExecutiveAI` object** Milestone 9 shipped — via `Object.assign`, exactly the pattern `m8-bootstrap.js`/`m9-bootstrap.js`/`m10-bootstrap.js` already use to extend `window.AxiomRuntime` — with `.scheduleAutonomous(request, opts)` and `.decideExecutionMode(text)`. `scheduleAutonomous` reuses Executive AI's own public `needsClarification()` guard, then `AxiomTaskPlanner.createExecutionPlan()` and `AxiomTaskGraph.decideMode()` to derive sequential/parallel/mixed from the **real dependency graph** (rather than the clause-count heuristic `buildStrategy()` uses internally), then hands the plan to `AxiomTaskScheduler.schedule()`. Also wires a bus listener on `executive:auto-request`, so **any agent** — not just a user turn — can trigger new, coordinated, multi-agent work by emitting one structured event, with no synchronous caller and no direct function reference. This is the autonomous collaboration path. |
| `m11-bootstrap.js` | Loads last. Confirms every Milestone 11 module initialized (and that `AxiomExecutiveAI.scheduleAutonomous` exists — verified separately since it extends an M9 object rather than exporting its own global), extends `window.AxiomRuntime` **non-destructively** with `.timeline`/`.taskGraph`/`.scheduler`/`.resourceMonitor`/`.plugins`, and adds `AxiomRuntime.selfTestM11()` in the same shape as `selfTest()`/`selfTestM8()`/`selfTestM9()`/`selfTestM10()`. |

---

## 3. Files Modified

Exactly **one** existing file changed, and only to load the new scripts:

- `os-shell.html` — seven new `<script>` tags added immediately after
  `os/runtime/conversation/m10-bootstrap.js` and before `os/core/window-manager.js`.
  No tag was removed or reordered, no other line in the file changed, and no
  CSS, layout, or visual markup was touched anywhere in this file or any other.

No other `.html`, `.css`, or existing `.js` file was modified. No file under
`os/core/`, `os/runtime/` (outside the new `scheduler/` folder), or any of
Milestones 4–10's deliverables was edited.

---

## 4. Architectural Decisions

- **Admission layer, not a second executor.** `AxiomTaskScheduler` never
  calls the Orchestrator or Agent Manager directly — every unit of work it
  admits is handed to the unmodified `AxiomJobManager.createJob()`, which is
  what actually runs it. This is what keeps the "no duplicate managers, no
  duplicate task executions" requirement true structurally rather than by
  convention: there is exactly one code path from "a task is ready to run"
  to "an agent receives a `task:assign` event," and Milestone 11 sits only
  in front of its entrance.
- **Task-level vs. step-level dependencies are deliberately two different
  mechanisms.** The Orchestrator already owns dependencies *within* one
  plan (`steps[].dependsOn`, e.g. "remember it" waits on "search AI news").
  `AxiomTaskScheduler`'s `dependsOn` is a *different* graph, one level up:
  dependencies *between separate scheduled jobs* (e.g. "don't start the
  weekly report job until yesterday's data-sync job has completed"). Merging
  these into one mechanism would have meant reaching into the Orchestrator's
  internals; keeping them separate meant zero changes to `orchestrator.js`.
- **Executive AI is extended, never edited.** Every prior milestone in this
  codebase (8, 9, 10) added capability to a previous layer by assigning new
  properties onto the shared object after it loads, never by editing that
  object's source file. `autonomous-executive.js` follows the identical
  pattern for `window.AxiomExecutiveAI`. This was a deliberate choice to
  match the codebase's own established discipline rather than introduce a
  second style of "extension" for this milestone alone.
- **Graph-derived mode decision is additive, not a replacement.** Executive
  AI's existing `buildStrategy()` (used by `handle()`, Milestone 9,
  unchanged) still makes its sequential/parallel call from clause
  decomposition plus the learning ledger — that pipeline is untouched.
  `scheduleAutonomous()` / `decideExecutionMode()` is a **second**,
  structurally-derived decision (walking the actual dependency graph via
  Kahn's algorithm) used only on the new scheduled/autonomous path. Both
  co-exist rather than one silently overriding the other.
- **Plugin namespace is enforced, not just documented.** `plugin-registry.js`
  hard-rejects any id starting with `agent.` (reserved for the ten core
  agents) and requires the `plugin.` prefix on every registration, whether
  it arrives via a direct function call or the `plugin:register` bus event.
  A malicious or careless plugin literally cannot collide with or overwrite
  a core agent's id.
- **Re-entrancy guard on the scheduler's admission loop.** `schedule()`
  never admits synchronously; it defers to a microtask (`scheduleTick`) so
  that a burst of `schedule()` calls in the same tick collapses into one
  admission pass instead of racing itself — this is what the regression
  suite's "scheduler admits a task into the Job Manager exactly once"
  check verifies directly (by counting real `JobManager.createJob` calls).

---

## 5. Runtime Changes

- **No existing bus event types were changed or removed.** Milestone 11
  adds new, purely additive families: `scheduler:*` (`queued`/`admitted`/
  `retry`/`completed`/`failed`/`cancelled`), `plugin:*`
  (`registered`/`registration-rejected`/`unregistered`), and two additions
  to the existing `executive:*` family (`executive:scheduled`,
  `executive:autonomous-<status>`) — all observed by `AxiomEventTimeline`
  the same way it observes every other event, through the wildcard channel
  the bus already exposed.
- **No change to agent registration for the ten core agents, the Task
  Router's rules, the Orchestrator's execution model, the Job Manager's
  retry/adapt logic, or Executive AI's `handle()` supervision loop.**
  `AxiomExecutiveAI.handle()` keeps exactly the signature and semantics
  Milestone 9 shipped; `scheduleAutonomous()` is a new, separate method,
  not a replacement.
- **Plugin agents are real `Agent` instances**, going through the identical
  offline → initializing → idle lifecycle, task queue, and status-transition
  machinery every core agent already uses (`agent-runtime.js`'s `Agent`
  base class) — `plugin-registry.js` adds no parallel agent implementation.

---

## 6. Verification Performed

`jsdom` was not installable in this execution environment (no package
registry access), so `test-evidence/milestone11-regression-suite.js` uses a
minimal Node `vm`-context browser shim instead — built by first grepping
every runtime file for the exact browser APIs it touches
(`document.addEventListener/dispatchEvent`, `CustomEvent`, `localStorage`,
`BroadcastChannel` feature-detection, `window.performance`) and implementing
only those, so the suite still loads and runs the **real, unmodified**
source files in production order (identical list to `os-shell.html`'s
`<script>` tags), against the same lightweight in-memory fakes for the two
external backends (`AxiomAgents`, `AxiomBrowserLive`) the Milestone 5/6/10
suites already use — never against a mock of the runtime itself.

Full output: `test-evidence/milestone11-regression-output.txt` — **41/41
checks passed**, including:

- **Regression, Milestones 4–10:** `AxiomRuntime.selfTest()`, `selfTestM8()`,
  `selfTestM9()`, and `selfTestM10()` all still pass unchanged; still exactly
  10 core agents with no duplicates after all Milestone 11 activity.
- **Milestone 11 self-test** (`AxiomRuntime.selfTestM11()`, 27/27):
  - **Priorities:** with `maxConcurrent` forced to 1, a `critical`-priority
    task scheduled *after* a `low`-priority one is admitted first.
  - **Dependencies:** a task with an unsettled `dependsOn` stays queued;
    cancelling an upstream task cascades cancellation to its dependents.
  - **Cancellation:** a still-queued task cancels immediately and resolves
    `cancelled` without ever reaching the Job Manager.
  - **Task graph:** a "then"-chained plan builds a graph classified
    sequential/mixed (never parallel); an independent multi-agent plan
    builds without throwing; a deliberately cyclic graph returns `null` for
    topological order instead of throwing.
  - **Event timeline:** a freshly emitted bus event is recorded with a
    timestamp and is retrievable by type and by source.
  - **Resource monitor:** `.report()` returns agent activity, queue depth,
    task counts, latency, scheduler counts, and a browser-metrics section
    together in one call.
  - **Plugin registry:** rejects an id in the reserved `agent.*` namespace,
    registers a valid `plugin.*` agent through the real Agent Manager, that
    agent actually executes a dispatched task end-to-end, and `unregister()`
    removes it from both the registry and the Agent Manager.
  - **Executive AI extension:** `decideExecutionMode()` derives a
    non-parallel mode for a dependent request and a non-sequential mode for
    an independent one, and the two are never collapsed to the same
    decision; `scheduleAutonomous()` returns immediately (background
    execution) and its promise reaches a terminal status.
  - **Event-driven autonomous collaboration:** emitting
    `executive:auto-request` on the shared bus — with no direct function
    call — autonomously triggers Executive AI to plan and schedule new work.
- **Targeted checks beyond the built-in self-test:** the scheduler calls
  `JobManager.createJob` **exactly once** per admitted task (verified by
  wrapping and counting real calls — the "no duplicate task executions"
  requirement, proven rather than assumed); the plugin registry rejects a
  second registration of an already-used id and a non-namespaced id;
  resource-monitor browser metrics degrade to `null`/`[]` without throwing;
  and the Event Bus / Agent Manager / Job Manager / Orchestrator / Executive
  AI singletons, plus the absence of any `*2`-suffixed duplicate manager
  global, are confirmed after Milestone 11 loads.

---

## 7. Remaining Limitations

- **Scheduler state is in-memory only, per tab/session.** Unlike
  `AxiomJobManager` (which persists job records to `localStorage`) or
  Executive AI's learning ledger, the scheduler's own queue and task
  records do not survive a full page reload — a called-out limitation
  rather than a silent gap. An admitted task's underlying **job** does
  still persist via the existing Job Manager; only the scheduler's
  priority-queue bookkeeping around it does not.
- **Priority is cooperative, not preemptive.** A `critical` task scheduled
  while `maxConcurrent` slots are already full waits for a slot to free up
  — Milestone 11 does not interrupt or pause an already-running lower
  priority job to make room, matching the Orchestrator's own cooperative
  (not forcible) cancellation model.
- **Cross-task `dependsOn` is scheduler-level, not persisted across a
  browser crash mid-run** — the same in-memory caveat as above applied to
  dependency edges specifically: if the tab closes while a dependency is
  still queued, that edge is lost along with the rest of the queue.
- **The graph-derived execution-mode decision (`decideExecutionMode`,
  `AxiomTaskGraph.decideMode`) is structural, not semantic** — it correctly
  reads the dependency graph the Task Planner already built from clause
  order, but the Task Planner's own clause segmentation is still the
  linguistic heuristic documented in Milestone 8, not a change introduced
  here. A request whose clauses that heuristic segments incorrectly will
  produce a structurally-correct decision over an incorrectly-shaped graph.
- **Frame-rate sampling (`AxiomResourceMonitor.sampleFrameRate`) is real
  but opt-in and async** (it must observe actual animation frames over a
  window of real time), so it is intentionally excluded from the
  synchronous `.report()` call — a caller polling resource usage on an
  interval should not unexpectedly pay for a ~1-second sampling window on
  every poll.
- **`jsdom` was unavailable in this execution environment** (no package
  registry access), so verification used a hand-built minimal `vm` shim
  instead of the jsdom harness prior milestones used. The shim was built by
  auditing every browser API the runtime touches rather than guessing, and
  it runs the identical unmodified source files in the identical load
  order — but it is a narrower shim than a full jsdom `window`/`document`,
  so it would not catch a bug that depended on a browser API this milestone
  never actually uses.
