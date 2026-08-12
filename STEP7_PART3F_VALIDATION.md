# AXIOM — Block 2 · Step 7 · Part 3F Validation Report
## Adaptive Execution & Recovery Layer

**Date:** 2026-08-05
**Status:** ✅ Complete — 38/38 new regression assertions passing;
all other pre-existing, applicable regression suites re-run and still
passing.

---

## 1. Scope delivered

| Requirement | Delivered as |
|---|---|
| Monitor active goal execution in real time | `checkGoalHealth(goalId)` / `monitorActiveGoals()` — read `AxiomGoalManager.getGoal()`, `AxiomRuntimeContext.getContext()` (via the goal's own `contextId`), and (when Part 3D is loaded) `AxiomDecisionEngineExecutionBridge.getExecution()`; the only new state is a last-activity timestamp per goal |
| Detect stalled or blocked goals | `stalled`: idle time (vs. last observed activity) exceeds `getStallThresholdMs()`. `blocked`: `AxiomGoalManager.isGoalBlocked()`, reused verbatim |
| Detect repeated execution failures | Goal Record's own `retryCount` vs. `getMaxRecoveryAttempts()` (or `metadata.maxRecoveryAttempts`); Part 3D's own `decisionengine_execution_exhausted` event when loaded |
| Automatically retry recoverable goals using the existing retry system | `attemptRecovery()` calls Part 3A's own `retryGoal()`, then (Part 3C loaded) `AxiomDecisionEngine.admitGoal()` — recoverability decided by reusing Part 3C's own `evaluateGoal()` reason string on the fresh candidate (see §3.1) |
| Reorder remaining goals when execution conditions change | `reorderRemainingGoals()` — Part 3E's `optimizeGoalScheduling()` when loaded, else Part 3B's `runGoalScheduler()`; called automatically after every recovery/skip |
| Skip goals that become impossible while allowing dependent goals to continue when appropriate | `skipGoal()` — Part 3A's own `cancelGoal()`; dependents opted out via `metadata.optionalDependencies` are released via Part 3B's own `removeGoalDependency()` (see §3.2) |
| Resume interrupted execution after recovery | `resumeGoal()` (pause/resume the SAME Goal Record, no Bridge) and the cancel-then-recover path (fresh Goal Record, Bridge loaded — see §3.3) |
| Emit lifecycle events | `goal_recovered`, `goal_resumed`, `goal_skipped`, `goal_blocked` — collision-checked against every other `emit('...')` in `os/core` (see §3.4) |
| Reuse Agent Orchestrator, Capability Router, Goal Manager, Runtime Context, Analytics | See §4 |
| Do not duplicate retry, routing, scheduling, workflow, or orchestration logic | Every mutation goes through an existing public entry point — see §4 |
| Do not implement machine learning | Every decision is a plain threshold/comparison over existing counters and timestamps — no model, no training step, no fitted parameter |

---

## 2. Files changed

| File | Change |
|---|---|
| `os/core/goal-manager-recovery.js` | **New.** `window.AxiomGoalManagerRecovery`. ~460 lines of logic (767 lines incl. header/comments). |
| `CHANGELOG.md` | New entry prepended. Nothing else in the file altered. |
| `test-evidence/block2-step7-part3f-goal-manager-recovery-regression-suite.js` | **New.** 38 assertions, 715 lines. |
| `STEP7_PART3F_VALIDATION.md` | **New.** This file. |

No other file in the project was modified. In particular,
`os/core/orchestrator.js`, `os/core/runtime-context.js`,
`os/core/goal-manager.js`, `os/core/task-planner.js`,
`os/core/autonomous-decision-engine.js`,
`os/core/decision-engine-execution-bridge.js`,
`os/core/goal-manager-learning.js`, `automation.html`, and every
pre-existing regression suite file are byte-for-byte unchanged —
verified both programmatically (the new suite's own "installs cleanly
... without editing any dependency" test does a `readFileSync` diff of
seven dependencies before/after load) and by inspection.

Consistent with the convention Parts 3A–3E already established, this
Part does not add its own `<script>` tag to `automation.html`. Wiring
the Step 7 stack into a live page is left to whichever future part is
explicitly scoped to do that.

---

## 3. Design notes

### 3.1 Deciding recoverable vs. permanently impossible without a second capability check

Once a goal is terminal (Failed/Cancelled), asking "was this
recoverable?" directly is meaningless — `evaluateGoal()` on a terminal
goal only ever reports "goal is in a terminal status." Re-deriving
agent/capability availability locally would duplicate exactly the
logic Part 3C's own (unexported) `resolveGoalAgent()` already owns.

Instead, `attemptRecovery()` mints the retry FIRST via Part 3A's own
`retryGoal()` — which never mutates the original and is safe to call
speculatively — and only then asks Part 3C's own `evaluateGoal()`
about that fresh, non-terminal candidate. If the reason string is
Part 3C's own fixed wording for "nothing anywhere advertises this
capability," the situation is permanent, so the freshly-minted retry
is cancelled immediately and the whole lineage is skipped rather than
left to mint an endless series of doomed retries. Any other reason
(including simply being schedulable) is treated as recoverable and the
retry is re-admitted normally. Without Part 3C loaded, there is no
richer reasoning available — the retry is simply enqueued and left for
a caller (or `runGoalScheduler()`) to pick up, exactly like any other
goal driven by hand.

### 3.2 Why `metadata.optionalDependencies` and not a new dependency type

Part 3A/3B's dependency graph (`addGoalDependency`/`getGoalDependents`)
has no notion of an "optional" edge — every dependency is a hard
`isGoalBlocked()` requirement, and `retryGoal()` deliberately does not
redirect a dependent from a dead original onto a fresh retry (that
redirection is this Part's own job — see §3.3). Adding an "optional"
flag to the dependency graph itself would mean editing
`goal-manager.js`, which this Part is scoped not to do.

Every other Part in this lineage that needs caller-declared, opt-in
behavior already reads it off `goal.metadata` rather than extending a
core data structure — Part 3C's `resolveGoalCapability()` reads
`metadata.capability`, Part 3D's `attemptRetry()` reads
`metadata.maxRetries`. This Part follows the identical convention:
`metadata.optionalDependencies` is an array a goal's OWN creator
supplies, listing which of its own prerequisites it can proceed
without if that prerequisite is ever skipped. `skipGoal()` reads it
off each dependent (never off the goal being skipped) and calls
`removeGoalDependency()` only for a match; every dependent that never
opted in is left exactly as blocked as `isGoalBlocked()` already
reports — no change in behavior for the common case.

### 3.3 The stalled + Bridge-loaded race, and why the two "resume" paths differ

Part 3D's own execution record only ever reaches a terminal status
inside `.then()` on the plan's own promise — asynchronously, never in
the same call stack as `AxiomDecisionEngineExecutionBridge.
cancelExecution()`. Part 3D's own `dispatchGoal()` also explicitly
refuses to start a second plan for a goalId whose existing execution
record isn't terminal yet ("never double-dispatch" — a documented
invariant of that file). Combining those two facts: calling
`cancelExecution()` and then immediately re-admitting the SAME goal
synchronously would either be silently refused (dispatch guard) or,
worse, let the OLD plan's eventual settlement overwrite the NEW
execution record once it does resolve, since `finalizeGoalFromExecution`
does not check "is this still the currently-active plan" before
writing `rec.status`.

Neither this module nor Part 3D exposes a synchronous
"cancellation has fully settled" signal, and inventing one would mean
either polling (a second, parallel status mechanism) or editing Part
3D. This module does neither: it marks the goalId as
`stallCancelPending`, requests cancellation, and returns immediately
(no result yet). Part 3D's own `decisionengine_execution_cancelled`
event — the real signal that the async settlement has happened — is
the only thing that clears the pending marker and triggers
`attemptRecovery()`, minting a genuinely fresh Goal Record with a new
plan. This is why the Bridge-loaded stall path emits `goal_recovered`
(a new attempt) rather than `goal_resumed` (the same attempt,
continued) — the two events are reserved for these two genuinely
different situations:

- **No Bridge loaded:** nothing asynchronous to race — pausing and
  resuming the SAME Goal Record via Part 3B's own
  `pauseGoal()`/`resumeGoal()` is safe and synchronous. `goal_resumed`.
- **Bridge loaded:** the in-flight plan must be allowed to actually
  finish cancelling (asynchronously, via Part 3D's own event) before
  anything touches that goalId again; the goal that comes out the
  other side is a fresh Goal Record. `goal_recovered`.

Regression coverage: both paths are exercised end-to-end (see §5) —
the no-Bridge path with a synchronous idle timeout, and the
Bridge-loaded path with an agent handler that returns a promise that
never settles (`new Promise(() => {})`, which holds no timer or
handle, so it cannot itself hang the test process), confirming the
second dispatch produces a genuinely new `planId` only once
`decisionengine_execution_cancelled` has actually fired.

### 3.4 Event-name collision check

`goal_recovered`, `goal_resumed`, `goal_skipped`, and `goal_blocked`
were chosen to read naturally as goal-lifecycle events (matching the
naming the task itself specified) without colliding with any
existing convention already in use in this project:
`goalmgr_*` (Part 3A/3B), `goal_task_*` (Part 2 Task Planner),
`decisionengine_*` (Parts 3C/3D), `goalmgrlearn_*` (Part 3E). The
regression suite includes a static scan of every other file under
`os/core/` for a literal `'goal_recovered'` / `'goal_resumed'` /
`'goal_skipped'` / `'goal_blocked'` string inside an `emit(...)` call
and confirms zero matches.

### 3.5 Avoiding a double-retry between this Part and Part 3D's own `attemptRetry()`

Part 3D's `decision-engine-execution-bridge.js` already retries a
failed goal itself, bounded by `getMaxExecutionRetries()`, before ever
giving up and emitting `decisionengine_execution_exhausted`. If this
Part ALSO reacted to the plain `goalmgr_failed` event while the Bridge
is loaded, every single Bridge-owned failure would trigger a SECOND,
independent retry chain racing the Bridge's own — so this module's
`goalmgr_failed` listener is only ever registered when
`AxiomDecisionEngineExecutionBridge` is absent (i.e., a goal driven
purely by hand through `AxiomGoalManager`'s own status machine, which
nothing else in the project ever retries). When the Bridge IS loaded,
this module's only automatic trigger is `decisionengine_execution_exhausted`
— the Bridge's own signal that ITS retry budget, not this module's, is
spent. Regression coverage confirms both halves: a manually-failed
goal is recovered automatically only when the Bridge is absent, and a
plain `goalmgr_failed` event produces zero `goal_recovered` events
while the Bridge is loaded even though the goal never went through the
Bridge's dispatch path at all.

---

## 4. Reuse audit (no duplicated retry / routing / scheduling / workflow / orchestration logic)

| This Part calls | To do | Owned by |
|---|---|---|
| `AxiomGoalManager.getGoal()` / `.isGoalBlocked()` | Read current status / dependency-blocked state | Part 3A/3B |
| `AxiomGoalManager.retryGoal()` | Mint a fresh retry Goal Record | Part 3A (the existing retry system) |
| `AxiomGoalManager.pauseGoal()` / `.resumeGoal()` | Pause/resume the same Goal Record | Part 3B |
| `AxiomGoalManager.cancelGoal()` | Skip a goal | Part 3A |
| `AxiomGoalManager.addGoalDependency()` / `.removeGoalDependency()` / `.getGoalDependents()` / `.getGoalDependencies()` | Repair the dependency graph | Part 3B |
| `AxiomGoalManager.enqueueGoal()` / `.runGoalScheduler()` | Queue / reorder without Part 3E | Part 3B |
| `AxiomDecisionEngine.evaluateGoal()` | Read eligibility / impossibility reason | Part 3C |
| `AxiomDecisionEngine.admitGoal()` | Re-enter the eligibility-checked admission path | Part 3C |
| `AxiomDecisionEngineExecutionBridge.getExecution()` | Read live execution/progress state | Part 3D |
| `AxiomDecisionEngineExecutionBridge.cancelExecution()` | Cancel a stuck in-flight plan | Part 3D |
| `AxiomGoalManagerLearning.optimizeGoalScheduling()` | Reorder with learned priority | Part 3E |
| `AxiomRuntimeContext.getContext()` | Read a goal's own runtime-context activity timestamp | Runtime Context (Step 6 Part 5) |
| `AxiomOrchestrator.emit()` / `.on()` | Event Bus | Orchestrator (Part 1) |

Nothing in `os/core/goal-manager-recovery.js` re-decomposes goal text,
re-matches a capability against the live agent registry, re-implements
a topological/priority ordering, or re-dispatches a task directly
against the Capability Router — every one of those remains exactly
where Parts 1–3E already put it. "Analytics" is reused the same
optional, defensive way Part 2's `agent-registry-integration.js`
already reuses `window.AxiomAnalyticsAutomation` — this module logs
through `global.AxLogger`/`console` when present and is a no-op
otherwise, since no dedicated analytics engine beyond that exists
elsewhere in this project to call into.

---

## 5. Regression coverage added

`test-evidence/block2-step7-part3f-goal-manager-recovery-regression-suite.js`
— 38 assertions:

- load-order guards: refuses to install without `AxiomOrchestrator`,
  `AxiomRuntimeContext`, or `AxiomGoalManager`; installs cleanly and
  edits none of its dependencies both WITH the full Part 3C/3D/3E
  stack and with ONLY `goal-manager.js` present
- `setStallThresholdMs()`/`getStallThresholdMs()` and
  `setMaxRecoveryAttempts()`/`getMaxRecoveryAttempts()` round-trip and
  reject invalid input
- `checkGoalHealth()`: frozen snapshot shape; correctly flags a
  long-idle RUNNING goal stalled and a freshly-started one not;
  `blocked` matches `isGoalBlocked()` exactly; `impossible` is `true`
  only with Part 3C loaded and a genuine no-agent-advertises-capability
  reason, always `false` without Part 3C
- `monitorActiveGoals()`: one diagnostic per non-terminal goal, none
  for terminal goals; de-dupes `goal_blocked` across repeated sweeps
  and re-fires correctly after an unblock-then-reblock; cancels +
  `goal_skipped`s a permanently-impossible goal
- `startMonitoring()`/`stopMonitoring()`/`isMonitoring()` drive a real
  sweep on an interval and stop it cleanly
- stall handling: no-Bridge case (pause → resume, same Goal Record,
  `goal_blocked` → `goal_resumed`); Bridge-loaded case (cancel → wait
  for real async settlement → recover as a fresh attempt with a new
  `planId`, `goal_blocked` → `goal_recovered`)
- `attemptRecovery()`: mints + enqueues without Part 3C; re-admits via
  `admitGoal()` with Part 3C; relinks a dependent from the dead
  original onto the fresh retry; declines for a non-recoverable-status
  goal; escalates to `skipGoal()` at the ceiling (global default and
  per-goal `metadata.maxRecoveryAttempts` override) without forcing a
  second status transition on an already-terminal goal; skips
  immediately (no endless retries) when the fresh candidate is itself
  permanently impossible
- automatic triggers: `decisionengine_execution_exhausted` recovers
  exactly once per exhaustion event; `goalmgr_failed` recovers only
  when the Bridge is absent, and is confirmed inert while the Bridge
  is loaded (no double-retry)
- `skipGoal()`: cancels the target, releases only
  `metadata.optionalDependencies`-declared dependents, leaves a hard
  dependent blocked, and triggers the reorder path as a side effect
- `reorderRemainingGoals()`: calls Part 3E's `optimizeGoalScheduling()`
  when loaded, Part 3B's `runGoalScheduler()` otherwise
- event-name collision scan across every other `os/core` file
- every read-path result is frozen (`checkGoalHealth`,
  `getRecoveryHistory`, `getRecoveryMetrics`); metrics track exact
  counts across a stall + recover + skip scenario; history supports a
  limit and is most-recent-first

---

## 6. Regression results

```
$ node test-evidence/block2-step7-part3f-goal-manager-recovery-regression-suite.js
AXIOM Block 2 / Step 7 / Part 3F — Adaptive Execution & Recovery Layer regression

  PASS  ... (38 lines)

38/38 assertions passing
```

Every suite under `test-evidence/` (35 files total) was re-run after
this change:

| Suite | Result |
|---|---|
| `block2-step2-part2-brain-integration` | ALL CHECKS PASSED |
| `block2-step3-part1-memory-foundation` | ALL CHECKS PASSED |
| `block2-step3-part2-memory-integration` | ALL CHECKS PASSED |
| `block2-step3-part3-memory-manager` | 30/30 passing |
| `block2-step4-part1-automation-foundation` | 17/17 passing |
| `block2-step4-part2-brain-automation-integration` | ALL CHECKS PASSED |
| `block2-step4-part3-automation-memory-integration` | ALL CHECKS PASSED |
| `block2-step4-part4-automation-manager` | ALL CHECKS PASSED |
| `block2-step5-part1-browser-foundation` | 21/21 passing |
| `block2-step5-part2-navigation-session` | 28/28 passing |
| `block2-step5-part6a-browser-audit` | 7/7 passing |
| `block2-step5-part6b-error-recovery` | 15/15 passing |
| `block2-step6-part1-orchestrator` | 21/21 passing |
| `block2-step6-part2-agent-registry-integration` | 18/18 passing |
| `block2-step6-part3-capability-routing` | 20/20 passing |
| `block2-step6-part4-workflow-planner` | 29/29 passing |
| `block2-step6-part5-runtime-context` | 42/42 passing |
| `block2-step7-part2-task-planner` | 21/21 passing |
| `block2-step7-part3a-goal-manager` | 35/35 passing |
| `block2-step7-part3b-goal-scheduling` | 45/45 passing |
| `block2-step7-part3c-decision-engine` | 37/37 passing |
| `block2-step7-part3d-execution-bridge` | 24/24 passing |
| `block2-step7-part3e-goal-manager-learning` | 35/35 passing |
| **`block2-step7-part3f-goal-manager-recovery`** | **38/38 passing (new)** |
| `milestone11` | 41/41 checks passed |
| `milestone12` | 19/19 checks passed |
| `milestone13` | 46/46 checks passed |
| `milestone14-part1` | 58/58 checks passed |
| `phase9-part1-static-audit` | 1383/1383 checks passed |

Five suites fail identically to before this change, for the identical
pre-existing reason (`MODULE_NOT_FOUND` on a dependency such as
`jsdom` that is unrelated to and unmodified by this Part):
`block2-step1-coding-agent`, `block2-step1-part2-pipeline`,
`milestone5-manual-commands`, `milestone5`, `milestone6`,
`milestone10`. None of these six files reference
`goal-manager-recovery.js` or `AxiomGoalManagerRecovery`, confirmed by
grep. No defect was introduced or fixed in any of them by this Part;
per the verification instructions, only verified defects are fixed,
and none of this Part's own work touches them.

**No regressions.** No pre-existing passing suite was broken by this
change.

---

## 7. Conclusion

Part 3F is complete: `os/core/goal-manager-recovery.js` adds
real-time health monitoring, stall/blocked/impossibility detection,
existing-retry-system-based recovery, learned/scheduler-based
reordering, impossible-goal skipping with opt-in dependent release,
and pause/resume-or-recover continuation — entirely by composing
existing, already-validated entry points on
`AxiomOrchestrator`/`AxiomRuntimeContext`/`AxiomGoalManager`/
`AxiomDecisionEngine`/`AxiomDecisionEngineExecutionBridge`/
`AxiomGoalManagerLearning`. Zero existing files were modified. 38 new
regression assertions pass, and every other applicable suite in the
project continues to pass unmodified.
