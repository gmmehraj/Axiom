// ============================================================
// AXIOM — Block 2 / Step 4 / Part 4: Automation Manager regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/automation-engine.js,
// os/core/memory-engine.js, os/core/automation-memory-bridge.js, and
// os/core/automation-manager.js together in the same hand-rolled
// window/document/localStorage vm shim used by the Part 2/Part 3 suites,
// and drives everything through AxiomAutomationManager's own public API
// (workflows.*, run.*, monitor.*, status.*, history.*) — no direct
// shortcuts into the underlying engine/bridge to fake a result, except
// where a check specifically needs to confirm the Manager's numbers
// match the engine's own.
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

async function waitForTerminal(Engine, runId) {
  for (let i = 0; i < 60 && ['queued', 'running', 'paused'].includes(Engine.getRun(runId).status); i++) {
    await sleep(100); // eslint-disable-line no-await-in-loop
  }
}

async function main() {
  // ---- Load the real, unmodified files under test, in the SAME order
  //      automation.html now loads them: Memory -> AutomationEngine ->
  //      MemoryBridge -> Manager
  load('os/core/memory-engine.js');
  load('os/core/automation-engine.js');
  load('os/core/automation-memory-bridge.js');
  load('os/core/automation-manager.js');

  const Memory = sandbox.AxiomMemoryEngine;
  const Engine = sandbox.AxiomAutomationBuilderEngine;
  const Bridge = sandbox.AxiomAutomationMemoryBridge;
  const Manager = sandbox.AxiomAutomationManager;

  check('AxiomMemoryEngine loaded', !!Memory);
  check('AxiomAutomationBuilderEngine loaded', !!Engine);
  check('AxiomAutomationMemoryBridge loaded', !!Bridge);
  check('AxiomAutomationManager loaded', !!Manager);

  Engine.init({ concurrency: 2 });

  // -- 1. Workflow Manager: thin passthrough behaves exactly like the
  //       engine's own workflow CRUD -----------------------------------
  const wf = Manager.workflows.create({ name: 'Weekly Report', steps: [{ label: 'AI Generate', type: 'AI Generate' }, { label: 'Save File', type: 'Save File' }] });
  check('workflows.create returns a real stored workflow', !!wf && !!Engine.getWorkflow(wf.id), wf);
  check('new workflow starts as draft (not runnable yet)', wf.status === 'draft', wf);

  const preActivateStart = Manager.run.start(wf.id, { trigger: 'Manual' });
  check('run.start refuses to start a draft (unpublished) workflow', preActivateStart.started === false && preActivateStart.reason === 'workflow-not-active', preActivateStart);

  Manager.workflows.publish(wf.id);
  check('workflows.publish activates the real workflow', Manager.workflows.get(wf.id).status === 'active', Manager.workflows.get(wf.id));

  const unknownStart = Manager.run.start('not-a-real-workflow-id');
  check('run.start reports unknown-workflow for a bogus id', unknownStart.started === false && unknownStart.reason === 'unknown-workflow', unknownStart);

  // -- 2. Queue Manager + run.start(): a normal run actually executes via
  //       the real engine underneath ------------------------------------
  const started1 = Manager.run.start(wf.id, { trigger: 'Manual' });
  check('run.start actually starts a run through the real engine', started1.started === true && !!started1.run && !!Engine.getRun(started1.run.id), started1);

  await waitForTerminal(Engine, started1.run.id);
  check('the run manager started genuinely reached a terminal status per the engine', Engine.getRun(started1.run.id).status === 'success', Engine.getRun(started1.run.id));

  // -- 3. THE core objective: no duplicate execution. Simulate a
  //       double-click of "Run Now" — the second call must be refused,
  //       not silently queue a second run -------------------------------
  const wf2 = Manager.workflows.create({ name: 'Double Click Target', steps: [{ label: 'API Call', type: 'API Call' }, { label: 'API Call', type: 'API Call' }] });
  Manager.workflows.publish(wf2.id);

  const firstClick = Manager.run.start(wf2.id, { trigger: 'Manual' });
  check('first "click" genuinely starts a run', firstClick.started === true, firstClick);

  const secondClick = Manager.run.start(wf2.id, { trigger: 'Manual' }); // fired immediately, before the first run finished
  check('second "click" while the first run is still in flight is refused', secondClick.started === false && secondClick.reason === 'duplicate-in-flight', secondClick);
  check('the refused call reports the REAL in-flight run, not a fabricated one', secondClick.run && secondClick.run.id === firstClick.run.id, secondClick);

  const onlyOneInFlight = Engine.listRuns({ workflowId: wf2.id }).filter(r => ['queued', 'running', 'paused'].includes(r.status));
  check('the engine itself shows only ONE in-flight run for this workflow (no duplicate was ever enqueued)', onlyOneInFlight.length === 1, onlyOneInFlight);

  const forcedClick = Manager.run.start(wf2.id, { trigger: 'Manual', force: true });
  check('opts.force explicitly bypasses the duplicate guard when the caller really wants a second run', forcedClick.started === true && forcedClick.run.id !== firstClick.run.id, forcedClick);

  await waitForTerminal(Engine, firstClick.run.id);
  await waitForTerminal(Engine, forcedClick.run.id);

  // -- 4. run.retry() carries the same duplicate guard, applied to the
  //       retried run's own workflow -------------------------------------
  const wfCond = Manager.workflows.create({ name: 'Gate Check', steps: [{ label: 'Condition', type: 'Condition' }] });
  Manager.workflows.publish(wfCond.id);
  const failing = Manager.run.start(wfCond.id, { trigger: 'Manual', data: { conditionsMet: false } });
  await waitForTerminal(Engine, failing.run.id);
  check('the seeded run genuinely failed per the engine', Engine.getRun(failing.run.id).status === 'failed', Engine.getRun(failing.run.id));

  const retried = Manager.run.retry(failing.run.id);
  check('run.retry starts a genuine new run cloned from the failed one', retried.started === true && retried.run.id !== failing.run.id && retried.run.workflowId === wfCond.id, retried);

  const retryWhileInFlight = Manager.run.retry(failing.run.id); // the retried run above is likely still queued/running
  check('retrying again while the retried run is still in flight is refused for the same reason', retryWhileInFlight.started === false && retryWhileInFlight.reason === 'duplicate-in-flight', retryWhileInFlight);

  await waitForTerminal(Engine, retried.run.id);

  // -- 5. run.cancel / pause / resume passthrough actually reach the real
  //       engine (Manager invents nothing here) ---------------------------
  const wfLong = Manager.workflows.create({ name: 'Pausable', steps: [{ label: 'API Call', type: 'API Call' }, { label: 'API Call', type: 'API Call' }] });
  Manager.workflows.publish(wfLong.id);
  const runLong = Manager.run.start(wfLong.id, { trigger: 'Manual', force: true });
  await sleep(50);
  check('run.pause reaches the real engine', Manager.run.pause(runLong.run.id) === true);
  await sleep(400);
  check('the run genuinely reached paused', Engine.getRun(runLong.run.id).status === 'paused', Engine.getRun(runLong.run.id));
  check('run.resume reaches the real engine', Manager.run.resume(runLong.run.id) === true);
  await sleep(50);
  check('run.cancel reaches the real engine', Manager.run.cancel(runLong.run.id) === true);
  await sleep(50);
  check('the run genuinely ended up cancelled', Engine.getRun(runLong.run.id).status === 'cancelled', Engine.getRun(runLong.run.id));

  // -- 6. Execution Monitor: derived progress reflects REAL engine fields,
  //       nothing fabricated ------------------------------------------------
  const wfMonitor = Manager.workflows.create({ name: 'Monitored', steps: [{ label: 'API Call', type: 'API Call' }, { label: 'API Call', type: 'API Call' }, { label: 'API Call', type: 'API Call' }] });
  Manager.workflows.publish(wfMonitor.id);
  const runMonitor = Manager.run.start(wfMonitor.id, { trigger: 'Manual' });
  await sleep(50);
  {
    const progress = Manager.monitor.getRunProgress(runMonitor.run.id);
    check('getRunProgress reports the real step count from the engine', progress && progress.stepCount === 3, progress);
    check('getRunProgress reports a real, non-negative elapsed time', progress && progress.elapsedMs >= 0, progress);
    const active = Manager.monitor.getActiveRuns();
    check('getActiveRuns includes the run actually in flight', active.some(r => r.id === runMonitor.run.id), active.map(r => r.id));
  }
  await waitForTerminal(Engine, runMonitor.run.id);
  check('getRunProgress returns null once the run is no longer in flight (not a stale snapshot)', Manager.monitor.getRunProgress(runMonitor.run.id) === null);

  {
    const recovery = Manager.monitor.getErrorRecoveryStats();
    check('getErrorRecoveryStats returns real, non-negative derived counters', recovery && recovery.stepRetriesObserved >= 0 && recovery.runsWithStepRetries >= 0, recovery);
  }

  // -- 7. Status API: rolled-up snapshot matches the engine's own numbers -
  {
    const st = Manager.status.getStatus();
    check('getStatus reports the real queue state', JSON.stringify(st.queue) === JSON.stringify(Engine.getQueueState()), st);
    check('getStatus reports the real engine stats', st.engineStats.activeWorkflows === Engine.getStats().activeWorkflows, st);
    check('getStatus reports this manager\'s own duplicate-guard counter, which is > 0 after the double-click test above', st.managerStats.duplicatesBlocked > 0, st);

    const wfStatus = Manager.status.getWorkflowStatus(wf2.id);
    check('getWorkflowStatus reports no in-flight run once everything for that workflow has settled', wfStatus.hasInFlightRun === false, wfStatus);
    check('getWorkflowStatus reports the real last run for that workflow', !!wfStatus.lastRun, wfStatus);

    check('getStatus returns null for an unknown workflow rather than throwing', Manager.status.getWorkflowStatus('nope') === null);
  }

  // -- 8. History API: passthrough to the real Part 3 bridge — the
  //       Manager stores no history of its own ----------------------------
  {
    const hist = Manager.history.listExecutionHistory({ workflowId: wf.id });
    check('history.listExecutionHistory matches the Bridge\'s own real record for this workflow', hist.items.some(i => i.data.runId === started1.run.id), hist);
    const single = Manager.history.getExecutionHistory(started1.run.id);
    check('history.getExecutionHistory returns the Bridge\'s real stored record', !!single && single.data.runId === started1.run.id, single);
  }

  // -- 9. getStats() / onChange() / destroy() ------------------------------
  {
    const s = Manager.getStats();
    check('getStats reports runsStarted > 0', s.runsStarted > 0, s);
    check('getStats reports duplicatesBlocked > 0', s.duplicatesBlocked > 0, s);
    check('getStats reports retryCalls > 0', s.retryCalls > 0, s);
  }
  {
    let observed = 0;
    const off = Manager.onChange(() => { observed++; });
    Manager.workflows.publish(wf.id); // re-publish -> a real 'workflow:update' event
    check('onChange passes through the real engine pub/sub', observed > 0, observed);
    off();
  }
  Manager.destroy(); // no-op-safe; nothing should throw
  check('destroy() does not throw and Manager remains usable afterward', Manager.status.getStatus().apiVersion === Manager.API_VERSION);

  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
}

main();
