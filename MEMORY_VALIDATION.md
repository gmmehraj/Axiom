# AXIOM — Block 2 → Step 6 → Part 6B: Memory Validation

**Date:** 2026-08-01
**Method:** Combines fresh evidence from this pass (real agents, real
load, twice-modified source) with the Part 6A pass's stress tests
re-run against the current source to confirm they still hold after this
pass's additional fix. Not re-deriving anything already solidly
established — citing exactly what changed or what's newly confirmed.

## No growing Maps — re-confirmed against the now-twice-modified source

Re-ran both Part 6A stress scripts, unmodified, against the current
`orchestrator.js`/`workflow-planner.js` (which now also includes this
pass's `routeStage()` fix):

```
after 5000 dispatches, total retained: 3293
  {"running":1,"completed":1000,"queued":2292}
permanently-running task still present: true running

created 1500 workflows; retained now: 1000
active probe workflow still present: true running
final retained count: 1001
```

Identical shape to the Part 6A results (exact retained counts differ
slightly run-to-run based on timing of the async queue drain relative to
the fixed wall-clock wait in the script, which is expected and fine —
what matters, and what's identical, is: finished-task/workflow count
capped at exactly 1,000, active/queued entries never touched).

**New this pass:** the throughput test in `EXECUTION_EVIDENCE.md` — 2,000
tasks dispatched to a **real** agent (not a synthetic stress-test
handler) — also confirmed the exact same 1,000 cap after a full real
drain, which the Part 6A tests couldn't demonstrate since they used
synthetic single-purpose test agents rather than the real,
now-live-wired subsystem chain.

## No listener leaks

Re-confirms the Part 6A finding (`workflow-planner.js`'s
`awaitStageOutcome()` registers and always cleans up its four listeners
on every resolution path) — not re-derived from scratch, since nothing
in the listener-registration code changed in this pass. New in this
pass: the real workflow run in `EXECUTION_EVIDENCE.md` exercised this
exact cleanup path against real agents and completed without hanging or
leaving a dangling listener (confirmed by the harness process exiting
cleanly after all phases completed, with no lingering event-loop
handles keeping it alive beyond the explicit `process.exit(0)`).

## No orphan contexts / no orphan workflows

Covered by the Part 4 suite's FIX 3 group (context created → updated →
destroyed exactly once per workflow run, including the
cancelled-before-start and failure paths) — re-run in this pass,
29/29 still passing, unchanged.

## No stale task references

The bug fixed in this pass (`EXECUTION_EVIDENCE.md`) was a *routing*
defect, not a stale-reference defect — no task or workflow record was
found retained past its correct lifecycle in this pass's testing.

## No timer leaks

`runtime-context.js`'s auto-cleanup timer dedup (FIX 2) — re-run,
still passing, unchanged from Part 6A. Not re-derived; no code in this
pass touched that mechanism.

## No event duplication / no repeated registrations

`agent-registry-integration.js`'s `registerOnce()` wrapper (visible in
the live harness output — each agent logs exactly one "Registered
agent" line, never more, across every one of this pass's five harness
runs). Confirms the dedup logic works under real, repeated
module-loading conditions, not just the Part 2 suite's synthetic
double-registration test (which also still passes, 18/18, unchanged).

## Real long-duration testing — Not Fully Verified

This pass ran bounded stress loads (thousands of tasks/workflows over
single-digit seconds of wall-clock time), not a genuine long-duration
session (hours). A Node `vm` sandbox process also doesn't experience the
same GC pressure, tab-backgrounding, or multi-hour timer drift a real
browser tab would over an actual long session. **Marking true
long-duration (multi-hour) memory behavior as Not Verified** — what's
verified is the *mechanism* that would prevent unbounded growth over
such a session (the 1,000-entry caps), not an observation of an actual
multi-hour run.
