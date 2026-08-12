# AXIOM — Automation Manager Report
### Phase 10 · Part 2 · Block 2 · Step 4 · Part 4

**Date:** 2026-07-31
**Scope:** Build one centralized Automation Manager — Queue Manager,
Workflow Manager, Execution Monitor, Status API, History API — as the
single surface all automation execution goes through. No new storage,
no engine business-logic changes, no UI changes.
**Role:** Senior AI Automation Architect.

---

## 1. State before this pass

Three real, independent pieces existed:

- **`os/core/automation-engine.js`** (Part 1) — workflow storage, the
  execution queue, the run lifecycle (`queued -> running -> paused ->
  success/failed/cancelled`), retries, cancellation, logging. Exposed as
  `window.AxiomAutomationBuilderEngine`.
- **`os/core/brain-automation-bridge.js`** (Part 2) — mirrors the
  engine's live run/queue events onto `AxiomBrain`'s single "what's
  happening right now" pointer.
- **`os/core/automation-memory-bridge.js`** (Part 3) — persists every
  run's real terminal outcome and pause/resume actions into
  `AxiomMemoryEngine`, with a browsable read layer
  (`listExecutionHistory`/`getExecutionHistory`/`listActions`).

Each does its one job correctly, but nothing centralized them. A caller
had to know which of three globals to reach for, and — critically —
nothing sat between "the user asked to run a workflow" and "the engine
enqueues a run" to apply any policy at all.

## 2. Audit before writing any code — was there a gap to fill first?

Following the same discipline as Parts 2 and 3: checked the objective's
five components against what already exists before assuming a facade
alone would be enough.

| Component | Audit finding |
|---|---|
| Queue Manager | `getQueueState()`/`listRuns({status})` already give everything needed — a composing wrapper is the whole job. |
| Workflow Manager | `createWorkflow`/`updateWorkflow`/`publishWorkflow`/`getWorkflow`/`listWorkflows`/`deleteWorkflow` already cover full CRUD — no policy applies to a workflow *definition*, only to starting a *run* of one. |
| History API | `AxiomAutomationMemoryBridge` already provides a complete, tested read layer — a passthrough is correct, a second storage path would not be. |
| Execution Monitor | Run objects already carry `currentStepIndex`, `steps[]`, `startedAt`/`finishedAt` — no engine gap, but nothing today turns those into "what's running right now, how far along, for how long." This pass adds that read-only derivation. |
| Status API | Same story — `getStats()`/`getQueueState()`/stored history already carry real numbers; nothing rolled them into one snapshot. |
| **No duplicate execution** (explicit validation requirement) | **A real, demonstrable gap.** Auditing `js/pages/automation-runtime-ui.js`'s `#runWorkflowNow` click handler together with `enqueueRun()` found that neither the UI nor the engine guards against a double-click (or any other caller) starting a second run of a workflow that already has one queued, running, or paused. The engine will queue both, and with concurrency > 1 they can execute at the same time. This is the same shape of finding as Part 2's "paused did not exist anywhere" — nothing existed to connect for a duplicate-execution guard, because no such guard existed anywhere to reuse. |

**Conclusion, same as Part 3: no engine change was required.** The one
real gap was a missing *policy* layer, not a missing engine capability —
so this pass adds exactly that policy in the new Manager, without
touching `automation-engine.js`'s own state machine.

## 3. What was built

**`os/core/automation-manager.js`** (new module —
`window.AxiomAutomationManager`)

A composing facade over the three existing pieces, organized into the
five requested components:

| Component | What it is |
|---|---|
| **Workflow Manager** (`workflows.*`) | Direct passthrough to the engine's own workflow CRUD (`create`/`update`/`publish`/`get`/`list`/`delete`). |
| **Queue Manager** (`queue.*`) | `getState()` passthrough plus `listPending()`/`listRunning()` — honest filters over the engine's own `listRuns()`, no new queue primitive. |
| **Run control** (`run.*`) | `start(workflowId, opts)` and `retry(runId, opts)` are the two **enforced entry points** — see §4. `cancel`/`pause`/`resume`/`get`/`list` are direct passthroughs; there is no duplicate concern in stopping, pausing, or resuming an *existing* run, only in starting a *new* one. |
| **Execution Monitor** (`monitor.*`) | `getActiveRuns()` / `getRunProgress(runId)` derive `elapsedMs`, `stepIndex`, `stepCount`, `percentComplete` purely by reading fields the engine already tracks — nothing is stored, nothing is guessed. `getErrorRecoveryStats()` derives real counts (step-level retries observed, runs recovered after a retry, runs that failed even after retrying) from the run history the engine already recorded. |
| **Status API** (`status.*`) | `getStatus()` rolls up real queue state + engine stats + active-run count + this Manager's own counters into one snapshot, optionally including Brain's live automation pointer (read-only; the Manager never writes to Brain — that stays `brain-automation-bridge.js`'s job). `getWorkflowStatus(id)` reports a single workflow's in-flight state and last run. |
| **History API** (`history.*`) | Direct passthrough to `AxiomAutomationMemoryBridge`'s `listExecutionHistory`/`getExecutionHistory`/`listActions` — the Manager stores no history of its own. |

## 4. The duplicate-execution guard — the one real addition

`run.start(workflowId, opts)` is now the one place a run actually gets
enqueued through this Manager:

1. Rejects an unknown workflow (`reason: 'unknown-workflow'`) or a
   workflow that isn't published (`reason: 'workflow-not-active'`) —
   before ever touching the queue.
2. Unless `opts.force === true`, scans the engine's own `listRuns()` for
   a run of the same workflow already in `queued`/`running`/`paused` —
   if one is found, the call is refused (`reason: 'duplicate-in-flight'`)
   and the **real** existing run is returned, never a fabricated "busy"
   flag.
3. Only if neither check trips does it call the engine's own
   `enqueueRun()` — the actual queueing, retry-with-backoff, logging,
   and lifecycle are entirely unchanged and still live in
   `automation-engine.js`.

`run.retry(runId, opts)` applies the identical guard to the retried
run's workflow, so rapid repeated retry clicks are refused the same way.

`opts.force: true` is the deliberate escape hatch for a caller that
genuinely wants concurrent runs of the same workflow (e.g. a future
scheduler) — the guard is a default policy, not a hard engine limit.

## 5. Design decisions and why

- **No new storage layer.** Workflows and runs still live only in
  `AxiomAutomationBuilderEngine`'s own persisted state; execution history
  still lives only in `AxiomMemoryEngine` via the Part 3 bridge. The
  Manager holds only small in-memory counters for its own `getStats()`
  (`runsStarted`, `duplicatesBlocked`, `cancelCalls`, `pauseCalls`,
  `resumeCalls`, `retryCalls`) — nothing persisted, nothing that
  survives a reload on its own, because nothing here needs to: the
  engine and the Memory bridge already persist everything durable.
- **Execution Monitor is read-only derivation, not a second state
  machine.** `getRunProgress`/`getActiveRuns` recompute `elapsedMs` and
  `percentComplete` fresh on every call from the run's own
  `startedAt`/`currentStepIndex`/`steps`, so there is no cached snapshot
  that could ever drift from what the engine actually reports.
- **Status API's Brain reference is read-only and optional.** The
  Manager only reads `AxiomBrain.getState().automation` if `AxiomBrain`
  happens to be on the page; it never calls `setState()` on it — writing
  Brain's live pointer remains `brain-automation-bridge.js`'s job alone,
  so there is exactly one writer of that field, matching the ownership
  Part 2 already established.
- **`opts.force` instead of a hard rule.** A blanket "one run per
  workflow, ever" would be a real behavior change to the engine's own
  concurrency model (Part 1 explicitly supports `concurrency > 1`). The
  guard is scoped to the Manager's own enforced entry point, with an
  explicit, honest escape hatch — it changes what happens when code goes
  *through the Manager*, not what the underlying engine is capable of.
- **Reachable without new wiring on other pages**, matching Part 3's own
  reasoning: because the Manager only composes already-loaded globals
  (`AxiomAutomationBuilderEngine`, `AxiomAutomationMemoryBridge`,
  optionally `AxiomBrain`), any page that loads
  `os/core/automation-manager.js` after those gets the full API with no
  further setup.

## 6. Explicitly out of scope for this pass

- **No UI changes.** `automation.html`'s markup,
  `js/pages/automation-runtime-ui.js`, and `js/pages/automation-part9.js`
  are untouched. `#runWorkflowNow` still calls
  `AxiomAutomationBuilderEngine.enqueueRun()` directly today — so the
  existing button does **not** yet benefit from the duplicate-execution
  guard built this pass. Routing that click handler through
  `AxiomAutomationManager.run.start()` instead is a UI change and was not
  requested ("Do NOT change existing UI"); this pass builds and tests the
  Manager as the correct place for that (or any future) caller to run a
  workflow through.
- **No change to `automation-engine.js`, `brain-automation-bridge.js`, or
  `automation-memory-bridge.js`'s own logic.** The Manager only calls
  their existing, unchanged public methods.
- **No AI reasoning, scoring, or prediction over runs.** Execution
  Monitor and Status API compute plain arithmetic over fields the engine
  already reports — nothing is summarized, ranked, or inferred.
- **No change to the unrelated agent-collaboration workflow system**
  (`os/runtime/capabilities/workflows.js`) or the separate Milestone 13
  `os/runtime/automation/automation-engine.js`
  (`AxiomAutomationEngine`) used by `os-shell.html` — same boundary
  reaffirmed in Parts 1-3.

## 7. Validation

`test-evidence/block2-step4-part4-automation-manager-regression-suite.js`
loads the real, unmodified `memory-engine.js`, `automation-engine.js`,
`automation-memory-bridge.js`, and `automation-manager.js` in the same
hand-rolled Node `vm` sandbox used by the Part 2/3 suites, and drives
everything through `AxiomAutomationManager`'s own public API. 39 checks,
all passing (`-output.txt` alongside it):

- Workflow Manager passthrough: create/publish/get behave exactly like
  the underlying engine; `run.start` on a draft workflow is refused
  (`workflow-not-active`) and on an unknown id is refused
  (`unknown-workflow`) before ever touching the queue.
- A normal `run.start()` genuinely executes through the real engine and
  reaches a real terminal status.
- **The core objective:** simulating a double-click of "Run Now" — a
  second `run.start()` call on the same workflow while the first run is
  still in flight is refused with `duplicate-in-flight` and returns the
  real existing run; the engine itself is checked directly afterward to
  confirm only one in-flight run for that workflow was ever enqueued.
  `opts.force: true` is confirmed to genuinely bypass the guard when
  used.
- `run.retry()` carries the identical duplicate guard, applied to the
  retried run's own workflow.
- `run.cancel`/`pause`/`resume` are confirmed to reach the real engine
  (the run genuinely reaches `paused`, then `cancelled`).
- Execution Monitor: `getRunProgress` reports the real step count and a
  real non-negative elapsed time while a run is in flight, and returns
  `null` once the run is no longer in flight — not a stale snapshot.
  `getErrorRecoveryStats` returns real, non-negative derived counters.
- Status API: `getStatus()`'s queue/engine numbers are checked directly
  against the engine's own `getQueueState()`/`getStats()`; the
  duplicate-guard counter is confirmed `> 0` after the double-click test.
  `getWorkflowStatus()` is checked for both a settled workflow and an
  unknown id (returns `null` rather than throwing).
- History API: `listExecutionHistory`/`getExecutionHistory` are confirmed
  to return the real records the Part 3 bridge itself stored — the
  Manager is proven to store no history of its own.
- `getStats()`, `onChange()` (real engine pub/sub passthrough), and
  `destroy()` (no-op-safe, Manager remains usable afterward).

Re-ran `test-evidence/block2-step4-part1-automation-foundation-regression-suite.js`
(17 checks), `test-evidence/block2-step4-part2-brain-automation-integration-regression-suite.js`
(29 checks), `test-evidence/block2-step4-part3-automation-memory-integration-regression-suite.js`
(30 checks), and all three existing Memory suites — foundation (35
checks), brain-memory (28 checks), memory-manager (30 checks) —
afterward. All still pass, confirming this pass introduced no regression
to any engine, bridge, or manager it depends on.
