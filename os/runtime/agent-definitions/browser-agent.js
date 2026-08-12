// ============================================================
// AXIOM AI OS — Agent Definition: Browser Agent
// ------------------------------------------------------------
// Split out of the former monolithic os/runtime/agent-definitions.js
// as part of Phase 8 Part 2 (Code Quality & Maintainability). Behavior
// is unchanged — this is the exact same spec object, just given its
// own file. See os/runtime/agent-definitions/_shared.js for the
// `tick`/`has` helpers and os/runtime/agent-definitions/_assemble.js
// for how every agent file's spec is collected into the same
// window.AxiomAgentDefinitions / window.AxiomAgentDefinitionsById
// globals the rest of the runtime already depends on.
// ============================================================
(function (global) {
  'use strict';
  var tick = global.AxiomAgentDefHelpers.tick;
  var has = global.AxiomAgentDefHelpers.has;

  (global.__axiomAgentDefs = global.__axiomAgentDefs || []).push(
{
  id: 'agent.browser',
  name: 'Browser Agent',
  description: 'Navigates the web and live browser studio, fetches pages, and extracts on-page information for other agents.',
  icon: '\uD83C\uDF10',
  canonicalState: 'browsing',
  capabilities: ['navigate', 'fetch-page', 'extract', 'search-web', 'manage-tabs',
    'bookmark', 'history', 'downloads', 'reading-mode', 'summarize-page',
    'extract-links', 'extract-images', 'detect-blocked-embed',
    'stop-loading', 'duplicate-tab', 'reorder-tab'],
  tools: ['internet_search', 'browser'],
  subscriptions: ['task:assign'],
  // Milestone 5 & Block 2 Step 5 Part 4: talks to the Browser Engine via
  // AxiomBrowserManager / AxiomBrowserBridge — same window if the agent
  // runs on browser.html itself, postMessage if the workspace is an
  // embedded iframe elsewhere. Every op is run through the capability
  // kit for loading/success/failure/retry/timeout handling.
  handler: async function (task, ctx) {
    var reg = global.AxiomBrowserToolRegistry || global.BrowserToolRegistry;
    var bm = global.AxiomBrowserManager || global.BrowserManager;
    var bridge = global.AxiomBrowserBridge;
    var op = task.op || (task.url ? 'navigate' : ((task.query || task.text) ? 'search' : null));
    if (!op) return { ok: true, note: 'No browser action specified.' };

    if (!reg && !bm && !bridge) {
      await tick(200);
      return { ok: true, op: op, live: false,
        note: 'Browser Tool Registry / Manager unavailable on this page — no live navigation performed.' };
    }

    var run = function () {
      var toolName = 'browser_' + op.replace(/-/g, '_');
      if (reg && reg.hasTool(toolName)) {
        return reg.executeTool(toolName, task);
      }
      if (bm) {
        return bm.executeBrowserOp(op, task);
      }
      switch (op) {
        case 'navigate':   return bridge.navigate(task.url || task.text);
        case 'search':     return bridge.search(task.query || task.text);
        case 'back':       return bridge.back();
        case 'forward':    return bridge.forward();
        case 'refresh':    return bridge.refresh();
        case 'new-tab':    return bridge.newTab(task.url);
        case 'switch-tab': return bridge.switchTab(task.tabId);
        case 'close-tab':  return bridge.closeTab(task.tabId);
        case 'bookmark':          return bridge.command('bookmark');
        case 'stop-loading':      return bridge.stopLoading();
        case 'duplicate-tab':     return bridge.duplicateTab(task.tabId);
        case 'reorder-tab':       return bridge.reorderTab(task.tabId, task.index);
        case 'bookmarks-list':    return bridge.bookmarksList();
        case 'history-list':      return bridge.historyList(task.limit);
        case 'history-clear':     return bridge.historyClear();
        case 'downloads-list':    return bridge.downloadsList(task.limit);
        case 'reading-mode':      return bridge.readingMode();
        case 'summarize-page':    return bridge.summarizePage({ maxSentences: task.maxSentences });
        case 'extract-links':     return bridge.extractLinks({ limit: task.limit });
        case 'extract-images':    return bridge.extractImages({ limit: task.limit });
        case 'detect-blocked-embed': return bridge.detectBlocked();
        default: return Promise.reject(new Error('Unsupported browser op "' + op + '".'));
      }
    };

    var kit = global.AxiomCapabilityKit;
    try {
      var raw = kit
        ? await kit.withCapability('browser:' + op, task, ctx, run, { timeoutMs: 8000, retries: 2 })
        : await run();
      // Milestone 6 read-only ops (bookmarks-list, reading-mode,
      // extract-links, …) return { snapshot, data }; earlier ops
      // return the nav snapshot directly. Normalize both so callers
      // can always look at `.result` for op-specific data and
      // `.snapshot` for the nav state, same shape every other agent
      // handler uses.
      var hasData = raw && typeof raw === 'object' && 'data' in raw && 'snapshot' in raw;
      var navSnapshot = hasData ? raw.snapshot : raw;
      var opResult = hasData ? raw.data : undefined;
      return { ok: true, op: op, live: true, snapshot: navSnapshot, result: opResult,
        note: (navSnapshot && navSnapshot.blocked)
          ? 'Page declined to be embedded — shown as an "open externally" fallback in the Browser Workspace.'
          : undefined };
    } catch (e) {
      // Graceful, non-crashing fallback — never try to bypass whatever
      // stopped the navigation (a blocked embed, a closed workspace, …).
      return { ok: false, op: op, live: false, error: String(e && e.message || e) };
    }
  }
}
  );
})(window);
