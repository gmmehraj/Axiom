// ============================================================
// AXIOM AI OS — Milestone 14 Part 1: Plugin Manifest
// ------------------------------------------------------------
// Objective 4: "Create Plugin Manifest. Include: Name, Version,
// Author, Description, Permissions, Dependencies, Capabilities."
//
// This module owns ONLY manifest shape/validation. It creates no
// agent, registers no skill, loads no code — Plugin Manager
// (plugin-manager.js) is the one place a manifest is actually acted
// on. Mirrors the namespace-enforcement style already established by
// plugin-registry.js (Milestone 11) and skill-registry.js (Milestone
// 13): a plugin id must self-identify under "plugin." and can never
// collide with the reserved "agent." core-agent namespace.
//
// Public surface — window.AxiomPluginManifest:
//   .ID_PATTERN               -> RegExp
//   .ALLOWED_PERMISSIONS      -> string[] (declarative permission set)
//   .validate(manifest)       -> string | null   (error message, or null if valid)
//   .normalize(manifest)      -> manifest with defaults filled in (assumes already valid)
// ============================================================
window.AxiomPluginManifest = (function () {
  'use strict';

  var RESERVED_PREFIX = 'agent.';
  var REQUIRED_PREFIX = 'plugin.';
  var ID_PATTERN = /^plugin\.[a-z0-9][a-z0-9-]*$/;
  var VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

  // Declarative permission set a plugin may request. Plugin Manager does
  // not sandbox JS execution (no existing AXIOM module does), so this is
  // an honesty contract enforced at install time: an unknown permission
  // fails validation loudly instead of silently granting undeclared
  // access. Plugin code is expected to gate its own behaviour behind
  // ctx.hasPermission(name) (see plugin-manager.js buildCtx()).
  var ALLOWED_PERMISSIONS = [
    'agent.dispatch',    // dispatch tasks to core/plugin agents via AxiomAgentManager
    'memory.read',       // read agent_memory / knowledge graph data
    'memory.write',      // write agent_memory entries
    'bus.emit',          // emit events on the shared Agent Event Bus
    'bus.subscribe',     // subscribe to events on the shared Agent Event Bus
    'network.fetch',     // perform outbound network requests
    'automation.create', // create automations via AxiomAutomationEngine
    'workflow.define',   // define workflows via AxiomWorkflowEngine
    'skill.register',    // register skills via AxiomSkillRegistry
    'ui.notify'          // surface a notification in the existing notification center
  ];

  function isString(v) { return typeof v === 'string'; }
  function isArray(v) { return Array.isArray(v); }

  function validate(manifest) {
    if (!manifest || typeof manifest !== 'object') return 'Plugin manifest must be an object.';

    if (!isString(manifest.id) || !manifest.id) return 'Plugin manifest requires a string "id".';
    if (manifest.id.indexOf(RESERVED_PREFIX) === 0) return 'Plugin id "' + manifest.id + '" is reserved for core agents (must not start with "' + RESERVED_PREFIX + '").';
    if (manifest.id.indexOf(REQUIRED_PREFIX) !== 0 || !ID_PATTERN.test(manifest.id)) return 'Plugin id "' + manifest.id + '" must match ' + ID_PATTERN + ' (e.g. "plugin.weather-widget").';

    if (!isString(manifest.name) || !manifest.name) return 'Plugin manifest requires a string "name".';
    if (!isString(manifest.version) || !VERSION_PATTERN.test(manifest.version)) return 'Plugin manifest requires a semver "version" string (e.g. "1.0.0"), got: ' + JSON.stringify(manifest.version) + '.';
    if (!isString(manifest.author) || !manifest.author) return 'Plugin manifest requires a string "author".';
    if (!isString(manifest.description)) return 'Plugin manifest requires a string "description" (may be empty).';

    if (manifest.permissions !== undefined) {
      if (!isArray(manifest.permissions)) return 'Plugin manifest "permissions" must be an array of strings.';
      for (var i = 0; i < manifest.permissions.length; i++) {
        var perm = manifest.permissions[i];
        if (!isString(perm) || ALLOWED_PERMISSIONS.indexOf(perm) === -1) {
          return 'Plugin manifest requests unknown permission "' + perm + '". Allowed: ' + ALLOWED_PERMISSIONS.join(', ') + '.';
        }
      }
    }

    if (manifest.dependencies !== undefined) {
      if (!isArray(manifest.dependencies)) return 'Plugin manifest "dependencies" must be an array of plugin ids.';
      for (var j = 0; j < manifest.dependencies.length; j++) {
        var dep = manifest.dependencies[j];
        if (!isString(dep) || !ID_PATTERN.test(dep)) return 'Plugin manifest dependency "' + dep + '" is not a valid plugin id.';
        if (dep === manifest.id) return 'Plugin "' + manifest.id + '" cannot depend on itself.';
      }
    }

    if (manifest.capabilities !== undefined) {
      if (!isArray(manifest.capabilities)) return 'Plugin manifest "capabilities" must be an array of strings.';
      for (var k = 0; k < manifest.capabilities.length; k++) {
        if (!isString(manifest.capabilities[k]) || !manifest.capabilities[k]) return 'Plugin manifest "capabilities" entries must be non-empty strings.';
      }
    }

    return null;
  }

  function normalize(manifest) {
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description || '',
      permissions: (manifest.permissions || []).slice(),
      dependencies: (manifest.dependencies || []).slice(),
      capabilities: (manifest.capabilities || []).slice()
    };
  }

  return {
    ID_PATTERN: ID_PATTERN,
    ALLOWED_PERMISSIONS: ALLOWED_PERMISSIONS.slice(),
    validate: validate,
    normalize: normalize
  };
})();
