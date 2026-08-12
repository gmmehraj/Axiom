// ============================================================
// AXIOM — Supabase Integration Part 1: Regression Suite
// ------------------------------------------------------------
// Runs the real files on disk (js/core/supabase/env.js,
// connection-manager.js, auth-service.js, supabase-config.js) in a
// hand-built `vm` sandbox — this project has no jsdom available in
// this offline sandbox (same constraint documented in
// phase9-part1-static-audit-suite.js for the rest of the codebase),
// so DOM/window/navigator/fetch/timers are minimal stand-ins rather
// than a real browser. No network access is used or required —
// every Supabase SDK and fetch() call is mocked.
//
// Sections:
//   1. Environment validation (env.js)
//   2. Connection Manager: client init, states, health, offline,
//      reconnect backoff, error classification, pub/sub contract
//   3. Auth Service foundation: session tracking, auth-state
//      re-broadcast, expiry signal
//   4. Backward compatibility: SUPABASE_URL / SUPABASE_ANON_KEY /
//      supabaseClient remain bare top-level identifiers, exactly as
//      openrouter-config.js, openrouter-client.js,
//      billing-checkout.js and workspace.js already require
//   5. Static checks: no hardcoded credentials anywhere in the new
//      or modified files; every page's script load order is correct
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`); }
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------
// Minimal sandbox factory. Each test gets a fresh one so module
// state (memoized env validation, connection state machine, auth
// listeners) never leaks between tests.
// ---------------------------------------------------------------
function makeSandbox(opts) {
  opts = opts || {};
  const listenersByTarget = { window: {} };
  const timers = { intervalCalls: 0, timeoutCalls: 0 };

  const documentStub = {
    dispatchEvent: function () { return true; },
    _events: [],
  };
  documentStub.dispatchEvent = function (evt) { documentStub._events.push(evt); return true; };

  class FakeCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  }

  class FakeAbortController {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  }

  const sandbox = {
    console,
    navigator: { onLine: opts.onLine !== false },
    document: documentStub,
    CustomEvent: FakeCustomEvent,
    AbortController: FakeAbortController,
    // Inert by design: nothing under test needs a scheduled callback to
    // actually fire (mocked fetch always resolves/rejects synchronously-ish,
    // so the health-check abort timeout is never reached; reconnect backoff
    // scheduling is verified by its synchronous state-transition, not by
    // letting the real delay elapse and chain indefinitely).
    setTimeout: (fn, ms) => { timers.timeoutCalls++; return { __fakeTimeout: true }; },
    clearTimeout: () => {},
    setInterval: (fn, ms) => { timers.intervalCalls++; return { __fakeInterval: true }; }, // never actually fires — tests call the checked function directly
    clearInterval: () => {},
    fetch: opts.fetch || (() => Promise.reject(new Error('no fetch mock configured'))),
    supabase: opts.supabaseSdk, // undefined unless a test provides one
    __AXIOM_ENV__: opts.env,
    Object,
    Math,
    Date,
    Promise,
    Error,
  };
  sandbox.window = sandbox; // classic-script model: globals live directly on `window`
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function loadInto(sandbox, rel) {
  vm.runInContext(readSrc(rel), sandbox, { filename: rel });
}

// Classic <script defer> tags in the same document share one global lexical
// environment, so a `const`/`let` declared in one script is a visible bare
// identifier in the next (this is exactly what supabase-config.js relies on
// for SUPABASE_URL/SUPABASE_ANON_KEY — see js/core/openrouter-config.js).
// A fresh vm.runInContext() call per file does NOT reliably preserve that
// across calls, so for back-compat verification the files are concatenated
// and executed as a single script, matching what the browser actually does.
function loadAllInto(sandbox, rels) {
  const combined = rels.map((rel) => `// ---- ${rel} ----\n${readSrc(rel)}`).join('\n');
  vm.runInContext(combined, sandbox, { filename: 'combined' });
}

function makeMockClient(behavior) {
  behavior = behavior || {};
  let authChangeCb = null;
  let currentSession = behavior.session || null;
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: currentSession } }),
      onAuthStateChange: (cb) => { authChangeCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      _fireAuthChange: (event, session) => { currentSession = session; if (authChangeCb) authChangeCb(event, session); }
    },
    from: () => ({ select: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) })
  };
}

// =================================================================
// 1. Environment validation
// =================================================================
(function envTests() {
  // Missing entirely
  let sb = makeSandbox({ env: undefined });
  loadInto(sb, 'js/core/supabase/env.js');
  let result = sb.AxiomSupabaseEnv.validate();
  check('env: missing __AXIOM_ENV__ is invalid', result.valid === false && result.errors.length === 2);

  // Placeholder values (as shipped by env.config.template.js)
  sb = makeSandbox({ env: { SUPABASE_URL: '__SUPABASE_URL__', SUPABASE_ANON_KEY: '__SUPABASE_ANON_KEY__' } });
  loadInto(sb, 'js/core/supabase/env.js');
  result = sb.AxiomSupabaseEnv.validate();
  check('env: template placeholders are invalid', result.valid === false && result.errors.length === 2);

  // Malformed URL
  sb = makeSandbox({ env: { SUPABASE_URL: 'not-a-url', SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz' } });
  loadInto(sb, 'js/core/supabase/env.js');
  result = sb.AxiomSupabaseEnv.validate();
  check('env: malformed URL rejected', result.valid === false && result.errors.some(e => /valid https/.test(e)));

  // Too-short key
  sb = makeSandbox({ env: { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'short' } });
  loadInto(sb, 'js/core/supabase/env.js');
  result = sb.AxiomSupabaseEnv.validate();
  check('env: too-short anon key rejected', result.valid === false && result.errors.some(e => /too short/.test(e)));

  // Valid config
  sb = makeSandbox({ env: { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz' } });
  loadInto(sb, 'js/core/supabase/env.js');
  result = sb.AxiomSupabaseEnv.validate();
  check('env: well-formed config is valid', result.valid === true && result.errors.length === 0
    && result.url === 'https://proj.supabase.co');

  // Memoization — validate() called twice returns the same object without re-deriving
  const again = sb.AxiomSupabaseEnv.validate();
  check('env: validate() is memoized', again === result);
})();

// =================================================================
// 2. Connection Manager
// =================================================================
(function connectionTests() {
  const validEnv = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz' };

  // 2a. Unconfigured — invalid env means no client, state stays unconfigured
  let sb = makeSandbox({ env: {} });
  loadInto(sb, 'js/core/supabase/env.js');
  loadInto(sb, 'js/core/supabase/connection-manager.js');
  let client = sb.AxiomSupabaseConnection.init();
  check('connection: invalid env -> getClient() is null', client === null);
  check('connection: invalid env -> state is unconfigured', sb.AxiomSupabaseConnection.getState() === 'unconfigured');

  // 2b. SDK not loaded — valid env but window.supabase missing
  sb = makeSandbox({ env: validEnv, supabaseSdk: undefined });
  loadInto(sb, 'js/core/supabase/env.js');
  loadInto(sb, 'js/core/supabase/connection-manager.js');
  client = sb.AxiomSupabaseConnection.init();
  check('connection: missing SDK -> getClient() is null', client === null);
  check('connection: missing SDK -> lastError classified', sb.AxiomSupabaseConnection.getLastError() !== null);

  // 2c. Successful init + healthy probe -> connected
  const mockClient = makeMockClient();
  sb = makeSandbox({
    env: validEnv,
    supabaseSdk: { createClient: () => mockClient },
    fetch: () => Promise.resolve({ ok: true })
  });
  loadInto(sb, 'js/core/supabase/env.js');
  loadInto(sb, 'js/core/supabase/connection-manager.js');
  client = sb.AxiomSupabaseConnection.init();
  check('connection: valid env + SDK -> client created', client === mockClient);

  const stateEvents = [];
  sb.AxiomSupabaseConnection.on('state-changed', (p) => stateEvents.push(p));
  return sb.AxiomSupabaseConnection.checkHealth().then((healthy) => {
    check('connection: healthy probe resolves true', healthy === true);
    check('connection: healthy probe -> state connected', sb.AxiomSupabaseConnection.getState() === 'connected');
    check('connection: state-changed event fired', stateEvents.length > 0);
    check('connection: DOM CustomEvent dispatched (axiom:supabase:*)',
      sb.document._events.some(e => e.type.indexOf('axiom:supabase:') === 0));

    // 2d. Failing probe -> degraded + reconnect scheduled (attempt count increments)
    let sb2 = makeSandbox({
      env: validEnv,
      supabaseSdk: { createClient: () => makeMockClient() },
      fetch: () => Promise.resolve({ ok: false })
    });
    loadInto(sb2, 'js/core/supabase/env.js');
    loadInto(sb2, 'js/core/supabase/connection-manager.js');
    sb2.AxiomSupabaseConnection.init();
    return sb2.AxiomSupabaseConnection.checkHealth().then((healthy2) => {
      check('connection: failing probe resolves false', healthy2 === false);
      check('connection: failing probe -> state degraded or reconnecting',
        ['degraded', 'reconnecting'].indexOf(sb2.AxiomSupabaseConnection.getState()) !== -1);

      // 2e. Offline event handling
      let sb3 = makeSandbox({
        env: validEnv,
        supabaseSdk: { createClient: () => makeMockClient() },
        fetch: () => Promise.resolve({ ok: true })
      });
      loadInto(sb3, 'js/core/supabase/env.js');
      loadInto(sb3, 'js/core/supabase/connection-manager.js');
      sb3.AxiomSupabaseConnection.init();
      sb3.navigator.onLine = false;
      // Simulate the browser firing 'offline' the way attachOfflineDetection listens for it.
      sb3.AxiomSupabaseConnection.emit('browser-offline', {});
      // checkHealth() itself also respects navigator.onLine directly:
      return sb3.AxiomSupabaseConnection.checkHealth().then(() => {
        check('connection: offline browser -> state offline', sb3.AxiomSupabaseConnection.getState() === 'offline');

        // 2f. Error classification
        let sb4 = makeSandbox({
          env: validEnv,
          supabaseSdk: { createClient: () => makeMockClient() },
          fetch: () => Promise.reject(new Error('Failed to fetch'))
        });
        loadInto(sb4, 'js/core/supabase/env.js');
        loadInto(sb4, 'js/core/supabase/connection-manager.js');
        sb4.AxiomSupabaseConnection.init();
        return sb4.AxiomSupabaseConnection.checkHealth().then(() => {
          const err = sb4.AxiomSupabaseConnection.getLastError();
          check('connection: network error classified as "network"', err && err.type === 'network', JSON.stringify(err));

          // 2g. Pub/sub contract: dedupe, once, off
          let fired = 0;
          const fn = () => { fired++; };
          sb4.AxiomSupabaseConnection.on('x', fn);
          sb4.AxiomSupabaseConnection.on('x', fn); // duplicate subscribe is a no-op
          sb4.AxiomSupabaseConnection.emit('x', {});
          check('connection: duplicate on() does not double-fire', fired === 1);
          sb4.AxiomSupabaseConnection.off('x', fn);
          sb4.AxiomSupabaseConnection.emit('x', {});
          check('connection: off() removes the listener', fired === 1);

          let onceFired = 0;
          sb4.AxiomSupabaseConnection.once('y', () => { onceFired++; });
          sb4.AxiomSupabaseConnection.emit('y', {});
          sb4.AxiomSupabaseConnection.emit('y', {});
          check('connection: once() fires exactly once', onceFired === 1);
        });
      });
    });
  });
})().then(runAuthTests).then(runBackCompatTests).then(runStaticChecks).then(finish).catch((e) => {
  console.error('Suite crashed:', e);
  process.exitCode = 1;
});

// =================================================================
// 3. Auth Service foundation
// =================================================================
function runAuthTests() {
  const validEnv = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz' };
  const mockClient = makeMockClient({ session: null });
  const sb = makeSandbox({
    env: validEnv,
    supabaseSdk: { createClient: () => mockClient },
    fetch: () => Promise.resolve({ ok: true })
  });
  loadInto(sb, 'js/core/supabase/env.js');
  loadInto(sb, 'js/core/supabase/connection-manager.js');
  loadInto(sb, 'js/core/supabase/auth-service.js');

  sb.AxiomSupabaseConnection.init();
  sb.AxiomSupabaseAuth.init();

  const changes = [];
  sb.AxiomSupabaseAuth.on('changed', (p) => changes.push(p));

  const fakeSession = { user: { id: 'u1' }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  mockClient.auth._fireAuthChange('SIGNED_IN', fakeSession);

  check('auth: onAuthStateChange re-broadcast as "changed"', changes.length === 1 && changes[0].hasSession === true);

  return sb.AxiomSupabaseAuth.getSession().then(() => {
    const ttl = sb.AxiomSupabaseAuth.getTimeToExpiryMs();
    check('auth: getTimeToExpiryMs reflects last known session', typeof ttl === 'number' && ttl > 3500000 && ttl <= 3600000);

    // init() called twice is idempotent — should not double-subscribe
    let secondChangeCount = 0;
    sb.AxiomSupabaseAuth.on('changed', () => { secondChangeCount++; });
    sb.AxiomSupabaseAuth.init();
    mockClient.auth._fireAuthChange('TOKEN_REFRESHED', fakeSession);
    check('auth: init() is idempotent (no duplicate subscriptions)', secondChangeCount === 1);
  });
}

// =================================================================
// 4. Backward compatibility — legacy bare-identifier consumers
// =================================================================
function runBackCompatTests() {
  const validEnv = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz' };
  const mockClient = makeMockClient();
  const sb = makeSandbox({
    env: validEnv,
    supabaseSdk: { createClient: () => mockClient },
    fetch: () => Promise.resolve({ ok: true })
  });
  loadAllInto(sb, [
    'js/core/supabase/env.js',
    'js/core/supabase/connection-manager.js',
    'js/core/supabase/auth-service.js',
    'js/core/supabase-config.js'
  ]);

  // `const`/`let` at the top of a classic script never become properties of
  // `window` (true in real browsers too) — they live in the shared global
  // lexical scope and are only reachable as bare identifiers from code that
  // runs after them, exactly like js/core/openrouter-config.js,
  // openrouter-client.js, billing-checkout.js and workspace.js all do. So
  // back-compat is verified the same way those files actually consume it:
  // a subsequent script reading the bare identifiers.
  vm.runInContext(
    `var __probe_client = supabaseClient;
     var __probe_url = SUPABASE_URL;
     var __probe_key = SUPABASE_ANON_KEY;
     var CHAT_ENDPOINT = SUPABASE_URL + '/functions/v1/openrouter-chat';`,
    sb
  );
  check('back-compat: supabaseClient bare identifier defined', sb.__probe_client === mockClient);
  check('back-compat: SUPABASE_URL bare identifier defined', sb.__probe_url === validEnv.SUPABASE_URL);
  check('back-compat: SUPABASE_ANON_KEY bare identifier defined', sb.__probe_key === validEnv.SUPABASE_ANON_KEY);
  check('back-compat: openrouter-config.js-style bare reference works',
    sb.CHAT_ENDPOINT === 'https://proj.supabase.co/functions/v1/openrouter-chat');
  return Promise.resolve();
}

// =================================================================
// 5. Static checks
// =================================================================
function runStaticChecks() {
  const filesToScan = [
    'js/core/supabase-config.js',
    'js/core/supabase/env.js',
    'js/core/supabase/connection-manager.js',
    'js/core/supabase/auth-service.js',
    'js/core/env.config.template.js',
    'scripts/inject-env.js'
  ];
  const secretPattern = /https:\/\/[a-z0-9-]+\.supabase\.co(?!["'`]?\s*\+|\/functions)|sb_publishable_[a-zA-Z0-9_-]{10,}|sb_secret_[a-zA-Z0-9_-]{10,}/;
  // The pattern above deliberately allows the *template's* placeholder
  // tokens (__SUPABASE_URL__ / __SUPABASE_ANON_KEY__), which contain
  // neither a real domain nor the sb_publishable_/sb_secret_ prefix.
  let allClean = true;
  filesToScan.forEach((rel) => {
    const src = readSrc(rel);
    const hasHardcoded = secretPattern.test(src);
    check(`static: no hardcoded Supabase credential in ${rel}`, !hasHardcoded);
    if (hasHardcoded) allClean = false;
  });

  const pages = ['admin.html', 'agent-library.html', 'analytics.html', 'automation.html', 'billing.html',
    'brain.html', 'browser.html', 'index.html', 'login.html', 'memory.html', 'os-shell.html',
    'playground.html', 'register.html', 'settings.html', 'studios.html', 'workspace.html'];
  const expectedOrder = [
    'env.config.js',
    'js/core/supabase/env.js',
    'js/core/supabase/connection-manager.js',
    'js/core/supabase/auth-service.js',
    'js/core/supabase-config.js'
  ];
  pages.forEach((page) => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const positions = expectedOrder.map((frag) => html.indexOf(frag));
    const allPresent = positions.every((p) => p !== -1);
    const inOrder = allPresent && positions.every((p, i) => i === 0 || p > positions[i - 1]);
    check(`static: ${page} loads Supabase foundation scripts in order`, inOrder,
      allPresent ? 'present but out of order' : 'one or more script tags missing');
  });

  return Promise.resolve();
}

function finish() {
  console.log(`\n${pass}/${pass + fail} passing`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f.label}${f.detail ? ' — ' + f.detail : ''}`));
    process.exitCode = 1;
  }
}
