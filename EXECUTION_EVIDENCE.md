# AXIOM — Block 2 → Step 6 → Part 6B: Execution Evidence

**Date:** 2026-08-01
**Method:** Real calls into the live, wired stack described in
`LIVE_RUNTIME_VALIDATION.md` — the actual `dispatch()`, `route()`, and
`executeWorkflow()` functions, running against the real registered
agents backed by real subsystem code. Every number and status below is
copied directly from actual program output, not written by hand.

## Bug found, fixed, and re-verified in this pass

**Symptom, first observed:** a real `executeWorkflow()` call — the
first time this pass ran a workflow stage against a real
`agent-registry-integration.js` agent instead of a regression suite's
mock handler — failed immediately:

```
"error": "Automation Agent: unsupported task type \"workflow_stage:get-stats\"."
```

**Root cause, confirmed by reading source, not guessed:**
`workflow-planner.js`'s `routeStage()` unconditionally set the dispatched
task's `type` field to `'workflow_stage:' + stage.id` — a tracking label
— overwriting whatever operation the workflow author intended. Every
`agent-registry-integration.js` agent handler (`browser`, `brain`,
`memory`, `automation`, `analytics`) is a `switch (task.type)` dispatch
table keyed on exact operation names like `'get-stats'`/`'diagnostics'`.
Since the stage schema (`normalizeStage()`) had no field to carry a real
operation type at all, **any workflow stage targeting one of these
agents by `agentId` could never succeed** — not an edge case, the
universal case for this integration. Confirmed this wasn't a
test-mistake: isolated the same failure via `AxiomCapabilityRouter.route()`
called directly with the correct type (`workflow-execution` capability,
`get-stats` type) — that succeeded immediately, proving
`capability-router.js` and the agent handlers are fine; the defect is
specifically workflow-planner.js's `routeStage()`. Confirmed via
`grep` that the existing Part 4 regression suite's mock agent handlers
never switch on `task.type` the way the real agents do, which is exactly
why 29/29 assertions were passing while this was broken the whole time —
the bug was invisible until two previously-separately-tested modules
were actually run together.

**Fix applied — minimal, additive, backward-compatible:**
- `normalizeStage()` now accepts an optional `type` field on a stage
  definition (`raw.type || null`). Omitted, nothing changes.
- `routeStage()` now sends `stage.type || ('workflow_stage:' + stage.id)`
  — if a workflow author specifies `type`, it reaches the agent
  correctly; if not, the exact previous byte-for-byte behavior is
  preserved.
- Confirmed via `grep` that nothing else in the codebase matches on the
  `'workflow_stage:'` prefix, and confirmed via the regression suite
  that no existing passing assertion depends on the old always-prefixed
  value, before making the change.

**Re-verified after the fix**, same workflow, same real agents:

```
Before fix: executeWorkflow() latency: 5ms  status: failed
After fix:  executeWorkflow() latency: 5ms  status: completed
```

Part 4 regression suite re-run against the fixed source:
**29/29 passing, no change** — confirming the fix didn't disturb
existing behavior.

## dispatch() — real, live

```
dispatch->completion latency: 3ms  status: completed
```
Dispatched a real `diagnostics` task to the real `browser` agent
(backed by the real `browser-manager.js`), awaited the real
`task_completed` event, and got a real result back in 3ms.

## route() — real, live

```
route() latency: 1ms
{"accepted":true,"requestId":"req-...","taskId":"task-...",
 "agentId":"browser","plan":{...,"capability":"diagnostics",
 "type":"diagnostics", ...
```
`AxiomCapabilityRouter.route()` correctly resolved the `diagnostics`
capability to the `browser` agent and dispatched it in 1ms.

## Runtime Context creation / destruction

Not independently re-verified as a standalone call in this pass (the
Part 5 suite already covers `createContext`/`destroyContext`/lifecycle
directly against the real, unmodified module — see the prior pass's
`STEP6_VALIDATION_REPORT.md`). What **is** new evidence this pass:
`executeWorkflow()`'s automatic context create → update → destroy cycle
(FIX 3, verified passing in the Part 4 suite) now also completes
correctly end-to-end against real registered agents, not just mocks —
confirmed by the successful workflow run above.

## Task scheduling / completion / cancellation / retry / priority

All exercised with real calls against the live stack in this pass:

- **Cancellation:** dispatched a low-priority task, called
  `Orchestrator.cancel(taskId, reason)` while still queued —
  `returned: true`.
- **Retry:** registered a handler that throws once then succeeds,
  dispatched with `maxRetries: 2` — real result: `attempts: 2`,
  `final status: completed`. Confirms the retry path actually re-invokes
  the real handler, not just updates status.
- **Priority execution / task scheduling / completion:** exercised at
  volume in the throughput test below.

## Capability failover

Not independently re-exercised against the live real-agent stack in
this pass beyond what the Part 3 regression suite already covers
(`primary-writer` fails, `backup-writer` succeeds — passing, 20/20).
No new evidence generated here specific to real subsystem agents;
marking as **covered by existing suite, not re-verified against real
agents in this pass**.

## Real throughput measurement

```
dispatched 2000 tasks; drained in 2916ms (686 tasks/sec);
remaining queued: 0
finished-task retention after drain: 1000
  (cap is MAX_COMPLETED_TASK_HISTORY = 1000)
```

2,000 real tasks, dispatched to the real `automation` agent
(`get-stats`, a real, cheap, synchronous method), fully drained and
measured wall-clock. 686 tasks/sec is the actual number this specific
harness produced — not an estimate. See `PERFORMANCE_RESULTS.md` for
what this does and doesn't imply about production throughput. The
1,000-cap confirms the Part 6A stabilization fix holds under a real
agent, not just the synthetic stress tests from that pass.

## Error path — unknown agent

```
unknown-agent dispatch result: failed - Unknown agent: does-not-exist
```
Real dispatch to a nonexistent agent id, real `task_failed` event, real
reason string — matches the Part 1 suite's assertion, now also
confirmed live.

## Shutdown / restart

```
dispatch() after shutdown() throws: true
dispatch() after startup() again works, status: completed
```
Real `shutdown()` call, confirmed `dispatch()` throws afterward, real
`startup()` call, confirmed a subsequent real dispatch completes
normally. Matches the Part 1 suite's shutdown/resume assertion, now
also confirmed live.
