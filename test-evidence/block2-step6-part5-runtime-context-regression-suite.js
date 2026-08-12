// ============================================================
// AXIOM — Block 2 / Step 6 / Part 5: Runtime Context Engine
// regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1) and
// os/core/runtime-context.js (Part 5) in a minimal vm sandbox, same
// pattern as the Part 4 suite. Proves: context creation/mutation,
// immutable snapshots (no raw object leakage), lifecycle transition
// validation (legal + illegal), parent/child isolation, automatic
// archival on terminal status, recovery, expiry-based destruction,
// and monitoring counters — all independent of Workflow Planner /
// Capability Router, and without either of those files being loaded
// or modified.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');

function loadSandbox(opts) {
  opts = opts || {};
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Promise, Object, Array, JSON, Math, Error
  };
  sandbox.window = sandbox;
  sandbox.document = undefined;
  if (typeof opts.cleanupIntervalMs === 'number') {
    sandbox.AXIOM_RUNTIME_CONTEXT_CLEANUP_INTERVAL_MS = opts.cleanupIntervalMs;
  }

  vm.createContext(sandbox);

  if (opts.withOrchestrator !== false) {
    const orchestratorSrc = fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8');
    vm.runInContext(orchestratorSrc, sandbox, { filename: 'orchestrator.js' });
  }

  const rcSrc = fs.readFileSync(path.join(AI, 'os/core/runtime-context.js'), 'utf8');
  vm.runInContext(rcSrc, sandbox, { filename: 'runtime-context.js' });

  return sandbox.window;
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + e.stack);
  }
}

async function main() {
  console.log('AXIOM Block 2 / Step 6 / Part 5 — Runtime Context Engine regression\n');

  await test('works standalone without AxiomOrchestrator loaded (window.AxiomRuntimeContext only)', () => {
    const W = loadSandbox({ withOrchestrator: false });
    assert.strictEqual(typeof W.AxiomRuntimeContext, 'object');
    assert.strictEqual(W.AxiomOrchestrator, undefined);
    const ctx = W.AxiomRuntimeContext.createContext({ workflowId: 'wf_a' });
    assert.strictEqual(ctx.workflowId, 'wf_a');
    assert.strictEqual(ctx.status, 'created');
  });

  await test('installs a context API onto AxiomOrchestrator without editing Part 1 behavior', async () => {
    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomOrchestrator.createContext, 'function');
    assert.strictEqual(typeof W.AxiomOrchestrator.getContext, 'function');
    // Part 1 behavior still intact.
    W.AxiomOrchestrator.registerAgent({ id: 'plain', handler: async () => 'ok' });
    const id = W.AxiomOrchestrator.dispatch({ agentId: 'plain', type: 'default' });
    await tick(20);
    assert.strictEqual(W.AxiomOrchestrator.getTask(id).status, 'completed');
  });

  await test('createContext() populates all required identity fields', () => {
    const W = loadSandbox();
    const ctx = W.AxiomRuntimeContext.createContext({
      workflowId: 'wf_1', requestId: 'req_1', ownerAgent: 'executive',
      metadata: { source: 'chat' }, state: { step: 0 }
    });
    ['contextId', 'workflowId', 'requestId', 'ownerAgent', 'createdAt', 'updatedAt', 'status', 'metadata', 'state', 'temporaryData']
      .forEach((field) => assert.ok(Object.prototype.hasOwnProperty.call(ctx, field), 'missing field ' + field));
    assert.strictEqual(ctx.status, 'created');
    assert.strictEqual(ctx.state.step, 0);
  });

  await test('getContext() returns a frozen, immutable snapshot — never the live object', () => {
    const W = loadSandbox();
    const ctx = W.AxiomRuntimeContext.createContext({ state: { count: 1 } });
    const snap = W.AxiomRuntimeContext.getContext(ctx.contextId);
    assert.ok(Object.isFrozen(snap));
    assert.ok(Object.isFrozen(snap.state));
    // Mutating the returned snapshot must never affect the engine's
    // internal state (a frozen object silently ignores the write in
    // sloppy mode rather than throwing — the invariant under test is
    // that the mutation attempt has no effect either way).
    snap.state.count = 999;
    const again = W.AxiomRuntimeContext.getContext(ctx.contextId);
    assert.strictEqual(again.state.count, 1);
  });

  await test('updateContext() merges state/metadata/temporaryData without clobbering untouched keys', () => {
    const W = loadSandbox();
    const ctx = W.AxiomRuntimeContext.createContext({ state: { a: 1, b: 2 }, metadata: { tag: 'x' } });
    W.AxiomRuntimeContext.updateContext(ctx.contextId, { state: { b: 3, c: 4 } });
    const snap = W.AxiomRuntimeContext.getContext(ctx.contextId);
    assert.deepStrictEqual(snap.state, { a: 1, b: 3, c: 4 });
    assert.strictEqual(snap.metadata.tag, 'x');
  });

  await test('clearContext() wipes state/temporaryData but preserves identity and status', () => {
    const W = loadSandbox();
    const ctx = W.AxiomRuntimeContext.createContext({ state: { a: 1 }, temporaryData: { scratch: true } });
    W.AxiomRuntimeContext.markReady(ctx.contextId);
    W.AxiomRuntimeContext.clearContext(ctx.contextId);
    const snap = W.AxiomRuntimeContext.getContext(ctx.contextId);
    assert.deepStrictEqual(snap.state, {});
    assert.deepStrictEqual(snap.temporaryData, {});
    assert.strictEqual(snap.status, 'ready');
    assert.strictEqual(snap.contextId, ctx.contextId);
  });

  await test('cloneContext() deep-clones state into a brand-new, independent contextId', () => {
    const W = loadSandbox();
    const ctx = W.AxiomRuntimeContext.createContext({ state: { nested: { count: 1 } } });
    const clone = W.AxiomRuntimeContext.cloneContext(ctx.contextId);
    assert.notStrictEqual(clone.contextId, ctx.contextId);
    assert.deepStrictEqual(clone.state, { nested: { count: 1 } });
    W.AxiomRuntimeContext.updateContext(clone.contextId, { state: { nested: { count: 99 } } });
    const originalStill = W.AxiomRuntimeContext.getContext(ctx.contextId);
    assert.strictEqual(originalStill.state.nested.count, 1, 'clone must not share references with original');
  });

  // --------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------
  await test('legal lifecycle transitions succeed in order: created -> ready -> running -> completed', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    assert.strictEqual(RC.markReady(ctx.contextId).success, true);
    assert.strictEqual(RC.markRunning(ctx.contextId).success, true);
    assert.strictEqual(RC.completeContext(ctx.contextId, { ok: true }).success, true);
    // Completed contexts are auto-archived immediately but remain readable.
    const snap = RC.getContext(ctx.contextId);
    assert.strictEqual(snap.status, 'completed');
    assert.strictEqual(snap.temporaryData.result.ok, true);
  });

  await test('illegal transitions fail safely (no throw) and leave status unchanged', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    // CREATED -> COMPLETED directly is not a legal edge.
    const result = RC.transitionContext(ctx.contextId, 'completed');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'illegal_transition');
    const snap = RC.getContext(ctx.contextId);
    assert.strictEqual(snap.status, 'created');
  });

  await test('DESTROYED is terminal — no transition is legal out of it', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    RC.markReady(ctx.contextId);
    RC.cancelContext(ctx.contextId, 'test');
    RC.destroyContext(ctx.contextId, 'test-cleanup');
    const result = RC.transitionContext(ctx.contextId, 'ready');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'not_active');
  });

  await test('updateContext({status}) routes through validated transitions rather than a raw write', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    // Illegal jump requested via updateContext — must be ignored, not applied.
    RC.updateContext(ctx.contextId, { status: 'completed' });
    assert.strictEqual(RC.getContext(ctx.contextId).status, 'created');
  });

  // --------------------------------------------------------
  // Isolation / parent-child
  // --------------------------------------------------------
  await test('each createContext() call is fully isolated — no shared state between contexts', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const a = RC.createContext({ state: { v: 1 } });
    const b = RC.createContext({ state: { v: 1 } });
    RC.updateContext(a.contextId, { state: { v: 2 } });
    assert.strictEqual(RC.getContext(b.contextId).state.v, 1, 'contexts must never leak state to each other');
  });

  await test('createChildContext() links parent/child without sharing state by reference', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const parent = RC.createContext({ workflowId: 'wf_parent', state: { fromParent: true } });
    const child = RC.createChildContext(parent.contextId, { ownerAgent: 'research' });
    assert.strictEqual(child.parentContextId, parent.contextId);
    assert.strictEqual(child.workflowId, 'wf_parent', 'child inherits workflowId by default');
    assert.deepStrictEqual(child.state, {}, 'child does not inherit parent state');

    RC.updateContext(child.contextId, { state: { fromChild: true } });
    const parentAfter = RC.getContext(parent.contextId);
    assert.deepStrictEqual(parentAfter.state, { fromParent: true }, 'child mutation must not leak into parent');

    const children = RC.getChildContexts(parent.contextId);
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].contextId, child.contextId);

    const gotParent = RC.getParentContext(child.contextId);
    assert.strictEqual(gotParent.contextId, parent.contextId);
  });

  await test('createChildContext() rejects a parent that does not exist', () => {
    const W = loadSandbox();
    assert.throws(() => W.AxiomRuntimeContext.createChildContext('ctx_ghost', {}));
  });

  await test('getContextsByWorkflow() scopes lookups to a single workflow', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    RC.createContext({ workflowId: 'wf_x' });
    RC.createContext({ workflowId: 'wf_x' });
    RC.createContext({ workflowId: 'wf_y' });
    assert.strictEqual(RC.getContextsByWorkflow('wf_x').length, 2);
    assert.strictEqual(RC.getContextsByWorkflow('wf_y').length, 1);
  });

  // --------------------------------------------------------
  // Cleanup & recovery
  // --------------------------------------------------------
  await test('reaching a terminal status auto-archives the context out of getActiveContexts()', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    RC.markReady(ctx.contextId);
    RC.markRunning(ctx.contextId);
    assert.strictEqual(RC.getActiveContexts().some((c) => c.contextId === ctx.contextId), true);
    RC.completeContext(ctx.contextId);
    assert.strictEqual(RC.getActiveContexts().some((c) => c.contextId === ctx.contextId), false);
    // Still readable/recoverable though — not gone.
    assert.ok(RC.getContext(ctx.contextId));
  });

  await test('recoverContext() brings an archived context back into READY for reuse', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    RC.markReady(ctx.contextId);
    RC.markRunning(ctx.contextId);
    RC.failContext(ctx.contextId, 'boom');
    assert.strictEqual(RC.getContext(ctx.contextId).status, 'failed');
    const recovered = RC.recoverContext(ctx.contextId);
    assert.strictEqual(recovered.status, 'ready');
    assert.strictEqual(RC.getActiveContexts().some((c) => c.contextId === ctx.contextId), true);
  });

  await test('recoverContext() returns null for a context that was never archived', () => {
    const W = loadSandbox();
    assert.strictEqual(W.AxiomRuntimeContext.recoverContext('ctx_never_existed'), null);
  });

  await test('cleanupExpiredContexts() destroys only archived contexts past their TTL, never active ones', async () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const shortLived = RC.createContext({ archiveTtlMs: 10 });
    const stillActive = RC.createContext({});
    RC.markReady(shortLived.contextId);
    RC.markRunning(shortLived.contextId);
    RC.completeContext(shortLived.contextId); // archived now, expires in 10ms
    RC.markReady(stillActive.contextId); // stays active, never archived

    await tick(30);
    const removed = RC.cleanupExpiredContexts();
    // removed is an Array constructed inside the vm sandbox realm, so
    // compare shape/contents rather than using deepStrictEqual (which
    // treats cross-realm Array instances as structurally unequal).
    assert.strictEqual(removed.length, 1);
    assert.strictEqual(removed[0], shortLived.contextId);
    assert.strictEqual(RC.getContext(shortLived.contextId), null, 'expired context must be fully gone');
    assert.ok(RC.getContext(stillActive.contextId), 'active context must be untouched by cleanup');
    assert.strictEqual(RC.getContext(stillActive.contextId).status, 'ready');
  });

  await test('createContext({timeoutMs}) auto-fails and archives a context that overstays its budget', async () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({ timeoutMs: 15 });
    RC.markReady(ctx.contextId);
    RC.markRunning(ctx.contextId);
    await tick(40);
    const snap = RC.getContext(ctx.contextId);
    assert.strictEqual(snap.status, 'failed');
    assert.strictEqual(snap.metadata.lastTransitionReason, 'timeout');
  });

  await test('destroyContext() force-terminates a live context and removes it from every store', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    RC.markReady(ctx.contextId);
    RC.markRunning(ctx.contextId);
    assert.strictEqual(RC.destroyContext(ctx.contextId, 'force'), true);
    assert.strictEqual(RC.getContext(ctx.contextId), null);
    assert.strictEqual(RC.getContextStatus(ctx.contextId), null);
    // Destroying an already-gone context is a safe no-op, not a throw.
    assert.strictEqual(RC.destroyContext(ctx.contextId, 'again'), false);
  });

  await test('destroyContext() of one context never disturbs a sibling context', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const a = RC.createContext({ workflowId: 'wf_shared' });
    const b = RC.createContext({ workflowId: 'wf_shared' });
    RC.markReady(a.contextId);
    RC.markReady(b.contextId);
    RC.destroyContext(a.contextId, 'cleanup');
    const stillB = RC.getContext(b.contextId);
    assert.strictEqual(stillB.status, 'ready');
  });

  // --------------------------------------------------------
  // Monitoring
  // --------------------------------------------------------
  await test('getContextMetrics() tracks creation/completion/failure/cancellation/destruction counts', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const a = RC.createContext({});
    const b = RC.createContext({});
    const c = RC.createContext({});
    RC.markReady(a.contextId); RC.markRunning(a.contextId); RC.completeContext(a.contextId);
    RC.markReady(b.contextId); RC.markRunning(b.contextId); RC.failContext(b.contextId, 'x');
    RC.markReady(c.contextId); RC.cancelContext(c.contextId, 'x');
    RC.destroyContext(a.contextId, 'x');

    const m = RC.getContextMetrics();
    assert.strictEqual(m.createdCount, 3);
    assert.strictEqual(m.completedCount, 1);
    assert.strictEqual(m.failedCount, 1);
    assert.strictEqual(m.cancelledCount, 1);
    assert.strictEqual(m.destroyedCount, 1);
    assert.ok(m.peakConcurrent >= 3);
  });

  await test('listContexts() filters by status and workflowId', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    RC.createContext({ workflowId: 'wf_1' });
    const ready = RC.createContext({ workflowId: 'wf_1' });
    RC.markReady(ready.contextId);
    RC.createContext({ workflowId: 'wf_2' });

    assert.strictEqual(RC.listContexts({ workflowId: 'wf_1' }).length, 2);
    assert.strictEqual(RC.listContexts({ status: 'ready' }).length, 1);
  });

  await test('getContextHistory() returns a bounded, most-recent-first audit trail', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    RC.markReady(ctx.contextId);
    RC.markRunning(ctx.contextId);
    RC.completeContext(ctx.contextId);
    const hist = RC.getContextHistory({ contextId: ctx.contextId });
    assert.ok(hist.length >= 4); // created, ready, running, completed(+archived)
    assert.strictEqual(hist[0].event.indexOf('archived') !== -1 || hist[0].event.indexOf('completed') !== -1, true);
  });

  await test('getContextStatus() gives a lightweight lookup distinct from the full snapshot', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    const s = RC.getContextStatus(ctx.contextId);
    assert.deepStrictEqual(Object.keys(s).sort(), ['contextId', 'status', 'updatedAt']);
    assert.strictEqual(s.status, 'created');
  });

  await test('context_* events fire on the shared AxiomOrchestrator event bus', async () => {
    const W = loadSandbox();
    const seen = [];
    ['context_created', 'context_status_changed', 'context_completed', 'context_archived'].forEach((evt) => {
      W.AxiomOrchestrator.on(evt, () => seen.push(evt));
    });
    const ctx = W.AxiomRuntimeContext.createContext({});
    W.AxiomRuntimeContext.markReady(ctx.contextId);
    W.AxiomRuntimeContext.markRunning(ctx.contextId);
    W.AxiomRuntimeContext.completeContext(ctx.contextId);
    assert.deepStrictEqual(seen, [
      'context_created', 'context_status_changed', 'context_status_changed',
      'context_status_changed', 'context_completed', 'context_archived'
    ]);
  });

  await test('module does not throw or require Orchestrator to be present (unlike workflow-planner.js)', () => {
    assert.doesNotThrow(() => loadSandbox({ withOrchestrator: false }));
  });

  // ============================================================
  // Stabilization Pass — Block 2 / Step 6 / Part 6 prep
  // FIX 1: Child Context Cleanup / FIX 2: Automatic Cleanup /
  // FIX 5: Clone Strategy
  // ============================================================

  await test('FIX 1: destroyContext() removes the destroyed id from its parent childIndex', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const parent = RC.createContext({});
    const child = RC.createChildContext(parent.contextId, {});
    assert.strictEqual(RC.getChildContexts(parent.contextId).length, 1);
    RC.destroyContext(child.contextId);
    assert.strictEqual(RC.getChildContexts(parent.contextId).length, 0);
    // and the parent's snapshot no longer lists the destroyed child id
    const parentNow = RC.getContext(parent.contextId);
    assert.strictEqual(parentNow.childContextIds.indexOf(child.contextId), -1);
  });

  await test('FIX 1: destroying a context with children prunes its own orphaned childIndex entry', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const parent = RC.createContext({});
    const child = RC.createChildContext(parent.contextId, {});
    // destroy the child first so the parent can reach a legal terminal
    // state, then destroy the parent — its own childIndex[parent] list
    // must not linger after the parent itself is gone.
    RC.destroyContext(child.contextId);
    RC.destroyContext(parent.contextId);
    assert.strictEqual(RC.getContext(parent.contextId), null);
    assert.strictEqual(RC.getChildContexts(parent.contextId).length, 0);
  });

  await test('FIX 1: repeated create/destroy cycles never grow childIndex without bound', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const parent = RC.createContext({});
    for (let i = 0; i < 500; i++) {
      const child = RC.createChildContext(parent.contextId, {});
      RC.destroyContext(child.contextId);
    }
    // every child was destroyed, so the parent should show zero live
    // children — not 500 stale ids.
    assert.strictEqual(RC.getChildContexts(parent.contextId).length, 0);
    assert.strictEqual(RC.getContext(parent.contextId).childContextIds.length, 0);
  });

  await test('FIX 1: destroying one child never disturbs its siblings\' visibility under the parent', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const parent = RC.createContext({});
    const a = RC.createChildContext(parent.contextId, {});
    const b = RC.createChildContext(parent.contextId, {});
    const c = RC.createChildContext(parent.contextId, {});
    RC.destroyContext(b.contextId);
    const remaining = RC.getChildContexts(parent.contextId).map((c) => c.contextId).slice().sort();
    const expected = [a.contextId, c.contextId].slice().sort();
    assert.strictEqual(remaining.length, 2);
    assert.strictEqual(remaining[0], expected[0]);
    assert.strictEqual(remaining[1], expected[1]);
  });

  await test('FIX 2: automatic cleanup starts as soon as the module loads', () => {
    const W = loadSandbox();
    assert.strictEqual(W.AxiomRuntimeContext.isAutoCleanupRunning(), true);
  });

  await test('FIX 2: automatic cleanup interval is configurable at load time', async () => {
    const W = loadSandbox({ cleanupIntervalMs: 20 });
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({ archiveTtlMs: 5 });
    RC.markReady(ctx.contextId);
    RC.markRunning(ctx.contextId);
    RC.completeContext(ctx.contextId); // auto-archives with a 5ms TTL
    assert.ok(RC.getContext(ctx.contextId)); // still readable, archived
    await tick(80); // well past both the 5ms TTL and the 20ms sweep interval
    assert.strictEqual(RC.getContext(ctx.contextId), null); // swept automatically, with no manual cleanupExpiredContexts() call
  });

  await test('FIX 2: automatic cleanup never removes an active (non-terminal) context', async () => {
    const W = loadSandbox({ cleanupIntervalMs: 20 });
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({ archiveTtlMs: 5 });
    RC.markReady(ctx.contextId);
    RC.markRunning(ctx.contextId); // left RUNNING — never archived
    await tick(80);
    assert.ok(RC.getContext(ctx.contextId));
    assert.strictEqual(RC.getContext(ctx.contextId).status, 'running');
  });

  await test('FIX 2: startAutoCleanup() never leaves more than one timer running (no duplicate timers)', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const activeHandles = new Set();
    const realSetInterval = W.setInterval;
    const realClearInterval = W.clearInterval;
    W.setInterval = function (fn, ms) {
      const h = realSetInterval(fn, ms);
      activeHandles.add(h);
      return h;
    };
    W.clearInterval = function (h) {
      activeHandles.delete(h);
      return realClearInterval(h);
    };
    RC.startAutoCleanup(1000);
    RC.startAutoCleanup(1000);
    RC.startAutoCleanup(1000);
    assert.strictEqual(activeHandles.size, 1);
    RC.stopAutoCleanup();
    assert.strictEqual(activeHandles.size, 0);
    assert.strictEqual(RC.isAutoCleanupRunning(), false);
  });

  await test('FIX 2: stopAutoCleanup() is a safe no-op when nothing is running', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    RC.stopAutoCleanup();
    assert.strictEqual(RC.isAutoCleanupRunning(), false);
    assert.doesNotThrow(() => RC.stopAutoCleanup());
    assert.strictEqual(RC.isAutoCleanupRunning(), false);
  });

  await test('FIX 2: recovery still works normally after an automatic cleanup sweep has run', async () => {
    const W = loadSandbox({ cleanupIntervalMs: 20 });
    const RC = W.AxiomRuntimeContext;
    const long = RC.createContext({ archiveTtlMs: 10000 }); // outlives the sweep
    RC.markReady(long.contextId);
    RC.markRunning(long.contextId);
    RC.completeContext(long.contextId);
    await tick(60); // let at least one automatic sweep pass
    const recovered = RC.recoverContext(long.contextId);
    assert.ok(recovered);
    assert.strictEqual(recovered.status, 'ready');
  });

  await test('FIX 5: createContext() fails safely (throws) on a non-JSON-safe state payload instead of corrupting it', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    assert.throws(() => RC.createContext({ state: { handler: function () {} } }), /JSON-safe/);
  });

  await test('FIX 5: updateContext() fails safely (throws) on a circular payload instead of a silent shallow copy', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const ctx = RC.createContext({});
    const circular = {};
    circular.self = circular;
    assert.throws(() => RC.updateContext(ctx.contextId, { state: circular }), /JSON-safe/);
    // and the context's real state was never mutated by the rejected patch
    assert.deepStrictEqual(RC.getContext(ctx.contextId).state, {});
  });

  await test('FIX 5: an illegal clone payload never produces a partially-cloned or unfrozen snapshot', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    let threw = null;
    try {
      RC.createContext({ metadata: { fn: function () {} } });
    } catch (e) {
      threw = e;
    }
    assert.ok(threw && threw.nonSerializable);
    // no half-created context should have been left behind
    assert.strictEqual(RC.getContextMetrics().active, 0);
  });

  await test('FIX 5: createChildContext() propagates the same JSON-safe validation, and a rejected child is never linked into the parent', () => {
    const W = loadSandbox();
    const RC = W.AxiomRuntimeContext;
    const parent = RC.createContext({});
    assert.throws(() => RC.createChildContext(parent.contextId, { state: { fn: function () {} } }), /JSON-safe/);
    assert.strictEqual(RC.getChildContexts(parent.contextId).length, 0);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
}

main();
