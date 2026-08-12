// ============================================================
// AXIOM — Accessibility Foundation (Phase 7, Part 1)
// ------------------------------------------------------------
// Small, additive, page-agnostic behaviors that make existing
// markup keyboard-operable without touching any feature's own
// JS. Loaded last on every page. Nothing here changes what a
// mouse/touch user sees or how any existing feature behaves.
//
// What this file does:
//   1. Lets any element marked role="button" (the app uses several
//      non-<button> elements — topbar icons, dock triggers — as
//      click targets) respond to Enter/Space like a real button.
//   2. Provides window.AxiomA11y.trapFocus(container) — a small
//      reusable Tab-cycle trap that dialog/menu code can opt into.
//   3. Announces toast/status messages to screen readers via a
//      shared aria-live region, for any code that writes into
//      .toast-stack without its own live region.
// ============================================================
(function () {
  'use strict';

  // ---- 1. Enter/Space activates role="button" elements ----
  // Native <button>/<a href> already do this; this only matters
  // for the handful of <div>/<span> elements in the topbar/dock
  // markup that are click targets. Delegated listener, so it
  // keeps working for anything injected later (modals, panels).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const target = e.target.closest('[role="button"]');
    if (!target) return;
    // Don't hijack Space/Enter inside form controls that happen to
    // sit inside a role="button" ancestor (there aren't any today,
    // but this keeps the behavior safe if that ever changes).
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    target.click();
  });

  // ---- 2. Reusable focus trap for dialogs/menus ----
  // Usage: const release = AxiomA11y.trapFocus(dialogEl);
  //        ...later, on close: release();
  // Keeps Tab/Shift+Tab cycling within `container` and restores
  // focus to whatever was focused before the trap was created.
  function trapFocus(container) {
    if (!container) return function release() {};
    const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const previouslyFocused = document.activeElement;

    function getFocusable() {
      return Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE))
        .filter(function (el) { return el.offsetParent !== null; });
    }

    function onKeydown(e) {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', onKeydown);

    return function release() {
      container.removeEventListener('keydown', onKeydown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }

  // ---- 3. Shared live region for status/toast messages ----
  // ax-dialogs.js's showToast already writes visible toast text;
  // this mirrors new toast text into an off-screen aria-live
  // region so screen reader users hear it too, without changing
  // the toast markup/animation itself.
  let liveRegion = null;
  function getLiveRegion() {
    if (liveRegion) return liveRegion;
    liveRegion = document.createElement('div');
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.id = 'axLiveRegion';
    document.body.appendChild(liveRegion);
    return liveRegion;
  }

  function announce(message) {
    if (!message) return;
    const region = getLiveRegion();
    region.textContent = '';
    // Re-set on next tick so repeated identical messages still fire
    // a fresh announcement in every screen reader.
    window.setTimeout(function () { region.textContent = message; }, 30);
  }

  // Watch .toast-stack for new toasts (created by showToast in
  // components/ax-dialogs.js or app.js) and announce their text,
  // instead of editing every call site that raises a toast.
  function observeToasts() {
    const stack = document.querySelector('.toast-stack');
    if (!stack) return;
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 1 && node.classList && node.classList.contains('toast')) {
            announce(node.textContent.trim());
          }
        });
      });
    });
    observer.observe(stack, { childList: true });
  }

  // The toast stack is created lazily on first showToast() call,
  // so also watch <body> for it appearing, then switch to the
  // lighter-weight observer above.
  const bodyObserver = new MutationObserver(function () {
    if (document.querySelector('.toast-stack')) {
      observeToasts();
      bodyObserver.disconnect();
    }
  });
  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('.toast-stack')) {
      observeToasts();
    } else {
      bodyObserver.observe(document.body, { childList: true });
    }
  });

  window.AxiomA11y = { trapFocus: trapFocus, announce: announce };
})();
