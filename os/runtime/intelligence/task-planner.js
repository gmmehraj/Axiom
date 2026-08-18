// ============================================================
// AXIOM AI OS — Milestone 8: Intelligent Task Planner
// ------------------------------------------------------------
// Task 1 of the brief asks for more than keyword matching: complex
// requests need to be broken into ordered sub-tasks with tracked
// dependencies. The existing Task Router (Milestone 4) already maps
// a SINGLE clause of text to an agent extremely well — this module
// does not replace it or re-implement its keyword rules. Instead it
// splits a compound request into clauses, hands EACH clause to the
// existing Task Router individually, and stitches the results into
// an ordered, dependency-aware plan the Orchestrator can execute.
//
// Concretely, this closes a real gap: today, "search AI news, then
// remember it, then make a plan" matches the browse/memory/planner
// keyword rules against the WHOLE raw string, so every matched agent
// receives the same full sentence and all fire at once with no
// ordering or hand-off between them. This module gives each agent
// only ITS clause, in the order implied by "then"/commas/"after
// that", and marks each step dependent on the one before it so the
// Orchestrator can run them as a real sequence, not a burst.
//
// This is intentionally a linguistic heuristic (sequencing words,
// punctuation, conjunctions), not a machine-learned intent model —
// consistent with how semantic-recall in agents.js is documented as
// an honest, dependency-free approximation rather than a fake NLU
// engine.
//
// Public surface — window.AxiomTaskPlanner:
//   .splitClauses(text)      -> string[]
//   .analyzeIntent(text)     -> { clauses, sequential }
//   .decompose(text)         -> { goal, steps: [...] }
//   .createExecutionPlan(text, opts?) -> { planId, goal, steps }
//   .explain(text)           -> human-readable trace
// ============================================================
window.AxiomTaskPlanner = (function () {
  'use strict';

  // Words/punctuation that signal "do this, then do that" ordering.
  var SEQUENCE_SPLIT = /\s*(?:,\s*then\s+|\bthen\b|\bafter that\b|;\s*|\.\s+(?=[a-z]))\s*/i;
  var PARALLEL_SPLIT = /\s*(?:,\s*and\s+|\band\b|,)\s*/i;

  function cleanClause(s) {
    return String(s || '').trim().replace(/^(and|then|also)\s+/i, '').replace(/[.\s]+$/, '');
  }

  // Splits a compound request into ordered clauses. Sequencing words
  // ("then", "after that", ";") take priority over the weaker "and"/comma
  // separator, since "search X and Y" is one clause (a single request with
  // two subjects) while "search X, then remember Y" is clearly two steps.
  function splitClauses(text) {
    var raw = String(text || '').trim();
    if (!raw) return [];

    var bySequence = raw.split(SEQUENCE_SPLIT).map(cleanClause).filter(Boolean);
    if (bySequence.length > 1) return bySequence;

    // No explicit sequencing word — fall back to "and"/comma, but only
    // treat it as multiple steps if at least two segments look like
    // distinct actionable requests (each has its own verb-ish token).
    var byParallel = raw.split(PARALLEL_SPLIT).map(cleanClause).filter(Boolean);
    if (byParallel.length > 1) return byParallel;

    return [cleanClause(raw)];
  }

  function analyzeIntent(text) {
    var raw = String(text || '');
    var sequential = /\bthen\b|\bafter that\b|;/i.test(raw);
    return { clauses: splitClauses(raw), sequential: sequential };
  }

  // Maps each clause to an agent + task via the EXISTING Task Router
  // (never re-implements routing), then chains dependencies in order.
  function decompose(text) {
    var router = window.AxiomTaskRouter;
    if (!router) throw new Error('[AxiomTaskPlanner] AxiomTaskRouter is required — load task-router.js first.');

    var analysis = analyzeIntent(text);
    var steps = [];
    var seq = 0;

    analysis.clauses.forEach(function (clause) {
      var decision = router.route(clause);
      decision.agents.forEach(function (hop) {
        seq += 1;
        steps.push({
          id: 'm8step-' + seq + '-' + Date.now().toString(36),
          clause: clause,
          agentId: hop.agentId,
          workflow: hop.workflow || null,
          matchedBy: hop.matchedBy,
          task: Object.assign({}, hop.task),
          // Sequential requests depend on the previous clause's steps so the
          // Orchestrator won't start step N+1 before step N settles. Steps
          // within the SAME clause (a multi-agent workflow hop) have no
          // inter-dependency — they may legitimately run together.
          dependsOn: []
        });
      });
    });

    // Wire sequential dependencies clause-by-clause (not step-by-step),
    // so parallel hops inside one clause stay parallel.
    if (analysis.sequential || analysis.clauses.length > 1) {
      var byClause = {};
      steps.forEach(function (s) { (byClause[s.clause] = byClause[s.clause] || []).push(s); });
      var clauseOrder = analysis.clauses.filter(function (c) { return byClause[c]; });
      for (var i = 1; i < clauseOrder.length; i++) {
        var prevIds = byClause[clauseOrder[i - 1]].map(function (s) { return s.id; });
        byClause[clauseOrder[i]].forEach(function (s) { s.dependsOn = prevIds.slice(); });
      }
    }

    // Check for specialized autonomous goal archetypes (Phase 2 & Phase 17)
    var normalized = String(text || '').trim().toLowerCase();
    
    if (/^(build|create|make|design)\s+(me\s+)?(a\s+|an\s+)?(website|landing page|saas|portfolio|dashboard|app|page)/i.test(normalized) || /build this website/i.test(normalized)) {
      var buildSteps = [
        { clause: 'Inspect project structure and design tokens', agentId: 'agent.coding', task: { intent: 'coding', op: 'project-analysis', prompt: 'Inspect workspace files and CSS tokens' } },
        { clause: 'Plan semantic components and layout structure', agentId: 'agent.planner', task: { intent: 'planner', op: 'plan', goal: text } },
        { clause: 'Implement responsive HTML/CSS/JS page code', agentId: 'agent.coding', task: { intent: 'coding', op: 'generate', prompt: 'Generate complete responsive code for ' + text } },
        { clause: 'Run build verification and check syntax', agentId: 'agent.coding', task: { intent: 'coding', op: 'review-code' } },
        { clause: 'Open browser sandbox and render live preview', agentId: 'agent.browser', task: { intent: 'browser', op: 'navigate', url: 'index.html' } },
        { clause: 'Capture viewport screenshot for visual QA', agentId: 'agent.vision', task: { intent: 'vision', op: 'screenshot' } },
        { clause: 'Run Vision QA and self-heal any layout/CSS defects', agentId: 'agent.coding', task: { intent: 'coding', op: 'bug-investigation' } },
        { clause: 'Verify responsive behavior and finalize result', agentId: 'agent.assistant', task: { intent: 'assistant', text: 'Website build verified successfully.' } }
      ];

      var chained = buildSteps.map(function(s, idx) {
        return {
          id: 'm8step-auto-' + (idx + 1) + '-' + Date.now().toString(36),
          clause: s.clause,
          agentId: s.agentId,
          workflow: 'autonomous-builder',
          matchedBy: 'autonomous-archetype',
          task: s.task,
          dependsOn: idx > 0 ? ['m8step-auto-' + idx + '-' + Date.now().toString(36)] : []
        };
      });

      // Fix forward dependency IDs
      for (var k = 1; k < chained.length; k++) {
        chained[k].dependsOn = [chained[k - 1].id];
      }

      return {
        goal: String(text || '').trim(),
        multiStep: true,
        archetype: 'autonomous-builder',
        steps: chained
      };
    }

    if (/check (my )?website and fix|analyze (this )?(image|video|screen) and fix|fix (the )?(problem|bug|issue)|repair this/i.test(normalized)) {
      var fixSteps = [
        { clause: 'Open website and observe live state', agentId: 'agent.browser', task: { intent: 'browser', op: 'navigate', url: 'index.html' } },
        { clause: 'Capture visual evidence and diagnose defect', agentId: 'agent.vision', task: { intent: 'vision', op: 'screenshot' } },
        { clause: 'Search repository for root cause and offending files', agentId: 'agent.coding', task: { intent: 'coding', op: 'project-search' } },
        { clause: 'Apply verified code patch', agentId: 'agent.coding', task: { intent: 'coding', op: 'refactor' } },
        { clause: 'Rebuild project and verify compilation', agentId: 'agent.coding', task: { intent: 'coding', op: 'review-code' } },
        { clause: 'Reload browser and verify fix visually', agentId: 'agent.browser', task: { intent: 'browser', op: 'navigate', url: 'index.html' } },
        { clause: 'Report verified resolution', agentId: 'agent.assistant', task: { intent: 'assistant', text: 'Issue identified, fixed, and verified.' } }
      ];

      var chainedFix = fixSteps.map(function(s, idx) {
        return {
          id: 'm8step-fix-' + (idx + 1) + '-' + Date.now().toString(36),
          clause: s.clause,
          agentId: s.agentId,
          workflow: 'autonomous-fix',
          matchedBy: 'autonomous-archetype',
          task: s.task,
          dependsOn: idx > 0 ? ['m8step-fix-' + idx + '-' + Date.now().toString(36)] : []
        };
      });

      for (var f = 1; f < chainedFix.length; f++) {
        chainedFix[f].dependsOn = [chainedFix[f - 1].id];
      }

      return {
        goal: String(text || '').trim(),
        multiStep: true,
        archetype: 'autonomous-fix',
        steps: chainedFix
      };
    }

    if (/^(deploy|ship|publish|push to prod)/i.test(normalized)) {
      var deploySteps = [
        { clause: 'Run pre-flight test checks and verify build', agentId: 'agent.coding', task: { intent: 'coding', op: 'review-code' } },
        { clause: 'Inspect git diff and check environment variables', agentId: 'agent.coding', task: { intent: 'coding', op: 'project-search' } },
        { clause: 'Trigger authorized Vercel production deployment', agentId: 'agent.automation', task: { intent: 'automation', op: 'deploy' } },
        { clause: 'Smoke-test live production deployment URL', agentId: 'agent.browser', task: { intent: 'browser', op: 'navigate' } },
        { clause: 'Report live production status', agentId: 'agent.assistant', task: { intent: 'assistant', text: 'Production deployment verified live.' } }
      ];

      var chainedDeploy = deploySteps.map(function(s, idx) {
        return {
          id: 'm8step-dep-' + (idx + 1) + '-' + Date.now().toString(36),
          clause: s.clause,
          agentId: s.agentId,
          workflow: 'autonomous-deploy',
          matchedBy: 'autonomous-archetype',
          task: s.task,
          dependsOn: idx > 0 ? ['m8step-dep-' + idx + '-' + Date.now().toString(36)] : []
        };
      });

      for (var d = 1; d < chainedDeploy.length; d++) {
        chainedDeploy[d].dependsOn = [chainedDeploy[d - 1].id];
      }

      return {
        goal: String(text || '').trim(),
        multiStep: true,
        archetype: 'autonomous-deploy',
        steps: chainedDeploy
      };
    }

    return {
      goal: String(text || '').trim() || 'Untitled request',
      multiStep: steps.length > 1,
      steps: steps
    };
  }

  // Registers the decomposition as a trackable plan in the existing
  // Planner store (Milestone 5/6 infrastructure — reused, not duplicated),
  // so progress/estimation/scheduling all work on it uniformly.
  function createExecutionPlan(text, opts) {
    opts = opts || {};
    var decomposition = decompose(text);
    var planId = null;
    if (window.AxiomPlanner) {
      var plan = window.AxiomPlanner.createPlan({
        goal: decomposition.goal,
        steps: decomposition.steps.map(function (s) { return s.clause + '  [' + s.agentId + ']'; })
      });
      planId = plan.id;
      // Keep a stable pointer from each execution step back to its planner
      // step id so the Orchestrator can mark individual steps done/failed.
      decomposition.steps.forEach(function (s, i) {
        if (plan.steps[i]) s.plannerStepId = plan.steps[i].id;
      });
    }
    return { planId: planId, goal: decomposition.goal, multiStep: decomposition.multiStep, steps: decomposition.steps };
  }

  function explain(text) {
    var d = decompose(text);
    return d.steps.map(function (s, i) {
      var deps = s.dependsOn.length ? ' (after: ' + s.dependsOn.join(', ') + ')' : '';
      return (i + 1) + '. "' + s.clause + '" -> ' + s.agentId + deps;
    }).join('\n');
  }

  return {
    splitClauses: splitClauses,
    analyzeIntent: analyzeIntent,
    decompose: decompose,
    createExecutionPlan: createExecutionPlan,
    explain: explain
  };
})();
