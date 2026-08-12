# AXIOM — Automation Integration Report
### Phase 10 · Part 2 · Block 2 · Step 4 (Part 2)

**Date:** 2026-07-31
**Scope:** Connect `AxiomBrain` (`os/core/axiom-brain.js`) to
`AxiomAutomationBuilderEngine` (`os/core/automation-engine.js`, built in
Part 1) so the Brain receives live automation-workflow events — Automation
Engine as producer, Brain as consumer. No UI redesign, no new pages, no
change to the visual workflow builder or `automation.html`'s markup.
**Role:** Senior AI Automation Architect.

---

## 1. State before this pass

Part 1 built a real automation foundation: workflow storage, a
bounded-concurrency execution queue, a `queued -> running -> success /
failed / cancelled` run lifecycle, cooperative cancellation, retries with
backoff, structured logging, and an `onChange(fn)` pub/sub layer — all
exposed as `window.AxiomAutomationBuilderEngine`. Separately, the Brain
(`os/core/axiom-brain.js`) already reflects live AI-pipeline state
(`activity`, `activeModel`, `activeConversationId`, `toolActive`/
`activeTool`), and, as of Block 2 · Step 3 · Part 2, already reflects live
Memory activity too.

Before this pass, nothing connected the two: a workflow could be enqueued,
run, retry, fail, or get cancelled, and the Brain — and every widget that
reads from it — had no way of knowing. `AxiomAutomationBuilderEngine` and
`AxiomBrain` were loaded on the same page (`automation.html`) but never
spoke to each other.

## 2. A genuine gap found during audit — "paused" did not exist

The objective for this pass requires seven live signals: workflow started,
running, **paused**, completed, failed, cancellation, and queue updates.
Auditing Part 1's run state machine before writing any connector code
turned up a real gap: **there was no pause concept anywhere in the run
lifecycle.** A run could only ever be `queued`, `running`, `success`,
`failed`, or `cancelled` — there was nothing for a "workflow paused" event
to honestly report, because the underlying engine could never actually
enter that state.

Rather than have the Brain expose a `paused` status that could never fire
(a fabricated indicator by another name), this pass made the minimal, real
addition needed to close the gap: `pauseRun(runId)` / `resumeRun(runId)`
on `AxiomAutomationBuilderEngine`, described in full in
`CHANGELOG.md`. The design deliberately mirrors the cooperative pattern
Part 1 already established for cancellation — a pause is only ever applied
at a step boundary (never mid-step), and the run's status only flips to
`'paused'` once it has actually stopped advancing, not the instant
`pauseRun()` is called. Everything else about Part 1's engine (storage,
queueing, retries, logging, crash recovery) is unchanged.

## 3. What was built

**`os/core/brain-automation-bridge.js`** (new module —
`window.AxiomBrainAutomationBridge`)

A connector, following the same shape as the existing
`os/core/brain-memory-bridge.js`: it subscribes to
`AxiomAutomationBuilderEngine.onChange()` and writes only what the engine
actually reported into a new `automation` field on `AxiomBrain`'s state.
It never invents a status, run, or workflow.

| Objective item | Real source event |
|---|---|
| Workflow started | `run:create` (`run.status === 'queued'`, or `'running'` if a concurrency slot was free immediately) |
| Workflow running | `run:update` with `run.status === 'running'` |
| Workflow paused | `run:update` with `run.status === 'paused'` — only possible now that `pauseRun()`/`resumeRun()` exist |
| Workflow completed | `run:update` with `run.status === 'success'` |
| Workflow failed | `run:update` with `run.status === 'failed'` |
| Cancellation | `run:update` with `run.status === 'cancelled'` |
| Queue updates | `queue` (`engine.getQueueState()`: `pending` / `running` / `concurrency`, recomputed by the engine itself on every `pump()` cycle) |

**`os/core/axiom-brain.js`** — extended, not replaced

Added one new field to `DEFAULT_STATE`, additive alongside the existing
AI-pipeline fields:

```js
automation: {
  status: 'idle',   // idle | queued | running | paused | success | failed | cancelled
  runId: null,
  workflowId: null,
  workflowName: null,
  queue: { pending: 0, running: 0, concurrency: 0 }
}
```

**`automation.html`** — one script tag added

`os/core/brain-automation-bridge.js` is loaded immediately after
`os/core/automation-engine.js` (with `os/core/axiom-brain.js` already
loaded earlier on the page), so the bridge can subscribe as soon as both
real modules exist.

## 4. Design decisions and why

- **One live-status pointer, not a duplicate run store.** Brain.automation
  always reflects the single most-recently-observed run event, the same
  way `activity`/`mood` already represent "what's happening right now" for
  the AI pipeline rather than a full history. Full per-run detail remains
  available from `AxiomAutomationBuilderEngine.listRuns()` for any UI that
  needs it — the Brain is a status signal, not a second database.
- **No fabricated events.** `workflow:create` / `workflow:update` /
  `workflow:delete` / `init` / `import` are workflow-*definition*
  bookkeeping, not live run activity, and are deliberately not surfaced on
  the Brain — the objective asked for the Brain to monitor automation
  *workflows running*, not the workflow catalog.
- **De-duplication.** A `run:update` is only written to the Brain when the
  run's status actually changed since the last write for that run id, so a
  redundant emit never produces a spurious Brain `change` tick. Queue
  counts, in contrast, are written on every real `queue` event, since
  "still 0 pending" across ticks is accurate current state, not a
  duplicate.
- **Cancelling a paused run.** `cancelRun()` was extended to handle the new
  `'paused'` status: cancelling a parked run wakes it via its pause-wait
  promise so it can observe the cancellation and unwind, rather than
  leaving it stuck paused forever. Verified in regression test #7.
- **Crash/reload honesty extended to `paused`.** A run left `'paused'` from
  a previous page load (tab closed while parked) is now recovered on
  `init()` as `'failed'` with an explicit "interrupted" reason — the same
  honesty rule Part 1 already applied to `queued`/`running` runs — rather
  than silently resumed or silently reported as successful.

## 5. Validation

`test-evidence/block2-step4-part2-brain-automation-integration-regression-suite.js`
loads the real, unmodified `axiom-brain.js`, `automation-engine.js`, and
`brain-automation-bridge.js` in a hand-rolled Node `vm` sandbox (same
pattern as the Block 2 · Step 2 · Part 2 and Block 2 · Step 3 · Part 2
suites) and drives them through the engine's real public API — no direct
calls into `AxiomBrain.setState()` to fake a result. 29 checks, all
passing (`-output.txt` alongside it):

- Started / running / completed, driven by a real two-step workflow run.
- Paused: a pause request only takes effect at the next step boundary; the
  run's `currentStepIndex` genuinely stops advancing while parked; resume
  continues from the correct step and every step still actually runs.
- Failed: a run whose `Condition` step genuinely evaluates false (a real,
  non-retryable failure per the engine's own deterministic Condition
  handling) reaches `'failed'` on both the engine and the Brain.
- Cancellation, including cancelling a run that is currently paused.
- Queue updates under concurrency 1 with a 3-run burst: Brain's
  `pending`/`running` counts match `engine.getQueueState()` exactly at
  every point checked, including draining back to `0`/`0`.
- `pauseRun()` on an already-settled run is rejected, not silently
  accepted.
- Bridge `getStats()` and `destroy()` (no further Brain writes after
  teardown).

Re-ran `test-evidence/block2-step4-part1-automation-foundation-regression-suite.js`
after the `pauseRun`/`resumeRun` addition — all 17 original checks still
pass, confirming no regression to Part 1's storage, queueing, retry,
cancellation, or crash-recovery behavior.

## 6. Explicitly out of scope for this pass

- No changes to the Automation page's visual builder, canvas, or run
  history table (`js/pages/automation-runtime-ui.js` is untouched).
- No pause/resume button added to the Automation page UI — this pass adds
  the real engine capability and connects it to the Brain; exposing a
  control for it in `automation.html` is a UI task, not a "connect"
  task, and was not requested.
- No change to the unrelated agent-collaboration workflow system in
  `os/runtime/capabilities/workflows.js`, or to the separate Milestone 13
  `os/runtime/automation/automation-engine.js` (`AxiomAutomationEngine`)
  used by `os-shell.html` — as documented in `AUTOMATION_FOUNDATION.md`,
  that is a different subsystem and remains untouched.
- No writes from automation events into `AxiomMemoryEngine` — the
  objective for this pass is Brain monitoring of automation, not a new
  Memory feature; `brain-memory-bridge.js` is unmodified.
