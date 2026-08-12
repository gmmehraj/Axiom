# AXIOM — Block 2 → Step 7 → Part 1: AI Workflow Validation

**Date:** 2026-08-01
**Method:** Real calls against the live stack (same harness lineage as
`MULTI_AGENT_EXECUTION.md`). Continues directly from the Part 6B
pass's `EXECUTION_EVIDENCE.md` — `dispatch()`, `route()`,
`executeWorkflow()`, `retry()`, `cancel()`, priority scheduling, and
context lifecycle were already verified there against the five Step 6
agents; this document adds what's new in this pass: the Coding Agent's
real, corrected execution behavior, found and fixed during this pass.

## dispatch() — Coding Agent, real calls

**`project-search`** (real `Toolkit.projectSearch(query, limit)`):
```
status: failed — "Workspace search is unavailable on this page."
```
Correct, real behavior — the workspace-search subsystem
(`window.AxiomAgents`) isn't loaded in this harness. Confirmed this is
the toolkit's own real thrown error, not a crash or hang.

**`explain-code`** (real `Toolkit.explainCode(prompt, opts)`):
```
status: failed — "No code-generation model client is available on this page."
```
Correct, real behavior — no `window.OpenRouter` client loaded (see
`AI_RUNTIME_INTEGRATION.md`). `explainCode()` does not pre-check for a
client; the failure surfaces from `completeText()` rejecting, which
`safeInvoke()` lets propagate as a normal task failure — not a raw,
unhandled exception.

**`propose-refactor`** (real `Toolkit.proposeRefactor(prompt, instructions, opts)`):
```
status: completed
result: {"proposal":null,"requiresConfirmation":true,"applied":false,
  "note":"No code-generation model client is available — nothing was
  proposed or applied."}
```
Correct, real behavior, and a genuinely different shape from
`explain-code` above — `proposeRefactor()` pre-checks `hasClient()`
itself and returns a structured, graceful result instead of failing the
task. Confirmed by reading the source before asserting this, not
assumed by pattern-matching to the other one.

**Unsupported operation:**
```
status: failed — "Coding Agent: unsupported task type \"not-a-real-op\"."
```
Matches the exact same error-handling convention as the other six
agents (Browser/Brain/Memory/Automation/Analytics/System all throw the
same `"<Agent Name>: unsupported task type ..."` shape for an unknown
op).

## Bug found and fixed during this pass's verification

**What happened:** the coding agent handler I wrote in this pass
initially called `Toolkit.explainCode(task, payload)`,
`Toolkit.proposeRefactor(task, payload)`, and
`Toolkit.investigateBug(task, payload)` — passing the whole task/payload
objects as the first positional argument. Reading the toolkit's real
signatures (`explainCode(prompt, opts)`,
`proposeRefactor(prompt, instructions, opts)`,
`investigateBug(description, opts)`) during this pass's own live-call
verification showed this was wrong: the first argument is meant to be
the actual code/text string, not an object. It didn't crash — because
every path ends up hitting the same "no client available" failure
regardless of what the first argument was — but if a real client were
present, this would have sent a stringified object (`"[object Object]"`)
to the model instead of the person's actual code.

**Fixed in this pass, before documenting it as working:** the handler
now passes `payload.code`/`payload.description` as the real first
argument and `{ task: payload.context || null }` as `opts`, matching
each method's real signature. Also fixed `project-search`/
`file-navigation`'s second argument, which was passed the whole payload
object instead of `payload.limit`.

**Re-verified after the fix:** the harness output above is from the
corrected handler. Re-ran the Part 2 regression suite (18/18, unchanged)
and the full five-suite Step 6 regression run (130/130, unchanged)
after this fix.

## Priority scheduling / retry / cancel / context lifecycle

Not re-derived in this pass — these were verified with real execution
evidence in the Part 6B pass (`EXECUTION_EVIDENCE.md`:
cancel returns `true` on a queued task; retry with `maxRetries: 2`
completes after 2 real attempts; shutdown/restart works correctly) and
nothing in this pass touched the scheduling, retry, or cancellation
code paths — only a new agent registration was added. Citing rather
than re-running identical tests against unchanged code.

## Multi-agent workflow execution

See `MULTI_AGENT_EXECUTION.md` for the full chain results (Browser →
Brain → Memory → Automation completed end-to-end; Coding → Brain →
Automation correctly failed at the coding stage due to a separate,
pre-existing subsystem dependency, with correct downstream skip
behavior).

## Not Verified

- Coding Agent operations under a real, live OpenRouter client — no
  such client is wired into this environment (see
  `AI_RUNTIME_INTEGRATION.md` for why, in detail).
- Coding Agent's search-backed operations
  (`project-search`/`file-navigation`/`analyze-project`) under a real,
  live `window.AxiomAgents` workspace-search index — not loaded in this
  pass's harness or in `automation.html` currently.
- Analytics agent live execution — not registered in this pass's
  harness (see `AI_RUNTIME_INTEGRATION.md`).
