// ============================================================
// AXIOM AI OS — Milestone 10: Conversation Context
// ------------------------------------------------------------
// Requirement 4 asks for current conversation, active workflow,
// previous responses, selected memory, current browser session and
// planner state to be "automatically maintained" and "loaded
// automatically". Every one of those already lives somewhere real:
//
//   current conversation / previous responses -> AxiomConversationManager (this milestone)
//   active workflow                            -> AxiomConversationManager.state()
//   selected memory                            -> AxiomMemoryIntelligence.rankedRecall (Milestone 8)
//   current browser session                    -> AxiomBrowserBridge.historyList (Milestone 6)
//   planner state                              -> AxiomPlanner.getPlan/progress (Milestone 5/6)
//
// This module does not own or duplicate any of that state — it is a
// read-only aggregator that asks each existing module for its own
// slice and assembles one bundle, so a caller (a future chat UI, or
// Executive AI itself) can load everything relevant in one call
// instead of five. Every lookup degrades to null/[] on failure rather
// than throwing, so a missing optional subsystem (e.g. no browser tab
// open yet) never breaks context loading for the rest.
//
// Public surface — window.AxiomConversationContext:
//   .build(conversationId, opts?) -> Promise<contextBundle>
// ============================================================
window.AxiomConversationContext = (function () {
  'use strict';

  var CONV = window.AxiomConversationManager;
  if (!CONV) {
    AxLogger.error('[AxiomConversationContext] requires conversation-manager.js loaded first.');
    return null;
  }

  function safe(promiseLike, fallback) {
    return Promise.resolve(promiseLike).catch(function () { return fallback; });
  }

  function plannerStateFor(activeWorkflow) {
    var PLANNER = window.AxiomPlanner;
    if (!PLANNER || !activeWorkflow) return null;
    // Executive AI stores the planId on the plan it registers with
    // AxiomPlanner via createExecutionPlan(); the conversation layer
    // only has the jobId/executiveId, so this looks the job up through
    // the same JobManager the Orchestrator already uses, rather than
    // guessing a planId.
    var JOBS = window.AxiomJobManager;
    var job = JOBS && activeWorkflow.jobId ? JOBS.getJob(activeWorkflow.jobId) : null;
    var planId = job && job.planId;
    if (!planId) return null;
    var plan = PLANNER.getPlan(planId);
    return plan ? { planId: planId, progress: PLANNER.progress(planId) } : null;
  }

  function browserSessionSnapshot() {
    var BRIDGE = window.AxiomBrowserBridge;
    if (!BRIDGE || typeof BRIDGE.historyList !== 'function') return Promise.resolve(null);
    // historyList() resolves { snapshot, data } — the current-page
    // snapshot plus recent history, exactly what BrowserBridge already
    // exposes (Milestone 6). This only reads it, never navigates.
    return safe(BRIDGE.historyList(1).then(function (result) {
      if (!result) return null;
      var recent = (result.data && result.data[0]) || null;
      return { current: result.snapshot || null, mostRecentVisit: recent };
    }), null);
  }

  function selectedMemoryFor(query) {
    var MEM = window.AxiomMemoryIntelligence;
    if (!MEM || !query) return Promise.resolve([]);
    return safe(MEM.rankedRecall('agent.memory', query, 5), []);
  }

  function build(conversationId, opts) {
    opts = opts || {};
    var convState = CONV.state(conversationId);
    if (!convState) {
      return Promise.resolve({
        conversation: null, activeWorkflow: null, previousResponses: [],
        selectedMemory: [], browserSession: null, plannerState: null
      });
    }

    var recentTurns = CONV.history(conversationId, opts.turnLimit || 5);
    var previousResponses = recentTurns
      .filter(function (t) { return t.summary; })
      .map(function (t) { return { turnId: t.turnId, text: t.text, summary: t.summary, status: t.status }; });

    return Promise.all([
      selectedMemoryFor(convState.activeTopic),
      browserSessionSnapshot()
    ]).then(function (results) {
      return {
        conversation: { conversationId: convState.conversationId, activeTopic: convState.activeTopic, recentTurns: recentTurns },
        activeWorkflow: convState.activeWorkflow,
        previousResponses: previousResponses,
        selectedMemory: results[0],
        browserSession: results[1],
        plannerState: plannerStateFor(convState.activeWorkflow)
      };
    });
  }

  return { build: build };
})();
