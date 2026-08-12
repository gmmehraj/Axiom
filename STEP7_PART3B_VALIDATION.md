# AXIOM — Block 2 · Step 7 · Part 3B Validation Report
## Autonomous Goal Management System — Scheduling & Prioritization

**Date:** 2026-08-03
**Status:** ✅ Complete — 45/45 new regression assertions passing;
Part 3A's own 35/35-assertion suite re-run byte-for-byte unmodified
and still passing; all other pre-existing, applicable regression
suites re-run and still passing.

---

## 1. Scope delivered

| Requirement | Delivered as |
|---|---|
| Goal priority levels | `GOAL_PRIORITY` (`LOW:1, NORMAL:5, HIGH:8, CRITICAL:10`), `createGoal({priority})`, `setGoalPriority(goalId, priority)` |
| Goal queue | `getGoalQueue()` — Queued goals ordered by priority desc / createdAt asc, computed from the registry (no second array) |
| Dependency tracking | `addGoalDependency`, `removeGoalDependency`, `getGoalDependencies`, `getGoalDependents`, `isGoalBlocked` |
| Goal scheduling | `scheduleGoal(goalId)`, `runGoalScheduler(filter)` |
| Pause | `pauseGoal(goalId, reason)` |
| Resume | `resumeGoal(goalId)` |
| Cancel | Part 3A's `cancelGoal(goalId, reason)` — reused untouched |
| Retry | `retryGoal(goalId, options)` |
| Duplicate goal prevention | `createGoal({ dedupeKey })`, scoped per `parentId`, opt-in |
| Circular dependency detection | `wouldCreateCycle()` guard inside `addGoalDependency` — refuses direct and transitive cycles |
| Automatic goal ordering | `getGoalExecutionOrder(filter)` — topological sort + priority/age tie-break |
| Reuse existing architecture | See §4 — no new queue/scheduler/status-machine/event-namespace was introduced |
| No scheduler/planner duplication | See §4 |

---

## 2. Files changed

| File | Change |
|---|---|
| `os/core/goal-manager.js` | **Extended.** Parts A–E (Part 3A) byte-for-byte unchanged; Parts F–J appended (~340 new lines); `snapshotGoal()` gained 9 new, additive fields; `TRANSITIONS[PENDING]` gained one new legal edge (`-> WAITING`). |
| `CHANGELOG.md` | New entry prepended. Nothing else in the file altered. |
| `test-evidence/block2-step7-part3b-goal-scheduling-regression-suite.js` | **New.** 45 assertions. |
| `STEP7_PART3B_VALIDATION.md` | **New.** This file. |

No other file in the project was modified. In particular,
`os/core/orchestrator.js`, `os/core/runtime-context.js`,
`os/core/capability-router.js`, `os/core/agent-registry-integration.js`,
`os/core/workflow-planner.js`, `os/core/task-planner.js`,
`os/runtime/scheduler/task-scheduler.js`, `automation.html`, and
`test-evidence/block2-step7-part3a-goal-manager-regression-suite.js`
are byte-for-byte unchanged.

---

## 3. Status model change (additive only)

Part 3A's transition table is unchanged except for one new edge:

```
TRANSITIONS[PENDING] = [QUEUED, CANCELLED, FAILED]                (Part 3A)
TRANSITIONS[PENDING] = [QUEUED, WAITING, CANCELLED, FAILED]       (Part 3B, +WAITING)
```

This lets `scheduleGoal()` park a dependency-blocked goal that was
never queued directly in `Waiting`, instead of forcing a fake
`Queued`-then-immediately-blocked detour. Every other edge — and
therefore every one of Part 3A's illegal-transition guarantees
(`Completed -> Running` refused, `Pending -> Running` skipping
`Queued` refused, etc.) — is byte-for-byte unchanged and re-verified
by Part 3A's own unmodified suite (35/35 still passing).

---

## 4. Non-duplication verification

This Part was required to reuse the existing architecture and not
duplicate any scheduler or planner. Verified as follows:

- **`os/runtime/scheduler/task-scheduler.js`** (the one real
  agent-runtime job scheduler in this stack, `window.AxiomTaskScheduler`
  over `AxiomAgentRuntime`/`AxiomJobManager`) — not referenced,
  imported, or loaded by `goal-manager.js`. `getGoalQueue()`,
  `scheduleGoal()`, and `runGoalScheduler()` are pure functions over
  `AxiomGoalManager`'s own `goalsById` registry and the existing
  `transitionGoal()` machine; no job queue, worker pool, or timer loop
  was introduced.
- **`os/core/task-planner.js`** — still not required to load, and
  Part 3B still installs **nothing** onto `AxiomOrchestrator` (test:
  "Part 3B installs nothing onto `AxiomOrchestrator` either"), so it
  cannot collide with `task-planner.js`'s own
  `planGoal`/`executeGoal`/`cancelGoal`/`retryGoal`/`GOAL_STATUS`.
  `task-planner.js`'s own regression suite (21/21) was re-run
  unmodified and still passes.
- **`os/core/workflow-planner.js` / `os/core/capability-router.js`** —
  not referenced, imported, or loaded by this file. No stage-graph
  execution or capability dispatch/failover logic exists here;
  `dequeueNextGoal()`/`scheduleGoal()` only ever drive the goal's own
  `PENDING/QUEUED/WAITING/RUNNING/...` status via `transitionGoal()` —
  identical in spirit to how a caller already drove those transitions
  by hand in Part 3A. No dispatch happens.
- **Runtime Context** — zero new `AxiomRuntimeContext` calls in Parts
  F–J. Every status change funnels through Part 3A's `transitionGoal()`,
  which already syncs/finalizes the one Runtime Context record per
  goal; `retryGoal()`'s follow-up goal is created via the existing
  `createGoal()`, so it gets its own context through the exact same
  path every goal always has.
- **No second queue / scheduler / status machine / event namespace
  was introduced.** `getGoalQueue()` is computed on read from the
  single `goalsById` registry (same posture as `listGoals()`); there
  is no parallel queue array to fall out of sync. All new events are
  additional `goalmgr_*` names (`goalmgr_priority_changed`,
  `goalmgr_dependency_added`, `goalmgr_dependency_removed`,
  `goalmgr_paused`, `goalmgr_resumed`, `goalmgr_retried`) on the same
  Event Bus Part 3A already uses — none collide with `task-planner.js`'s
  bare `goal_*` names, and pausing/resuming still emits the underlying
  `goalmgr_waiting`/`goalmgr_queued` transition events too (verified by
  test), rather than inventing a parallel status representation.

---

## 5. New regression suite

`test-evidence/block2-step7-part3b-goal-scheduling-regression-suite.js`

```
$ node test-evidence/block2-step7-part3b-goal-scheduling-regression-suite.js
AXIOM Block 2 / Step 7 / Part 3B — Autonomous Goal Management System (Scheduling & Prioritization) regression

  PASS  GOAL_PRIORITY: createGoal() defaults to NORMAL priority
  PASS  GOAL_PRIORITY: createGoal() accepts an explicit valid priority
  PASS  GOAL_PRIORITY: createGoal() rejects an unknown priority value
  PASS  setGoalPriority(): changes priority and is reflected on the goal
  PASS  setGoalPriority(): rejects a terminal goal
  PASS  setGoalPriority(): rejects an unknown priority value
  PASS  getGoalQueue(): orders queued goals by priority (desc), then createdAt (asc)
  PASS  getGoalQueue(): excludes non-Queued goals
  PASS  enqueueGoal(): moves a Pending goal to Queued and is idempotent when already Queued
  PASS  dequeueNextGoal(): pops the highest-priority queued goal and transitions it to Running
  PASS  dequeueNextGoal(): returns a failure result (not a throw) on an empty queue
  PASS  addGoalDependency(): records the edge in both directions
  PASS  addGoalDependency(): is idempotent for the same edge added twice
  PASS  addGoalDependency(): rejects a goal depending on itself
  PASS  addGoalDependency(): rejects an unknown goal on either side
  PASS  removeGoalDependency(): removes the edge in both directions
  PASS  getGoalDependencies(): satisfied flips to true once the prerequisite completes
  PASS  isGoalBlocked(): true while any dependency is unresolved, false once all are Completed
  PASS  addGoalDependency(): rejects a direct circular dependency (A<->B)
  PASS  addGoalDependency(): rejects a transitive circular dependency (A->B->C->A)
  PASS  getGoalExecutionOrder(): a dependency is always ordered before its dependent
  PASS  getGoalExecutionOrder(): a satisfied (Completed) dependency does not hold up its dependent's position
  PASS  getGoalExecutionOrder(): independent goals with no dependencies fall back to priority ordering
  PASS  getGoalExecutionOrder(): respects a diamond dependency graph (A -> {B,C} -> D)
  PASS  scheduleGoal(): an unblocked Pending goal is admitted to Queued
  PASS  scheduleGoal(): a goal with an unresolved dependency is parked in Waiting, not Queued
  PASS  scheduleGoal(): once the dependency completes, re-scheduling admits the waiting goal
  PASS  runGoalScheduler(): admits every unblocked goal and parks every blocked one, in dependency order
  PASS  pauseGoal(): Running -> Waiting, flagged isPaused, resumeGoal(): Waiting -> Queued
  PASS  pauseGoal(): rejects a goal that is not Running or Queued
  PASS  resumeGoal(): rejects a Waiting goal that is blocked on a dependency, not paused
  PASS  resumeGoal(): rejects a goal that is not Waiting at all
  PASS  cancelGoal(): still works exactly as Part 3A left it
  PASS  retryGoal(): a Failed goal produces a fresh goal carrying title/metadata/priority/parent forward
  PASS  retryGoal(): a Cancelled goal can also be retried
  PASS  retryGoal(): rejects a goal that is not yet terminal
  PASS  retryGoal(): carries the original's dependency edges forward onto the new goal
  PASS  retryGoal(): repeated retries chain retryCount upward
  PASS  createGoal({dedupeKey}): a second create with the same key returns the existing (non-terminal) goal
  PASS  createGoal({dedupeKey}): scoped per parentId — same key under a different parent is not a duplicate
  PASS  createGoal({dedupeKey}): once the original reaches a terminal status, the key is free again
  PASS  createGoal(): omitting dedupeKey never triggers duplicate prevention (default, backward-compatible)
  PASS  every new Part 3B read returns a deep-frozen snapshot, same discipline as Part 3A
  PASS  Part 3B installs nothing onto AxiomOrchestrator either (same posture as Part 3A)
  PASS  Event Bus: goalmgr_priority_changed, goalmgr_dependency_added, goalmgr_paused, goalmgr_resumed, goalmgr_retried all fire

45/45 assertions passing
```

---

## 6. Bug found and fixed during this pass's own testing

**Defect in `os/core/goal-manager.js` itself:** none found.

**Test-file-only issue caught and fixed:** three of the new suite's
own assertions initially used `assert.deepStrictEqual(order, [id])` /
`(order, [id1, id2])` to check `getGoalExecutionOrder()`'s output.
Node's `assert` module reported `"Values have same structure but are
not reference-equal"` on the first run — the identical quirk Part 3A's
own validation report (§6) already documented and fixed for a frozen-
array immutability check. Replaced each with explicit
`.length`/index-equality checks. No product code changed; the
diagnostic output on the failing run already showed the actual
ordering was correct, confirming this was a test-assertion artifact,
not a logic defect.

**Verification:** full suite re-run after the fix — 45/45 passing,
including all three corrected assertions, and the underlying ordering/
dependency logic was unchanged throughout (only the assertion
mechanics were fixed).

---

## 7. Full regression run (existing suites, applicable to this stack)

Re-run after this change, in the same sandbox:

| Suite | Result |
|---|---|
| `block2-step6-part1-orchestrator-regression-suite.js` | 21/21 passing |
| `block2-step6-part2-agent-registry-integration-regression-suite.js` | 18/18 passing |
| `block2-step6-part3-capability-routing-regression-suite.js` | 20/20 passing |
| `block2-step6-part4-workflow-planner-regression-suite.js` | 29/29 passing |
| `block2-step6-part5-runtime-context-regression-suite.js` | 42/42 passing |
| `block2-step7-part2-task-planner-regression-suite.js` | 21/21 passing |
| `block2-step7-part3a-goal-manager-regression-suite.js` (unmodified) | 35/35 passing |
| `block2-step7-part3b-goal-scheduling-regression-suite.js` (new) | 45/45 passing |
| `block2-step2-part2-brain-integration-regression-suite.js` | all passing |
| `block2-step3-part1-memory-foundation-regression-suite.js` | all passing |
| `block2-step3-part2-memory-integration-regression-suite.js` | all passing |
| `block2-step3-part3-memory-manager-regression-suite.js` | 30 passed, 0 failed |
| `block2-step4-part1-automation-foundation-regression-suite.js` | 17 passed, 0 failed |
| `block2-step4-part2-brain-automation-integration-regression-suite.js` | all passing |
| `block2-step4-part3-automation-memory-integration-regression-suite.js` | all passing |
| `block2-step4-part4-automation-manager-regression-suite.js` | all passing |
| `block2-step5-part1-browser-foundation-regression-suite.js` | 21 passed, 0 failed |
| `block2-step5-part2-navigation-session-regression-suite.js` | 28 passed, 0 failed |
| `block2-step5-part6a-browser-audit-regression-suite.js` | 7 passed, 0 failed |
| `block2-step5-part6b-error-recovery-regression-suite.js` | 15 passed, 0 failed |
| `milestone11-regression-suite.js` | 41/41 passing |
| `milestone12-regression-suite.js` | 19/19 passing |
| `milestone13-regression-suite.js` | 46/46 passing |
| `milestone14-part1-regression-suite.js` | 58/58 passing |
| `phase9-part1-static-audit-suite.js` | 1379/1379 passing |

**Pre-existing, unrelated failures (not caused by this change):**
`block2-step1-coding-agent-regression-suite.js`,
`block2-step1-part2-pipeline-regression-suite.js`,
`milestone5-regression-suite.js`, `milestone5-manual-commands.js`,
`milestone6-regression-suite.js`, and `milestone10-regression-suite.js`
each fail identically with `Error: Cannot find module 'jsdom'` — a
sandbox dependency not installed in this environment. Verified
pre-existing and unrelated: none of the six files reference
`os/core/goal-manager.js`, `CHANGELOG.md`, or any file this Part
touched, and four of the six were already documented as failing for
this exact reason in Part 3A's own validation report before this Part
existed. Out of scope per "fix only verified defects" — a missing
sandbox dependency is not a defect in the Goal Management System.

---

## 8. Deliberately out of scope for Part 3B

- Automatic goal decomposition (free text → sub-goals/tasks) — still
  `task-planner.js`'s job, untouched.
- Actually dispatching/executing a scheduled goal's underlying work —
  `dequeueNextGoal()`/`scheduleGoal()` drive the goal's own status
  machine only, the same as a caller driving `markGoalRunning()` by
  hand already did in Part 3A. Wiring real dispatch stays
  `capability-router.js`'s responsibility.
- Any retention/archival policy for terminal or retried goals — no
  TTL/cleanup exists yet, same as Part 3A left it; a retried goal's
  original terminal record is kept forever.
- Priority decay/aging (auto-promoting a goal that has waited too
  long) — `getGoalQueue()`'s ordering is a pure, static function of
  the priority recorded at creation/`setGoalPriority()` time and
  `createdAt`.
- Wiring `goal-manager.js`'s new scheduling surface into any page's
  live agent handlers.
