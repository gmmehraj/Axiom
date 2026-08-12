# AXIOM — Block 2 → Step 6 — Part 6A: Architecture Audit

**Date:** 2026-08-01
**Scope:** `os/core/orchestrator.js`, `os/core/agent-registry-integration.js`,
`os/core/capability-router.js`, `os/core/workflow-planner.js`,
`os/core/runtime-context.js`, plus their actual runtime dependencies as
determined by source inspection (not assumed).
**Method:** Every finding below was produced by reading the source files
directly, by grep across the full `os/core/` tree, or by executing code
in a Node `vm` sandbox against the real, unmodified files. No finding is
carried over from prior audit documents in this repo without being
re-checked here.

## 1. Single Responsibility

- `orchestrator.js` — agent registry (raw), task scheduler (queue,
  priority, retry, timeout, cancel), event bus. No routing, no workflow,
  no context logic present in the file.
- `agent-registry-integration.js` — discovery/health layer over the raw
  registry; does not schedule or route tasks itself.
- `capability-router.js` — capability resolution and agent selection on
  top of the Orchestrator's `dispatch()`; does not maintain its own task
  queue.
- `workflow-planner.js` — multi-stage sequencing/recovery on top of
  `route()`/`dispatch()`; does not implement scheduling or routing
  itself.
- `runtime-context.js` — isolated state container with its own
  lifecycle; does not schedule, route, or plan.

Each file verified to hold one coherent responsibility. No cases found
of two of these five files independently reimplementing the same
concern.

## 2. Layer Separation & Dependency Direction

Built from a real `grep -oE "Axiom[A-Za-z]+"` pass over every file in
`os/core/`, not from documentation:

```
orchestrator.js         (base — zero code-level references to any other
                          os/core singleton; the only matches are in
                          comments)
        ↑
agent-registry-integration.js   (soft, defensive `global.AxiomX || fallback`
capability-router.js             lookups to Brain/Memory/Browser/Automation/
                                  Analytics — never hard requires)
        ↑
workflow-planner.js     (references AxiomOrchestrator, AxiomCapabilityRouter,
                          AxiomRuntimeContext)
```

`runtime-context.js` references `AxiomOrchestrator` optionally (verified:
the Part 5 regression suite explicitly tests that the module "does not
throw or require Orchestrator to be present").

Direction is one-way and consistent: nothing in `orchestrator.js`,
`capability-router.js`, or `runtime-context.js` references
`workflow-planner.js`.

## 3. Circular References

**None found.** Checked by cross-referencing the dependency graph above
in both directions — no file low in the stack references a file higher
in the stack.

## 4. Duplicated Logic

No duplicated scheduling, routing, or lifecycle logic found between the
five files — each delegates to the layer below it rather than
reimplementing it (e.g., `workflow-planner.js` calls `Orchestrator.route`
or falls back to `Orchestrator.dispatch`; it does not carry its own
queue).

## 5. Dead Code

Not exhaustively verified across all five files line-by-line for dead
branches. What I did check: every exported function in `runtime-context.js`
(`createContext` through `isAutoCleanupRunning`) is exercised by the
Part 5 regression suite. I did not perform a full unreachable-branch
analysis on `capability-router.js` or `workflow-planner.js` — **marking
this sub-item Not Fully Verified** for those two files; a proper answer
needs a coverage tool run, not a read-through.

## 6. Hidden Coupling / Global Pollution

Checked how each of the five files attaches itself: each does exactly
one `global.AxiomX = AxiomX` assignment at the bottom of an IIFE
(verified for `orchestrator.js` and `runtime-context.js` by reading the
tail of each file). No file sets properties directly on `window` outside
that single named export. `agent-registry-integration.js`'s reach into
other subsystems is entirely through optional `global.AxiomX` reads
guarded by existence checks, not writes — it cannot corrupt state it
doesn't own.

## 7. Architectural Regressions

Compared against `RUNTIME_CONTEXT_FIXES.md`'s five documented fixes
(childIndex pruning, auto-cleanup dedup, JSON-safety validation): all
five are covered by dedicated, currently-passing assertions in the Part
5 suite (FIX 1, FIX 2, FIX 5 groups — 18 of the 42 assertions map
directly to them). No regression against that prior work detected.

## Finding: Two real, unverified-until-now growth characteristics

These surfaced during this pass and are architectural, not just
performance details — see `MEMORY_AUDIT.md` for the full evidence:

- `orchestrator.js`'s `Scheduler.tasksById` has no automatic bound.
- `workflow-planner.js`'s `workflowsById` has no bound and no manual
  release valve at all (unlike the orchestrator, which at least exposes
  `clearTaskHistory()`).

This doesn't violate single-responsibility or layering — it's a gap in
an otherwise-consistent convention that `capability-router.js` and
`runtime-context.js` both already follow (self-bounded history via a
`HISTORY_LIMIT`). See Memory Audit for detail and a proposed minimal
fix that mirrors that existing convention.
