// ============================================================
// AXIOM — Block 2 / Step 5 / Part 2: Navigation & Session Manager regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/browser-engine.js (post-Part-2) in
// the same Node vm sandbox pattern as the Part 1 suite, and exercises
// ONLY the capabilities Part 2 added: URL validation/safety, relative
// path resolution, stop-loading, redirect handling, the granular loading
// lifecycle, session active-tracking/metadata/serialize/restore/persist,
// tab duplicate/reorder, and history back/forward-stack + stats
// accessors — plus the namespaced engine.navigation / engine.sessions /
// engine.tabs / engine.history / engine.loadingLifecycle surfaces
// themselves. Part 1 behavior is covered by
// block2-step5-part1-browser-foundation-regression-suite.js, re-run
// alongside this one (see the bottom of this file) to prove no
// regression.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const AI = path.join(__dirname, '..');

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
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

console.log('AXIOM Navigation & Session Manager (Part 2) — regression suite');
console.log('====================================================');

// ---- Part A / E: URL validation & normalization ------------------------
test('validateUrl() rejects javascript:/data:/vbscript:/file: input outright', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd']
    .forEach(bad => {
      const r = engine.validateUrl(bad);
      assert.strictEqual(r.valid, false, bad + ' should be rejected');
      assert.strictEqual(r.reason, 'blocked-protocol');
    });
});

test('normalizeUrl() returns null for blocked protocols (never reaches the iframe)', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  assert.strictEqual(engine.normalizeUrl('javascript:alert(document.cookie)'), null);
});

test('a blocked-protocol navigate() is refused and does not touch tab state', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'example.com');
  const before = engine.getTab(tabId).url;
  const result = engine.navigate(sid, tabId, 'javascript:doSomethingBad()');
  assert.strictEqual(result, null);
  assert.strictEqual(engine.getTab(tabId).url, before); // unchanged
});

test('engine.navigation.navigate() returns a rich {ok,url,reason} result', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid);
  const good = engine.navigation.navigate(sid, tabId, 'example.com');
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.url, 'https://example.com');
  const bad = engine.navigation.navigate(sid, tabId, 'javascript:evil()');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, 'blocked-protocol');
});

test('relative paths resolve against the active tab\'s current origin', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'https://example.com/start');
  engine.navigate(sid, tabId, '/pricing');
  assert.strictEqual(engine.getTab(tabId).url, 'https://example.com/pricing');
});

test('a relative path with NO current page context falls through to a search query (unchanged Part 1 behavior)', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  // No contextUrl passed at all — plain normalizeUrl(input) call.
  const result = engine.normalizeUrl('/about');
  assert.strictEqual(result, 'https://duckduckgo.com/?q=' + encodeURIComponent('/about'));
});

test('plain normalizeUrl(input) with no second argument is byte-identical to Part 1 for ordinary input', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  assert.strictEqual(engine.normalizeUrl('example.com'), 'https://example.com');
  assert.strictEqual(engine.normalizeUrl('https://example.com'), 'https://example.com');
  assert.strictEqual(engine.normalizeUrl('   '), null);
});

// ---- Part F: Loading lifecycle ------------------------------------------
test('a normal navigation walks started -> connecting -> loading -> content-ready -> completed', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const seenPhases = [];
  engine.onChange((type, detail) => { if (type === 'lifecycle:phase') seenPhases.push(detail.phase); });
  const tabId = engine.createTab(sid, 'example.com');
  engine.reportLoaded(sid, tabId, { title: 'Example' });
  assert.deepStrictEqual(seenPhases, ['started', 'connecting', 'loading', 'content-ready', 'completed']);
  assert.strictEqual(engine.getPhase(tabId), 'completed');
});

test('reportError() and reportBlocked() both land on the "failed" phase', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const t1 = engine.createTab(sid, 'a.com');
  engine.reportError(sid, t1, 'boom');
  assert.strictEqual(engine.getPhase(t1), 'failed');
  const t2 = engine.createTab(sid, 'b.com');
  engine.reportBlocked(sid, t2);
  assert.strictEqual(engine.getPhase(t2), 'failed');
  assert.strictEqual(engine.getTab(t2).status, 'blocked'); // status still distinguishes WHY it failed
});

test('stopLoading() only works mid-flight and sets status/phase to cancelled', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  assert.strictEqual(engine.getTab(tabId).status, 'loading');
  const stopped = engine.stopLoading(sid, tabId);
  assert.strictEqual(stopped, true);
  assert.strictEqual(engine.getTab(tabId).status, 'cancelled');
  assert.strictEqual(engine.getPhase(tabId), 'cancelled');
  // Calling it again once already settled is a no-op.
  assert.strictEqual(engine.stopLoading(sid, tabId), false);
});

test('reportRedirect() updates the current history entry in place, not a new stack entry', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  const histLenBefore = engine.getTab(tabId).hist.length;
  engine.reportRedirect(sid, tabId, 'https://a.com/redirected');
  const tab = engine.getTab(tabId);
  assert.strictEqual(tab.url, 'https://a.com/redirected');
  assert.strictEqual(tab.hist.length, histLenBefore); // no new entry pushed
  assert.strictEqual(engine.getPhase(tabId), 'redirecting');
});

test('engine.loadingLifecycle exposes the phase list and getPhase()', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  assert.ok(engine.loadingLifecycle.phases.includes('content-ready'));
  assert.strictEqual(engine.loadingLifecycle.getPhase(tabId), 'loading');
});

// ---- Part C: Tab Manager additions ---------------------------------------
test('duplicateTab() copies url/title/history and lands next to the source tab', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const t1 = engine.createTab(sid, 'a.com');
  engine.reportLoaded(sid, t1, { title: 'A Site' });
  const t2 = engine.createTab(sid, 'b.com'); // now order is [t1, t2]
  const dup = engine.duplicateTab(sid, t1);
  const order = engine.listTabs(sid).map(t => t.id);
  assert.strictEqual(order[1], dup); // duplicate inserted right after its source
  assert.strictEqual(engine.getTab(dup).url, 'https://a.com');
  assert.strictEqual(engine.getTab(dup).title, 'A Site');
  assert.notStrictEqual(dup, t1); // it's a real distinct tab, not the same id
});

test('duplicateTab() across sessions is refused', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const other = engine.createSession({ background: true });
  const foreignTab = engine.createTab(other.id, 'x.com');
  assert.strictEqual(engine.duplicateTab(sid, foreignTab), null);
});

test('reorderTabs() moves a tab to a new index and clamps out-of-range indices', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const t1 = engine.createTab(sid, 'a.com');
  const t2 = engine.createTab(sid, 'b.com');
  const t3 = engine.createTab(sid, 'c.com');
  engine.reorderTabs(sid, t1, 2); // move first tab to the end
  assert.strictEqual(JSON.stringify(engine.listTabs(sid).map(t => t.id)), JSON.stringify([t2, t3, t1]));
  engine.reorderTabs(sid, t1, 999); // out of range -> clamps to last index
  assert.strictEqual(JSON.stringify(engine.listTabs(sid).map(t => t.id)), JSON.stringify([t2, t3, t1]));
});

// ---- Part B: Session Manager additions -----------------------------------
test('active session tracking is independent of each session\'s own active tab', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  assert.strictEqual(engine.getActiveSessionId(), sid); // init() makes the default session active
  const second = engine.createSession({ background: false, label: 'Second window' });
  assert.strictEqual(engine.getActiveSessionId(), sid); // creating another doesn't steal focus
  const ok = engine.setActiveSessionId(second.id);
  assert.strictEqual(ok, true);
  assert.strictEqual(engine.getActiveSessionId(), second.id);
  assert.strictEqual(engine.setActiveSessionId('not-a-real-id'), false); // unknown id refused
});

test('ending the active session falls back to another non-background session', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const second = engine.createSession({ label: 'Second' });
  engine.setActiveSessionId(second.id);
  engine.endSession(second.id);
  assert.strictEqual(engine.getActiveSessionId(), sid);
});

test('updateSessionMetadata() merges into a session\'s metadata without clobbering other keys', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const s = engine.createSession({ metadata: { purpose: 'research' } });
  engine.updateSessionMetadata(s.id, { topic: 'AXIOM browser' });
  const fresh = engine.getSession(s.id);
  assert.strictEqual(JSON.stringify(fresh.metadata), JSON.stringify({ purpose: 'research', topic: 'AXIOM browser' }));
});

test('serializeSession()/restoreSession() round-trip a session\'s tabs into a NEW session', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const t1 = engine.createTab(sid, 'a.com');
  engine.reportLoaded(sid, t1, { title: 'A' });
  engine.createTab(sid, 'b.com'); // creating a tab makes IT the active one
  engine.switchTab(sid, t1); // switch back — t1 ('a.com') is now deliberately the active tab
  const snapshot = engine.serializeSession(sid);
  assert.strictEqual(snapshot.tabs.length, 2);
  assert.strictEqual(snapshot.activeIndex, 0); // t1 is index 0 and is active

  const restored = engine.restoreSession(snapshot);
  assert.notStrictEqual(restored.id, sid); // a genuinely new session, original untouched
  assert.strictEqual(engine.listTabs(restored.id).length, 2);
  assert.strictEqual(engine.getActiveTab(restored.id).url, 'https://a.com'); // active tab correctly restored, not just tab order
  assert.strictEqual(engine.listTabs(sid).length, 2); // original session unaffected
});

test('restoring a session does not spam global history (no re-visit recorded)', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const t1 = engine.createTab(sid, 'a.com');
  const historyCountBefore = engine.listHistory().length;
  const snapshot = engine.serializeSession(sid);
  engine.restoreSession(snapshot);
  assert.strictEqual(engine.listHistory().length, historyCountBefore);
});

test('persistSessionSnapshot()/loadSessionSnapshot() round-trip through localStorage, independent of process', () => {
  const shared = makeLocalStorage();
  const first = loadEngine(shared).win.AxiomBrowserEngine;
  const sid = first.init();
  first.createTab(sid, 'persisted-tab.example');
  first.persistSessionSnapshot(sid, 'my-saved-session');

  const second = loadEngine(shared).win.AxiomBrowserEngine;
  second.init();
  const loaded = second.loadSessionSnapshot('my-saved-session');
  assert.ok(loaded);
  assert.strictEqual(loaded.tabs[0].url, 'https://persisted-tab.example');
  assert.ok(second.listPersistedSessionKeys().includes('my-saved-session'));
});

test('nothing is auto-persisted — a session is NOT saved unless persistSessionSnapshot() is explicitly called', () => {
  const shared = makeLocalStorage();
  const first = loadEngine(shared).win.AxiomBrowserEngine;
  const sid = first.init();
  first.createTab(sid, 'never-persisted.example');
  // Deliberately do not call persistSessionSnapshot().
  const second = loadEngine(shared).win.AxiomBrowserEngine;
  second.init();
  assert.strictEqual(second.listPersistedSessionKeys().length, 0);
});

// ---- Part D: History Manager additions -----------------------------------
test('getBackStack()/getForwardStack() reflect the real per-tab history position', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  engine.navigate(sid, tabId, 'b.com');
  engine.navigate(sid, tabId, 'c.com');
  assert.strictEqual(JSON.stringify(engine.getBackStack(tabId)), JSON.stringify(['https://a.com', 'https://b.com']));
  assert.strictEqual(JSON.stringify(engine.getForwardStack(tabId)), JSON.stringify([]));
  engine.goBack(sid, tabId);
  assert.strictEqual(JSON.stringify(engine.getBackStack(tabId)), JSON.stringify(['https://a.com']));
  assert.strictEqual(JSON.stringify(engine.getForwardStack(tabId)), JSON.stringify(['https://c.com']));
});

test('getHistoryStats() aggregates real visit counts per host', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid, 'a.com');
  engine.navigate(sid, tabId, 'a.com/page2');
  engine.navigate(sid, tabId, 'b.com');
  const stats = engine.getHistoryStats();
  assert.strictEqual(stats.totalVisits, 3);
  assert.strictEqual(stats.uniqueHosts, 2);
  assert.strictEqual(stats.visitsByHost['a.com'], 2);
  assert.strictEqual(stats.visitsByHost['b.com'], 1);
});

// ---- Namespaced manager surfaces mirror the flat API (no duplicate state) --
test('engine.tabs.* / engine.sessions.* / engine.history.* operate on the SAME state as the flat methods', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.tabs.create(sid, 'a.com');
  assert.strictEqual(engine.getTab(tabId).url, 'https://a.com'); // flat getter sees what the namespaced creator did
  engine.toggleBookmark('https://a.com');
  assert.strictEqual(engine.history.list().length, engine.listHistory().length);
  assert.strictEqual(engine.sessions.getDefault(), engine.getDefaultSessionId());
  assert.strictEqual(engine.tabs.list(sid).length, engine.listTabs(sid).length);
});

// ---- No duplicate events / no duplicate session or tab creation ---------
test('a single navigate() call emits exactly one tab:navigated and one navigation:started event', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const tabId = engine.createTab(sid); // no url yet, so no nav event from creation
  let navigatedCount = 0, startedCount = 0;
  engine.onChange((type) => {
    if (type === 'tab:navigated') navigatedCount++;
    if (type === 'navigation:started') startedCount++;
  });
  engine.navigate(sid, tabId, 'example.com');
  assert.strictEqual(navigatedCount, 1);
  assert.strictEqual(startedCount, 1);
});

test('init() called many times never creates more than one default session (no duplicate session creation)', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  for (let i = 0; i < 5; i++) engine.init();
  assert.strictEqual(engine.listSessions().filter(s => !s.background).length, 1);
});

// ---- No console errors under a realistic Part 2 workflow -----------------
test('a realistic multi-feature workflow (validate, navigate, redirect, duplicate, reorder, restore) runs without throwing', () => {
  const { win } = loadEngine();
  const engine = win.AxiomBrowserEngine;
  const sid = engine.init();
  const t1 = engine.createTab(sid, 'news.example');
  engine.reportRedirect(sid, t1, 'https://news.example/home');
  engine.reportLoaded(sid, t1, { title: 'News' });
  const dup = engine.duplicateTab(sid, t1);
  engine.reorderTabs(sid, dup, 0);
  const snap = engine.serializeSession(sid);
  const restored = engine.restoreSession(snap);
  engine.persistSessionSnapshot(restored.id, 'workflow-check');
  assert.strictEqual(engine.loadSessionSnapshot('workflow-check').tabs.length, engine.listTabs(restored.id).length);
  assert.strictEqual(engine.validateUrl('not javascript: this is just text').valid, true); // plain text, not a real js: uri, treated as a search
});

console.log('====================================================');
console.log(`${passed} passed, ${failed} failed`);

// Re-run the Part 1 suite as a regression gate — Part 2 must not have
// changed any Part 1 behavior. Failure here fails this whole suite.
console.log('');
console.log('Re-running Part 1 suite against the Part 2 engine file for regression...');
try {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'block2-step5-part1-browser-foundation-regression-suite.js')], { encoding: 'utf8' });
  console.log(out);
} catch (e) {
  failed++;
  console.log('  FAIL  Part 1 regression suite failed when run against the Part 2 engine file');
  console.log(e.stdout || e.message);
}

console.log('====================================================');
console.log(`TOTAL: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
