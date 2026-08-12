# AXIOM AI OS — Milestone 14 Part 1 Deliverables
Plugin Foundation

Milestones 4 through 13 are preserved exactly as delivered. This part adds
one new layer on top of all of them — a Plugin Manifest validator, a
Plugin Loader, and a Plugin Manager with a full install/uninstall/enable/
disable/load/unload lifecycle — and changes nothing else in the runtime,
UI, or visual layer. No AI Core visuals were touched. No existing system
was redesigned or replaced.

---

## 1. Architecture Summary

AXIOM already had two separate "extension" front doors: `AxiomPluginRegistry`
(Milestone 11, lets external code register a new **agent** without editing
`agent-manager.js`) and `AxiomSkillRegistry` (Milestone 13, lets external
code register a new **reusable skill**). Neither one, on its own, answers
"what is a plugin, what state is it in right now, and how do I turn it on
and off as a single unit that might bundle an agent AND some skills AND a
workflow together?" Milestone 14 Part 1 is that missing layer — a thin
lifecycle shell around the extension points that already exist, not a
third registry that duplicates them:

```
 Event Bus (Milestone 4 — UNCHANGED)
 AxiomCapabilityKit.withCapability() (Milestone 5 — UNCHANGED retry/timeout)
 AxiomPluginRegistry (Milestone 11 — UNCHANGED agent registration)
 AxiomSkillRegistry / AxiomWorkflowEngine / AxiomAutomationEngine (Milestone 13 — UNCHANGED)
    │
    ├──> AxiomPluginManifest   (NEW) validates name / version / author /
    │       description / permissions / dependencies / capabilities.
    │       Pure function module — no state, no side effects.
    │
    ├──> AxiomPluginLoader     (NEW) lazy, dedup-safe, error-handled code
    │       instantiation. Given a plugin id + factory, produces the
    │       plugin's module object AT MOST ONCE no matter how many or how
    │       concurrent the calls. Zero dependencies on any other module.
    │
    └──> AxiomPluginManager    (NEW) the one place a plugin's lifecycle
            state actually changes. install() validates a manifest and
            registers a DISABLED record; load()/enable() run the Loader
            through the UNCHANGED Capability Kit (so loading gets
            loading/success/failure/retry/timeout for free) and land on
            RUNNING or FAILED; pause()/resume() move between RUNNING and
            PAUSED; disable()/unload() free the module back to DISABLED;
            uninstall() removes the record entirely (refused while an
            active dependent still needs it). If a plugin's module
            exposes `agent` / `skills` / `workflows` / `automations`,
            those are registered through the EXISTING Plugin Registry /
            Skill Registry / Workflow Engine / Automation Engine front
            doors on load, and unregistered on unload — never
            re-implemented here.
```

New files (`os/runtime/plugins/`), zero edits to any existing runtime file:

| File | Role |
|---|---|
| `plugin-manifest.js` | Manifest shape validation + the declarative permission set. |
| `plugin-loader.js` | Lazy, duplicate-load-safe, error-handled factory execution + cache. |
| `plugin-manager.js` | Full lifecycle: install / uninstall / enable / disable / load / unload / pause / resume. |
| `m14-bootstrap.js` | Confirms all three modules loaded, extends `AxiomRuntime.plugins`, adds `selfTestM14()`. |

One HTML change: four `<script>` tags added to `os-shell.html`, immediately
after the existing Milestone 13 block, in the same style as every prior
milestone's script block. No other line in `os-shell.html` was touched, and
no other HTML file in the project references the runtime chain at all.

---

## 2. Plugin Lifecycle

```
                 install()                          uninstall()
   (none) ─────────────────────> DISABLED ───────────────────────> (removed)
                  │  ▲                  │  ▲
        validate fails  load()/enable() │  │ disable()/unload()
                  │  │                  ▼  │
             (rejected,           LOADING          FAILED <──┐
              nothing stored)          │                     │ (load()/enable()
                                        ▼                     │  retried later)
                                    RUNNING ─────pause()────> PAUSED
                                        ▲                     │
                                        └───────resume()──────┘
```

- **Installing** — `install(manifest, factory)` validates the manifest
  (namespace, semver, permission whitelist, declared dependencies must
  already be installed) and stores a record. Success lands in `disabled`;
  failure returns `{ ok:false, error }` and stores nothing.
- **Loading** — `load(id)` (or `enable(id)`, which calls `load()` when
  needed) checks that every declared dependency is currently `running` or
  `paused`, then runs the plugin's factory through the Capability Kit.
- **Running** — the plugin's module is cached by the Loader; its declared
  `agent`/`skills`/`workflows`/`automations` are live in their real
  registries; `onEnable(ctx)` has fired if the module defines one.
- **Paused** — `pause(id)` — module stays loaded, `onPause(ctx)` fires;
  `resume(id)` returns to `running` and fires `onResume(ctx)`.
- **Disabled** — `disable(id)`/`unload(id)` fire `onDisable(ctx)`, unregister
  every extension point that was registered on load, and free the Loader's
  cache entry — a later `load()`/`enable()` genuinely re-runs the factory
  (lazy reload, never "stuck loaded").
- **Failed** — a load whose dependency check or factory execution failed;
  visible via `.get(id).state === 'failed'` and `.error`; retryable by
  calling `load()`/`enable()` again once the underlying problem is fixed.
- **Uninstalling** — `uninstall(id)` is refused while another `running`/
  `paused` plugin still depends on it; otherwise it unloads if necessary
  and removes the record.

## 3. Plugin Manifest

Required: `id` (must match `/^plugin\.[a-z0-9][a-z0-9-]*$/`, reserved
`agent.` prefix rejected), `name`, `version` (semver `x.y.z`), `author`,
`description`. Optional: `permissions` (array, checked against a fixed
whitelist — `agent.dispatch`, `memory.read`, `memory.write`, `bus.emit`,
`bus.subscribe`, `network.fetch`, `automation.create`, `workflow.define`,
`skill.register`, `ui.notify`), `dependencies` (array of other plugin ids,
must already be installed), `capabilities` (array of free-form capability
name strings, metadata only). An unknown permission, a non-semver version,
or a dependency that isn't installed all fail validation loudly at
`install()` rather than misbehaving later.

## 4. Plugin Loader

`AxiomPluginLoader.load(id, factory, ctx)` — lazy (the factory never runs
until `load()` is called), duplicate-load-safe (a second concurrent call
for the same id joins the same in-flight promise; an already-loaded id
returns the cached module without re-running the factory), and
error-handled (a throwing/rejecting factory clears in-flight state so a
later retry is possible, and always rejects with a real `Error`).
Backward compatible: zero dependencies on any other AXIOM module — it can
be loaded and used standalone.

---

## 5. Verification

`AxiomRuntime.selfTestM14()` (`os/runtime/plugins/m14-bootstrap.js`) —
26 checks, run live in the browser console, covering exactly what the
milestone brief asked to be tested:

- **Install** — valid manifest + factory accepted; reserved namespace,
  malformed id, non-semver version, undeclared permission, and a missing
  dependency are each rejected; duplicate install of the same id rejected.
- **Uninstall** — removes a disabled plugin from the registry; refused
  while an active dependent plugin still needs it; refused for an unknown
  id.
- **Enable/Disable** — `enable()` loads a disabled plugin to `running` and
  fires `onEnable()`; re-enabling an already-running plugin is a no-op
  (idempotent); `disable()` frees it back to `disabled` and fires
  `onDisable()`; a dependency-gated `load()` correctly fails (`failed`
  state) until its dependency is enabled, then succeeds once it is.
- **Load/Unload** — a direct `load()` call on an already-running plugin
  does not re-invoke the factory (proves duplicate loading is prevented);
  `unload()` on a not-loaded plugin returns a clear error instead of
  throwing; a full disable → reload cycle proves the factory genuinely
  re-runs (lazy reload, not permanently stuck).
- **Pause/Resume** — `pause()` moves `running` → `paused` and fires
  `onPause()`; pausing an already-paused plugin is rejected; `resume()`
  returns to `running` and fires `onResume()`.
- **Extension-point reuse** — a plugin that declares a `skills` array has
  that skill registered through the real, unmodified `AxiomSkillRegistry`
  on enable, genuinely invocable via `.invoke()`, and unregistered again
  on disable — proving the Plugin Manager reuses the Skill Registry rather
  than reimplementing it.
- **Regression** — exactly 10 core agents remain registered with no
  duplicates after all Milestone 14 activity; every event-driven lifecycle
  transition fired its matching `pluginmgr:*` event on the shared bus.

Independent of the browser self-test, the same lifecycle was additionally
exercised end-to-end in a Node harness that loads the real, unmodified
`agent-runtime.js`, `agent-manager.js`, `capability-kit.js`,
`plugin-registry.js`, and `skill-registry.js` files alongside the three new
Milestone 14 files (no mocks of AXIOM code, only minimal DOM/event-target
stubs) — 31/31 applicable checks passed, matching the checks above plus
the dependency-gated-load-then-succeeds sequence in full.

Run in-browser:
```js
await AxiomRuntime.selfTestM14();
```

---

## 6. What Was Deliberately NOT Done (by design)

- No UI. No settings page, no plugin marketplace, no install dialog — this
  part is the runtime foundation only, per the brief ("Do NOT redesign the
  UI").
- No changes to AI Core visuals, window manager, themes, or any CSS file.
- No edits to `agent-runtime.js`, `agent-manager.js`, `capability-kit.js`,
  `plugin-registry.js`, `skill-registry.js`, `workflow-engine.js`, or
  `automation-engine.js` — every one of those is reused exactly as
  Milestones 4/5/11/13 left it.
- No sandboxing of plugin code execution (no existing AXIOM module
  sandboxes JS execution either). Permissions are a declarative honesty
  contract enforced at `install()` time and exposed to plugin code via
  `ctx.hasPermission(name)` — not a security boundary.
