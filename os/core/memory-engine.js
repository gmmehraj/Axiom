// ============================================================
// AXIOM — Block 2 / Step 3 / Part 1: Memory Foundation
// ------------------------------------------------------------
// Replaces the Memory page's hardcoded MEMORY_ITEMS array and
// throwaway UI state with a real, persisted memory architecture.
//
// This module is deliberately scoped to the FOUNDATION only:
//   - Session memory        (per-tab, TTL'd, heartbeat-refreshed)
//   - Conversation history   (messages, ordered, per-conversation)
//   - Message indexing       (id / tag / agent / project / type
//                             lookup maps — no embeddings, no
//                             semantic search, no vector store)
//   - Metadata storage       (importance, confidence, tags, source,
//                             access counts, timestamps)
//   - Memory lifecycle       (create / touch / update / pin / delete)
//   - Memory cleanup         (expired sessions, expired ephemeral
//                             memories, message-history capping)
//   - Memory state management (pub/sub so any page can react to
//                             writes without polling)
//
// Storage layer: localStorage, namespaced and schema-versioned, with
// every read/write funnelled through a small adapter object
// (StorageAdapter) so the persistence backend (e.g. IndexedDB, a
// Supabase-backed remote store) can be swapped later without callers
// changing. This mirrors the existing localStorage + BroadcastChannel
// pattern already used by conversation-bridge.js and axiom-brain.js,
// so it fits the app's established cross-tab conventions.
//
// Explicitly OUT of scope for this pass (by design, per spec):
//   - Semantic search / embeddings
//   - Vector databases
//   - UI changes to memory.html (memory-ultimate.js consumes this
//     engine's API but keeps its existing markup/visuals)
//
// Public API — window.AxiomMemoryEngine:
//   init()                              -> loads persisted state, starts
//                                           session + cleanup timers
//   getSession()                        -> current session record
//   touchSession()                      -> refresh session heartbeat
//   startConversation(meta?)            -> { id, ... }
//   endConversation(id)
//   addMessage(conversationId, msg)     -> stored + indexed message
//   getConversationHistory(id)          -> ordered message array
//   listConversations()                 -> conversation summaries
//   hasConversation(id)                 -> bool, no side effects (Block 2 ·
//                                           Step 3 · Part 2, used by the
//                                           Brain-Memory bridge to avoid
//                                           duplicate conversation records)
//   updateConversationMeta(id, patch)   -> merges into conversation.meta
//                                           (Block 2 · Step 3 · Part 2 —
//                                           e.g. live activeModel) without
//                                           touching any other field
//   addMemory(record)                   -> stored + indexed long-term memory
//   updateMemory(id, patch)
//   touchMemory(id)                     -> records an access (read)
//   deleteMemory(id)
//   getMemory(id)
//   queryMemories(filter)               -> { text?, agent?, project?, tag?,
//                                            type?, pinned?, minImportance? }
//   listTags() / listAgents() / listProjects()
//   getWorkingMemory() / setWorkingMemory(items)
//   getStats()                          -> counts + short-term cache load
//   cleanup()                           -> runs lifecycle/cleanup pass now
//   exportAll() / importAll(json)
//   onChange(fn)                        -> subscribe to mutations, returns
//                                           an unsubscribe function
// ============================================================
window.AxiomMemoryEngine = (function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const NS = 'axiom:memory:v1:';
  const KEYS = {
    meta: NS + 'meta',
    sessions: NS + 'sessions',
    conversations: NS + 'conversations',
    messagesPrefix: NS + 'messages:', // + conversationId
    memories: NS + 'memories',
    working: NS + 'working'
  };

  const SESSION_TTL_MS = 30 * 60 * 1000;        // 30 min idle -> session expires
  const SESSION_RETENTION_MS = 30 * 24 * 3600e3; // keep ended sessions 30 days (audit trail)
  const MAX_MESSAGES_PER_CONVERSATION = 500;     // lifecycle cap; oldest are trimmed
  const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;     // run a lifecycle pass every 5 min
  const HEARTBEAT_INTERVAL_MS = 60 * 1000;

  // ---- tiny id helper (no external deps) ------------------------------
  function uid(prefix) {
    return (prefix ? prefix + '_' : '') +
      Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  // ============================================================
  // STORAGE LAYER
  // A single narrow adapter — every disk access goes through here so
  // the backend can change without touching engine logic above it.
  // ============================================================
  const StorageAdapter = {
    read(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        console.warn('[MemoryEngine] read failed for', key, e);
        return fallback;
      }
    },
    write(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn('[MemoryEngine] write failed for', key, e);
        return false;
      }
    },
    remove(key) {
      try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }
  };

  // ============================================================
  // IN-MEMORY STATE (hydrated from StorageAdapter at init())
  // ============================================================
  let meta = { schemaVersion: SCHEMA_VERSION, lastCleanup: 0 };
  let sessions = {};        // sessionId -> session record
  let conversations = {};   // conversationId -> conversation record
  const messageCache = {};  // conversationId -> messages[] (lazy-loaded)
  let memories = {};        // memoryId -> memory record
  let workingMemory = [];   // ephemeral "current focus" items, session-scoped
  let activeSessionId = null;

  // ---- Secondary indices (rebuilt on load, kept in sync on write) ----
  // Non-semantic: plain equality/containment lookups only.
  const index = {
    byTag: new Map(),      // tag -> Set(memoryId)
    byAgent: new Map(),    // agent -> Set(memoryId)
    byProject: new Map(),  // project -> Set(memoryId)
    byType: new Map()      // type -> Set(memoryId)
  };

  function indexAdd(map, key, id) {
    if (key === undefined || key === null || key === '') return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  }
  function indexRemove(map, key, id) {
    if (!map.has(key)) return;
    map.get(key).delete(id);
    if (map.get(key).size === 0) map.delete(key);
  }
  function indexMemory(mem) {
    (mem.tags || []).forEach(t => indexAdd(index.byTag, t, mem.id));
    indexAdd(index.byAgent, mem.agent, mem.id);
    indexAdd(index.byProject, mem.project, mem.id);
    indexAdd(index.byType, mem.type, mem.id);
  }
  function deindexMemory(mem) {
    (mem.tags || []).forEach(t => indexRemove(index.byTag, t, mem.id));
    indexRemove(index.byAgent, mem.agent, mem.id);
    indexRemove(index.byProject, mem.project, mem.id);
    indexRemove(index.byType, mem.type, mem.id);
  }
  function rebuildIndex() {
    index.byTag.clear(); index.byAgent.clear();
    index.byProject.clear(); index.byType.clear();
    Object.values(memories).forEach(indexMemory);
  }

  // ============================================================
  // STATE MANAGEMENT (pub/sub)
  // ============================================================
  const listeners = new Set();
  function emit(type, payload) {
    listeners.forEach(fn => {
      try { fn({ type, payload }); } catch (e) { /* isolate subscriber errors */ }
    });
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // ============================================================
  // PERSISTENCE HELPERS
  // ============================================================
  function persistMeta() { StorageAdapter.write(KEYS.meta, meta); }
  function persistSessions() { StorageAdapter.write(KEYS.sessions, sessions); }
  function persistConversations() { StorageAdapter.write(KEYS.conversations, conversations); }
  function persistMemories() { StorageAdapter.write(KEYS.memories, memories); }
  function persistWorking() { StorageAdapter.write(KEYS.working, workingMemory); }
  function persistMessages(conversationId) {
    StorageAdapter.write(KEYS.messagesPrefix + conversationId, messageCache[conversationId] || []);
  }
  function loadMessages(conversationId) {
    if (!messageCache[conversationId]) {
      messageCache[conversationId] = StorageAdapter.read(KEYS.messagesPrefix + conversationId, []);
    }
    return messageCache[conversationId];
  }

  // ============================================================
  // SESSION MEMORY
  // A session represents one continuous period of activity. It is
  // resumed (not recreated) if the last session on this device went
  // idle less than SESSION_TTL_MS ago — this is what keeps "working
  // memory" and short-term-cache metrics coherent across page loads
  // in the same tab/browser instead of resetting on every refresh.
  // ============================================================
  function getMostRecentSession() {
    const all = Object.values(sessions);
    if (!all.length) return null;
    all.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return all[0];
  }

  function getOrCreateSession() {
    const now = Date.now();
    const recent = getMostRecentSession();
    if (recent && !recent.endedAt && (now - recent.lastActiveAt) < SESSION_TTL_MS) {
      recent.lastActiveAt = now;
      activeSessionId = recent.id;
      persistSessions();
      return recent;
    }
    if (recent && !recent.endedAt) {
      // previous session went stale — close it out
      recent.endedAt = recent.lastActiveAt;
    }
    const session = {
      id: uid('sess'),
      startedAt: now,
      lastActiveAt: now,
      endedAt: null
    };
    sessions[session.id] = session;
    activeSessionId = session.id;
    workingMemory = []; // fresh session -> fresh working memory
    persistSessions();
    persistWorking();
    emit('session:started', session);
    return session;
  }

  function getSession() { return sessions[activeSessionId] || null; }

  function touchSession() {
    const s = getSession();
    if (!s) return getOrCreateSession();
    s.lastActiveAt = Date.now();
    persistSessions();
    return s;
  }

  // ============================================================
  // CONVERSATION HISTORY
  // ============================================================
  function startConversation(extra) {
    touchSession();
    const conv = Object.assign({
      id: uid('conv'),
      sessionId: activeSessionId,
      title: 'New conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      endedAt: null
    }, extra || {});
    conversations[conv.id] = conv;
    messageCache[conv.id] = [];
    persistConversations();
    persistMessages(conv.id);
    emit('conversation:started', conv);
    return conv;
  }

  function endConversation(conversationId) {
    const conv = conversations[conversationId];
    if (!conv) return null;
    conv.endedAt = Date.now();
    persistConversations();
    emit('conversation:ended', conv);
    return conv;
  }

  function addMessage(conversationId, msg) {
    touchSession();
    let conv = conversations[conversationId];
    if (!conv) conv = startConversation({ id: conversationId });
    const list = loadMessages(conversationId);
    const record = Object.assign({
      id: uid('msg'),
      conversationId,
      role: 'user',
      content: '',
      ts: Date.now(),
      agent: null,
      meta: {}
    }, msg || {});
    list.push(record);
    conv.messageCount = list.length;
    conv.updatedAt = record.ts;
    persistMessages(conversationId);
    persistConversations();
    trimConversationHistory(conversationId);
    emit('message:added', record);
    return record;
  }

  function trimConversationHistory(conversationId) {
    const list = messageCache[conversationId];
    if (!list || list.length <= MAX_MESSAGES_PER_CONVERSATION) return;
    const removed = list.splice(0, list.length - MAX_MESSAGES_PER_CONVERSATION);
    conversations[conversationId].messageCount = list.length;
    persistMessages(conversationId);
    persistConversations();
    if (removed.length) emit('messages:trimmed', { conversationId, count: removed.length });
  }

  function getConversationHistory(conversationId) {
    return loadMessages(conversationId).slice();
  }

  function listConversations() {
    return Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function hasConversation(conversationId) {
    return !!conversations[conversationId];
  }

  // Block 2 · Step 3 · Part 2: lets a producer (the Brain, via
  // brain-memory-bridge.js) attach live pipeline metadata — active model,
  // last-known AI activity, tool state — onto a conversation record
  // without touching message history or any other field. Merges into a
  // `meta` sub-object so callers can never accidentally clobber the
  // conversation's own id/title/timestamps.
  function updateConversationMeta(conversationId, patch) {
    const conv = conversations[conversationId];
    if (!conv) return null;
    conv.meta = Object.assign({}, conv.meta, patch || {});
    conv.updatedAt = Date.now();
    persistConversations();
    emit('conversation:meta-updated', conv);
    return conv;
  }

  // ============================================================
  // LONG-TERM MEMORY (metadata storage + lifecycle)
  // ============================================================
  function addMemory(record) {
    const now = Date.now();
    const mem = Object.assign({
      id: uid('mem'),
      text: '',
      agent: 'General',
      project: 'general',
      type: 'context',
      tags: [],
      importance: 0.5,
      confidence: 0.7,
      pinned: false,
      ttl: null,           // null = long-term / never expires
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0
    }, record || {});
    memories[mem.id] = mem;
    indexMemory(mem);
    persistMemories();
    emit('memory:added', mem);
    return mem;
  }

  function getMemory(id) { return memories[id] || null; }

  function updateMemory(id, patch) {
    const mem = memories[id];
    if (!mem) return null;
    deindexMemory(mem);
    Object.assign(mem, patch, { updatedAt: Date.now() });
    indexMemory(mem);
    persistMemories();
    emit('memory:updated', mem);
    return mem;
  }

  function touchMemory(id) {
    const mem = memories[id];
    if (!mem) return null;
    mem.lastAccessedAt = Date.now();
    mem.accessCount = (mem.accessCount || 0) + 1;
    persistMemories();
    emit('memory:accessed', mem);
    return mem;
  }

  function deleteMemory(id) {
    const mem = memories[id];
    if (!mem) return false;
    deindexMemory(mem);
    delete memories[id];
    persistMemories();
    emit('memory:deleted', { id });
    return true;
  }

  function queryMemories(filter) {
    filter = filter || {};
    let ids = null; // intersecting candidate set built from indices when possible

    function intersect(set) {
      if (ids === null) { ids = new Set(set); return; }
      ids = new Set([...ids].filter(id => set.has(id)));
    }

    if (filter.tag && index.byTag.has(filter.tag)) intersect(index.byTag.get(filter.tag));
    else if (filter.tag) ids = new Set();

    if (filter.agent && index.byAgent.has(filter.agent)) intersect(index.byAgent.get(filter.agent));
    else if (filter.agent) ids = new Set();

    if (filter.project && index.byProject.has(filter.project)) intersect(index.byProject.get(filter.project));
    else if (filter.project) ids = new Set();

    if (filter.type && index.byType.has(filter.type)) intersect(index.byType.get(filter.type));
    else if (filter.type) ids = new Set();

    let items = ids === null
      ? Object.values(memories)
      : [...ids].map(id => memories[id]).filter(Boolean);

    if (filter.pinned) items = items.filter(m => m.pinned);
    if (typeof filter.minImportance === 'number') {
      items = items.filter(m => m.importance >= filter.minImportance);
    }
    if (filter.text) {
      const q = filter.text.toLowerCase();
      items = items.filter(m =>
        m.text.toLowerCase().includes(q) ||
        (m.agent || '').toLowerCase().includes(q) ||
        (m.tags || []).some(t => t.toLowerCase().includes(q)) ||
        (m.project || '').toLowerCase().includes(q)
      );
    }
    return items;
  }

  function listTags() { return [...index.byTag.keys()].sort(); }
  function listAgents() { return [...index.byAgent.keys()].sort(); }
  function listProjects() { return [...index.byProject.keys()].sort(); }

  // ============================================================
  // WORKING MEMORY (ephemeral, session-scoped, not persisted long-term)
  // ============================================================
  function getWorkingMemory() { return workingMemory.slice(); }
  function setWorkingMemory(items) {
    workingMemory = Array.isArray(items) ? items.slice() : [];
    persistWorking();
    emit('working:updated', workingMemory);
    return getWorkingMemory();
  }

  // ============================================================
  // STATS
  // ============================================================
  function getStats() {
    const memList = Object.values(memories);
    const cap = 12; // working-memory soft capacity used for the cache-load metric
    return {
      memoryCount: memList.length,
      pinnedCount: memList.filter(m => m.pinned).length,
      conversationCount: Object.keys(conversations).length,
      activeSessionId,
      shortTermCacheLoad: Math.max(0, Math.min(1, workingMemory.length / cap)),
      lastCleanup: meta.lastCleanup
    };
  }

  // ============================================================
  // LIFECYCLE / CLEANUP PASS
  // Expires stale sessions past retention, drops orphaned ephemeral
  // memories whose ttl has elapsed, and caps message history. Safe to
  // call repeatedly — it is a no-op when nothing has aged out.
  // ============================================================
  function cleanup() {
    const now = Date.now();
    let changed = false;

    // 1) End sessions that have been idle past TTL but never closed
    Object.values(sessions).forEach(s => {
      if (!s.endedAt && (now - s.lastActiveAt) > SESSION_TTL_MS) {
        s.endedAt = s.lastActiveAt;
        changed = true;
      }
    });

    // 2) Purge sessions past the retention window entirely
    Object.keys(sessions).forEach(id => {
      const s = sessions[id];
      if (s.endedAt && (now - s.endedAt) > SESSION_RETENTION_MS) {
        delete sessions[id];
        changed = true;
      }
    });

    // 3) Expire ephemeral (ttl-bearing) memories
    Object.keys(memories).forEach(id => {
      const m = memories[id];
      if (m.ttl && (now - m.updatedAt) > m.ttl) {
        deindexMemory(m);
        delete memories[id];
        changed = true;
      }
    });

    // 4) Cap every conversation's stored history
    Object.keys(conversations).forEach(trimConversationHistory);

    if (changed) {
      persistSessions();
      persistMemories();
    }
    meta.lastCleanup = now;
    persistMeta();
    emit('cleanup:ran', { at: now, changed });
    return { changed };
  }

  // ============================================================
  // EXPORT / IMPORT (full-fidelity backup, distinct from any single
  // page's "export visible rows" button)
  // ============================================================
  function exportAll() {
    const allMessages = {};
    Object.keys(conversations).forEach(id => { allMessages[id] = loadMessages(id); });
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      sessions, conversations, messages: allMessages, memories, workingMemory
    };
  }

  function importAll(data) {
    if (!data || typeof data !== 'object') return false;
    sessions = data.sessions || {};
    conversations = data.conversations || {};
    memories = data.memories || {};
    workingMemory = data.workingMemory || [];
    Object.keys(messageCache).forEach(k => delete messageCache[k]);
    Object.assign(messageCache, data.messages || {});
    rebuildIndex();
    persistSessions(); persistConversations(); persistMemories(); persistWorking();
    Object.keys(messageCache).forEach(persistMessages);
    emit('imported', { at: Date.now() });
    return true;
  }

  // ============================================================
  // INIT
  // ============================================================
  let initialized = false;
  let heartbeatTimer = null;
  let cleanupTimer = null;

  function init() {
    if (initialized) return getStats();
    meta = StorageAdapter.read(KEYS.meta, meta);
    sessions = StorageAdapter.read(KEYS.sessions, {});
    conversations = StorageAdapter.read(KEYS.conversations, {});
    memories = StorageAdapter.read(KEYS.memories, {});
    workingMemory = StorageAdapter.read(KEYS.working, []);
    rebuildIndex();

    getOrCreateSession();
    cleanup();

    heartbeatTimer = setInterval(touchSession, HEARTBEAT_INTERVAL_MS);
    cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
    if (heartbeatTimer && heartbeatTimer.unref) heartbeatTimer.unref();
    if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();

    initialized = true;
    emit('engine:initialized', getStats());
    return getStats();
  }

  return {
    init,
    getSession, touchSession,
    startConversation, endConversation, addMessage, getConversationHistory, listConversations,
    hasConversation, updateConversationMeta,
    addMemory, updateMemory, touchMemory, deleteMemory, getMemory, queryMemories,
    listTags, listAgents, listProjects,
    getWorkingMemory, setWorkingMemory,
    getStats, cleanup,
    exportAll, importAll,
    onChange
  };
})();
