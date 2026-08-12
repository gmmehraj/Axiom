// ============================================================
// AXIOM AI OS — Agent Definitions: Shared Helpers
// ------------------------------------------------------------
// Extracted from the top of the former monolithic
// os/runtime/agent-definitions.js as part of Phase 8 Part 2 (Code
// Quality & Maintainability). Every per-agent file in this folder
// uses these two helpers instead of redefining them, so behavior is
// identical to before the split.
//
// Must load BEFORE any *-agent.js file in this folder, and before
// _assemble.js. See _assemble.js for load-order notes.
// ============================================================
(function (global) {
  'use strict';

  // Resolve after `ms`, used to model bounded async work for
  // capabilities whose real backend is not wired in this milestone.
  function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 250); }); }

  function has(obj, path) {
    return path.split('.').every(function (k) { obj = obj && obj[k]; return obj != null; }) && obj;
  }

  global.AxiomAgentDefHelpers = { tick: tick, has: has };
})(window);
