# AXIOM — AI Execution Pipeline Report
### Phase 10 · Part 2 · Block 2 · Step 1 (Part 2)

**Date:** 2026-07-31
**Scope:** Coding Agent request → response pipeline only. No UI changes,
no new capabilities, no changes to other agents.
**Role:** Senior AI Systems Engineer audit + fix pass.

---

## 1. What "the pipeline" is, concretely

A Coding Agent request travels through five files:

```
user/task source
   │
   ▼
agent-manager.js        dispatch(agentId, task) → bus.emit('task:assign', …)
   │
   ▼
agent-runtime.js         Agent.enqueue() → Agent._drain()
                          (status: idle → thinking → working → completed/error → idle)
   │
   ▼
coding-agent.js           handler(task, ctx)  — validation, op routing, ctx wiring
   │
   ▼
coding-toolkit.js         completeText() → AxiomCapabilityKit.withCapability() → streamOnce()
   │
   ▼
window.OpenRouter.streamChat()   (the actual live model client)
```

Every one of the ten pipeline stages named in the execution order maps onto
a specific point in this chain. The table below is the audit: what existed
before this pass, what was found, and what changed.

## 2. Stage-by-stage findings

| Stage | Before this pass | Finding | Fix |
|---|---|---|---|
| **Request validation** | No size/shape check; any string reached the network | An unbounded prompt/code/description field could reach the model with no ceiling | `coding-agent.js` rejects any primary text field over 20,000 chars with a clear `{ok:false, error}` **before** touching the network |
| **Model selection** | `resolveModel()`: explicit → `ModelSelector.getSelectedModel()` → hardcoded default | Already correct and defensive (try/catch around the selector) | No change |
| **Streaming lifecycle** | `completeText()` called `window.OpenRouter.streamChat()` directly, once, with no wrapper | Every *other* agent with a live backend (Browser, Memory, Planner, File) runs its call through `AxiomCapabilityKit.withCapability()`. The Coding Agent was the only one that didn't — so it had no timeout, no retry, and no uniform `capability:loading/success/failure/retry/timeout` events on the bus | `completeText()` now calls `streamOnce()` (the retryable unit) through `withCapability()`, exactly like the other four agents |
| **Response parsing** | `onDone(fullText, aborted)` resolved `fullText` as-is | A non-string or `null`/`undefined` payload would propagate silently | `streamOnce()` coerces to `''`/`String(...)` before resolving |
| **Cancellation** | `AbortController` + 150ms watchdog polling `task.cancelled`, working correctly | Already correct — verified with a dedicated test (real abort, not just discarding a stale result) | No change to the mechanism; confirmed it survives being wrapped in retry logic (a cancellation is never retried, since `withCapability` re-throws cancellations untouched) |
| **Timeout handling** | **None at the request level.** A stream that never called `onDone`/`onError` left the promise pending indefinitely | This was the critical defect (see §3) | 45s default timeout via `withCapability`, overridable per-request via `task.timeoutMs` |
| **Retry behavior** | **None.** A single transient network error failed the whole task | Any one-off `onError` (e.g. a dropped connection) failed the user's request outright | Up to 2 attempts by default via `withCapability`, overridable via `task.retries`; never retries a cancellation |
| **Error recovery** | `coding-agent.js` already wrapped every op in try/catch, returning structured `{ok:false, error}` rather than throwing; `Agent.fail()` already auto-recovers a wedged agent to idle after 1.2s | Already sound at the agent level. The gap was upstream: without a pipeline timeout, an op could stay in-flight so long the *manager's* 15s stall heartbeat was the only backstop, and even that only fixed the agent's *displayed* status — the queue's internal `_processing` flag never cleared, so real work silently stalled behind it | The pipeline timeout means a hung call now settles (fails) on its own within its budget, so the manager heartbeat goes back to being a pure safety net instead of the only thing standing between a hung stream and a wedged queue |
| **Token usage tracking** | **None anywhere in the pipeline** | No visibility into how much prompt/completion volume the Coding Agent was generating | `estimateUsage()` (a ~4-chars/token heuristic, clearly labeled `estimated: true` — not billing-grade) attached to every live result and accumulated on `agent.stats.tokens`; an `agent:token-usage` event is emitted per request |
| **Context handling** | Every op sent a single isolated user message; no system prompt, no prior turns | Multi-turn coding conversations (e.g. "now add error handling to that") had no way to carry context | Optional `task.system` and `task.history` are threaded ahead of the current prompt for `generate`, `explain-code`, `refactor`, and `bug-investigation`. Omitting both reproduces the exact prior single-message behavior |

## 3. The critical defect: hung streams could wedge the pipeline

**Symptom:** if `window.OpenRouter.streamChat()` ever failed to call either
`onDone` or `onError` — a dropped connection, a provider outage that
doesn't even error, a bug in the client — the promise inside
`completeText()` stayed pending forever. There was no `setTimeout` racing
it anywhere in the Coding Agent's path.

**Why it mattered more than a single stuck request:** `Agent._drain()`
sets an internal `_processing = true` flag while a task is in flight and
only clears it in the task's `.then()`/`.catch()` — both of which require
the handler's promise to *settle*. With no timeout, that promise never
settled, so:

- `_processing` stayed `true` forever.
- Any task queued after the hung one sat in `taskQueue` untouched — never
  dispatched, never even started.
- The Agent Manager's 15-second stall heartbeat (`agent-manager.js`) *did*
  eventually force the agent's **displayed status** back to `idle`, but it
  has no reference to `_processing` or the original in-flight promise —
  so the queue stayed silently stuck even while the status looked healthy.
  If the original stream ever did resolve later, its result would land
  as an effective stale/duplicate response for a request the caller may
  have long since given up on.

This directly contradicts two of the validation requirements for this
step — *"every request executes once, no duplicate responses"* and
*"state always returns to idle"* — in the specific case of a slow or dead
backend, which is exactly the case a reliability pass needs to cover.

**Fix:** routing the live call through `AxiomCapabilityKit.withCapability()`
gives it a real timeout (default 45s, tunable per-request) that actually
**rejects** the promise when it fires. That rejection flows through
`coding-agent.js`'s existing try/catch into `Agent._drain()`'s
`.catch()`, which clears `_processing`, records the failure, and drains
the next queued task — exactly the recovery path that already existed for
every *other* kind of failure, just never reachable for a hang.

Verified with a dedicated test: a mock client that never calls `onDone`/
`onError` at all, dispatched with a short `timeoutMs`, settles as a clean
failure well within the timeout budget instead of hanging the suite.

## 4. Deliberately left unchanged

- **`task-router.js`, `agent-manager.js`'s dispatch/routing logic** — not
  part of the Coding Agent's own pipeline; out of scope for this step.
- **The manager's 15s stall heartbeat** — kept as a second line of
  defense. It's now genuinely redundant for the Coding Agent (the
  pipeline's own timeout fires first), which is the correct end state:
  belt-and-suspenders, not a replacement for either.
- **`refactor`'s "always a proposal, never applied" behavior** —
  unrelated to reliability; re-verified unchanged.
- **Token estimates are heuristic, not exact** — no tokenizer is loaded
  in this project and adding one would be a new dependency, out of scope
  for a reliability pass. The `estimated: true` flag on every usage object
  makes this explicit to any caller/UI that consumes it.

## 5. Validation summary

| Suite | Checks | Result |
|---|---|---|
| `test-evidence/block2-step1-part2-pipeline-regression-suite.js` (new) | 13 | All pass |
| `test-evidence/block2-step1-coding-agent-regression-suite.js` (Part 1) | 11 | All pass, 0 regressions |
| `test-evidence/milestone5-regression-suite.js` | 23 | All pass, 0 regressions |
| `test-evidence/milestone6-regression-suite.js` | 52 | 1 pre-existing, unrelated failure (stale `file-processing.js` path in a File Agent check) confirmed present in the untouched original project — not caused by, or in scope for, this pass |

New suite covers, end-to-end through the real (unmodified in test)
`agent-runtime.js` → `coding-agent.js` → `coding-toolkit.js` →
`capability-kit.js` → `agent-manager.js` chain via jsdom:

1. An oversized request is rejected with zero network calls.
2. A stream that never calls `onDone`/`onError` is timed out rather than
   hanging the pipeline.
3. A transient failure is retried and the task still succeeds; a
   cancelled task is never retried.
4. Token usage is estimated per-request and accumulates correctly on the
   agent's stats.
5. `system` + `history` + the current prompt reach the client in the
   correct order.
6. A burst of four concurrent requests all complete **exactly once**
   (no duplicate responses) and the agent settles back to **idle**.
