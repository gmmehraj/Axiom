# AXIOM — Brain Integration Report
### Phase 10 · Part 2 · Block 2 · Step 2 (Part 2)

**Date:** 2026-07-31
**Scope:** Connect `AxiomBrain` (`os/core/axiom-brain.js`) to real AI runtime
events — request lifecycle, streaming, tool/capability execution, active
model, active conversation — and remove any fabricated activity that wasn't
backed by a real event. No visual redesign, no new pages.
**Role:** Senior AI Systems Engineer.

---

## 1. What was already real vs. what wasn't

Before touching anything, this pass audited every consumer/producer around
the Brain to find out how much of "connect the Brain to the AI" was already
done by earlier milestones, and where the gaps actually were.

**Already real (built in Milestone 3 / 4 / 5 / 10, unchanged here):**

| Objective item | Already wired via |
|---|---|
| AI request started | `AxiomConversationBridge.startStream()` → `AxiomAIState` → `AxiomBrain.setState({activity:'thinking'})` |
| Streaming started / progress | `AxiomConversationBridge.chunkStream()` → `'speaking'` |
| Response completed | `AxiomConversationBridge.completeStream()` → `'idle'`/`'heavy'` |
| Response cancelled | `AxiomConversationBridge.cancelStream()` → settle state |

These are driven by `js/bridges/conversation-bridge.js`'s real stream
lifecycle (used by the Playground chat) and relayed through
`js/core/ai-state-manager.js`, the canonical coordinator introduced in
Milestone 3. Nothing here needed to change — it already had no simulated
timers standing in for these four events.

**Confirmed gaps — genuinely unconnected before this pass:**

1. **Error events** — `ai-state-manager.js` had a code comment admitting the
   gap directly: *"Brain has no error concept today — documented gap."*
   `error` was silently remapped to `'idle'`, so a failed request produced
   no visible signal on the Brain at all.
2. **Tool execution** — every agent capability call already emits
   `capability:loading/success/failure/retry/cancelled/timeout` on the
   shared Agent Event Bus (`capability-kit.js`, Milestone 5) — but nothing
   read those events into the Brain. `AxiomBrain` had no concept of "a tool
   is running right now."
3. **Active model** — `ModelSelector` (`js/core/model-selector.js`) tracked
   the selected model internally but never announced a change anywhere.
   Nothing in the Brain (or anywhere else) could know which model was live.
4. **Active conversation** — `conversation-stream.js` (Milestone 10) already
   re-emits every conversation lifecycle signal as `conversation:*` with a
   `conversationId`, but nothing forwarded that id to the Brain.
5. **Fake thinking indicators** — `js/pages/brain-ultimate.js` (the
   `brain.html` dashboard driver) ran a 2-second timer that unconditionally
   fabricated "reasoning steps," plan progress, prediction probabilities,
   and emotion/confidence/memory drift via `Math.random()` — regardless of
   whether the AI was doing anything at all. This is exactly what the
   validation step means by "no fake thinking indicators."

## 2. What changed

**`os/core/axiom-brain.js`**
- `activity` now includes `'error'` as a real state (previously only
  `idle/listening/thinking/speaking/learning`).
- Added four new state fields, written only from real events, never a
  timer: `activeModel`, `activeConversationId`, `toolActive`, `activeTool`.

**`js/core/ai-state-manager.js`** (the existing canonical Brain/AI Core
coordinator — extended, not replaced, per its own stated design)
- Fixed the documented gap: `error` now maps to Brain's `'error'` activity
  instead of being masked as `'idle'`. `warning` intentionally still falls
  back to `'idle'` — it's a lesser, recoverable signal with no dedicated
  Brain activity of its own, and conflating it with a real error would be
  its own kind of misleading indicator.
- **New Input 3 — tool execution:** listens for `axiom:agent-event` (the
  DOM mirror the Agent Event Bus already dispatches for every event it
  delivers, so no direct bus reference/load-order dependency is needed).
  `capability:loading` → `toolActive:true, activeTool:<capability name>`;
  `capability:success/failure/cancelled/timeout` → clears both. A
  `capability:retry` does *not* clear tool state, since a fresh
  `capability:loading` for the next attempt follows it — verified this
  can't produce a false "done" mid-retry (see test #4 below).
- **New Input 4 — active model:** listens for `axiom:model-changed`
  (new, dispatched by `model-selector.js`) and writes `activeModel`. Seeds
  it once at load from `ModelSelector.getSelectedModel()` if already
  initialized, so a page that loads after model selection still shows the
  right value immediately instead of waiting for the next change.
- **New Input 5 — active conversation:** listens for `conversation:*`
  events (same `axiom:agent-event` mirror) and writes
  `activeConversationId` from `payload.conversationId`; clears it back to
  `null` on that conversation's `conversation:done`.
- All three new outputs write directly to the new metadata fields only —
  none of them touch `activity`, so they can't fight with the existing
  Bridge-driven activity resolution in `apply()`.

**`js/core/model-selector.js`**
- Added `notifyModelChanged()`, dispatching `axiom:model-changed` with
  `{modelId}` on every *real* selection change: the manual `<select>`
  change handler, `setSelectedModel()` (programmatic, e.g. an agent
  switching its preferred model), and once at `init()` to seed whatever
  model is selected on load. Never fired speculatively or on a timer.

**`js/pages/brain-ultimate.js`** — the fake-indicator fix
- Added `isRealAIActive()`: reads `AxiomBrain`'s real state
  (`toolActive`, or `activity` in `thinking/learning/speaking/listening`).
- Reasoning feed, plan progress, prediction drift, and goal progress now
  all early-return unless `isRealAIActive()` — no more narrating "thinking"
  during genuine idle every ~2 seconds regardless of reality.
- When a reasoning-feed entry *is* added while a real tool call is in
  flight, it now says **"Running `<the real capability name>`"** instead
  of picking a random canned line — real data used when it's available,
  instead of always guessing.
- Learning-section metrics now only advance during the Brain's real
  `'learning'` activity specifically (not just "busy").
- Knowledge-coverage and emotion-tile "drift" — for which **no real
  telemetry exists anywhere in this project** — had their unconditional
  `Math.random()` re-rolls removed outright rather than gated, since
  gating a number with nothing real behind it either way just delays the
  same fabrication. They now hold their last rendered value; a comment
  marks each as pending a genuine signal.
- The `AxiomBrain.on('change', ...)` handler now logs real activity-log
  entries on real transitions (`activity` changes, tool start/stop) instead
  of only ever logging two canned lines once at boot.

## 3. Deliberately left unchanged

- `AxiomConversationBridge` (request/streaming/response/cancel path) —
  already fully real; out of scope to touch.
- `conversation-stream.js` / `conversation-manager.js` — already the real
  source of conversation events; only *consumed* them, didn't modify.
- `capability-kit.js` — already the real source of tool-execution events;
  only *consumed* them.
- Decorative-only animation in `brain-ultimate.js` (`enhanceVisualizations`'
  SVG node opacity pulse) — pure visual flourish, doesn't claim anything
  about AI cognition, left as-is.
- Knowledge-coverage and emotion values are now static rather than
  fabricated-but-gated, because there is genuinely no real signal for
  either anywhere in the runtime yet. Wiring a truthful version of either
  is new-feature work (e.g. real sentiment analysis on response text),
  out of scope for a "connect to real events" pass.

## 4. Validation summary

| Check | Result |
|---|---|
| Brain reflects live AI activity | ✅ request/stream/response/cancel already real (Bridge); tool execution, model, conversation now real too |
| AI Core responds to Brain events | ✅ unchanged — `ai-state-manager.js` already drives `AxiomAICore` from the same canonical state; `error` now reaches it correctly too (`CANONICAL_TO_AICORE.error` was already correct, just previously unreachable from Brain's side) |
| No fake thinking indicators | ✅ `brain-ultimate.js`'s unconditional random reasoning/planning/prediction/goal generation is now gated behind real activity; emotion/knowledge fabrication removed outright |
| No duplicate events | ✅ verified by test: a retry mid-flight doesn't produce a spurious "done"; overlapping tool + conversation events settle independently |
| Stable state transitions | ✅ verified by test: cancel/timeout/failure all clear tool state exactly once; conversation id clears only on its own `done` |

`test-evidence/block2-step2-part2-brain-integration-regression-suite.js` —
**28 checks, all passing.** Loads the real, unmodified `axiom-brain.js` and
`ai-state-manager.js` and drives them with the exact event shapes the real
runtime produces. No `jsdom` install was possible in this sandbox (no
network access), so this suite uses a small hand-rolled `vm`-based DOM/window
shim instead of jsdom — same principle (real files, simulated browser
environment), different harness. Full output in
`test-evidence/block2-step2-part2-brain-integration-regression-output.txt`.

Not covered by an automated test: `brain-ultimate.js`'s `isRealAIActive()`
gating (it's a page-level DOM-rendering file keyed to specific `brain.html`
element structure — reproducing that structure in a stub was judged lower
value than the coverage above). Verified by code review instead: every
generator function gated returns before any `Math.random()` call or DOM
write when `isRealAIActive()` is false.
