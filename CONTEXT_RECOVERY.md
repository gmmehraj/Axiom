# AXIOM Runtime Context — Cleanup & Recovery
**Block 2 · Step 6 · Part 5**
**File:** `os/core/runtime-context.js`

## 1. Three storage tiers

```
activeById     — CREATED..PAUSED/WAITING. Live, mutable underneath the
                 API, in-flight work. getActiveContexts() reads only here.

archivedById   — just reached COMPLETED/FAILED/CANCELLED. Still fully
                 readable via getContext() and recoverable via
                 recoverContext(), until expiresAt passes.

history[]      — append-only, bounded to the most recent 1000 entries.
                 One row per lifecycle event (created, each transition,
                 archived, recovered, destroyed). Survives past
                 DESTROYED — this is the audit trail, not a data store;
                 it holds event records, not full context payloads.
```

A context's data only ever exists in one of `activeById` /
`archivedById` at a time — moving between tiers is always a delete-then-
insert, never a copy, so there is exactly one live source of truth per
`contextId`.

## 2. Archiving (automatic and manual)

The instant a context reaches a terminal status (see
`CONTEXT_LIFECYCLE.md` §4), it is archived automatically:

```
activeById[id] deleted
ctx.archivedAt = now()
ctx.expiresAt  = archivedAt + archiveTtlMs      // default 5 minutes
archivedById[id] = ctx
emit('context_archived', { contextId, expiresAt })
```

`archiveTtlMs` is configurable per-context via
`createContext({ archiveTtlMs })` — a short-lived request context and a
long-running workflow context can carry different retention windows.

`archiveContext(contextId)` is also callable directly for a context that
hasn't reached a terminal status yet. It force-transitions the context to
`CANCELLED` first (through the normal validated path — never a raw
field write) and then archives it, so a manually-archived context is
never left in an invalid, non-terminal-but-archived state.

## 3. Recovery

```js
const recovered = AxiomRuntimeContext.recoverContext(contextId);
```

If the context is still in `archivedById` and hasn't passed its
`expiresAt`, `recoverContext()`:

- removes it from the archive tier and reinserts it into the active tier,
- resets its status to `READY` (not back to whatever terminal status it
  had — a recovered context always restarts from a clean, valid point in
  the lifecycle),
- clears `archivedAt`/`expiresAt`,
- emits `context_recovered`.

This is for retry-style flows: a stage failed, the workflow layer decides
to retry, and it can pull the same `contextId` back into `READY` instead
of allocating a fresh one and losing whatever `state`/`metadata` had
already accumulated.

`recoverContext()` returns `null` — not a thrown error — for a
`contextId` that was never archived, or whose archive window has already
expired. Both are treated as "not recoverable" rather than exceptional.

## 4. Expiry-based destruction

```js
const removedIds = AxiomRuntimeContext.cleanupExpiredContexts();
```

Scans `archivedById` and permanently `destroyContext()`s every entry
whose `expiresAt` has passed. This is the mechanism that turns a
time-bounded archive into an actual, bounded-memory cleanup — contexts
don't accumulate forever just because nobody explicitly destroyed them.

Two guarantees, both covered by the regression suite:

- **Active contexts are never touched.** `cleanupExpiredContexts()` only
  ever iterates `archivedById`; a context that's still `RUNNING` or
  `PAUSED` cannot be swept even if it's been alive a long time — it isn't
  eligible for archival (and therefore expiry) until it reaches a
  terminal status. *"Context cleanup must never affect active
  workflows"* is enforced structurally by which map the sweep reads from,
  not by an extra check.
- **Destroying one context never disturbs another.** Cleanup, recovery,
  and manual destruction all operate on a single `contextId` at a time
  with no cascade to parents, children, or workflow-siblings.

`startAutoCleanup(intervalMs?)` / `stopAutoCleanup()` wrap
`cleanupExpiredContexts()` in a background `setInterval` (default 30s,
`unref()`'d where supported so it never keeps a Node process alive on its
own) for callers that want expiry handled without polling manually.
Calling `cleanupExpiredContexts()` directly — e.g. right before reading
`getContextMetrics()` — works identically without opting into the
timer.

## 5. Full manual destruction

```js
AxiomRuntimeContext.destroyContext(contextId, reason?);
```

Works on a context in *any* state — active or archived. If it's still
active, it's force-transitioned to `CANCELLED` first (see
`CONTEXT_LIFECYCLE.md` §6), then removed from whichever tier it's in,
its timeout handle (if any) is cleared, a final `destroyed` row is
appended to `history[]`, `destroyedCount` is incremented, and
`context_destroyed` is emitted. Returns `true` on success, `false` for a
`contextId` that's already gone — never a thrown exception, so a
double-destroy or a race against `cleanupExpiredContexts()` is always
safe to call.

## 6. What outlives destruction

`getContextHistory()` keeps a event-level record (`contextId`,
`workflowId`, `requestId`, `ownerAgent`, `status`, `event`, `at`) for
every context that has ever existed, bounded to the most recent 1000
entries across the whole engine. This is intentionally lightweight — it
is an audit trail for monitoring (`getContextMetrics()`,
`getContextHistory()`), not a substitute for Memory. Once a context is
`DESTROYED`, its full `state`/`temporaryData` payload is gone; only the
history rows remain.
