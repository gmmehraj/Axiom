# AXIOM — Block 2 → Step 6 → Part 6B: Stabilization Pass

**Date:** 2026-08-01
**Scope:** Two changes, both implemented and verified in this pass.
No redesign, no new features, no public API changes.

## 1. Step 6 stack wired into the active application

**Investigation, not assumption:** the repo's own `SYSTEM_REGISTRY.md`
(pre-existing, not written by me) already documents this exact question
and answers it: `os/core/orchestrator.js` also collides on the global
name `window.AxiomOrchestrator` with `os/runtime/intelligence/orchestrator.js`,
the orchestrator `os-shell.html` already loads. The same document names
the intended integration target: `automation.html`, "which already loads
all four non-Analytics subsystems" the Step 6 stack's soft dependencies
expect.

I independently re-verified both claims before acting on them:
- Confirmed the collision: `grep` for `window.AxiomOrchestrator =` finds
  it in exactly two files — `os/core/orchestrator.js` and
  `os/runtime/intelligence/orchestrator.js`.
- Confirmed `automation.html` does not load
  `os/runtime/intelligence/orchestrator.js` or any other file that
  defines `window.AxiomOrchestrator` (checked its `<script>` tags and
  grepped `os/runtime/task-router.js`, `agent-manager.js`,
  `runtime-bootstrap.js`, `agent-runtime.js` — none of the other
  `os/runtime/` files it loads claim that name).
- Confirmed no collision on the other four Step 6 exports
  (`AxiomCapabilityRouter`, `AxiomWorkflowPlanner`, `AxiomRuntimeContext`,
  `AxiomAgentRegistryIntegration`) anywhere in the repo.

**What was changed:** five `<script defer>` tags added to
`automation.html`, immediately after `os/core/automation-manager.js`
(which is itself after Brain/Memory/Browser/Automation are already
loaded on that page, satisfying `agent-registry-integration.js`'s soft
lookups):

```html
<script defer src="os/core/orchestrator.js"></script>
<script defer src="os/core/runtime-context.js"></script>
<script defer src="os/core/capability-router.js"></script>
<script defer src="os/core/agent-registry-integration.js"></script>
<script defer src="os/core/workflow-planner.js"></script>
```

Order matches each module's verified dependency requirement:
`orchestrator.js` first (base, no dependencies), `runtime-context.js`
before `workflow-planner.js` (a hard requirement per the Part 4
regression suite), the rest ordered consistently with the dependency
graph in `DEPENDENCY_GRAPH.md`.

**No file under `os/runtime/` was touched.** `os-shell.html` is
completely unmodified — it still loads only the legacy
`os/runtime/intelligence/orchestrator.js` stack, exactly as before. No
duplicate orchestrator now exists on any single page: `os-shell.html`
has the legacy one, `automation.html` now has the Step 6 one, and they
don't overlap.

**Verified, not assumed, that this doesn't throw:** wrote a load-order
simulation (Node `vm`, with a stub `document` supporting
`addEventListener`/`readyState`) that loads the five files in the exact
order now present in `automation.html`, then fires `DOMContentLoaded`.
Result: all five load with no exceptions, all five expected globals are
defined afterward (`object`, not `undefined`), and
`AxiomAgentRegistryIntegration`'s own boot logic runs correctly
(registers its always-available `system` agent; the other four
soft-lookups correctly find nothing in the stub sandbox, since it
doesn't stub Brain/Memory/Browser/Automation — on the real
`automation.html` page those are present).

**What this does and doesn't mean:** the Step 6 stack is now present and
self-initializing on `automation.html` — `window.AxiomOrchestrator`,
`.AxiomRuntimeContext`, `.AxiomCapabilityRouter`,
`.AxiomAgentRegistryIntegration`, and `.AxiomWorkflowPlanner` all exist
and are live objects on that page now. What this pass did **not** do:
repoint any existing UI code on `automation.html` to actually call
`dispatch()`/`route()`/`executeWorkflow()` instead of whatever it
currently calls. That's the difference between "loaded and available"
and "driving behavior" — the latter means changing what other files
call, which is a behavior change beyond "activating the verified Step 6
runtime" as scoped, and wasn't done here.

## 2. Bounded retention for completed tasks and workflows

Implemented in both files, following the exact `HISTORY_LIMIT` pattern
already used by `capability-router.js` (`HISTORY_LIMIT = 500`) and
`runtime-context.js` (`HISTORY_LIMIT = 1000`).

**`os/core/orchestrator.js`:**
- Added `var MAX_COMPLETED_TASK_HISTORY = 1000;` (a plain top-of-scope
  constant, same declaration style as the existing `HISTORY_LIMIT`s —
  configurable by editing the value).
- Added `isFinishedStatus(status)` and `pruneFinishedTaskHistory()`
  helpers inside `createScheduler()`.
- Wired `pruneFinishedTaskHistory()` into all five places a task reaches
  a genuinely terminal state: `cancel()`, the two immediate-failure
  branches in `runTask()` (unknown agent, disabled agent), and the two
  terminal branches of `finishSuccess()`/`finishFailure()` (the
  retry-and-requeue branch inside `finishFailure()` is untouched — it's
  not a terminal transition).
- `clearHistory()` (the existing manual `clearTaskHistory()` API) now
  calls the same `isFinishedStatus()` helper instead of duplicating the
  same inline check — same behavior, single source of truth.
- Pruning only ever removes entries whose status is `completed`,
  `failed`, `cancelled`, or `timed_out`. It never inspects or removes
  `queued`/`running` entries.

**`os/core/workflow-planner.js`:**
- Added `var MAX_COMPLETED_WORKFLOW_HISTORY = 1000;` (same style).
- Added `pruneFinishedWorkflowHistory()`, reusing the module's existing
  `TERMINAL_WORKFLOW_STATUSES` array rather than introducing a second
  definition of "terminal."
- Wired it into all six places a workflow reaches a terminal state:
  topological-order failure, cooperative-cancel (two call sites — before
  and during a pause), stage failure, successful completion, and
  cancel-before-start.
- Previously this file had **no** bounding and no manual release valve
  at all (the gap noted in `MEMORY_AUDIT.md`); it now has both the
  automatic bound and, implicitly, the same manual-clear pattern would
  be a trivial follow-on if wanted (not added — wasn't asked for and
  `capability-router.js`/`runtime-context.js` don't expose a manual
  clear either, only the auto-bound).

**No public API changed in either file.** `getTask()`, `listTasks()`,
`getStats()`, `getWorkflow()`, `listWorkflows()`, `getWorkflowMetrics()`,
`clearTaskHistory()` all keep their existing signatures and return
shapes. The only observable behavior change is that a `getTask()`/
`getWorkflow()` call for an id old enough to have aged out of the
1,000-entry finished-history window now returns `undefined` instead of
the full record — the same trade-off `capability-router.js` already made
for its own history, and the reason this wasn't done silently in the
previous pass without flagging it first.

### Empirical verification (not just re-running the existing suites)

Wrote two new stress scripts against the real, modified source:

- **Orchestrator:** dispatched 5,000 tasks with one permanently-`running`
  task and a large `queued` backlog left in flight. Result:
  `completed: 1000` (capped exactly at the constant), the running task
  still present and still `running`, all queued tasks still present and
  untouched. Total retained: `3333` = 1000 finished + 1 running + 2332
  still queued.
- **Workflow Planner:** ran 1,500 workflows to completion — retained
  count capped at exactly `1000`. Then started one long-running workflow
  (stuck on a never-resolving handler) and ran 200 more workflows to
  completion past the cap — the in-flight workflow was still present and
  still `running` throughout; final retained count `1001` (1000 finished
  + 1 active), confirming active workflows are never pruned regardless
  of how much finished-history churn happens around them.

## 3. Regression suites re-run against the modified source

| Suite | Result |
|---|---|
| Part 1 — Orchestrator | 21/21 passing |
| Part 2 — Agent Registry Integration | 18/18 passing |
| Part 3 — Capability Router | 20/20 passing |
| Part 4 — Workflow Planner | 29/29 passing |
| Part 5 — Runtime Context | 42/42 passing |
| **Total** | **130/130 passing — unchanged from the pre-fix baseline** |

No existing assertion needed modification. The retention fix is
additive behavior (pruning only fires once the 1,000-entry threshold is
crossed), so none of the existing suites — which don't dispatch
anywhere near that volume — observed any difference.

## What was not done in this pass

- No `MODULE_NOT_FOUND` suites (Step 1, milestones 5/6/10) were
  investigated or fixed — still out of scope, unchanged from
  `STEP6_VALIDATION_REPORT.md`.
- No UI code on `automation.html` was changed to actually call into the
  newly-available Step 6 objects — see the "what this does and doesn't
  mean" note above.
- No dead-code/coverage-tool analysis was performed (still marked Not
  Fully Verified in the prior pass's `ARCHITECTURE_AUDIT.md` — unrelated
  to this pass's scope).
