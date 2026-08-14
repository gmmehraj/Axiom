// ============================================================
// AXIOM — Application Manifest (Milestone 1: Architecture Stabilization)
// ------------------------------------------------------------
// Single source of truth for what every page in the project is:
// the canonical OS Shell, a pre-auth standalone entry point, a
// page that should become a workspace module, or a page whose
// fate is not yet decided.
//
// This file is ADDITIVE ONLY. As of Milestone 1, nothing reads
// from it yet — workspace-manager.js still uses its own internal
// WORKSPACES table, os-shell.js still uses its own dock config.
// Milestone 2 is where workspace-manager.js gets pointed at this
// file instead of guessing. Loading this file today changes no
// existing behavior; it exists so that decision is written down
// once, in code, instead of living only in an audit doc.
//
// role values:
//   'primary'                — the canonical application (os-shell.html)
//   'standalone'              — intentionally not part of the OS Shell
//   'workspace'                — should become/already is a workspace module
//   'standalone-recommended'   — could be a workspace, but flagged reasons
//                                 argue for keeping it a direct navigation
//   'unresolved'                — not enough evidence to decide; do not
//                                 guess, do not build against this yet
//
// status values (role: 'workspace' only):
//   'integrated'    — a real os/workspaces/{id}.js module exists and works
//   'needs-rework'  — a module exists but is placeholder/hardcoded data,
//                     not wired to the page's real logic
//   'pending'       — no module exists yet
// ============================================================
window.AxiomAppManifest = {
  version: 2,
  milestone: 'Milestone 2 — Workspace Integration',

  pages: {
    'index.html': {
      role: 'standalone',
      reason: 'Pre-auth marketing/landing page. Must remain reachable before login.'
    },
    'login.html': {
      role: 'standalone',
      reason: 'Pre-auth. Cannot live inside the OS Shell, which requires auth.'
    },
    'register.html': {
      role: 'standalone',
      reason: 'Pre-auth. Same constraint as login.html.'
    },

    'os-shell.html': {
      role: 'primary',
      reason: 'Confirmed canonical application: auth.js redirects here after ' +
              'login, signup, and OAuth (3 call sites). No change required — ' +
              'it already is the primary entry point post-auth.'
    },

    'playground.html': {
      role: 'workspace',
      workspaceId: 'chat',
      status: 'integrated',
      reason: 'Already wired: os/workspaces/chat.js embeds this page via ' +
              'iframe inside a shell window. This is the precedent pattern ' +
              'Milestone 2 should follow for the other "pending" pages below.'
    },

    'workspace.html': {
      role: 'workspace',
      workspaceId: 'files',
      status: 'pending',
      reason: 'os-shell.js declares a "files" dock id; no os/workspaces/files.js ' +
              'exists yet. Not one of the 5 priority pages for Milestone 2 — ' +
              'still a candidate for the same iframe pattern as chat.js, deferred ' +
              'to a future milestone.'
    },
    'browser.html': {
      role: 'workspace',
      workspaceId: 'browser',
      status: 'integrated',
      reason: 'Milestone 2: os/workspaces/browser.js created, following the ' +
              'chat.js iframe-embed precedent exactly. Embeds browser.html ' +
              '(and its real browser-studio-ultimate.js logic) unmodified — ' +
              'no rewritten functionality, no placeholder data.'
    },
    'analytics.html': {
      role: 'workspace',
      workspaceId: 'analytics',
      status: 'integrated',
      reason: 'Milestone 2: os/workspaces/analytics.js created, following the ' +
              'chat.js iframe-embed precedent exactly. Embeds analytics.html ' +
              '(and its real analytics-automation-ultimate.js logic) unmodified.'
    },
    'automation.html': {
      role: 'workspace',
      workspaceId: 'automation',
      status: 'integrated',
      reason: 'Milestone 2: os/workspaces/automation.js created, following the ' +
              'chat.js iframe-embed precedent exactly. Embeds automation.html ' +
              '(and its real automation-part9.js logic) unmodified.'
    },
    'agent-library.html': {
      role: 'workspace',
      workspaceId: 'agents',
      status: 'integrated',
      reason: 'Milestone 2: os/workspaces/agents.js created, following the ' +
              'chat.js iframe-embed precedent exactly. Embeds agent-library.html ' +
              '(and its real agent-library.js / agents-catalog.js logic) unmodified.'
    },
    'settings.html': {
      role: 'workspace',
      workspaceId: 'settings',
      status: 'integrated',
      reason: 'Milestone 2: os/workspaces/settings.js created, following the ' +
              'chat.js iframe-embed precedent exactly. Embeds settings.html ' +
              '(and its real settings-billing-ultimate.js / settings-i18n.js ' +
              'logic) unmodified.'
    },

    'memory.html': {
      role: 'workspace',
      workspaceId: 'memory',
      status: 'needs-rework',
      reason: 'os/workspaces/memory.js exists and loads, but renders hardcoded ' +
              'placeholder numbers (e.g. "248" memory items) instead of the ' +
              'real memory-ultimate.js system this page actually runs. Works, ' +
              'but is showing fake data today — flagged for Milestone 2.'
    },
    'brain.html': {
      role: 'workspace',
      workspaceId: 'brain',
      status: 'needs-rework',
      reason: 'os/workspaces/brain.js exists and loads, but renders hardcoded ' +
              'placeholder numbers (e.g. "98.2%" confidence) instead of the ' +
              'real brain-ultimate.js system this page actually runs. Same ' +
              'issue as memory.html — flagged for Milestone 2.'
    },

    'billing.html': {
      role: 'standalone-recommended',
      workspaceId: 'billing',
      status: 'flagged',
      reason: 'Drives a Razorpay checkout flow. Embedding a payment page in an ' +
              'iframe window has real UX/security tradeoffs (third-party popups, ' +
              'redirect handling). Recommend keeping this a direct navigation ' +
              '(opened in a new tab from a dock launcher) rather than an ' +
              'embedded workspace module. Needs explicit product/security ' +
              'sign-off before Milestone 2 treats it like the others.'
    },

    'admin.html': {
      role: 'standalone',
      reason: 'No "admin" workspace id was ever declared in os-shell.js\'s ' +
              'dock or command palette config (checked directly against the ' +
              'source). Read as an intentional exclusion — an admin console ' +
              'kept outside the general-user OS Shell dock, not an oversight. ' +
              'Left as its own direct route.'
    },

    'studios.html': {
      role: 'unresolved',
      reason: 'Shares browser-studio-ultimate.js with browser.html (same ' +
              'underlying logic module, two different page shells around it). ' +
              'Not enough evidence to tell whether this is a true duplicate of ' +
              'the Browser workspace or a distinct Studios feature that should ' +
              'map to its own workspace id. Do not guess — needs a human call ' +
              'before Milestone 2 builds or deprecates anything against it.'
    }
  }
};

// ============================================================
// OS PERFORMANCE BOOTSTRAP
// ------------------------------------------------------------
// This is intentionally tiny and additive. It keeps Axiom's existing
// architecture and visual system intact while reducing the two most
// common sources of desktop-shell jank: oversized HiDPI canvas backing
// stores and expensive glass effects on constrained devices.
// It does not replace or modify any AI/backend/workspace subsystem.
// ============================================================
(function axiomPerformanceBootstrap() {
  'use strict';

  if (!document.body || !document.body.classList.contains('ax-os-active')) return;

  const root = document.documentElement;
  const nav = navigator || {};
  const cores = Number(nav.hardwareConcurrency || 8);
  const memory = Number(nav.deviceMemory || 8);
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  // Cap only the OS Shell's canvas pixel ratio. A 2x/3x backing store can
  // multiply every canvas pixel operation while the CSS size stays the same.
  // Keep the cap conservative so the Core remains crisp.
  const nativeDpr = Number(window.devicePixelRatio || 1);
  const cap = (reduced || cores <= 4 || memory <= 4 || coarse) ? 1.25 : 1.5;
  const renderDpr = Math.min(nativeDpr, cap);
  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      get: () => renderDpr
    });
  } catch (e) {
    // Some browsers expose devicePixelRatio as non-configurable. Continue
    // without changing it; the rest of the performance layer still applies.
  }

  root.dataset.axPerformance = (reduced || cores <= 4 || memory <= 4) ? 'conserve' : 'balanced';

  // Keep expensive decorative layers composited and reduce blur cost only
  // on constrained devices. The layout and visual identity are unchanged.
  const style = document.createElement('style');
  style.id = 'ax-performance-runtime';
  style.textContent = `
    .ax-os #axiomCore,
    .ax-os .ax-core,
    .ax-os .ax-dock,
    .ax-os .ax-topbar,
    .ax-os .ax-control-center,
    .ax-os .ax-notif-panel {
      contain: layout paint;
    }
    .ax-os #axiomCore canvas {
      display: block;
      max-width: 100%;
    }
    html[data-ax-performance="conserve"] .ax-os .ax-glass,
    html[data-ax-performance="conserve"] .ax-os .ax-glass-deep,
    html[data-ax-performance="conserve"] .ax-os .ax-glass-shadow {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-ax-performance="conserve"] .ax-os .ax-os-aurora {
      opacity: .45;
    }
    @media (prefers-reduced-motion: reduce) {
      .ax-os #axiomCore canvas { visibility: hidden; }
    }
  `;
  document.head.appendChild(style);
})();
