// ============================================================
// AXIOM — Block 2 / Step 5 / Part 5: Browser Tool Registry
// ------------------------------------------------------------
// Centralized tool registry exposing versioned Browser capabilities
// with OpenAI / OpenRouter compatible JSON schemas for AI Agents.
//
// Required Capability Discovery Methods:
//   - getTools()       -> Object dictionary of all registered tool definitions
//   - listTools()      -> Array of tool definitions
//   - getSchema(name)  -> JSON Schema for a specific tool
//   - hasTool(name)    -> Boolean check if tool exists
//
// Execution Flow Enforced on executeTool():
//   BrowserToolRegistry -> BrowserSandbox -> Permission Check -> BrowserManager -> Browser Engine
// ============================================================
(function (global) {
  'use strict';

  var Manager = global.AxiomBrowserManager || global.BrowserManager;
  var Sandbox = global.AxiomBrowserSandbox || global.BrowserSandbox;

  function getManager() {
    return global.AxiomBrowserManager || global.BrowserManager;
  }
  function getSandbox() {
    return global.AxiomBrowserSandbox || global.BrowserSandbox;
  }

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[BrowserToolRegistry] ' + message, detail !== undefined ? detail : '');
    }
  }

  /* ---------------- Tool Definitions & Schemas ---------------- */
  var toolRegistry = new Map(); // name -> { name, description, parameters, handler }

  function registerTool(spec) {
    if (!spec || !spec.name || typeof spec.handler !== 'function') {
      log('warn', 'Invalid tool spec registered', spec);
      return false;
    }
    toolRegistry.set(spec.name, {
      name: spec.name,
      description: spec.description || '',
      parameters: spec.parameters || { type: 'object', properties: {} },
      handler: spec.handler
    });
    return true;
  }

  /* ---------------- Tool Implementation Definitions ---------------- */
  registerTool({
    name: 'browser_navigate',
    description: 'Navigates the browser active tab to a specified URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The target web URL (http, https, about:blank, axiom:)' },
        sessionId: { type: 'string', description: 'Optional session ID' },
        tabId: { type: 'string', description: 'Optional tab ID' }
      },
      required: ['url']
    },
    handler: function (params, bm) {
      return bm.navigate(params.url, params);
    }
  });

  registerTool({
    name: 'browser_go_back',
    description: 'Navigates backward in the browser history for a tab.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        tabId: { type: 'string' }
      }
    },
    handler: function (params, bm) {
      return { ok: bm.back(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
    }
  });

  registerTool({
    name: 'browser_go_forward',
    description: 'Navigates forward in the browser history for a tab.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        tabId: { type: 'string' }
      }
    },
    handler: function (params, bm) {
      return { ok: bm.forward(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
    }
  });

  registerTool({
    name: 'browser_refresh',
    description: 'Reloads the current page in the specified browser tab.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        tabId: { type: 'string' }
      }
    },
    handler: function (params, bm) {
      return { ok: bm.refresh(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
    }
  });

  registerTool({
    name: 'browser_search',
    description: 'Executes a search query in the browser.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query or keyword' }
      },
      required: ['query']
    },
    handler: function (params, bm) {
      return bm.navigate(params.query, params);
    }
  });

  registerTool({
    name: 'browser_open_tab',
    description: 'Opens a new tab in a browser session.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Optional initial URL for the tab' },
        sessionId: { type: 'string' }
      }
    },
    handler: function (params, bm) {
      return { tab: bm.tabs.create(params.sessionId, params.url), snapshot: bm.getSnapshot() };
    }
  });

  registerTool({
    name: 'browser_close_tab',
    description: 'Closes a specified tab in a browser session.',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: 'ID of tab to close' },
        sessionId: { type: 'string' }
      },
      required: ['tabId']
    },
    handler: function (params, bm) {
      return { ok: bm.tabs.close(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
    }
  });

  registerTool({
    name: 'browser_switch_tab',
    description: 'Switches the active tab in a browser session.',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: 'ID of tab to switch to' },
        sessionId: { type: 'string' }
      },
      required: ['tabId']
    },
    handler: function (params, bm) {
      return { ok: bm.tabs.switch(params.sessionId, params.tabId), snapshot: bm.getSnapshot() };
    }
  });

  registerTool({
    name: 'browser_read_history',
    description: 'Reads recent visit history from the browser engine.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of visit records to return' },
        query: { type: 'string', description: 'Filter keyword for history entries' }
      }
    },
    handler: function (params, bm) {
      return bm.history.readHistory(params);
    }
  });

  registerTool({
    name: 'browser_manage_sessions',
    description: 'Creates, closes, switches, or lists browser sessions.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'close', 'switch', 'get-active', 'list'] },
        sessionId: { type: 'string' },
        label: { type: 'string' }
      },
      required: ['action']
    },
    handler: function (params, bm) {
      switch (params.action) {
        case 'create': return { session: bm.sessions.createSession(params) };
        case 'close': return { ok: bm.sessions.closeSession(params.sessionId) };
        case 'switch': return { ok: bm.sessions.switchSession(params.sessionId) };
        case 'get-active': return { session: bm.sessions.getActiveSession() };
        case 'list': return { sessions: bm.sessions.list ? bm.sessions.list() : [bm.sessions.getActiveSession()] };
        default: throw new Error('Unknown session action "' + params.action + '"');
      }
    }
  });

  registerTool({
    name: 'browser_extract_content',
    description: 'Extracts content (page URL, navigation status, or metadata) from the active browser tab.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['url', 'status', 'snapshot'] },
        sessionId: { type: 'string' },
        tabId: { type: 'string' }
      }
    },
    handler: function (params, bm) {
      var mode = params.mode || 'status';
      if (mode === 'url') return { url: bm.getCurrentUrl(params.sessionId, params.tabId) };
      if (mode === 'snapshot') return bm.getSnapshot();
      return bm.getNavigationStatus(params.sessionId, params.tabId);
    }
  });

  /* ---------------- Capability Discovery Methods (Part 5 Requirements) ---------------- */
  function getTools() {
    var obj = {};
    toolRegistry.forEach(function (v, k) {
      obj[k] = {
        name: v.name,
        description: v.description,
        parameters: v.parameters
      };
    });
    return obj;
  }

  function listTools() {
    return Array.from(toolRegistry.values()).map(function (v) {
      return {
        name: v.name,
        description: v.description,
        parameters: v.parameters
      };
    });
  }

  function getSchema(toolName) {
    var tool = toolRegistry.get(toolName);
    if (!tool) return null;
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    };
  }

  function hasTool(toolName) {
    return toolRegistry.has(toolName);
  }

  /* ---------------- Tool Execution Pipeline ----------------
   * Flow: BrowserToolRegistry -> BrowserSandbox -> Permission Check -> BrowserManager -> Browser Engine */
  // Part 6B / Part A: previously any failure in this pipeline (unknown
  // tool, missing BrowserManager, sandbox rejection, or a handler that
  // throws synchronously) propagated as a rejected promise. A caller
  // (BrowserAgent, Automation step) that didn't attach a .catch() would
  // produce an uncaught rejection instead of a recoverable result. Every
  // failure path now resolves a standardized
  // { ok:false, code, reason, tool } envelope instead of rejecting, and
  // the tool handler call itself is guarded so a bug inside a handler
  // can't crash the caller either.
  function toolErrEnvelope(code, reason, toolName) {
    return { ok: false, code: code, reason: reason, error: reason, tool: toolName };
  }

  function executeTool(toolName, params, context) {
    params = params || {};
    context = context || {};

    return Promise.resolve().then(function () {
      if (!hasTool(toolName)) {
        return toolErrEnvelope('tool_not_found', 'Tool "' + toolName + '" is not registered in BrowserToolRegistry.', toolName);
      }

      var tool = toolRegistry.get(toolName);
      var sb = getSandbox();
      var bm = getManager();

      if (!bm) {
        return toolErrEnvelope('manager_unavailable', 'BrowserManager is unavailable.', toolName);
      }

      // Step 1: Sandbox & URL Validation (if URL is present in params)
      if (sb && params.url) {
        var val;
        try {
          val = sb.validateUrl(params.url);
        } catch (e) {
          return toolErrEnvelope('sandbox_exception', 'BrowserSandbox threw during URL validation: ' + e.message, toolName);
        }
        if (!val.valid) {
          return toolErrEnvelope('sandbox_rejected', 'BrowserSandbox validation failed: ' + val.reason, toolName);
        }
        params.url = val.sanitizedUrl || params.url;
      }

      // Step 2: Permission Check Layer
      if (sb && typeof sb.checkPermission === 'function') {
        var action = toolName.replace('browser_', '').replace(/_/g, ':');
        var perm;
        try {
          perm = sb.checkPermission(action, { url: params.url, scope: context.scope });
        } catch (e) {
          return toolErrEnvelope('permission_exception', 'Permission check threw: ' + e.message, toolName);
        }
        if (!perm.ok) {
          return toolErrEnvelope('permission_denied', 'Permission Check failed: ' + perm.reason, toolName);
        }
      }

      // Step 3: Dispatch to BrowserManager -> Browser Engine
      try {
        return Promise.resolve(tool.handler(params, bm)).catch(function (e) {
          log('error', 'Tool handler rejected for "' + toolName + '"', e);
          return toolErrEnvelope('handler_rejected', (e && e.message) || String(e), toolName);
        });
      } catch (e) {
        log('error', 'Tool handler threw synchronously for "' + toolName + '"', e);
        return toolErrEnvelope('handler_exception', (e && e.message) || String(e), toolName);
      }
    }).catch(function (e) {
      // Final safety net — should be unreachable given the guards above,
      // but guarantees executeTool() never rejects.
      log('error', 'Unhandled exception in executeTool for "' + toolName + '"', e);
      return toolErrEnvelope('unhandled_exception', (e && e.message) || String(e), toolName);
    });
  }

  /* ---------------- Public Surface ---------------- */
  var Registry = {
    // Capability Discovery Methods
    getTools: getTools,
    listTools: listTools,
    getSchema: getSchema,
    hasTool: hasTool,

    // Registration & Execution
    registerTool: registerTool,
    executeTool: executeTool
  };

  global.AxiomBrowserToolRegistry = Registry;
  global.BrowserToolRegistry = Registry;

  log('info', 'BrowserToolRegistry initialized with ' + toolRegistry.size + ' tools.');
})(typeof window !== 'undefined' ? window : this);
