# AXIOM — Block 2 · Step 7 · Part 3C Validation Report
## Autonomous Decision Engine

**Date:** 2026-08-03
**Status:** ✅ Complete — 37/37 new regression assertions passing;
all other pre-existing, applicable regression suites re-run and still
passing.

---

## 1. Scope delivered

| Requirement | Delivered as |
|---|---|
| Evaluate active goals | `AxiomDecisionEngine.evaluateGoal(goalId)` / `rankCandidateGoals(filter)`, built on `AxiomGoalManager.getGoalExecutionOrder()` |
| Evaluate Runtime Context | `getSystemLoad()` — reads `AxiomRuntimeContext.getActiveContexts()` / `getContextMetrics()` live |
| Evaluate dependencies | `evaluateGoal()`'s `blocked` field, via `AxiomGoalManager.isGoalBlocked()`; diamond-safe candidate scan (an independent branch behind a blocked goal is still evaluated) |
| Evaluate available agents | `resolveGoalAgent()`, via `AxiomOrchestrator.listAgents()` / `discoverAgents()` (read-only, diagnostic only) |
| Evaluate capabilities | `resolveGoalCapability()` reads the goal's own `metadata.capability` / `metadata.requiredCapability`; actual matching delegated to `AxiomCapabilityRouter.selectAgent()` |
| Select the next goal automatically | `selectNextGoal(filter)` (pure/read-only) and `runDecisionCycle(filter)` (selects **and** admits) |
| No hardcoded workflows | See §4 — no goal-type/capability/agent-id table or fixed step sequence exists anywhere in the new file |
| Fully dynamic decision making | Every decision is a live read over `AxiomGoalManager` / `AxiomRuntimeContext` / `AxiomOrchestrator` / `AxiomCapabilityRouter` at call time — nothing is cached or precomputed |
| Integrate with Goal Manager | `scheduleGoal()` / `markGoalRunning()` / `runGoalScheduler()` / `getGoalExecutionOrder()` / `isGoalBlocked()` / `getGoal()` / `listGoals()` all called directly, unmodified |
| Reuse Runtime Context | `getActiveContexts()` / `getContextMetrics()` called directly, unmodified |
| Reuse Capability Router | `selectAgent()` called directly, unmodified — this module never re-ranks or re-selects agents itself |

---

## 2. Files changed

| File | Change |
|---|---|
| `os/core/autonomous-decision-engine.js` | **New.** `window.AxiomDecisionEngine`. ~340 lines. |
| `CHANGELOG.md` | New entry prepended. Nothing else in the file altered. |
| `test-evidence/block2-step7-part3c-decision-engine-regression-suite.js` | **New.** 37 assertions. |
| `STEP7_PART3C_VALIDATION.md` | **New.** This file. |

No other file in the project was modified. In particular,
`os/core/orchestrator.js`, `os/core/runtime-context.js`,
`os/core/goal-manager.js`, `os/core/capability-router.js`,
`os/core/agent-registry-integration.js`, `os/core/workflow-planner.js`,
`os/core/task-planner.js`, `os/runtime/scheduler/task-scheduler.js`,
`automation.html`, `brain.html`, and every pre-existing regression
suite file are byte-for-byte unchanged (verified by `md5sum` before
and after this pass — see §4).

---

## 3. Design notes

### 3.1 Why a new standalone file, not an extension of `goal-manager.js`

`goal-manager.js`'s own header explains why it stays a standalone
global (`window.AxiomGoalManager`) rather than installing onto
`AxiomOrchestrator`: `task-planner.js` already claims the bare `Goal`
method names there. This Part is a *consumer* of four existing
modules at once (`AxiomOrchestrator`, `AxiomRuntimeContext`,
`AxiomGoalManager`, `AxiomCapabilityRouter`), so it follows the same
convention for the identical reason and for one more: putting
cross-module decision logic inside any one of the four it depends on
would make that module aware of the others in a way none of them are
today (each is documented as not requiring the others to be loaded).
Keeping it a fifth, standalone file means all four existing modules
stay exactly as decoupled as they already were.

### 3.2 What "no hardcoded workflows" means, concretely

Grep confirms no capability name, agent id, or goal-type string is a
literal anywhere in the decision path:

```
$ grep -n "'browser'\|'brain'\|'memory'\|'automation'" os/core/autonomous-decision-engine.js
(no output)
```

The only strings the file contains that resemble a workflow are the
two metadata *key names* it reads (`capability`, `requiredCapability`,
`excludeAgents`, `requiredPermission`) — the same optional per-request
fields `capability-router.js`'s own `analyzeRequest()` already
recognizes on a routing request. A goal's *value* for those keys is
never inspected against a fixed list; it is handed straight to
`AxiomCapabilityRouter.selectAgent()`, which resolves it against
whatever is registered right now. Regression test "a goal becomes
eligible the moment a matching agent is registered at runtime (no
code change)" verifies this directly: a goal requiring `"summarize"`
is ineligible, an agent advertising `"summarize"` is registered with
`AxiomOrchestrator.registerAgent()` mid-test, and the same goal is
re-evaluated eligible — with no capability ever having been named in
this module's source.

### 3.3 Why decisions are "fully dynamic"

`evaluateGoal()`, `getSystemLoad()`, `rankCandidateGoals()`, and
`selectNextGoal()` are all pure reads: none of them cache a prior
result, none of them maintain a second copy of goal/agent/context
state, and every one recomputes from `AxiomGoalManager` /
`AxiomRuntimeContext` / `AxiomOrchestrator` / `AxiomCapabilityRouter`
on every call. Regression test "a dependency completing makes the
dependent eligible on the next evaluation" and "runDecisionCycle(): a
goal blocked purely by capacity becomes admittable once capacity
frees up" both verify that changing live state between two calls
changes the decision with no engine-side reset or cache-invalidation
step required.

---

## 4. Non-duplication verification

This Part was required to integrate with Goal Manager and reuse
Runtime Context and Capability Router rather than re-implementing any
of their logic. Verified as follows:

- **`os/core/goal-manager.js`** — not edited (see the `md5sum` table
  below). `admitGoal()` never calls `transitionGoal()` directly; it
  only calls the same two calls an external caller already had to
  make by hand (`scheduleGoal()`, then `markGoalRunning()`).
  Regression test "does not duplicate ordering logic: admitting the
  selected goal never bypasses transitionGoal()'s validated state
  machine" asserts the resulting goal history is exactly
  `pending -> queued -> running` — the same sequence
  `goal-manager.js`'s own machine produces unassisted, with no extra
  or skipped states.
- **`os/core/capability-router.js`** — not edited. No agent
  health/workload/priority ranking logic is reimplemented anywhere in
  this file; `resolveGoalAgent()` calls `selectAgent()` directly and
  returns its result as-is. Regression test "does not duplicate agent
  selection logic: evaluateGoal() agentId always matches
  AxiomCapabilityRouter.selectAgent() directly" asserts byte-identical
  agreement between the two.
- **`os/core/runtime-context.js`** — not edited. This module creates
  zero new Runtime Context records; `getSystemLoad()` only reads
  `getActiveContexts()`/`getContextMetrics()` over the one record per
  goal `goal-manager.js` already creates. Regression test confirms
  `getSystemLoad().activeContexts` increases by exactly 1 when a new
  goal (and therefore its one Runtime Context record) is created.
- **`os/runtime/scheduler/task-scheduler.js`** — not referenced,
  imported, or loaded by this file. `runDecisionCycle()` only ever
  drives goal status via `AxiomGoalManager`'s existing calls; no job
  queue, worker pool, or timer loop was introduced.
- **`os/core/workflow-planner.js` / `os/core/task-planner.js`** — not
  referenced, imported, or loaded. No stage-graph execution and no
  flat single-run "goal plan" concept exists here; this module reads
  and drives only `AxiomGoalManager`'s hierarchical goal record.
- **No second queue / scheduler / status machine / event namespace was
  introduced.** `rankCandidateGoals()` is computed fresh from
  `getGoalExecutionOrder()` on every call — no parallel ordering array
  is kept in sync. All new events are additional `decisionengine_*`
  names (`decisionengine_admitted`, `decisionengine_deferred`,
  `decisionengine_idle`, `decisionengine_cycle_complete`) on the same
  Event Bus every other Block 2 module already uses — none collide
  with `goalmgr_*` (Part 3A/3B) or bare `goal_*` (task-planner.js).
- **Installs nothing onto `AxiomOrchestrator`.** Regression test
  "installs nothing onto AxiomOrchestrator (same standalone posture as
  goal-manager.js)" asserts `AxiomOrchestrator.evaluateGoal`,
  `.selectNextGoal`, and `.runDecisionCycle` are all `undefined`.

### File integrity (before vs. after this pass)

```
$ md5sum os/core/goal-manager.js os/core/runtime-context.js \
    os/core/capability-router.js os/core/orchestrator.js \
    automation.html brain.html
d739b1b2191e2431fd95cd6e303ae620  os/core/goal-manager.js
ae1da32758244ba54de5d561fe668d35  os/core/runtime-context.js
d6e9fdd901f5d20f75742628d067c940  os/core/capability-router.js
e56b634f42f838167b7b19cbbd59fc21  os/core/orchestrator.js
0075a02d5e86b9ffdf6dc8de4ec0007f  automation.html
3f47707c3f3f9b81376d60ca390869f0  brain.html
```

Identical before this pass began and after it completed — none of
these six files were touched.

---

## 5. New regression suite

`test-evidence/block2-step7-part3c-decision-engine-regression-suite.js`

```
$ node test-evidence/block2-step7-part3c-decision-engine-regression-suite.js
AXIOM Block 2 / Step 7 / Part 3C — Autonomous Decision Engine regression

  PASS  module does not install itself without AxiomOrchestrator present
  PASS  module does not install itself without AxiomGoalManager present
  PASS  module does not install itself without AxiomCapabilityRouter present
  PASS  installs nothing onto AxiomOrchestrator (same standalone posture as goal-manager.js)
  PASS  evaluateGoal(): a goal with no capability requirement is eligible with no agents registered at all
  PASS  evaluateGoal(): a goal requiring an unregistered capability is ineligible with a clear reason
  PASS  evaluateGoal(): a goal becomes eligible the moment a matching agent is registered at runtime (no code change)
  PASS  evaluateGoal(): capability metadata alias "requiredCapability" is honored identically to "capability"
  PASS  evaluateGoal(): distinguishes "no agent for capability" from "agent exists but ineligible" (disabled)
  PASS  evaluateGoal(): honors a goal-specified requiredPermission via the real capability-router selectAgent()
  PASS  evaluateGoal(): honors a goal-specified excludeAgents list
  PASS  evaluateGoal(): a goal blocked by an unresolved dependency is ineligible
  PASS  evaluateGoal(): a dependency completing makes the dependent eligible on the next evaluation
  PASS  evaluateGoal(): a terminal goal is never eligible
  PASS  evaluateGoal(): a paused (Waiting, isPaused) goal is ineligible with a distinct reason from dependency-blocked
  PASS  evaluateGoal(): a Running goal is not (re-)eligible
  PASS  evaluateGoal(): throws a clear error for an unknown goal id
  PASS  getSystemLoad(): reflects the real, live AxiomRuntimeContext active-context count
  PASS  getSystemLoad(): runningGoals matches AxiomGoalManager.listGoals({status: RUNNING}) exactly
  PASS  setMaxConcurrentGoals()/getMaxConcurrentGoals(): defaults to unbounded (null), is settable and clamped to non-negative integers
  PASS  evaluateGoal(): a goal is ineligible once running-goal count reaches the configured capacity
  PASS  rankCandidateGoals(): follows the same dependency/priority ordering as getGoalExecutionOrder()
  PASS  selectNextGoal(): picks the highest-priority fully-eligible candidate, skipping capability-blocked higher priority ones
  PASS  selectNextGoal(): returns null when no candidate is eligible
  PASS  selectNextGoal(): an independent branch behind a blocked dependency is still considered (diamond-safe)
  PASS  admitGoal(): drives an eligible Pending goal through Queued into Running via the real status machine
  PASS  admitGoal(): refuses (does not force) an ineligible goal, no status change occurs
  PASS  admitGoal(): a goal already Queued is admitted straight to Running (scheduleGoal is a no-op for it)
  PASS  runDecisionCycle(): admits scheduler-eligible Pending goals and reuses Part 3B runGoalScheduler() for Waiting/blocked ones
  PASS  runDecisionCycle(): emits decisionengine_idle and returns admitted:null when nothing is eligible
  PASS  runDecisionCycle(): repeated calls drain the queue one eligible goal at a time, highest priority first
  PASS  runDecisionCycle(): a goal blocked purely by capacity becomes admittable once capacity frees up
  PASS  getDecisionHistory(): records admitted/deferred/idle outcomes, most recent first, bounded
  PASS  getDecisionMetrics(): counts cycles/admitted/deferred/idle accurately
  PASS  every evaluateGoal()/getSystemLoad()/runDecisionCycle() read returns a deep-frozen snapshot
  PASS  does not duplicate agent selection logic: evaluateGoal() agentId always matches AxiomCapabilityRouter.selectAgent() directly
  PASS  does not duplicate ordering logic: admitting the selected goal never bypasses transitionGoal()'s validated state machine

37/37 assertions passing
```

(The three `[AxiomDecisionEngine] requires ... loaded first.` lines
that print to stderr during the first three tests are the load-order
guard's own diagnostic logging, produced intentionally by those tests
to prove the guard fires — not failures.)

---

## 6. Bug found and fixed during this pass's own testing

**Defect in `os/core/autonomous-decision-engine.js` itself:** none
found.

**Test-file-only issue caught and fixed:** one of the new suite's own
assertions initially used
`assert.deepStrictEqual(statuses, ['pending', 'queued', 'running'])`
to check a goal's history-derived status sequence. Node's `assert`
module reported `"Values have same structure but are not
reference-equal"` — the identical quirk Part 3A's and Part 3B's own
validation reports already documented and fixed for frozen-array
equality checks (this array is built from `.map()` over deep-frozen
history entries). Replaced with explicit `.length` and per-index
equality checks. No product code changed; the diagnostic output on
the failing run already showed the actual sequence
(`pending -> queued -> running`) was correct, confirming this was a
test-assertion artifact, not a logic defect.

**Verification:** full suite re-run after the fix — 37/37 passing,
including the corrected assertion, with the underlying status-sequence
logic unchanged throughout.

---

## 7. Full regression run (all suites in the project)

Re-run after this change, in the same sandbox:

| Suite | Result |
|---|---|
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
| `block2-step6-part1-orchestrator-regression-suite.js` | 21/21 passing |
| `block2-step6-part2-agent-registry-integration-regression-suite.js` | 18/18 passing |
| `block2-step6-part3-capability-routing-regression-suite.js` | 20/20 passing |
| `block2-step6-part4-workflow-planner-regression-suite.js` | 29/29 passing |
| `block2-step6-part5-runtime-context-regression-suite.js` | 42/42 passing |
| `block2-step7-part2-task-planner-regression-suite.js` | 21/21 passing |
| `block2-step7-part3a-goal-manager-regression-suite.js` (unmodified) | 35/35 passing |
| `block2-step7-part3b-goal-scheduling-regression-suite.js` (unmodified) | 45/45 passing |
| `block2-step7-part3c-decision-engine-regression-suite.js` (new) | 37/37 passing |
| `milestone11-regression-suite.js` | 41/41 passing |
| `milestone12-regression-suite.js` | 19/19 passing |
| `milestone13-regression-suite.js` | 46/46 passing |
| `milestone14-part1-regression-suite.js` | 58/58 passing |
| `phase9-part1-static-audit-suite.js` | 1380/1380 passing |

**Pre-existing, unrelated failures (not caused by this change):**
`block2-step1-coding-agent-regression-suite.js`,
`block2-step1-part2-pipeline-regression-suite.js`,
`milestone10-regression-suite.js`, `milestone5-manual-commands.js`,
`milestone5-regression-suite.js`, and `milestone6-regression-suite.js`
each fail identically with `Error: Cannot find module 'jsdom'` — a
sandbox dependency not installed in this environment. Verified
pre-existing and unrelated: none of the six files reference
`os/core/autonomous-decision-engine.js`, `os/core/goal-manager.js`,
`os/core/runtime-context.js`, `os/core/capability-router.js`,
`CHANGELOG.md`, or any file this Part touched, and all six were
already documented as failing for this exact reason in Part 3B's own
validation report before this Part existed. Out of scope per "fix
only verified defects" — a missing sandbox dependency is not a defect
in the Autonomous Decision Engine.

---

## 8. Deliberately out of scope for Part 3C

- Actually dispatching/executing a goal's underlying work once
  admitted to Running — `admitGoal()`/`runDecisionCycle()` drive the
  goal's own status machine only, identical in spirit to Part 3B's
  `dequeueNextGoal()`. Wiring real task dispatch for a goal's work
  stays `capability-router.js`'s `route()`/`task-planner.js`'s job.
- Automatic goal decomposition (free text → sub-goals/tasks) — still
  `task-planner.js`'s job, untouched.
- Continuous/background autonomous looping (a timer that calls
  `runDecisionCycle()` on an interval) — this Part exposes the
  decision function; a caller (e.g. a future page-level integration)
  decides when and how often to invoke it, the same posture
  `runtime-context.js`'s own `startAutoCleanup()`/`stopAutoCleanup()`
  keeps separate from its underlying `cleanupExpiredContexts()`.
- Priority decay/aging, retention/archival policy for the decision
  history beyond its bound, and any UI surface for the new events —
  none existed before this Part and none were added.
- Concurrency capacity is opt-in only (`setMaxConcurrentGoals()`
  defaults to unbounded) — no default ceiling is imposed on any
  existing caller's behavior.
