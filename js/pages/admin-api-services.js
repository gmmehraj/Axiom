// ============================================================
// AXIOM — Admin: API & Services (Owner Access)
// Loaded on admin.html only, after auth.js has already gated the page to
// admin users (data-require-admin, same as js/pages/admin.js) and after
// supabase-config.js has established the bare `supabaseClient` /
// `SUPABASE_URL` / `SUPABASE_ANON_KEY` identifiers this file reads.
//
// This file is a thin status client. All real checks — including
// whether OPENROUTER_API_KEY / SUPABASE_SERVICE_ROLE_KEY are configured
// — happen server-side in supabase/functions/owner-api-status, which
// re-checks admin authorization itself (profiles.role === 'admin') via
// a service-role client. This file never receives, stores, or displays
// either secret; only client-safe SUPABASE_URL / SUPABASE_ANON_KEY
// (already loaded on every page via js/core/env.config.js) and a fixed
// set of safe status strings.
// ============================================================

(function () {
  'use strict';

  const STATUS_BADGE_CLASS = {
    CONNECTED: 'ax-badge-success',
    CONFIGURED: 'ax-badge-success',
    true: 'ax-badge-success',
    NOT_CONFIGURED: 'ax-badge-warning',
    false: 'ax-badge-warning',
    UNAVAILABLE: 'ax-badge-error',
    AUTHENTICATION_FAILED: 'ax-badge-error',
    RATE_LIMITED: 'ax-badge-warning',
    SERVER_ERROR: 'ax-badge-error',
    UNKNOWN: '',
  };

  const STATUS_LABEL = {
    CONNECTED: 'Connected',
    CONFIGURED: 'Configured',
    true: 'Configured',
    NOT_CONFIGURED: 'Not configured',
    false: 'Not configured',
    UNAVAILABLE: 'Unavailable',
    AUTHENTICATION_FAILED: 'Authentication failed',
    RATE_LIMITED: 'Rate limited',
    SERVER_ERROR: 'Server error',
    UNKNOWN: '—',
  };

  function setBadge(name, statusKey) {
    const el = document.querySelector(`[data-status-badge="${name}"]`);
    if (!el) return;
    const key = statusKey === undefined || statusKey === null ? 'UNKNOWN' : String(statusKey);
    el.className = 'ax-badge ' + (STATUS_BADGE_CLASS[key] || '');
    el.textContent = STATUS_LABEL[key] || key;
  }

  function maskKey(key) {
    if (typeof key !== 'string' || key.length < 12) return key ? '••••••••' : '—';
    return key.slice(0, 6) + '…' + key.slice(-4);
  }

  function renderClientSafeConfig() {
    const urlEl = document.querySelector('[data-supabase-url]');
    const keyEl = document.querySelector('[data-supabase-anon-key]');
    // window.__AXIOM_ENV__ is populated by js/core/env.config.js — the
    // exact same client-safe values every page already loads via
    // js/core/supabase/env.js. Nothing new is exposed here.
    const env = (window.AxiomSupabaseEnv && window.AxiomSupabaseEnv.read()) || {};
    if (urlEl) urlEl.textContent = env.url || 'Not configured';
    if (keyEl) keyEl.textContent = maskKey(env.anonKey);
  }

  async function authHeaders() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      const err = new Error('You need to be signed in to do that.');
      err.code = 'NOT_SIGNED_IN';
      throw err;
    }
    return {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    };
  }

  function endpoint() {
    return `${SUPABASE_URL}/functions/v1/owner-api-status`;
  }

  function setErrorBanner(message) {
    const el = document.querySelector('[data-status-error]');
    if (!el) return;
    if (!message) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.textContent = message;
  }

  function applySupabaseResult(supabase) {
    if (!supabase) return;
    setBadge('supabase-connection', supabase.connection);
    setBadge('supabase-authentication', supabase.authentication);
    setBadge('supabase-database', supabase.database);
    setBadge('supabase-storage', supabase.storage);
    const overall = [supabase.connection, supabase.authentication, supabase.database, supabase.storage].every(
      (s) => s === 'CONNECTED',
    )
      ? 'CONNECTED'
      : 'SERVER_ERROR';
    setBadge('supabase-overall', overall);
    setBadge('health-supabase', supabase.connection);
    setBadge('health-database', supabase.database);
    setBadge('health-storage', supabase.storage);
    setBadge('health-authentication', supabase.authentication);
  }

  function applyOpenRouterResult(openrouter) {
    if (!openrouter) return;
    setBadge('openrouter-key', openrouter.keyConfigured);
    setBadge('openrouter-connection', openrouter.connection);
    setBadge('openrouter-connection-row', openrouter.connection);
    setBadge('health-openrouter', openrouter.connection);
  }

  function applyEdgeFunctionsResult(edgeFunctions) {
    if (!edgeFunctions) return;
    setBadge('edge-openrouter-chat', edgeFunctions['openrouter-chat']);
    setBadge('edge-openrouter-models', edgeFunctions['openrouter-models']);
    setBadge('edge-analyze-file', edgeFunctions['analyze-file']);
    const overall = Object.values(edgeFunctions).every((s) => s === 'CONNECTED') ? 'CONNECTED' : 'NOT_CONFIGURED';
    setBadge('edge-functions-overall', overall);
    setBadge('health-edge-functions', overall);
  }

  async function runCheck(targets, triggerBtn) {
    setErrorBanner(null);
    let originalText;
    if (triggerBtn) {
      originalText = triggerBtn.textContent;
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Testing…';
    }
    try {
      const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
      const res = await fetch(endpoint(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ targets }),
      });

      if (res.status === 403) {
        setErrorBanner('Access denied — this account is not an owner/admin.');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorBanner(body.error || `Status check failed (HTTP ${res.status}).`);
        return;
      }

      const data = await res.json();
      applySupabaseResult(data.supabase);
      applyOpenRouterResult(data.openrouter);
      applyEdgeFunctionsResult(data.edgeFunctions);

      const checkedAtEl = document.querySelector('[data-status-checked-at]');
      if (checkedAtEl && data.checkedAt) {
        const d = new Date(data.checkedAt);
        checkedAtEl.textContent = 'Last checked ' + d.toLocaleTimeString();
      }
    } catch (err) {
      console.error('[admin-api-services] status check failed', err);
      setErrorBanner(err && err.message ? err.message : 'Could not reach the status service.');
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = originalText;
      }
    }
  }

  function wireButtons() {
    document.querySelectorAll('[data-test-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-test-target');
        const targets = target === 'all' ? ['supabase', 'openrouter', 'edge_functions'] : [target];
        runCheck(targets, btn);
      });
    });
  }

  function init() {
    if (!document.body.hasAttribute('data-require-admin')) return;
    if (!document.querySelector('[data-owner-api-section]')) return;

    renderClientSafeConfig();
    wireButtons();

    // Wait for the same auth/role gate admin.js relies on before making
    // any authenticated request.
    document.addEventListener(
      'axiom:profile-ready',
      () => {
        runCheck(['supabase', 'openrouter', 'edge_functions']);
      },
      { once: true },
    );
  }

  init();
})();
