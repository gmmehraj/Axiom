// ============================================================
// AXIOM AI OS — Milestone 5: Browser Agent Bridge
// ------------------------------------------------------------
// Connects the Browser Agent to the REAL Browser Workspace built
// in browser-live.js. Two cases, both reusing the exact same
// browser-live.js logic (no duplicate navigation/tab code):
//
//   1. This script and browser-live.js are loaded on the SAME
//      page (e.g. the Browser Agent runs directly on browser.html)
//      -> call window.AxiomBrowserLive's methods directly.
//   2. The Browser Workspace is embedded elsewhere as an iframe
//      (os/workspaces/browser.js, or a WindowManager window that
//      points at browser.html) -> talk to it over postMessage using
//      the command bridge browser-live.js exposes, opening the
//      workspace first via AxiomOS.openWorkspace('browser') if it
//      isn't open yet.
//
// If neither is available, or the frame never responds, callers get
// a rejected promise with a clear message — the Browser Agent turns
// that into a graceful, non-crashing fallback result rather than
// trying to bypass whatever stopped it (e.g. an embedding policy).
//
// Public surface — window.AxiomBrowserBridge:
//   .navigate(url) .search(query) .back() .forward() .refresh()
//   .newTab(url?) .switchTab(id) .closeTab(id)
//   .command(op, params) -> Promise<snapshot>
// ============================================================
window.AxiomBrowserBridge = (function () {
  'use strict';

  var ACK_TIMEOUT_MS = 6000;
  var OPEN_WAIT_MS = 4000;
  var seq = 0;

  function findFrame() {
    var frames = document.querySelectorAll('iframe[src*="browser.html"]');
    // Prefer the most recently added one (last in DOM order) — that's
    // whichever browser window/workspace the person opened most recently.
    return frames.length ? frames[frames.length - 1] : null;
  }

  function waitForFrame(timeoutMs) {
    return new Promise(function (resolve, reject) {
      var existing = findFrame();
      if (existing) { resolve(existing); return; }
      var start = Date.now();
      var timer = setInterval(function () {
        var f = findFrame();
        if (f) { clearInterval(timer); resolve(f); return; }
        if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error('Browser Workspace did not open in time.')); }
      }, 100);
    });
  }

  function ensureOpen() {
    var f = findFrame();
    if (f) return Promise.resolve(f);
    try {
      if (window.AxiomOS && typeof window.AxiomOS.openWorkspace === 'function') {
        window.AxiomOS.openWorkspace('browser');
      }
    } catch (e) { /* fall through to waitForFrame — it will just time out */ }
    return waitForFrame(OPEN_WAIT_MS);
  }

  function viaPostMessage(op, params) {
    return ensureOpen().then(function (frame) {
      return new Promise(function (resolve, reject) {
        var target = frame.contentWindow;
        if (!target) { reject(new Error('Browser frame has no window to message.')); return; }

        var id = 'bcmd-' + (++seq) + '-' + Date.now().toString(36);
        var timer = setTimeout(function () {
          window.removeEventListener('message', onAck);
          reject(new Error('Browser Agent "' + op + '" timed out waiting for the browser workspace to respond.'));
        }, ACK_TIMEOUT_MS);

        function onAck(e) {
          var msg = e.data;
          if (!msg || msg.channel !== 'axiom-browser-ack' || msg.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener('message', onAck);
          if (msg.ok) resolve(msg.data !== undefined ? { snapshot: msg.snapshot || {}, data: msg.data } : (msg.snapshot || {}));
          else reject(new Error(msg.error || ('Browser Agent "' + op + '" failed.')));
        }
        window.addEventListener('message', onAck);

        try {
          target.postMessage(Object.assign({ channel: 'axiom-browser-command', id: id, op: op }, params || {}), '*');
        } catch (err) {
          clearTimeout(timer);
          window.removeEventListener('message', onAck);
          reject(err);
        }
      });
    });
  }

  function command(op, params) {
    params = params || {};
    var bm = window.AxiomBrowserManager || window.BrowserManager;
    var live = window.AxiomBrowserLive;

    if (bm) {
      return Promise.resolve().then(function () {
        switch (op) {
          case 'navigate': return bm.navigate(params.url, params);
          case 'search': return bm.navigate(params.query, params);
          case 'back': return { ok: bm.back(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
          case 'forward': return { ok: bm.forward(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
          case 'refresh': return { ok: bm.refresh(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
          case 'stop-loading': return { ok: bm.stop(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
          case 'new-tab': return { tab: bm.tabs.create(params.sessionId, params.url), snapshot: bm.getSnapshot() };
          case 'switch-tab': return { ok: bm.tabs.switch(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
          case 'close-tab': return { ok: bm.tabs.close(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
          case 'duplicate-tab': return { tab: bm.tabs.duplicate(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
          case 'reorder-tab': return { ok: bm.tabs.reorder(params.sessionId, params.tabId, params.index), snapshot: bm.getSnapshot() };
          case 'history-list': return { snapshot: bm.getSnapshot(), data: bm.history.readHistory({ limit: params.limit }).history };
          case 'history-clear': return { ok: bm.history.clearHistory(), snapshot: bm.getSnapshot() };
          default:
            if (live) {
              return commandLiveFallback(op, params, live);
            }
            return bm.executeBrowserOp(op, params);
        }
      });
    }

    if (live) {
      return Promise.resolve().then(function () { return commandLiveFallback(op, params, live); });
    }

    return viaPostMessage(op, params);
  }

  function commandLiveFallback(op, params, live) {
    switch (op) {
      case 'navigate':   live.navigate(params.url); break;
      case 'search':     live.search(params.query); break;
      case 'back':       live.goBack(); break;
      case 'forward':    live.goForward(); break;
      case 'refresh':    live.refresh(); break;
      case 'new-tab':    live.newTab(params.url); break;
      case 'switch-tab': live.switchTab(params.tabId); break;
      case 'close-tab':  live.closeTab(params.tabId); break;
      case 'bookmark':   live.toggleBookmark(); break;
      case 'stop-loading':  live.stopLoading(); break;
      case 'duplicate-tab': live.duplicateTab(params.tabId); break;
      case 'reorder-tab':   live.reorderTab(params.tabId, params.index); break;
      case 'bookmarks-list': return { snapshot: live.getSnapshot(), data: live.bookmarksList() };
      case 'history-list':   return { snapshot: live.getSnapshot(), data: live.historyList(params.limit) };
      case 'history-clear':  live.historyClear(); break;
      case 'downloads-list': return { snapshot: live.getSnapshot(), data: live.listDownloads(params.limit) };
      case 'reading-mode':   return { snapshot: live.getSnapshot(), data: live.readingMode() };
      case 'summarize-page': return { snapshot: live.getSnapshot(), data: live.summarizePage(params) };
      case 'extract-links':  return { snapshot: live.getSnapshot(), data: live.extractLinks(params) };
      case 'extract-images': return { snapshot: live.getSnapshot(), data: live.extractImages(params) };
      case 'detect-blocked': return { snapshot: live.getSnapshot(), data: { blocked: live.isBlocked() } };
      default: throw new Error('Unknown browser command "' + op + '".');
    }
    return live.getSnapshot();
  }

  return {
    command: command,
    navigate:  function (url) { return command('navigate', { url: url }); },
    search:    function (query) { return command('search', { query: query }); },
    back:      function () { return command('back'); },
    forward:   function () { return command('forward'); },
    refresh:   function () { return command('refresh'); },
    newTab:    function (url) { return command('new-tab', { url: url }); },
    switchTab: function (tabId) { return command('switch-tab', { tabId: tabId }); },
    closeTab:  function (tabId) { return command('close-tab', { tabId: tabId }); },
    // Block 2 / Step 5 / Part 2 (Navigation & Session Manager):
    stopLoading:  function () { return command('stop-loading'); },
    duplicateTab: function (tabId) { return command('duplicate-tab', { tabId: tabId }); },
    reorderTab:   function (tabId, index) { return command('reorder-tab', { tabId: tabId, index: index }); },
    // Milestone 6:
    bookmarksList: function () { return command('bookmarks-list'); },
    historyList:   function (limit) { return command('history-list', { limit: limit }); },
    historyClear:  function () { return command('history-clear'); },
    downloadsList: function (limit) { return command('downloads-list', { limit: limit }); },
    readingMode:   function () { return command('reading-mode'); },
    summarizePage: function (opts) { return command('summarize-page', opts); },
    extractLinks:  function (opts) { return command('extract-links', opts); },
    extractImages: function (opts) { return command('extract-images', opts); },
    detectBlocked: function () { return command('detect-blocked'); }
  };
})();
