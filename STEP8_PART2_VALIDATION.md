# AXIOM — Block 2 · Step 8 · Part 2 Validation Report
## Cognitive Decision Engine — Intelligent Planning

**Date:** 2026-08-05
**Status:** ✅ Complete — 28/28 new regression assertions passing;
all other pre-existing, applicable regression suites re-run and still
passing.

---

## 1. Scope delivered

| Requirement | Delivered as |
|---|---|
| Extend `os/core/decision-engine.js`; do not create a second Decision Engine | Same file, same `window.AxiomCognitiveDecisionEngine` global. No `window.Axiom*Plan*Engine` or similar was created. |
| Execution Plan Generation: convert decisions into plans, ordered steps, sequential, parallel, respect Goal Manager dependencies | `generateExecutionPlan(input, options)` — `strategy: 'sequential' \| 'parallel' \| 'learning'`; order/cycle-guard delegated to `AxiomGoalManager.getGoalExecutionOrder()` unchanged; `parallel` groups that order into dependency-safe waves via `AxiomGoalManager.getGoalDependencies()` |
| Alternative Plan Generation: multiple valid plans, compare, score, select best | `generateAlternativePlans(input, options)` — builds every available strategy, scores each, returns `{ plans, selected, rejected }` with a comparative reason per rejection |
| Planning Factors: execution cost, estimated duration, capability availability, agent availability, dependency complexity, system load, historical success rate | `evaluatePlan()` — all 7 factors present on every plan's `.factors` |
| Reuse existing Analytics and Goal Manager Learning | Goal Manager Learning: `AxiomGoalManagerLearning.getStrategyStats()` (success rate + duration) and `.recommendGoalOrder()` (`"learning"` strategy) called verbatim. Analytics: reached only indirectly, exactly as Part 1 documents — as whatever capability an `analytics`-classified goal's plan step recommends via the same `discoverCapabilities()`/`selectAgent()` calls every other capability uses |
| Plan Scoring: reliability, efficiency, completion probability, resource usage, confidence for every plan | `scorePlan(plan)` / `.score` on every returned plan — all 5 dimensions (plus an internal `overall` used for ranking), each in `[0, 1]` |
| Decision Explanation: why selected, why alternatives rejected, expected execution path, estimated completion time | `explainPlan(selected, rejected)` — plain string covering all four |
| Planning Events: `planning_started`, `planning_completed`, `planning_failed`, `plan_selected` via the Orchestrator Event Bus | Emitted via `Orchestrator.emit()` inside `plan()`; verified disjoint from every existing event name in `os/core`, including Part 1's own `decision_*` names |
| Reuse only existing systems (Goal Manager, Goal Manager Learning, Capability Router, Agent Orchestrator, Runtime Context, Analytics); no duplicated scheduling/routing/orchestration/retry/recovery/execution | See §3 |
| Planning only — no dispatch or execution | `plan()`/`generateExecutionPlan()` never call `dispatch`, `route`, `prepare`, `enqueue`, or any agent handler; goals referenced by a plan are left exactly as `decide()`/the caller left them (regression-tested: `markGoalRunning` never called, all goals remain `pending`) |

---

## 2. Why this stays inside `decision-engine.js` (no second engine)

The brief is explicit: extend the existing engine, don't create a
second one. Planning is a natural continuation of Part 1's own scope
— it consumes exactly the Decision Object Part 1 already produces
(`decision.goals`, `decision.decisionId`) and needs the same
dependency set (Orchestrator, Runtime Context, Goal Manager,
Capability Router) plus one new soft one (Goal Manager Learning).
There is no naming collision to resolve this time: `window.
AxiomCognitiveDecisionEngine` already belongs to this module from Part
1, and every new function (`generateExecutionPlan`,
`generateAlternativePlans`, `scorePlan`, `explainPlan`, `plan`,
`getPlanning`, `getPlanningHistory`, `getPlanningMetrics`,
`PLAN_STRATEGIES`) is simply added to that same object's public
surface. Nothing from Part 1 was removed, renamed, or had its
behavior changed — verified by re-running Part 1's own regression
suite unmodified (§5) and by a byte-for-byte diff showing Part 1's own
code paths (`decide()`, `detectIntent()`, `extractContext()`,
`matchCapabilities()`, and their History/Metrics) are untouched aside
from the new code being added around them.

---

## 3. Reuse verification — no duplicated logic

| Existing system | How this Part reuses it | How duplication was avoided |
|---|---|---|
| `AxiomGoalManager.getGoalExecutionOrder()` | The single source of truth for valid goal order, called once per `generateExecutionPlan()` call for every strategy (including `parallel`) | This Part never re-implements topological sort or admission ordering. The `parallel` strategy's wave-grouping is a single forward pass over that already-validated order, reading `getGoalDependencies()` (also pre-existing) to decide which wave each goal lands in — a read-only reinterpretation of published state, not a second scheduler. If two goals in the requested set have a real dependency edge, `getGoalExecutionOrder()` places the prerequisite earlier in its own authoritative order, and the wave-grouping is guaranteed correct because a forward pass over any valid topological order can only ever push a dependent goal to a wave >= its prerequisite's — proven by construction, and regression-tested directly (§4). |
| `AxiomGoalManager.getGoalDependencies()` | Used both for wave-grouping and for computing `dependencyComplexity` and each plan step's own `dependsOn` list | Read-only; never mutated. No dependency edge is ever added, removed, or reinterpreted as anything other than what Goal Manager itself reports. |
| `AxiomGoalManagerLearning.getStrategyStats()` / `.recommendGoalOrder()` | `getStrategyStats(capability)` feeds `historicalSuccessRate` and per-goal duration estimates directly; `recommendGoalOrder({ goalIds })` IS the `"learning"` strategy's step order, called verbatim | No second strategy ledger, success/failure counter, or reordering algorithm exists anywhere in this file. When the module isn't loaded, the `"learning"` strategy is refused with a clear structural error (`generateExecutionPlan`) or silently omitted (`generateAlternativePlans`) rather than approximated. |
| `AxiomCapabilityRouter.selectAgent()` | Called per goal (same call Part 1 already makes) to resolve `agentId`/`agentAvailability` for planning | `route()`, `dispatch()`, `prepare()`, `monitor()`, `cancelRequest()`, `retryRequest()` are never called — regression-tested (`never calls dispatch/route/prepare/markGoalRunning`). |
| `AxiomOrchestrator` (Event Bus, `getStats()`, `discoverCapabilities()`) | `emit`/`on` for the four new planning events; `getStats()` feeds `systemLoad`; `discoverCapabilities()` feeds `capabilityAvailability` (same live call Part 1 already makes, no hardcoded capability list) | This Part installs nothing onto `AxiomOrchestrator`'s own surface. |
| `AxiomRuntimeContext` | One real context record per `plan()` call (`createContext` → `markReady` → `markRunning` → `completeContext`/`failContext`), mirroring `decide()`'s own shape exactly; `getContextMetrics()` feeds `systemLoad` | No second context/status system; Runtime Context's own transition validation is the only status machine involved. |
| Analytics | Reachable only indirectly, exactly Part 1's own posture — as whatever capability an `analytics`-classified goal's plan step recommends | No separate Analytics integration exists to duplicate. |

No goal decomposition, task graph, admission queue, capability
routing/retry pipeline, or agent-dispatch logic is reimplemented
anywhere in the new code.

---

## 4. Regression suite — `block2-step8-part2-planning-regression-suite.js`

28/28 assertions passing. Coverage:

- **Clean install / soft-dependency guards** (4): planning API
  installs alongside Part 1 without editing any of 6 dependency files
  (`readFileSync` diff before/after); `generateExecutionPlan()` works
  with `goal-manager-learning.js` absent (neutral 0.5 success rate);
  `"learning"` strategy throws a clear structural error without that
  module; `generateAlternativePlans()` omits `"learning"` when the
  module is absent.
- **Sequential planning** (1): one goal per step, in Goal Manager's
  own execution order — verified against `getGoalExecutionOrder()`
  directly.
- **Parallel planning** (2): independent goals share one parallel
  step; parallel's estimated duration is `<=` sequential's for the
  same goal set, and its efficiency score is `>=`.
- **Dependency planning** (3): a dependent goal is placed in a later
  wave while an independent goal joins the earlier one, with
  `dependsOn` reported correctly on the step; sequential strategy
  never orders a dependent goal before its prerequisite; a request
  containing only unknown goalIds fails structurally before any plan
  is built (Goal Manager's own `addGoalDependency()` refuses to ever
  create a cycle, so a genuine cycle cannot be constructed through the
  public API — this is the adjacent structural-failure path that
  *can* be verified at this layer).
- **Plan scoring** (4): every plan's `reliability` /
  `efficiency` / `completionProbability` / `resourceUsage` /
  `confidence` are numbers in `[0, 1]`; a goal with a live, healthy
  agent scores higher `agentAvailability`/`capabilityAvailability` and
  higher `reliability` than one with none; `scorePlan()` re-derives
  the same score fresh from a plan object; `scorePlan()` rejects a
  malformed plan object.
- **Alternative plans** (3): returns sequential + parallel + learning
  with exactly one selected; selects the highest-overall-scoring plan;
  every rejected plan carries a non-empty, comparative reason.
- **Explanation generation** (2): `explainPlan()` mentions the
  selected strategy, every rejection, the execution path, and a
  completion estimate; `plan()`'s own returned explanation matches
  `explainPlan()` called on the same selection.
- **Events** (4): `planning_started` fires before `planning_completed`
  with matching `planningId`; `plan_selected` carries the winning
  plan's id/strategy/score; `planning_failed` fires (with no
  `planning_completed`) on invalid input; `planning_failed` marks the
  planning cycle's own Runtime Context record `failed`, not left
  dangling.
- **No execution** (1): a full `decide()` → `plan()` cycle never calls
  `dispatch`/`route`/`prepare`/`markGoalRunning`; every goal remains
  `pending` afterward.
- **History / metrics** (3): `getPlanning()`/`getPlanningHistory()`
  round-trip; `getPlanningMetrics()` tracks started/completed/failed
  counts independently of `getMetrics()` (decision metrics); empty/
  invalid input throws before any state (context, history) is
  created.
- **End-to-end** (1): `plan()` accepts a `decide()` Decision Object
  directly, carries its `decisionId` through to every generated plan,
  and every plan's `goalIds` matches the decision's own goals exactly.

```
$ node test-evidence/block2-step8-part2-planning-regression-suite.js
AXIOM Block 2 / Step 8 / Part 2 — Intelligent Planning regression

  PASS  planning API installs alongside Part 1 without editing any dependency file
  ... (28 total)
28/28 assertions passing
```

---

## 5. Full regression run — all suites

All 36 pre-existing regression suites in `test-evidence/` (35 from
before Part 1, plus Part 1's own) were re-run unmodified, plus the new
Part 2 suite (37 total):

| Result | Count | Suites |
|---|---|---|
| ✅ Passing | 31 | Every suite that does not require the `jsdom` npm package — includes Part 1's own suite (41/41, unaffected), Part 3C's own decision-engine suite (37/37, unaffected — a different, unrelated `window.AxiomDecisionEngine` global, see Part 1 §2), and Part 3F's (38/38, unaffected) |
| ⚠️ Pre-existing, unrelated failure | 6 | `block2-step1-coding-agent-regression-suite.js`, `block2-step1-part2-pipeline-regression-suite.js`, `milestone5-manual-commands.js`, `milestone5-regression-suite.js`, `milestone6-regression-suite.js`, `milestone10-regression-suite.js` |
| ❌ New failures introduced by this Part | 0 | — |

The 6 failing suites all fail identically, at `require('jsdom')`,
before any AXIOM code runs — `jsdom` is not installed in this offline
sandbox (no network access to fetch it). None of the six touch
`decision-engine.js`, `goal-manager.js`, `goal-manager-learning.js`,
`capability-router.js`, `runtime-context.js`, or `orchestrator.js` in
their `require`/load lists (verified directly — the one incidental
match, `milestone10-regression-suite.js` loading an `orchestrator.js`,
resolves to the unrelated `os/runtime/intelligence/orchestrator.js`,
not `os/core/orchestrator.js`). This is the same environment/
dependency-installation gap Part 1's own validation report documented
(it listed 5 of these 6 by name; `milestone5-manual-commands.js` is a
sixth pre-existing file in the same jsdom-dependent family, confirmed
here by direct execution). This matches the "Fix only verified
defects" instruction: none of these are defects this Part introduced
or could fix by editing `decision-engine.js`.

A repository-wide diff against the Part 1 deliverable confirms the
only changed file is `os/core/decision-engine.js`, and the only new
file is `test-evidence/block2-step8-part2-planning-regression-suite.js`:

```
$ diff -rq <Part-1-deliverable> <this-deliverable>
Files os/core/decision-engine.js differ
Only in test-evidence: block2-step8-part2-planning-regression-suite.js
```

---

## 6. Manual verification (in addition to the automated suite)

Ad hoc `vm`-sandbox runs against the real, unmodified project files
confirmed, end to end:

- A multi-clause `decide()` request ("open github.com and debug the
  login function, then search for react hooks") fed straight into
  `plan()` produces a `"parallel"`-selected plan (two independent
  goals from the two detected intents, sharing one parallel step) with
  a higher score than the `"sequential"` alternative — printed
  factors and the generated explanation confirmed by hand.
- A three-goal set with `g2` depending on `g1` and `g3` independent of
  both, planned with `strategy: 'parallel'`, produces exactly two
  steps: `{ g1, g3 }` (parallel) then `{ g2 }` (sequential), with
  `g2`'s step reporting `dependsOn: [g1.id]` — confirming the wave-
  grouping logic in §3 holds in practice, not just in the regression
  suite.

---

## 7. Conclusion

Block 2 / Step 8 / Part 2 is complete: intelligent planning (execution
plan generation, alternative plan generation, planning-factor
evaluation, plan scoring, decision explanation, and planning events)
is implemented as an extension of the existing
`os/core/decision-engine.js` / `window.AxiomCognitiveDecisionEngine` —
no second engine was created. Goal order and dependency-cycle
detection remain entirely `AxiomGoalManager`'s; historical scoring and
learned reordering remain entirely `AxiomGoalManagerLearning`'s;
capability/agent lookup remains entirely `AxiomOrchestrator`'s /
`AxiomCapabilityRouter`'s — nothing is duplicated. This Part performs
analysis and read-only recommendation only: it never dispatches,
executes, or admits any goal. 28/28 new regression assertions pass;
all applicable pre-existing suites still pass; the only file modified
in the entire project is `os/core/decision-engine.js`, plus one new
test file.
