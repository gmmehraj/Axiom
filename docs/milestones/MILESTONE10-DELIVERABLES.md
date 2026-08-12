# AXIOM AI OS — Milestone 10 Deliverables
Conversational AI & Natural Interaction Layer

Milestone 9 (Executive AI) is preserved exactly as delivered. This milestone adds
one new coordination layer on top of it — a Conversation Manager — and changes
nothing else in the runtime, UI, or visual layer.

---

## 1. Architecture Summary

Milestone 9 already gave AXIOM a single-shot "brain": text in, Executive AI
plans, dispatches, monitors, and returns an outcome. What was still missing was
memory of the *conversation itself* — the fact that "save the best ones" only
means something because "Research AI startups" was said a moment ago.

Milestone 10 adds exactly that, as a thin layer that sits **in front of**
Executive AI and does not change how Executive AI, the Orchestrator, the Agent
Manager, the Task Router, the Event Bus, Memory Intelligence, Planner
Intelligence, Browser Intelligence, or the Runtime Monitor behave:

```
 user text
    │
    ▼
 Conversation Manager (NEW)
    │  1. resolve "it"/"that"/"those"/"the previous one" against
    │     THIS conversation's own state (never a global)
    │  2. inject an implicit object into bare follow-ups
    │     ("Create a roadmap." -> "...for AI startups.")
    │  3. if nothing in this conversation resolves the reference,
    │     ask for clarification — never guess
    ▼
 AxiomExecutiveAI.handle(resolvedText)      <- UNCHANGED, Milestone 9
    │
    ▼
 AxiomTaskPlanner -> AxiomTaskRouter -> AxiomOrchestrator
    -> AxiomAgentManager.dispatch()          <- UNCHANGED, Milestone 4/8
    │
    ▼
 existing bus events (executive:*, job:*, orchestrator:*)
    │
    ▼
 Conversation Stream (NEW) — relays those SAME events into a normalized
 conversation:* family for progressive/streaming UI, and
 Conversation Memory (NEW) — decides which completed turns are worth a
 memory write, through the SAME AgentManager.route() path Executive AI
 itself already uses.
```

The Conversation Manager **coordinates only**. It never plans a step, never
picks an agent, never touches storage, and never dispatches directly — every
one of those responsibilities still belongs to the Milestone 4/8/9 modules that
already had it. Its only two jobs are (a) turning a follow-up sentence into a
self-contained one, and (b) remembering enough about the conversation to do
that turn after turn.

---

## 2. New Modules Added

All under `os/runtime/conversation/` (new folder, no existing folder touched):

| File | Role |
|---|---|
| `nlu-resolver.js` (`window.AxiomNLU`) | Pure text-in/text-out heuristics: topic extraction, reference detection (`it`/`that`/`those`/`them`/`these`/`the previous one`/`the last one`), reference resolution against conversation state, and implicit-object injection for bare follow-ups. Stateless — takes a state *snapshot* as an argument, owns nothing itself. |
| `conversation-stream.js` (`window.AxiomConversationStream`) | Subscribes to the **existing** bus events Milestones 4/8/9 already emit (`executive:analyzing`, `executive:memory-loaded`, `executive:strategy-selected`, `executive:submitted`, `job:progress`, `executive:adapting`, `executive:completed`, `executive:clarification-needed`, `executive:cancelled`) and re-emits them as a normalized `conversation:thinking` / `conversation:progress` / `conversation:done` / `conversation:clarification-needed` family, scoped to `{conversationId, turnId}`. A pure relay — it invents no new telemetry and duplicates no aggregation JobManager already does (per-agent progress is read from the *existing* `job:progress` notes rather than re-deriving it from raw orchestrator step events a second time). |
| `conversation-memory.js` (`window.AxiomConversationMemory`) | Decides whether a completed turn is worth remembering (multi-step outcome, decision/save language, or long-running task) and writes through `AxiomAgentManager.route({agentId:'agent.memory', ...})` — the exact same public entry point Executive AI's own outcome-note writer already uses. Ordinary single-step chit-chat is filtered out, per requirement 8. |
| `conversation-manager.js` (`window.AxiomConversationManager`) | The coordinator. Holds per-conversation state (`turns[]`, `activeTopic`, `activeWorkflow`, etc.) in a **private closure `Map`**, never a bare/global variable and never on `window` — the only way in or out is `start`/`send`/`resolveClarification`/`history`/`state`/`subscribe`/`reset`. Bounds each conversation's history to 25 turns so long sessions cannot grow memory without limit. |
| `conversation-context.js` (`window.AxiomConversationContext`) | Read-only aggregator for requirement 4. Assembles one bundle (conversation, active workflow, previous responses, selected memory, browser session, planner state) by asking `AxiomConversationManager`, `AxiomMemoryIntelligence`, `AxiomBrowserBridge`, `AxiomJobManager`, and `AxiomPlanner` each for their own slice — it owns none of that state itself, and every lookup degrades to `null`/`[]` on failure rather than throwing. |
| `m10-bootstrap.js` | Loads last. Confirms the Conversation Manager initialized, extends the existing `window.AxiomRuntime` facade **non-destructively** with `.conversation`, and adds `AxiomRuntime.selfTestM10()` in the same shape as `selfTest()`/`selfTestM8()`/`selfTestM9()`. |

---

## 3. Files Modified

Exactly **one** existing file changed, and only to load the new scripts:

- `os-shell.html` — six new `<script>` tags added immediately after
  `os/runtime/executive/m9-bootstrap.js` and before `os/core/window-manager.js`.
  No tag was removed or reordered, no other line in the file changed, and no
  CSS, layout, or visual markup was touched anywhere in this file or any other.

No other `.html`, `.css`, or existing `.js` file was modified. No file under
`os/core/`, `os/runtime/` (outside the new `conversation/` folder), or any of
Milestones 4–9's deliverables was edited.

---

## 4. Runtime Changes

- **No new bus event types were invented** for execution/dispatch — the
  Conversation Manager and Conversation Stream only *observe* the existing
  `executive:*`, `job:*`, and `orchestrator:*` events. The `conversation:*`
  family is purely additive and purely downstream (a UI convenience layer),
  never a replacement for the events it relays.
- **No change to agent registration, the Task Router's rules, the
  Orchestrator's execution model, the Job Manager's retry/adapt logic, or
  Executive AI's supervision loop.** `AxiomExecutiveAI.handle()` is called with
  exactly the same signature and semantics Milestone 9 shipped.
- **Memory writes** from the conversation layer go through the identical
  `AxiomAgentManager.route()` path every other caller (including Executive AI
  itself) already uses — no direct storage access was added anywhere.

---

## 5. Verification Performed

`test-evidence/milestone10-regression-suite.js` — a jsdom harness in the same
style as the Milestone 5/6 regression suites — loads the **real** runtime
chain (agent-runtime → agent-definitions → capabilities → task-router →
agent-manager → runtime-bootstrap → Milestone 8 intelligence → Milestone 9
Executive AI → Milestone 10 conversation layer) against light in-memory fakes
for the two external backends (`AxiomAgents` memory store, `AxiomBrowserLive`
same-window browser), not against mocks of the runtime itself.

Full output: `test-evidence/milestone10-regression-output.txt` — **30/30
checks passed**, including:

- **Regression, Milestones 4–9:** `AxiomRuntime.selfTest()`,
  `selfTestM8()`, and `selfTestM9()` all still pass unchanged; still exactly
  10 core agents with no duplicates.
- **Milestone 10 self-test** (`AxiomRuntime.selfTestM10()`): clarification
  short-circuits correctly, reference resolution rewrites text before it
  reaches Executive AI, streaming emits progressive events, context loads all
  sections, and per-conversation history never cross-talks.
- **Single-turn conversation:** an ordinary request runs the unmodified
  Executive AI pipeline end to end.
- **Multi-turn conversation** (the brief's own example, verified verbatim):
  `"Research AI startups."` → `"Now save the best ones."` → `"Create a
  roadmap."` → `"Open them in Browser."` — each follow-up resolves against the
  conversation's own active topic without the user repeating it.
- **Follow-up / ambiguous requests:** a bare reference (`"fix that"`) in a
  brand-new conversation with zero history correctly demands clarification
  instead of guessing, and never produces an `executiveId` (nothing was run
  speculatively); `resolveClarification()` then resumes the pipeline once
  answered.
- **Streaming responses:** subscribing to a conversation surfaces a
  `thinking` stage and a terminal `done` event, sourced from the existing bus.
- **Context loading:** `AxiomConversationContext.build()` returns conversation
  state, previous responses, selected memory (Memory Intelligence), browser
  session (Browser Bridge), and planner state, all assembled from the modules
  that already own each piece.
- **Memory updates:** `AxiomConversationMemory`'s selectivity filter runs
  without throwing and without a second, duplicate write path.
- **Runtime stability:** the Conversation Manager exposes no `dispatch()` or
  `route()` of its own, and Executive AI / Agent Manager / Event Bus /
  Orchestrator / Memory Intelligence remain the same singletons before and
  after Milestone 10 loads.
- **No global-variable leakage:** `window.conversations` (or any bare global)
  is never created; two conversations never share an active topic.

---

## 6. Remaining Limitations

- **Reference resolution is a linguistic heuristic, not a trained coreference
  model** — the same honest framing already used for semantic recall
  (Milestone 8) and search planning (Milestone 8). It resolves the patterns
  named in the brief (`it`/`that`/`those`/`the previous one`, plus `them`,
  `these`, and "the best ones") reliably, but an unusual or highly ambiguous
  follow-up sentence outside those patterns may still need a manual rephrase.
- **One active topic per conversation.** If a conversation genuinely juggles
  two unrelated subjects in parallel ("the AI startups" and, separately, "the
  quarterly report"), a reference resolves to whichever was mentioned most
  recently, not by inferring which of several open topics is meant.
- **Browser session context is read-only and best-effort.** It reflects
  whatever `AxiomBrowserBridge.historyList()` already reports; if no browser
  session exists yet, that section of the context bundle is simply `null`
  rather than an error.
- **No persistence across a full page reload.** Like Milestone 8's scheduler,
  conversation state lives in memory for the session (Milestone 9's learning
  ledger is the only piece of this stack that persists via `localStorage`) —
  called out here rather than silently dropped.
- **Conversation memory selectivity is a heuristic filter**, not a learned
  importance model — it keys off multi-step outcomes, decision/save language,
  and duration, which covers the brief's stated categories but is not
  exhaustive of every situation a person might consider "important."
