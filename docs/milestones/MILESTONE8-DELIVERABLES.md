# AXIOM AI OS — Milestone 8 Deliverables
AI Intelligence & Multi-Agent Collaboration

## Scope note (read this first)

This delivery targets **os-shell.html**, the page Milestone 7 shipped
(`AXIOM-Milestone7-Page1-os-shell.zip`). The runtime it builds on
(`os/runtime/*`) was already considerably more advanced than a bare
keyword router by the end of Milestone 6 — named multi-agent
workflows, per-capability retry/timeout, a planner store with
dependencies/deadlines, and a memory backend with short-term/long-term
split and a keyword-overlap "semantic recall" all already existed.
Where that was true, this milestone did **not** re-implement it. The
sections below say plainly, for each of the ten tasks in the brief,
what already existed and what is newly added.

No existing runtime file was modified. No CSS, layout, or visual
component was touched. Every addition is a new file under
`os/runtime/intelligence/`, wired in with new `<script>` tags added to
`os-shell.html` (the only edit to an existing file) plus two new rows
in the Task Router registered through its existing public `addRule()`
API — the same extensibility point named workflows already use.

## New modules (`os/runtime/intelligence/`)

| File | Adds |
|---|---|
| `context-store.js` | Shared per-run context (results/status/errors/progress/metadata) exchanged only via the Agent Event Bus or this module's API — no global mutable object. |
| `task-planner.js` | Splits a compound free-text request into ordered clauses, routes each through the *existing* Task Router, and links them into a dependency graph. |
| `orchestrator.js` | Generic engine that executes an arbitrary step graph in dependency order, with per-step retry/backoff/timeout, pause/resume/cancel. |
| `job-manager.js` | Persists an orchestrator run as a background "job" (localStorage), batches progress events, exposes cancel/pause/resume/retry. |
| `error-recovery.js` | Watches the bus for an agent failing repeatedly and restarts it via the existing `AgentManager.deactivate/activate`; tallies timeouts. |
| `runtime-monitor.js` | Tracks queue depth, running/failed task counts, and processing-time (avg/p95) per agent from real bus events — no UI. |
| `planner-intelligence.js` | Adds re-prioritization, one-shot scheduling, and ETA estimation on top of the existing `AxiomPlanner` store. |
| `browser-intelligence.js` | Adds search-query planning and saved/replayable browser macros on top of the existing `AxiomBrowserBridge`. |
| `memory-intelligence.js` | Adds a recency+importance+relevance ranking pass and tag suggestions on top of the existing memory recall API. |
| `dynamic-workflow.js` | Registers the new `dynamicDecomposition` workflow with the Task Router for genuinely compound, multi-agent, sequential requests. |
| `m8-bootstrap.js` | Verifies all of the above loaded, extends `window.AxiomRuntime` with accessors, adds `AxiomRuntime.selfTestM8()`. |

## Task-by-task

**1. Intelligent Task Planning** — `task-planner.js` decomposes a
request into ordered steps (`splitClauses`/`analyzeIntent`/
`decompose`), each one routed by the existing Task Router rather than
a new keyword system. Dependencies are wired clause-to-clause;
`createExecutionPlan()` registers the result in the existing
`AxiomPlanner` store so progress tracking is the same store the OS
already had. Retries happen in `orchestrator.js` (Task 9).

**2. Multi-Agent Collaboration** — `orchestrator.js` runs the
decomposed graph; every hop is still a plain `AgentManager.dispatch()`
+ `task:completed`/`task:failed` bus listen, identical to how the
Milestone 5 named workflows already talk to agents. No agent calls
another directly anywhere in this delivery.

**3. Agent Context Sharing** — `context-store.js`. Read/write only via
its functions or `context:set`/`context:merge` bus events; every
`get()` returns a clone, so nothing outside the module holds a
mutable reference.

**4. Long-Running Tasks** — `job-manager.js` + `orchestrator.js`
together: background execution (`createJob` returns immediately),
batched progress events (`job:progress`, coalesced every 250ms rather
than one event per micro-update), and cancel/pause/resume/retry, all
verified below.

**5. Memory Improvements** — short-term memory, long-term memory,
recent history, conversation context, and a keyword-overlap semantic
recall already existed (agents.js / agent-definitions.js, Milestones
5–6). Added: `memory-intelligence.js`'s recency+importance+relevance
ranking and tag suggestions.

**6. Browser Intelligence** — multi-tab, page summarization, and link
extraction already existed (`browser-bridge.js`, Milestone 6). Added:
`browser-intelligence.js`'s search-query planning
(`planSearch`/`researchMultiTab`) and saved/replayable macros
(`recordMacro`/`runMacro`) — the "website automation" and "search
planning" pieces the brief calls out.

**7. Planner Intelligence** — create/track/prioritize already existed
(`planner-store.js`, Milestones 5–6). Added: `planner-intelligence.js`
re-prioritization (`reprioritize`, dependency+deadline aware),
one-shot scheduling (`scheduleWorkflow`), and ETA estimation
(`estimate`, derived from the plan's own recorded execution history).

**8. Runtime Monitoring** — agent status/health already existed
(`agent-manager.js`'s `health()`/heartbeat). Added:
`runtime-monitor.js` tracks queue size per agent, running task list,
completed/failed/retried counters, and processing-time avg/p95 —
pure data, no panel, since the brief prohibits UI changes.

**9. Error Recovery** — per-capability retry/timeout/cancel already
existed (`capability-kit.js`); per-step retry in a workflow now lives
in `orchestrator.js`. Added: `error-recovery.js` watches for an agent
failing repeatedly *across* unrelated tasks and restarts it through
the existing public `AgentManager.deactivate()`/`activate()`.

**10. Performance** — deliberately scoped, not a rewrite of the
existing (already efficient) event bus: `job-manager.js` batches
progress notifications instead of emitting one bus event per update;
`orchestrator.js` runs independent steps concurrently (bounded, default
3) instead of one-at-a-time; `runtime-monitor.js` keeps bounded ring
buffers (200 duration samples, 60 report snapshots) so a long session
cannot leak memory.

## Verification performed

All of the following were run against the real `os-shell.html` in a
headless Chromium session (Playwright), not asserted from reading the
code:

- The existing Milestone 4 self-test (`AxiomRuntime.selfTest()`):
  **11/11 passed** — confirms no regression to agent boot, routing, or
  end-to-end dispatch.
- The new Milestone 8 self-test (`AxiomRuntime.selfTestM8()`):
  **8/8 passed** — decomposition produces ordered, dependency-linked,
  multi-agent steps; the orchestrator runs a plan to completion; the
  monitor/error-recovery reports have the right shape; planner
  estimate/reprioritize work on a real plan; the job manager creates a
  trackable job.
- Regression check on the required example phrases — "open youtube
  and search music", "search Google for AI news", "remember this...",
  "create a learning plan" — each still routes to exactly the agent it
  did before this change.
- A genuinely compound request ("research AI startups, then remember
  the best ones, then create a plan") submitted through
  `AxiomRuntime.submit()` (the real, unmodified entry point) was
  correctly decomposed into 4 ordered/dependent steps, ran as a
  background job, and updated progress.
- Multiple simultaneous requests submitted back-to-back were all
  accepted; agent status/queue snapshots showed correct concurrent
  handling (busy agent showing a queued task, others processing and
  returning to idle) with no dropped or duplicated tasks.
- Forced an agent handler to fail three times in a row: confirmed
  `error-recovery.js` detected the pattern and restarted the agent
  (`recovery:agent-restart` event fired; action logged).
- Forced an agent handler to fail twice then succeed inside an
  orchestrator run with `retries: 3`: confirmed the step retried and
  the run completed successfully on the third attempt.
- Created a job, paused it mid-flight, confirmed its status became
  `paused` and no further steps advanced, then resumed it and confirmed
  it continued.

## Remaining limitations (stated plainly, not glossed over)

- **Task decomposition is a linguistic heuristic** (sequencing words,
  punctuation, conjunctions), not a trained intent model — consistent
  with how this codebase already documents its "semantic recall" as an
  honest approximation rather than a fake NLU engine. It handles clear
  "do X, then Y, then Z" phrasing well; ambiguous prose can decompose
  imperfectly.
- **Jobs and schedules do not survive a full page reload.** Their
  terminal state (completed/failed/cancelled) is persisted to
  localStorage and readable afterward, but an in-flight orchestrator
  run or a pending `scheduleWorkflow()` timer is lost on refresh — this
  OS has no backend process to host them across reloads.
- **Runtime monitoring has no visual panel**, per the brief's
  "don't modify page layouts" instruction — it is a pure data/event API
  (`AxiomRuntimeMonitor.report()`/`.subscribe()`). A future milestone
  that's explicitly scoped to add UI could surface it.
- **Only `os-shell.html` was wired up.** Other pages in this bundle
  (`memory.html`, `browser.html`, `automation.html`, etc.) already
  include the Milestone 4–6 runtime scripts but were not given the
  three new `<script>` lines, since this milestone's stated target is
  the os-shell page delivered in Milestone 7. Adding the same three
  lines to another page's script list is enough to bring it online
  there too.
- **Memory ranking degrades honestly, not silently**: importance/
  confidence fields only exist on the memory-workspace demo dataset
  today, not on the real `agent_memory` table, so a missing field is
  scored neutrally (0.5) rather than fabricated.
