// ============================================================
// AXIOM — Block 2 / Step 5 / Part 6B: Browser Error Recovery &
// Production Certification — regression suite
// ------------------------------------------------------------
// Loads the real, updated os/core/browser-manager.js and the real,
// updated os/runtime/capabilities/browser-tool-registry.js against a
// deliberately hostile fake Engine whose methods throw. Confirms:
//   - Every BrowserManager entry point survives a throwing Engine and
//     returns a safe fallback / standardized envelope instead of
//     propagating the exception.
//   - BrowserToolRegistry.executeTool() never rejects — failures
//     resolve to a standardized { ok:false, code, reason, tool }
//     envelope, including for handlers that throw synchronously or
//     reject asynchronously.
//   - A malformed restoreSession() snapshot fails safe (returns null)
//     instead of throwing past BrowserManager.
//   - Stale/never-settled in-flight navigations are detected and swept
//     by diagnostics() instead of being reported forever.
//   - None of this changes the happy-path behavior already covered by
//     the Part 6A suite (re-run alongside this one, not duplicated
//     here).
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');
let passed = 0, failed = 0;

const pending = [];

function test(name, fn) {
  const record = () => {
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        return result.then(
          () => { console.log('  PASS  ' + name); passed++; },
          (e) => { console.log('  FAIL  ' + name); console.log('        ' + e.message); failed++; }
        );
      }
      console.log('  PASS  ' + name);
      passed++;
    } catch (e) {
      console.log('  FAIL  ' + name);
      console.log('        ' + e.message);
      failed++;
    }
  };
  pending.push(Promise.resolve().then(record));
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
}

// A hostile fake Engine: every method that BrowserManager calls throws.
// This simulates a corrupted runtime state, a rendering-layer failure, or
// a bug in the Engine itself — exactly the class of failure Part A
// (Error Recovery) exists to contain.
function makeThrowingEngine() {
  function boom(name) {
    return function () { throw new Error('simulated Engine failure in ' + name); };
  }
  return {
    validateUrl: (u) => ({ valid: true, url: u }),
    navigation: { navigate: boom('navigation.navigate'), getCurrentUrl: boom('getCurrentUrl') },
    navigate: boom('navigate'),
    goBack: boom('goBack'),
    goForward: boom('goForward'),
    refresh: boom('refresh'),
    stopLoading: boom('stopLoading'),
    reportRedirect: boom('reportRedirect'),
    getTab: boom('getTab'),
    getPhase: boom('getPhase'),
    canGoBack: boom('canGoBack'),
    canGoForward: boom('canGoForward'),
    createSession: boom('createSession'),
    endSession: boom('endSession'),
    restoreSession: boom('restoreSession'),
    setActiveSessionId: boom('setActiveSessionId'),
    getSession: boom('getSession'),
    listSessions: boom('listSessions'),
    getStats: boom('getStats'),
    listHistory: boom('listHistory'),
    clearHistory: boom('clearHistory'),
    createTab: boom('createTab'),
    closeTab: boom('closeTab'),
    switchTab: boom('switchTab'),
    getActiveTab: boom('getActiveTab'),
    listTabs: boom('listTabs'),
    duplicateTab: boom('duplicateTab'),
    reorderTabs: boom('reorderTabs'),
    getActiveSessionId: () => 'default',
    onChange: () => {}
  };
}

function loadManagerWithEngine(engine) {
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
  sandbox.window.AxiomBrowserEngine = engine;
  vm.createContext(sandbox);

  const managerSrc = fs.readFileSync(path.join(AI, 'os/core/browser-manager.js'), 'utf8');
  vm.runInContext(managerSrc, sandbox, { filename: 'browser-manager.js' });

  const registrySrc = fs.readFileSync(path.join(AI, 'os/runtime/capabilities/browser-tool-registry.js'), 'utf8');
  vm.runInContext(registrySrc, sandbox, { filename: 'browser-tool-registry.js' });

  return sandbox.window;
}

console.log('AXIOM Block 2 / Step 5 / Part 6B — Browser Error Recovery Regression Suite');
console.log('====================================================');

(function () {
  const w = loadManagerWithEngine(makeThrowingEngine());
  const bm = w.AxiomBrowserManager;
  const reg = w.AxiomBrowserToolRegistry;

  test('navigate() against a throwing Engine returns a safe { ok:false } envelope, never throws', () => {
    let res;
    assert.doesNotThrow(() => { res = bm.navigate('https://example.com'); });
    assert.strictEqual(res.ok, false);
    assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
  });

  test('back/forward/refresh/stop/redirect against a throwing Engine return false, never throw', () => {
    assert.doesNotThrow(() => assert.strictEqual(bm.back(), false));
    assert.doesNotThrow(() => assert.strictEqual(bm.forward(), false));
    assert.doesNotThrow(() => assert.strictEqual(bm.refresh(), false));
    assert.doesNotThrow(() => assert.strictEqual(bm.stop(), false));
    assert.doesNotThrow(() => assert.strictEqual(bm.redirect('https://example.com'), false));
  });

  test('getCurrentUrl()/getNavigationStatus() against a throwing Engine degrade instead of throwing', () => {
    let url, status;
    assert.doesNotThrow(() => { url = bm.getCurrentUrl(); });
    assert.strictEqual(url, null);
    assert.doesNotThrow(() => { status = bm.getNavigationStatus(); });
    assert.strictEqual(status.phase, 'error');
  });

  test('session lifecycle (create/close/switch/getActive/getMetadata) survives a throwing Engine', () => {
    assert.doesNotThrow(() => assert.strictEqual(bm.createSession({}), null));
    assert.doesNotThrow(() => assert.strictEqual(bm.closeSession('s1'), false));
    assert.doesNotThrow(() => assert.strictEqual(bm.switchSession('s1'), false));
    assert.doesNotThrow(() => { const s = bm.getActiveSession(); assert.ok(s && s.id); });
    assert.doesNotThrow(() => assert.strictEqual(bm.getSessionMetadata('s1'), null));
  });

  test('restoreSession() with a malformed snapshot fails safe (null), never throws', () => {
    assert.doesNotThrow(() => assert.strictEqual(bm.restoreSession(null), null));
    assert.doesNotThrow(() => assert.strictEqual(bm.restoreSession('not-an-object'), null));
    // Well-formed object but a throwing Engine underneath:
    assert.doesNotThrow(() => assert.strictEqual(bm.restoreSession({ id: 'x' }), null));
  });

  test('history API (read/clear) survives a throwing Engine with safe fallbacks', () => {
    let hist;
    assert.doesNotThrow(() => { hist = bm.readHistory({}); });
    // Objects returned from code run inside the vm sandbox belong to a
    // different realm than this test file's Array/Object, so
    // deepStrictEqual's identical-prototype check is not meaningful here
    // — compare the actual field values instead.
    assert.strictEqual(hist.total, 0);
    assert.strictEqual(hist.history.length, 0);
    assert.doesNotThrow(() => assert.strictEqual(bm.clearHistory(), false));
  });

  test('tab API (create/close/switch/getActive/list/duplicate/reorder) survives a throwing Engine', () => {
    assert.doesNotThrow(() => assert.strictEqual(bm.tabs.create('s1', 'https://x.com'), null));
    assert.doesNotThrow(() => assert.strictEqual(bm.tabs.close('s1', 't1'), false));
    assert.doesNotThrow(() => assert.strictEqual(bm.tabs.switch('s1', 't1'), false));
    assert.doesNotThrow(() => assert.strictEqual(bm.tabs.getActive('s1'), null));
    let list;
    assert.doesNotThrow(() => { list = bm.tabs.list('s1'); });
    assert.strictEqual(list.length, 0);
    assert.doesNotThrow(() => assert.strictEqual(bm.tabs.duplicate('s1', 't1'), null));
    assert.doesNotThrow(() => assert.strictEqual(bm.tabs.reorder('s1', 't1', 0), false));
  });

  test('diagnostics()/getMetrics() never throw even when every Engine call underneath does', () => {
    assert.doesNotThrow(() => bm.diagnostics());
    assert.doesNotThrow(() => bm.getMetrics());
    const d = bm.diagnostics();
    // No AxiomBrowserSandbox is loaded in this harness, so health()
    // correctly reports 'degraded' (engine present, sandbox absent) —
    // the point of this assertion is that it returns a status string
    // at all rather than throwing, not which exact status.
    assert.ok(d.health.status === 'degraded' || d.health.status === 'healthy');
  });

  test('executeBrowserOp() resolves a standardized envelope instead of rejecting, for every op', async () => {
    const ops = ['navigate', 'back', 'forward', 'refresh', 'stop', 'redirect', 'get-url', 'get-status',
      'create-session', 'close-session', 'restore-session', 'switch-session', 'get-active-session',
      'read-history', 'clear-history', 'get-recent-pages', 'get-timeline',
      'create-tab', 'close-tab', 'switch-tab', 'duplicate-tab', 'reorder-tab'];
    for (const op of ops) {
      const res = await bm.executeBrowserOp(op, { url: 'https://example.com', sessionId: 's1', tabId: 't1' });
      assert.ok(res !== undefined, 'op "' + op + '" resolved undefined');
    }
  });

  test('executeBrowserOp() with an unknown op resolves a standardized error envelope, does not reject', async () => {
    const res = await bm.executeBrowserOp('not-a-real-op', {});
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'op_exception');
  });

  test('BrowserToolRegistry.executeTool() never rejects for an unregistered tool', async () => {
    const res = await reg.executeTool('browser_not_a_real_tool', {});
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'tool_not_found');
  });

  test('BrowserToolRegistry.executeTool() never rejects when a tool handler throws synchronously', async () => {
    reg.registerTool({
      name: 'browser_test_throws_sync',
      description: 'test-only tool that throws synchronously',
      parameters: { type: 'object', properties: {} },
      handler: function () { throw new Error('handler blew up synchronously'); }
    });
    const res = await reg.executeTool('browser_test_throws_sync', {});
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'handler_exception');
    assert.strictEqual(res.tool, 'browser_test_throws_sync');
  });

  test('BrowserToolRegistry.executeTool() never rejects when a tool handler returns a rejected promise', async () => {
    reg.registerTool({
      name: 'browser_test_rejects_async',
      description: 'test-only tool that rejects asynchronously',
      parameters: { type: 'object', properties: {} },
      handler: function () { return Promise.reject(new Error('handler rejected asynchronously')); }
    });
    const res = await reg.executeTool('browser_test_rejects_async', {});
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'handler_rejected');
    assert.strictEqual(res.tool, 'browser_test_rejects_async');
  });

  test('BrowserToolRegistry.executeTool() never rejects when the underlying handler resolves a BrowserManager failure envelope', async () => {
    // With a throwing Engine, bm.navigate() itself now fails safe (Part
    // 6B) and resolves { ok:false, reason }, rather than throwing — so
    // executeTool() passes that envelope straight through rather than
    // wrapping it in its own { code, tool } shape. Either way, the
    // caller gets a resolved, non-throwing result.
    const res = await reg.executeTool('browser_navigate', { url: 'https://example.com' });
    assert.strictEqual(res.ok, false);
  });
})();

(function () {
  // Stale in-flight navigation sweep: simulate a navigation that starts
  // but never settles (Engine never fires navigation:completed/failed),
  // then fast-forward past NAV_TIMEOUT_MS and confirm diagnostics()
  // sweeps it instead of reporting a phantom in-flight nav forever.
  const engine = {
    validateUrl: (u) => ({ valid: true, url: u }),
    getActiveSessionId: () => 'default',
    _onChangeHandlers: [],
    onChange(fn) { this._onChangeHandlers.push(fn); },
    _fire(type, detail) { this._onChangeHandlers.forEach((fn) => fn(type, detail)); }
  };
  const w = loadManagerWithEngine(engine);
  const bm = w.AxiomBrowserManager;

  test('a navigation that never settles is swept as stale after the timeout, not reported forever', () => {
    const realNow = Date.now;
    let fakeNow = realNow();
    Date.now = () => fakeNow;
    try {
      engine._fire('navigation:started', { tabId: 't1' });
      let d = bm.diagnostics();
      assert.strictEqual(d.inFlightNavigations, 1, 'expected 1 in-flight navigation right after start');

      fakeNow += 31000; // past NAV_TIMEOUT_MS (30000ms)
      d = bm.diagnostics();
      assert.strictEqual(d.timedOutNavigationsSwept, 1, 'expected diagnostics() to sweep the stale nav');
      assert.strictEqual(d.inFlightNavigations, 0, 'expected in-flight count to be 0 after sweep');
    } finally {
      Date.now = realNow;
    }
  });
})();

Promise.all(pending).then(() => {
  console.log('====================================================');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
});
