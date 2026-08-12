// ============================================
// AXIOM — Shared dialogs (toast / confirm / prompt)
// Provides in-app replacements for window.alert/confirm/prompt, built
// entirely on top of the .toast-stack/.toast and .ax-modal-overlay/
// .ax-modal(-head/body/foot) CSS already defined once in
// styles/ax-redesign.css. No new visual language — same overlay blur,
// same panel radius/shadow, same .btn button classes used by every
// existing modal (e.g. agent-library.html's #agentEditor).
//
// Loaded standalone on pages that don't already define showToast via
// app.js (billing/brain/playground/settings/studios keep using their
// existing app.js showToast — this file only fills in showToast where
// it's missing, and always adds confirmDialog/promptDialog, which no
// page previously had).
// ============================================
(function () {
  'use strict';

  // -------------------- Toast --------------------
  // Same DOM shape/classes as app.js's showToast (.toast-stack > .toast),
  // so pages that load both never end up with two competing toast styles.
  if (typeof window.showToast !== 'function') {
    window.showToast = function showToast(message, variant) {
      let stack = document.querySelector('.toast-stack');
      if (!stack) {
        stack = document.createElement('div');
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
      }
      const toast = document.createElement('div');
      toast.className = variant ? `toast ${variant}` : 'toast';
      toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const span = document.createElement('span');
      span.textContent = message;
      toast.appendChild(span);
      stack.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'opacity .25s, transform .25s';
        setTimeout(() => toast.remove(), 250);
      }, 2600);
    };
  }

  // -------------------- Confirm / Prompt shared modal --------------------
  // Both build on the same .ax-modal-overlay/.ax-modal markup pattern as
  // agent-library.html's #agentEditor, so they inherit that component's
  // entrance animation, blur, radius, and shadow with zero new CSS.
  function openDialogModal(bodyHtml, { title, confirmLabel, cancelLabel, destructive, focusSelector }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ax-modal-overlay';
      overlay.innerHTML = `
        <div class="ax-modal" role="dialog" aria-modal="true" aria-label="${title}">
          <header class="ax-modal-head"><h3 style="margin:0;font-size:1rem;">${title}</h3></header>
          <div class="ax-modal-body">${bodyHtml}</div>
          <footer class="ax-modal-foot">
            <button type="button" class="btn btn-outline" data-ax-dialog-cancel>${cancelLabel}</button>
            <button type="button" class="btn ${destructive ? 'btn-outline' : 'btn-solid'}" data-ax-dialog-confirm${destructive ? ' style="color:var(--ax-error,#EF4444);border-color:var(--ax-error,#EF4444);"' : ''}>${confirmLabel}</button>
          </footer>
        </div>`;
      document.body.appendChild(overlay);

      const dialogEl = overlay.querySelector('.ax-modal');
      const confirmBtn = overlay.querySelector('[data-ax-dialog-confirm]');
      const cancelBtn = overlay.querySelector('[data-ax-dialog-cancel]');
      const focusTarget = focusSelector ? overlay.querySelector(focusSelector) : confirmBtn;
      (focusTarget || confirmBtn).focus();

      // Keeps Tab cycling inside the dialog and restores focus to
      // whatever triggered it once closed (window.AxiomA11y comes
      // from accessibility.js, loaded on every page).
      const releaseFocusTrap = window.AxiomA11y ? window.AxiomA11y.trapFocus(dialogEl) : function () {};

      function close(result) {
        document.removeEventListener('keydown', onKeydown);
        releaseFocusTrap();
        overlay.remove();
        resolve(result);
      }
      function onKeydown(e) {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          confirmBtn.click();
        }
      }
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      cancelBtn.addEventListener('click', () => close(false));
      confirmBtn.addEventListener('click', () => {
        if (focusSelector) {
          const input = overlay.querySelector(focusSelector);
          close(input ? input.value : true);
        } else {
          close(true);
        }
      });
      document.addEventListener('keydown', onKeydown);
    });
  }

  // In-app replacement for window.confirm(). Resolves true/false.
  window.confirmDialog = function confirmDialog(message, opts) {
    opts = opts || {};
    const safeMessage = String(message).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return openDialogModal(`<p style="margin:0;color:var(--ax-text-secondary,rgba(255,255,255,.7));">${safeMessage}</p>`, {
      title: opts.title || 'Please confirm',
      confirmLabel: opts.confirmLabel || 'Confirm',
      cancelLabel: opts.cancelLabel || 'Cancel',
      destructive: !!opts.destructive,
    });
  };

  // In-app replacement for window.prompt(). Resolves the entered string,
  // or null if cancelled — same contract as window.prompt.
  window.promptDialog = function promptDialog(message, defaultValue, opts) {
    opts = opts || {};
    const safeMessage = String(message).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const safeDefault = String(defaultValue == null ? '' : defaultValue).replace(/"/g, '&quot;');
    const body = `
      <label style="display:block;font-size:.82rem;color:var(--ax-text-secondary,rgba(255,255,255,.6));margin-bottom:8px;">${safeMessage}</label>
      <input type="text" id="axDialogPromptInput" value="${safeDefault}" style="width:100%;">
    `;
    return openDialogModal(body, {
      title: opts.title || 'Enter a value',
      confirmLabel: opts.confirmLabel || 'OK',
      cancelLabel: opts.cancelLabel || 'Cancel',
      focusSelector: '#axDialogPromptInput',
    }).then((result) => {
      if (result === false) return null;
      const trimmed = typeof result === 'string' ? result.trim() : '';
      return trimmed === '' ? null : trimmed;
    });
  };
})();
