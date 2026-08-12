# AXIOM AI OS — Milestone 9 Deliverables
Executive AI — a supervisory brain above the Task Router

## Scope note (read this first)

This delivery targets **os-shell.html**, the same page Milestone 8
wired up. It adds exactly one new capability — an Executive AI layer
that plans, coordinates and supervises — and changes nothing else.

**No existing runtime file was modified.** No CSS, layout, or visual
component was touched. No Milestone 8 module was edited or
duplicated. Every addition is two new files under a new
`os/runtime/executive/` folder, wired in with two new `<script>` tags
appended to `os-shell.html` (the only edit to an existing file),
loaded *after* the entire Milestone 8 intelligence layer.

The brief's hard constraint — **"the Executive AI must NOT directly
execute tasks; it only plans, coordinates, and supervises"** — is
enforced structurally, not just by convention: `executive-ai.js` never
imports or calls an agent handler, never touches storage, and never
calls `AxiomAgentManager.dispatch()` with a "do the work" task itself.
The only two things it ever calls to make anything happen are
`AxiomJobManager.createJob()` (which runs through `AxiomOrchestrator`
→ `AxiomAgentManager.dispatch()`) and `AxiomAgentManager.route()` (to
hand a memory-write note to the Memory Agent, the same public entry
point every other caller in this codebase uses). Both are existing,
unmodified Milestone 4/8 entry points.

## New modules (`os/runtime/executive/`)

| File | Adds |
|---|---|
| `executive-ai.js` | The Executive AI itself — `window.AxiomExecutiveAI`. Analyzes intent, decides on clarification, loads memory, builds a strategy, submits work, supervises it, adapts on failure, learns, writes memory back. |
| `m9-bootstrap.js` | Verifies the module loaded, extends `window.AxiomRuntime` with a `.executive` accessor, adds `AxiomRuntime.selfTestM9()`. |

## What Executive AI does, and what it calls to do it

**Analyze user intent** — `analyzeIntent()` is a thin passthrough to
the existing `AxiomTaskPlanner.analyzeIntent()`. No new NLU, no
duplicate parsing.

**Decide whether clarification is required** — new logic
(`needsClarification()`), because nothing in Milestones 4–8 made this
call. Two honest heuristics, not a trained classifier: (1) the request
is a bare pronoun reference ("do it", "fix that", "continue") with
nothing in the same turn to resolve it against; (2) the exact same
request text has already failed through Executive AI
`MAX_AUTO_RETRIES` times in a row this session — asking rather than
re-running a plan that's already demonstrated it doesn't work.

**Load relevant memory automatically** — before building a plan,
`loadMemory()` calls the existing
`AxiomMemoryIntelligence.rankedRecall('agent.memory', text, 5)` and
attaches the result to the run's shared context (`AxiomContextStore`)
once the Orchestrator assigns a `runId`, via the store's own public
`merge()` API. No new memory backend, no new ranking logic.

**Create an execution strategy** — `buildStrategy()` calls the
existing `AxiomTaskPlanner.createExecutionPlan()` (which itself calls
the existing Task Router per clause — routing logic is not touched).
Executive AI's only original contribution here is annotating the
result: choosing a `mode` (`single` / `parallel` / `sequential`) and a
concurrency/retry hint, using the *existing* `dependsOn` mechanism the
Orchestrator already understands.

**Decide between sequential and parallel execution** — a compound
request with no explicit ordering word and more than one distinct
agent already decomposes into independent (parallel-eligible) steps.
Executive AI's judgement call: if the *learning ledger* shows that
exact agent-chain shape has failed more than half the time it's been
tried, it chains those steps into a sequence instead (same
`dependsOn` field the Orchestrator already reads) and lowers
concurrency to 1 — a supervisory decision, not new orchestration
logic.

**Dynamically choose the required agents** — inherited directly from
the Task Router / Task Planner, which already does this per clause.
Executive AI surfaces the chosen agent set in `report()` and
`status()` but does not re-derive it.

**Monitor execution** — `superviseJob()` listens to the existing
`job:progress` / `job:completed` / `job:failed` / `job:cancelled`
bus events (the same events `job-manager.js` already emits) and to
`orchestrator:run-started` to capture the live `runId`. `status(id)`
additionally calls the existing `AxiomOrchestrator.status(runId)` for
a live step-by-step snapshot. No new event types were needed for
monitoring; only `executive:*` events documenting Executive AI's own
decisions were added (see below).

**Adapt the plan if a task fails** — on `job:failed`, Executive AI
does not re-implement retry logic (that already exists twice over: a
step-level retry in `orchestrator.js`, and a job-level
`JobManager.retryJob()` that re-decomposes only the failed clauses).
It adds the missing supervisory layer on top: decide *whether* to
call `retryJob()` again, bounded at `MAX_AUTO_RETRIES` (2), and once
that bound is hit, stop and escalate to `needs-clarification` instead
of looping forever. Every automatic retry and every escalation is
recorded in the learning ledger and emitted on the bus
(`executive:adapting`, `executive:clarification-needed`).

**Learn from completed workflows** — a small persisted ledger
(`localStorage`, key `axiom-executive-ledger`), keyed by the ordered
agent-chain "signature" a request decomposed into (e.g.
`agent.browser>agent.research>agent.memory>agent.planner`), tracking
success/fail counts and total duration. This ledger is what feeds
back into the sequential-vs-parallel decision and the retry-count
tuning passed to the Orchestrator (`opts.retries`). Documented plainly
as a heuristic tally, not a model — consistent with how this codebase
already describes `memory-intelligence.js` and
`planner-intelligence.js`.

**Update Memory automatically** — on a completed (or terminally
failed) run, `writeMemory()` calls
`AxiomAgentManager.route({ agentId: 'agent.memory', op: 'remember', note })`
— an explicit-agent structured request, which the Task Router already
supports (`route()`'s `norm.structured.agentId` branch) and which
resolves through the Agent Manager's own `dispatch()`, identical to
every other memory write in this codebase. Executive AI never touches
`AxiomAgents` or storage directly.

## Constraint compliance, stated plainly

- **No runtime redesign, no architecture replacement.** Every existing
  file in `os/runtime/` (Milestones 4–8) is untouched, byte-for-byte.
- **All execution continues through Agent Manager / Task Router /
  Event Bus / Orchestrator.** Traced in testing below — every task
  Executive AI causes to run shows up as a normal `task:assign` bus
  envelope dispatched by `AxiomAgentManager`, inside a normal
  `AxiomOrchestrator` run, inside a normal `AxiomJobManager` job.
- **No duplicated runtime logic.** Routing, decomposition, retry,
  timeout, context sharing, ranking and health monitoring all remain
  single-sourced in their Milestone 4/8 homes; Executive AI calls
  them and adds only the four decisions nothing else in the codebase
  was making (clarify-or-not, parallel-or-sequential-under-risk,
  retry-or-escalate, and what to remember).

## Verification performed

All of the following were run against the real `os-shell.html` in a
headless Chromium session (Playwright), not asserted from reading the
code:

- The existing Milestone 4 self-test (`AxiomRuntime.selfTest()`):
  **11/11 passed** — no regression to agent boot, routing, or
  end-to-end dispatch.
- The existing Milestone 8 self-test (`AxiomRuntime.selfTestM8()`):
  **8/8 passed** — no regression to decomposition, the orchestrator,
  monitoring, error recovery, planner intelligence, or job creation.
- The new Milestone 9 self-test (`AxiomRuntime.selfTestM9()`):
  **8/8 passed** — a vague request ("do it") short-circuits to
  clarification without ever producing a job; answering the
  clarification re-enters the normal pipeline; a concrete request
  reaches a terminal status; `status()` reports real plan/job/run
  linkage; `report()` returns the learning ledger; the run traces
  back to a real, tracked Orchestrator run.
- A genuinely compound, multi-agent request ("research AI agent
  startups, then remember the best ones, then create a plan")
  submitted through `AxiomExecutiveAI.handle()` correctly decomposed
  into 4 sequential steps across `agent.browser` → `agent.research` →
  `agent.memory` → `agent.planner`, and completed.
- Forced the Coding Agent's handler to throw on every call, then
  submitted "write code for a login form": confirmed Executive AI
  auto-retried twice via `JobManager.retryJob()`
  (`executive:adapting` fired twice), then — once the bound was hit —
  stopped and escalated to `needs-clarification`
  (`executive:clarification-needed`) rather than retrying forever.
  The learning ledger correctly recorded 3 failures for the
  `agent.coding` signature and the exact request text was tracked
  with a consecutive-failure streak of 1.
- Confirmed a completed run dispatches a real `task:assign` envelope
  to `agent.memory` with `op: 'remember'` — captured on the bus, the
  same path any other memory write in this codebase takes — rather
  than any direct storage call.

## Remaining limitations (stated plainly, not glossed over)

- **Clarification and "learning" are heuristics, not models** — a
  fixed pronoun-phrase list and a simple win/loss tally, in the same
  spirit as this codebase's existing "semantic recall" and scheduling
  heuristics. They handle the clear cases (a bare "do it", a
  repeatedly-failing exact phrase) and will not catch subtler
  ambiguity a trained intent model might.
- **The recalled-memory context attached to a run is available for
  any agent to read via `AxiomContextStore.get(runId)`, but no
  existing agent handler currently reads it.** Executive AI loads and
  attaches the memory; wiring individual agent handlers to consult it
  is out of this milestone's scope (would mean editing
  `agent-definitions.js`, which the brief says not to touch).
- **The learning ledger is per-browser (`localStorage`), not
  per-user or cross-session-synced**, the same persistence tier
  `job-manager.js` and `planner-store.js` already use — it survives a
  reload but not a different browser or device.
- **Runtime-goal matching to capture a live `runId`** (needed to
  attach recalled memory to the right run) matches on the exact goal
  string via a one-shot bus listener registered immediately before
  submission. Two Executive AI runs submitted in the exact same tick
  with byte-identical goal text could theoretically race; this has
  not been observed in testing and is a narrow edge case worth noting
  rather than a correctness gap seen in practice.
- **Only `os-shell.html` was wired up**, matching the scope Milestone
  8 already established for this runtime. Adding the same two
  `<script>` lines (after that page's existing Milestone 8 lines) is
  enough to bring Executive AI online on another page.
