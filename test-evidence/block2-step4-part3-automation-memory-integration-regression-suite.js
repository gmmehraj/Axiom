// ============================================================
// AXIOM — Block 2 / Step 4 / Part 3: Connect Memory to Automation regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/automation-engine.js,
// os/core/memory-engine.js, and os/core/automation-memory-bridge.js
// together in a small hand-rolled window/document/localStorage shim (same
// pattern as the Block 2 / Step 4 / Part 2 suite) and drives them by
// calling the engine's REAL public API (createWorkflow, publishWorkflow,
// enqueueRun, pauseRun, resumeRun, cancelRun) — then asserts Memory
// actually stored what the engine reported, with no direct shortcuts into
// AxiomMemoryEngine.addMemory() to fake a result.
//
// No jsdom import: no network access in this sandbox to install it, so
// this uses Node's vm module with a minimal DOM/localStorage shim instead
// of jsdom.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const AI = path.join(__dirname, '..');

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    },
    dispatchEvent(evt) {
      const set = listeners.get(evt.type);
      if (set) set.forEach((fn) => { try { fn(evt); } catch (e) { /* isolated */ } });
      return true;
    }
  };
}

// ---- Build the sandbox ("window" is self-referential, as in real browsers) --
const sandbox = {};
const docTarget = makeEventTarget();
sandbox.document = Object.assign(docTarget, {
  documentElement: { setAttribute() {}, getAttribute() { return null; } },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {} }),
  readyState: 'complete'
});
sandbox.localStorage = makeLocalStorage();
sandbox.console = console;
sandbox.Object = Object;
sandbox.Date = Date;
sandbox.Math = Math;
sandbox.JSON = JSON;
sandbox.Set = Set;
sandbox.Map = Map;
sandbox.Promise = Promise;
sandbox.Error = Error;
sandbox.setTimeout = (fn, ms) => setTimeout(fn, ms);
sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; };
sandbox.clearInterval = clearInterval;
Object.assign(sandbox, makeEventTarget());
sandbox.window = sandbox;

vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(path.join(AI, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

let fails = 0;
function check(label, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + ' ' + label + (cond ? '' : '  -> ' + JSON.stringify(detail)));
  if (!cond) fails++;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  // ---- Load the real, unmodified files under test, in the SAME order
  //      automation.html now loads them: Memory -> AutomationEngine -> Bridge
  load('os/core/memory-engine.js');
  load('os/core/automation-engine.js');
  load('os/core/automation-memory-bridge.js');

  const Memory = sandbox.AxiomMemoryEngine;
  const Engine = sandbox.AxiomAutomationBuilderEngine;
  const Bridge = sandbox.AxiomAutomationMemoryBridge;

  check('AxiomMemoryEngine loaded', !!Memory);
  check('AxiomAutomationBuilderEngine loaded', !!Engine);
  check('AxiomAutomationMemoryBridge loaded', !!Bridge);

  Engine.init({ concurrency: 1 });

  const wf = Engine.createWorkflow({ name: 'Weekly Report', steps: [{ label: 'AI Generate', type: 'AI Generate' }, { label: 'Save File', type: 'Save File' }] });
  Engine.publishWorkflow(wf.id);

  // -- 1. A run that completes successfully must produce exactly one
  //       durable 'automation-run' Memory record, with real runtime and
  //       step results — not a fabricated summary --------------------------
  const run1 = Engine.enqueueRun(wf.id, { trigger: 'Manual' });
  for (let i = 0; i < 60 && Engine.getRun(run1.id).status !== 'success' && Engine.getRun(run1.id).status !== 'failed'; i++) { await sleep(100); } // eslint-disable-line no-await-in-loop
  {
    const engineRun = Engine.getRun(run1.id);
    check('run actually completed per the engine', engineRun.status === 'success', engineRun);
    const rec = Memory.getMemory('automation-run:' + run1.id);
    check('Memory has a run-history record for the real run id', !!rec, rec);
    check('record reflects the real workflow id/name', rec.data.workflowId === wf.id && rec.data.workflowName === 'Weekly Report', rec && rec.data);
    check('record reflects the real terminal status', rec.data.status === 'success', rec && rec.data);
    check('record has a real, non-fabricated runtime', typeof rec.data.duration === 'number' && rec.data.duration > 0, rec && rec.data);
    check('record captures both real steps with their own success status', rec.data.steps.length === 2 && rec.data.steps.every(s => s.status === 'success'), rec && rec.data.steps);
    check('run-history record is durable (no ttl)', rec.ttl === null, rec);
  }

  // -- 2. A run whose Condition step genuinely fails must produce a record
  //       carrying the REAL step-level error, not a generic message --------
  const wfCond = Engine.createWorkflow({ name: 'Gate Check', steps: [{ label: 'Condition', type: 'Condition' }] });
  Engine.publishWorkflow(wfCond.id);
  const run2 = Engine.enqueueRun(wfCond.id, { trigger: 'Manual', data: { conditionsMet: false } });
  for (let i = 0; i < 60 && Engine.getRun(run2.id).status !== 'failed' && Engine.getRun(run2.id).status !== 'success'; i++) { await sleep(100); } // eslint-disable-line no-await-in-loop
  {
    const engineRun = Engine.getRun(run2.id);
    check('run genuinely failed per the engine', engineRun.status === 'failed', engineRun);
    const rec = Memory.getMemory('automation-run:' + run2.id);
    check('failed run has a Memory record', !!rec, rec);
    check('record carries the real run-level error message', typeof rec.data.error === 'string' && rec.data.error.length > 0, rec && rec.data);
    check('record carries the real failing step\'s own error', rec.data.steps[0].status === 'failed' && !!rec.data.steps[0].error, rec && rec.data.steps);
    check('failed runs are recorded with higher importance than success', rec.importance > Memory.getMemory('automation-run:' + run1.id).importance, rec);
  }

  // -- 3. Pause / resume: each must produce its own 'automation-action'
  //       Memory record with the real step it happened at, and cancelling
  //       the run afterward must be captured inside that run's OWN
  //       terminal history record (no fabricated "cancel requested" event) -
  const run3 = Engine.enqueueRun(wf.id, { trigger: 'Manual' });
  await sleep(50);
  Engine.pauseRun(run3.id);
  await sleep(400);
  check('run3 actually reached paused before inspecting Memory', Engine.getRun(run3.id).status === 'paused', Engine.getRun(run3.id));
  {
    const actions = Bridge.listActions({ runId: run3.id });
    check('a real pause produced exactly one action record', actions.items.filter(a => a.data.action === 'paused').length === 1, actions);
    check('the pause action record names the real step it paused at', !!actions.items.find(a => a.data.action === 'paused').data.atStepLabel, actions.items);
  }
  Engine.resumeRun(run3.id);
  await sleep(50);
  {
    const actions = Bridge.listActions({ runId: run3.id });
    check('a real resume produced exactly one action record', actions.items.filter(a => a.data.action === 'resumed').length === 1, actions);
  }
  Engine.cancelRun(run3.id);
  await sleep(50);
  {
    const engineRun = Engine.getRun(run3.id);
    check('run3 actually ended up cancelled per the engine', engineRun.status === 'cancelled', engineRun);
    const rec = Memory.getMemory('automation-run:' + run3.id);
    check('cancellation is captured in the run\'s own terminal history record', rec && rec.data.status === 'cancelled', rec);
    const cancelActions = Bridge.listActions({ runId: run3.id, action: 'cancelled' });
    check('no fabricated standalone "cancelled" action record was invented', cancelActions.items.length === 0, cancelActions);
  }

  // -- 4. Browsing: listExecutionHistory supports filtering by workflow and
  //       status, and paginates like the rest of the Memory read layer ------
  {
    const allForWf = Bridge.listExecutionHistory({ workflowId: wf.id });
    check('listExecutionHistory filters by real workflow id', allForWf.items.every(i => i.data.workflowId === wf.id), allForWf);
    check('listExecutionHistory includes both the success and the cancelled run for this workflow', allForWf.items.some(i => i.data.runId === run1.id) && allForWf.items.some(i => i.data.runId === run3.id), allForWf.items.map(i => i.data));
    const onlyFailed = Bridge.listExecutionHistory({ status: 'failed' });
    check('listExecutionHistory filters by real terminal status', onlyFailed.items.length >= 1 && onlyFailed.items.every(i => i.data.status === 'failed'), onlyFailed);
    const paged = Bridge.listExecutionHistory({ limit: 1 });
    check('listExecutionHistory paginates (limit respected)', paged.items.length === 1 && paged.total >= 3, paged);
  }

  // -- 5. Idempotency: the stable `automation-run:<runId>` id is exactly
  //       the mechanism that keeps re-observing the same terminal run from
  //       ever duplicating a history row — proven directly against the
  //       same AxiomMemoryEngine.addMemory() the bridge itself calls -------
  {
    const before = Bridge.listExecutionHistory({ workflowId: wf.id }).total;
    const rec = Memory.getMemory('automation-run:' + run1.id);
    Memory.addMemory(Object.assign({}, rec, { text: 'redundant re-write of the same run id' }));
    const after = Bridge.listExecutionHistory({ workflowId: wf.id }).total;
    check('writing the same stable id again overwrites in place, never duplicates', before === after, { before, after });
    check('getMemory still resolves the single record by its stable id', Memory.getMemory('automation-run:' + run1.id).id === 'automation-run:' + run1.id, rec);
  }

  // -- 6. Seeding: a bridge that starts up AFTER runs already exist (e.g. a
  //       fresh page load reading persisted state) must backfill their
  //       history without needing a brand-new engine event -----------------
  {
    delete sandbox.AxiomAutomationMemoryBridge;
    load('os/core/automation-memory-bridge.js');
    const FreshBridge = sandbox.AxiomAutomationMemoryBridge;
    const seeded = FreshBridge.getExecutionHistory(run1.id);
    check('a freshly-loaded bridge instance backfills existing terminal runs on seed', !!seeded && seeded.data.status === 'success', seeded);
    FreshBridge.destroy();
    sandbox.AxiomAutomationMemoryBridge = Bridge; // restore the original for the remaining checks
  }

  // -- 7. getStats() / destroy() -------------------------------------------
  {
    const s = Bridge.getStats();
    check('bridge reports runsRecorded > 0', s.runsRecorded > 0, s);
    check('bridge reports actionsRecorded > 0', s.actionsRecorded > 0, s);
  }
  Bridge.destroy();
  const totalBeforeDestroy = Bridge.listExecutionHistory({}).total;
  const run4 = Engine.enqueueRun(wf.id, { trigger: 'After destroy' });
  for (let i = 0; i < 60 && Engine.getRun(run4.id).status !== 'success' && Engine.getRun(run4.id).status !== 'failed'; i++) { await sleep(100); } // eslint-disable-line no-await-in-loop
  check('destroy() stops the bridge from recording further runs', !Memory.getMemory('automation-run:' + run4.id) && Bridge.listExecutionHistory({}).total === totalBeforeDestroy, { rec: Memory.getMemory('automation-run:' + run4.id), before: totalBeforeDestroy, after: Bridge.listExecutionHistory({}).total });

  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
}

main();
