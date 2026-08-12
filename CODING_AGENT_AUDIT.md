# AXIOM — Coding Agent Audit

**Phase:** 10 · Part 2 — Block 2 · Step 1 · Part 1
**Date:** 2026-07-31
**Scope:** The Coding Agent only (`os/runtime/agent-definitions/coding-agent.js`,
`os/runtime/capabilities/coding-toolkit.js`, and the shared runtime they sit on:
`agent-runtime.js`, `agent-manager.js`, `task-router.js`). No UI redesign, no
new capabilities, no changes to other agents.

This follows the same honesty policy as prior audits in this project: it only
claims what was actually read, exercised, or checked in this environment. Where
something couldn't be verified (no browser here), that's stated directly rather
than assumed clean.

---

## 1. Architecture reviewed

**Request lifecycle / state management (`agent-runtime.js`).** Every agent,
including Coding, is an instance of one shared `Agent` class. Tasks go through
a single per-agent FIFO queue (`taskQueue`) drained by `_drain()`, guarded by
an `_processing` flag — a new `enqueue()` while a task is in flight just waits
its turn rather than running concurrently. Status moves through a frozen,
validated state machine (`offline → initializing → idle → …`), with every
transition emitted as a structured event on a shared `AgentEventBus` (never a
direct method call between agents). This part of the foundation is solid and
was **not** rebuilt — it already met the brief.

**Coding Agent definition (`coding-agent.js`).** A single `handler(task, ctx)`
dispatches on `task.op`: `generate` (default when a bare prompt/text is given),
`project-search`, `file-navigation`, `explain-code`, `refactor`,
`bug-investigation`, `project-analysis`. The non-`generate` ops delegate to
`coding-toolkit.js`.

**Coding Toolkit (`coding-toolkit.js`).** Composes existing tools rather than
building new ones: `project-search`/`file-navigation` reuse
`AxiomAgents.runTool('workspace_search', …)`; `explain-code`/`refactor`/
`bug-investigation` call a model; `project-analysis` aggregates over the same
search results. `refactor` always returns a proposal
(`requiresConfirmation: true, applied: false`) and never writes to a file —
verified this invariant is unconditional in the code, not just documented.

**Model integration.** The app's real, loaded chat client is `window.OpenRouter`
(`js/core/openrouter-client.js`), exposing a callback/streaming
`streamChat({ model, messages, onToken, onDone, onError, signal })`. It handles
auth via Supabase session, SSE parsing, HTTP error codes (402/429), and
`AbortError` cleanly.

**Cancellation.** The runtime is cooperative by design: `Agent.cancelCurrent()`
flags `task.cancelled = true` and emits an event; it's up to the capability
actually doing async work to check that flag and stop. This is the right
pattern — the runtime shouldn't (and structurally can't) forcibly kill
arbitrary async work.

**Reachability.** `agent.coding` is reachable three ways: the Task Router
(keyword match on "code", "bug", "refactor", etc. → `generate`), the
`developmentWorkflow` in `workflows.js` (→ `bug-investigation`), and directly
via `AxiomAgentManager.dispatch()`. It is *not* currently wired to any visible
button/input in the shipped pages — only the router, the workflow, and the
regression suites exercise it today. Noted under Remaining limitations below;
left as-is since wiring a new entry point is a UI change, out of scope here.

---

## 2. Problems fixed

### Critical: the Coding Agent's live model path was completely dead

`coding-agent.js` and `coding-toolkit.js` looked for `window.OpenRouterClient`
or `window.AxiomOpenRouter`, calling a `.complete({ messages })` method on
whichever was found. **Neither global is defined anywhere in this project** —
confirmed with a project-wide search. The only client that's ever actually
loaded is `window.OpenRouter`, and it doesn't have a `.complete()` method at
all; it only has the streaming `.streamChat()` shown above.

Concretely, this meant:
- `generate` (the default op — what a bare prompt or router-matched "write me
  a function" would hit) **always** fell through to a canned placeholder —
  `{ ok: true, live: false, note: 'Coding task prepared: …' }` — even on a
  fully working page with a signed-in user and a real model selected. It never
  once reached a real model.
- `explain-code`, `refactor`, and `bug-investigation` in the toolkit **always**
  hit `if (!c || typeof c.complete !== 'function') …` and either threw or
  returned a "no model client available" result — unconditionally, on every
  page, regardless of configuration.

This is exactly the kind of bug a placeholder-shaped fallback hides well: every
call *looked* like a normal, handled response (`ok: true` in the generate
case), not a crash, so nothing in the existing test suite or manual smoke-test
would have surfaced it without inspecting `live: false` closely.

**Fix** (`os/runtime/capabilities/coding-toolkit.js`, `os/runtime/agent-definitions/coding-agent.js`):
- Added `completeText(messages, opts)` to the toolkit: a thin Promise wrapper
  around the real `window.OpenRouter.streamChat`, so the rest of the toolkit
  can keep `await`-ing a single string like before.
- Model resolution: explicit `opts.model` → the page's `ModelSelector` (if
  present) → a safe default (`openai/gpt-4o-mini`). No page crashes if
  `ModelSelector` isn't loaded.
- `hasClient()` — an explicit, honest availability check, used to decide
  between attempting a live call and returning the "unavailable" message, so
  degraded pages still behave exactly as before (no console errors, no
  broken promises), just for a real reason instead of a typo'd global.
- Wired real cancellation on top: `completeText` accepts the in-flight `task`
  and polls its cooperative `cancelled` flag, aborting the underlying
  `fetch`/stream via `AbortController` the moment it's set, instead of only
  discarding the result after the fact once it eventually arrived.
- Updated `coding-agent.js`'s `generate` case and all `coding-toolkit` call
  sites (`explain-code`, `refactor`, `bug-investigation`) to pass the task
  through so cancellation and model selection reach every op consistently.

### Verified already correct (no change needed)

- **No duplicate/overlapping requests.** `Agent._drain()`'s `_processing` flag
  already serializes a single agent's queue; confirmed with a new regression
  check that two tasks enqueued back-to-back never produce more than one
  concurrent client call.
- **No memory leak in the new code.** The cancellation watchdog
  (`setInterval`) is cleared on every exit path (`resolve`, `reject`, and the
  `onError`/`onDone` callbacks) — verified by code review; no dangling timers.
- **Error handling** in `coding-agent.js`'s handler already wraps every op in
  try/catch and returns a structured `{ ok: false, error }` rather than
  throwing past the runtime — this was already correct and is preserved.
- **Agent initialization** (`offline → initializing → idle`) already routes
  init failures through `fail()` instead of rejecting the caller's promise —
  already correct, confirmed via the regression suite.

---

## 3. Validation performed

All of the following were run in this environment (headless, via jsdom — see
`test-evidence/block2-step1-coding-agent-regression-suite.js`):

| Check | Result |
|---|---|
| Coding Agent registers and reaches `idle` after init | PASS |
| `generate` op reaches a (mocked) real client and returns `live: true` | PASS |
| Exactly one client call per task — no duplicate calls | PASS |
| `explain-code` succeeds via the real client (previously always threw) | PASS |
| Two queued tasks never run concurrently (no overlapping responses) | PASS |
| Cancelling an in-flight `generate` actually aborts the request | PASS |
| No-client pages still degrade gracefully (no throw/crash) | PASS |
| Unsupported op still fails gracefully | PASS |
| Full existing `milestone6-regression-suite.js` (52 checks) | **PASS — 0 regressions** |
| Project-wide `node --check` syntax scan (all `.js`, excluding `_archive/`) | **0 errors** |

No console errors were produced in any of the above jsdom runs (checked
stdout/stderr of each run directly, not inferred).

**Not verified in this environment:** actual browser rendering, a live
Supabase session, a live OpenRouter/Edge Function round-trip, or SSE token
timing under real network conditions — this environment has no browser and no
network access to those services. The fix's correctness rests on: (a) exactly
matching the real `OpenRouter.streamChat` contract already used and proven
elsewhere in the app (`js/core/app.js`'s `streamAssistantReply`), and (b) the
jsdom checks above against a client mock with that same contract.

---

## 4. Remaining limitations

1. **`workspace.html` never loads `js/core/openrouter-client.js`.** On that
   page the Coding Agent will still correctly report "no model client
   available" for every live op (graceful, not broken) — but it has no path
   to live generation at all, by omission. `playground.html`, `agent-library.html`,
   and `os-shell.html` all load it. Left unchanged here since adding a
   `<script>` tag is a page-level change outside "Coding Agent foundation"
   as scoped, and it's worth confirming whether that's intentional before
   touching it.
2. **The Coding Agent isn't wired to any shipped UI control.** It's reachable
   via the Task Router's keyword matching and the `developmentWorkflow`, but
   there's no dedicated "ask the Coding Agent" input on any page today — only
   the general Playground chat (which bypasses the agent runtime entirely and
   calls `OpenRouter.streamChat` directly) and the regression suites exercise
   it. This is a real gap between "the Coding Agent works" and "a user can
   reach it," but closing it is a UI/feature change, not a stabilization fix.
3. **No live network validation**, per the table above — this environment
   can't confirm real auth/session/model behavior end-to-end.
4. **`explain-code`/`refactor`/`bug-investigation` are non-streaming.** They
   now correctly reach the model, but `completeText()` buffers the whole
   reply before resolving (no token-by-token UI feedback), unlike the
   Playground's main chat. That matches the toolkit's original one-shot
   design (each was written against a promise-based `.complete()`), so it's
   not a regression — just worth flagging if streaming UX is wanted here
   later.

---

## 5. Next recommended improvements

1. Confirm whether `workspace.html` is meant to have live Coding Agent
   generation, and load `openrouter-client.js` there if so.
2. Add a real UI entry point for the Coding Agent's structured ops
   (`explain-code`, `refactor`, `bug-investigation`, `project-analysis`) —
   right now they're only reachable programmatically.
3. Consider surfacing `live: false` placeholder responses distinctly in
   whatever UI eventually calls `generate`, so a missing-client state is
   visibly different from a real answer (today it's `ok: true` either way,
   which is exactly what let this bug go unnoticed as long as it did).
4. If token-by-token feedback is wanted for `explain-code`/`refactor`/
   `bug-investigation`, extend `completeText()` to accept an `onToken`
   passthrough rather than only resolving the final string.
