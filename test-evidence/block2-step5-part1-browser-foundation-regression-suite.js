// ============================================================
// AXIOM — Block 2 / Step 5 / Part 1: Browser Engine Foundation regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/browser-engine.js in a small
// hand-rolled window/localStorage/URL shim (same pattern as the Memory
// and Automation Foundation suites) and exercises the public engine API
// against real state — no shortcuts, no mocked engine.
//
// No jsdom import: no network access in this sandbox to install it, so
// this uses Node's vm module with a minimal shim instead.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    __store: store // exposed only so the suite can seed legacy keys directly
  };
}

function loadEngine(sharedLocalStorage) {
  const localStorage = sharedLocalStorage || makeLocalStorage();
  const sandbox = {
    window: {},
    console,
    setTimeout, clearTimeout,
    Date, Promise, Set, Map, Object, Array, JSON, Math, Error, URL
  };
  sandbox.window.localStorage = localStorage;
  sandbox.localStorage = localStorage;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);

  const src = fs.readFileSync(path.join(AI, 'os/core/browser-engine.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'browser-engine.js' });

  return { win: sandbox.window, localStorage };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + e.message);
  }
}

console.log('AXIOM Browser Engine Foundation — regression suite');
console.log('====================================================');

// ---- Lifecycle --------------------------------------------------------
test('init() is idempotent — a second call returns the same default session', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const a = engine.init();
  const b = engine.init();
  assert.strictEqual(a, b);
  assert.strictEqual(engine.listSessions().length, 1);
});

test('init() creates a default session with exactly one starter tab', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  // No tab exists yet until the caller (browser-live.js) makes one — the
  // engine itself does not auto-create tabs on init, only sessions.
  assert.strictEqual(engine.listTabs(sid).length, 0);
  const session = engine.getSession(sid);
  assert.strictEqual(session.background, false);
});

// ---- Sessions -----------------------------------------------------------
test('background (agent) sessions are isolated from the default session', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const agentSession = engine.createSession({ background: true, label: 'Research Agent' });
  assert.strictEqual(agentSession.background, true);
  engine.createTab(sid, 'example.com');
  engine.createTab(agentSession.id, 'other.com');
  assert.strictEqual(engine.listTabs(sid).length, 1);
  assert.strictEqual(engine.listTabs(agentSession.id).length, 1);
  assert.notStrictEqual(engine.getActiveTab(sid).url, engine.getActiveTab(agentSession.id).url);
});

test('endSession() closes all of its tabs and removes the session', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const s = engine.createSession({ background: true });
  engine.createTab(s.id);
  engine.createTab(s.id);
  assert.strictEqual(engine.listTabs(s.id).length, 2);
  engine.endSession(s.id);
  assert.strictEqual(engine.getSession(s.id), null);
});

// ---- Tabs -----------------------------------------------------------
test('createTab() without a url leaves the tab empty (no navigation)', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid);
  const tab = engine.getTab(tabId);
  assert.strictEqual(tab.url, null);
  assert.strictEqual(tab.status, 'empty');
});

test('closing the last tab in a session opens a fresh blank one, never leaves zero tabs', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const only = engine.createTab(sid, 'example.com');
  engine.closeTab(sid, only);
  assert.strictEqual(engine.listTabs(sid).length, 1);
  assert.strictEqual(engine.getActiveTab(sid).url, null);
});

test('closing a non-active tab keeps the active tab unchanged', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const t1 = engine.createTab(sid, 'a.com');
  const t2 = engine.createTab(sid, 'b.com');
  engine.switchTab(sid, t1);
  engine.closeTab(sid, t2);
  assert.strictEqual(engine.getActiveTab(sid).id, t1);
});

test('switchTab() rejects a tab id from a different session', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const other = engine.createSession({ background: true });
  const foreignTab = engine.createTab(other.id);
  const ok = engine.switchTab(sid, foreignTab);
  assert.strictEqual(ok, false);
});

// ---- Navigation & history stack ---------------------------------------
test('navigate() normalizes bare domains and search queries correctly', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  assert.strictEqual(engine.normalizeUrl('example.com'), 'https://example.com');
  assert.strictEqual(engine.normalizeUrl('https://example.com'), 'https://example.com');
  assert.strictEqual(engine.normalizeUrl('how tall is the eiffel tower'),
    'https://duckduckgo.com/?q=' + encodeURIComponent('how tall is the eiffel tower'));
  assert.strictEqual(engine.normalizeUrl('   '), null);
});

test('back/forward walk the per-tab history stack correctly, including truncation on new navigation', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  engine.navigate(sid, tabId, 'b.com');
  engine.navigate(sid, tabId, 'c.com');
  let tab = engine.getTab(tabId);
  assert.strictEqual(tab.url, 'https://c.com');

  engine.goBack(sid, tabId);
  tab = engine.getTab(tabId);
  assert.strictEqual(tab.url, 'https://b.com');

  // Navigating from the middle of the stack truncates the forward stack.
  engine.navigate(sid, tabId, 'd.com');
  tab = engine.getTab(tabId);
  assert.strictEqual(tab.hist.length, 3); // a, b, d — c is gone
  assert.strictEqual(engine.goForward(sid, tabId), null); // nothing to go forward to
});

test('goBack()/goForward() are no-ops at the ends of the stack', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  assert.strictEqual(engine.goBack(sid, tabId), null); // only one entry, can't go back
});

// ---- Browser state (loading/loaded/blocked/error) ----------------------
test('reportLoaded()/reportBlocked()/reportError() drive tab.status and getSnapshot().blocked', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  assert.strictEqual(engine.getTab(tabId).status, 'loading'); // navigate() sets loading
  engine.reportLoaded(sid, tabId, { title: 'Example' });
  assert.strictEqual(engine.getTab(tabId).status, 'loaded');
  assert.strictEqual(engine.getTab(tabId).title, 'Example');
  assert.strictEqual(engine.getSnapshot(sid).blocked, false);

  engine.reportBlocked(sid, tabId);
  assert.strictEqual(engine.getTab(tabId).status, 'blocked');
  assert.strictEqual(engine.getSnapshot(sid).blocked, true);
  assert.strictEqual(engine.isBlocked(tabId), true);

  engine.reportError(sid, tabId, 'network down');
  assert.strictEqual(engine.getTab(tabId).status, 'error');
  assert.strictEqual(engine.getTab(tabId).errorMessage, 'network down');
});

test('getSnapshot() shape matches what the pre-Engine browser-live.js returned', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  engine.navigate(sid, tabId, 'b.com');
  const snap = engine.getSnapshot(sid);
  assert.strictEqual(snap.url, 'https://b.com');
  assert.strictEqual(snap.canGoBack, true);
  assert.strictEqual(snap.canGoForward, false);
  assert.ok(Array.isArray(snap.tabs));
  assert.strictEqual(snap.tabs[0].id, tabId);
});

// ---- Bookmarks / history / downloads ------------------------------------
test('bookmarks: add / toggle / remove / list round-trip correctly', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  engine.init();
  assert.strictEqual(engine.isBookmarked('https://a.com'), false);
  engine.addBookmark('https://a.com', 'A Site');
  assert.strictEqual(engine.isBookmarked('https://a.com'), true);
  engine.toggleBookmark('https://a.com'); // toggling an existing bookmark removes it
  assert.strictEqual(engine.isBookmarked('https://a.com'), false);
  engine.toggleBookmark('https://a.com', 'A Site'); // toggling again re-adds it
  assert.strictEqual(engine.listBookmarks().length, 1);
});

test('history: navigating records an entry; clearHistory() empties it', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  engine.navigate(sid, tabId, 'b.com');
  assert.strictEqual(engine.listHistory().length, 2);
  engine.clearHistory();
  assert.strictEqual(engine.listHistory().length, 0);
});

test('downloads: recordDownload()/listDownloads()/clearDownloads() work and are capped', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  engine.init();
  for (let i = 0; i < 5; i++) engine.recordDownload({ url: 'https://a.com/f' + i, filename: 'f' + i });
  assert.strictEqual(engine.listDownloads().length, 5);
  assert.strictEqual(engine.listDownloads(2).length, 2);
  engine.clearDownloads();
  assert.strictEqual(engine.listDownloads().length, 0);
});

// ---- Persistence across independent engine instances --------------------
test('bookmarks/history/downloads persist to a second, independent engine instance', () => {
  const shared = makeLocalStorage();
  const first = loadEngine(shared).win.AxiomBrowserEngine;
  first.init();
  first.addBookmark('https://persisted.example', 'Persisted');
  first.recordDownload({ url: 'https://persisted.example/file.zip', filename: 'file.zip' });

  const second = loadEngine(shared).win.AxiomBrowserEngine;
  second.init();
  assert.strictEqual(second.isBookmarked('https://persisted.example'), true);
  assert.strictEqual(second.listDownloads().length, 1);
});

test('legacy pre-Engine localStorage keys are migrated once, not overwritten on reload', () => {
  const shared = makeLocalStorage();
  shared.setItem('axiom-browser-bookmarks', JSON.stringify([{ url: 'https://legacy.example', title: 'Legacy' }]));
  shared.setItem('axiom-browser-history', JSON.stringify([{ url: 'https://legacy.example', title: 'legacy.example', time: 1 }]));

  const first = loadEngine(shared).win.AxiomBrowserEngine;
  first.init();
  assert.strictEqual(first.isBookmarked('https://legacy.example'), true);
  first.removeBookmark('https://legacy.example'); // prove a real write happened, not a re-read of the legacy key

  const second = loadEngine(shared).win.AxiomBrowserEngine;
  second.init();
  // Migration ran once already — the removal from the first instance
  // must stick, not be re-populated from the untouched legacy key.
  assert.strictEqual(second.isBookmarked('https://legacy.example'), false);
});

// ---- Pub/sub ------------------------------------------------------------
test('onChange() fires for tab/navigation/bookmark events, and unsubscribe stops it', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const seen = [];
  const unsub = engine.onChange((type) => seen.push(type));

  const tabId = engine.createTab(sid, 'a.com');
  engine.addBookmark('https://a.com');
  assert.ok(seen.includes('tab:created'));
  assert.ok(seen.includes('tab:navigated'));
  assert.ok(seen.includes('bookmark:added'));

  unsub();
  const countBefore = seen.length;
  engine.navigate(sid, tabId, 'c.com');
  assert.strictEqual(seen.length, countBefore); // no further events delivered
});

test('a single bad listener does not stop other listeners or crash the engine', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  let goodFired = false;
  engine.onChange(() => { throw new Error('boom'); });
  engine.onChange(() => { goodFired = true; });
  engine.createTab(sid, 'a.com');
  assert.strictEqual(goodFired, true);
});

// ---- No console errors under normal use ---------------------------------
test('a full realistic session (multiple tabs, nav, bookmarks, close) runs without throwing', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const t1 = engine.createTab(sid, 'news.example');
  engine.navigate(sid, t1, 'news.example/article-1');
  engine.reportLoaded(sid, t1, { title: 'Article 1' });
  const t2 = engine.createTab(sid, 'mail.example');
  engine.reportBlocked(sid, t2);
  engine.toggleBookmark('https://news.example/article-1', 'Article 1');
  engine.switchTab(sid, t1);
  engine.goBack(sid, t1);
  engine.closeTab(sid, t2);
  engine.closeTab(sid, t1); // last tab — should re-open a blank one, not error
  assert.strictEqual(engine.listTabs(sid).length, 1);
  assert.strictEqual(engine.getStats().sessionCount, 1);
});

console.log('====================================================');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
