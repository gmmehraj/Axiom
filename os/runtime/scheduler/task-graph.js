// ============================================================
// AXIOM AI OS — Milestone 11: Runtime Task Graph
// ------------------------------------------------------------
// Objective 3: "Create a runtime task graph representing
// dependencies and execution order."
//
// The Task Planner (Milestone 8) already produces `steps[].dependsOn`
// and the Orchestrator already walks that structure step-by-step to
// decide what can run next. Neither exposes it as a normalized,
// inspectable graph (nodes/edges/roots/leaves/topological order) —
// this module does exactly that and NOTHING else. It never plans,
// never routes, never dispatches. It only reads the public surfaces
// of AxiomTaskPlanner and AxiomOrchestrator (for a live run) or
// AxiomTaskScheduler (for the cross-job graph) and reshapes what
// they already return.
//
// Reuses:
//   - AxiomTaskPlanner.decompose()/createExecutionPlan() for a plan's
//     step-level dependency data (never re-decomposes text itself).
//   - AxiomOrchestrator.status(runId) for live per-step status when a
//     plan is actually executing.
//   - AxiomTaskScheduler (Milestone 11, loaded just before this file)
//     for cross-task (job-level) dependencies, via its public report.
//
// Public surface — window.AxiomTaskGraph:
//   .fromPlan(plan)              -> graph   (plan = {planId?, goal, steps})
//   .fromRun(runId)              -> graph | null   (live status merged in)
//   .schedulerGraph()            -> graph   (cross-job dependency graph)
//   .decideMode(graph)           -> 'sequential' | 'parallel' | 'mixed'
//   .topologicalOrder(graph)     -> nodeId[] | null (null if cyclic)
// ============================================================
window.AxiomTaskGraph = (function () {
  'use strict';

  function buildFromSteps(steps, goal, meta) {
    var nodes = steps.map(function (s) {
      return {
        id: s.id,
        agentId: s.agentId,
        clause: s.clause,
        dependsOn: (s.dependsOn || []).slice(),
        status: s.status || 'pending'
      };
    });
    var edges = [];
    nodes.forEach(function (n) {
      n.dependsOn.forEach(function (depId) { edges.push({ from: depId, to: n.id }); });
    });
    var withIncoming = {};
    edges.forEach(function (e) { withIncoming[e.to] = true; });
    var withOutgoing = {};
    edges.forEach(function (e) { withOutgoing[e.from] = true; });
    var roots = nodes.filter(function (n) { return !withIncoming[n.id]; }).map(function (n) { return n.id; });
    var leaves = nodes.filter(function (n) { return !withOutgoing[n.id]; }).map(function (n) { return n.id; });

    var graph = { goal: goal || 'Untitled', nodes: nodes, edges: edges, roots: roots, leaves: leaves, meta: meta || {} };
    graph.mode = decideMode(graph);
    graph.order = topologicalOrder(graph);
    return graph;
  }

  function fromPlan(plan) {
    if (!plan || !Array.isArray(plan.steps)) return { goal: (plan && plan.goal) || 'Untitled', nodes: [], edges: [], roots: [], leaves: [], mode: 'sequential', order: [], meta: {} };
    return buildFromSteps(plan.steps, plan.goal, { planId: plan.planId || null, source: 'plan' });
  }

  function fromRun(runId) {
    var ORCH = window.AxiomOrchestrator;
    if (!ORCH) return null;
    var status = ORCH.status(runId);
    if (!status) return null;
    return buildFromSteps(status.steps, status.goal, { runId: runId, runStatus: status.status, source: 'run' });
  }

  // Cross-JOB graph: each node is a scheduler task (not a within-plan
  // step). Built purely from AxiomTaskScheduler's own public report —
  // this module never reaches into the scheduler's internal queue.
  function schedulerGraph() {
    var SCHED = window.AxiomTaskScheduler;
    if (!SCHED) return { goal: 'scheduler', nodes: [], edges: [], roots: [], leaves: [], mode: 'parallel', order: [], meta: { source: 'scheduler' } };
    var tasks = SCHED.list();
    var steps = tasks.map(function (t) {
      return { id: t.id, agentId: 'job:' + (t.jobId || t.id), clause: t.goal, dependsOn: (t.dependsOn || []).slice(), status: t.status };
    });
    return buildFromSteps(steps, 'Scheduled background work', { source: 'scheduler' });
  }

  // A graph is "parallel" when at least two nodes share no dependency
  // relationship at all (neither is reachable from the other), "sequential"
  // when every node forms a single chain, and "mixed" otherwise — this is
  // the same judgement Executive AI's strategy step makes heuristically
  // from clause structure; here it is derived structurally from the graph
  // itself, so it stays correct even for graphs Executive AI never built
  // from text (e.g. scheduler cross-job graphs).
  function decideMode(graph) {
    if (!graph.nodes.length) return 'sequential';
    if (graph.nodes.length === 1) return 'sequential';
    var hasDependency = graph.edges.length > 0;
    var allChained = graph.nodes.every(function (n) { return n.dependsOn.length <= 1; }) &&
      graph.roots.length === 1 && graph.leaves.length === 1 &&
      graph.edges.length === graph.nodes.length - 1;
    if (!hasDependency) return 'parallel';
    if (allChained) return 'sequential';
    return 'mixed';
  }

  // Kahn's algorithm — returns null on a cycle instead of throwing, so
  // callers (e.g. a future dashboard) can surface "unresolvable graph"
  // exactly the way the Orchestrator already reports a stuck run.
  function topologicalOrder(graph) {
    var indegree = {};
    graph.nodes.forEach(function (n) { indegree[n.id] = 0; });
    graph.edges.forEach(function (e) { if (indegree[e.to] !== undefined) indegree[e.to] += 1; });
    var queue = graph.nodes.filter(function (n) { return indegree[n.id] === 0; }).map(function (n) { return n.id; });
    var order = [];
    var indegreeCopy = Object.assign({}, indegree);
    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      graph.edges.forEach(function (e) {
        if (e.from !== id) return;
        indegreeCopy[e.to] -= 1;
        if (indegreeCopy[e.to] === 0) queue.push(e.to);
      });
    }
    return order.length === graph.nodes.length ? order : null;
  }

  return {
    fromPlan: fromPlan,
    fromRun: fromRun,
    schedulerGraph: schedulerGraph,
    decideMode: decideMode,
    topologicalOrder: topologicalOrder
  };
})();
