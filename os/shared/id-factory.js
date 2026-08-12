// ============================================================
// AXIOM AI OS — Shared Sequential ID Factory
// ------------------------------------------------------------
// Phase 8 Part 2 (Code Quality & Maintainability). Extracted after
// finding several modules each defining their own byte-identical
// `prefix + '-' + Date.now().toString(36) + '-' + (++seq).toString(36)`
// id generator, differing only in their prefix string and each
// keeping an independent `seq` counter starting at 0. Confirmed
// identical (Part 1's CHANGELOG had flagged this pattern generally;
// this pass compared every implementation line-by-line before
// touching anything).
//
// window.AxiomMakeSeqId(prefix) returns a `uid()` function scoped to
// its own private counter, starting at 0, exactly like each module's
// original inline version — calling it produces the exact same id
// shape and sequence as before, just built once instead of many times.
//
// In use by: executive-ai.js, automation-engine.js, skill-registry.js,
// executive-automation-extension.js, trigger-scheduler.js,
// autonomous-executive.js.
//
// Deliberately NOT applied to:
// - os/desktop/desktop-manager.js, os/runtime/intelligence/orchestrator.js,
//   os/runtime/intelligence/job-manager.js — these use a Math.random()-based
//   id shape, not this Date.now()+counter shape, so folding them in here
//   would be a real behavior change, not a pure dedup.
// - os/runtime/capabilities/planner-store.js, os/runtime/automation/
//   workflow-engine.js — already take `prefix` as a function argument
//   rather than hardcoding it, so there's nothing to dedup.
// - os/runtime/scheduler/task-scheduler.js — LOOKED like the same
//   pattern at a glance, but its `seq` variable is reused for a second,
//   unrelated purpose (per-task FIFO ordering: `task.seq = ++seq`, then
//   `a.seq - b.seq` as a sort tie-breaker). Consolidating its uid()
//   here would have silently detached that second counter from the id
//   generator's. Caught by re-running the regression suite after the
//   change (it threw `seq is not defined`) and reverted — left as its
//   original single-file implementation.
// ============================================================
(function (global) {
  'use strict';

  /**
   * @param {string} prefix
   * @returns {function(): string} a uid() function with its own
   *   private, monotonically increasing counter (starts at 0).
   */
  function makeSeqId(prefix) {
    var seq = 0;
    return function () {
      return prefix + '-' + Date.now().toString(36) + '-' + (++seq).toString(36);
    };
  }

  global.AxiomMakeSeqId = makeSeqId;
})(window);
