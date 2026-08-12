// ============================================================
// AXIOM AI OS — Agent Definitions: Assembler
// ------------------------------------------------------------
// Replaces the tail of the former monolithic
// os/runtime/agent-definitions.js as part of Phase 8 Part 2 (Code
// Quality & Maintainability). Collects every spec pushed by the
// *-agent.js files in this folder into the exact same
// window.AxiomAgentDefinitions (array) / window.AxiomAgentDefinitionsById
// (map) globals the rest of the runtime (AgentManager, task router,
// regression suites) already depends on. No consumer of those two
// globals needed to change.
//
// Required load order (see os-shell.html / other pages, and the
// updated test-evidence/*-regression-suite.js harnesses):
//   1. _shared.js            (defines window.AxiomAgentDefHelpers)
//   2. each *-agent.js file  (pushes its spec onto window.__axiomAgentDefs)
//   3. _assemble.js          (this file — must load LAST)
// ============================================================
(function (global) {
  'use strict';

  var DEFINITIONS = global.__axiomAgentDefs || [];

  var byId = {};
  DEFINITIONS.forEach(function (d) { byId[d.id] = d; });

  global.AxiomAgentDefinitions = DEFINITIONS;
  global.AxiomAgentDefinitionsById = byId;

  // Housekeeping only — nothing else reads this staging array.
  delete global.__axiomAgentDefs;
})(window);
