// ============================================================
// AXIOM AI OS — Milestone 14 Part 1: Plugin Manager
// ------------------------------------------------------------
// Objectives 1-3: "Build the Plugin Manager. Support Install /
// Uninstall / Enable / Disable / Load / Unload. Create a Plugin
// Lifecycle with states Installing, Loading, Running, Paused,
// Disabled, Failed, Uninstalling."
//
// This module is the ONE place a plugin's lifecycle state actually
// changes. It owns no code-execution mechanics of its own (that is
// plugin-loader.js), no manifest-shape rules of its own (that is
// plugin-manifest.js), and reuses every other existing subsystem
// exactly as-is, with zero modifications to any of them:
//   - Event Bus (agent-runtime.js)        — every transition is an event.
//   - Capability Kit (capabilities/capability-kit.js) — a plugin
//     load attempt runs through the same withCapability() wrapper
//     every agent capability and skill invocation already uses, so
//     load gets retry/timeout/loading/success/failure for free.
//   - Plugin Registry (scheduler/plugin-registry.js) — if a plugin's
//     module exposes an `agent` spec, it is registered/unregistered
//     through the EXISTING plugin-agent front door, never by talking
//     to AxiomAgentManager directly.
//   - Skill Registry (automation/skill-registry.js) — if a plugin's
//     module exposes a `skills` array, each is registered/unregistered
//     through the existing namespaced skill front door.
//   - Workflow Engine / Automation Engine (automation/*.js) — if a
//     plugin's module exposes `workflows` / `automations`, they are
//     defined/removed and created/removed through those existing
//     front doors, never re-implemented here.
//
// Lifecycle (state machine):
//   (none) --install()--> INSTALLING --(validate ok)--> DISABLED
//                                     --(validate fail)--> (rejected, nothing stored)
//   DISABLED/FAILED --load()/enable()--> LOADING --(ok)--> RUNNING
//                                                --(fail)--> FAILED
//   RUNNING --pause()--> PAUSED --resume()--> RUNNING
//   RUNNING/PAUSED --disable()/unload()--> DISABLED   (module unloaded, resources freed)
//   any state --uninstall()--> UNINSTALLING --(unload if needed)--> (removed from registry)
//
// Public surface — window.AxiomPluginManager:
//   .install(manifest, factory) -> { ok, plugin?, error? }
//   .uninstall(id)               -> { ok, error? }
//   .enable(id)                  -> Promise<{ ok, plugin?, error? }>
//   .disable(id)                 -> { ok, plugin?, error? }
//   .load(id)                    -> Promise<{ ok, plugin?, error? }>
//   .unload(id)                  -> { ok, error? }
//   .pause(id) / .resume(id)     -> { ok, plugin?, error? }
//   .get(id)                     -> plugin snapshot | null
//   .list()                      -> plugin snapshot[]
//   .STATES                      -> lifecycle state constants
// Event-based front door (no JS reference needed), mirroring the
// existing plugin-registry.js / skill-registry.js pattern:
//   bus.emit('pluginmgr:install-request', src, { manifest, factory })
//   bus.emit('pluginmgr:enable-request',  src, { id })
//   bus.emit('pluginmgr:disable-request', src, { id })
//   bus.emit('pluginmgr:load-request',    src, { id })
//   bus.emit('pluginmgr:unload-request',  src, { id })
//   bus.emit('pluginmgr:uninstall-request', src, { id })
//   -> listen for 'pluginmgr:installed' / 'pluginmgr:running' /
//      'pluginmgr:disabled' / 'pluginmgr:failed' / 'pluginmgr:uninstalled' / etc.
// Namespaced 'pluginmgr:*' deliberately, so these events never
// collide with the pre-existing 'plugin:*' events already emitted
// by scheduler/plugin-registry.js (a different concern: agent
// registration, not lifecycle management).
// ============================================================
window.AxiomPluginManager = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  var KIT = window.AxiomCapabilityKit;
  var LOADER = window.AxiomPluginLoader;
  var MANIFEST = window.AxiomPluginManifest;
  if (!RT || !MGR || !KIT || !LOADER || !MANIFEST) {
    AxLogger.error('[AxiomPluginManager] requires agent-runtime.js, agent-manager.js, capabilities/capability-kit.js, plugins/plugin-loader.js and plugins/plugin-manifest.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  // Soft-optional reuse targets: Plugin Manager still works (install/
  // load/enable/disable of plain plugins) if any of these happen to be
  // absent, so it stays backward compatible rather than hard-failing.
  var PLUGIN_REGISTRY = window.AxiomPluginRegistry || null;
  var SKILL_REGISTRY = window.AxiomSkillRegistry || null;
  var WORKFLOW_ENGINE = window.AxiomWorkflowEngine || null;
  var AUTOMATION_ENGINE = window.AxiomAutomationEngine || null;
  ['AxiomPluginRegistry', 'AxiomSkillRegistry', 'AxiomWorkflowEngine', 'AxiomAutomationEngine'].forEach(function (name) {
    if (!window[name]) AxLogger.warn('[AxiomPluginManager] ' + name + ' not found — plugins declaring that extension point will be installed/loaded but that extension point will be skipped.');
  });

  var STATES = {
    INSTALLING: 'installing',
    DISABLED: 'disabled',
    LOADING: 'loading',
    RUNNING: 'running',
    PAUSED: 'paused',
    FAILED: 'failed',
    UNINSTALLING: 'uninstalling'
  };

  var plugins = new Map(); // id -> record (see install())

  function emit(type, payload) { bus.emit(type, 'plugin-manager', payload || {}); }

  function snapshot(rec) {
    return {
      id: rec.id, name: rec.name, version: rec.version, author: rec.author,
      description: rec.description, permissions: rec.permissions.slice(),
      dependencies: rec.dependencies.slice(), capabilities: rec.capabilities.slice(),
      state: rec.state, error: rec.error,
      installedAt: rec.installedAt, loadedAt: rec.loadedAt || null
    };
  }

  function buildCtx(rec) {
    return {
      bus: bus,
      manager: MGR,
      pluginId: rec.id,
      hasPermission: function (perm) { return rec.permissions.indexOf(perm) !== -1; }
    };
  }

  // ---- install / uninstall ------------------------------------------

  function install(manifest, factory) {
    var tentativeId = manifest && manifest.id;
    emit('pluginmgr:installing', { id: tentativeId });

    var err = MANIFEST.validate(manifest);
    if (err) {
      emit('pluginmgr:install-failed', { id: tentativeId, error: err });
      return { ok: false, error: err };
    }
    if (plugins.has(manifest.id)) {
      var dupErr = 'A plugin with id "' + manifest.id + '" is already installed.';
      emit('pluginmgr:install-failed', { id: manifest.id, error: dupErr });
      return { ok: false, error: dupErr };
    }

    var norm = MANIFEST.normalize(manifest);
    var missingDeps = norm.dependencies.filter(function (d) { return !plugins.has(d); });
    if (missingDeps.length) {
      var depErr = 'Missing dependencies (not installed): ' + missingDeps.join(', ') + '.';
      emit('pluginmgr:install-failed', { id: norm.id, error: depErr });
      return { ok: false, error: depErr };
    }

    var record = Object.assign({}, norm, {
      factory: factory || null,
      module: null,
      state: STATES.DISABLED,
      error: null,
      installedAt: Date.now(),
      loadedAt: null,
      _registeredSkills: [],
      _registeredWorkflows: [],
      _registeredAutomations: [],
      _agentRegistered: false,
      _agentId: null
    });
    plugins.set(norm.id, record);
    emit('pluginmgr:installed', { id: norm.id, name: norm.name, version: norm.version });
    return { ok: true, plugin: snapshot(record) };
  }

  function uninstall(id) {
    var rec = plugins.get(id);
    if (!rec) return { ok: false, error: 'Unknown plugin "' + id + '".' };

    var dependents = Array.from(plugins.values()).filter(function (p) {
      return p.id !== id && p.dependencies.indexOf(id) !== -1 && (p.state === STATES.RUNNING || p.state === STATES.PAUSED);
    });
    if (dependents.length) {
      var depErr = 'Cannot uninstall "' + id + '": still depended on by active plugin(s): ' + dependents.map(function (p) { return p.id; }).join(', ') + '.';
      return { ok: false, error: depErr };
    }

    rec.state = STATES.UNINSTALLING;
    emit('pluginmgr:uninstalling', { id: id });

    if (LOADER.isLoaded(id)) unloadInternal(rec);

    plugins.delete(id);
    emit('pluginmgr:uninstalled', { id: id });
    return { ok: true };
  }

  // ---- extension-point registration (skills / agent / workflows / automations) ----

  function registerExtras(rec, mod) {
    if (mod && mod.agent && PLUGIN_REGISTRY) {
      var agentRes = PLUGIN_REGISTRY.register(mod.agent);
      rec._agentRegistered = !!(agentRes && agentRes.ok);
      rec._agentId = rec._agentRegistered ? mod.agent.id : null;
      if (!rec._agentRegistered) AxLogger.warn('[AxiomPluginManager] plugin "' + rec.id + '" agent registration was rejected:', agentRes && agentRes.error);
    }
    if (mod && Array.isArray(mod.skills) && SKILL_REGISTRY) {
      mod.skills.forEach(function (skillSpec) {
        var res = SKILL_REGISTRY.register(skillSpec);
        if (res && res.ok) rec._registeredSkills.push(skillSpec.id);
        else AxLogger.warn('[AxiomPluginManager] plugin "' + rec.id + '" skill "' + (skillSpec && skillSpec.id) + '" registration was rejected:', res && res.error);
      });
    }
    if (mod && Array.isArray(mod.workflows) && WORKFLOW_ENGINE) {
      mod.workflows.forEach(function (wfSpec) {
        var res = WORKFLOW_ENGINE.define(wfSpec);
        if (res && res.ok) rec._registeredWorkflows.push(wfSpec.id);
        else AxLogger.warn('[AxiomPluginManager] plugin "' + rec.id + '" workflow "' + (wfSpec && wfSpec.id) + '" definition was rejected:', res && res.error);
      });
    }
    if (mod && Array.isArray(mod.automations) && AUTOMATION_ENGINE) {
      mod.automations.forEach(function (autoSpec) {
        var res = AUTOMATION_ENGINE.create(autoSpec);
        if (res && res.ok) rec._registeredAutomations.push(autoSpec.id);
        else AxLogger.warn('[AxiomPluginManager] plugin "' + rec.id + '" automation "' + (autoSpec && autoSpec.id) + '" creation was rejected:', res && res.error);
      });
    }
  }

  function unregisterExtras(rec) {
    if (rec._agentRegistered && PLUGIN_REGISTRY && rec._agentId) PLUGIN_REGISTRY.unregister(rec._agentId);
    rec._agentRegistered = false;
    rec._agentId = null;
    if (SKILL_REGISTRY) rec._registeredSkills.forEach(function (sid) { SKILL_REGISTRY.unregister(sid); });
    rec._registeredSkills = [];
    if (WORKFLOW_ENGINE) rec._registeredWorkflows.forEach(function (wid) { WORKFLOW_ENGINE.remove(wid); });
    rec._registeredWorkflows = [];
    if (AUTOMATION_ENGINE) rec._registeredAutomations.forEach(function (aid) { AUTOMATION_ENGINE.remove(aid); });
    rec._registeredAutomations = [];
  }

  // ---- load / unload (code-level; Loader does the actual dedup/caching) ----

  function load(id) {
    var rec = plugins.get(id);
    if (!rec) return Promise.resolve({ ok: false, error: 'Unknown plugin "' + id + '".' });
    if (rec.state === STATES.RUNNING) return Promise.resolve({ ok: true, plugin: snapshot(rec) }); // idempotent — never double-load
    if (rec.state === STATES.PAUSED) return Promise.resolve({ ok: true, plugin: snapshot(rec) });
    if (rec.state === STATES.UNINSTALLING) return Promise.resolve({ ok: false, error: 'Plugin "' + id + '" is uninstalling.' });

    var notReady = rec.dependencies.filter(function (d) {
      var dep = plugins.get(d);
      return !dep || (dep.state !== STATES.RUNNING && dep.state !== STATES.PAUSED);
    });
    if (notReady.length) {
      var depErr = 'Dependencies not enabled: ' + notReady.join(', ') + '.';
      rec.state = STATES.FAILED;
      rec.error = depErr;
      emit('pluginmgr:load-failed', { id: id, error: depErr });
      return Promise.resolve({ ok: false, error: depErr });
    }

    rec.state = STATES.LOADING;
    emit('pluginmgr:loading', { id: id });
    var ctx = buildCtx(rec);
    var task = { id: 'plugin-load-' + id, cancelled: false };

    return KIT.withCapability('plugin-load:' + id, task, { bus: bus, agent: { id: id } }, function () {
      return LOADER.load(id, rec.factory, ctx);
    }, { retries: 1, timeoutMs: 8000 }).then(function (mod) {
      rec.module = mod;
      registerExtras(rec, mod);
      rec.state = STATES.RUNNING;
      rec.loadedAt = Date.now();
      rec.error = null;
      if (mod && typeof mod.onEnable === 'function') {
        try { mod.onEnable(ctx); } catch (err) { AxLogger.error('[AxiomPluginManager] plugin "' + id + '" threw during onEnable():', err); }
      }
      emit('pluginmgr:running', { id: id });
      return { ok: true, plugin: snapshot(rec) };
    }, function (err) {
      rec.state = STATES.FAILED;
      rec.error = String(err && err.message || err);
      emit('pluginmgr:load-failed', { id: id, error: rec.error });
      return { ok: false, error: rec.error };
    });
  }

  function unloadInternal(rec) {
    var mod = LOADER.getModule(rec.id);
    if (mod && typeof mod.onDisable === 'function') {
      try { mod.onDisable(buildCtx(rec)); } catch (err) { AxLogger.error('[AxiomPluginManager] plugin "' + rec.id + '" threw during onDisable():', err); }
    }
    unregisterExtras(rec);
    LOADER.unload(rec.id, buildCtx(rec));
    rec.module = null;
    rec.state = STATES.DISABLED;
    emit('pluginmgr:unloaded', { id: rec.id });
  }

  function unload(id) {
    var rec = plugins.get(id);
    if (!rec) return { ok: false, error: 'Unknown plugin "' + id + '".' };
    if (rec.state !== STATES.RUNNING && rec.state !== STATES.PAUSED && rec.state !== STATES.FAILED) {
      return { ok: false, error: 'Plugin "' + id + '" is not loaded (state: ' + rec.state + ').' };
    }
    if (!LOADER.isLoaded(id)) { rec.state = STATES.DISABLED; return { ok: true, plugin: snapshot(rec) }; }
    unloadInternal(rec);
    return { ok: true, plugin: snapshot(rec) };
  }

  // ---- enable / disable (activation policy on top of load / unload) ----

  function enable(id) {
    var rec = plugins.get(id);
    if (!rec) return Promise.resolve({ ok: false, error: 'Unknown plugin "' + id + '".' });
    if (rec.state === STATES.RUNNING) return Promise.resolve({ ok: true, plugin: snapshot(rec) });
    if (rec.state === STATES.PAUSED) {
      rec.state = STATES.RUNNING;
      emit('pluginmgr:enabled', { id: id });
      return Promise.resolve({ ok: true, plugin: snapshot(rec) });
    }
    if (rec.state === STATES.UNINSTALLING) return Promise.resolve({ ok: false, error: 'Plugin "' + id + '" is uninstalling.' });
    return load(id).then(function (res) {
      if (res.ok) emit('pluginmgr:enabled', { id: id });
      return res;
    });
  }

  function disable(id) {
    var rec = plugins.get(id);
    if (!rec) return { ok: false, error: 'Unknown plugin "' + id + '".' };
    if (rec.state === STATES.DISABLED) return { ok: true, plugin: snapshot(rec) };
    if (rec.state !== STATES.RUNNING && rec.state !== STATES.PAUSED && rec.state !== STATES.FAILED) {
      return { ok: false, error: 'Cannot disable plugin "' + id + '" from state "' + rec.state + '".' };
    }
    if (LOADER.isLoaded(id)) unloadInternal(rec); else rec.state = STATES.DISABLED;
    emit('pluginmgr:disabled', { id: id });
    return { ok: true, plugin: snapshot(rec) };
  }

  // ---- pause / resume (reachable path to/from the Paused state) --------

  function pause(id) {
    var rec = plugins.get(id);
    if (!rec) return { ok: false, error: 'Unknown plugin "' + id + '".' };
    if (rec.state !== STATES.RUNNING) return { ok: false, error: 'Only a running plugin can be paused (current state: ' + rec.state + ').' };
    var mod = LOADER.getModule(id);
    if (mod && typeof mod.onPause === 'function') {
      try { mod.onPause(buildCtx(rec)); } catch (err) { AxLogger.error('[AxiomPluginManager] plugin "' + id + '" threw during onPause():', err); }
    }
    rec.state = STATES.PAUSED;
    emit('pluginmgr:paused', { id: id });
    return { ok: true, plugin: snapshot(rec) };
  }

  function resume(id) {
    var rec = plugins.get(id);
    if (!rec) return { ok: false, error: 'Unknown plugin "' + id + '".' };
    if (rec.state !== STATES.PAUSED) return { ok: false, error: 'Only a paused plugin can be resumed (current state: ' + rec.state + ').' };
    var mod = LOADER.getModule(id);
    if (mod && typeof mod.onResume === 'function') {
      try { mod.onResume(buildCtx(rec)); } catch (err) { AxLogger.error('[AxiomPluginManager] plugin "' + id + '" threw during onResume():', err); }
    }
    rec.state = STATES.RUNNING;
    emit('pluginmgr:resumed', { id: id });
    return { ok: true, plugin: snapshot(rec) };
  }

  // ---- reads -------------------------------------------------------

  function get(id) { return plugins.has(id) ? snapshot(plugins.get(id)) : null; }
  function list() { return Array.from(plugins.values()).map(snapshot); }

  // ---- event-driven front door ---------------------------------------
  // Mirrors plugin-registry.js / skill-registry.js: a caller with no JS
  // reference to this module can still drive the full lifecycle purely
  // through the shared bus.
  bus.on('pluginmgr:install-request', function (env) {
    if (env.source === 'plugin-manager') return;
    var p = env.payload || {};
    install(p.manifest, p.factory);
  });
  bus.on('pluginmgr:uninstall-request', function (env) {
    if (env.source === 'plugin-manager') return;
    var id = env.payload && env.payload.id;
    if (id) uninstall(id);
  });
  bus.on('pluginmgr:enable-request', function (env) {
    if (env.source === 'plugin-manager') return;
    var id = env.payload && env.payload.id;
    if (id) enable(id);
  });
  bus.on('pluginmgr:disable-request', function (env) {
    if (env.source === 'plugin-manager') return;
    var id = env.payload && env.payload.id;
    if (id) disable(id);
  });
  bus.on('pluginmgr:load-request', function (env) {
    if (env.source === 'plugin-manager') return;
    var id = env.payload && env.payload.id;
    if (id) load(id);
  });
  bus.on('pluginmgr:unload-request', function (env) {
    if (env.source === 'plugin-manager') return;
    var id = env.payload && env.payload.id;
    if (id) unload(id);
  });

  return {
    install: install, uninstall: uninstall,
    enable: enable, disable: disable,
    load: load, unload: unload,
    pause: pause, resume: resume,
    get: get, list: list,
    STATES: Object.assign({}, STATES)
  };
})();
