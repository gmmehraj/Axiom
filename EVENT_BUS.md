# AXIOM Orchestrator — Event Bus
**Block 2 · Step 6 · Part 1** · part of `os/core/orchestrator.js`

## Why a separate bus instead of DOM CustomEvents

Existing bridges (`browser-brain-bridge.js`, `automation-memory-bridge.js`,
`AxiomBrain`'s own `onChange`) already use DOM events / BroadcastChannel
for **cross-tab, cross-page** sync — that's a Brain/Memory concern and is
untouched by this pass. The Orchestrator's bus is a separate, in-process
pub/sub used for **within-runtime coordination**: subscribing to it does
not require a DOM, it gives a real `off(event, fn)` (removing one specific
listener, not just "stop listening to everything"), and a real `once()`
contract — none of which `addEventListener`/`CustomEvent` gives you
cleanly without extra bookkeeping.

## API

```js
const unsubscribe = AxiomOrchestrator.on('task_completed', (payload, event) => {
  console.log(event, payload.task.id, payload.result);
});

AxiomOrchestrator.once('startup', () => console.log('orchestrator is up'));

AxiomOrchestrator.off('task_completed', myHandler);
// or, using the returned unsubscribe function:
unsubscribe();

AxiomOrchestrator.emit('my:custom:event', { anything: 'you want' });
```

| Method | Behavior |
|---|---|
| `on(event, fn)` | Subscribes `fn`. Returns an `unsubscribe()` function. Subscribing the same `fn` to the same `event` twice is a no-op (no duplicate firing). |
| `once(event, fn)` | Same as `on()`, but the listener is removed automatically after it fires once. |
| `off(event, fn)` | Removes that specific listener. Calling `off(event)` with no `fn` removes every listener for that event. |
| `emit(event, payload)` | Calls every subscriber for `event` with `(payload, event)`. Synchronous, in subscription order. |

Every method above is also available directly on `AxiomOrchestrator`
(e.g. `AxiomOrchestrator.on(...)`) — there is no separate bus object
callers need to reach for.

## Guarantees

- **No duplicate subscriptions.** Calling `on()`/`once()` with a function
  reference that's already subscribed to that event is a no-op — it will
  not fire twice per `emit()`.
- **A throwing listener can't break the bus.** Each listener is invoked
  inside its own `try/catch`. An exception is logged via the internal
  `reportError()` helper and every remaining listener for that `emit()`
  still runs. `emit()` itself never throws because a listener did.
- **Safe re-entrancy.** A listener that calls `on()`/`off()`/`once()` for
  the *same* event while it's being emitted does not corrupt the
  in-flight dispatch — `emit()` iterates a snapshot of the listener list
  taken at the start of the call.

## Built-in lifecycle events

These are emitted by the Orchestrator itself (see
`ORCHESTRATOR_ARCHITECTURE.md` for the full lifecycle diagram):

| Event | Payload | Fired when |
|---|---|---|
| `startup` | `{ at, apiVersion }` | Runtime transitions to `running` |
| `shutdown` | `{ at }` | Runtime transitions to `stopped` |
| `agent_registered` | `{ agentId, agent }` | `registerAgent()` succeeds |
| `agent_removed` | `{ agentId }` | `unregisterAgent()` succeeds |
| `task_started` | `{ task }` | The scheduler begins running a task |
| `task_completed` | `{ task, result }` | A task's handler resolves successfully |
| `task_failed` | `{ task, reason, timedOut?, cancelled? }` | A task exhausts its retries, times out, or is cancelled |

Every one of these is also re-emitted as a single `lifecycle` event with
shape `{ event, payload }`, so a caller that wants to observe *all*
lifecycle activity (e.g. a debug panel or an activity feed) can subscribe
once instead of to all seven events individually:

```js
AxiomOrchestrator.on('lifecycle', ({ event, payload }) => {
  activityFeed.push({ event, payload, at: Date.now() });
});
```

## Custom events

Nothing restricts `emit()`/`on()` to the built-in lifecycle names — any
future agent or bridge can use the same bus for its own coordination
(e.g. an `openrouter:rate-limited` event from a future provider agent)
without needing a change to `orchestrator.js`.
