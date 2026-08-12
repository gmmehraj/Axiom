# AXIOM — Block 2 → Step 6 — Part 6A: Dependency Graph

**Date:** 2026-08-01
**Method:** `grep -oE "Axiom[A-Za-z]+"` executed against every `.js` file
in `os/core/` (30 files), self-matches filtered out, then each hit
manually checked in context to classify it as a hard reference, a
comment, or a defensive/optional lookup. This is the real output, not a
reconstruction from memory or prior docs.

## Step 6 core (full detail)

```
orchestrator.js
  → (none — code-level; two "Axiom*" hits in this file are inside
     comments only, confirmed by line inspection)

agent-registry-integration.js
  → AxiomOrchestrator            (hard — module requires the Orchestrator
                                    to be loaded first)
  → AxiomBrowserManager          (soft — `global.X || fallback`)
  → AxiomBrowserToolRegistry     (soft)
  → AxiomBrain                   (soft)
  → AxiomMemoryManager           (soft)
  → AxiomAutomationManager       (soft)
  → AxiomAnalyticsAutomation     (soft)
  → AxiomRuntimeMonitor          (soft, comment-adjacent — reports to it
                                    if present)

capability-router.js
  → AxiomOrchestrator            (hard)

workflow-planner.js
  → AxiomOrchestrator            (hard)
  → AxiomCapabilityRouter        (soft — falls back to raw
                                    Orchestrator.dispatch() if absent;
                                    verified by the passing regression
                                    case "works without capability-router.js
                                    loaded")
  → AxiomRuntimeContext          (hard — the Part 4 suite asserts the
                                    module requires runtime-context.js to
                                    be loaded first)

runtime-context.js
  → AxiomOrchestrator            (soft — verified by the passing
                                    regression case "module does not
                                    throw or require Orchestrator to be
                                    present")
```

## Full os/core/ graph (all 30 files, load-order relevant edges only)

Base layer (no code-level dependency on any other os/core singleton):
`orchestrator.js`, `ai-core.js`, `app-manifest.js`, `browser-engine.js`,
`browser-sandbox.js`, `memory-engine.js`, `memory-world.js`,
`theme-engine.js`, `motion-system.js`.

Everything else in `os/core/` is a bridge, manager, or UI-shell file one
or two layers above that base (e.g. `automation-manager.js` →
`AxiomAutomationBuilderEngine`/`AxiomBrain`/`AxiomBrowserManager`/
`AxiomMemoryEngine`; `brain-memory-bridge.js` →
`AxiomBrain`/`AxiomMemoryEngine`). None of these reference back into the
Step 6 files (`orchestrator.js`, `capability-router.js`,
`workflow-planner.js`, `runtime-context.js`,
`agent-registry-integration.js`) except through
`agent-registry-integration.js`'s own soft, one-directional lookups
listed above.

## Circular references

**None found**, in the Step 6 core or in the full `os/core/` graph.
Verified by checking, for every edge above, whether the target file
references back to the source — it does not, in every case checked.

## Integration finding: none of the five Step 6 files are loaded by any page

Checked directly: `grep -rln "core/orchestrator\|core/capability-router\|
core/workflow-planner\|core/runtime-context\|core/agent-registry-integration"`
across every `.html` and `.js` file in the repo, excluding `test-evidence/`.

Result: **zero** `<script>` tags anywhere reference `os/core/orchestrator.js`,
`os/core/capability-router.js`, `os/core/workflow-planner.js`,
`os/core/runtime-context.js`, or `os/core/agent-registry-integration.js`.
The three non-test hits that came back are comments inside
`capability-router.js` referring to sibling filenames, not load wiring.

By contrast, `os-shell.html` (the actual application shell) loads a
**separate, parallel** orchestration stack from `os/runtime/`:
`os/runtime/task-router.js`, `os/runtime/agent-manager.js`,
`os/runtime/intelligence/orchestrator.js`,
`os/runtime/scheduler/task-scheduler.js`, and others — a different
implementation of overlapping concerns (an "orchestrator", a task
scheduler, agent management) that is *not* the code this certification
was asked to audit.

This means: everything verified in this pass about the Step 6 `os/core/`
files is true of that code in isolation — it functions correctly, its
regression suite passes, its architecture is sound. But as of this
repo's current state, **none of it is reachable from any live page.**
It's either (a) a parallel implementation not yet wired in, (b) legacy
code superseded by the `os/runtime/` stack, or (c) wired in through a
mechanism outside static `<script>` tags that I did not find. I can't
tell which from the source alone — that's a product/repo-history
question, not something grep or a regression suite resolves. Flagging
this explicitly rather than letting "130/130 tests pass" imply the code
is live in production, because it would be misleading to certify
production-readiness of code with no confirmed path into production.

This graph is also `os/core/` only for the detailed edge list above —
it does not trace internal wiring within `os/runtime/`, `js/core/`, or
`js/pages/`; that was out of scope for this pass.
