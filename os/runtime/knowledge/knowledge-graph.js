// ============================================================
// AXIOM AI OS — Milestone 12: Knowledge Graph
// ------------------------------------------------------------
// Objective 1: "Build a Knowledge Graph." Objective 4: "Link related
// memories."
//
// This is a READ-ONLY view built from the SAME agent_memory table
// every earlier milestone already writes to (via window.AxiomAgents
// — Milestones 1/2/5/6) — there is no second memory store. The graph
// is assembled in-process from:
//   - memory nodes  (one per agent_memory row)
//   - tag nodes     (one per distinct tag already stored on notes)
//   - category nodes (one per distinct category already stored)
//   - agent nodes   (one per memory "scope" — a core OS agent id like
//                     agent.memory, or a chat agent id like
//                     builtin:general — both already used as agent_id
//                     values by Milestones 1-9)
// and edges:
//   - memory --has-tag--> tag
//   - memory --in-category--> category
//   - memory --belongs-to--> agent
//   - memory --related-to--> memory (computed: shared tag/category or
//     token overlap above a threshold)
//
// Scopes to scan come from the two EXISTING agent registries — no new
// list of "known agents" is invented:
//   window.AxiomAgents.listAll()       -> chat agents (Milestone 1-9)
//   window.AxiomAgentManager.list()    -> the 10 core OS agents (M4)
//
// Degrades honestly: if window.AxiomAgents isn't on the page (no
// Supabase backend), build() resolves to an empty graph rather than
// throwing — the same "no backend on this page" pattern used by
// agent-definitions.js's Memory Agent handler.
//
// Public surface — window.AxiomKnowledgeGraph:
//   .build(opts?)              -> Promise<graph>  (fetches + rebuilds)
//   .refresh(opts?)             -> alias for build()
//   .getGraph()                 -> last-built graph (sync, may be null)
//   .neighbors(nodeId, opts?)    -> connected node ids/nodes
//   .relatedMemories(id, limit?) -> memory notes related to a given one
//   .centrality(nodeId)          -> edge count for a node (0 if unknown)
//   .stats()                     -> counts by node/edge type
// ============================================================
window.AxiomKnowledgeGraph = (function () {
  'use strict';

  var RELATION_THRESHOLD = 0.28; // token-overlap (Jaccard) floor for a memory-memory edge
  var DEFAULT_PER_SCOPE_LIMIT = 100;

  var graph = null; // { nodes: Map, edges: [], builtAt }

  function tokenize(s) {
    return String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  }

  function jaccard(aTokens, bTokens) {
    if (!aTokens.length || !bTokens.length) return 0;
    var a = new Set(aTokens), b = new Set(bTokens);
    var inter = 0;
    a.forEach(function (t) { if (b.has(t)) inter++; });
    var union = a.size + b.size - inter;
    return union ? inter / union : 0;
  }

  // -------------------- Scope discovery (reuses existing registries) ----
  function discoverScopes() {
    var scopes = [];
    var seen = new Set();
    function add(id) { if (id && !seen.has(id)) { seen.add(id); scopes.push(id); } }

    if (window.AxiomAgentManager && typeof window.AxiomAgentManager.list === 'function') {
      window.AxiomAgentManager.list().forEach(function (a) { add(a.id); });
    }
    var chatAgentsPromise = (window.AxiomAgents && typeof window.AxiomAgents.listAll === 'function')
      ? window.AxiomAgents.listAll().then(function (agents) {
        (agents || []).forEach(function (a) { if (a.memoryEnabled !== false) add(a.id); });
        return scopes;
      }).catch(function () { return scopes; })
      : Promise.resolve(scopes);

    return chatAgentsPromise;
  }

  // -------------------- Build ---------------------------------------------
  function fetchScopeMemories(scope, limit) {
    var mem = window.AxiomAgents;
    if (!mem || typeof mem.getMemoryNotes !== 'function') return Promise.resolve([]);
    return Promise.resolve(mem.getMemoryNotes(scope, limit)).catch(function () { return []; });
  }

  function build(opts) {
    opts = opts || {};
    var perScopeLimit = opts.perScopeLimit || DEFAULT_PER_SCOPE_LIMIT;

    return discoverScopes().then(function (scopes) {
      if (!scopes.length) {
        graph = { nodes: new Map(), edges: [], builtAt: Date.now() };
        return graph;
      }
      return Promise.all(scopes.map(function (scope) {
        return fetchScopeMemories(scope, perScopeLimit).then(function (rows) {
          return { scope: scope, rows: rows || [] };
        });
      })).then(function (perScope) {
        var nodes = new Map();
        var edges = [];

        function ensureNode(id, node) {
          if (!nodes.has(id)) nodes.set(id, node);
          return nodes.get(id);
        }
        function addEdge(from, to, type, weight) {
          edges.push({ from: from, to: to, type: type, weight: weight == null ? 1 : weight });
        }

        var allMemoryNodes = [];

        perScope.forEach(function (entry) {
          var agentNodeId = 'agent:' + entry.scope;
          ensureNode(agentNodeId, { id: agentNodeId, type: 'agent', agentId: entry.scope });

          entry.rows.forEach(function (row) {
            if (!row || !row.id) return;
            var memId = 'memory:' + row.id;
            var memNode = {
              id: memId, type: 'memory', memoryId: row.id, agentId: entry.scope,
              note: row.note, tags: row.tags || [], category: row.category || null,
              pinned: !!row.pinned, createdAt: row.created_at || null,
              tokens: tokenize(String(row.note || '') + ' ' + (row.tags || []).join(' '))
            };
            ensureNode(memId, memNode);
            allMemoryNodes.push(memNode);

            addEdge(memId, agentNodeId, 'belongs-to');

            (row.tags || []).forEach(function (tag) {
              var tagId = 'tag:' + String(tag).toLowerCase();
              ensureNode(tagId, { id: tagId, type: 'tag', label: tag });
              addEdge(memId, tagId, 'has-tag');
            });

            if (row.category) {
              var catId = 'category:' + String(row.category).toLowerCase();
              ensureNode(catId, { id: catId, type: 'category', label: row.category });
              addEdge(memId, catId, 'in-category');
            }
          });
        });

        // Memory <-> memory relation edges: shared tag/category is a strong
        // signal (weight 0.6 floor), token overlap adds the rest — avoids an
        // O(n^2) full-text comparison being the ONLY signal.
        for (var i = 0; i < allMemoryNodes.length; i++) {
          for (var j = i + 1; j < allMemoryNodes.length; j++) {
            var a = allMemoryNodes[i], b = allMemoryNodes[j];
            var sharedTag = (a.tags || []).some(function (t) { return (b.tags || []).map(function (x) { return String(x).toLowerCase(); }).indexOf(String(t).toLowerCase()) !== -1; });
            var sharedCategory = a.category && b.category && String(a.category).toLowerCase() === String(b.category).toLowerCase();
            var overlap = jaccard(a.tokens, b.tokens);
            var weight = overlap + (sharedTag ? 0.3 : 0) + (sharedCategory ? 0.15 : 0);
            if (sharedTag || sharedCategory || overlap >= RELATION_THRESHOLD) {
              addEdge(a.id, b.id, 'related-to', Math.min(1, weight));
              addEdge(b.id, a.id, 'related-to', Math.min(1, weight));
            }
          }
        }

        graph = { nodes: nodes, edges: edges, builtAt: Date.now() };
        return graph;
      });
    });
  }

  function getGraph() { return graph; }

  function neighbors(nodeId, opts) {
    if (!graph) return [];
    opts = opts || {};
    var out = graph.edges.filter(function (e) { return e.from === nodeId; })
      .map(function (e) { return { node: graph.nodes.get(e.to), edge: e }; })
      .filter(function (x) { return !!x.node; });
    if (opts.type) out = out.filter(function (x) { return x.node.type === opts.type; });
    out.sort(function (x, y) { return (y.edge.weight || 0) - (x.edge.weight || 0); });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  function relatedMemories(memoryId, limit) {
    var nodeId = memoryId.indexOf('memory:') === 0 ? memoryId : 'memory:' + memoryId;
    return neighbors(nodeId, { type: 'memory', limit: limit || 5 })
      .map(function (x) { return Object.assign({ relationWeight: x.edge.weight }, x.node); });
  }

  function centrality(nodeId) {
    if (!graph) return 0;
    return graph.edges.filter(function (e) { return e.from === nodeId || e.to === nodeId; }).length;
  }

  function stats() {
    if (!graph) return { nodes: 0, edges: 0, byType: {} };
    var byType = {};
    graph.nodes.forEach(function (n) { byType[n.type] = (byType[n.type] || 0) + 1; });
    return { nodes: graph.nodes.size, edges: graph.edges.length, byType: byType, builtAt: graph.builtAt };
  }

  return {
    build: build,
    refresh: build,
    getGraph: getGraph,
    neighbors: neighbors,
    relatedMemories: relatedMemories,
    centrality: centrality,
    stats: stats
  };
})();
