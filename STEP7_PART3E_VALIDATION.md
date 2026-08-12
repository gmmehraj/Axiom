# AXIOM — Block 2 · Step 7 · Part 3E Validation Report
## Goal Manager Learning Layer

**Date:** 2026-08-03
**Status:** ✅ Complete — 35/35 new regression assertions passing;
all other pre-existing, applicable regression suites re-run and still
passing.

---

## 1. Scope delivered

| Requirement | Delivered as |
|---|---|
| Record execution history | `getExecutionHistory()` over a bounded, append-only ledger fed ONLY by `goal-manager.js`'s own `goalmgr_completed`/`goalmgr_failed`/`goalmgr_cancelled`/`goalmgr_retried` events — works for a goal driven entirely by hand, not only one dispatched through Parts 3C/3D |
| Track successful strategies | `listStrategyStats()` — per-strategy `successes`/`score`, most-successful-first |
| Track failures | `listFailingStrategies(minFailures)` — per-strategy `failures`, worst-first, threshold-filterable |
| Recommend better execution order | `recommendGoalOrder()` — re-ranks Part 3B's own `getGoalExecutionOrder()` via provably dependency-safe adjacent swaps (see §3.1) |
| Optimize future goal scheduling | `optimizeGoalScheduling()` — the learned-order counterpart of Part 3B's own `runGoalScheduler()`, same `scheduleGoal()` calls, same `{ scheduled, blocked }` shape |
| Improve prioritization using historical data | `getRecommendedPriority()` (read-only, advisory) + `applyRecommendedPriority()` (explicit opt-in), bucketed onto Part 3A's own `GOAL_PRIORITY` enum |
| Do not implement machine learning | Every number is a plain running-count statistic: a Laplace-smoothed success proportion `(successes+1)/(successes+failures+2)` and an arithmetic-mean duration — no model, no training step, no persisted weights (see §3.2) |
| Reuse existing analytics and Runtime Context | `getLearningMetrics()` composes `AxiomGoalManager.getGoalMetrics()`, `AxiomRuntimeContext.getContextMetrics()`, and (when loaded) `AxiomDecisionEngine.getDecisionMetrics()` / `AxiomDecisionEngineExecutionBridge.getExecutionMetrics()` — nothing any of those already compute is re-derived |

---

## 2. Files changed

| File | Change |
|---|---|
| `os/core/goal-manager-learning.js` | **New.** `window.AxiomGoalManagerLearning`. ~370 lines. |
| `CHANGELOG.md` | New entry prepended. Nothing else in the file altered. |
| `test-evidence/block2-step7-part3e-goal-manager-learning-regression-suite.js` | **New.** 35 assertions. |
| `STEP7_PART3E_VALIDATION.md` | **New.** This file. |

No other file in the project was modified. In particular,
`os/core/orchestrator.js`, `os/core/runtime-context.js`,
`os/core/goal-manager.js`, `os/core/task-planner.js`,
`os/core/autonomous-decision-engine.js`,
`os/core/decision-engine-execution-bridge.js`, `automation.html`,
`brain.html`, and every pre-existing regression suite file are
byte-for-byte unchanged — verified both programmatically (the new
suite's own "installs cleanly ... without editing any dependency" test
does a `readFileSync` diff of six dependencies before/after load) and
by inspection.

Consistent with the convention Parts 3A–3D already established, this
Part does not add its own `<script>` tag to `automation.html`. Wiring
the Step 7 stack into a live page is left to whichever future part is
explicitly scoped to do that.

---

## 3. Design notes

### 3.1 Why an adjacent swap in `recommendGoalOrder()` is always dependency-safe

`getGoalExecutionOrder()` (Part 3B, reused verbatim) already returns a
valid topological order. Suppose goal A sits immediately before goal B
and A is a TRANSITIVE (but not direct) prerequisite of B — i.e.
`A -> K -> B` for some intermediate goal K. Because the existing order
is already topological, K must appear strictly after A (K depends on
A) and strictly before B (B depends on K) — meaning K would have to
occupy a position BETWEEN A and B. That contradicts A and B being
adjacent. So for any two adjacent positions, the only dependency
relationship that can possibly exist between them is a DIRECT one —
exactly what `GoalManager.getGoalDependencies()` already reports — and
checking that single direct edge is sufficient to guarantee a swap
never violates the dependency graph. No transitive-closure walk and no
second topological sort is implemented anywhere in this file.

Two further guards keep the recommendation conservative:

- A swap is only ever considered between goals sharing the **same
  priority tier** — a goal is never promoted ahead of a genuinely
  higher-priority one on the strength of history alone.
- A configurable `swapThreshold` (default `0.05`) requires a
  meaningful score gap before a swap happens at all — regression-
  tested (`setSwapThreshold(0.99)` makes reordering a true no-op),
  preventing churn from noise between two strategies with nearly
  identical track records.

### 3.2 Why this is statistics, not machine learning

Every number `AxiomGoalManagerLearning` produces is directly
computable from the counts the module itself keeps, with no fitted
parameters, no gradient step, and no model artifact of any kind:

- **Score** = `(successes + 1) / (successes + failures + 2)` — Laplace
  (add-one) smoothing over a strategy's observed completed/failed
  attempts. Chosen only so a brand-new, zero-sample strategy starts at
  a neutral `0.5` instead of dividing by zero or being treated as a
  proven failure the first time it's ever tried. Regression-tested
  directly: 3 successes and 0 failures yields exactly `4/5 = 0.8`, a
  value any reader can re-derive by hand.
- **Average duration** = arithmetic mean of `finishedAt - startedAt`
  across a strategy's completed goals — a plain average, not a
  weighted or decayed one.
- **Recommended priority** = one of three fixed thresholds
  (`score >= 0.75` → HIGH, `>= 0.4` → NORMAL, else → LOW) applied to
  the score above — a lookup table over a single computed number, not
  a classifier.

Cancellations, retries, and exhausted-retry counts are tracked for
visibility but are deliberately **excluded** from the score
computation — a cancellation is an external decision, not evidence the
strategy itself is unreliable.

### 3.3 Required vs. optional dependencies — and why

`os/core/orchestrator.js`, `os/core/runtime-context.js`, and
`os/core/goal-manager.js` are hard requirements — the module refuses
to install without them, exactly like every prior Part in this lineage
(regression-tested). `os/core/autonomous-decision-engine.js` (Part 3C)
and `os/core/decision-engine-execution-bridge.js` (Part 3D) are
soft-checked at each use site and are **not** required:

- Strategy-key resolution reuses `AxiomDecisionEngine.resolveGoalCapability()`
  verbatim when Part 3C is loaded, and falls back to reading the
  identical two metadata keys (`metadata.capability` /
  `metadata.requiredCapability`) locally when it is not.
- "Exhausted retries" tracking (a concept that only exists at Part
  3D's execution-bridge layer, with no `goal-manager.js`-level
  equivalent) is only ever wired up when
  `AxiomDecisionEngineExecutionBridge` happens to be present; its
  absence degrades that one counter only.
- `getLearningMetrics()` includes `decisions`/`execution` keys only
  when those two modules are loaded — regression-tested both ways.

This means a project that has only ever built `goal-manager.js` (Parts
3A/3B) gets full learning-history tracking, strategy stats, order
recommendations, and priority suggestions with zero dependency on
task-planner.js, the Decision Engine, or the Execution Bridge — this
Part genuinely **extends the Goal Manager**, not the execution
pipeline built on top of it.

### 3.4 Why a new standalone file, not an extension of `goal-manager.js` itself

Same reasoning `autonomous-decision-engine.js`'s and
`decision-engine-execution-bridge.js`'s own validation reports already
give, one layer up: this module is a *consumer* of `AxiomOrchestrator`,
`AxiomGoalManager`, `AxiomRuntimeContext`, and optionally
`AxiomDecisionEngine`/`AxiomDecisionEngineExecutionBridge`. Putting its
logic inside `goal-manager.js` itself would make that foundational
module aware of Parts 3C/3D in a way it deliberately is not today, and
would grow a file that Parts 3B through 3D already treat as a stable,
untouched dependency. A fifth (well, sixth) standalone file
(`AxiomGoalManagerLearning`) keeps every existing module exactly as
decoupled as it already was, while still satisfying "extend the Goal
Manager with learning capabilities" at the product level: every public
entry point in this file takes a `goalId` or a Goal Manager filter and
returns Goal-Manager-shaped data.

---

## 4. Regression results

### 4.1 New suite

```
$ node test-evidence/block2-step7-part3e-goal-manager-learning-regression-suite.js
AXIOM Block 2 / Step 7 / Part 3E — Goal Manager Learning Layer regression

  PASS  module does not install itself without AxiomOrchestrator present
  PASS  module does not install itself without AxiomRuntimeContext present
  PASS  module does not install itself without AxiomGoalManager present
  PASS  module installs cleanly with the FULL stack present, without editing any dependency
  PASS  module installs cleanly with ONLY goal-manager.js present (no Part 3C/3D)
  PASS  a manually-completed goal (no Decision Engine/Bridge loaded) is recorded in execution history
  PASS  a goal with no capability metadata is grouped under the fixed "general" strategy
  PASS  a manually-failed goal increments failure stats for its strategy
  PASS  a manually-cancelled goal is recorded as a cancellation, not a failure
  PASS  a manual retry is recorded against the ORIGINAL goal's strategy
  PASS  an autonomously-executed successful goal is recorded via goal-manager.js's own events
  PASS  an autonomously-executed, exhausted-retry goal increments the "exhausted" counter (Part 3D enrichment)
  PASS  exhausted-retry tracking is simply absent (no throw) when Part 3D is not loaded
  PASS  getStrategyStats() for a never-seen strategy returns a neutral, zero-sample snapshot
  PASS  score is a deterministic Laplace-smoothed statistic, not a black-box model
  PASS  listStrategyStats() sorts most-successful-first
  PASS  listFailingStrategies() only returns strategies at/above the failure threshold
  PASS  recommendGoalOrder() reorders two independent, same-priority goals toward the historically stronger strategy
  PASS  recommendGoalOrder() never reorders across different priority tiers
  PASS  recommendGoalOrder() never violates a real dependency edge
  PASS  a swap threshold below the score gap is a no-op (churn control)
  PASS  optimizeGoalScheduling() queues goals in the learned order and returns the runGoalScheduler() shape
  PASS  optimizeGoalScheduling() reports blocked goals exactly like runGoalScheduler()
  PASS  getRecommendedPriority() declines to recommend with too little history
  PASS  getRecommendedPriority() suggests HIGH for a strategy with a strong track record
  PASS  getRecommendedPriority() suggests LOW for a strategy with a poor track record
  PASS  applyRecommendedPriority() actually calls setGoalPriority() and emits an event
  PASS  applyRecommendedPriority() is a no-op when already at the recommended priority
  PASS  getRecommendedPriority() throws for an unknown goal id (same posture as the rest of the stack)
  PASS  getLearningMetrics() folds in existing Goal Manager + Runtime Context metrics without re-deriving them
  PASS  getLearningMetrics() includes decisions/execution when Parts 3C/3D are loaded
  PASS  every read-path result is frozen (no accidental external mutation)
  PASS  setSwapThreshold() rejects out-of-range values
  PASS  setMinSamplesForRecommendation() rejects non-integers and negatives
  PASS  getExecutionHistory() supports goalId/strategy/outcome filters and a limit, most-recent-first

35/35 assertions passing
```

### 4.2 Full pre-existing suite re-run

Every file under `test-evidence/` was re-run after this change (exact
command: `node test-evidence/<file>.js` per suite). Results:

| Suite | Result |
|---|---|
| block2-step7-part3d-execution-bridge-regression-suite.js | 24/24 ✅ |
| block2-step7-part3c-decision-engine-regression-suite.js | 37/37 ✅ |
| block2-step7-part3b-goal-scheduling-regression-suite.js | 45/45 ✅ |
| block2-step7-part3a-goal-manager-regression-suite.js | 35/35 ✅ |
| block2-step7-part2-task-planner-regression-suite.js | 21/21 ✅ |
| block2-step6-part5-runtime-context-regression-suite.js | 42/42 ✅ |
| block2-step6-part4-workflow-planner-regression-suite.js | 29/29 ✅ |
| block2-step6-part3-capability-routing-regression-suite.js | 20/20 ✅ |
| block2-step6-part2-agent-registry-integration-regression-suite.js | 18/18 ✅ |
| block2-step6-part1-orchestrator-regression-suite.js | 21/21 ✅ |
| block2-step5-part6b-error-recovery-regression-suite.js | 15/15 ✅ |
| block2-step5-part6a-browser-audit-regression-suite.js | 7/7 ✅ |
| block2-step5-part2-navigation-session-regression-suite.js | 28/28 ✅ |
| block2-step5-part1-browser-foundation-regression-suite.js | 21/21 ✅ |
| block2-step4-part4-automation-manager-regression-suite.js | pass ✅ |
| block2-step4-part3-automation-memory-integration-regression-suite.js | pass ✅ |
| block2-step4-part2-brain-automation-integration-regression-suite.js | pass ✅ |
| block2-step4-part1-automation-foundation-regression-suite.js | 17/17 ✅ |
| block2-step3-part3-memory-manager-regression-suite.js | 30/30 ✅ |
| block2-step3-part2-memory-integration-regression-suite.js | pass ✅ |
| block2-step3-part1-memory-foundation-regression-suite.js | pass ✅ |
| block2-step2-part2-brain-integration-regression-suite.js | pass ✅ |
| milestone11-regression-suite.js | 41/41 ✅ |
| milestone12-regression-suite.js | 19/19 ✅ |
| milestone13-regression-suite.js | 46/46 ✅ |
| milestone14-part1-regression-suite.js | 58/58 ✅ |
| phase9-part1-static-audit-suite.js | 1382/1382 ✅ |

**Not run to completion in this sandbox** —
`block2-step1-coding-agent-regression-suite.js`,
`block2-step1-part2-pipeline-regression-suite.js`,
`milestone5-regression-suite.js`, `milestone6-regression-suite.js`,
`milestone10-regression-suite.js` all fail at `require('jsdom')` with
`MODULE_NOT_FOUND`. This is the identical, pre-existing missing
`devDependency` Part 3D's own validation report already documented —
**not** a defect introduced by, or related to, this Part: none of
these five suites load `goal-manager.js` or any file this Part
touches, and all five fail identically with this Part's new file
deleted entirely.

`block2-step7-part3d-execution-bridge-regression-suite.js` takes
roughly 34 seconds to complete in this sandbox (retry/backoff timing
internal to that suite, unrelated to this Part) — it still reports
24/24 passing; only noted here because a 30-second wrapper timeout
during this Part's own re-run cut its log short before printing the
final line on the first attempt, and a longer-timeout re-run confirmed
a clean pass.

---

## 5. What was preserved

- Every Part 1–3D guarantee — unchanged and re-verified by their own,
  unmodified regression suites.
- Snapshot immutability (`deepFreeze` on every read path this module
  exposes) — same convention as the rest of the Step 7 stack.
- The "no hardcoded workflow" posture — no goal-type, capability, or
  agent-id literal anywhere in the new file; strategy keys are read
  from `AxiomDecisionEngine.resolveGoalCapability()` or a goal's own
  metadata, never invented.
- The "no machine learning" constraint — every produced number is a
  directly hand-verifiable statistic (see §3.2), regression-tested for
  its exact value.
- Task Planner, Decision Engine, and Execution Bridge internals — none
  of them referenced except through their already-public, already-
  documented read APIs, and only ever optionally.
- Browser, Brain, Memory, Automation, Analytics, OpenRouter, and every
  `.html`/UI file — untouched.
- All existing regression suites that could run in this sandbox —
  still passing unmodified (only new tests were added; no existing
  assertion was weakened or removed).
