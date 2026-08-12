# AXIOM — Block 2 → Step 6 → Part 6B: Performance Results

**Date:** 2026-08-01
**Method:** Every number below is copied from actual `Date.now()`
measurements around real calls into the live, wired stack (see
`EXECUTION_EVIDENCE.md`), run in a Node `vm` sandbox on this machine.
None are estimated or reused from the Part 6A pass's synthetic-agent
numbers unless explicitly labeled as such.

## Startup time

Not independently isolated as a standalone metric in this pass — the
fifteen-file load (ten real subsystem files plus the five Step 6 files)
completed as part of every harness run with no measurable delay
distinguishable from Node process startup itself (sub-100ms total
including Node's own initialization, not separately broken out). Marking
**Not Fully Verified** as a precise isolated number — what's confirmed
is qualitative: nothing in the load path blocks or hangs (see
`RUNTIME_INTEGRATION.md`'s "no blocking synchronous startup" check).

## Dispatch latency

```
dispatch->completion latency: 3ms
```
Single real task, real agent, real handler, from `dispatch()` call to
`task_completed` event.

## Routing latency

```
route() latency: 1ms
```
Single real `AxiomCapabilityRouter.route()` call resolving a capability
to an agent and dispatching it.

## Workflow latency

```
executeWorkflow() latency: 5ms
```
Two-stage real workflow (`automation` agent then `browser` agent),
measured after the bug fix documented in `EXECUTION_EVIDENCE.md` (before
the fix it failed at the same 5ms mark — the latency itself wasn't the
problem).

## Task throughput

```
2000 tasks dispatched → drained in 2916ms → 686 tasks/sec
```

This is a real number from this specific harness, dispatching to a
real, cheap, synchronous handler (`automation.getStats()`). It should
**not** be read as "the system's maximum throughput" — it's bounded by
this specific scheduler design characteristic, confirmed by reading
source: `drain()` processes exactly one task per macrotask tick
(`setTimeout(fn, 0)`), so overall throughput is gated by Node's/the
browser's minimum timer-callback interval multiplied by the number of
tasks, not by the handler's own speed. This is consistent with, and now
gives a concrete real number for, the O(n²)-consistent enqueue-scaling
characteristic already documented in the Part 6A `PERFORMANCE_VALIDATION.md`.
At 686 tasks/sec, a burst of a few hundred tasks completes in well under
a second (fine for interactive use); a burst of tens of thousands would
take on the order of a minute to fully drain — worth knowing, not
necessarily worth changing without a concrete workload that needs it.

## Memory growth / queue growth

Covered by dedicated stress tests with their own real, measured numbers,
detailed fully in `MEMORY_VALIDATION.md` rather than duplicated here:
finished-task and finished-workflow retention both empirically confirmed
capped at exactly 1,000 under real load in this pass, matching the
Part 6A stabilization fix.

## Scheduler latency

The `draining` flag / drain-loop mechanics were read and confirmed
race-free in the Part 6A pass (`PERFORMANCE_VALIDATION.md`); this pass
adds the real 686 tasks/sec figure above as the first concrete
throughput number for that same mechanism under real (not synthetic
never-resolving) handlers.

## Not Fully Verified

- **Real browser timing** — every number above is Node `vm` timing on
  this machine, not a browser tab's event loop, which has different
  timer-resolution and main-thread-contention characteristics.
- **Startup time as an isolated metric** — see above.
- **Behavior under real network-backed agent handlers** (e.g. an agent
  that actually calls `fetch()`) — this harness's `fetch` stub always
  rejects, so no real I/O-bound handler was measured.
