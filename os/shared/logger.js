// ============================================================
// AXIOM AI OS — Shared Logger
// ------------------------------------------------------------
// Phase 8 Part 2 (Code Quality & Maintainability): a single,
// consistent choke point for the console.log/warn/error calls that
// were previously scattered across os/runtime/**. Every call site
// this was applied to keeps the exact same arguments it always
// passed to console.* — this file only centralizes where those
// calls go, it does not change what gets logged or when.
//
// Why this exists:
// - One place to add a level filter or a "silence in production"
//   switch later, instead of editing 30+ files.
// - One place that guards against environments where `console`
//   itself is missing or partially implemented (some embed/test
//   contexts), instead of every call site needing its own guard.
//
// Exposes window.AxLogger with the same three methods every
// call site already called on `console`: log, warn, error.
// Must load before any file that references AxLogger — see
// os-shell.html (and the other page templates) for placement,
// immediately before the os/runtime/* script block.
// ============================================================
(function (global) {
  'use strict';

  function safeConsoleCall(method, args) {
    try {
      if (global.console && typeof global.console[method] === 'function') {
        global.console[method].apply(global.console, args);
      }
    } catch (e) {
      // Logging must never be the thing that breaks the app.
    }
  }

  global.AxLogger = {
    log: function () { safeConsoleCall('log', arguments); },
    warn: function () { safeConsoleCall('warn', arguments); },
    error: function () { safeConsoleCall('error', arguments); }
  };
})(window);
