// ============================================================
// AXIOM — Block 2 / Step 7 / Part 3E: Goal Manager Learning Layer
// ------------------------------------------------------------
// Parts 3A/3B (goal-manager.js) gave the stack a durable Goal Record
// with a validated status machine, priority, dependencies, a computed
// queue, and scheduling primitives. Part 3C (autonomous-decision-
// engine.js) added an eligibility-aware admission layer on top, and
// Part 3D (decision-engine-execution-bridge.js) wired admission
// through to real execution and back. None of those four Parts ever
// remember what happened LAST time a given kind of goal ran — every
// decision is made fresh, from the goal graph and live system state
// alone, with zero notion of "this kind of goal has historically
// succeeded/failed/been slow".
//
// This Part is that missing memory, and adds nothing else:
//
//   1. Records execution history — every terminal outcome (Completed/
//      Failed/Cancelled), plus every retry, that ANY goal ever
//      reaches, whether it got there via Part 3C/3D's autonomous path
//      or a caller driving `goal-manager.js`'s own status machine by
//      hand. This module listens ONLY to events `goal-manager.js`
//      itself already emits (`goalmgr_completed` / `goalmgr_failed` /
//      `goalmgr_cancelled` / `goalmgr_retried`) — so a manually-driven
//      goal is learned from exactly as much as an autonomously-
//      dispatched one, and this module needs no reference to
//      `task-planner.js` at all.
//   2. Tracks successful strategies and tracks failures — grouped by
//      "strategy", which is simply whatever capability a goal already
//      declares on its own metadata (`metadata.capability` /
//      `metadata.requiredCapability`, the exact same field Part 3C's
//      own `resolveGoalCapability()` already reads — reused verbatim
//      via `AxiomDecisionEngine.resolveGoalCapability()` when that
//      module is loaded, with a local fallback to the identical two
//      metadata keys when it is not). A goal with no capability at
//      all is grouped under the fixed key `'general'`. No goal-type,
//      capability, or agent-id table is hardcoded anywhere in this
//      file — every key this module ever uses comes from a goal's own
//      metadata or from `AxiomDecisionEngine`'s existing resolution.
//   3. Recommends a better execution order — `recommendGoalOrder()`
//      takes Part 3B's own `getGoalExecutionOrder()` (the real,
//      already-validated topological + priority + age ordering) AS
//      GIVEN and only ever swaps two ADJACENT entries in it, and only
//      when ALL of the following hold: (a) they share the same
//      priority tier, so no goal is ever promoted ahead of a
//      genuinely higher-priority one, and (b) neither is a dependency
//      of the other, so an already-valid dependency order is never
//      violated. See "Why an adjacent swap is always dependency-safe"
//      below for why checking direct dependency between exactly two
//      ADJACENT positions is sufficient — no transitive-closure walk
//      (and no second topological sort) is implemented here; Part
//      3B's own cycle-checked ordering and `getGoalDependencies()` are
//      reused as-is.
//   4. Optimizes future goal scheduling — `optimizeGoalScheduling()`
//      is the learned-order counterpart of Part 3B's own
//      `runGoalScheduler()`: it walks `recommendGoalOrder()`'s output
//      and calls Part 3B's existing `scheduleGoal()` on each entry, in
//      that order — the exact same call `runGoalScheduler()` already
//      makes, just fed a learned order instead of the raw one. No
//      admission, transition, or queue logic is reimplemented.
//   5. Improves prioritization using historical data —
//      `getRecommendedPriority()` is a read-only, advisory suggestion
//      (never applied automatically) built from a strategy's
//      historical success rate, bucketed onto Part 3A's OWN
//      `GOAL_PRIORITY` enum (`LOW`/`NORMAL`/`HIGH`) — no new priority
//      scale is introduced. `applyRecommendedPriority()` is the
//      explicit, caller-invoked opt-in that actually calls Part 3B's
//      existing `setGoalPriority()`.
//
// No machine learning of any kind is used anywhere in this file: every
// number this module produces is a plain, auditable statistic over
// counts this module itself keeps — a Laplace-smoothed success
// proportion (`(successes + 1) / (successes + failures + 2)`, chosen
// only so a brand-new, zero-sample strategy starts at a neutral 0.5
// instead of dividing by zero or being treated as a proven failure)
// and a simple arithmetic mean duration. There is no model, no
// training step, and no persisted weights beyond these running counts.
//
// Why an adjacent swap is always dependency-safe (no transitive walk
// needed): `getGoalExecutionOrder()` is already a valid topological
// order. Suppose goal A sits immediately before goal B and A is a
// TRANSITIVE (but not direct) prerequisite of B — i.e. A -> K -> B for
// some intermediate goal K. Because the existing order is already
// topological, K must appear strictly after A (K depends on A) and
// strictly before B (B depends on K) — meaning K would have to occupy
// a position BETWEEN A and B. That contradicts A and B being
// adjacent. So for any two adjacent positions, the only dependency
// relationship that can possibly exist between them is a DIRECT one —
// exactly what `GoalManager.getGoalDependencies()` already reports —
// and checking that single direct edge is therefore sufficient to
// guarantee a swap never violates the dependency graph.
//
// What this module explicitly does NOT do:
//   - It does not re-implement topological sort, cycle detection,
//     dependency tracking, the goal queue, or any status transition.
//     All of that stays exactly Part 3A/3B's. This module only ever
//     calls `getGoalExecutionOrder()`, `getGoalDependencies()`,
//     `scheduleGoal()`, `setGoalPriority()`, and read-only getters.
//   - It does not re-implement capability resolution or agent
//     selection. When `AxiomDecisionEngine` is loaded, its own
//     `resolveGoalCapability()` is reused verbatim; the local fallback
//     reads the identical two metadata keys that function already
//     reads, and is used only so this module still functions with
//     just `goal-manager.js` loaded.
//   - It does not execute, dispatch, retry, or cancel a goal. It only
//     ever OBSERVES outcomes other modules already produced and
//     records/recommends on top of them.
//   - It does not automatically change a goal's priority.
//     `getRecommendedPriority()` is read-only; only the separate,
//     explicitly-named `applyRecommendedPriority()` mutates anything,
//     and even that is just a thin call to Part 3B's own
//     `setGoalPriority()`.
//   - It does not install anything onto `AxiomOrchestrator` — same
//     standalone-global posture every other Step 7 Part already
//     documents, and for the identical reason: nothing here should be
//     able to collide with `task-planner.js`'s or any other module's
//     own surface there.
//
// Dependencies — required vs. optional:
//   REQUIRED (module refuses to install without these, exactly like
//   every other Part in this lineage): `os/core/orchestrator.js`
//   (Event Bus), `os/core/runtime-context.js` (system-load signal,
//   folded into `getLearningMetrics()` — reused, never re-derived),
//   `os/core/goal-manager.js` (Step 7 Parts 3A/3B — the Goal Record,
//   its events, and every scheduling primitive this module builds on).
//   OPTIONAL, soft-checked at each use site, never required to load:
//   `os/core/autonomous-decision-engine.js` (Part 3C — enriches
//   strategy-key resolution and `getLearningMetrics()` when present)
//   and `os/core/decision-engine-execution-bridge.js` (Part 3D —
//   enriches `getLearningMetrics()` and adds "exhausted retries"
//   tracking when present). Loading only `goal-manager.js` underneath
//   this module is a fully supported configuration.
//
// Usage:
//   AxiomGoalManagerLearning.getExecutionHistory({ strategy: 'search-web' })
//   AxiomGoalManagerLearning.getStrategyStats('search-web')
//   // -> { key, attempts, successes, failures, cancellations, retries,
//   //      exhausted, successRate, score, avgDurationMs }
//   AxiomGoalManagerLearning.listStrategyStats()
//   AxiomGoalManagerLearning.listFailingStrategies(2)
//
//   AxiomGoalManagerLearning.recommendGoalOrder()
//   AxiomGoalManagerLearning.optimizeGoalScheduling()
//   // -> { scheduled: [...], blocked: [...] }  (same shape as
//   //    AxiomGoalManager.runGoalScheduler())
//
//   AxiomGoalManagerLearning.getRecommendedPriority(goalId)
//   // -> { goalId, strategy, recommended, currentPriority, score, reason }
//   AxiomGoalManagerLearning.applyRecommendedPriority(goalId)
//
//   AxiomGoalManagerLearning.getLearningMetrics()
//   AxiomOrchestrator.on('goalmgrlearn_recorded', ({ goalId, strategy, outcome }) => { ... });
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;
  var RuntimeContext = global.AxiomRuntimeContext;
  var GoalManager = global.AxiomGoalManager;
  var DecisionEngine = global.AxiomDecisionEngine; // optional
  var ExecutionBridge = global.AxiomDecisionEngineExecutionBridge; // optional

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[AxiomGoalManagerLearning] ' + message, detail !== undefined ? detail : '');
      return;
    }
    try {
      // eslint-disable-next-line no-console
      console[method === 'error' ? 'error' : 'log']('[AxiomGoalManagerLearning] ' + message, detail || '');
    } catch (e) { /* no console available — swallow */ }
  }

  if (!Orchestrator || typeof Orchestrator.emit !== 'function' || typeof Orchestrator.on !== 'function') {
    log('error', 'requires os/core/orchestrator.js (Event Bus) loaded first.');
    return;
  }
  if (!RuntimeContext || typeof RuntimeContext.getContextMetrics !== 'function') {
    log('error', 'requires os/core/runtime-context.js loaded first.');
    return;
  }
  if (!GoalManager || typeof GoalManager.getGoal !== 'function' ||
      typeof GoalManager.getGoalExecutionOrder !== 'function' ||
      typeof GoalManager.getGoalDependencies !== 'function' ||
      typeof GoalManager.scheduleGoal !== 'function' ||
      typeof GoalManager.setGoalPriority !== 'function' ||
      typeof GoalManager.getGoalMetrics !== 'function' ||
      !GoalManager.GOAL_PRIORITY || !GoalManager.GOAL_STATUS) {
    log('error', 'requires os/core/goal-manager.js (Step 7 Part 3A/3B) loaded first.');
    return;
  }

  var API_VERSION = '1.0.0';

  // ------------------------------------------------------------
  // Small shared helpers — same conventions as the rest of the Step 7
  // stack (ES5, no external deps, own tiny copies rather than
  // reaching into another module's internals).
  // ------------------------------------------------------------
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function now() { return Date.now(); }

  function deepFreeze(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.getOwnPropertyNames(obj).forEach(function (key) {
      var val = obj[key];
      if (val && typeof val === 'object' && !Object.isFrozen(val)) deepFreeze(val);
    });
    return Object.freeze(obj);
  }

  function emit(event, payload) {
    try {
      Orchestrator.emit(event, payload);
    } catch (err) {
      log('error', 'emit:' + event + ' failed', err && err.message);
    }
  }

  var GOAL_PRIORITY = GoalManager.GOAL_PRIORITY;
  var GOAL_STATUS = GoalManager.GOAL_STATUS;

  // ------------------------------------------------------------
  // PART A — Strategy key resolution. Reuses
  // `AxiomDecisionEngine.resolveGoalCapability()` verbatim when Part
  // 3C is loaded (identical logic, identical two metadata keys); the
  // local fallback below reads the same two keys so this module keeps
  // working with just `goal-manager.js` present. No literal
  // capability/goal-type table exists here.
  // ------------------------------------------------------------
  var GENERAL_STRATEGY = 'general';

  function resolveStrategyKey(goal) {
    if (DecisionEngine && typeof DecisionEngine.resolveGoalCapability === 'function') {
      try {
        var cap = DecisionEngine.resolveGoalCapability(goal.id);
        if (isNonEmptyString(cap)) return cap;
      } catch (err) {
        // Defensive only — evaluateGoal-family calls should not throw
        // for an existing goal; fall through to the local reader.
      }
    }
    var meta = isPlainObject(goal.metadata) ? goal.metadata : {};
    if (isNonEmptyString(meta.capability)) return meta.capability;
    if (isNonEmptyString(meta.requiredCapability)) return meta.requiredCapability;
    return GENERAL_STRATEGY;
  }

  // ------------------------------------------------------------
  // PART B — Execution history ledger & per-strategy statistics.
  // Bounded, append-only history mirrors the exact "History"
  // discipline `goal-manager.js` / `autonomous-decision-engine.js` /
  // `decision-engine-execution-bridge.js` already use elsewhere — no
  // new persistence pattern is invented.
  // ------------------------------------------------------------
  var MAX_HISTORY = 1000;
  var executionHistory = [];
  var strategyStatsByKey = Object.create(null);
  var totals = { recorded: 0, successes: 0, failures: 0, cancellations: 0, retries: 0, exhausted: 0 };

  function pushHistory(entry) {
    executionHistory.unshift(deepFreeze(Object.assign({ at: now() }, entry)));
    if (executionHistory.length > MAX_HISTORY) executionHistory.length = MAX_HISTORY;
  }

  function ensureStrategy(key) {
    return strategyStatsByKey[key] || (strategyStatsByKey[key] = {
      key: key,
      attempts: 0, successes: 0, failures: 0, cancellations: 0, retries: 0, exhausted: 0,
      totalDurationMs: 0, durationSamples: 0
    });
  }

  function durationFor(goal) {
    return (typeof goal.startedAt === 'number' && typeof goal.finishedAt === 'number')
      ? (goal.finishedAt - goal.startedAt)
      : null;
  }

  // Records exactly one observed outcome for the goal's OWN strategy.
  // `outcome` is one of: 'completed' | 'failed' | 'cancelled' |
  // 'retry' | 'exhausted'. Silently a no-op for an unknown goalId
  // (defensive — every listener below only ever fires for a goal that
  // must already exist, since goal-manager.js itself just emitted the
  // event this function is reacting to).
  function recordOutcome(goalId, outcome, extra) {
    var goal = GoalManager.getGoal(goalId);
    if (!goal) return;

    var strategy = resolveStrategyKey(goal);
    var duration = durationFor(goal);
    var s = ensureStrategy(strategy);

    if (outcome === 'completed') {
      s.attempts += 1; s.successes += 1; totals.successes += 1;
      if (duration !== null) { s.totalDurationMs += duration; s.durationSamples += 1; }
    } else if (outcome === 'failed') {
      s.attempts += 1; s.failures += 1; totals.failures += 1;
    } else if (outcome === 'cancelled') {
      s.cancellations += 1; totals.cancellations += 1;
    } else if (outcome === 'retry') {
      s.retries += 1; totals.retries += 1;
    } else if (outcome === 'exhausted') {
      s.exhausted += 1; totals.exhausted += 1;
    } else {
      return; // unknown outcome — never recorded
    }
    totals.recorded += 1;

    pushHistory({
      goalId: goalId,
      strategy: strategy,
      priority: goal.priority,
      outcome: outcome,
      durationMs: duration,
      retryCount: goal.retryCount,
      reason: (extra && extra.reason !== undefined) ? extra.reason : null,
      relatedGoalId: (extra && extra.relatedGoalId !== undefined) ? extra.relatedGoalId : null
    });

    emit('goalmgrlearn_recorded', { goalId: goalId, strategy: strategy, outcome: outcome });
  }

  // ------------------------------------------------------------
  // PART C — Event listeners. The REQUIRED signal set is exactly the
  // four events `goal-manager.js` itself already emits — present
  // regardless of whether Part 3C/3D/task-planner.js are loaded at
  // all, so a goal driven entirely by hand through
  // `AxiomGoalManager.completeGoal()`/`failGoal()`/`cancelGoal()`/
  // `retryGoal()` is learned from exactly like an autonomously
  // dispatched one.
  // ------------------------------------------------------------
  function onGoalCompleted(payload) {
    if (payload && payload.goalId) recordOutcome(payload.goalId, 'completed');
  }
  function onGoalFailed(payload) {
    if (payload && payload.goalId) recordOutcome(payload.goalId, 'failed', { reason: payload.detail });
  }
  function onGoalCancelled(payload) {
    if (payload && payload.goalId) recordOutcome(payload.goalId, 'cancelled', { reason: payload.detail });
  }
  // goalmgr_retried fires on the freshly-minted RETRY goal
  // (payload.goalId), carrying payload.retryOf back to the original
  // goal that needed retrying — the strategy this event should count
  // against, since the new goal has not run yet.
  function onGoalRetried(payload) {
    if (!payload || !payload.retryOf) return;
    recordOutcome(payload.retryOf, 'retry', { relatedGoalId: payload.goalId });
  }

  Orchestrator.on('goalmgr_completed', onGoalCompleted);
  Orchestrator.on('goalmgr_failed', onGoalFailed);
  Orchestrator.on('goalmgr_cancelled', onGoalCancelled);
  Orchestrator.on('goalmgr_retried', onGoalRetried);

  // OPTIONAL enrichment: "exhausted" (a bounded-retries concept that
  // only exists at Part 3D's execution-bridge layer) has no
  // `goal-manager.js`-level equivalent, so it is only ever tracked
  // when `AxiomDecisionEngineExecutionBridge` happens to be loaded —
  // never a hard requirement, and its absence degrades this one
  // counter only, nothing else.
  if (ExecutionBridge) {
    Orchestrator.on('decisionengine_execution_exhausted', function (payload) {
      if (payload && payload.goalId) recordOutcome(payload.goalId, 'exhausted', { reason: payload.reason });
    });
  }

  // ------------------------------------------------------------
  // PART D — Read APIs over the ledger.
  // ------------------------------------------------------------
  function getExecutionHistory(filter, limit) {
    filter = isPlainObject(filter) ? filter : {};
    var out = executionHistory.filter(function (e) {
      if (filter.goalId && e.goalId !== filter.goalId) return false;
      if (filter.strategy && e.strategy !== filter.strategy) return false;
      if (filter.outcome && e.outcome !== filter.outcome) return false;
      return true;
    });
    if (typeof limit === 'number' && limit >= 0) out = out.slice(0, limit);
    return out; // already most-recent-first (unshift) and already frozen
  }

  // Laplace-smoothed success proportion over completed/failed attempts
  // only (cancellations/retries/exhausted are tracked but deliberately
  // excluded from the score — a cancellation is an external decision,
  // not evidence the strategy itself is bad). A brand-new,
  // zero-sample strategy scores a neutral 0.5 rather than 0.
  function snapshotStrategy(s) {
    var decided = s.successes + s.failures;
    var successRate = decided > 0 ? (s.successes / decided) : null;
    var score = (s.successes + 1) / (decided + 2);
    var avgDurationMs = s.durationSamples > 0 ? (s.totalDurationMs / s.durationSamples) : null;
    return deepFreeze({
      key: s.key,
      attempts: s.attempts,
      successes: s.successes,
      failures: s.failures,
      cancellations: s.cancellations,
      retries: s.retries,
      exhausted: s.exhausted,
      successRate: successRate,
      score: score,
      avgDurationMs: avgDurationMs
    });
  }

  var EMPTY_STRATEGY_TEMPLATE = { attempts: 0, successes: 0, failures: 0, cancellations: 0, retries: 0, exhausted: 0, totalDurationMs: 0, durationSamples: 0 };

  function getStrategyStats(key) {
    var s = strategyStatsByKey[key];
    if (!s) {
      var empty = {};
      Object.keys(EMPTY_STRATEGY_TEMPLATE).forEach(function (k) { empty[k] = EMPTY_STRATEGY_TEMPLATE[k]; });
      empty.key = key;
      return snapshotStrategy(empty);
    }
    return snapshotStrategy(s);
  }

  function getStrategyScore(key) { return getStrategyStats(key).score; }

  // Most-successful-first read — "track successful strategies".
  function listStrategyStats() {
    return Object.keys(strategyStatsByKey)
      .map(function (k) { return snapshotStrategy(strategyStatsByKey[k]); })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return b.attempts - a.attempts;
      });
  }

  // "Track failures" — every strategy with at least `minFailures`
  // recorded failures, worst-first.
  function listFailingStrategies(minFailures) {
    var threshold = (typeof minFailures === 'number' && minFailures > 0) ? minFailures : 1;
    return listStrategyStats()
      .filter(function (s) { return s.failures >= threshold; })
      .sort(function (a, b) { return b.failures - a.failures; });
  }

  // ------------------------------------------------------------
  // PART E — Recommend a better execution order. See the header
  // comment ("Why an adjacent swap is always dependency-safe") for the
  // proof that checking only the direct dependency edge between two
  // ADJACENT entries is sufficient — no transitive walk, no second
  // topological sort.
  // ------------------------------------------------------------
  var DEFAULT_SWAP_THRESHOLD = 0.05;
  var swapThreshold = DEFAULT_SWAP_THRESHOLD;

  function setSwapThreshold(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || n > 1) {
      throw new Error('[AxiomGoalManagerLearning] setSwapThreshold: expected a number between 0 and 1, got ' + n + '.');
    }
    swapThreshold = n;
    return swapThreshold;
  }
  function getSwapThreshold() { return swapThreshold; }

  function scoreForGoalSnapshot(goalSnapshot) { return getStrategyScore(resolveStrategyKey(goalSnapshot)); }

  function recommendGoalOrder(filter) {
    var order = GoalManager.getGoalExecutionOrder(filter); // real, cycle-checked topological+priority order — reused as-is
    var arr = order.slice();

    for (var i = 0; i < arr.length - 1; i++) {
      var a = arr[i], b = arr[i + 1];
      if (a.priority !== b.priority) continue; // never reorder across priority tiers

      var bDependsOnA = GoalManager.getGoalDependencies(b.id).some(function (dep) { return dep.goalId === a.id; });
      if (bDependsOnA) continue; // dependency-safety guard (see header proof)

      var scoreA = scoreForGoalSnapshot(a);
      var scoreB = scoreForGoalSnapshot(b);
      if (scoreB - scoreA > swapThreshold) {
        arr[i] = b;
        arr[i + 1] = a;
      }
    }

    return arr;
  }

  // ------------------------------------------------------------
  // PART F — Optimize future goal scheduling. The learned-order
  // counterpart of `AxiomGoalManager.runGoalScheduler()`: same
  // Pending/Waiting filter, same per-goal `scheduleGoal()` call, same
  // `{ scheduled, blocked }` return shape — the only difference is the
  // order goals are offered to `scheduleGoal()` in.
  // ------------------------------------------------------------
  function optimizeGoalScheduling(filter) {
    var order = recommendGoalOrder(filter);
    var scheduled = [];
    var blocked = [];
    order.forEach(function (snap) {
      if (snap.status !== GOAL_STATUS.PENDING && snap.status !== GOAL_STATUS.WAITING) return;
      var r = GoalManager.scheduleGoal(snap.id);
      if (r.scheduled) scheduled.push(r.goal);
      else if (r.blocked) blocked.push(r.goal);
    });
    return { scheduled: scheduled, blocked: blocked };
  }

  // ------------------------------------------------------------
  // PART G — Improve prioritization using historical data. Read-only
  // advisory, bucketed onto Part 3A's OWN `GOAL_PRIORITY` enum — no
  // new priority scale is introduced. Never applied automatically;
  // see `applyRecommendedPriority()` for the explicit opt-in.
  // ------------------------------------------------------------
  var DEFAULT_MIN_SAMPLES_FOR_RECOMMENDATION = 3;
  var minSamplesForRecommendation = DEFAULT_MIN_SAMPLES_FOR_RECOMMENDATION;

  function setMinSamplesForRecommendation(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || Math.floor(n) !== n) {
      throw new Error('[AxiomGoalManagerLearning] setMinSamplesForRecommendation: expected a non-negative integer, got ' + n + '.');
    }
    minSamplesForRecommendation = n;
    return minSamplesForRecommendation;
  }
  function getMinSamplesForRecommendation() { return minSamplesForRecommendation; }

  function requireGoal(goalId) {
    var g = GoalManager.getGoal(goalId);
    if (!g) throw new Error('[AxiomGoalManagerLearning] goal "' + goalId + '" does not exist.');
    return g;
  }

  function getRecommendedPriority(goalId) {
    var goal = requireGoal(goalId);
    var stats = getStrategyStats(resolveStrategyKey(goal));
    var decided = stats.successes + stats.failures;

    if (decided < minSamplesForRecommendation) {
      return deepFreeze({
        goalId: goalId, strategy: stats.key, recommended: null, currentPriority: goal.priority,
        score: stats.score,
        reason: 'not enough history for "' + stats.key + '" (' + decided + ' of ' + minSamplesForRecommendation + ' required attempts) to recommend a change'
      });
    }

    var recommended;
    if (stats.score >= 0.75) recommended = GOAL_PRIORITY.HIGH;
    else if (stats.score >= 0.4) recommended = GOAL_PRIORITY.NORMAL;
    else recommended = GOAL_PRIORITY.LOW;

    var reason = (recommended === goal.priority)
      ? ('already at the recommended priority for "' + stats.key + '"')
      : ('historical success rate for "' + stats.key + '" (score ' + stats.score.toFixed(2) + ') suggests priority ' + recommended);

    return deepFreeze({
      goalId: goalId, strategy: stats.key, recommended: recommended, currentPriority: goal.priority,
      score: stats.score, reason: reason
    });
  }

  function applyRecommendedPriority(goalId) {
    var rec = getRecommendedPriority(goalId);
    if (rec.recommended === null || rec.recommended === rec.currentPriority) {
      return { applied: false, recommendation: rec };
    }
    var goal = GoalManager.setGoalPriority(goalId, rec.recommended);
    emit('goalmgrlearn_priority_applied', { goalId: goalId, from: rec.currentPriority, to: rec.recommended });
    return { applied: true, recommendation: rec, goal: goal };
  }

  // ------------------------------------------------------------
  // PART H — Aggregate analytics. Composes the ALREADY-EXISTING
  // metrics getters from Part 3A/3B (`getGoalMetrics`), Runtime
  // Context (`getContextMetrics`), and — when present —
  // Part 3C/3D's own (`getDecisionMetrics`/`getExecutionMetrics`).
  // Nothing here re-derives a number any of those modules already
  // compute; this Part only ever adds the strategy-level counters that
  // did not exist before it.
  // ------------------------------------------------------------
  function getLearningMetrics() {
    var out = {
      strategies: {
        tracked: Object.keys(strategyStatsByKey).length,
        recorded: totals.recorded,
        successes: totals.successes,
        failures: totals.failures,
        cancellations: totals.cancellations,
        retries: totals.retries,
        exhausted: totals.exhausted
      },
      goals: GoalManager.getGoalMetrics(),
      systemLoad: RuntimeContext.getContextMetrics()
    };
    if (DecisionEngine && typeof DecisionEngine.getDecisionMetrics === 'function') {
      out.decisions = DecisionEngine.getDecisionMetrics();
    }
    if (ExecutionBridge && typeof ExecutionBridge.getExecutionMetrics === 'function') {
      out.execution = ExecutionBridge.getExecutionMetrics();
    }
    return deepFreeze(out);
  }

  // ------------------------------------------------------------
  // Standalone global only — same posture every other Step 7 Part
  // already documents, and for the identical reason: this module is a
  // *consumer* of `AxiomOrchestrator`, `AxiomGoalManager`,
  // `AxiomRuntimeContext`, and (optionally) `AxiomDecisionEngine` /
  // `AxiomDecisionEngineExecutionBridge`, so putting its logic inside
  // any one of them would make that module aware of the others in a
  // way none of them are today. `orchestrator.js`, `runtime-
  // context.js`, `goal-manager.js`, `autonomous-decision-engine.js`,
  // and `decision-engine-execution-bridge.js` are none of them edited
  // by this file.
  // ------------------------------------------------------------
  var AxiomGoalManagerLearning = {
    API_VERSION: API_VERSION,

    getExecutionHistory: getExecutionHistory,

    getStrategyStats: getStrategyStats,
    listStrategyStats: listStrategyStats,
    listFailingStrategies: listFailingStrategies,

    recommendGoalOrder: recommendGoalOrder,
    optimizeGoalScheduling: optimizeGoalScheduling,
    setSwapThreshold: setSwapThreshold,
    getSwapThreshold: getSwapThreshold,

    getRecommendedPriority: getRecommendedPriority,
    applyRecommendedPriority: applyRecommendedPriority,
    setMinSamplesForRecommendation: setMinSamplesForRecommendation,
    getMinSamplesForRecommendation: getMinSamplesForRecommendation,

    getLearningMetrics: getLearningMetrics
  };

  global.AxiomGoalManagerLearning = AxiomGoalManagerLearning;
})(typeof window !== 'undefined' ? window : this);
