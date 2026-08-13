// ============================================================
// AXIOM AI OS — Shared Logger
// ============================================================
(function (global) {
  'use strict';

  function safeConsoleCall(method, args) {
    try {
      if (global.console && typeof global.console[method] === 'function') {
        global.console[method].apply(global.console, args);
      }
    } catch (e) {}
  }

  global.AxLogger = {
    log: function () { safeConsoleCall('log', arguments); },
    warn: function () { safeConsoleCall('warn', arguments); },
    error: function () { safeConsoleCall('error', arguments); }
  };

  // The OS shell already has a single #axDock mount point. Load the exact
  // workspace Dock implementation after the deferred shell scripts have run,
  // so the shell's generated Dock is replaced by the shared Dock rather than
  // maintaining a second visual implementation.
  if (document && document.documentElement) {
    const loadGlobalDock = function () {
      if (!document.getElementById('axDock')) return;
      if (document.querySelector('script[data-axiom-global-dock]')) return;
      const script = document.createElement('script');
      script.src = 'js/core/global-dock.js';
      script.dataset.axiomGlobalDock = 'true';
      document.body.appendChild(script);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadGlobalDock, { once: true });
    } else {
      loadGlobalDock();
    }
  }
})(window);
