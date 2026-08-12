// ============================================================
// AXIOM — Block 2 / Step 5 / Part 6A: Browser Production Audit &
// Performance Optimization — regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/browser-engine.js and the real,
// updated os/core/browser-manager.js in a hand-rolled window/
// localStorage/URL shim (same VM-based pattern as the Part 1 / Part 2
// suites — see block2-step5-part1-browser-foundation-regression-suite.js).
// Exercises:
//   - The new diagnostics surface: health(), diagnostics(),
//     getPerformance(), getRuntimeInfo()
//   - That navigation timing samples are captured and bounded
//   - That in-flight navigation timers never leak on tab close
//   - That existing BrowserManager behavior (navigate/tabs/sessions/
//     metrics) is unchanged by the audit pass
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
    removeItem: (k) => { store.delete(k); }
  };
}

function loadStack() {
  const localStorage = makeLocalStorage();
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

  const engineSrc = fs.readFileSync(path.join(AI, 'os/core/browser-engine.js'), 'utf8');
  vm.runInContext(engineSrc, sandbox, { filename: 'browser-engine.js' });

  const managerSrc = fs.readFileSync(path.join(AI, 'os/core/browser-manager.js'), 'utf8');
  vm.runInContext(managerSrc, sandbox, { filename: 'browser-manager.js' });

  return sandbox.window;
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

// ---- health() / getRuntimeInfo() ------------------------------------
test('health() reports healthy when Engine + Sandbox are present, degraded when Sandbox is missing', () => {
  const win = loadStack();
  win.AxiomBrowserEngine.init();
  const bm = win.AxiomBrowserManager;
  const h = bm.health();
  assert.strictEqual(h.checks.engine, true);
  assert.strictEqual(h.checks.sandbox, false); // no AxiomBrowserSandbox loaded in this shim
  assert.strictEqual(h.status, 'degraded');
  assert.ok(typeof h.timestamp === 'number');
});

test('getRuntimeInfo() reports the bumped API version and engine/sandbox load state', () => {
  const win = loadStack();
  win.AxiomBrowserEngine.init();
  const info = win.AxiomBrowserManager.getRuntimeInfo();
  // Bumped 1.1.0 -> 1.2.0 in Part 6B (error-recovery hardening); see CHANGELOG.md.
  assert.strictEqual(info.apiVersion, '1.2.0');
  assert.strictEqual(info.engineLoaded, true);
  assert.strictEqual(info.sandboxLoaded, false);
  assert.ok(typeof info.uptimeMs === 'number' && info.uptimeMs >= 0);
  assert.ok(info.activeSessionId);
});

// ---- diagnostics() ----------------------------------------------------
test('diagnostics() reflects real active session/tab counts and zero in-flight navigations at rest', () => {
  const win = loadStack();
  win.AxiomBrowserEngine.init();
  const bm = win.AxiomBrowserManager;
  const before = bm.diagnostics();
  assert.strictEqual(before.activeSessions, 1);
  assert.strictEqual(before.inFlightNavigations, 0);

  bm.tabs.create();
  const after = bm.diagnostics();
  assert.strictEqual(after.activeTabs, before.activeTabs + 1);
});

// ---- getPerformance() — navigation timing sampling ---------------------
test('getPerformance() records a navigation duration sample on navigation:completed', () => {
  const win = loadStack();
  const engine = win.AxiomBrowserEngine;
  engine.init();
  const bm = win.AxiomBrowserManager;
  const sid = bm.sessions.getActiveSession().id;
  const tab = bm.tabs.getActive(sid) || bm.tabs.create(sid);
  const tabId = tab.id || tab;

  bm.navigate('example.com', { sessionId: sid, tabId });
  // Simulate the renderer settling the navigation, same as browser-live.js does.
  engine.reportLoaded(sid, tabId, { title: 'Example' });

  const perf = bm.getPerformance();
  assert.strictEqual(perf.navigation.sampleCount, 1);
  assert.ok(typeof perf.navigation.lastMs === 'number' && perf.navigation.lastMs >= 0);
  assert.strictEqual(perf.totalNavigations, 1);
  assert.strictEqual(perf.successRate, 100);
});

test('getPerformance() navigation sample buffer is capped and never grows unbounded', () => {
  const win = loadStack();
  const engine = win.AxiomBrowserEngine;
  engine.init();
  const bm = win.AxiomBrowserManager;
  const sid = bm.sessions.getActiveSession().id;
  const tab = bm.tabs.getActive(sid) || bm.tabs.create(sid);
  const tabId = tab.id || tab;

  for (let i = 0; i < 80; i++) {
    bm.navigate('example.com/' + i, { sessionId: sid, tabId });
    engine.reportLoaded(sid, tabId, { title: 'Example ' + i });
  }
  const perf = bm.getPerformance();
  assert.ok(perf.navigation.sampleCount <= 50, 'sample buffer must stay capped at 50');
});

// ---- Part C: no leaked in-flight navigation timers on tab close --------
test('closing a tab mid-navigation clears its in-flight timing entry (no leak)', () => {
  const win = loadStack();
  const engine = win.AxiomBrowserEngine;
  engine.init();
  const bm = win.AxiomBrowserManager;
  const sid = bm.sessions.getActiveSession().id;
  const tab = bm.tabs.create(sid);
  const tabId = tab.id || tab;

  bm.navigate('example.com', { sessionId: sid, tabId });
  // Tab closes before navigation ever settles (no reportLoaded/reportError).
  bm.tabs.close(sid, tabId);

  const diag = bm.diagnostics();
  assert.strictEqual(diag.inFlightNavigations, 0, 'navStartTimes must not retain a closed tab\'s entry');
});

// ---- existing behavior is unchanged ------------------------------------
test('existing navigate/back/forward/metrics behavior is unchanged by the audit pass', () => {
  const win = loadStack();
  const engine = win.AxiomBrowserEngine;
  engine.init();
  const bm = win.AxiomBrowserManager;
  const sid = bm.sessions.getActiveSession().id;
  const tab = bm.tabs.getActive(sid) || bm.tabs.create(sid);
  const tabId = tab.id || tab;

  const res = bm.navigate('example.com', { sessionId: sid, tabId });
  assert.strictEqual(res.ok, true);
  engine.reportLoaded(sid, tabId, { title: 'Example' });

  bm.navigate('/about', { sessionId: sid, tabId });
  engine.reportLoaded(sid, tabId, { title: 'About' });
  const backResult = bm.back(sid, tabId); // forwards Engine.goBack()'s real {url} shape
  assert.ok(backResult && backResult.url, 'back() should report the url it navigated to');
  assert.strictEqual(bm.getCurrentUrl(sid, tabId), 'https://example.com');

  const metrics = bm.getMetrics();
  // 2 explicit navigate() calls + 1 back() (goBack() is itself a
  // navigation:started event) = 3 total; only the 2 navigate() calls
  // were settled with reportLoaded(), so successfulNavigations stays 2.
  assert.strictEqual(metrics.totalNavigations, 3);
  assert.strictEqual(metrics.successfulNavigations, 2);
});

console.log('\n====================================================');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
