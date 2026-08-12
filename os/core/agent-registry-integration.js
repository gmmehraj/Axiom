// ============================================================
// AXIOM — Block 2 / Step 6 / Part 2: Agent Registry Integration
// ------------------------------------------------------------
// Part 1 (os/core/orchestrator.js) built the Orchestrator itself:
// AgentRegistry, EventBus, TaskScheduler, runtime lifecycle — but
// registered nothing. Every existing subsystem (Browser, Brain,
// Memory, Automation, Analytics) still only exists as its own
// independent global, exactly as before Part 1.
//
// This module is the registration phase only. It does three things,
// net-new, and nothing else:
//
//   1. Registers each existing subsystem with AxiomOrchestrator as an
//      agent (id, name, capabilities, permissions, supported tools),
//      reading that information from each subsystem's own real,
//      already-public API — nothing is invented.
//   2. Keeps each registered agent's `health` field in sync with the
//      subsystem's own real status/diagnostics, on a read-only poll.
//   3. Adds read-only discovery APIs on top of the registry
//      (discoverAgents, discoverCapabilities, findAgentByCapability,
//      getAgentHealth, getSystemHealth, listAvailableTools).
//
// What this module explicitly does NOT do:
//   - It does not call dispatch() on any of these agents. Registering
//     an agent's handler makes it *routable* in a future phase; nothing
//     in this pass or in any existing file invokes it.
//   - It does not modify orchestrator.js, or any Browser/Brain/Memory/
//     Automation/Analytics file. Every handler below only ever *calls*
//     those subsystems' existing public methods — it never patches or
//     reassigns them.
//   - It does not touch any .html file or any js/pages/* UI file.
//
// Load order: this file must load after os/core/orchestrator.js and
// after whichever subsystem globals are present on the page. It does
// not assume every subsystem is present — most individual pages only
// load a subset (see SYSTEM_REGISTRY.md) — so each registration step
// is independent and skips cleanly if its global is missing.
//
// Usage (read-only discovery, safe to call from anywhere):
//   AxiomOrchestrator.discoverAgents()
//   AxiomOrchestrator.discoverCapabilities()
//   AxiomOrchestrator.findAgentByCapability('navigate')
//   AxiomOrchestrator.getAgentHealth('browser')
//   AxiomOrchestrator.getSystemHealth()
//   AxiomOrchestrator.listAvailableTools()
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[AgentRegistryIntegration] ' + message, detail !== undefined ? detail : '');
      return;
    }
    try {
      // eslint-disable-next-line no-console
      console[method === 'error' ? 'error' : 'log']('[AgentRegistryIntegration] ' + message, detail || '');
    } catch (e) { /* no console available — swallow */ }
  }

  if (!Orchestrator || typeof Orchestrator.registerAgent !== 'function') {
    log('error', 'AxiomOrchestrator (os/core/orchestrator.js) not found — load it before agent-registry-integration.js.');
    return;
  }

  // ------------------------------------------------------------
  // Small helpers shared by every registration step
  // ------------------------------------------------------------

  // Calls fn() and normalizes the outcome into one of the registry's
  // three health values. Never throws — a subsystem probe that throws
  // is exactly what "unhealthy" means.
  function probeHealth(fn) {
    if (typeof fn !== 'function') return 'degraded'; // subsystem exists but exposes no probe
    try {
      var result = fn();
      if (result && typeof result.status === 'string') {
        // Subsystems that already model status (e.g. BrowserManager.health()
        // -> {status:'healthy'|'degraded'|'unavailable'}) get mapped 1:1.
        if (result.status === 'healthy') return 'healthy';
        if (result.status === 'degraded') return 'degraded';
        return 'unhealthy'; // 'unavailable' or any other reported status
      }
      // No structured status returned, but the call itself didn't throw
      // and returned something — treat that as a healthy liveness signal.
      return result === undefined || result === null ? 'degraded' : 'healthy';
    } catch (err) {
      return 'unhealthy';
    }
  }

  // Wraps a real subsystem call so a registered-but-unused handler
  // never throws raw into the scheduler — it reports a clear, typed
  // error instead. Still performs no work unless the scheduler
  // actually invokes it, which nothing in this phase does.
  function safeInvoke(subsystemLabel, fn, args) {
    if (typeof fn !== 'function') {
      throw new Error(subsystemLabel + ': operation is not available on this subsystem.');
    }
    return fn.apply(null, args || []);
  }

  var registeredBy = Object.create(null); // agentId -> { healthProbe: fn }

  function registerOnce(config, healthProbe) {
    if (Orchestrator.getAgent(config.id)) {
      log('log', 'Agent "' + config.id + '" already registered — skipping.');
      return Orchestrator.getAgent(config.id);
    }
    var agent = Orchestrator.registerAgent(config);
    registeredBy[config.id] = { healthProbe: healthProbe || null };
    // Set an accurate initial health immediately, instead of waiting
    // for the first poll tick, so getSystemHealth() is correct from
    // the moment registration completes.
    if (healthProbe) {
      Orchestrator.setAgentHealth(config.id, probeHealth(healthProbe));
    }
    log('log', 'Registered agent "' + config.id + '".');
    return agent;
  }

  // ------------------------------------------------------------
  // Part F — Coding Agent Registration
  // ------------------------------------------------------------
  // Block 2 / Step 7 / Part 1: wraps the real os/runtime/capabilities/
  // coding-toolkit.js API (window.AxiomCodingToolkit) using the exact
  // same registerOnce/safeInvoke pattern as Parts A-E. Deliberately
  // does NOT reuse os/runtime/agent-definitions/coding-agent.js — that
  // file's handler(task, ctx) signature and its context object shape
  // belong to the separate legacy os/runtime orchestration stack (see
  // SYSTEM_REGISTRY.md) and are not compatible with this stack's plain
  // handler(task) contract. This registers a new, independent agent
  // against the same underlying toolkit instead of adapting that file.
  //
  // Two of the toolkit's operations (explainCode, proposeRefactor,
  // investigateBug) call through to a live model client
  // (window.OpenRouter). This page does not currently load
  // js/core/openrouter-client.js (it depends on
  // js/core/openrouter-config.js and the Supabase auth/billing chain,
  // which is outside this pass's verified scope — see
  // AI_RUNTIME_INTEGRATION.md). AxiomCodingToolkit.hasClient() already
  // handles that absence gracefully — those three operations return a
  // clear "no client available" result instead of throwing, verified
  // in this pass. projectSearch, fileNavigation, and analyzeProject
  // need no model client and work fully.
  function registerCodingAgent() {
    var Toolkit = global.AxiomCodingToolkit;
    if (!Toolkit) return null;

    return registerOnce({
      id: 'coding',
      name: 'Coding Agent',
      capabilities: [
        'project-search', 'file-navigation', 'code-explanation',
        'refactor-proposal', 'bug-investigation', 'project-analysis'
      ],
      permissions: ['coding:read', 'coding:analyze'],
      tools: [
        'coding.projectSearch', 'coding.fileNavigation', 'coding.explainCode',
        'coding.proposeRefactor', 'coding.investigateBug', 'coding.analyzeProject'
      ],
      handler: function (task) {
        var type = task && task.type;
        var payload = (task && task.payload) || {};
        var opts = { task: payload.context || null };
        switch (type) {
          case 'project-search': return safeInvoke('Coding Agent', Toolkit.projectSearch, [payload.query, payload.limit]);
          case 'file-navigation': return safeInvoke('Coding Agent', Toolkit.fileNavigation, [payload.query, payload.limit]);
          case 'explain-code': return safeInvoke('Coding Agent', Toolkit.explainCode, [payload.code, opts]);
          case 'propose-refactor': return safeInvoke('Coding Agent', Toolkit.proposeRefactor, [payload.code, payload.instructions, opts]);
          case 'investigate-bug': return safeInvoke('Coding Agent', Toolkit.investigateBug, [payload.description, opts]);
          case 'analyze-project': return safeInvoke('Coding Agent', Toolkit.analyzeProject, [payload.query]);
          default:
            throw new Error('Coding Agent: unsupported task type "' + type + '".');
        }
      }
    }, function () {
      // No dedicated health() on the toolkit either (same shape as
      // Brain/Memory) — hasClient() is a real, side-effect-free signal
      // of whether the model-dependent half of this agent is usable,
      // without implying the whole agent is unhealthy when it's just
      // running in file/search-only mode.
      return { status: 'healthy', modelClientAvailable: !!(Toolkit.hasClient && Toolkit.hasClient()) };
    });
  }

  // ------------------------------------------------------------
  // Part A — Browser Agent Registration
  // ------------------------------------------------------------
  function registerBrowserAgent() {
    var Browser = global.AxiomBrowserManager || global.BrowserManager;
    if (!Browser) return null;

    var ToolRegistry = global.AxiomBrowserToolRegistry;
    var tools = (ToolRegistry && typeof ToolRegistry.listTools === 'function')
      ? ToolRegistry.listTools().map(function (t) { return t.name; })
      : ['browser.navigate', 'browser.back', 'browser.forward', 'browser.refresh',
         'browser.createSession', 'browser.createTab', 'browser.readHistory'];

    return registerOnce({
      id: 'browser',
      name: 'Browser Agent',
      capabilities: [
        'navigate', 'session-management', 'tab-management',
        'history-read', 'diagnostics'
      ],
      permissions: ['browser:read', 'browser:navigate', 'browser:session', 'browser:tabs'],
      tools: tools,
      handler: function (task) {
        var type = task && task.type;
        var payload = (task && task.payload) || {};
        switch (type) {
          case 'navigate': return safeInvoke('Browser Agent', Browser.navigate, [payload.url, payload]);
          case 'back': return safeInvoke('Browser Agent', Browser.back, [payload]);
          case 'forward': return safeInvoke('Browser Agent', Browser.forward, [payload]);
          case 'refresh': return safeInvoke('Browser Agent', Browser.refresh, [payload]);
          case 'create-session': return safeInvoke('Browser Agent', Browser.createSession, [payload]);
          case 'create-tab': return safeInvoke('Browser Agent', Browser.createTab, [payload.sessionId, payload.url]);
          case 'read-history': return safeInvoke('Browser Agent', Browser.readHistory, [payload]);
          case 'diagnostics': return safeInvoke('Browser Agent', Browser.diagnostics, []);
          default:
            if (typeof Browser.executeBrowserOp === 'function') {
              return Browser.executeBrowserOp(type, payload);
            }
            throw new Error('Browser Agent: unsupported task type "' + type + '".');
        }
      }
    }, function () { return Browser.health ? Browser.health() : null; });
  }

  // ------------------------------------------------------------
  // Part B — Brain Agent Registration
  // ------------------------------------------------------------
  function registerBrainAgent() {
    var Brain = global.AxiomBrain;
    if (!Brain) return null;

    return registerOnce({
      id: 'brain',
      name: 'Brain Agent',
      capabilities: ['state-read', 'state-write', 'mood-tracking', 'activity-tracking', 'day-count', 'time-of-day'],
      permissions: ['brain:read', 'brain:write'],
      tools: ['brain.getState', 'brain.setState', 'brain.dayCount', 'brain.timeOfDay'],
      handler: function (task) {
        var type = task && task.type;
        var payload = (task && task.payload) || {};
        switch (type) {
          case 'get-state': return safeInvoke('Brain Agent', Brain.getState, []);
          case 'set-state': return safeInvoke('Brain Agent', Brain.setState, [payload]);
          case 'day-count': return safeInvoke('Brain Agent', Brain.dayCount, []);
          case 'time-of-day': return safeInvoke('Brain Agent', Brain.timeOfDay, []);
          default:
            throw new Error('Brain Agent: unsupported task type "' + type + '".');
        }
      }
    }, function () {
      // AxiomBrain exposes no dedicated health() — its only real
      // liveness signal is whether getState() resolves. That's exactly
      // what probeHealth()'s unstructured-return branch is for.
      return Brain.getState();
    });
  }

  // ------------------------------------------------------------
  // Part C — Memory Agent Registration
  // ------------------------------------------------------------
  function registerMemoryAgent() {
    var Memory = global.AxiomMemoryManager;
    if (!Memory) return null;

    return registerOnce({
      id: 'memory',
      name: 'Memory Agent',
      capabilities: [
        'conversation-management', 'memory-storage', 'memory-retrieval',
        'session-tracking', 'metadata-summary', 'cleanup'
      ],
      permissions: ['memory:read', 'memory:write'],
      tools: [
        'memory.getConversation', 'memory.listConversations', 'memory.findMemories',
        'memory.registerMemory', 'memory.getOverview', 'memory.runCleanup'
      ],
      handler: function (task) {
        var type = task && task.type;
        var payload = (task && task.payload) || {};
        switch (type) {
          case 'get-conversation': return safeInvoke('Memory Agent', Memory.getConversation, [payload.id]);
          case 'list-conversations': return safeInvoke('Memory Agent', Memory.listConversations, [payload]);
          case 'find-memories': return safeInvoke('Memory Agent', Memory.findMemories, [payload]);
          case 'register-memory': return safeInvoke('Memory Agent', Memory.registerMemory, [payload]);
          case 'get-overview': return safeInvoke('Memory Agent', Memory.getOverview, []);
          case 'run-cleanup': return safeInvoke('Memory Agent', Memory.runCleanup, []);
          default:
            throw new Error('Memory Agent: unsupported task type "' + type + '".');
        }
      }
    }, function () {
      // No dedicated health() either — getOverview() exercises the
      // underlying engine (getStats() + summaries), so a throw there
      // is a real signal, not a guess.
      return Memory.getOverview();
    });
  }

  // ------------------------------------------------------------
  // Part D — Automation Agent Registration
  // ------------------------------------------------------------
  function registerAutomationAgent() {
    var Automation = global.AxiomAutomationManager;
    if (!Automation) return null;

    return registerOnce({
      id: 'automation',
      name: 'Automation Agent',
      capabilities: [
        'workflow-execution', 'workflow-queueing', 'workflow-monitoring',
        'workflow-history', 'browser-automation-bridge'
      ],
      permissions: ['automation:read', 'automation:execute'],
      tools: ['automation.workflows', 'automation.queue', 'automation.run', 'automation.status', 'automation.history'],
      handler: function (task) {
        var type = task && task.type;
        var payload = (task && task.payload) || {};
        switch (type) {
          case 'run-workflow': return safeInvoke('Automation Agent', Automation.run, [payload]);
          case 'get-status': return safeInvoke('Automation Agent', Automation.status.getStatus, [payload.sessionId, payload.tabId]);
          case 'get-stats': return safeInvoke('Automation Agent', Automation.getStats, []);
          default:
            throw new Error('Automation Agent: unsupported task type "' + type + '".');
        }
      }
    }, function () { return Automation.getStats(); });
  }

  // ------------------------------------------------------------
  // Part E — Analytics & System Registration
  // ------------------------------------------------------------
  function registerAnalyticsAgent() {
    var Analytics = global.AxiomAnalyticsAutomation;
    if (!Analytics) return null;

    return registerOnce({
      id: 'analytics',
      name: 'Analytics Agent',
      capabilities: ['analytics-enhancement', 'automation-logging'],
      permissions: ['analytics:read'],
      tools: ['analytics.enhanceAnalytics', 'analytics.enhanceAutomation', 'analytics.addLog'],
      handler: function (task) {
        var type = task && task.type;
        var payload = (task && task.payload) || {};
        switch (type) {
          case 'enhance-analytics': return safeInvoke('Analytics Agent', Analytics.enhanceAnalytics, [payload]);
          case 'enhance-automation': return safeInvoke('Analytics Agent', Analytics.enhanceAutomation, [payload]);
          case 'add-log': return safeInvoke('Analytics Agent', Analytics.addLog, [payload]);
          default:
            throw new Error('Analytics Agent: unsupported task type "' + type + '".');
        }
      }
    }, function () { return Analytics.state ? { status: 'healthy' } : null; });
  }

  // "System" has no single existing subsystem file the way Browser/
  // Brain/Memory/Automation/Analytics do — see SYSTEM_REGISTRY.md for
  // why. It is registered as a thin, honest aggregator: it reports the
  // Orchestrator's own runtime stats plus whatever real runtime signals
  // are already present on the page (AxiomRuntimeMonitor.report() when
  // loaded), never fabricated metrics.
  function registerSystemAgent() {
    return registerOnce({
      id: 'system',
      name: 'System Agent',
      capabilities: ['system-diagnostics', 'runtime-status', 'agent-health-aggregation'],
      permissions: ['system:read'],
      tools: ['system.getRuntimeInfo', 'system.getSystemHealth'],
      handler: function (task) {
        var type = task && task.type;
        switch (type) {
          case 'get-runtime-info': return systemRuntimeInfo();
          case 'get-system-health': return Orchestrator.getSystemHealth();
          default:
            throw new Error('System Agent: unsupported task type "' + type + '".');
        }
      }
    }, function () { return { status: 'healthy' }; }); // the System agent's own liveness is the Orchestrator's
  }

  function systemRuntimeInfo() {
    var Monitor = global.AxiomRuntimeMonitor;
    return {
      orchestratorState: Orchestrator.getRuntimeState(),
      orchestratorStats: Orchestrator.getStats(),
      runtimeMonitorReport: (Monitor && typeof Monitor.report === 'function') ? Monitor.report() : null,
      timestamp: Date.now()
    };
  }

  // ------------------------------------------------------------
  // Part F — Agent Discovery APIs
  // ------------------------------------------------------------
  // Additive only: these are new properties assigned onto the existing
  // AxiomOrchestrator object from the outside. orchestrator.js itself
  // is not edited — every one of these is implemented purely in terms
  // of Part 1's own already-public methods (listAgents, getAgent,
  // getHealthyAgents, getStats), so Part 1's regression suite and file
  // stay untouched and valid.
  function installDiscoveryApi() {
    if (typeof Orchestrator.discoverAgents === 'function') return; // idempotent

    // filter: { capability?, tool?, health?, status? } — all optional, all AND-ed.
    Orchestrator.discoverAgents = function (filter) {
      var agentsList = Orchestrator.listAgents();
      if (!filter) return agentsList;
      return agentsList.filter(function (a) {
        if (filter.capability && a.capabilities.indexOf(filter.capability) === -1) return false;
        if (filter.tool && a.tools.indexOf(filter.tool) === -1) return false;
        if (filter.health && a.health !== filter.health) return false;
        if (filter.status && a.status !== filter.status) return false;
        return true;
      });
    };

    Orchestrator.discoverCapabilities = function () {
      var set = Object.create(null);
      Orchestrator.listAgents().forEach(function (a) {
        a.capabilities.forEach(function (c) { set[c] = true; });
      });
      return Object.keys(set).sort();
    };

    Orchestrator.findAgentByCapability = function (capability) {
      return Orchestrator.listAgents().filter(function (a) {
        return a.capabilities.indexOf(capability) !== -1;
      });
    };

    Orchestrator.getAgentHealth = function (id) {
      var agent = Orchestrator.getAgent(id);
      if (!agent) return null;
      return { id: agent.id, name: agent.name, health: agent.health, status: agent.status, lastActiveAt: agent.lastActiveAt };
    };

    Orchestrator.getSystemHealth = function () {
      var agentsList = Orchestrator.listAgents();
      var healthy = agentsList.filter(function (a) { return a.health === 'healthy'; }).length;
      var degraded = agentsList.filter(function (a) { return a.health === 'degraded'; }).length;
      var unhealthy = agentsList.filter(function (a) { return a.health === 'unhealthy'; }).length;
      var overall = unhealthy > 0 ? 'degraded' : (degraded > 0 ? 'degraded' : (agentsList.length ? 'healthy' : 'unknown'));
      return {
        overall: overall,
        totalAgents: agentsList.length,
        healthy: healthy,
        degraded: degraded,
        unhealthy: unhealthy,
        runtimeState: Orchestrator.getRuntimeState(),
        agents: agentsList.map(function (a) { return { id: a.id, health: a.health, status: a.status }; }),
        timestamp: Date.now()
      };
    };

    Orchestrator.listAvailableTools = function () {
      var set = Object.create(null);
      Orchestrator.listAgents().forEach(function (a) {
        a.tools.forEach(function (t) { set[t] = a.id; });
      });
      return Object.keys(set).sort().map(function (tool) { return { tool: tool, agentId: set[tool] }; });
    };
  }

  // ------------------------------------------------------------
  // Health sync — read-only poll, no execution routing involved
  // ------------------------------------------------------------
  var HEALTH_POLL_MS = 20000;
  var pollTimer = null;

  function syncHealth() {
    Object.keys(registeredBy).forEach(function (id) {
      var entry = registeredBy[id];
      if (!entry.healthProbe) return;
      if (!Orchestrator.getAgent(id)) return; // was unregistered elsewhere
      Orchestrator.setAgentHealth(id, probeHealth(entry.healthProbe));
    });
  }

  function startHealthPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(syncHealth, HEALTH_POLL_MS);
    if (pollTimer && pollTimer.unref) pollTimer.unref();
  }

  function stopHealthPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // ------------------------------------------------------------
  // Entry point
  // ------------------------------------------------------------
  function registerAll() {
    var results = {
      browser: registerBrowserAgent(),
      brain: registerBrainAgent(),
      memory: registerMemoryAgent(),
      automation: registerAutomationAgent(),
      analytics: registerAnalyticsAgent(),
      coding: registerCodingAgent(),
      system: registerSystemAgent()
    };
    installDiscoveryApi();
    startHealthPolling();
    return results;
  }

  var AxiomAgentRegistryIntegration = {
    API_VERSION: '1.0.0',
    registerAll: registerAll,
    syncHealth: syncHealth,
    startHealthPolling: startHealthPolling,
    stopHealthPolling: stopHealthPolling,
    // exposed individually so a page that only wants one subsystem
    // registered (rather than all six) can call it directly
    registerBrowserAgent: registerBrowserAgent,
    registerBrainAgent: registerBrainAgent,
    registerMemoryAgent: registerMemoryAgent,
    registerAutomationAgent: registerAutomationAgent,
    registerAnalyticsAgent: registerAnalyticsAgent,
    registerSystemAgent: registerSystemAgent
  };

  global.AxiomAgentRegistryIntegration = AxiomAgentRegistryIntegration;

  // Auto-register on load, same convention as orchestrator.js — safe
  // because every step above is a no-op when its subsystem global is
  // absent, and registerOnce() is idempotent.
  function boot() {
    // Orchestrator auto-starts itself; if for any reason it hasn't
    // reached 'running' yet (e.g. this script happens to execute
    // before orchestrator.js's own DOMContentLoaded handler), defer
    // one tick rather than let registerAgent() calls throw.
    if (typeof Orchestrator.getRuntimeState === 'function' && Orchestrator.getRuntimeState() !== 'running') {
      setTimeout(boot, 0);
      return;
    }
    registerAll();
  }

  if (typeof document !== 'undefined' && document.readyState !== 'loading') {
    boot();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
