// ============================================================
// AXIOM — Block 2 / Step 5: Browser Engine
// Part 1: Browser Engine Foundation (lifecycle, tabs, sessions,
//         navigation, history, browser state, bookmarks, downloads)
// Part 2: Navigation & Session Manager (this pass)
// ------------------------------------------------------------
// This module is the ONE place that owns browser state. It follows
// the same architectural convention already established by
// os/core/memory-engine.js and os/core/automation-engine.js in this
// codebase: a narrow, well-documented public API; internal state; a
// pub/sub layer for consumers; localStorage as the persistence
// backend, namespaced and schema-versioned so the backend can be
// swapped later without callers changing.
//
// WHAT PART 2 ADDS (see NAVIGATION_SESSION_REPORT.md for the full
// audit and architecture writeup):
//   - A Navigation Manager surface (engine.navigation.*) with real
//     URL validation (a protocol allowlist that rejects javascript:/
//     data:/vbscript:/file: input before it ever reaches the
//     normalizer — Part 1's normalizeUrl() had no explicit
//     protocol check), relative-path resolution against the active
//     tab's origin, stop-loading, and richer {ok,url,reason} results
//     for new callers — while every Part 1 flat method
//     (navigate/goBack/goForward/refresh/normalizeUrl) keeps its
//     exact original signature and return shape.
//   - A Session Manager surface (engine.sessions.*) adding
//     active-session tracking (for a future multi-window UI),
//     metadata updates, and real serialize()/restore() +
//     persist()/loadPersisted() hooks so a session's tab set can
//     actually be saved and brought back — additive, opt-in, so
//     tabs/sessions remain ephemeral by default exactly as in Part 1
//     unless a caller explicitly persists them.
//   - A Tab Manager surface (engine.tabs.*) adding duplicate() and
//     reorder(), on top of Part 1's create/close/switch/list/get.
//   - A History Manager surface (engine.history.*) adding explicit
//     per-tab back/forward stack accessors and aggregate visit
//     stats (built for Memory's later use), on top of Part 1's
//     list/clear.
//   - A Loading Lifecycle surface (engine.loadingLifecycle.*)
//     exposing a granular phase model (started → connecting →
//     loading → [redirecting] → content-ready → completed, or
//     failed / cancelled at any point) layered on top of Part 1's
//     coarse tab.status, driven by the exact same
//     reportLoading/reportLoaded/reportBlocked/reportError calls
//     browser-live.js already makes — no renderer changes required
//     for the basic phase sequence to work. connecting/started are
//     explicitly placeholder-timed (no real DNS/connection data is
//     available to this architecture), documented as such.
//
// All five *.navigation / *.sessions / *.tabs / *.history /
// *.loadingLifecycle namespaces are thin, documented wrappers around
// the SAME internal state Part 1 used — nothing is duplicated, there
// is exactly one tabs Map, one sessions Map, one history array. Part
// 1's flat top-level methods (engine.navigate(), engine.createTab(),
// etc.) are all still present, unchanged, for full backward
// compatibility with browser-live.js and the Part 1 regression suite.
//
// Explicitly NOT in this pass (by design, per spec):
//   - No real web automation, no OpenRouter / AI wiring, no UI
//     redesign (same as Part 1)
//   - No automatic/continuous session persistence — persist()/
//     restore() are real and callable, but nothing calls them on a
//     timer or on every tab change. See "Remaining work" in
//     NAVIGATION_SESSION_REPORT.md.
// ============================================================
window.AxiomBrowserEngine = (function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const NS = 'axiom:browser:v1:';
  const KEYS = {
    meta: NS + 'meta',
    bookmarks: NS + 'bookmarks',
    history: NS + 'history',
    downloads: NS + 'downloads',
    sessionSnapshots: NS + 'session-snapshots'
  };
  // Legacy (pre-Engine) keys written directly by browser-live.js.
  // Migrated once into the namespaced store below, then left alone.
  const LEGACY_KEYS = {
    bookmarks: 'axiom-browser-bookmarks',
    history: 'axiom-browser-history',
    downloads: 'axiom-browser-downloads'
  };

  const MAX_HISTORY = 200;
  const MAX_DOWNLOADS = 200;
  const STATUS = ['empty', 'loading', 'loaded', 'blocked', 'error', 'cancelled'];
  // Granular loading-lifecycle phases (Part 2 / Part F). 'started' and
  // 'connecting' are placeholder-timed — this architecture has no real
  // DNS/TCP/TLS timing to report, so both fire back-to-back with
  // 'loading' the moment a real navigation begins, per spec ("placeholder
  // state only if real data is unavailable").
  const PHASES = ['idle', 'started', 'connecting', 'loading', 'redirecting', 'content-ready', 'completed', 'failed', 'cancelled'];
  // Address-bar input must never be handed to the iframe as a raw
  // protocol we haven't explicitly allowed — closes a real gap Part 1
  // left open (normalizeUrl() had no explicit protocol check; unsafe
  // schemes only happened to fall through to the search branch by
  // regex coincidence, not by design).
  const BLOCKED_PROTOCOLS = /^\s*(javascript|data|vbscript|file|blob):/i;

  // ---- tiny id helper (no external deps) ------------------------------
  function uid(prefix) {
    return (prefix ? prefix + '_' : '') +
      Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---- storage adapter --------------------------------------------------
  // The only thing that ever touches localStorage. A future swap to
  // IndexedDB or a synced remote store only requires rewriting this.
  const StorageAdapter = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; /* storage unavailable — non-fatal */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* non-fatal */ }
    }
  };

  // ---- internal state -----------------------------------------------
  let initialized = false;
  let bookmarks = [];   // [{ url, title }]
  let history = [];     // [{ url, title, time }]
  let downloads = [];   // [{ id, url, filename, source, time }]
  const sessions = new Map();  // id -> session record
  const tabs = new Map();      // id -> tab record
  let defaultSessionId = null;
  let activeSessionId = null;  // Part 2: which session is "in front", independent of each session's own activeTabId
  const listeners = new Set();

  function emit(type, detail) {
    listeners.forEach(fn => {
      try { fn(type, detail); } catch (e) { /* isolated — one bad listener can't break another */ }
    });
    try {
      document.dispatchEvent(new CustomEvent('axiom:browser-engine', { detail: { type, detail } }));
    } catch (e) { /* non-DOM environment (e.g. regression suite under Node) — non-fatal */ }
  }

  function persistBookmarks() { StorageAdapter.write(KEYS.bookmarks, bookmarks); }
  function persistHistory() { StorageAdapter.write(KEYS.history, history.slice(-MAX_HISTORY)); }
  function persistDownloads() { StorageAdapter.write(KEYS.downloads, downloads.slice(-MAX_DOWNLOADS)); }

  function migrateLegacyIfNeeded() {
    const meta = StorageAdapter.read(KEYS.meta, null);
    if (meta && meta.migrated) return;
    // One-time carry-over so upgrading to the Engine never discards
    // bookmarks/history/downloads a person already had saved.
    const legacyBookmarks = StorageAdapter.read(LEGACY_KEYS.bookmarks, null);
    const legacyHistory = StorageAdapter.read(LEGACY_KEYS.history, null);
    const legacyDownloads = StorageAdapter.read(LEGACY_KEYS.downloads, null);
    if (Array.isArray(legacyBookmarks) && bookmarks.length === 0) bookmarks = legacyBookmarks;
    if (Array.isArray(legacyHistory) && history.length === 0) history = legacyHistory;
    if (Array.isArray(legacyDownloads) && downloads.length === 0) downloads = legacyDownloads;
    persistBookmarks(); persistHistory(); persistDownloads();
    StorageAdapter.write(KEYS.meta, { schemaVersion: SCHEMA_VERSION, migrated: true, migratedAt: Date.now() });
  }

  function loadPersisted() {
    bookmarks = StorageAdapter.read(KEYS.bookmarks, []);
    history = StorageAdapter.read(KEYS.history, []);
    downloads = StorageAdapter.read(KEYS.downloads, []);
    migrateLegacyIfNeeded();
  }

  // ---- URL validation & normalization (Part 2 / Parts A & E) -----------
  // validateUrl() classifies input WITHOUT mutating anything, so callers
  // can check before acting. normalizeUrl() (Part 1's original public
  // function — signature and return values unchanged for plain
  // normalizeUrl(input) calls) now delegates to it. An optional second
  // argument, contextUrl, is new in Part 2 and lets a relative path
  // ("/pricing") resolve against the tab that's navigating — omitting it
  // reproduces Part 1's exact original behavior (a relative path with no
  // context falls through to a search query, same as before).
  function validateUrl(input, contextUrl) {
    const raw = (input || '').trim();
    if (!raw) return { valid: false, kind: 'invalid', reason: 'empty-input', normalized: null };
    if (BLOCKED_PROTOCOLS.test(raw)) {
      return { valid: false, kind: 'invalid', reason: 'blocked-protocol', normalized: null };
    }
    if (/^https?:\/\//i.test(raw)) {
      return { valid: true, kind: 'url', reason: null, normalized: raw };
    }
    // Relative path handling — only when we know what page we're
    // relative to. "/pricing" typed while on example.com -> example.com/pricing.
    if (contextUrl && /^\/[^\s]*$/.test(raw)) {
      try {
        const resolved = new URL(raw, contextUrl).toString();
        return { valid: true, kind: 'url', reason: null, normalized: resolved };
      } catch (e) {
        // fall through to normal handling below if contextUrl was unusable
      }
    }
    if (/^[^\s]+\.[^\s]{2,}$/.test(raw) && !raw.includes(' ')) {
      return { valid: true, kind: 'url', reason: null, normalized: 'https://' + raw };
    }
    // Not a recognizable url — treated as a search query. Still "valid"
    // navigation input (we will always produce somewhere to go), just
    // not a url the person typed.
    return { valid: true, kind: 'search', reason: null, normalized: 'https://duckduckgo.com/?q=' + encodeURIComponent(raw) };
  }
  function normalizeUrl(input, contextUrl) {
    const result = validateUrl(input, contextUrl);
    return result.valid ? result.normalized : null;
  }
  function hostnameOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }

  // ---- sessions ---------------------------------------------------------
  function createSession(opts) {
    opts = opts || {};
    const id = uid('sess');
    const session = {
      id,
      background: !!opts.background,   // true = isolated agent session, not the visible user session
      label: opts.label || (opts.background ? 'Agent session' : 'Browser'),
      metadata: opts.metadata ? Object.assign({}, opts.metadata) : {},
      tabIds: [],
      activeTabId: null,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    };
    sessions.set(id, session);
    if (!activeSessionId && !session.background) activeSessionId = id;
    emit('session:started', { sessionId: id, background: session.background });
    return session;
  }
  function getSession(id) { return sessions.get(id) || null; }
  function listSessions() { return Array.from(sessions.values()); }
  function endSession(id) {
    const session = sessions.get(id);
    if (!session) return false;
    session.tabIds.slice().forEach(tabId => closeTab(id, tabId));
    sessions.delete(id);
    if (activeSessionId === id) {
      const next = Array.from(sessions.values()).find(s => !s.background);
      activeSessionId = next ? next.id : null;
    }
    emit('session:ended', { sessionId: id });
    return true;
  }
  function touchSession(id) {
    const session = sessions.get(id);
    if (session) session.lastActiveAt = Date.now();
  }
  function getDefaultSessionId() { return defaultSessionId; }

  // Part 2: which visible session is "in front" — meaningful once more
  // than one non-background session exists (a future multi-window UI);
  // with today's single-visible-session UI this always equals
  // getDefaultSessionId().
  function getActiveSessionId() { return activeSessionId; }
  function setActiveSessionId(id) {
    if (!sessions.has(id)) return false;
    activeSessionId = id;
    touchSession(id);
    emit('session:activated', { sessionId: id });
    return true;
  }
  function updateSessionMetadata(id, patch) {
    const session = sessions.get(id);
    if (!session) return false;
    Object.assign(session.metadata, patch || {});
    touchSession(id);
    emit('session:metadata-updated', { sessionId: id });
    return true;
  }

  // Session restoration (Part 2 / Part B). serialize() captures just
  // enough to rebuild the session's tabs (their url/title/hist stack);
  // restore() rebuilds it as a NEW session (never overwrites an existing
  // one) with each tab's saved url set directly and marked 'loaded' —
  // a restored tab is not re-navigated (no history/loading event spam);
  // the real page load only happens when it actually becomes active in a
  // renderer, at which point browser-live.js's normal render path takes
  // over exactly as it would for any other tab.
  function serializeSession(id) {
    const session = sessions.get(id);
    if (!session) return null;
    return {
      label: session.label,
      background: session.background,
      metadata: Object.assign({}, session.metadata),
      activeIndex: session.tabIds.indexOf(session.activeTabId),
      tabs: session.tabIds.map(tid => {
        const t = tabs.get(tid);
        return t ? { title: t.title, url: t.url, hist: t.hist.slice(), histIndex: t.histIndex } : null;
      }).filter(Boolean)
    };
  }
  function restoreSession(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.tabs)) throw new Error('Invalid session snapshot.');
    const session = createSession({ background: snapshot.background, label: snapshot.label, metadata: snapshot.metadata });
    snapshot.tabs.forEach((saved, i) => {
      const tabId = uid('tab');
      tabs.set(tabId, {
        id: tabId, sessionId: session.id,
        title: saved.title || 'New Tab', url: saved.url || null, favicon: '🌐',
        hist: Array.isArray(saved.hist) ? saved.hist.slice() : (saved.url ? [saved.url] : []),
        histIndex: typeof saved.histIndex === 'number' ? saved.histIndex : (saved.url ? 0 : -1),
        status: saved.url ? 'loaded' : 'empty', phase: saved.url ? 'completed' : 'idle',
        errorMessage: null,
        createdAt: Date.now(), updatedAt: Date.now()
      });
      session.tabIds.push(tabId);
      if (i === (snapshot.activeIndex || 0)) session.activeTabId = tabId;
    });
    if (!session.activeTabId && session.tabIds.length) session.activeTabId = session.tabIds[0];
    if (session.tabIds.length === 0) createTab(session.id); // never restore an empty session
    emit('session:restored', { sessionId: session.id, tabCount: session.tabIds.length });
    return session;
  }
  // Persistence hooks — real, callable, but never invoked automatically
  // by this pass (see file header). A caller (a future auto-save timer,
  // or an explicit "save session" action) decides when to use these.
  function persistSessionSnapshot(id, key) {
    const snapshot = serializeSession(id);
    if (!snapshot) return false;
    const all = StorageAdapter.read(KEYS.sessionSnapshots, {});
    all[key || id] = snapshot;
    StorageAdapter.write(KEYS.sessionSnapshots, all);
    emit('session:persisted', { sessionId: id, key: key || id });
    return true;
  }
  function loadSessionSnapshot(key) {
    const all = StorageAdapter.read(KEYS.sessionSnapshots, {});
    return all[key] || null;
  }
  function listPersistedSessionKeys() {
    return Object.keys(StorageAdapter.read(KEYS.sessionSnapshots, {}));
  }

  // ---- tabs ---------------------------------------------------------
  function createTab(sessionId, url) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Unknown session "' + sessionId + '".');
    const id = uid('tab');
    tabs.set(id, {
      id, sessionId,
      title: 'New Tab', url: null, favicon: '🌐',
      hist: [], histIndex: -1,
      status: 'empty', phase: 'idle', errorMessage: null,
      createdAt: Date.now(), updatedAt: Date.now()
    });
    session.tabIds.push(id);
    session.activeTabId = id;
    touchSession(sessionId);
    emit('tab:created', { sessionId, tabId: id });
    if (url) navigate(sessionId, id, url);
    return id;
  }
  function getTab(tabId) { return tabs.get(tabId) || null; }
  function listTabs(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return [];
    return session.tabIds.map(id => tabs.get(id)).filter(Boolean);
  }
  function getActiveTab(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || !session.activeTabId) return null;
    return tabs.get(session.activeTabId) || null;
  }
  function switchTab(sessionId, tabId) {
    const session = sessions.get(sessionId);
    if (!session || !tabs.has(tabId) || tabs.get(tabId).sessionId !== sessionId) return false;
    session.activeTabId = tabId;
    touchSession(sessionId);
    emit('tab:switched', { sessionId, tabId });
    return true;
  }
  function closeTab(sessionId, tabId) {
    const session = sessions.get(sessionId);
    if (!session) return false;
    const idx = session.tabIds.indexOf(tabId);
    if (idx === -1) return false;
    session.tabIds.splice(idx, 1);
    tabs.delete(tabId);
    if (session.tabIds.length === 0) {
      // A session always keeps at least one tab open, same behavior
      // browser-live.js relied on before (closing the last tab opens a
      // fresh blank one rather than leaving the workspace empty).
      createTab(sessionId);
    } else if (session.activeTabId === tabId) {
      switchTab(sessionId, session.tabIds[Math.max(0, idx - 1)]);
    }
    emit('tab:closed', { sessionId, tabId });
    return true;
  }
  // Part 2 additions to the Tab Manager:
  function duplicateTab(sessionId, tabId) {
    const session = sessions.get(sessionId);
    const source = tabs.get(tabId);
    if (!session || !source || source.sessionId !== sessionId) return null;
    const newId = uid('tab');
    tabs.set(newId, {
      id: newId, sessionId,
      title: source.title, url: source.url, favicon: source.favicon,
      hist: source.hist.slice(), histIndex: source.histIndex,
      status: source.url ? 'loaded' : 'empty', phase: source.url ? 'completed' : 'idle',
      errorMessage: null,
      createdAt: Date.now(), updatedAt: Date.now()
    });
    const sourceIdx = session.tabIds.indexOf(tabId);
    session.tabIds.splice(sourceIdx + 1, 0, newId); // duplicate lands right next to its source
    touchSession(sessionId);
    emit('tab:duplicated', { sessionId, sourceTabId: tabId, tabId: newId });
    return newId;
  }
  function reorderTabs(sessionId, tabId, newIndex) {
    const session = sessions.get(sessionId);
    if (!session) return false;
    const from = session.tabIds.indexOf(tabId);
    if (from === -1) return false;
    const clampedIndex = Math.max(0, Math.min(newIndex, session.tabIds.length - 1));
    session.tabIds.splice(from, 1);
    session.tabIds.splice(clampedIndex, 0, tabId);
    touchSession(sessionId);
    emit('tab:reordered', { sessionId, tabId, index: clampedIndex });
    return true;
  }

  // ---- loading lifecycle (Part 2 / Part F) -------------------------
  // Layered on top of tab.status: a granular, explicit phase per tab,
  // driven by the exact same report*() calls Part 1 already had, plus
  // one new one (reportCancelled, for the new stop-loading capability).
  function setPhase(tabId, phase) {
    const tab = tabs.get(tabId);
    if (!tab || PHASES.indexOf(phase) === -1 || tab.phase === phase) return;
    tab.phase = phase;
    emit('lifecycle:phase', { sessionId: tab.sessionId, tabId, phase });
  }
  function getPhase(tabId) {
    const tab = tabs.get(tabId);
    return tab ? tab.phase : null;
  }

  // ---- navigation ---------------------------------------------------
  // beginNavigation() is the one real entry point every user-initiated
  // navigation (navigate/goBack/goForward/refresh) funnels through, so
  // "no duplicate navigation events" holds by construction — there is
  // exactly one place tab:navigated and navigation:started are emitted
  // for a given nav, regardless of which of the four callers triggered it.
  function beginNavigation(tab, url, opts) {
    opts = opts || {};
    tab.url = url;
    tab.status = 'loading';
    tab.errorMessage = null;
    tab.updatedAt = Date.now();
    setPhase(tab.id, 'started');
    setPhase(tab.id, 'connecting'); // placeholder phase — no real connection timing available
    setPhase(tab.id, 'loading');
    if (!opts.fromHistoryNav) recordHistory(url);
    emit('tab:navigated', { sessionId: tab.sessionId, tabId: tab.id, url, fromHistoryNav: !!opts.fromHistoryNav });
    emit('navigation:started', { sessionId: tab.sessionId, tabId: tab.id, url });
  }
  function navigate(sessionId, tabId, rawInput) {
    const tab = tabs.get(tabId);
    if (!tab) return null;
    const url = normalizeUrl(rawInput, tab.url); // Part 2: relative paths resolve against the current page
    if (!url) {
      emit('navigation:failed', { sessionId, tabId, reason: 'invalid-url', input: rawInput });
      return null; // unchanged Part 1 contract: invalid/empty input -> null, no throw
    }
    tab.hist = tab.hist.slice(0, tab.histIndex + 1);
    tab.hist.push(url);
    tab.histIndex = tab.hist.length - 1;
    beginNavigation(tab, url);
    return { url };
  }
  function goBack(sessionId, tabId) {
    const tab = tabs.get(tabId);
    if (!tab || tab.histIndex <= 0) return null;
    tab.histIndex -= 1;
    beginNavigation(tab, tab.hist[tab.histIndex], { fromHistoryNav: true });
    return { url: tab.url };
  }
  function goForward(sessionId, tabId) {
    const tab = tabs.get(tabId);
    if (!tab || tab.histIndex >= tab.hist.length - 1) return null;
    tab.histIndex += 1;
    beginNavigation(tab, tab.hist[tab.histIndex], { fromHistoryNav: true });
    return { url: tab.url };
  }
  function refresh(sessionId, tabId) {
    const tab = tabs.get(tabId);
    if (!tab || !tab.url) return null;
    beginNavigation(tab, tab.url, { fromHistoryNav: true });
    return { url: tab.url };
  }
  // Part 2: Stop loading. Only meaningful mid-flight; a no-op (returns
  // false) once the tab has already settled, so it can never "cancel" a
  // page that already finished.
  function stopLoading(sessionId, tabId) {
    const tab = tabs.get(tabId);
    if (!tab || tab.status !== 'loading') return false;
    tab.status = 'cancelled';
    tab.updatedAt = Date.now();
    setPhase(tabId, 'cancelled');
    emit('tab:status', { sessionId: tab.sessionId, tabId, status: 'cancelled' });
    emit('navigation:cancelled', { sessionId: tab.sessionId, tabId });
    return true;
  }
  // Part 2: Redirect handling. A redirect is the SAME logical navigation
  // continuing at a new url — it updates the current history entry in
  // place rather than pushing a new one (so back/forward don't grow an
  // extra step per redirect hop), and reports the 'redirecting' phase.
  function reportRedirect(sessionId, tabId, newUrl) {
    const tab = tabs.get(tabId);
    if (!tab) return;
    tab.url = newUrl;
    if (tab.histIndex >= 0) tab.hist[tab.histIndex] = newUrl;
    tab.updatedAt = Date.now();
    setPhase(tabId, 'redirecting');
    emit('navigation:redirected', { sessionId, tabId, url: newUrl });
  }

  // ---- browser state (loading / loaded / blocked / error) ---------------
  // Called by the DOM renderer (browser-live.js) once the real <iframe> it
  // owns actually settles. The engine never assumes success on its own.
  function reportLoading(sessionId, tabId) { setStatus(tabId, 'loading'); setPhase(tabId, 'loading'); }
  function reportLoaded(sessionId, tabId, meta) {
    const tab = tabs.get(tabId);
    if (!tab) return;
    if (meta && meta.title) tab.title = meta.title;
    else if (tab.url) tab.title = hostnameOf(tab.url);
    setPhase(tabId, 'content-ready');
    setStatus(tabId, 'loaded');
    setPhase(tabId, 'completed');
    emit('navigation:completed', { sessionId: tab.sessionId, tabId, url: tab.url });
  }
  function reportBlocked(sessionId, tabId) {
    setStatus(tabId, 'blocked');
    setPhase(tabId, 'failed');
    emit('navigation:failed', { sessionId, tabId, reason: 'blocked-embed' });
  }
  function reportError(sessionId, tabId, message) {
    const tab = tabs.get(tabId);
    if (tab) tab.errorMessage = message || null;
    setStatus(tabId, 'error');
    setPhase(tabId, 'failed');
    emit('navigation:failed', { sessionId, tabId, reason: message || 'error' });
  }
  function setStatus(tabId, status) {
    const tab = tabs.get(tabId);
    if (!tab || STATUS.indexOf(status) === -1 || tab.status === status) return;
    tab.status = status;
    tab.updatedAt = Date.now();
    emit('tab:status', { sessionId: tab.sessionId, tabId, status });
  }
  function isBlocked(tabId) {
    const tab = tabs.get(tabId);
    return !!(tab && tab.status === 'blocked');
  }

  // ---- history --------------------------------------------------------
  function recordHistory(url) {
    history.push({ url, title: hostnameOf(url), time: Date.now() });
    persistHistory();
    emit('history:recorded', { url });
  }
  function listHistory(limit) { return history.slice().reverse().slice(0, limit || 100); }
  function clearHistory() { history = []; persistHistory(); emit('history:cleared', {}); return true; }
  // Part 2: explicit back/forward stack accessors — the same hist/
  // histIndex a tab already tracks, exposed as two plain arrays so a
  // caller doesn't need to know the internal single-array-plus-index
  // representation.
  function getBackStack(tabId) {
    const tab = tabs.get(tabId);
    return tab ? tab.hist.slice(0, tab.histIndex) : [];
  }
  function getForwardStack(tabId) {
    const tab = tabs.get(tabId);
    return tab ? tab.hist.slice(tab.histIndex + 1) : [];
  }
  // Part 2: aggregate stats built for Memory's later use (per spec,
  // "History APIs should be reusable by Memory later") — visit counts
  // per host, derived read-only from the same history array, nothing
  // additional stored.
  function getHistoryStats() {
    const byHost = {};
    history.forEach(h => {
      const host = hostnameOf(h.url);
      byHost[host] = (byHost[host] || 0) + 1;
    });
    return { totalVisits: history.length, uniqueHosts: Object.keys(byHost).length, visitsByHost: byHost };
  }

  // ---- bookmarks --------------------------------------------------------
  function isBookmarked(url) { return bookmarks.some(b => b.url === url); }
  function addBookmark(url, title) {
    if (isBookmarked(url)) return false;
    bookmarks.push({ url, title: title || hostnameOf(url) });
    persistBookmarks();
    emit('bookmark:added', { url });
    return true;
  }
  function removeBookmark(url) {
    const idx = bookmarks.findIndex(b => b.url === url);
    if (idx === -1) return false;
    bookmarks.splice(idx, 1);
    persistBookmarks();
    emit('bookmark:removed', { url });
    return true;
  }
  function toggleBookmark(url, title) {
    if (!url) return false;
    return isBookmarked(url) ? (removeBookmark(url), false) : (addBookmark(url, title), true);
  }
  function listBookmarks() { return bookmarks.slice(); }

  // ---- downloads --------------------------------------------------------
  function recordDownload(entry) {
    const row = Object.assign({ id: uid('dl'), time: Date.now() }, entry);
    downloads.push(row);
    persistDownloads();
    emit('download:recorded', { id: row.id });
    return row;
  }
  function listDownloads(limit) { return downloads.slice(-1 * (limit || 50)).reverse(); }
  function clearDownloads() { downloads = []; persistDownloads(); emit('downloads:cleared', {}); return true; }

  // ---- snapshots / stats --------------------------------------------
  // Same shape browser-live.js's getSnapshot() always returned, so the
  // Browser Agent bridge (os/runtime/capabilities/browser-bridge.js)
  // and browser-agent.js keep working against the engine unchanged.
  function getSnapshot(sessionId) {
    const sid = sessionId || defaultSessionId;
    const tab = getActiveTab(sid);
    return {
      sessionId: sid,
      activeTabId: tab ? tab.id : null,
      url: tab ? tab.url : null,
      title: tab ? tab.title : null,
      canGoBack: !!(tab && tab.histIndex > 0),
      canGoForward: !!(tab && tab.hist && tab.histIndex < tab.hist.length - 1),
      tabs: listTabs(sid).map(t => ({ id: t.id, title: t.title, url: t.url, status: t.status })),
      blocked: !!(tab && tab.status === 'blocked'),
      phase: tab ? tab.phase : null // Part 2 addition — purely additive key
    };
  }
  function getState() {
    return {
      sessions: listSessions().map(s => ({
        id: s.id, background: s.background, label: s.label, metadata: Object.assign({}, s.metadata),
        tabIds: s.tabIds.slice(), activeTabId: s.activeTabId,
        createdAt: s.createdAt, lastActiveAt: s.lastActiveAt
      })),
      tabs: Array.from(tabs.values()).map(t => Object.assign({}, t)),
      bookmarks: bookmarks.slice(),
      historyCount: history.length,
      downloadsCount: downloads.length,
      activeSessionId
    };
  }
  function getStats() {
    return {
      sessionCount: sessions.size,
      tabCount: tabs.size,
      bookmarkCount: bookmarks.length,
      historyCount: history.length,
      downloadCount: downloads.length
    };
  }

  // ---- lifecycle --------------------------------------------------------
  function init() {
    if (initialized) return getDefaultSessionId(); // idempotent, like the Memory Engine
    loadPersisted();
    const session = createSession({ background: false, label: 'Browser' });
    defaultSessionId = session.id;
    activeSessionId = session.id;
    initialized = true;
    emit('engine:initialized', { defaultSessionId });
    return defaultSessionId;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // ---- Part 2 namespaced manager surfaces --------------------------------
  // Thin wrappers over the exact functions above — no separate state, no
  // separate event bus (everything still flows through the one `emit()`
  // above and the one `onChange()` subscription), so there is exactly one
  // source of truth regardless of whether a caller uses the flat API
  // (engine.navigate(...), kept for Part 1 / browser-live.js compatibility)
  // or the namespaced one (engine.navigation.navigate(...)).
  const NavigationManager = {
    navigate(sessionId, tabId, input) {
      const tab = tabs.get(tabId);
      const check = validateUrl(input, tab ? tab.url : undefined);
      if (!check.valid) {
        emit('navigation:failed', { sessionId, tabId, reason: check.reason, input });
        return { ok: false, url: null, reason: check.reason };
      }
      const nav = navigate(sessionId, tabId, input);
      return nav ? { ok: true, url: nav.url, reason: null } : { ok: false, url: null, reason: 'navigation-failed' };
    },
    back: goBack,
    forward: goForward,
    refresh,
    stop: stopLoading,
    reportRedirect,
    validateUrl,
    normalizeUrl,
    getCurrentUrl(sessionId, tabId) { const t = tabs.get(tabId); return t ? t.url : null; },
    canGoBack(sessionId, tabId) { const t = tabs.get(tabId); return !!(t && t.histIndex > 0); },
    canGoForward(sessionId, tabId) { const t = tabs.get(tabId); return !!(t && t.histIndex < t.hist.length - 1); }
  };

  const SessionManager = {
    create: createSession,
    get: getSession,
    list: listSessions,
    end: endSession,
    getDefault: getDefaultSessionId,
    getActive: getActiveSessionId,
    setActive: setActiveSessionId,
    updateMetadata: updateSessionMetadata,
    serialize: serializeSession,
    restore: restoreSession,
    persist: persistSessionSnapshot,
    loadPersisted: loadSessionSnapshot,
    listPersistedKeys: listPersistedSessionKeys
  };

  const TabManager = {
    create: createTab,
    close: closeTab,
    switch: switchTab,
    duplicate: duplicateTab,
    reorder: reorderTabs,
    list: listTabs,
    get: getTab,
    getActive: getActiveTab
  };

  const HistoryManager = {
    list: listHistory,
    clear: clearHistory,
    stats: getHistoryStats,
    backStack: getBackStack,
    forwardStack: getForwardStack
  };

  const LoadingLifecycle = {
    phases: PHASES.slice(),
    getPhase,
    reportStarted: reportLoading, // 'started'/'connecting'/'loading' placeholder chain (see beginNavigation)
    reportContentReady: reportLoaded,
    reportBlocked,
    reportFailed: reportError,
    reportCancelled: stopLoading
  };

  return {
    init,
    // Part 1 flat API — unchanged, kept for full backward compatibility.
    createSession, getSession, listSessions, endSession, getDefaultSessionId,
    createTab, closeTab, switchTab, getActiveTab, getTab, listTabs,
    navigate, goBack, goForward, refresh,
    reportLoading, reportLoaded, reportBlocked, reportError, isBlocked,
    normalizeUrl,
    addBookmark, removeBookmark, toggleBookmark, listBookmarks, isBookmarked,
    listHistory, clearHistory,
    recordDownload, listDownloads, clearDownloads,
    getSnapshot, getState, getStats,
    onChange,
    // Part 2 additions — new flat methods...
    validateUrl, stopLoading, reportRedirect, duplicateTab, reorderTabs,
    getActiveSessionId, setActiveSessionId, updateSessionMetadata,
    serializeSession, restoreSession, persistSessionSnapshot, loadSessionSnapshot, listPersistedSessionKeys,
    getBackStack, getForwardStack, getHistoryStats, getPhase,
    // ...and the same capabilities organized as named managers, per spec.
    navigation: NavigationManager,
    sessions: SessionManager,
    tabs: TabManager,
    history: HistoryManager,
    loadingLifecycle: LoadingLifecycle
  };
})();
