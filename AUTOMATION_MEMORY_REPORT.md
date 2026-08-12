# AXIOM — Automation Memory Integration Report
### Phase 10 · Part 2 · Block 2 · Step 4 · Part 3

**Date:** 2026-07-31
**Scope:** Persist automation history — workflow execution history,
results, errors, runtime, metadata, and user actions — into
`AxiomMemoryEngine` (`os/core/memory-engine.js`), and support browsing
that history. No vector memory. No AI reasoning. No UI changes.
**Role:** Senior AI Automation Architect.

---

## 1. State before this pass

Part 1 built the automation execution engine (storage, queue, run
lifecycle, retries, cancellation, logging). Part 2 connected that engine
to the Brain so the shared AI-state object reflects live run activity —
but the Brain only ever holds **one** live-status pointer, the same way
`activity`/`mood` represent "what's happening right now" for the AI
pipeline. The moment a second run started, the first run's outcome was
gone from Brain state; nothing durable remembered what actually happened,
what it produced, what failed, how long it took, or that a person had
paused and resumed it partway through.

Separately, the Memory Foundation (`os/core/memory-engine.js`, Block 2 ·
Step 3 · Part 1) already has a real, persisted, non-semantic store —
`addMemory`/`queryMemories`/`getMemory` — and a stable read layer in front
of it (`os/core/memory-manager.js`, Block 2 · Step 3 · Part 3,
`findMemories`/pagination/sorting). Before this pass, Automation and
Memory had never spoken to each other at all.

## 2. Audit before writing any code — was there a gap to fill first?

Following the same discipline as Part 2 (audit the objective against the
real engine before assuming a connector alone is enough), this pass
checked whether `AxiomAutomationBuilderEngine`'s existing public API
(`onChange`, `listRuns`) and `AxiomMemoryEngine`'s existing public API
(`addMemory`, `queryMemories`, `getMemory`) already carried everything the
objective needs.

They did. Unlike Part 2 (where "paused" genuinely did not exist anywhere
in the run lifecycle), every piece of history this pass needs to persist —
results, errors, runtime, metadata, and the real pause/resume
transitions — is already a real, observable field on the run object the
engine emits via `run:update`. **No engine change was required this
pass.** The only real gap was the missing connector itself.

## 3. What was built

**`os/core/automation-memory-bridge.js`** (new module —
`window.AxiomAutomationMemoryBridge`)

A connector, following the same producer/consumer shape as
`brain-automation-bridge.js` and `brain-memory-bridge.js`: it subscribes
to `AxiomAutomationBuilderEngine.onChange()` and writes only what the
engine actually reported into `AxiomMemoryEngine`, using the engine's own
`addMemory`/`queryMemories`/`getMemory` API — no new storage primitive,
no new persistence layer.

| Objective item | Real source | Where it lands |
|---|---|---|
| Workflow execution history | `run:update` with a terminal status (`success`/`failed`/`cancelled`) | One `automation-run` Memory record per run, id `automation-run:<runId>` |
| Results | `run.steps` (per-step `status`/`attempts`/`result`) | `data.steps[]` on the run's record |
| Errors | `run.error` (run-level) + each failed step's own `step.error` | `data.error` and `data.steps[].error` |
| Runtime | `run.startedAt`/`run.finishedAt`/`run.duration`, taken verbatim | `data.duration` (never recomputed or estimated) |
| Metadata | `run.id`/`run.workflowId`/`run.workflowName`/`run.trigger`/`run.queuedAt`/step count | `data.*` on the run's record |
| User actions | Real `paused` events and real paused→running (resume) transitions | Separate `automation-action` records, one per real occurrence |

## 4. Design decisions and why

- **One record per run, written once, at the real terminal transition —
  not one record per step or per queue tick.** The run object already
  carries its own complete step-by-step detail; re-emitting that detail as
  N separate Memory writes would be redundant bookkeeping, not a truer
  history. This also keeps Memory from being spammed by every intermediate
  `queued`/`running` tick, which is exactly what Brain's live pointer
  (Part 2) already exists to reflect moment-to-moment.
- **Stable record ids, not append-only logs.** `automation-run:<runId>`
  means `AxiomMemoryEngine.addMemory()` — which keys its store by id —
  overwrites in place if the same terminal event is ever observed twice,
  rather than creating a duplicate history row. This is also what makes
  backfilling safe (see below): a bridge instance can re-scan all of the
  engine's runs on every page load and only ever produce one record per
  run, never accumulate duplicates across reloads.
- **Cancellation is not a fabricated standalone action.** `cancelRun()` on
  a `'running'` or `'paused'` run does not itself emit an event — the
  engine only emits the eventual terminal `run:update` once the run has
  actually unwound (see `brain-automation-bridge.js`'s own note on this).
  Rather than inventing a "cancel requested" action the engine never
  reported, a cancellation is captured as the `status: 'cancelled'` value
  on that run's own terminal history record — an honest reflection of
  what the engine actually emitted, not an assumed intermediate step.
- **Pause and resume ARE real, separately observable events**, and are
  recorded as their own `automation-action` records (not folded into the
  final terminal record) because a single run can genuinely be paused and
  resumed more than once before it finishes — each occurrence is a
  distinct, real action worth keeping in a browsable action history, with
  the real step it happened at (`atStepLabel`) rather than a rounded
  "somewhere in the middle" description.
- **No vector memory, no embeddings, no semantic search, no AI reasoning
  over history** — `listExecutionHistory`/`getExecutionHistory`/
  `listActions` do plain equality filtering, sorting, and pagination, the
  same non-semantic retrieval `AxiomMemoryEngine`/`AxiomMemoryManager`
  already provide for every other memory record. Nothing here summarizes,
  scores, or infers anything about a run beyond what it literally
  reported.
- **Reachable without new wiring on other pages.** Because history is
  stored through the standard `AxiomMemoryEngine.addMemory`/
  `queryMemories` API (same `localStorage` namespace, `axiom:memory:v1:*`,
  already read by `os/core/memory-manager.js` on `memory.html`), a caller
  on *any* page that already loads the Memory engine can browse this
  history via `AxiomMemoryManager.findMemories({ type: 'automation-run' })`
  today, with no further changes to `memory.html` needed for basic
  browsing. The bridge's own `listExecutionHistory`/`listActions` exist as
  a purpose-built convenience layer (workflow/status filters, pagination)
  for wherever a future UI wants it.
- **Seeding on load.** Because `AxiomAutomationMemoryBridge` might not be
  the thing that was subscribed when an earlier run actually finished
  (e.g. it's newly added this pass, or a run was recovered as `'failed'`
  by the engine's own crash-recovery pass on `init()` before this bridge
  existed on the page), it backfills by scanning
  `Engine.listRuns({ limit: 200 })` once at startup and writing a history
  record for any run already in a terminal state. The stable-id overwrite
  guarantees this can never produce a duplicate.

## 5. Validation

`test-evidence/block2-step4-part3-automation-memory-integration-regression-suite.js`
loads the real, unmodified `memory-engine.js`, `automation-engine.js`, and
`automation-memory-bridge.js` in a hand-rolled Node `vm` sandbox (same
pattern as the Part 2 suite) and drives them through the engines' real
public APIs — no direct calls into `AxiomMemoryEngine.addMemory()` to fake
a result. 30 checks, all passing (`-output.txt` alongside it):

- A genuinely successful run produces exactly one `automation-run` record
  with the real workflow id/name, the real terminal status, a real
  non-zero runtime, both real per-step outcomes, and no ttl (durable).
- A run whose `Condition` step genuinely evaluates false (a real,
  non-retryable failure) produces a record carrying the real run-level
  error string and the real failing step's own error — not a generic
  message — and is recorded with higher importance than the successful
  run.
- A real pause produces exactly one `paused` action record naming the
  real step it paused at; a real resume produces exactly one `resumed`
  action record; cancelling that same run afterward lands inside its own
  terminal history record rather than producing a fabricated standalone
  "cancelled" action.
- `listExecutionHistory` filters correctly by real workflow id and by
  real terminal status, and paginates (`limit` respected, `total` still
  accurate).
- Stable-id overwrite: re-writing the same `automation-run:<runId>` id
  never increases the total record count, and `getMemory` still resolves
  a single record.
- A freshly-loaded second bridge instance, pointed at the same
  already-populated engine and Memory store, backfills an existing
  terminal run's history via its own seed pass — proving history
  survives independent of which bridge instance was listening when the
  run actually finished.
- `getStats()` and `destroy()` (no further runs recorded after teardown).

Re-ran `test-evidence/block2-step4-part1-automation-foundation-regression-suite.js`
(17 checks), `test-evidence/block2-step4-part2-brain-automation-integration-regression-suite.js`
(29 checks), and all three existing Memory suites —
`block2-step3-part1-memory-foundation-regression-suite.js` (35 checks),
`block2-step3-part2-memory-integration-regression-suite.js` (28 checks),
and `block2-step3-part3-memory-manager-regression-suite.js` (30 checks) —
afterward. All still pass, confirming this pass introduced no regression
to any engine, bridge, or manager it depends on.

## 6. Explicitly out of scope for this pass

- No history-browsing UI added to `automation.html`'s run-history table or
  to `memory.html` (`js/pages/automation-runtime-ui.js` and
  `js/pages/memory-ultimate.js` are untouched) — this pass adds the real
  persistence and a stable, tested read API for it; a control surface to
  browse it in either page's existing markup is a UI task, not a
  "connect" task, and was not requested.
- No vector search, embeddings, or semantic memory of any kind — per
  spec, and consistent with `AxiomMemoryEngine`'s and
  `AxiomMemoryManager`'s own explicitly-scoped-out semantic/embedding
  features.
- No AI reasoning, summarization, or scoring of stored history beyond the
  fixed, deterministic importance value already assigned by run status
  (failed > cancelled > success) — mirroring the fixed-weight pattern
  `brain-memory-bridge.js` already uses for its own lifecycle records.
- No change to Brain's own live `automation` status pointer
  (`os/core/brain-automation-bridge.js`, Part 2) — Brain continues to
  reflect only the single most-recently-observed run; this pass gives
  every run's outcome a separate, durable home instead of changing what
  Brain itself tracks.
- No change to the unrelated agent-collaboration workflow system in
  `os/runtime/capabilities/workflows.js`, or to the separate Milestone 13
  `os/runtime/automation/automation-engine.js` (`AxiomAutomationEngine`)
  used by `os-shell.html` — as documented in `AUTOMATION_FOUNDATION.md`
  and reaffirmed in Part 2, that is a different subsystem and remains
  untouched.
