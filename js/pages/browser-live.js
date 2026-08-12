// ============================================================
// AXIOM AI OS X — Browser Workspace: DOM renderer over the
// Browser Engine (os/core/browser-engine.js).
// ------------------------------------------------------------
// Block 2 / Step 5 / Part 1 refactor: this file used to be the
// only place browser state (tabs/history/bookmarks) lived, mixed
// directly into DOM code. It now holds NO browser state of its
// own — window.AxiomBrowserEngine is the single source of truth
// for tabs, sessions, history, bookmarks, and downloads. This file
// is purely the renderer: it turns engine state into the existing
// browser.html markup, and turns the existing markup's real
// <iframe> load/error events into engine.report*() calls so the
// engine's status model reflects what actually happened.
//
// Nothing about browser.html's markup, styling, or the
// window.AxiomBrowserLive / postMessage public surfaces changed —
// os/runtime/capabilities/browser-bridge.js and browser-agent.js
// keep working completely unchanged against this file.
//
// Block 2 / Step 5 / Part 3 addition: this file now calls the engine's
// existing (Part 2) session-persistence hooks itself — restoring the
// last-saved session on load and saving it again on unload — see
// tryRestoreLastSession()/persistCurrentSession() below. No new engine
// logic; this is the "wire an autosave" work Part 2's own
// NAVIGATION_SESSION_REPORT.md flagged as remaining for Part 3.
// ============================================================
(function () {
  'use strict';

  const els = {};
  const BLOCK_TIMEOUT_MS = 7000;
  // Block 2 / Step 5 / Part 3 — Session Persistence (Part E). Reuses the
  // engine's existing, real serializeSession()/restoreSession()/
  // persistSessionSnapshot()/loadSessionSnapshot() hooks (Part 2), which
  // until now were callable but never invoked by anything. One fixed key
  // ties every visit of this workspace to "the last session the person
  // was in" — a future multi-window UI or cloud sync can layer more keys
  // (per-window, per-account) on top without changing this contract.
  const SESSION_PERSIST_KEY = 'default';
  let engine = null;
  let sessionId = null;
  let unsubscribe = null;

  function activeTab() { return engine.getActiveTab(sessionId); }

  // ---- thin wrappers the rest of this file (and the public API below)
  // call — every one of these just forwards to the engine. No state is
  // read or written directly by this file anymore.
  function newTab(url) { return engine.createTab(sessionId, url); }
  function switchTab(id) { engine.switchTab(sessionId, id); }
  function closeTab(id) { engine.closeTab(sessionId, id); }
  function navigate(rawInput) {
    const tab = activeTab();
    if (!tab) return;
    engine.navigate(sessionId, tab.id, rawInput);
  }
  function goBack() { const t = activeTab(); if (t) engine.goBack(sessionId, t.id); }
  function goForward() { const t = activeTab(); if (t) engine.goForward(sessionId, t.id); }
  function refresh() { const t = activeTab(); if (t) engine.refresh(sessionId, t.id); }
  function search(query) { navigate(query); }
  // Part 2 additions — no new visible UI chrome; these exist so the
  // postMessage bridge (and any same-window caller) can reach the
  // Navigation/Tab Manager's new capabilities.
  function stopLoading() { const t = activeTab(); return t ? engine.stopLoading(sessionId, t.id) : false; }
  function duplicateTab(tabId) { return engine.duplicateTab(sessionId, tabId || (activeTab() && activeTab().id)); }
  function reorderTab(tabId, index) { return engine.reorderTabs(sessionId, tabId, index); }
  function toggleBookmark() {
    const t = activeTab();
    if (!t || !t.url) return;
    engine.toggleBookmark(t.url, t.title);
    if (els.bookmarksPanel.style.display !== 'none') renderBookmarksPanel();
  }

  function showEmptyState() {
    els.empty.style.display = 'flex';
    els.frame.style.display = 'none';
    els.loading.style.display = 'none';
    els.blocked.style.display = 'none';
    els.urlInput.value = '';
  }

  function hostnameOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }

  function updateBookmarkIcon(url) {
    const isBookmarked = url ? engine.isBookmarked(url) : false;
    els.bookmarkToggle.style.opacity = isBookmarked ? '1' : '.55';
  }

  // Loads the real <iframe> for the active tab's current url, and reports
  // what actually happens back to the engine (reportLoaded / reportBlocked
  // / reportError) — the engine never assumes success on its own.
  function renderActiveTabIntoFrame() {
    const tab = activeTab();
    if (!tab) return;
    if (!tab.url) { showEmptyState(); return; }
    const url = tab.url;

    els.empty.style.display = 'none';
    els.blocked.style.display = 'none';
    els.loading.style.display = 'flex';
    els.frame.style.display = 'none';
    els.urlInput.value = url;
    updateBookmarkIcon(url);
    engine.reportLoading(sessionId, tab.id);

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      els.loading.style.display = 'none';
      els.blocked.style.display = 'flex';
      els.openExternal.href = url;
      engine.reportBlocked(sessionId, tab.id);
    }, BLOCK_TIMEOUT_MS);

    els.frame.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      els.loading.style.display = 'none';
      els.frame.style.display = 'block';
      let title = url;
      try { title = els.frame.contentDocument.title || url; } catch (e) { title = hostnameOf(url); }
      engine.reportLoaded(sessionId, tab.id, { title });
      tryWatchDownloads();
    };
    els.frame.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      els.loading.style.display = 'none';
      els.blocked.style.display = 'flex';
      els.openExternal.href = url;
      engine.reportError(sessionId, tab.id, 'Failed to load.');
    };
    els.frame.src = url;
  }

  // Perf audit (Block 2 / Step 5 / Part 6A): a single navigation
  // lifecycle previously triggered renderTabs() twice ('tab:navigated'
  // at nav start, 'tab:status' at load completion), and every call
  // tore down + rebuilt every tab's DOM node AND re-attached two fresh
  // click listeners per tab, even though at most one tab actually
  // changed. Two fixes, same observable behavior:
  //   1. Click handling now uses ONE delegated listener on the tabs
  //      strip (wired once in init()), so re-rendering never
  //      creates/discards per-tab listeners — no listener churn, no
  //      accumulation to leak.
  //   2. renderTabs() calls in the same tick/frame are coalesced via
  //      scheduleRenderTabs() (rAF-batched) so a full nav lifecycle
  //      still repaints the strip exactly once instead of twice.
  let renderTabsScheduled = false;
  function scheduleRenderTabs() {
    if (renderTabsScheduled) return;
    renderTabsScheduled = true;
    const flush = () => { renderTabsScheduled = false; renderTabs(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 0);
  }
  function renderTabs() {
    const list = engine.listTabs(sessionId);
    const activeId = activeTab() ? activeTab().id : null;
    els.tabsEl.innerHTML = list.map(t => `
      <div class="ax-browser-tab${t.id === activeId ? ' active' : ''}" data-tab-id="${t.id}">
        <span>${t.favicon}</span>
        <span class="ax-browser-tab-title">${escapeHtml(t.title || 'New Tab')}</span>
        <span class="ax-browser-tab-close" data-close-tab="${t.id}" style="margin-left:6px;opacity:.5;cursor:pointer;">×</span>
      </div>
    `).join('');
    // No per-tab listeners here anymore — see the delegated handler
    // wired once on els.tabsEl in init().
  }

  function renderBookmarksPanel() {
    els.historyPanel.style.display = 'none';
    const bookmarks = engine.listBookmarks();
    if (bookmarks.length === 0) {
      els.bookmarksPanel.innerHTML = '<div style="padding:8px;font-size:.8rem;opacity:.5;">No bookmarks yet.</div>';
    } else {
      els.bookmarksPanel.innerHTML = bookmarks.map(b => `
        <div class="ax-browser-panel-item" data-goto="${escapeHtml(b.url)}" style="padding:8px;font-size:.8rem;cursor:pointer;border-radius:6px;">${escapeHtml(b.title)}</div>
      `).join('');
      els.bookmarksPanel.querySelectorAll('[data-goto]').forEach(el => {
        el.addEventListener('click', () => { navigate(el.dataset.goto); els.bookmarksPanel.style.display = 'none'; });
      });
    }
    els.bookmarksPanel.style.display = els.bookmarksPanel.style.display === 'none' ? 'block' : 'none';
  }

  function renderHistoryPanel() {
    els.bookmarksPanel.style.display = 'none';
    const history = engine.listHistory(50);
    if (history.length === 0) {
      els.historyPanel.innerHTML = '<div style="padding:8px;font-size:.8rem;opacity:.5;">No history yet.</div>';
    } else {
      els.historyPanel.innerHTML = history.map(h => `
        <div class="ax-browser-panel-item" data-goto="${escapeHtml(h.url)}" style="padding:8px;font-size:.8rem;cursor:pointer;border-radius:6px;">${escapeHtml(h.title)}</div>
      `).join('');
      els.historyPanel.querySelectorAll('[data-goto]').forEach(el => {
        el.addEventListener('click', () => { navigate(el.dataset.goto); els.historyPanel.style.display = 'none'; });
      });
    }
    els.historyPanel.style.display = els.historyPanel.style.display === 'none' ? 'block' : 'none';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Reacts to engine state changes. Only 'tab:created' / 'tab:switched' /
  // 'tab:navigated' actually (re)load the live iframe — everything else
  // (status updates the render function itself triggered, bookmark/history
  // writes) just refreshes the relevant piece of UI, so acting on our own
  // engine.report*() calls below never causes a reload loop.
  function onEngineChange(type) {
    switch (type) {
      case 'tab:created':
      case 'tab:switched':
      case 'tab:navigated':
        scheduleRenderTabs();
        renderActiveTabIntoFrame();
        break;
      case 'tab:closed':
      case 'tab:status':
      case 'tab:duplicated':
      case 'tab:reordered':
        // Part 2: same "just refresh the strip" handling as close/status —
        // duplicating or reordering tabs never changes what the active
        // tab is showing, so there's nothing for the live <iframe> to do.
        scheduleRenderTabs();
        break;
      case 'bookmark:added':
      case 'bookmark:removed': {
        const t = activeTab();
        updateBookmarkIcon(t ? t.url : null);
        if (els.bookmarksPanel.style.display !== 'none') renderBookmarksPanel();
        break;
      }
      case 'history:cleared':
        if (els.historyPanel.style.display !== 'none') renderHistoryPanel();
        break;
      default:
        break;
    }
  }

  function init() {
    els.viewport = document.getElementById('axBrowserViewport');
    if (!els.viewport) return; // not on the browser page
    els.empty = document.getElementById('axBrowserEmptyState');
    els.frame = document.getElementById('axBrowserFrame');
    els.loading = document.getElementById('axBrowserLoading');
    els.blocked = document.getElementById('axBrowserBlocked');
    els.openExternal = document.getElementById('axBrowserOpenExternal');
    els.urlInput = document.getElementById('axBrowserUrlInput');
    els.tabsEl = document.getElementById('axBrowserTabs');
    els.bookmarksPanel = document.getElementById('axBrowserBookmarksPanel');
    els.historyPanel = document.getElementById('axBrowserHistoryPanel');
    els.bookmarkToggle = document.getElementById('axBrowserBookmarkToggle');

    if (!window.AxiomBrowserEngine) {
      console.error('AxiomBrowserEngine not loaded — include os/core/browser-engine.js before browser-live.js.');
      return;
    }
    engine = window.AxiomBrowserEngine;
    // engine.init() always creates a fresh, empty default session — do
    // this first so bookmarks/history/downloads are loaded and the
    // engine is fully initialized, then see whether a previous session
    // was persisted and should replace that empty default instead.
    const freshDefaultId = engine.init();
    const restored = tryRestoreLastSession();
    if (restored) {
      // Leave the fresh default session as-is rather than calling
      // engine.endSession() on it — it never got a tab (we restore
      // before calling newTab() below) so it's inert, and ending it
      // would leave the engine's own defaultSessionId bookkeeping
      // pointing at a deleted session. It is simply never used: this
      // renderer's sessionId now points at the restored session, and it
      // disappears on the next page load like the rest of in-memory
      // engine state.
      sessionId = restored.id;
      engine.setActiveSessionId(sessionId);
    } else {
      sessionId = freshDefaultId;
    }
    unsubscribe = engine.onChange(onEngineChange);

    // Delegated tab-strip click handler — wired ONCE, survives every
    // renderTabs() rebuild of the tab nodes underneath it. See the
    // perf-audit note on renderTabs()/scheduleRenderTabs() above.
    els.tabsEl.addEventListener('click', (e) => {
      const closeEl = e.target.closest('[data-close-tab]');
      if (closeEl) { closeTab(closeEl.dataset.closeTab); return; }
      const tabEl = e.target.closest('[data-tab-id]');
      if (tabEl) switchTab(tabEl.dataset.tabId);
    });

    document.getElementById('axBrowserUrlInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigate(e.target.value);
    });
    document.getElementById('axBrowserBack').addEventListener('click', goBack);
    document.getElementById('axBrowserForward').addEventListener('click', goForward);
    document.getElementById('axBrowserRefresh').addEventListener('click', refresh);
    document.getElementById('axBrowserNewTab').addEventListener('click', () => newTab());
    document.getElementById('axBrowserBookmarkToggle').addEventListener('click', toggleBookmark);
    document.getElementById('axBrowserBookmarksBtn').addEventListener('click', renderBookmarksPanel);
    document.getElementById('axBrowserHistoryBtn').addEventListener('click', renderHistoryPanel);

    window.addEventListener('beforeunload', () => {
      persistCurrentSession();
      if (unsubscribe) unsubscribe();
    });

    if (restored) {
      // A restored tab is already marked 'loaded'/'completed' by the
      // engine (see restoreSession() in browser-engine.js) — render it
      // straight away rather than re-navigating and spamming
      // history/loading events for pages the person already visited.
      renderTabs();
      renderActiveTabIntoFrame();
    } else {
      newTab();
    }
  }

  // Restores the last-saved session (if any) as a real, new engine
  // session — never mutates or overwrites an existing one (see
  // restoreSession() in browser-engine.js). Returns the restored session,
  // or null if nothing was persisted / persisted data was unusable.
  function tryRestoreLastSession() {
    try {
      const snapshot = engine.loadSessionSnapshot(SESSION_PERSIST_KEY);
      if (!snapshot) return null;
      return engine.restoreSession(snapshot);
    } catch (e) {
      return null; // corrupt/incompatible snapshot — start fresh, never throw
    }
  }

  // Saves the current session's tabs/metadata under the fixed key so the
  // next visit can restore it. Called on unload; also exposed below so a
  // future explicit "save session" action (or an auto-save timer) can
  // call it without duplicating this logic.
  function persistCurrentSession() {
    if (!engine || !sessionId) return false;
    return engine.persistSessionSnapshot(sessionId, SESSION_PERSIST_KEY);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================================
  // Milestone 5 — Browser Agent integration
  // ------------------------------------------------------------
  // Unchanged surface: everything below reuses the exact functions
  // above, now backed by the engine instead of local arrays.
  // ============================================================

  function getSnapshot() { return engine.getSnapshot(sessionId); }

  // ============================================================
  // Milestone 6 — Browser Agent upgrade
  // ------------------------------------------------------------
  // Downloads, reading mode, link/image extraction and page
  // summarization all read from the SAME active tab/iframe state
  // above — no second navigation model. Anything that needs to look
  // inside the embedded page (reading mode, extract-links,
  // extract-images) is wrapped in a try/catch: cross-origin iframes
  // throw on contentDocument access by design, and that is treated
  // as a normal, expected outcome (a "blocked" result), never
  // bypassed. This is the same security boundary the existing
  // "blocked embed" flow already respects. Downloads/bookmarks/
  // history now live in the engine (os/core/browser-engine.js)
  // rather than this file's own localStorage arrays.
  // ============================================================

  function recordDownload(entry) { return engine.recordDownload(entry); }
  function listDownloads(limit) { return engine.listDownloads(limit); }
  function clearDownloads() { return engine.clearDownloads(); }

  // Best-effort same-origin download observer: if the active iframe is
  // same-origin, watches for clicks on <a download> links so downloads the
  // person triggers by clicking inside the page are still recorded.
  function tryWatchDownloads() {
    try {
      var doc = els.frame && els.frame.contentDocument;
      if (!doc || doc.__axiomDownloadWatcher) return;
      doc.__axiomDownloadWatcher = true;
      doc.addEventListener('click', function (e) {
        var a = e.target && e.target.closest && e.target.closest('a[download]');
        if (a && a.href) recordDownload({ url: a.href, filename: a.getAttribute('download') || hostnameOf(a.href), source: 'page-click' });
      }, true);
    } catch (e) { /* cross-origin — cannot observe, and we don't try to bypass it */ }
  }

  // Reusable "reach into the active page" helper: returns the Document if
  // it's readable, or throws a clear, consistent error if it's blocked by
  // the browser's same-origin policy (never worked around).
  function activeDocument() {
    const t = activeTab();
    if (!t || !t.url) throw new Error('No page is open.');
    if (engine.isBlocked(t.id)) throw new Error('This page declined to be embedded, so its content is not accessible.');
    var doc;
    try { doc = els.frame.contentDocument; } catch (e) { doc = null; }
    if (!doc) throw new Error('This page is cross-origin — its content cannot be read from the embedding frame (browser security restriction, not bypassed).');
    return doc;
  }

  // "Reading mode": a lightweight readability pass — picks the largest
  // text-bearing container (article/main, else the biggest <p> cluster)
  // and returns clean title/text, same idea as browser reader modes.
  function readingMode() {
    var doc = activeDocument();
    var container = doc.querySelector('article') || doc.querySelector('main');
    if (!container) {
      var paragraphs = Array.from(doc.querySelectorAll('p'));
      var byParent = new Map();
      paragraphs.forEach(function (p) {
        var parent = p.parentElement;
        if (!parent) return;
        byParent.set(parent, (byParent.get(parent) || 0) + (p.textContent || '').length);
      });
      var best = null, bestLen = 0;
      byParent.forEach(function (len, parent) { if (len > bestLen) { bestLen = len; best = parent; } });
      container = best || doc.body;
    }
    var text = (container && container.innerText || container && container.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    return { title: doc.title || hostnameOf(activeTab().url), text: text, chars: text.length };
  }

  // "Summarize current page": an extractive summary (first N meaningful
  // sentences) built on top of reading mode's cleaned text — no external
  // model call required, so it works even with no AI backend configured.
  function summarizePage(opts) {
    opts = opts || {};
    var page = readingMode();
    var sentences = page.text.split(/(?<=[.!?])\s+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 40; });
    var maxSentences = opts.maxSentences || 5;
    var summary = sentences.slice(0, maxSentences).join(' ');
    return { title: page.title, url: activeTab().url, summary: summary || page.text.slice(0, 400), sourceChars: page.chars };
  }

  // "Extract links": every anchor on the active page, deduped, with text.
  function extractLinks(opts) {
    opts = opts || {};
    var doc = activeDocument();
    var seen = {};
    var out = [];
    Array.from(doc.querySelectorAll('a[href]')).forEach(function (a) {
      var href = a.href;
      if (!href || seen[href]) return;
      seen[href] = true;
      out.push({ url: href, text: (a.textContent || '').trim().slice(0, 200) });
      if (out.length >= (opts.limit || 200)) return;
    });
    return { url: activeTab().url, count: out.length, links: out.slice(0, opts.limit || 200) };
  }

  // "Extract images": every <img> on the active page, deduped by src.
  function extractImages(opts) {
    opts = opts || {};
    var doc = activeDocument();
    var seen = {};
    var out = [];
    Array.from(doc.querySelectorAll('img[src]')).forEach(function (img) {
      var src = img.src;
      if (!src || seen[src]) return;
      seen[src] = true;
      out.push({ url: src, alt: img.alt || '', width: img.naturalWidth || null, height: img.naturalHeight || null });
    });
    return { url: activeTab().url, count: out.length, images: out.slice(0, opts.limit || 200) };
  }

  function bookmarksList() { return engine.listBookmarks(); }
  function historyList(limit) { return engine.listHistory(limit); }
  function historyClear() { return engine.clearHistory(); }
  function isBlocked() { const t = activeTab(); return !!(t && engine.isBlocked(t.id)); }

  // Same-window callers (the Browser Agent runs on this exact page, e.g.
  // browser.html itself) can call this directly — no postMessage needed.
  window.AxiomBrowserLive = {
    navigate: navigate, goBack: goBack, goForward: goForward, refresh: refresh,
    newTab: newTab, switchTab: switchTab, closeTab: closeTab,
    search: search, toggleBookmark: toggleBookmark, getSnapshot: getSnapshot,
    // Milestone 6:
    bookmarksList: bookmarksList, historyList: historyList, historyClear: historyClear,
    recordDownload: recordDownload, listDownloads: listDownloads, clearDownloads: clearDownloads,
    readingMode: readingMode, summarizePage: summarizePage,
    extractLinks: extractLinks, extractImages: extractImages, isBlocked: isBlocked,
    // Milestone 7 (Block 2 / Step 5 / Part 2) — Navigation & Session Manager:
    stopLoading: stopLoading, duplicateTab: duplicateTab, reorderTab: reorderTab,
    // Block 2 / Step 5 / Part 3 — Session Persistence (Part E):
    saveSession: persistCurrentSession
  };

  // Cross-window callers (an OS shell page that embeds this page in a
  // workspace/window iframe) drive the SAME functions via postMessage.
  // Every command gets an explicit ack — {ok:true, snapshot} or
  // {ok:false, error} — so the Browser Agent reports what actually
  // happened instead of assuming success, and browser security
  // restrictions (a site refusing to be embedded) surface as the
  // existing "blocked" state in the snapshot rather than a crash.
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || msg.channel !== 'axiom-browser-command') return;
    if (!els.viewport) return; // this page hasn't finished init() yet

    var result;
    try {
      switch (msg.op) {
        case 'navigate':   navigate(msg.url); break;
        case 'search':     search(msg.query); break;
        case 'back':       goBack(); break;
        case 'forward':    goForward(); break;
        case 'refresh':    refresh(); break;
        case 'new-tab':    newTab(msg.url); break;
        case 'switch-tab': switchTab(msg.tabId); break;
        case 'close-tab':  closeTab(msg.tabId); break;
        case 'bookmark':   toggleBookmark(); break;
        case 'stop-loading': stopLoading(); break;
        case 'duplicate-tab': duplicateTab(msg.tabId); break;
        case 'reorder-tab': reorderTab(msg.tabId, msg.index); break;
        case 'save-session': persistCurrentSession(); break;
        // Milestone 6 — these return their own payload (links, text, …)
        // rather than just a nav snapshot, so it rides along under `data`.
        case 'bookmarks-list': result = { channel: 'axiom-browser-ack', id: msg.id, ok: true, snapshot: getSnapshot(), data: bookmarksList() }; break;
        case 'history-list':   result = { channel: 'axiom-browser-ack', id: msg.id, ok: true, snapshot: getSnapshot(), data: historyList(msg.limit) }; break;
        case 'history-clear':  historyClear(); result = { channel: 'axiom-browser-ack', id: msg.id, ok: true, snapshot: getSnapshot() }; break;
        case 'downloads-list': result = { channel: 'axiom-browser-ack', id: msg.id, ok: true, snapshot: getSnapshot(), data: listDownloads(msg.limit) }; break;
        case 'reading-mode':   result = { channel: 'axiom-browser-ack', id: msg.id, ok: true, snapshot: getSnapshot(), data: readingMode() }; break;
        case 'summarize-page': result = { channel: 'axiom-browser-ack', id: msg.id, ok: true, snapshot: getSnapshot(), data: summarizePage(msg) }; break;
        case 'extract-links':  result = { channel: 'axiom-browser-ack', id: msg.id, ok: true, snapshot: getSnapshot(), data: extractLinks(msg) }; break;
        case 'extract-images': result = { channel: 'axiom-browser-ack', id: msg.id, ok: true, snapshot: getSnapshot(), data: extractImages(msg) }; break;
        default: throw new Error('Unknown browser command "' + msg.op + '".');
      }
      result = result || { channel: 'axiom-browser-ack', id: msg.id, ok: true, snapshot: getSnapshot() };
    } catch (err) {
      result = { channel: 'axiom-browser-ack', id: msg.id, ok: false, error: String(err && err.message || err) };
    }
    if (e.source) { try { e.source.postMessage(result, '*'); } catch (err) { /* opener gone — non-fatal */ } }
  });
})();
