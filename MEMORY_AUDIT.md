# AXIOM — Block 2 → Step 6 — Part 6A: Memory Audit

**Date:** 2026-08-01
**Method:** Source inspection plus executed stress scripts against the
real, unmodified files in a Node `vm` sandbox (same loading pattern the
project's own regression suites use). Scripts and raw output below;
nothing in this document is inferred without a corresponding script run
or grep result.

## Finding 1 (verified defect candidate): orchestrator.js retains every finished task forever

**Evidence:** wrote a script that loads the real `orchestrator.js`,
registers one agent, dispatches 3,000 tasks, waits for the queue to
fully drain, then reads `getStats()` and `listTasks()`.

```
after 3000 dispatches, getStats(): {"agents":1,"healthyAgents":1,
  "tasks":{"queued":0,"total":3000,"byStatus":{"completed":3000}}}
listTasks length: 3000
```

All 3,000 tasks completed; all 3,000 records remained in
`Scheduler.tasksById`. Source confirms why: `tasksById[task.id] = task`
in `enqueue()` (line ~287) is never followed by a `delete` on
completion — `finishSuccess()`/`finishFailure()` only mutate `task.status`
in place. The only removal path is `clearHistory()` (exposed publicly as
`clearTaskHistory()`), which drops finished records — but a repo-wide
`grep -rn "clearTaskHistory\|clearHistory()" os/` shows it is **never
called from anywhere in the codebase**, including the auto-cleanup timer
in `runtime-context.js`, which cleans up its own contexts but has no
knowledge of the Scheduler's task history.

**Severity in context:** not a correctness bug — every test passes,
behavior is correct. It's an unbounded-growth characteristic that only
matters for a long-lived page/process handling a large cumulative task
volume (a session running for hours/days, not a single workflow run).

## Finding 2 (verified defect candidate): workflow-planner.js retains every workflow forever, with no release valve at all

**Evidence:** `grep -n "delete workflowsById\|clearWorkflow\|pruneWorkflow"
workflow-planner.js` returns **zero matches**. `workflowsById[id] = record`
is set in `createWorkflow()`/on workflow creation and never deleted
anywhere in the file. Unlike Finding 1, there isn't even a manual
`clearWorkflowHistory()`-style escape valve — `workflowsById` is a
straight-up unbounded map for the life of the page.

## Contrast: two sibling modules already solve this correctly

- `capability-router.js` — `HISTORY_LIMIT` constant, enforced at
  `history.length > HISTORY_LIMIT` → `history.length = HISTORY_LIMIT`
  (line 353). Verified in source.
- `runtime-context.js` — `HISTORY_LIMIT = 1000` (line 205),
  `if (history.length > HISTORY_LIMIT) history.shift()` (line 252), plus
  a full auto-cleanup timer for terminal-state contexts, all covered by
  the passing FIX-2 regression assertions.

Findings 1 and 2 are gaps in an otherwise-established convention, not a
novel problem — the fix pattern already exists twice in this same
codebase.

## Proposed fix (not applied — see note)

Mirror the existing `HISTORY_LIMIT` convention: cap `tasksById` and
`workflowsById` to the N most-recently-finished records, trimming
oldest-first on each new terminal transition, exactly as
`capability-router.js` already does for its own history array. This is
a minimal, in-pattern change — a few lines each, no new files, no API
shape change.

**Why I didn't apply it in this pass:** doing so changes what
`getTask(oldId)` / `getWorkflow(oldId)` return once a record ages out of
the window — from the full record to `undefined`. That's the same
trade-off `capability-router.js` already made for its own history, so
it's consistent with the codebase's own precedent, but it is a real
behavioral change for any caller that holds onto an old id and expects
`getWorkflow()` to answer it indefinitely. Picking the retention limit
(1,000, matching runtime-context.js? something else?) is a product
decision, not a pure bug fix, and the instruction for this pass is "no
API breaking changes" — I'd rather flag it precisely and let you decide
the limit than silently pick one. Say the word and I'll wire it in using
the exact pattern above.

## Listener / object-lifetime check

`workflow-planner.js`'s `awaitStageOutcome()` registers four
`Orchestrator.on(...)` listeners per stage and unregisters all four via
a single `cleanup()` call on every one of its four resolution branches
(verified by reading lines 490–530). No leaked per-stage listeners found.
This guarantee depends on the Orchestrator's task-timeout mechanism
eventually firing a terminal event for stuck handlers, which Part 1's
regression suite confirms it does ("timeout: a handler that never
resolves is marked timed_out").

`capability-router.js` registers exactly three listeners
(`task_started`/`task_completed`/`task_failed`) once, at module load —
these are intentionally permanent for the process lifetime, not a
per-request leak.

## Not Fully Verified

- **Actual browser memory profiling** (heap snapshots, retained-size
  analysis in DevTools) was not performed — everything above is Node
  `vm`-sandbox behavior, which is architecturally identical for these
  files (no DOM dependency) but is not the same as observing a real
  browser tab's memory over a real multi-hour session.
- **Whether Findings 1/2 matter in practice** depends on real-world
  session length and task/workflow volume, which I have no data on —
  I can characterize the growth curve, not the actual production
  exposure.
