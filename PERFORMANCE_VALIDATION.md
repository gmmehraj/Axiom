# AXIOM — Block 2 → Step 6 — Part 6A: Performance Validation

**Date:** 2026-08-01
**Method:** Timed execution against the real, unmodified files in a
Node `vm` sandbox. Node's `Date.now()` around each phase, no synthetic
estimates.

## Task enqueue scaling (orchestrator.js)

Registered one agent with a handler that never resolves (isolates
enqueue cost from execution cost), then timed dispatching N tasks:

```
N=2000  enqueue time=11ms
N=4000  enqueue time=29ms
N=8000  enqueue time=88ms
N=16000 enqueue time=285ms
```

Doubling N roughly triples (not doubles) the time at each step
(2.6x, 3.0x, 3.2x) — consistent with the super-linear scaling expected
from `insertByPriority()`'s implementation: a linear scan + `splice()`
into the priority-sorted queue array on every single `enqueue()` call
(verified in source, line ~296-299), which is O(n) per insert and
therefore O(n²) to fill a queue of depth n.

**Real-world impact:** at realistic queue depths — tens to low hundreds
of concurrently-queued tasks — this is sub-millisecond and irrelevant.
It only becomes a measurable cost under a sustained burst of thousands
of simultaneously-queued tasks with a slow-draining agent pool, which is
an unusual but not impossible operating condition for an "AI OS"
handling many concurrent user requests.

## Task throughput / drain (orchestrator.js)

From the same 3,000-task stress run used in the Memory Audit: with a
handler doing trivial async work, all 3,000 tasks reached `completed`
status within the 4-second wait window in the script — no hang, no
dropped tasks, `getStats().tasks.byStatus.completed` matched the
dispatched count exactly.

## Concurrency safety (orchestrator.js)

`Scheduler`'s `draining` flag (`scheduleDrain()`, lines 355-357) is
checked and set synchronously with no `await` or callback boundary
between the check and the set. Under JavaScript's single-threaded
execution model this closes any reentrancy window — there is no point
where two logical "drain" passes can be mid-flight at once. Verified by
reading the function body directly, not inferred from the tests passing.

## Regression-suite-embedded performance assertion

Outside the Step 6 scope but worth noting since I ran every suite in the
repo this pass: `block2-step3-part3-memory-manager-regression-suite.js`
includes and passes its own performance assertion — "findMemories over
2000 records completes quickly (no regression)" — confirming that
suite's author already treats this class of concern (search over a
growing collection) as a first-class regression check. Step 6's own
suites (Parts 1-5) do not currently include an equivalent scale-based
performance assertion for the Scheduler or `workflowsById` — that gap
lines up with the unbounded-growth finding in `MEMORY_AUDIT.md`.

## Not Fully Verified

- **No profiling under real browser conditions** — GC pause behavior,
  actual heap fragmentation, and real event-loop contention alongside
  DOM work, rendering, and the other ~25 files `os-shell.html` loads
  were not measured. The Node `vm` numbers above isolate these five
  files; they don't capture contention with the rest of the live page.
- **No load test with realistic concurrent agent handlers** (i.e.
  handlers doing real async I/O like `fetch()` rather than a synthetic
  `Promise` resolve) — throughput under real work is not the same as
  throughput under a no-op handler.
- **`capability-router.js`'s `route()` and `workflow-planner.js`'s
  multi-stage execution were not independently stress-tested at scale**
  in this pass — only `orchestrator.js`'s raw scheduler was. Their
  performance characteristics are inherited from the Scheduler they sit
  on top of but were not separately timed.
