# AXIOM Workflow Context — Shape & Propagation
**Block 2 · Step 6 · Part 4**
**File:** `os/core/workflow-planner.js` · **Global:** `window.AxiomWorkflowPlanner`

## 1. What it is

The Workflow Context is a plain in-memory object created fresh by
`executeWorkflow()` at the start of a run and threaded, by reference,
through every stage in that run. It is **not** a new storage layer — it is
never written to `AxiomMemoryEngine`, `localStorage`, or anything else
persistent. Once a workflow reaches a terminal status the context stops
changing, but it's kept (read-only, via `getWorkflow()`) on the finished
workflow record purely for inspection/debugging; nothing re-hydrates it
into a new run, and a fresh `executeWorkflow()` call on the same workflow
definition creates an entirely new context.

## 2. Shape

```js
{
  workflowId: 'wf_...',
  trigger:    <whatever was passed to executeWorkflow(id, trigger)>,

  state: {},        // freeform, stage-writable shared state (see §4)
  outputs: {},       // stage id -> that stage's raw result
  timestamps: {},    // stage id -> { startedAt, finishedAt }

  metadata: {
    startedAt: <epoch ms>,
    stageCount: <number of stages in this workflow>
  }
}
```

| Field | Written by | Read by |
|---|---|---|
| `trigger` | `executeWorkflow(id, trigger)` caller, once | any stage's `input()` |
| `outputs[stageId]` | the execution loop, after each stage completes | any later stage's `input()`/`onResult()` |
| `state` | a stage's `onResult(result, ctx)` returning `{ context: {...} }` | any later stage's `input()` |
| `timestamps[stageId]` | the execution loop, at stage start/finish | monitoring / `getWorkflow()` snapshots |
| `metadata` | set once at workflow start | monitoring |

## 3. Propagation model

1. `executeWorkflow()` calls `createContext(wf, trigger)`, producing the
   object above with empty `outputs`/`state`/`timestamps`.
2. For each stage, in dependency order, the execution loop calls
   `stage.input(context)`. The **return value** of `input()` — not the
   context object itself — becomes that stage's `task.payload`. This is
   the enforcement point for "each stage receives only the context
   required for that step" (see `MULTI_AGENT_COLLABORATION.md` §4): a
   stage can read anything already in `context.outputs`/`context.state`
   while deciding what to hand its agent, but the agent only ever sees
   what `input()` chose to return.
3. When the stage's agent finishes, `applyStageResult()` writes the raw
   result to `context.outputs[stage.id]` unconditionally, then — if the
   stage declared an `onResult(result, context)` function — calls it and,
   if it returns an object with a `context` key, shallow-merges that
   object into `context.state`. This is the one sanctioned way a stage can
   contribute to the *shared* part of the context rather than just its own
   `outputs` slot (e.g. accumulating a running total, or normalizing a
   result before later stages see it via `state` instead of raw
   `outputs`).
4. `context.timestamps[stage.id]` is stamped by the loop itself
   (`startedAt` when the stage is dispatched, `finishedAt` when its
   outcome — success, failure, or skip — is known), independent of
   anything the stage or its agent does.

## 4. `outputs` vs `state` — when to use which

- **`outputs[stageId]`** is the default, automatic record of "what did
  this stage produce". Always populated, never requires opt-in. Best for
  the common case (`ctx.outputs.research.findings`).
- **`state`** is for a stage that wants to publish something under a
  *stable, workflow-level* name rather than tied to its own stage id — for
  example, several alternative stages that could each produce a
  `state.summary`, so downstream stages don't need to know which one
  actually ran. Opt-in via `onResult()`, deliberately separate from the
  automatic `outputs` bookkeeping so a stage can't accidentally clobber
  another stage's namespace.

## 5. Lifetime and scope

- **Created:** at the start of every `executeWorkflow()` call — a
  workflow re-run (a fresh call with the same `workflowId`, once the
  planner supports re-running a finished workflow) gets a brand new
  context, not a continuation of the old one.
- **Mutated:** only by the execution loop and by stages' own `onResult()`
  return values, both described above. No agent handler is ever given the
  context object to mutate directly.
- **Read after completion:** `getWorkflow(id)` returns a shallow snapshot
  (`{ outputs, state, metadata }`) of the finished context for
  inspection/debugging/UI display — copies, not the live object, so
  inspecting a finished workflow can never affect a different in-flight
  run of the same workflow definition.
- **Discarded:** nothing explicitly deletes the context; it simply stops
  being referenced by anything except the finished workflow's own record,
  and is never written anywhere durable. This satisfies "Workflow Context
  exists only during execution / do not store permanent memory" by
  construction — there is no code path in this module that calls into
  `AxiomMemoryEngine` or any other persistence API at all.
