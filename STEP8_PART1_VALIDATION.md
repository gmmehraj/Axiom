# AXIOM — Block 2 · Step 8 · Part 1 Validation Report
## Cognitive Decision Engine (Foundation)

**Date:** 2026-08-05
**Status:** ✅ Complete — 41/41 new regression assertions passing;
all other pre-existing, applicable regression suites re-run and still
passing.

---

## 1. Scope delivered

| Requirement | Delivered as |
|---|---|
| New module `os/core/decision-engine.js` | Created. |
| Global `window.AxiomDecisionEngine` | **Deviation — see §2.** Installed as `window.AxiomCognitiveDecisionEngine` instead, to avoid silently colliding with the pre-existing `window.AxiomDecisionEngine` (Step 7 Part 3C's goal-scheduling engine). |
| Intent Detection: primary intent, multiple intents per request, confidence scores, category classification | `detectIntent(text)` — keyword/phrase scoring against `INTENT_LEXICON`; `intents[]` array, each with `category`, `confidence`, `isPrimary`, `matchedKeywords` |
| Intent categories (conversation, browser, automation, workspace, memory, reasoning, coding, research, planning, search, analytics, system, unknown) | `INTENT_CATEGORIES` — all 13 present |
| Context Extraction: entities, keywords, commands, URLs, file names, application names, dates, times | `extractContext(text)` — all 8 fields present |
| Goal Generation, reusing Goal Manager + Runtime Context, no duplicated goal-creation logic | `decide()` calls `AxiomGoalManager.createGoal()` unchanged for each processed intent; the decision itself gets one real `AxiomRuntimeContext` record (created → running → completed/failed) |
| Capability Discovery via the existing Capability Router, no hardcoded capability names | `matchCapabilities()` scores only capabilities returned live by `AxiomOrchestrator.discoverCapabilities()` at call time |
| Agent Recommendation via the existing Agent Orchestrator registry, recommend only, never dispatch | `AxiomCapabilityRouter.selectAgent()` called verbatim; `route()`/`prepare()`/`dispatch()` never called (regression-tested) |
| Structured Decision Object (intent, confidence, context, goals, capabilities, agents, reasoning) | `decide()` return value — frozen, all fields present |
| Events `decision_started` / `decision_completed` / `decision_failed` via the Orchestrator Event Bus | Emitted via `Orchestrator.emit()`; verified no collision with any pre-existing event name in `os/core` |
| Reuse only existing systems (Goal Manager, Agent Orchestrator, Capability Router, Runtime Context, Analytics) | See §3 — every mutation/lookup goes through an existing public entry point; Analytics is reached only indirectly, as a capability an `analytics`-intent request may route to, same as any other capability |
| No duplicated planning/scheduling/routing/orchestration/retry/recovery logic | See §3 |
| Analysis only — no task execution | `decide()` never calls `dispatch`, `route`, `prepare`, `enqueue`, or any agent handler; goals it creates are left in `pending` (regression-tested) |

---

## 2. Naming collision — `window.AxiomDecisionEngine` already claimed

The brief asks for the global `window.AxiomDecisionEngine`. Inspecting
the delivered project first (required before adding any new global —
see every prior Part's own header) found that name already installed
by `os/core/autonomous-decision-engine.js` (Step 7 Part 3C), for a
categorically different purpose: deciding which already-queued Goal
Record is eligible to run next, given the live goal graph, system
load, and agent availability. That module's own header explicitly
documents it does *not* do intent detection, context extraction, or
any NLU-style analysis of a raw request — the exact gap this Part is
scoped to fill.

Installing this Part's engine onto the same `window.AxiomDecisionEngine`
name would not "add" a decision engine — it would silently overwrite
whichever of the two loads second, or (if load order runs the other
way) be silently shadowed itself, depending purely on `<script>` tag
order in whichever `.html` page loads both. This is precisely the
"Naming Collision" failure class `os/core/goal-manager.js`'s own file
header documents encountering and fixing (citing `RUNTIME_CONTEXT.md`
FIX 4) — and the fix there was the same one applied here: pick a
disjoint name for the new module rather than reuse a name another,
still-needed module already owns on the shared global surface.

**Resolution:** this Part installs as `window.AxiomCognitiveDecisionEngine`.
This is flagged prominently in the module's own file header, in
`CHANGELOG.md`, and here, rather than silently deviating from the
brief's literal wording. Regression-tested (see §4): both engines
coexist correctly when loaded together on the same page, each on its
own name, each fully functional, with zero edits to Part 3C's file.

If a single canonical `window.AxiomDecisionEngine` name is wanted going
forward, that is a rename decision for a future Part to make
deliberately (and would need to update Part 3F's own live reference to
`AxiomDecisionEngine.admitGoal()`, plus its regression suite) — not
something this Part should force by silently claiming the name out
from under Part 3C.

---

## 3. Reuse verification — no duplicated logic

| Existing system | How this Part reuses it | How duplication was avoided |
|---|---|---|
| `AxiomOrchestrator` (Event Bus, agent registry) | `emit`/`on` for the three new events; `listAgents()` for application-name extraction; `discoverCapabilities()` for capability discovery | This Part installs nothing onto `AxiomOrchestrator`'s own surface — same standalone-global posture as `goal-manager.js` / `autonomous-decision-engine.js` |
| `AxiomRuntimeContext` | One real context record created per `decide()` call (`createContext` → `markReady` → `markRunning` → `completeContext`/`failContext`), mirroring exactly the create/sync/finalize shape `goal-manager.js`'s own `createGoalRuntimeContext()` already uses for goals | No second context/status system invented; Runtime Context's own transition validation is the only status machine involved |
| `AxiomGoalManager` | `createGoal()` called unchanged, once per processed intent | No goal data model, ID scheme, or status machine reimplemented; goals created here are indistinguishable from goals created by any other caller, and are left in `pending` — this Part never calls `markGoalQueued`/`markGoalRunning`/etc. |
| `AxiomCapabilityRouter` | `selectAgent(capability, options)` called directly for agent recommendation | `route()`, `dispatch()`, `prepare()`, `monitor()`, `cancelRequest()`, `retryRequest()` are never called — regression-tested (`recommendation never dispatches or routes`) |
| Analytics | Reachable only as a capability an `analytics`-classified request may score against, exactly like every other capability — no separate Analytics integration exists to duplicate | — |

No goal decomposition, task graph, scheduling queue, capability
routing/retry pipeline, or agent-selection ranking algorithm is
reimplemented anywhere in `decision-engine.js`.

---

## 4. Regression suite — `block2-step8-part1-decision-engine-regression-suite.js`

41/41 assertions passing. Coverage:

- **Load-order guards** (4): refuses to install without
  `AxiomOrchestrator` / `AxiomRuntimeContext` / `AxiomGoalManager` /
  `AxiomCapabilityRouter`.
- **Clean install** (1): installs with the full stack present without
  editing any of 6 dependency files (`readFileSync` diff before/after).
- **Naming-collision avoidance** (3): does not touch
  `window.AxiomDecisionEngine`; installs standalone with Part 3C
  entirely absent; emits only previously-unused event names.
- **Intent detection — single intent** (3): coding request, browser
  request, unrecognized text → `unknown`.
- **Intent detection — multi-intent** (3): two distinct intents in one
  request are both returned; exactly one `isPrimary` flag, always the
  highest scorer; `options.maxIntents` caps downstream processing.
- **Confidence scoring** (2): stronger keyword evidence scores at
  least as high as weak evidence; every confidence value is within
  `[0, 1]`.
- **Context extraction** (6): URLs/file names/dates/times; quoted +
  capitalized-phrase entities; a lone sentence-leading capitalized word
  is NOT treated as an entity; imperative commands; application names
  matched against the live agent registry; keyword stopword filtering.
- **Capability discovery** (3): recommendations read only from
  `Orchestrator.discoverCapabilities()`; a brand-new runtime-registered
  capability becomes recommendable with zero code changes;
  `decide()`'s own capability recommendation resolves to a real
  registered capability.
- **Agent recommendation** (4): matches `AxiomCapabilityRouter.
  selectAgent()` directly; `null` when no agent exposes the
  capability; `route()`/`prepare()` are never called; goals created by
  `decide()` are never admitted past `pending`.
- **Goal generation** (3): one real Goal Manager record per processed
  intent; goals carry `decisionId`/`intent`/`confidence` metadata;
  `options.dryRun` produces zero Goal Manager side effects.
- **Decision object structure** (3): all required fields present and
  frozen; a real Runtime Context record is created and completed;
  empty/invalid input throws before any state is created.
- **Events** (4): `decision_started` fires before `decision_completed`
  with matching `decisionId`; `decision_completed` payload correctness;
  `decision_failed` fires (with no `decision_completed`) on a
  simulated Goal Manager failure; the decision's Runtime Context
  record is marked `failed`, not left dangling.
- **History / metrics** (2): `getDecision()`/`getDecisionHistory()`
  round-trip; `getMetrics()` tracks started/completed/failed counts.

```
$ node test-evidence/block2-step8-part1-decision-engine-regression-suite.js
AXIOM Block 2 / Step 8 / Part 1 — Cognitive Decision Engine regression

  PASS  module does not install itself without AxiomOrchestrator present
  ... (41 total)
41/41 assertions passing
```

---

## 5. Full regression run — all suites

All 35 pre-existing regression suites in `test-evidence/` were re-run
unmodified, plus the new suite (36 total):

| Result | Count | Suites |
|---|---|---|
| ✅ Passing | 30 | Every suite that does not require the `jsdom` npm package (includes both Part 3C's own decision-engine suite, 37/37, and Part 3F's, 38/38 — both unaffected) |
| ⚠️ Pre-existing, unrelated failure | 5 | `block2-step1-coding-agent-regression-suite.js`, `block2-step1-part2-pipeline-regression-suite.js`, `milestone5-regression-suite.js`, `milestone6-regression-suite.js`, `milestone10-regression-suite.js` |
| ❌ New failures introduced by this Part | 0 | — |

The 5 failing suites all fail identically, at `require('jsdom')`,
before any AXIOM code runs — `jsdom` is not installed in this offline
sandbox (no network access to fetch it) and none of the five suites
touch `decision-engine.js`, `goal-manager.js`, `capability-router.js`,
`runtime-context.js`, `orchestrator.js`, or
`autonomous-decision-engine.js` in their `require`/load lists. This
matches the "Fix only verified defects" instruction: these are not
defects this Part introduced or could fix by editing
`decision-engine.js`; they are an environment/dependency-installation
gap that predates this Part.

---

## 6. Manual verification (in addition to the automated suite)

Ad hoc `vm`-sandbox runs against the real, unmodified project files
confirmed, end to end:

- A multi-clause request ("open github.com and debug the login
  function, then remind me tomorrow at 3pm to search for react hooks")
  correctly detects `coding` (primary) + `search` (secondary) intents,
  extracts the date (`tomorrow`), time (`3pm`), and two imperative
  commands, and creates two real, independent Goal Manager records.
- Registering a brand-new agent with capability `debug` at runtime
  (`AxiomOrchestrator.registerAgent(...)`) makes `debug` immediately
  recommendable and immediately resolves to that same agent via
  `AxiomCapabilityRouter.selectAgent()` — no code change to
  `decision-engine.js` required.
- Loading `autonomous-decision-engine.js` (Part 3C) alongside this
  Part's `decision-engine.js` in the same sandbox leaves
  `window.AxiomDecisionEngine.selectNextGoal` fully intact and
  `window.AxiomCognitiveDecisionEngine.decide` fully functional,
  confirming the naming-collision fix in §2 holds in practice, not
  just in the regression suite.

---

## 7. Conclusion

Block 2 / Step 8 / Part 1 is complete: the Cognitive Decision Engine
foundation (intent detection, context extraction, goal generation,
capability discovery, agent recommendation, and a structured decision
object) is implemented as `os/core/decision-engine.js` /
`window.AxiomCognitiveDecisionEngine`, reusing Goal Manager, Runtime
Context, and Capability Router without duplicating any of their logic,
publishing `decision_started`/`decision_completed`/`decision_failed`
on the real Orchestrator Event Bus, and performing analysis and
read-only recommendation only — it never executes, dispatches, or
admits any task. One deviation from the literal brief is documented
and justified (§2): the global lives at
`window.AxiomCognitiveDecisionEngine`, not `window.AxiomDecisionEngine`,
to avoid silently breaking Step 7 Part 3C. 41/41 new regression
assertions pass; all applicable pre-existing suites still pass; zero
existing files were modified.
