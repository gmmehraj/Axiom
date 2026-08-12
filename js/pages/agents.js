// ============================================
// AXIOM — Agent manager
// Exposes window.AxiomAgents. Merges the built-in catalog
// (agents-catalog.js) with the signed-in user's custom agents
// (public.agent_definitions), tracks which agent is active for chat,
// and provides memory + a small set of client-side "tools".
//
// Load order required on any page that uses agents:
//   supabase-config.js, auth.js, agents-catalog.js, then this file.
// Nothing here talks to OpenRouter directly — callers (app.js /
// jarvis.js, via the bridge files) still own the actual chat request;
// this module only supplies the system prompt, model, temperature and
// tool results that go into it.
// ============================================
(function (global) {
  'use strict';

  const ACTIVE_KEY = 'axiom:active-agent-id';
  const DEFAULT_AGENT_ID = 'builtin:general';
  const MEMORY_LIMIT_PER_PROMPT = 8; // most-recent notes folded into the system prompt

  let _customAgents = null;   // null = not loaded yet; [] = loaded, none
  let _favorites = null;      // Set<string> | null
  let _recent = null;         // [{agent_id, last_used_at}] | null
  let _loadPromise = null;

  function builtins() {
    return (global.AxiomAgentCatalog && global.AxiomAgentCatalog.BUILTIN_AGENTS) || [];
  }

  function toolCatalog() {
    return (global.AxiomAgentCatalog && global.AxiomAgentCatalog.TOOL_CATALOG) || [];
  }

  function normalizeCustom(row) {
    return {
      id: row.id, // uuid, already unique — not prefixed
      name: row.name,
      description: row.description || '',
      instructions: row.instructions || '',
      icon: row.icon || '\uD83E\uDD16',
      color: row.color || '#6C5CE7',
      avatarUrl: row.avatar_url || null,
      systemPrompt: row.system_prompt,
      defaultModel: row.default_model,
      temperature: typeof row.temperature === 'number' ? row.temperature : 0.7,
      tools: Array.isArray(row.tools) ? row.tools : [],
      quickActions: Array.isArray(row.quick_actions) ? row.quick_actions : [],
      memoryEnabled: row.memory_enabled !== false,
      isCustom: true,
      updatedAt: row.updated_at
    };
  }

  function normalizeBuiltin(a) {
    return Object.assign({ isCustom: false, memoryEnabled: true, instructions: '' }, a);
  }

  // -------------------- Loading --------------------

  async function ensureLoaded() {
    if (_customAgents !== null) return; // cached for the session
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
      if (typeof supabaseClient === 'undefined') {
        _customAgents = [];
        _favorites = new Set();
        _recent = [];
        return;
      }
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        _customAgents = [];
        _favorites = new Set();
        _recent = [];
        return;
      }

      const [agentsRes, favRes, recentRes] = await Promise.all([
        supabaseClient.from('agent_definitions').select('*').eq('is_archived', false).order('updated_at', { ascending: false }),
        supabaseClient.from('agent_favorites').select('agent_id'),
        supabaseClient.from('agent_recent_use').select('agent_id,last_used_at').order('last_used_at', { ascending: false }).limit(10)
      ]);

      _customAgents = (agentsRes.data || []).map(normalizeCustom);
      _favorites = new Set((favRes.data || []).map((r) => r.agent_id));
      _recent = recentRes.data || [];

      if (agentsRes.error) console.error('[AxiomAgents] failed to load custom agents:', agentsRes.error);
    })().finally(() => { _loadPromise = null; });

    return _loadPromise;
  }

  function invalidateCache() {
    _customAgents = null;
    _favorites = null;
    _recent = null;
  }

  // -------------------- Listing / lookup --------------------

  async function listAll() {
    await ensureLoaded();
    return builtins().map(normalizeBuiltin).concat(_customAgents || []);
  }

  async function getAgent(id) {
    if (!id) return null;
    const builtin = builtins().find((a) => a.id === id);
    if (builtin) return normalizeBuiltin(builtin);
    await ensureLoaded();
    return (_customAgents || []).find((a) => a.id === id) || null;
  }

  async function listFavorites() {
    await ensureLoaded();
    const all = await listAll();
    return all.filter((a) => _favorites && _favorites.has(a.id));
  }

  async function listRecent() {
    await ensureLoaded();
    const all = await listAll();
    const byId = new Map(all.map((a) => [a.id, a]));
    return (_recent || [])
      .map((r) => byId.get(r.agent_id))
      .filter(Boolean);
  }

  async function search(query) {
    const all = await listAll();
    const q = (query || '').trim().toLowerCase();
    if (!q) return all;
    return all.filter((a) =>
      a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q)
    );
  }

  // -------------------- Active agent --------------------

  function getActiveId() {
    try { return localStorage.getItem(ACTIVE_KEY) || DEFAULT_AGENT_ID; }
    catch { return DEFAULT_AGENT_ID; }
  }

  async function getActive() {
    return (await getAgent(getActiveId())) || normalizeBuiltin(builtins()[0]);
  }

  async function setActive(id) {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
    document.dispatchEvent(new CustomEvent('axiom:agent-changed', { detail: { agentId: id } }));
    recordRecentUse(id); // fire-and-forget
  }

  async function recordRecentUse(id) {
    if (typeof supabaseClient === 'undefined') return;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) return;
      await supabaseClient.rpc('bump_agent_recent_use', { p_agent_id: id });
      _recent = null; // invalidate just the recent list on next read
    } catch (err) {
      console.warn('[AxiomAgents] recordRecentUse failed:', err.message);
    }
  }

  // -------------------- Favorites --------------------

  async function isFavorite(id) {
    await ensureLoaded();
    return !!(_favorites && _favorites.has(id));
  }

  async function toggleFavorite(id) {
    if (typeof supabaseClient === 'undefined') return false;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('Sign in to save favorite agents.');
    await ensureLoaded();
    const isFav = _favorites.has(id);
    if (isFav) {
      await supabaseClient.from('agent_favorites').delete().eq('agent_id', id);
      _favorites.delete(id);
    } else {
      await supabaseClient.from('agent_favorites').insert({ owner_id: session.user.id, agent_id: id });
      _favorites.add(id);
    }
    return !isFav;
  }

  // -------------------- Custom agent CRUD --------------------

  async function createAgent(input) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('Sign in to create an agent.');
    const payload = {
      owner_id: session.user.id,
      name: (input.name || 'Untitled Agent').slice(0, 60),
      description: (input.description || '').slice(0, 300),
      instructions: (input.instructions || '').slice(0, 200),
      system_prompt: input.systemPrompt || input.instructions || 'You are a helpful assistant.',
      icon: input.icon || '\uD83E\uDD16',
      color: input.color || '#6C5CE7',
      default_model: input.defaultModel || 'openai/gpt-4o-mini',
      temperature: typeof input.temperature === 'number' ? input.temperature : 0.7,
      tools: input.tools || [],
      quick_actions: input.quickActions || [],
      memory_enabled: input.memoryEnabled !== false
    };
    const { data, error } = await supabaseClient.from('agent_definitions').insert(payload).select('*').single();
    if (error) throw error;
    invalidateCache();
    return normalizeCustom(data);
  }

  async function updateAgent(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name.slice(0, 60);
    if (patch.description !== undefined) dbPatch.description = patch.description.slice(0, 300);
    if (patch.instructions !== undefined) dbPatch.instructions = patch.instructions.slice(0, 200);
    if (patch.systemPrompt !== undefined) dbPatch.system_prompt = patch.systemPrompt;
    if (patch.icon !== undefined) dbPatch.icon = patch.icon;
    if (patch.color !== undefined) dbPatch.color = patch.color;
    if (patch.defaultModel !== undefined) dbPatch.default_model = patch.defaultModel;
    if (patch.temperature !== undefined) dbPatch.temperature = patch.temperature;
    if (patch.tools !== undefined) dbPatch.tools = patch.tools;
    if (patch.quickActions !== undefined) dbPatch.quick_actions = patch.quickActions;
    if (patch.memoryEnabled !== undefined) dbPatch.memory_enabled = patch.memoryEnabled;

    const { data, error } = await supabaseClient.from('agent_definitions').update(dbPatch).eq('id', id).select('*').single();
    if (error) throw error;
    invalidateCache();
    return normalizeCustom(data);
  }

  async function deleteAgent(id) {
    const { error } = await supabaseClient.from('agent_definitions').delete().eq('id', id);
    if (error) throw error;
    invalidateCache();
    if (getActiveId() === id) setActive(DEFAULT_AGENT_ID);
  }

  // -------------------- Memory --------------------

  async function getMemoryNotes(agentId, limit) {
    if (typeof supabaseClient === 'undefined') return [];
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabaseClient
      .from('agent_memory').select('id,note,tags,created_at')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(limit || MEMORY_LIMIT_PER_PROMPT);
    if (error) { console.warn('[AxiomAgents] getMemoryNotes failed:', error.message); return []; }
    return data || [];
  }

  // Saves one short note to an agent's memory. Callers should pass a
  // SHORT distilled fact ("prefers TypeScript over plain JS", "writing
  // tone: casual, short sentences") — not a raw message — matching the
  // DB check constraint and keeping later prompt injection cheap.
  // `tags` (optional) is Milestone 5: the Memory Agent's "tag memories"
  // capability, stored on the same row rather than a second table.
  async function remember(agentId, note, tags) {
    if (!note || !note.trim()) return null;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;
    const trimmed = note.trim().slice(0, 1000);
    const payload = { owner_id: session.user.id, agent_id: agentId, note: trimmed };
    if (Array.isArray(tags) && tags.length) payload.tags = tags;
    const { data, error } = await supabaseClient
      .from('agent_memory').insert(payload).select('id,note,tags,created_at').single();
    if (error) { console.warn('[AxiomAgents] remember() failed:', error.message); return null; }
    return data;
  }

  async function forgetAll(agentId) {
    const { error } = await supabaseClient.from('agent_memory').delete().eq('agent_id', agentId);
    if (error) throw error;
  }

  // -------------------- Milestone 5: Memory Agent capabilities --------------------
  // All of the below reuse the SAME agent_memory table as getMemoryNotes/
  // remember/forgetAll above — no second memory system.

  // "Search memories": substring search over one agent's notes.
  async function searchMemories(agentId, query, limit) {
    if (typeof supabaseClient === 'undefined' || !query) return [];
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabaseClient
      .from('agent_memory').select('id,note,tags,created_at')
      .eq('agent_id', agentId)
      .ilike('note', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(limit || 20);
    if (error) { console.warn('[AxiomAgents] searchMemories failed:', error.message); return []; }
    return data || [];
  }

  // "Update memories": edit a note's text and/or tags in place by id.
  async function updateMemory(id, patch) {
    if (!id) throw new Error('updateMemory requires a memory id.');
    patch = patch || {};
    const dbPatch = {};
    if (typeof patch.note === 'string') dbPatch.note = patch.note.trim().slice(0, 1000);
    if (Array.isArray(patch.tags)) dbPatch.tags = patch.tags;
    const { data, error } = await supabaseClient
      .from('agent_memory').update(dbPatch).eq('id', id).select('id,note,tags,created_at').single();
    if (error) throw error;
    return data;
  }

  // "Tag memories": convenience wrapper over updateMemory for tags only.
  async function tagMemory(id, tags) { return updateMemory(id, { tags: tags || [] }); }

  // "Delete memories": remove a single note by id (forgetAll already
  // covers "forget everything for this agent").
  async function deleteMemory(id) {
    if (!id) throw new Error('deleteMemory requires a memory id.');
    const { error } = await supabaseClient.from('agent_memory').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  // "Return recent memories": same shape as getMemoryNotes, named to match
  // the Memory Agent's "recent" capability.
  async function recentMemories(agentId, limit) { return getMemoryNotes(agentId, limit || 10); }

  // -------------------- Milestone 6: Memory Agent upgrade --------------------
  // Pinned memories, categories, and semantic recall all reuse the SAME
  // `agent_memory` table (via `updateMemory`/`searchMemories` above) — the
  // brief says "reuse the existing memory storage", so no second table or
  // store is introduced. Short-term memory is the one deliberate exception:
  // it is explicitly EPHEMERAL (cleared when the tab closes), so it is kept
  // in sessionStorage rather than persisted to the long-term store — mixing
  // the two would make "short-term" a lie.

  // "Pinned memories": a boolean flag on the same row, toggled via the
  // existing updateMemory patch path.
  async function pinMemory(id, pinned) {
    if (!id) throw new Error('pinMemory requires a memory id.');
    return updateMemory(id, { pinned: pinned !== false });
  }
  async function unpinMemory(id) { return pinMemory(id, false); }

  async function listPinned(agentId, limit) {
    if (typeof supabaseClient === 'undefined') return [];
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabaseClient
      .from('agent_memory').select('id,note,tags,category,pinned,created_at')
      .eq('agent_id', agentId).eq('pinned', true)
      .order('created_at', { ascending: false })
      .limit(limit || 50);
    if (error) { console.warn('[AxiomAgents] listPinned failed:', error.message); return []; }
    return data || [];
  }

  // "Memory categories": a single free-text label per note (e.g.
  // "preferences", "project-x", "research") stored on the same row.
  async function setCategory(id, category) {
    if (!id) throw new Error('setCategory requires a memory id.');
    return updateMemory(id, { category: category || null });
  }

  async function listCategories(agentId) {
    if (typeof supabaseClient === 'undefined') return [];
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabaseClient
      .from('agent_memory').select('category').eq('agent_id', agentId).not('category', 'is', null);
    if (error) { console.warn('[AxiomAgents] listCategories failed:', error.message); return []; }
    const counts = {};
    (data || []).forEach(r => { if (r.category) counts[r.category] = (counts[r.category] || 0) + 1; });
    return Object.keys(counts).sort().map(c => ({ category: c, count: counts[c] }));
  }

  // "Semantic recall": the project has no vector store, so this reuses the
  // existing ilike-based searchMemories as the retrieval step, then re-ranks
  // the candidate set by keyword/tag overlap with the query — an honest,
  // dependency-free approximation of semantic recall rather than a second
  // (fake) search engine. If a real embeddings backend is added later, only
  // this function's ranking step needs to change.
  function tokenize(s) {
    return String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  }
  function scoreOverlap(queryTokens, note) {
    const noteTokens = new Set(tokenize(note.note).concat((note.tags || []).map(t => String(t).toLowerCase())));
    let hits = 0;
    queryTokens.forEach(t => { if (noteTokens.has(t)) hits += 1; });
    return hits;
  }
  async function semanticRecall(agentId, query, limit) {
    if (!query) return [];
    // Cast a wider net than the final limit via plain search, then rank.
    const candidates = await searchMemories(agentId, query, Math.max((limit || 8) * 4, 20));
    const pool = candidates.length ? candidates : await getMemoryNotes(agentId, 50);
    const qTokens = tokenize(query);
    return pool
      .map(n => ({ note: n, score: scoreOverlap(qTokens, n) }))
      .sort((a, b) => b.score - a.score || (new Date(b.note.created_at) - new Date(a.note.created_at)))
      .slice(0, limit || 8)
      .map(x => Object.assign({ relevance: x.score }, x.note));
  }

  // "Short-term memory": scoped to this browser tab/session only, kept
  // separate from the durable agent_memory table on purpose. Same note/tags
  // shape as long-term memory so callers (and the Memory Agent handler) can
  // treat both uniformly.
  function stKey(agentId) { return `axiom:short-term:${agentId || 'builtin:general'}`; }
  function stLoad(agentId) {
    try { return JSON.parse(sessionStorage.getItem(stKey(agentId)) || '[]'); } catch (e) { return []; }
  }
  function stSave(agentId, items) {
    try { sessionStorage.setItem(stKey(agentId), JSON.stringify(items.slice(-50))); } catch (e) { /* storage unavailable */ }
  }
  async function rememberShortTerm(agentId, note, tags) {
    if (!note || !String(note).trim()) return null;
    const row = { id: 'st-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      note: String(note).trim().slice(0, 1000), tags: tags || [], created_at: new Date().toISOString() };
    const items = stLoad(agentId);
    items.push(row);
    stSave(agentId, items);
    return row;
  }
  async function recallShortTerm(agentId, limit) {
    return stLoad(agentId).slice(-1 * (limit || 10)).reverse();
  }
  async function clearShortTerm(agentId) { stSave(agentId, []); return true; }

  // -------------------- System prompt assembly --------------------

  // Builds the final system-prompt string for `agent`, folding in the
  // studio base persona, the agent's own prompt, and its most recent
  // memory notes (if memory is enabled for it). Kept synchronous-shaped
  // (returns a Promise) so callers can await it right before a send.
  async function buildSystemPrompt(agent, { basePrompt } = {}) {
    const parts = [];
    if (basePrompt) parts.push(basePrompt);
    parts.push(agent.systemPrompt);
    if (agent.instructions) parts.push(`Additional instructions from the user who configured this agent: ${agent.instructions}`);

    if (agent.memoryEnabled) {
      const notes = await getMemoryNotes(agent.id);
      if (notes.length) {
        const bullet = notes.map((n) => `- ${n.note}`).join('\n');
        parts.push(`Relevant things you remember about this user from earlier sessions with this agent:\n${bullet}`);
      }
    }
    return parts.join('\n\n');
  }

  // -------------------- Tools --------------------
  // Client-side "tools": since the chat pipeline is a plain proxy to
  // OpenRouter (no server-side function-calling loop), these run BEFORE
  // the request and fold their result into the outgoing message as
  // retrieved context, rather than being invoked mid-generation by the
  // model. internet_search and code_execution are intentionally stubs
  // (see agents-catalog.js `ready: false`) until a sandboxed/dispatchable
  // backend exists for them.

  async function runDocumentSearch(query, { limit = 5 } = {}) {
    if (typeof supabaseClient === 'undefined' || !query) return [];
    const { data, error } = await supabaseClient
      .from('workspace_files')
      .select('id,filename,extracted_text')
      .textSearch('extracted_text', query, { type: 'plain' })
      .limit(limit);
    if (error) { console.warn('[AxiomAgents] document_search failed:', error.message); return []; }
    return (data || []).map((f) => ({
      id: f.id, filename: f.filename,
      snippet: (f.extracted_text || '').slice(0, 600)
    }));
  }

  async function runWorkspaceSearch(query, { limit = 10 } = {}) {
    if (typeof supabaseClient === 'undefined' || !query) return [];
    const { data, error } = await supabaseClient
      .from('workspace_files')
      .select('id,filename,kind,created_at')
      .ilike('filename', `%${query}%`)
      .limit(limit);
    if (error) { console.warn('[AxiomAgents] workspace_search failed:', error.message); return []; }
    return data || [];
  }

  // Deliberately not `eval`: a small safe grammar for +, -, *, /, %, ^,
  // parentheses and decimals only — rejects anything else outright.
  function runCalculator(expression) {
    const expr = String(expression || '').trim();
    if (!/^[0-9+\-*/^%().\s]+$/.test(expr)) {
      throw new Error('Only numbers and + - * / % ^ ( ) are supported.');
    }
    const sanitized = expr.replace(/\^/g, '**');
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${sanitized});`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) throw new Error('Invalid expression.');
    return result;
  }

  const TOOL_RUNNERS = {
    document_search: (args) => runDocumentSearch(args.query, args),
    workspace_search: (args) => runWorkspaceSearch(args.query, args),
    calculator: (args) => runCalculator(args.expression),
    ocr: async (args) => {
      if (!global.FileProcessing || !args.file) throw new Error('No image attached to OCR.');
      return await global.FileProcessing.ocrImage(args.file, args.opts);
    },
    // summarization / translation / image_analysis / internet_search /
    // code_execution ride along as *prompt instructions* today (the
    // model itself performs them) rather than a separate retrieval
    // step — listed here so the Agent Library can show them as
    // available/roadmap without a dead code path.
    summarization: null,
    translation: null,
    image_analysis: null,
    internet_search: null,
    code_execution: null
  };

  async function runTool(name, args) {
    const runner = TOOL_RUNNERS[name];
    if (typeof runner !== 'function') throw new Error(`Tool "${name}" is not directly invokable (model-native or not yet wired up).`);
    return await runner(args || {});
  }

  global.AxiomAgents = {
    DEFAULT_AGENT_ID,
    listAll, getAgent, listFavorites, listRecent, search,
    getActiveId, getActive, setActive,
    isFavorite, toggleFavorite,
    createAgent, updateAgent, deleteAgent,
    getMemoryNotes, remember, forgetAll,
    searchMemories, updateMemory, tagMemory, deleteMemory, recentMemories,
    pinMemory, unpinMemory, listPinned, setCategory, listCategories, semanticRecall,
    rememberShortTerm, recallShortTerm, clearShortTerm,
    buildSystemPrompt,
    toolCatalog, runTool,
    invalidateCache
  };
})(window);
