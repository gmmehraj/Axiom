// ============================================================
// AXIOM AI OS — Milestone 14 Part 1: Bootstrap
// ------------------------------------------------------------
// Loads last among the Milestone 14 Part 1 files, after every prior
// milestone module and every other Milestone 14 module. Mirrors the
// shape of m8/m9/m10/m11/m12/m13-bootstrap.js exactly: touches no
// UI, no CSS, and no existing runtime file — it only:
//   1. Confirms every Milestone 14 module initialized (fails loud if not).
//   2. Extends the existing window.AxiomRuntime facade non-destructively
//      (every property Milestones 4-13 already put there is preserved)
//      with a `.plugins` accessor for the new subsystem.
//   3. Adds AxiomRuntime.selfTestM14(), covering install / uninstall /
//      enable / disable / load / unload and the full lifecycle state
//      machine (Installing -> Disabled -> Loading -> Running -> Paused
//      -> Disabled -> Uninstalling), plus dependency and permission
//      validation and duplicate-load prevention.
// ============================================================
(function (global) {
  'use strict';

  var modules = {
    manifest: global.AxiomPluginManifest,
    loader: global.AxiomPluginLoader,
    manager: global.AxiomPluginManager
  };

  var missing = Object.keys(modules).filter(function (k) { return !modules[k]; });
  if (missing.length) {
    AxLogger.error('[AxiomM14] the following Milestone 14 Part 1 modules failed to initialize:', missing);
  }

  if (global.AxiomRuntime) {
    Object.assign(global.AxiomRuntime, {
      plugins: modules,

      selfTestM14: async function () {
        var results = [];
        function check(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || null }); }

        if (Object.keys(modules).some(function (k) { return !modules[k]; })) { check('all Milestone 14 Part 1 modules available', false, missing); return finish(); }

        var M = modules.manager;
        var S = M.STATES;

        try {
          // ---- 1. Manifest validation ---------------------------------
          var badId = M.install({ id: 'agent.evil-twin', name: 'x', version: '1.0.0', author: 'a', description: '' });
          check('rejects a manifest id in the reserved "agent." namespace', badId.ok === false);

          var badShape = M.install({ id: 'not-namespaced' });
          check('rejects a malformed/non-namespaced manifest', badShape.ok === false);

          var badVersion = M.install({ id: 'plugin.m14-selftest-badver', name: 'x', version: 'not-semver', author: 'a', description: '' });
          check('rejects a non-semver version string', badVersion.ok === false);

          var badPerm = M.install({ id: 'plugin.m14-selftest-badperm', name: 'x', version: '1.0.0', author: 'a', description: '', permissions: ['sudo.everything'] });
          check('rejects an unknown/undeclared permission', badPerm.ok === false);

          var badDep = M.install({ id: 'plugin.m14-selftest-baddep', name: 'x', version: '1.0.0', author: 'a', description: '', dependencies: ['plugin.does-not-exist'] });
          check('rejects a manifest depending on a plugin that is not installed', badDep.ok === false);

          // ---- 2. Install --------------------------------------------
          var events = [];
          var offAny = ['pluginmgr:installing', 'pluginmgr:installed', 'pluginmgr:loading', 'pluginmgr:running',
            'pluginmgr:enabled', 'pluginmgr:disabled', 'pluginmgr:paused', 'pluginmgr:resumed',
            'pluginmgr:uninstalling', 'pluginmgr:uninstalled', 'pluginmgr:unloaded'].map(function (type) {
            return global.AxiomAgentRuntime.bus.on(type, function (env) { events.push(type + ':' + env.payload.id); });
          });

          var loadCount = 0;
          var baseInstall = M.install({
            id: 'plugin.m14-selftest-base', name: 'M14 Selftest Base', version: '1.0.0', author: 'AXIOM QA',
            description: 'Ephemeral plugin used only by the Milestone 14 self-test.',
            permissions: ['bus.emit'], capabilities: ['selftest.echo']
          }, function (ctx) {
            loadCount += 1;
            return {
              echo: function (x) { return x; },
              onEnable: function () { events.push('module:onEnable'); },
              onDisable: function () { events.push('module:onDisable'); },
              onPause: function () { events.push('module:onPause'); },
              onResume: function () { events.push('module:onResume'); }
            };
          });
          check('install() accepts a valid manifest + factory and returns state "disabled"', baseInstall.ok === true && baseInstall.plugin.state === S.DISABLED, baseInstall);

          var dupInstall = M.install({ id: 'plugin.m14-selftest-base', name: 'dup', version: '1.0.0', author: 'a', description: '' });
          check('install() rejects a second install of the same id', dupInstall.ok === false);

          // A dependent plugin, to exercise dependency-gated load below.
          var depInstall = M.install({
            id: 'plugin.m14-selftest-dependent', name: 'M14 Selftest Dependent', version: '1.0.0', author: 'AXIOM QA',
            description: 'Depends on plugin.m14-selftest-base.', dependencies: ['plugin.m14-selftest-base']
          }, function () { return { marker: true }; });
          check('install() accepts a plugin whose dependency is already installed', depInstall.ok === true, depInstall);

          // ---- 3. Load (dependency not yet enabled -> fails, state FAILED) ----
          var earlyDepLoad = await M.load('plugin.m14-selftest-dependent');
          check('load() refuses when a declared dependency is installed but not yet enabled', earlyDepLoad.ok === false);
          check('a failed dependency-gated load leaves the plugin in state "failed"', M.get('plugin.m14-selftest-dependent').state === S.FAILED);

          // ---- 4. Enable / Load the base plugin ------------------------
          var enableRes = await M.enable('plugin.m14-selftest-base');
          check('enable() loads and runs a disabled plugin, reaching state "running"', enableRes.ok === true && enableRes.plugin.state === S.RUNNING, enableRes);
          check('enabling a plugin invoked its module onEnable() hook', events.indexOf('module:onEnable') !== -1);
          check('loading a plugin ran its factory exactly once', loadCount === 1);

          var reEnable = await M.enable('plugin.m14-selftest-base');
          check('enable() on an already-running plugin is a no-op success (idempotent, no duplicate load)', reEnable.ok === true && loadCount === 1);

          var directLoad = await M.load('plugin.m14-selftest-base');
          check('load() on an already-running plugin does not re-invoke the factory (duplicate loading prevented)', directLoad.ok === true && loadCount === 1);

          // ---- 5. Now the dependent plugin can load --------------------
          var depLoadNow = await M.load('plugin.m14-selftest-dependent');
          check('load() succeeds once its dependency is enabled', depLoadNow.ok === true && depLoadNow.plugin.state === S.RUNNING, depLoadNow);

          // ---- 6. Pause / Resume ---------------------------------------
          var pauseRes = M.pause('plugin.m14-selftest-base');
          check('pause() moves a running plugin to state "paused"', pauseRes.ok === true && pauseRes.plugin.state === S.PAUSED, pauseRes);
          check('pausing invoked the module onPause() hook', events.indexOf('module:onPause') !== -1);

          var badPause = M.pause('plugin.m14-selftest-base');
          check('pause() on an already-paused plugin is rejected (not running)', badPause.ok === false);

          var resumeRes = M.resume('plugin.m14-selftest-base');
          check('resume() moves a paused plugin back to state "running"', resumeRes.ok === true && resumeRes.plugin.state === S.RUNNING, resumeRes);
          check('resuming invoked the module onResume() hook', events.indexOf('module:onResume') !== -1);

          // ---- 7. Cannot uninstall a depended-on plugin -----------------
          var blockedUninstall = M.uninstall('plugin.m14-selftest-base');
          check('uninstall() is refused while an active dependent plugin still needs it', blockedUninstall.ok === false, blockedUninstall.error);

          // ---- 8. Disable the dependent, then disable + unload base ----
          var disableDependent = M.disable('plugin.m14-selftest-dependent');
          check('disable() moves a running plugin to state "disabled" and frees it (unloaded)', disableDependent.ok === true && disableDependent.plugin.state === S.DISABLED);

          var disableBase = M.disable('plugin.m14-selftest-base');
          check('disable() on the base plugin succeeds once nothing depends on it anymore', disableBase.ok === true && disableBase.plugin.state === S.DISABLED);
          check('disabling invoked the module onDisable() hook', events.indexOf('module:onDisable') !== -1);
          check('after disable(), the loader no longer reports the plugin as loaded', global.AxiomPluginLoader.isLoaded('plugin.m14-selftest-base') === false);

          // ---- 9. Explicit unload() on an already-disabled plugin is a safe no-op-ish success ----
          var unloadAlreadyDisabled = M.unload('plugin.m14-selftest-base');
          check('unload() on a not-loaded plugin reports a clear error rather than throwing', unloadAlreadyDisabled.ok === false);

          // ---- 10. Re-load proves the factory runs again after unload (lazy reload, not stuck) ----
          var reloadRes = await M.load('plugin.m14-selftest-base');
          check('load() after a full disable/unload cycle re-invokes the factory (lazy reload works)', reloadRes.ok === true && loadCount === 2, loadCount);

          // ---- 11. Uninstall ---------------------------------------------
          M.disable('plugin.m14-selftest-base');
          var uninstallDependent = M.uninstall('plugin.m14-selftest-dependent');
          check('uninstall() removes a disabled plugin from the registry', uninstallDependent.ok === true && M.get('plugin.m14-selftest-dependent') === null);

          var uninstallBase = M.uninstall('plugin.m14-selftest-base');
          check('uninstall() removes the base plugin once no dependents remain', uninstallBase.ok === true && M.get('plugin.m14-selftest-base') === null);

          var uninstallUnknown = M.uninstall('plugin.does-not-exist-at-all');
          check('uninstall() on an unknown id reports a clear error', uninstallUnknown.ok === false);

          // ---- 12. Extension-point reuse: a plugin-declared skill goes through the real Skill Registry ----
          if (global.AxiomSkillRegistry) {
            var skillPluginInstall = M.install({
              id: 'plugin.m14-selftest-skill-provider', name: 'Skill Provider', version: '1.0.0', author: 'AXIOM QA',
              description: 'Registers a skill through the existing Skill Registry on load.'
            }, function () {
              return { skills: [{ id: 'skill.m14-selftest-plugin-echo', name: 'Plugin Echo', version: '1.0.0', handler: function (input) { return Promise.resolve(input); } }] };
            });
            check('install() accepts a plugin that declares a skill extension point', skillPluginInstall.ok === true);
            var skillEnable = await M.enable('plugin.m14-selftest-skill-provider');
            check('enabling a plugin registers its declared skill in the real Skill Registry', skillEnable.ok === true && !!global.AxiomSkillRegistry.get('skill.m14-selftest-plugin-echo'));
            var skillInvoke = await global.AxiomSkillRegistry.invoke('skill.m14-selftest-plugin-echo', { via: 'plugin' });
            check('the plugin-provided skill is genuinely invocable through Skill Registry .invoke()', skillInvoke && skillInvoke.via === 'plugin', skillInvoke);
            M.disable('plugin.m14-selftest-skill-provider');
            check('disabling the plugin unregisters its skill from the Skill Registry', global.AxiomSkillRegistry.get('skill.m14-selftest-plugin-echo') === null);
            M.uninstall('plugin.m14-selftest-skill-provider');
          } else {
            check('Skill Registry reuse test skipped (AxiomSkillRegistry not present)', true);
          }

          // ---- Regression: core runtime + prior milestones untouched ----
          offAny.forEach(function (off) { off(); });
          if (global.AxiomAgentManager) {
            var coreSnap = global.AxiomAgentManager.snapshot();
            check('still exactly 10 core agents after all Milestone 14 activity, no duplicates',
              coreSnap.count === 10 && new Set(coreSnap.agents.map(function (a) { return a.id; })).size === 10, 'count=' + coreSnap.count);
          }
          check('event-driven lifecycle events actually fired on the shared bus for this run', events.length > 5, events.length);

          return finish();
        } catch (err) {
          check('Milestone 14 Part 1 self-test ran without throwing', false, String(err && err.message || err));
          return finish();
        }

        function finish() {
          var passed = results.filter(function (r) { return r.pass; }).length;
          var ok = passed === results.length;
          AxLogger.log('[AxiomM14] self-test ' + (ok ? 'PASS' : 'FAIL') + ' — ' + passed + '/' + results.length);
          results.forEach(function (r) { AxLogger.log('  ' + (r.pass ? 'ok  ' : 'FAIL') + ' ' + r.name + (r.detail !== null && r.detail !== undefined ? '  (' + JSON.stringify(r.detail) + ')' : '')); });
          return { ok: ok, passed: passed, total: results.length, results: results };
        }
      }
    });
  } else {
    AxLogger.warn('[AxiomM14] window.AxiomRuntime not found — run this after runtime-bootstrap.js. Milestone 14 modules are still available individually on window.');
  }

  AxLogger.log('[AxiomM14] Plugin Foundation online' + (missing.length ? ' (with missing pieces — see errors above)' : '') + '. Run AxiomRuntime.selfTestM14() to verify.');
})(window);
