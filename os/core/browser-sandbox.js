// ============================================================
// AXIOM — Block 2 / Step 5 / Part 5: Browser Security & Sandbox
// ------------------------------------------------------------
// Centralized security guardrails and permission enforcement layer
// for all browser operations.
//
// Execution Flow:
//   BrowserToolRegistry -> BrowserSandbox -> Permission Check -> BrowserManager -> BrowserEngine
//
// Features:
//   - Protocol Allowlist (http:, https:, about:blank, axiom:)
//   - Hazardous URI Scheme Blocking (javascript:, data:, file:, vbscript:, blob:)
//   - Permission Check Layer (grant, revoke, verify permissions by action & scope)
//   - Origin & Input Sanitization
// ============================================================
(function (global) {
  'use strict';

  const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'about:', 'axiom:']);
  const BLOCKED_SCHEMES = /^\s*(javascript|data|file|vbscript|blob):/i;

  // Lightweight permission store
  const permissions = new Map(); // permissionKey -> { level: 'allow'|'deny'|'prompt', scope: string, timestamp: number }

  function log(method, message, detail) {
    const l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[BrowserSandbox] ' + message, detail !== undefined ? detail : '');
    }
  }

  /* ---------------- URL Validation & Sanitization ---------------- */
  function validateUrl(input) {
    if (!input || typeof input !== 'string') {
      return { valid: false, reason: 'URL must be a non-empty string', sanitizedUrl: null };
    }

    const trimmed = input.trim();

    // Block dangerous schemes
    if (BLOCKED_SCHEMES.test(trimmed)) {
      log('warn', 'Blocked dangerous URI scheme', trimmed);
      return { valid: false, reason: 'Disallowed protocol or unsafe scheme', sanitizedUrl: null };
    }

    // Handle special cases
    if (trimmed === 'about:blank' || trimmed.startsWith('axiom:')) {
      return { valid: true, reason: null, sanitizedUrl: trimmed };
    }

    // Normalize protocol
    let candidate = trimmed;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
      candidate = 'https://' + candidate;
    }

    try {
      const parsed = new URL(candidate);
      if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        return { valid: false, reason: 'Protocol "' + parsed.protocol + '" is not in the allowlist', sanitizedUrl: null };
      }
      return { valid: true, reason: null, sanitizedUrl: parsed.href };
    } catch (e) {
      return { valid: false, reason: 'Invalid URL format: ' + e.message, sanitizedUrl: null };
    }
  }

  /* ---------------- Permission System ---------------- */
  function getPermissionKey(action, scope) {
    return (action || 'default') + ':' + (scope || 'global');
  }

  function grantPermission(action, scope, level) {
    const key = getPermissionKey(action, scope);
    permissions.set(key, {
      level: level || 'allow',
      action: action,
      scope: scope || 'global',
      timestamp: Date.now()
    });
    log('info', 'Permission granted: ' + key + ' [' + (level || 'allow') + ']');
    return true;
  }

  function revokePermission(action, scope) {
    const key = getPermissionKey(action, scope);
    const deleted = permissions.delete(key);
    if (deleted) log('info', 'Permission revoked: ' + key);
    return deleted;
  }

  function hasPermission(action, scope) {
    const key = getPermissionKey(action, scope);
    if (permissions.has(key)) {
      const p = permissions.get(key);
      return p.level === 'allow';
    }
    // Specific check fallback to global default allow for non-destructive actions
    const globalKey = getPermissionKey(action, 'global');
    if (permissions.has(globalKey)) {
      return permissions.get(globalKey).level === 'allow';
    }

    // Default policy: restricted actions require explicit permission, standard actions allowed
    const RESTRICTED_ACTIONS = new Set(['history:clear', 'session:close-all', 'storage:purge']);
    if (RESTRICTED_ACTIONS.has(action)) {
      return false;
    }
    return true;
  }

  function checkPermission(action, context) {
    context = context || {};
    const scope = context.scope || context.url || 'global';
    const allowed = hasPermission(action, scope);
    if (!allowed) {
      log('warn', 'Permission denied for action "' + action + '" under scope "' + scope + '"');
      return { ok: false, reason: 'Permission denied for action "' + action + '"' };
    }
    return { ok: true, reason: null };
  }

  /* ---------------- Origin Validation ---------------- */
  function validateOrigin(origin) {
    if (!origin || typeof origin !== 'string') return false;
    try {
      const parsed = new URL(origin);
      return ALLOWED_PROTOCOLS.has(parsed.protocol);
    } catch (e) {
      return false;
    }
  }

  /* ---------------- Public Surface ---------------- */
  const Sandbox = {
    validateUrl: validateUrl,
    validateOrigin: validateOrigin,
    grantPermission: grantPermission,
    revokePermission: revokePermission,
    hasPermission: hasPermission,
    checkPermission: checkPermission,
    ALLOWED_PROTOCOLS: Array.from(ALLOWED_PROTOCOLS)
  };

  global.AxiomBrowserSandbox = Sandbox;
  global.BrowserSandbox = Sandbox;

  log('info', 'BrowserSandbox security layer initialized.');
})(typeof window !== 'undefined' ? window : this);
