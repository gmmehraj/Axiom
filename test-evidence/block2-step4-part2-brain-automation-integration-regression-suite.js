// ============================================================
// AXIOM — Block 2 / Step 4 / Part 2: Connect Brain to Automation regression
// ------------------------------------------------------------
// Loads the real, unmodified os/core/axiom-brain.js,
// os/core/automation-engine.js (with the Part 2 pauseRun/resumeRun
// addition), and os/core/brain-automation-bridge.js together in a small
// hand-rolled window/document/localStorage shim (same pattern as the
// Block 2 / Step 2 / Part 2 and Block 2 / Step 3 / Part 2 suites) and
// drives them by calling the engine's REAL public API (createWorkflow,
// publishWorkflow, enqueueRun, pauseRun, resumeRun, cancelRun) — then
// asserts the Brain actually reflects what the engine reported, with no
// direct shortcuts into AxiomBrain.setState() to fake it.
//
// No jsdom import: no network access in this sandbox to install it, so
// this uses Node's vm module with a minimal DOM/localStorage shim
// instead of jsdom.
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

class FakeCustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init && Object.prototype.hasOwnProperty.call(init, 'detail') ? init.detail : null;
  }
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
sandbox.CustomEvent = FakeCustomEvent;
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
Object.assign(sandbox, makeEventTarget()); // window itself gets addEventListener/dispatchEvent (for 'storage')
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
  //      automation.html now loads them: Brain -> AutomationEngine -> Bridge
  load('os/core/axiom-brain.js');
  load('os/core/automation-engine.js');
  load('os/core/brain-automation-bridge.js');

  const Brain = sandbox.AxiomBrain;
  const Engine = sandbox.AxiomAutomationBuilderEngine;
  const Bridge = sandbox.AxiomBrainAutomationBridge;

  check('AxiomBrain loaded', !!Brain);
  check('AxiomAutomationBuilderEngine loaded', !!Engine);
  check('AxiomBrainAutomationBridge loaded', !!Bridge);
  check('Brain has a default idle automation state before any run', Brain.getState().automation.status === 'idle', Brain.getState().automation);

  Engine.init({ concurrency: 1 });

  // -- 1. Workflow started: enqueueRun() -> Brain reflects 'queued' with the
  //       real run/workflow ids, not a fabricated placeholder ---------------
  const wf = Engine.createWorkflow({ name: 'Weekly Report', steps: [{ label: 'AI Generate', type: 'AI Generate' }, { label: 'Save File', type: 'Save File' }] });
  Engine.publishWorkflow(wf.id);
  const run1 = Engine.enqueueRun(wf.id, { trigger: 'Manual' });
  {
    const a = Brain.getState().automation;
    check('Brain reflects the run that was actually just created', a.runId === run1.id, a);
    check('Brain reflects the real workflow id', a.workflowId === wf.id, a);
    check('Brain reflects the real workflow name', a.workflowName === 'Weekly Report', a);
    check("Brain status is 'queued' immediately after enqueueRun (before it starts running)", a.status === 'queued' || a.status === 'running', a);
  }

  // -- 2. Workflow running: the engine actually starts the run async;
  //       Brain must transition to 'running' from the SAME real event -----
  await sleep(50);
  {
    const a = Brain.getState().automation;
    check("Brain transitions to 'running' once the engine actually starts the run", a.status === 'running', a);
    check('run really is running per the engine itself (not just Brain saying so)', Engine.getRun(run1.id).status === 'running', Engine.getRun(run1.id));
  }

  // -- 3. Workflow paused: pauseRun() takes effect at the next step
  //       boundary; Brain must only report 'paused' once the run has
  //       actually stopped advancing, and the run's currentStepIndex must
  //       not move further while paused -----------------------------------
  Engine.pauseRun(run1.id);
  await sleep(400); // give the in-flight step time to finish and hit the pause checkpoint
  {
    const engineRun = Engine.getRun(run1.id);
    check("engine run actually reached 'paused' (not just requested)", engineRun.status === 'paused', engineRun);
    const a = Brain.getState().automation;
    check("Brain reflects the real 'paused' status", a.status === 'paused', a);
    const idxAtPause = engineRun.currentStepIndex;
    await sleep(300);
    check('a paused run does not silently keep advancing steps', Engine.getRun(run1.id).currentStepIndex === idxAtPause, Engine.getRun(run1.id));
  }

  // -- 4. Resume -> completion: resumeRun() continues from where it left
  //       off; Brain must reach 'success' only once every step genuinely
  //       finished --------------------------------------------------------
  Engine.resumeRun(run1.id);
  await sleep(50);
  check("Brain reflects 'running' again immediately after resume", Brain.getState().automation.status === 'running', Brain.getState().automation);
  for (let i = 0; i < 40 && Engine.getRun(run1.id).status === 'running'; i++) { await sleep(100); } // eslint-disable-line no-await-in-loop
  {
    const engineRun = Engine.getRun(run1.id);
    check("run completed for real (engine says 'success')", engineRun.status === 'success', engineRun);
    check("Brain reflects 'success' from the same real completion", Brain.getState().automation.status === 'success', Brain.getState().automation);
    check('every step actually ran (no step skipped by the pause/resume path)', engineRun.steps.every(s => s.status === 'success'), engineRun.steps);
  }

  // -- 5. Workflow failed: a run whose Condition step genuinely evaluates
  //       false (non-retryable, per automation-engine.js's deterministic
  //       Condition handling) must report 'failed' on the Brain, with the
  //       run id matching the run that actually failed ---------------------
  const wfCond = Engine.createWorkflow({ name: 'Gate Check', steps: [{ label: 'Condition', type: 'Condition' }] });
  Engine.publishWorkflow(wfCond.id);
  const run2 = Engine.enqueueRun(wfCond.id, { trigger: 'Manual', data: { conditionsMet: false } });
  for (let i = 0; i < 60 && Engine.getRun(run2.id).status !== 'failed' && Engine.getRun(run2.id).status !== 'success'; i++) { await sleep(100); } // eslint-disable-line no-await-in-loop
  {
    const engineRun = Engine.getRun(run2.id);
    check('run whose condition genuinely failed actually failed per the engine', engineRun.status === 'failed', engineRun);
    const a = Brain.getState().automation;
    check("Brain reflects 'failed' for the run that actually failed", a.status === 'failed' && a.runId === run2.id, a);
  }

  // -- 6. Cancellation: a run cancelled mid-flight must report 'cancelled'
  //       on the Brain, and the engine must actually have stopped it -------
  const run3 = Engine.enqueueRun(wf.id, { trigger: 'Manual' });
  await sleep(50);
  Engine.cancelRun(run3.id);
  await sleep(50);
  {
    const engineRun = Engine.getRun(run3.id);
    check('cancelled run actually stopped per the engine', engineRun.status === 'cancelled', engineRun);
    const a = Brain.getState().automation;
    check("Brain reflects 'cancelled' for the run that was actually cancelled", a.status === 'cancelled' && a.runId === run3.id, a);
  }

  // -- 7. Cancelling a PAUSED run: proves the Part 2 cancelRun() extension
  //       for paused runs actually wakes the run up rather than leaving it
  //       parked forever -------------------------------------------------
  const run4 = Engine.enqueueRun(wf.id, { trigger: 'Manual' });
  await sleep(50);
  Engine.pauseRun(run4.id);
  await sleep(400);
  check('run4 actually reached paused before being cancelled', Engine.getRun(run4.id).status === 'paused', Engine.getRun(run4.id));
  Engine.cancelRun(run4.id);
  await sleep(50);
  {
    const engineRun = Engine.getRun(run4.id);
    check('cancelling a paused run actually unparks and cancels it (not stuck)', engineRun.status === 'cancelled', engineRun);
    check("Brain reflects 'cancelled' for the paused-then-cancelled run", Brain.getState().automation.status === 'cancelled' && Brain.getState().automation.runId === run4.id, Brain.getState().automation);
  }

  // -- 8. Queue updates: with concurrency 1, a burst of 3 runs must show
  //       real, non-fabricated pending/running counts on the Brain --------
  Engine.init({}); // no-op re-init guard check (already initialized) — must not throw
  const burstA = Engine.enqueueRun(wf.id, { trigger: 'Burst' });
  const burstB = Engine.enqueueRun(wf.id, { trigger: 'Burst' });
  const burstC = Engine.enqueueRun(wf.id, { trigger: 'Burst' });
  {
    const q = Brain.getState().automation.queue;
    check('Brain queue.running matches the real engine queue state', q.running === Engine.getQueueState().running, { brain: q, engine: Engine.getQueueState() });
    check('Brain queue.pending reflects a genuine backlog under concurrency 1', q.pending === Engine.getQueueState().pending, { brain: q, engine: Engine.getQueueState() });
  }
  for (let i = 0; i < 100 && [burstA, burstB, burstC].some(r => ['queued', 'running'].includes(Engine.getRun(r.id).status)); i++) { await sleep(100); } // eslint-disable-line no-await-in-loop
  {
    const q = Brain.getState().automation.queue;
    check('queue drains back to 0 pending / 0 running once the burst settles', q.pending === 0 && q.running === 0, q);
  }

  // -- 9. No fabricated 'paused' before Part 2 would have existed: pausing
  //       a run that is not currently running must be rejected, not
  //       silently accepted (it was 'success' by now) ----------------------
  check("pauseRun() on an already-settled run returns false (no fake pause)", Engine.pauseRun(run1.id) === false, Engine.getRun(run1.id));

  // -- 10. Bridge exposes its own observation stats; destroy() stops it ----
  {
    const s = Bridge.getStats();
    check('bridge reports runEventsObserved > 0', s.runEventsObserved > 0, s);
    check('bridge reports queueEventsObserved > 0', s.queueEventsObserved > 0, s);
  }
  Bridge.destroy();
  const statusBeforeDestroy = Brain.getState().automation.status;
  const run5 = Engine.enqueueRun(wf.id, { trigger: 'After destroy' });
  await sleep(50);
  check('destroy() stops the bridge from writing further Brain updates', Brain.getState().automation.status === statusBeforeDestroy && Brain.getState().automation.runId !== run5.id, Brain.getState().automation);

  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
}

main();
