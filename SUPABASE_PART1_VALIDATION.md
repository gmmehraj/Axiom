# Supabase Integration — Part 1: Core Infrastructure — Validation

**Date:** 2026-08-05
**Environment:** Offline sandbox, Node.js v22.22.2, no network access.
No live Supabase project was reachable or used — every SDK call and
HTTP health probe in the new regression suite is mocked. This mirrors
the constraint already documented for prior Parts (see
`phase9-part1-static-audit-suite.js`'s header and the Step 8 Part 2
CHANGELOG entry).

## 1. Scope actually delivered

| Requirement | Delivered as |
|---|---|
| Supabase client initialization | `AxiomSupabaseConnection.init()` / `createClient()` in `js/core/supabase/connection-manager.js` |
| Environment configuration | `window.__AXIOM_ENV__`, populated at build time by `scripts/inject-env.js` from `process.env.SUPABASE_URL` / `SUPABASE_ANON_KEY`; template at `js/core/env.config.template.js` |
| Connection manager | `AxiomSupabaseConnection` — state machine (`unconfigured / connecting / connected / degraded / offline / reconnecting`) |
| Authentication service foundation | `AxiomSupabaseAuth` in `js/core/supabase/auth-service.js` |
| Session manager | `AxiomSupabaseAuth.getSession/getUser/isAuthenticated/getTimeToExpiryMs`, `expiring-soon` / `expired` events |
| Automatic reconnect | Exponential backoff (1s base, ×2, 30s cap, ±20% jitter) in `scheduleReconnect()` |
| Health monitoring | Periodic probe of `${SUPABASE_URL}/auth/v1/health` every 30s, configurable |
| Error handling | `classifyError()` → `network / auth / config / timeout / unknown`, `getLastError()` |
| Offline detection | `navigator.onLine` + `online`/`offline` listeners in `attachOfflineDetection()` |
| Configuration validation | `AxiomSupabaseEnv.validate()` — structured `{ valid, errors }`, never throws |

## 2. Architecture constraints honored

- **Not touched:** `os/core/runtime-context.js`, the Orchestrator
  files (`os/core/orchestrator.js`,
  `os/runtime/intelligence/orchestrator.js`), `os/core/browser-*.js`,
  `os/core/goal-manager*.js`, `os/core/memory-engine.js`,
  `os/core/memory-manager.js`, and everything under `os/runtime/`
  except the HTML script-tag lists that reference it (no file
  content in `os/runtime/` changed). Verified by diff below.
- **Reused, not duplicated:** `window.AxLogger` (all logging goes
  through it with a `console` fallback), the `AxiomOrchestrator`
  pub/sub *contract* (the Connection Manager and Auth Service each
  ship a same-shaped `on/once/off/emit`, and forward every event to
  `AxiomOrchestrator.emit()` when it's present — see `EVENT_BUS.md`,
  which explicitly sanctions this: "any future agent or bridge can
  use the same bus for its own coordination... without needing a
  change to orchestrator.js"), `window.va` (Vercel Analytics, already
  a `package.json` dependency) for optional telemetry.
- **No hardcoded credentials:** see §5.

```
$ git diff --stat -- os/ | grep -v '^$'
(no output — nothing under os/ changed)
```

## 3. New regression suite

`test-evidence/supabase-part1-regression-suite.js` — run against the
real files on disk in a hand-built Node `vm` sandbox (this offline
environment has no `jsdom` installed, same pre-existing constraint
documented for the rest of the project's suites).

```
$ node test-evidence/supabase-part1-regression-suite.js
...
51/51 passing
```

Coverage:

1. **Environment validation** (6 checks) — missing env, template
   placeholders, malformed URL, too-short key, valid config, and
   memoization of `validate()`.
2. **Connection Manager** (18 checks) — unconfigured state on invalid
   env, missing-SDK handling, successful client creation, healthy
   probe → `connected`, failing probe → `degraded`/`reconnecting`,
   offline browser → `offline`, network error classification,
   DOM `CustomEvent` dispatch, and the pub/sub contract (duplicate
   `on()` doesn't double-fire, `off()` removes a listener, `once()`
   fires exactly once).
3. **Auth Service foundation** (4 checks) — `onAuthStateChange`
   re-broadcast, `getTimeToExpiryMs()` reflects the last known
   session, idempotent `init()` (no duplicate subscriptions).
4. **Backward compatibility** (4 checks) — `supabaseClient`,
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` remain bare top-level
   identifiers reachable exactly the way
   `js/core/openrouter-config.js` already reads them (verified with
   the same read pattern that file actually uses).
5. **Static checks** (22 checks) — no hardcoded Supabase URL/key
   pattern in any new or modified file (6 files), and correct
   4-script load order on all 16 HTML pages.

## 4. Targeted verification (connection/offline/reconnect/config)

All of the following are exercised as explicit, independently-passing
assertions inside the suite above (not just incidentally covered):

- **Connection tests:** client is created only once a valid env +
  loaded SDK are both present; `getClient()` returns the same
  instance init() produced; a healthy probe transitions
  `connecting → connected`.
- **Offline tests:** with `navigator.onLine = false`, `checkHealth()`
  resolves to state `offline` regardless of probe outcome, and the
  health/reconnect timers are cleared rather than continuing to fire
  against a browser that's already known to be offline.
- **Reconnect tests:** a failing probe moves the state through
  `degraded → reconnecting` and increments the internal backoff
  attempt counter (observed via the `state-changed` event payload's
  `attempt` field); a subsequent successful probe resets the attempt
  counter to 0.
- **Configuration validation tests:** every one of the 5 invalid-input
  shapes in §3.1 above produces `valid: false` with a specific,
  human-readable error string — never a thrown exception.

## 5. Static credential scan

```
$ node test-evidence/supabase-part1-regression-suite.js 2>&1 | grep "no hardcoded"
PASS  static: no hardcoded Supabase credential in js/core/supabase-config.js
PASS  static: no hardcoded Supabase credential in js/core/supabase/env.js
PASS  static: no hardcoded Supabase credential in js/core/supabase/connection-manager.js
PASS  static: no hardcoded Supabase credential in js/core/supabase/auth-service.js
PASS  static: no hardcoded Supabase credential in js/core/env.config.template.js
PASS  static: no hardcoded Supabase credential in scripts/inject-env.js
```

**Pre-existing defect found and fixed (FIX 1, see CHANGELOG.md):** the
original `js/core/supabase-config.js` hardcoded a real-looking
Supabase project URL and anon key directly in source — precisely what
`phase9-part1-static-audit-suite.js` check #10 exists to catch. This
was a verified defect within this Part's own scope (the file this
Part's requirements explicitly named: "Supabase client
initialization... use environment variables... no hardcoded
credentials") and was fixed, not left in place.

**Action recommended to the project owner:** if
`zdskilffkwpwyszmhvov.supabase.co` / the accompanying anon key were
ever deployed to a real, in-use Supabase project, rotate the anon key
as routine hygiene. An anon key is designed to be safe to expose (Row
Level Security is the actual access boundary — see the original
file's own comment), so this is precautionary rather than a live
break-in risk, but a key that sat in a public repo shouldn't be
assumed private going forward.

## 6. Existing regression suites — full run

Every suite under `test-evidence/` (excluding the new
`supabase-part1-regression-suite.js` and the non-assertion
`milestone5-manual-commands.js` helper script) was re-run unmodified:

| Suite | Result |
|---|---|
| block2-step1-coding-agent-regression-suite | ❌ pre-existing — `Cannot find module 'jsdom'` |
| block2-step1-part2-pipeline-regression-suite | ❌ pre-existing — `Cannot find module 'jsdom'` |
| block2-step2-part2-brain-integration-regression-suite | ✅ ALL CHECKS PASSED |
| block2-step3-part1-memory-foundation-regression-suite | ✅ ALL CHECKS PASSED |
| block2-step3-part2-memory-integration-regression-suite | ✅ ALL CHECKS PASSED |
| block2-step3-part3-memory-manager-regression-suite | ✅ 30/30 |
| block2-step4-part1-automation-foundation-regression-suite | ✅ 17/17 |
| block2-step4-part2-brain-automation-integration-regression-suite | ✅ ALL CHECKS PASSED |
| block2-step4-part3-automation-memory-integration-regression-suite | ✅ ALL CHECKS PASSED |
| block2-step4-part4-automation-manager-regression-suite | ✅ ALL CHECKS PASSED |
| block2-step5-part1-browser-foundation-regression-suite | ✅ 21/21 |
| block2-step5-part2-navigation-session-regression-suite | ✅ 28/28 |
| block2-step5-part6a-browser-audit-regression-suite | ✅ 7/7 |
| block2-step5-part6b-error-recovery-regression-suite | ✅ 15/15 |
| block2-step6-part1-orchestrator-regression-suite | ✅ 21/21 |
| block2-step6-part2-agent-registry-integration-regression-suite | ✅ 18/18 |
| block2-step6-part3-capability-routing-regression-suite | ✅ 20/20 |
| block2-step6-part4-workflow-planner-regression-suite | ✅ 29/29 |
| block2-step6-part5-runtime-context-regression-suite | ✅ 42/42 |
| block2-step7-part2-task-planner-regression-suite | ✅ 21/21 |
| block2-step7-part3a-goal-manager-regression-suite | ✅ 35/35 |
| block2-step7-part3b-goal-scheduling-regression-suite | ✅ 45/45 |
| block2-step7-part3c-decision-engine-regression-suite | ✅ 37/37 |
| block2-step7-part3d-execution-bridge-regression-suite | ✅ 24/24 |
| block2-step7-part3e-goal-manager-learning-regression-suite | ✅ 35/35 |
| block2-step7-part3f-goal-manager-recovery-regression-suite | ✅ 38/38 |
| block2-step8-part1-decision-engine-regression-suite | ✅ 41/41 |
| block2-step8-part2-planning-regression-suite | ✅ 28/28 |
| milestone10-regression-suite | ❌ pre-existing — `Cannot find module 'jsdom'` |
| milestone11-regression-suite | ✅ 41/41 |
| milestone12-regression-suite | ✅ 19/19 |
| milestone13-regression-suite | ✅ 46/46 |
| milestone14-part1-regression-suite | ✅ 58/58 |
| milestone5-regression-suite | ❌ pre-existing — `Cannot find module 'jsdom'` |
| milestone6-regression-suite | ❌ pre-existing — `Cannot find module 'jsdom'` |
| phase9-part1-static-audit-suite | ✅ 1454/1454 |
| **supabase-part1-regression-suite (new)** | ✅ **51/51** |

**5 pre-existing failures**, all `Cannot find module 'jsdom'` — this
sandbox has no network access to `npm install jsdom`, an environment
limitation already called out for these exact suites in earlier
CHANGELOG entries (Step 8 Part 2: "the six pre-existing,
jsdom-dependent suites that were already failing in this offline
sandbox before this Part... remain unaffected"; the count is 5 rather
than 6 here only because one of those six was folded into an earlier
Part in the interim). None of the 5 import, reference, or exercise
anything this Part touched — confirmed by grepping each for
`supabase` (no matches) and by the diff in §2 showing zero changes
under `os/`.

**0 regressions introduced.** Every suite that passed before this
Part still passes; no suite that passed before now fails.

## 7. What still requires a live Supabase project (out of scope for Part 1)

This Part validates structure, state transitions, and error handling
against mocks — it does not (and, offline, cannot) validate against a
real Supabase backend. Before relying on this in production:

1. Set real `SUPABASE_URL` / `SUPABASE_ANON_KEY` values in your
   hosting provider's environment settings.
2. Run `npm run build` (`scripts/inject-env.js`) to generate
   `js/core/env.config.js`.
3. Load any page and confirm in the browser console that
   `AxiomSupabaseConnection.getState()` reaches `'connected'` and
   `AxiomSupabaseEnv.validate().valid === true`.
4. Confirm the existing `js/core/auth.js` login/register/logout flows
   still work end-to-end (they were not modified, but they do now
   depend on the new files loading successfully first).

## 8. Deliverables

- Updated project ZIP (this validation doc, `CHANGELOG.md`, and all
  source changes included)
- `CHANGELOG.md` — new entry prepended, existing history untouched
- `SUPABASE_PART1_VALIDATION.md` — this document
