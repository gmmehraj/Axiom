# Architecture Debt Resolution

**Block 2 · Step 6 · Part 5 Stabilization Pass**
**Precedes:** Block 2 · Step 6 · Part 6 — Production Validation & Architecture Freeze

## Purpose

Part 5 (Runtime Context Engine) passed its own regression suite in
isolation, but a Senior Architecture Review of the Orchestrator layer
as a whole (Parts 1–5 together) identified five confirmed pieces of
technical debt before that layer can be frozen for Production
Validation. This document records what was reviewed, what was found,
what was (and wasn't) changed, and the evidence that the layer is now
in a state suitable for a freeze.

This is a debt-resolution pass, not a feature pass. Nothing in scope
below adds a capability that didn't already exist; every item is a
correction to an existing, documented behavior.

## Scope boundary

**In scope:** `os/core/runtime-context.js`, `os/core/workflow-planner.js`,
their regression suites, and their documentation.

**Explicitly out of scope (verified untouched):**

| Subsystem | Status |
|---|---|
| Browser | Unchanged |
| Brain | Unchanged |
| Memory | Unchanged |
| Automation | Unchanged |
| Analytics | Unchanged |
| OpenRouter | Unchanged |
| Any `.html` / UI file | Unchanged |
| `os/core/orchestrator.js` (Part 1) | Unchanged |
| `os/core/capability-router.js` (Part 3) | Unchanged |

Confirmed by: `git`-equivalent diff review of the extracted project
(only the files listed in "In scope" have any content change), plus a
full run of `test-evidence/phase9-part1-static-audit-suite.js`
(whole-project syntax/lint/structure audit — 1370/1370 passing,
including every `.js` and `.html` file in the project, not just the two
touched here).

## Findings and resolutions

| # | Finding | Root cause | Resolution | Status |
|---|---|---|---|---|
| 1 | `childIndex` leaks stale/orphaned entries after `destroyContext()` | `destroyContext()` never wrote to `childIndex` at all | Added `pruneChildIndex()`, called from every `destroyContext()` exit | **Resolved** |
| 2 | Automatic archive cleanup never runs | `startAutoCleanup()` existed but nothing called it | Module now self-starts the scheduler on load; configurable, idempotent, mirrored onto Orchestrator | **Resolved** |
| 3 | Workflow Planner maintains a second, parallel context implementation | `wf.context` was built and owned entirely inside `workflow-planner.js`, independent of Runtime Context | `executeWorkflow()` now creates/updates/destroys a real `AxiomRuntimeContext` context for every run | **Resolved** |
| 4 | `createContext` name collision between Workflow Planner internals and Runtime Context | Two unrelated functions, same name, in the same layer | Workflow Planner's private helper renamed to `createWorkflowContext()` | **Resolved** |
| 5 | `safeClone()` can silently corrupt state on unsupported input | `JSON.stringify()` doesn't throw for functions/`undefined` (silent data loss), and the fallback path did an unsafe shallow copy on top of that | Replaced with `assertJsonSafe()` — validates up front, fails loudly, documented payload contract | **Resolved** |

See `RUNTIME_CONTEXT_FIXES.md` for the full technical detail (code
before/after, reasoning, and the specific regression test(s) proving
each fix) behind every row above.

## Architectural invariants re-verified after the fixes

These are the properties Part 5's own design doc (`RUNTIME_CONTEXT.md`)
commits to. All are re-confirmed by the full regression suite after
this pass's changes, not just assumed to still hold:

- **Exactly one context system.** Before this pass: two (Runtime
  Context + Workflow Planner's private `wf.context`). After: one.
  Verified by a regression test that statically confirms
  `workflow-planner.js` no longer defines a `createContext` function,
  and by tests that trace a workflow run's Runtime Context through its
  full create → update → destroy lifecycle via `AxiomRuntimeContext`'s
  own public API — Workflow Planner is a caller, not an owner, of
  context state.
- **Snapshots stay immutable and isolated.** `getContext()` and every
  other read path still return only `deepFreeze()`d, deep-cloned data —
  reinforced, not weakened, by FIX 5's stricter cloning (a shallow-copy
  fallback was itself a latent isolation break; removing it makes the
  guarantee stronger).
- **Parent/child isolation is preserved and now leak-free.**
  `destroyContext()` of one child never affects a sibling (pre-existing
  guarantee, re-verified) and no longer leaves either side of the
  relationship pointing at a destroyed id (new, FIX 1).
- **Cleanup never touches active work.** Both the manual
  (`cleanupExpiredContexts()`) and now-automatic sweep only ever read
  `archivedById`; an active (non-terminal) context is provably
  unaffected by either, including across real elapsed time with the
  scheduler running (see `FIX 2: automatic cleanup never removes an
  active (non-terminal) context`).
- **No subsystem coupling was introduced.** Runtime Context still makes
  no calls into Memory, Browser, Brain, Automation, or Analytics, and
  still doesn't import from or write to any of them. Workflow Planner's
  new dependency is `AxiomRuntimeContext` only, mirroring the same
  additive-install convention Parts 3 and 4 already used for
  `AxiomOrchestrator`.

## Regression evidence

| Suite | File | Result |
|---|---|---|
| Runtime Context Engine (Part 5) | `test-evidence/block2-step6-part5-runtime-context-regression-suite.js` | **42/42 passing** (28 pre-existing + 14 new, covering Fixes 1/2/5) |
| Workflow Planner (Part 4) | `test-evidence/block2-step6-part4-workflow-planner-regression-suite.js` | **29/29 passing** (22 pre-existing + 7 new, covering Fixes 3/4) |
| Orchestrator (Part 1) | `test-evidence/block2-step6-part1-orchestrator-regression-suite.js` | 21/21 passing — unchanged, re-run to confirm no ripple effect |
| Agent Registry Integration (Part 2) | `test-evidence/block2-step6-part2-agent-registry-integration-regression-suite.js` | 18/18 passing — unchanged, re-run to confirm no ripple effect |
| Capability Routing (Part 3) | `test-evidence/block2-step6-part3-capability-routing-regression-suite.js` | 20/20 passing — unchanged, re-run to confirm no ripple effect |
| Whole-project static audit | `test-evidence/phase9-part1-static-audit-suite.js` | 1370/1370 passing |

No pre-existing assertion in the Part 4 or Part 5 suites was weakened,
skipped, or removed to make this pass's changes pass — every new
behavior is covered by new, additive test cases, and every prior test
case still exercises the same original expectation.

One noteworthy, non-failing artifact in the Part 4 suite's output: an
existing test's synthetic stage payload contains a circular reference,
and FIX 5's stricter validation now rejects it when Workflow Planner
tries to mirror that payload into Runtime Context. This is caught,
logged as a warning by `syncWorkflowContext()`'s try/catch, and does
not fail the workflow or the test — a live demonstration of FIX 5
degrading gracefully instead of the pre-fix behavior (silent
corruption) or an unhandled failure.

## Known load-order consequence

`workflow-planner.js` now requires `runtime-context.js` to be loaded
before it, in addition to its existing requirement on
`orchestrator.js`. No `.html` file in the project currently loads
either `os/core/workflow-planner.js` or `os/core/runtime-context.js`
directly (both are pre-wiring library modules not yet linked into any
page), so this has no UI-visible effect today. Anything that wires
these into a page in a future part must load `orchestrator.js` and
`runtime-context.js` before `workflow-planner.js`.

## Readiness for Part 6

All five findings from the Senior Architecture Review are resolved,
verified by expanded regression coverage, and confirmed not to have
disturbed any adjacent, unmodified subsystem. The Orchestrator layer
(Parts 1–5) has:

- a single, leak-free Runtime Context implementation,
- an automatic, safe, non-duplicating cleanup mechanism,
- a Workflow Planner that consumes that single implementation instead
  of shadowing it,
- no naming ambiguity between the two,
- and a context payload contract that fails safely instead of silently
  corrupting state.

This pass makes no claim about performance, scale, or production
infrastructure — those remain the explicit subject of Part 6
(Production Validation & Architecture Freeze).
