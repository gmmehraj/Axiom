# AXIOM Automation Engine Foundation
### Block 2 / Step 4 / Part 1
Role: Senior AI Automation Architect
Scope: Automation execution engine only — no UI redesign, no new automation
features, no unrelated pages touched, no external integrations.

---

## 1. Audit — what was actually there

The Automation page (`automation.html` + `js/pages/automation-part9.js`)
looked fully featured — a drag-and-drop workflow canvas, an integrations
grid, an API Builder, a Webhook Builder, stat cards, and a run-history
table — but underneath, execution itself was entirely cosmetic.

| Area | Finding |
|---|---|
| Workflow architecture | None. The canvas held 4 hardcoded `.ax-workflow-node` elements in the raw HTML. Dragging a new node from the palette appended a DOM element (`addNode()` in `automation-part9.js`) — nothing was ever captured as structured data. |
| Execution engine | None. There was no code path that "ran" a workflow at all. |
| Trigger system | Cosmetic only. Trigger-type nodes (Schedule, Webhook, File Upload, AI Event) existed as palette items and canvas labels; nothing scheduled anything or listened for anything. |
| Action system | Cosmetic only. Action-type nodes (AI Generate, API Call, Send Email, Save File, and the per-integration nodes) were static labels with a `node-desc` string; no code executed any of them. |
| Workflow state | None. A workflow had no identity, no draft/active status, and no persistence — reloading the page reset the canvas to the same 4 hardcoded nodes every time. |
| Placeholder workflows | The 4 default canvas nodes ("Scheduled Trigger", "Condition: New Files", "AI Analyze Content", "Save to Workspace") were static markup, not a real workflow record. |
| Mock execution | `initPublish()` bound a click handler to `#publishWorkflow` that did exactly one thing: `toast('Workflow published')`. No workflow was stored, validated, or run. |
| Error handling | None to have an opinion on — nothing executed, so nothing could fail. |
| Retry handling | None, for the same reason. |
| "Recent Workflow Runs" table | 5 hardcoded `<tr>` rows in `automation.html` (`Weekly Report Generation` / `Success` / `4.2s` / ... etc.) — fixed content that never changed regardless of anything a user did. A dormant `#axRunsEmpty` empty-state div existed with `hidden` and no code that ever toggled it. |
| Stat cards | 3 hardcoded numbers (`6` active workflows, `1,438` runs today, `12` failed runs) with fixed trend arrows (`↑ 23%`, `↑ 3`) — decorative text, not derived from anything. |

Elsewhere in the codebase, `os/runtime/capabilities/workflows.js` (from an
earlier milestone) implements a *different* kind of "workflow" — named,
hardcoded multi-agent collaboration sequences (`researchAndRemember`,
`documentWorkflow`, `developmentWorkflow`) dispatched over the
task-router/agent-manager event bus. That system is real and already
exercises its own execution path, but it is unrelated to the visual,
user-authored workflows on the Automation page and is not touched by this
pass.

Separately, `os/runtime/automation/automation-engine.js` (Milestone 13)
already defines a real, working `window.AxiomAutomationEngine` — a
trigger+workflow binding layer on top of `AxiomWorkflowEngine` and
`AxiomTriggerScheduler` — but it, and its dependencies, are only loaded by
`os-shell.html`, never by `automation.html`. `automation.html` is embedded
into the OS shell as an iframe (`os/workspaces/automation.js`), so even
there the two never share a `window`. To avoid any ambiguity for future
work (e.g. if someone later loads both scripts on the same page), the new
module built here is named `window.AxiomAutomationBuilderEngine` rather
than reusing `AxiomAutomationEngine` — it is a different concept (an
ad-hoc, canvas-authored workflow with its own execution queue) and keeping
the names distinct avoids a silent last-script-wins collision later.

## 2. What was built

A new module, **`os/core/automation-engine.js`**, exposing
`window.AxiomAutomationBuilderEngine`. It follows the same architectural
convention already established by `os/core/memory-engine.js`: a narrow,
documented public API; internal state; a pub/sub layer for consumers;
localStorage as the persistence backend, namespaced (`axiom:automation:v1:`)
and schema-versioned so the backend can be swapped later without callers
changing.

### Workflow storage
`createWorkflow()` / `updateWorkflow()` / `publishWorkflow()` /
`getWorkflow()` / `listWorkflows()` / `deleteWorkflow()` give a workflow a
real identity: an id, a name, an ordered `steps` array, a `draft` / `active`
status, and `createdAt` / `updatedAt` timestamps, all persisted.

### Execution queue
A FIFO queue (`pendingQueue`) with bounded concurrency (`concurrency`,
default 2, configurable via `init({ concurrency })`). `enqueueRun()` always
creates the run in `queued` state and returns immediately; a `pump()` loop
pulls queued runs into execution only while a concurrency slot is free, so
a burst of runs genuinely waits its turn rather than firing all at once.

### Task/run lifecycle
Each run is one state machine: `queued` → `running` → `success` / `failed`
/ `cancelled`. `executeRun()` walks the workflow's steps in order; a run
only reaches `success` if every step's handler actually resolved. A step
that exhausts its retries throws, and the run is marked `failed` with the
real error message attached — there is no path that marks a run
successful without every step having actually run.

### Execution state
`getRun(id)` / `listRuns(filter)` expose per-run status, `queuedAt` /
`startedAt` / `finishedAt` / `duration`, a `currentStepIndex` pointer, and
per-step `status` / `attempts` / `result` / `error`. `getQueueState()`
reports live `pending` / `running` / `concurrency` counts and `getStats()`
reports `activeWorkflows` / `totalRunsToday` / `failedRunsToday` /
`runningNow` — all derived from real state, not fixed numbers.

### Cancellation
Cancellation is cooperative, via a per-run `cancelToken`: `cancelRun()` on
a still-queued run removes it from the queue immediately and marks it
`cancelled`; on a running run it sets `_cancelRequested` and triggers the
token, which rejects the step's in-flight wait so execution actually stops
between (or inside) steps rather than only relabeling a run that keeps
running in the background.

### Error recovery
Steps whose type stands in for a network-backed action (`API Call`,
`Webhook`, `AI Generate`, `Send Email`, `GitHub`, `Slack`, `Google Drive`,
`WhatsApp`) get one retry with a short backoff if the first attempt throws.
`retryRun(runId)` re-queues a brand-new run cloned from a failed or
cancelled run's workflow and input data — the original run record is left
untouched as history.

### Logging
Every run carries a capped, structured `logs` array
(`{ ts, level, message }`) covering: queued, started, each step attempt,
retry-with-reason, per-step success/failure, cancellation, and final
completion — enough to reconstruct what happened without re-running
anything.

### Crash/reload honesty
`init()` scans persisted runs on load; any run still `queued` or `running`
from a previous page load (the tab was closed or reloaded mid-run) is
marked `failed` with an explicit "Interrupted" reason and logged — never
silently reported as successful, and never silently resumed into the live
queue.

### Simulated action layer (explicitly not real integrations)
Per the spec, no external integration is called yet. Each step still does
real, bounded-latency async work and a retryable step can genuinely throw
(`seedFail` in tests forces this deterministically) — so the *engine*
itself (queueing, lifecycle, retries, cancellation, logging, honesty about
failure) is exercised for real, even though the network calls the action
layer stands in for are not.

## 3. UI wiring

**`js/pages/automation-runtime-ui.js`** (new) bridges the engine to the
existing markup without changing the canvas, tabs, integrations grid, API
Builder, or Webhook Builder:
- Publish: reads the live `.ax-workflow-node` elements off the canvas,
  persists them through the engine as a workflow (creating one the first
  time, updating it thereafter), and marks it `active`.
- A new "Run Now" button (disabled until a workflow is published) calls
  `enqueueRun()`.
- The "Recent Workflow Runs" table is rendered from `listRuns()` — the 5
  hardcoded rows are gone; the table starts empty and the existing
  (previously dead) `#axRunsEmpty` state now actually shows/hides.
- Per-run Cancel / Retry buttons call `cancelRun()` / `retryRun()`.
- The 3 stat cards are re-rendered from `getStats()` / `getQueueState()`
  on every engine change.

**`js/pages/automation-part9.js`** — one function changed: `initPublish()`
no longer hardcodes a toast; it dispatches an
`axiom:automation:publish-request` event that the new bridge handles. The
canvas, tabs, integrations, API Builder, and Webhook Builder logic in this
file is untouched.

**`automation.html`** — script tags added for the new engine and bridge
(in the same script block as the other `os/core` engines, before the
`js/pages` block); the 5 hardcoded run rows replaced with an empty,
JS-populated `<tbody>`; an "Actions" column added for Cancel/Retry; the 3
stat-card numbers given ids for live updates; one new "Run Now" button.
No layout, styling, or visual redesign.

## 4. Explicitly out of scope (per spec)

- Real external integrations (Slack, GitHub, Email, WhatsApp, Google
  Drive, actual webhooks/API calls over the network).
- Any change to the canvas, tabs, integrations grid, API Builder, or
  Webhook Builder markup or behavior.
- New automation features beyond what's needed to make execution real
  (queue, lifecycle, cancellation, retry, logging) — no new node types,
  no new page sections.
- The unrelated agent-collaboration workflow system in
  `os/runtime/capabilities/workflows.js`.

## 5. Validation

`test-evidence/block2-step4-part1-automation-foundation-regression-suite.js`
loads the real, unmodified `os/core/automation-engine.js` in a Node `vm`
sandbox (same pattern as the Memory Part 1/2/3 suites) with **real timers**
— no stubbed/instant execution — and passes 17/17:

- Public API surface present.
- Clean init with zero workflows/runs.
- Workflow create / update / publish.
- A workflow with no steps cannot be run.
- A full run genuinely transitions `queued` → `running` → `success`, with
  real timestamps, duration, and logs, and every step marked `success`.
- A step forced to fail its first attempt is retried and the run reflects
  the real retry (not a silently-passed first try).
- An unmet condition step fails the run honestly, with a real error.
- Cancelling a still-queued run stops it before it ever executes.
- Cancelling a running run stops it cooperatively mid-flight.
- Retrying a failed/cancelled run enqueues a genuinely new run.
- Queue state reports live counts.
- Workflow deletion, export/import round-trip.
- Full state (workflows + run history) survives a simulated reload.
- A run interrupted mid-flight (simulated tab close) is recovered on
  reload as `failed` with an "interrupted" reason — never as a fake
  success.

Output: `test-evidence/block2-step4-part1-automation-foundation-regression-output.txt`.

No console errors were introduced; `node --check` passes on all three
touched/added JS files (`os/core/automation-engine.js`,
`js/pages/automation-runtime-ui.js`, `js/pages/automation-part9.js`).
