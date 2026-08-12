# Test Evidence

These are the actual scripts used to verify each milestone/phase/block, not
just a summary of results. They load the real, unmodified runtime files from
this project (via jsdom, headless — no browser needed) and drive them exactly
the way the OS shell / Playground chat does.

## Block 2 / Step 4 / Part 3 — Connect Memory to Automation

```
node test-evidence/block2-step4-part3-automation-memory-integration-regression-suite.js
```

Same hand-rolled `vm` sandbox as the Part 2 suite. Loads the real,
unmodified `os/core/memory-engine.js`, `os/core/automation-engine.js`, and
`os/core/automation-memory-bridge.js` and drives them through the engines'
real public APIs — no shortcuts into `AxiomMemoryEngine.addMemory()` to
fake a result. Covers a genuinely successful run's stored results/runtime,
a genuinely failing run's real run- and step-level errors, pause/resume
each producing their own action record with the real step it occurred at,
a cancellation being captured inside the run's own terminal record rather
than a fabricated standalone action, workflow/status filtering and
pagination, stable-id overwrite idempotency, and a freshly-loaded bridge
instance backfilling existing terminal runs on seed. 30 checks, all
passing. Full findings in `../AUTOMATION_MEMORY_REPORT.md`.

## Block 2 / Step 3 / Part 1 — Build the Memory Foundation

```
node test-evidence/block2-step3-part1-memory-foundation-regression-suite.js
```

Same hand-rolled `vm`-based shim as the Brain suite below (in-memory
`localStorage`, no network access needed). Loads the real, unmodified
`os/core/memory-engine.js` and drives its public API directly: session
creation/resumption/heartbeat, conversation history (ordering, message
indexing, the 500-message lifecycle cap), memory CRUD and metadata
(importance/confidence/tags/access tracking), the tag/agent/project/type
indices, TTL-based cleanup of ephemeral memories, working-memory state,
pub/sub change notifications, export/import round-tripping, and — to prove
data actually goes through the storage layer rather than an in-process
array — a second, independent engine instance reading the same
`localStorage` back after the first instance writes to it. 35 checks, all
passing. Full findings in `../MEMORY_FOUNDATION.md`.

## Block 2 / Step 2 / Part 2 — Connect the Brain to the AI

```
node test-evidence/block2-step2-part2-brain-integration-regression-suite.js
```

No `npm install` needed — this sandbox has no network access to fetch
`jsdom`, so this one suite uses a small hand-rolled DOM/window shim (via
Node's built-in `vm` module) instead: in-memory `localStorage`, an
`EventTarget`-style `addEventListener`/`dispatchEvent`, and a minimal
`CustomEvent`. It loads the real, unmodified `os/core/axiom-brain.js` and
`js/core/ai-state-manager.js` and drives them with the exact event shapes the
real runtime produces — `axiom:agent-event` envelopes mirroring the Agent
Event Bus's `capability:*`/`conversation:*` events, and `axiom:model-changed`
the way `model-selector.js` dispatches it — then asserts `AxiomBrain` ends up
in the right state. 28 checks, all passing. Full findings in
`../BRAIN_INTEGRATION_REPORT.md`.

## Block 2 / Step 1 — Coding Agent stabilization

```
npm install jsdom --no-save
node test-evidence/block2-step1-coding-agent-regression-suite.js
```

`block2-step1-coding-agent-regression-suite.js` / `-output.txt` — loads
agent-runtime.js, coding-agent.js, coding-toolkit.js, and agent-manager.js,
mocks the real `window.OpenRouter.streamChat` client shape (not the
`OpenRouterClient`/`AxiomOpenRouter` names the old code incorrectly looked
for), and verifies: correct init, the `generate`/`explain-code` ops actually
reach a live client, exactly one client call per task (no duplicates), two
queued tasks never run concurrently (no overlap), cancellation actually
aborts the in-flight request, and both the no-client and unsupported-op
paths fail gracefully instead of throwing. Full findings and rationale are
in `../CODING_AGENT_AUDIT.md`.

## Milestone 5 — Test Evidence

These are the actual scripts used to verify Milestone 5, not just a summary
of results. They load the real, unmodified runtime files from this project
(via jsdom, headless — no browser needed) and drive them exactly the way the
OS shell / Playground chat does.

## Run them yourself

```
npm install jsdom --no-save
node test-evidence/milestone5-regression-suite.js     # 23 functional checks + Milestone 4's own self-test
node test-evidence/milestone5-manual-commands.js       # the 7 phrases from the milestone review
```

## Files

- `milestone5-regression-suite.js` / `-output.txt` — loads agent-runtime.js,
  agent-definitions.js, the four capability files, task-router.js,
  agent-manager.js, and runtime-bootstrap.js, then exercises every Browser/
  Memory/Planner/File Agent operation, the collaboration workflow, error
  handling, and cancellation. Mocks only the Supabase-backed pieces
  (`AxiomAgents`, `FileProcessing`) so it tests OUR code, not the DB.
- `milestone5-manual-commands.js` / `-output.txt` — runs the exact 7 phrases
  requested in review ("Open YouTube", "Remember: Buy milk tomorrow", etc.)
  through `AxiomTaskRouter.route()` + `AxiomAgentManager.dispatch()`, the
  same path a real chat message takes after the `app.js` wiring.
