// ============================================================
// AXIOM — Block 2 / Step 3 / Part 3: Memory Manager
// ------------------------------------------------------------
// A stable, read-oriented API layer in front of the Part 1 foundation
// (os/core/memory-engine.js) and the Part 2 connector
// (os/core/brain-memory-bridge.js). Neither of those is modified —
// this module only ever calls their existing public methods.
//
// Scope, per spec, is retrieval + housekeeping, not new storage
// primitives or new intelligence:
//   - Conversation lookup   (single conversation, with its messages,
//                            paginated; "does this id exist")
//   - Memory filtering       (multi-criteria queries, sorting,
//                            pagination, on top of queryMemories())
//   - Session browsing       (list every known session — not just the
//                            active one — with derived duration/status)
//   - Memory cleanup         (a driven, reported cleanup pass — same
//                            engine.cleanup() call, but returns a
//                            before/after breakdown instead of a bare
//                            {changed} flag)
//   - Metadata retrieval     (tag/agent/project/type roll-ups,
//                            importance & confidence distribution,
//                            aggregate counts)
//   - Stable Memory APIs     (a versioned, additive-only surface;
//                            every method is a pure read or a thin,
//                            idempotent wrapper — nothing here can
//                            silently create duplicate conversation
//                            or memory records)
//
// Explicitly OUT of scope for this pass (Version 2, per spec):
//   - Vector search
//   - Embeddings
//   - Semantic memory
//   - Long-term AI reasoning over memory content
//
// Public API — window.AxiomMemoryManager:
//   API_VERSION                          -> '1.0.0'
//   init()                               -> ensures the engine is
//                                            initialized, returns getOverview()
//   getConversation(id, opts?)           -> { conversation, messages,
//                                             total, offset, limit } | null
//   listConversations(opts?)             -> { items, total, offset, limit }
//                                            opts: { agent?, project?,
//                                            titleContains?, activeOnly?,
//                                            sort? ('recent'|'oldest'),
//                                            offset?, limit? }
//   findMemories(filter?, opts?)         -> { items, total, offset, limit }
//                                            filter: same shape as
//                                            engine.queryMemories(); opts:
//                                            { sort? ('recent'|'oldest'|
//                                            'importance'|'confidence'),
//                                            offset?, limit? }
//   listSessions(opts?)                  -> { items, total, offset, limit }
//                                            each item adds durationMs,
//                                            status ('active'|'ended')
//   getSession(id)                       -> session + derived fields | null
//   getMetadataSummary()                 -> tag/agent/project/type counts,
//                                            importance & confidence
//                                            buckets, pinned count
//   getOverview()                        -> engine.getStats() + top tags/
//                                            agents/projects (small,
//                                            dashboard-sized summary)
//   runCleanup()                         -> before/after counts + what
//                                            the underlying cleanup pass
//                                            actually removed
//   registerMemory(record)               -> { record, created:boolean }
//                                            dedupes on exact
//                                            (text, agent, project, type)
//                                            match before delegating to
//                                            engine.addMemory() — never
//                                            creates a duplicate record
//   ensureConversation(id, extra?)       -> { conversation, created }
//                                            dedupes via hasConversation()
//                                            before startConversation()
//   onChange(fn)                         -> subscribe (passthrough to the
//                                            engine's own pub/sub, so
//                                            Manager reads never drift
//                                            from engine writes)
// ============================================================
window.AxiomMemoryManager = (function () {
  'use strict';

  const API_VERSION = '1.0.0';
  const DEFAULT_LIMIT = 25;
  const MAX_LIMIT = 200;

  function engine() { return window.AxiomMemoryEngine || null; }

  // ---- shared paging helper -------------------------------------------
  function paginate(items, opts) {
    opts = opts || {};
    const total = items.length;
    let offset = Number.isFinite(opts.offset) ? Math.max(0, opts.offset) : 0;
    let limit = Number.isFinite(opts.limit) ? opts.limit : DEFAULT_LIMIT;
    limit = Math.max(1, Math.min(MAX_LIMIT, limit));
    return { items: items.slice(offset, offset + limit), total, offset, limit };
  }

  // ============================================================
  // CONVERSATION LOOKUP
  // ============================================================
  function getConversation(conversationId, opts) {
    const eng = engine();
    if (!eng || !conversationId) return null;
    if (!eng.hasConversation(conversationId)) return null;

    const all = eng.listConversations();
    const conversation = all.find(c => c.id === conversationId) || null;
    if (!conversation) return null;

    const history = eng.getConversationHistory(conversationId);
    const paged = paginate(history, opts);
    return {
      conversation,
      messages: paged.items,
      total: paged.total,
      offset: paged.offset,
      limit: paged.limit
    };
  }

  function listConversations(opts) {
    const eng = engine();
    if (!eng) return { items: [], total: 0, offset: 0, limit: DEFAULT_LIMIT };
    opts = opts || {};

    let items = eng.listConversations(); // already sorted most-recent-first
    if (opts.agent) {
      items = items.filter(c => (c.meta && c.meta.activeModel) === opts.agent || c.agent === opts.agent);
    }
    if (opts.project) {
      items = items.filter(c => c.project === opts.project);
    }
    if (opts.titleContains) {
      const q = String(opts.titleContains).toLowerCase();
      items = items.filter(c => (c.title || '').toLowerCase().includes(q));
    }
    if (opts.activeOnly) {
      items = items.filter(c => !c.endedAt);
    }
    if (opts.sort === 'oldest') {
      items = items.slice().sort((a, b) => a.updatedAt - b.updatedAt);
    } // 'recent' (default) already matches listConversations() order

    return paginate(items, opts);
  }

  function ensureConversation(conversationId, extra) {
    const eng = engine();
    if (!eng) return null;
    if (conversationId && eng.hasConversation(conversationId)) {
      const conv = eng.listConversations().find(c => c.id === conversationId);
      return { conversation: conv, created: false };
    }
    const conv = eng.startConversation(Object.assign({}, extra || {}, conversationId ? { id: conversationId } : {}));
    return { conversation: conv, created: true };
  }

  // ============================================================
  // MEMORY FILTERING
  // ============================================================
  function findMemories(filter, opts) {
    const eng = engine();
    if (!eng) return { items: [], total: 0, offset: 0, limit: DEFAULT_LIMIT };
    opts = opts || {};

    let items = eng.queryMemories(filter || {});

    switch (opts.sort) {
      case 'oldest':
        items = items.slice().sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'importance':
        items = items.slice().sort((a, b) => b.importance - a.importance);
        break;
      case 'confidence':
        items = items.slice().sort((a, b) => b.confidence - a.confidence);
        break;
      case 'recent':
      default:
        items = items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
        break;
    }

    return paginate(items, opts);
  }

  // Dedupe guard: exact (text, agent, project, type) match is treated as
  // "already recorded" — returns the existing record instead of writing
  // a new one, so callers can register memories idempotently.
  function registerMemory(record) {
    const eng = engine();
    if (!eng || !record) return null;
    const candidates = eng.queryMemories({
      agent: record.agent,
      project: record.project,
      type: record.type
    });
    const dup = candidates.find(m => (m.text || '') === (record.text || ''));
    if (dup) return { record: dup, created: false };
    const created = eng.addMemory(record);
    return { record: created, created: true };
  }

  // ============================================================
  // SESSION BROWSING
  // ============================================================
  function deriveSessionFields(session) {
    const endedAt = session.endedAt || null;
    const durationMs = (endedAt || Date.now()) - session.startedAt;
    return Object.assign({}, session, {
      durationMs,
      status: endedAt ? 'ended' : 'active'
    });
  }

  function listSessions(opts) {
    const eng = engine();
    if (!eng) return { items: [], total: 0, offset: 0, limit: DEFAULT_LIMIT };
    // The engine only exposes the *current* session directly; every
    // session (including past, ended ones) lives in its own persisted
    // store under the same StorageAdapter namespace, so read it the
    // same way the engine does — via localStorage — rather than
    // duplicating engine-internal state in this module.
    let raw = [];
    try {
      const stored = window.localStorage.getItem('axiom:memory:v1:sessions');
      raw = stored ? Object.values(JSON.parse(stored)) : [];
    } catch (e) {
      raw = [];
    }
    // Always include the live session even if a read race missed it.
    const current = eng.getSession();
    if (current && !raw.find(s => s.id === current.id)) raw.push(current);

    let items = raw.map(deriveSessionFields).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    if (opts && opts.statusFilter) {
      items = items.filter(s => s.status === opts.statusFilter);
    }
    return paginate(items, opts);
  }

  function getSession(sessionId) {
    const result = listSessions({ limit: MAX_LIMIT });
    return result.items.find(s => s.id === sessionId) || null;
  }

  // ============================================================
  // METADATA RETRIEVAL
  // ============================================================
  function countBy(items, keyFn) {
    const counts = {};
    items.forEach(item => {
      const key = keyFn(item);
      if (key === undefined || key === null || key === '') return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  function bucketize(items, valueFn) {
    const buckets = { '0.0-0.2': 0, '0.2-0.4': 0, '0.4-0.6': 0, '0.6-0.8': 0, '0.8-1.0': 0 };
    items.forEach(item => {
      const v = Math.max(0, Math.min(1, valueFn(item)));
      if (v < 0.2) buckets['0.0-0.2']++;
      else if (v < 0.4) buckets['0.2-0.4']++;
      else if (v < 0.6) buckets['0.4-0.6']++;
      else if (v < 0.8) buckets['0.6-0.8']++;
      else buckets['0.8-1.0']++;
    });
    return buckets;
  }

  function getMetadataSummary() {
    const eng = engine();
    if (!eng) return null;
    const items = eng.queryMemories({});
    return {
      totalMemories: items.length,
      pinnedCount: items.filter(m => m.pinned).length,
      tagCounts: (function () {
        const counts = {};
        items.forEach(m => (m.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
        return counts;
      })(),
      agentCounts: countBy(items, m => m.agent),
      projectCounts: countBy(items, m => m.project),
      typeCounts: countBy(items, m => m.type),
      importanceDistribution: bucketize(items, m => m.importance),
      confidenceDistribution: bucketize(items, m => m.confidence)
    };
  }

  function getOverview() {
    const eng = engine();
    if (!eng) return null;
    const stats = eng.getStats();
    const summary = getMetadataSummary();
    function top(counts, n) {
      return Object.entries(counts || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([key, count]) => ({ key, count }));
    }
    return Object.assign({}, stats, {
      apiVersion: API_VERSION,
      topTags: top(summary && summary.tagCounts, 5),
      topAgents: top(summary && summary.agentCounts, 5),
      topProjects: top(summary && summary.projectCounts, 5)
    });
  }

  // ============================================================
  // MEMORY CLEANUP (driven + reported)
  // ============================================================
  function runCleanup() {
    const eng = engine();
    if (!eng) return null;
    const before = eng.getStats();
    const beforeSessionCount = listSessions({ limit: MAX_LIMIT }).total;
    const result = eng.cleanup(); // { changed }
    const after = eng.getStats();
    const afterSessionCount = listSessions({ limit: MAX_LIMIT }).total;
    return {
      changed: !!(result && result.changed),
      before: { memoryCount: before.memoryCount, sessionCount: beforeSessionCount },
      after: { memoryCount: after.memoryCount, sessionCount: afterSessionCount },
      memoriesRemoved: Math.max(0, before.memoryCount - after.memoryCount),
      sessionsRemoved: Math.max(0, beforeSessionCount - afterSessionCount),
      ranAt: Date.now()
    };
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    const eng = engine();
    if (eng && typeof eng.init === 'function') eng.init();
    return getOverview();
  }

  function onChange(fn) {
    const eng = engine();
    if (!eng || typeof eng.onChange !== 'function') return () => {};
    return eng.onChange(fn);
  }

  return {
    API_VERSION,
    init,
    getConversation, listConversations, ensureConversation,
    findMemories, registerMemory,
    listSessions, getSession,
    getMetadataSummary, getOverview,
    runCleanup,
    onChange
  };
})();
