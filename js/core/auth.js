// ============================================
// AXIOM — Auth logic (Supabase)
// Loaded on every page after supabase-config.js.
// Handles: login/register form submits, logout, route protection
// for app pages, and populating the sidebar with real user data.
// ============================================

function authError(message) {
  let box = document.getElementById('authError');
  if (!box) return typeof showToast === 'function' ? showToast(message, 'error') : alert(message);
  box.textContent = message;
  box.style.display = 'block';
}
function clearAuthError() {
  const box = document.getElementById('authError');
  if (box) box.style.display = 'none';
}
function setBtnLoading(btn, loading, loadingText) {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = loadingText || 'Please wait…';
    btn.disabled = true;
    btn.style.opacity = '.7';
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
    btn.style.opacity = '';
  }
}

// Always use the current deployed origin for email confirmation redirects.
// This prevents old/local development URLs from being embedded in signup
// confirmation emails when Axiom is running on Vercel.
function getAuthRedirectUrl() {
  return new URL('os-shell.html', window.location.origin).href;
}

// ============================================
// Register page
// ============================================
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const fullName = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const submitBtn = registerForm.querySelector('button[type="submit"]');

    if (password.length < 6) {
      authError('Password must be at least 6 characters.');
      return;
    }

    setBtnLoading(submitBtn, true, 'Creating account…');
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        // Explicit production redirect. Do not rely only on Supabase's
        // project-wide Site URL, because this app is also used locally.
        emailRedirectTo: getAuthRedirectUrl()
      }
    });
    setBtnLoading(submitBtn, false);

    if (error) {
      authError(error.message);
      return;
    }
    if (data.session) {
      window.location.href = getAuthRedirectUrl();
    } else {
      const card = document.querySelector('.auth-card');
      if (card) {
        card.innerHTML = `
          <div class="auth-head">
            <div class="auth-logo"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <p class="auth-eyebrow">Almost there</p>
            <h1>Check your inbox</h1>
            <p>We sent a confirmation link to <strong style="color:var(--text-hi)">${email}</strong>. Click it to activate your account.</p>
          </div>
          <div class="auth-foot"><a href="login.html">Back to sign in</a></div>
        `;
      }
    }
  });
}

// ============================================
// Login page
// ============================================
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const submitBtn = loginForm.querySelector('button[type="submit"]');

    setBtnLoading(submitBtn, true, 'Signing in…');
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    setBtnLoading(submitBtn, false);

    if (error) {
      if (/email not confirmed/i.test(error.message || '')) {
        authError('Your email is not confirmed yet. Open the latest Axiom confirmation email and click the confirmation link.');
      } else {
        authError(error.message);
      }
      return;
    }
    window.location.href = getAuthRedirectUrl();
  });
}

// ============================================
// OAuth buttons (login + register pages)
// ============================================
document.querySelectorAll('[data-oauth]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.oauth;
    await supabaseClient.auth.signInWithOAuth({
      provider,
      options: { redirectTo: getAuthRedirectUrl() }
    });
  });
});

// ============================================
// Logout (any page with a [data-logout] element)
// ============================================
document.querySelectorAll('[data-logout]').forEach(el => {
  el.addEventListener('click', async (e) => {
    e.preventDefault();
    if (supabaseClient && supabaseClient.auth) {
      try {
        await supabaseClient.auth.signOut();
      } catch (_) {}
    }
    window.location.href = 'index.html';
  });
});

// ============================================
// Route protection + sidebar user data for app pages
// Add data-require-auth to <body> on dashboard/playground/billing/settings
// ============================================
async function guardAndPopulate() {
  // Local dev preview: skip Supabase entirely and render with a mock
  // profile. See dev-config.js — this branch can never run on a real
  // deployed domain, only localhost/127.0.0.1/file://.
  if (typeof AXIOM_DEV_MODE !== 'undefined' && AXIOM_DEV_MODE) {
    const user = { email: AXIOM_DEV_PROFILE.email };
    const profile = AXIOM_DEV_PROFILE;
    renderAppShell(user, profile);
    return;
  }

  if (!supabaseClient || !supabaseClient.auth) {
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  const user = session.user;
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('full_name, avatar_url, plan, credits, role')
    .eq('id', user.id)
    .single();
  renderAppShell(user, profile);
}

function renderAppShell(user, profile) {

  // Admin-only pages: gate BEFORE anything else renders. The page markup
  // keeps its main content hidden (style="display:none") until this check
  // passes, so a non-admin never sees a flash of admin data.
  if (document.body.hasAttribute('data-require-admin') && profile?.role !== 'admin') {
    window.location.href = 'index.html';
    return;
  }
  // Reveals the page body once the auth/role check above has passed. Most
  // pages' .app-body has no inline display:none (nothing to hide pre-auth),
  // so this is a no-op for them — admin.html is the one page that starts
  // hidden via style="display:none" to avoid a flash of admin content.
  document.querySelectorAll('.app-shell, .app-body').forEach(el => { el.style.display = ''; });

  const displayName = profile?.full_name || user.email.split('@')[0];
  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const planLabel = { free: 'Studio', starter: 'Starter', pro: 'Pro', creator: 'Creator' }[profile?.plan] || 'Studio';

  window.AxiomProfile = profile || null;
  document.dispatchEvent(new CustomEvent('axiom:profile-ready', { detail: profile || null }));

  document.querySelectorAll('.app-user-name').forEach(el => el.textContent = displayName);
  document.querySelectorAll('.app-user-plan').forEach(el => el.textContent = planLabel);
  document.querySelectorAll('.app-avatar').forEach(el => { if (!el.querySelector('img')) el.textContent = initials; });
  document.querySelectorAll('[data-user-email]').forEach(el => el.textContent = user.email);
  document.querySelectorAll('[data-user-credits]').forEach(el => el.textContent = (profile?.credits ?? 0).toLocaleString());

  // Credit bar fill — percentage of the plan's monthly allotment
  const planCaps = { free: 50, starter: 1200, pro: 4000, creator: 12000 };
  const cap = planCaps[profile?.plan] || 50;
  const pct = Math.max(0, Math.min(100, Math.round(((profile?.credits ?? 0) / cap) * 100)));
  document.querySelectorAll('[data-credit-bar-fill]').forEach(el => el.style.width = pct + '%');

  // Billing page: reflect the real plan on the summary card + tier cards
  const planCardName = document.getElementById('planCardName');
  const planCardPrice = document.getElementById('planCardPrice');
  const planPrices = { free: 'Free forever', starter: '₹99/mo', pro: '₹299/mo', creator: '₹799/mo' };
  if (planCardName && planCardPrice) {
    planCardName.textContent = planLabel;
    planCardPrice.textContent = planPrices[profile?.plan] || 'Free forever';
  }

  // Mark the active subscription tier card as current, disable its own button
  document.querySelectorAll('[data-tier-checkout]').forEach(btn => {
    const card = btn.closest('.price-card');
    const badge = card?.querySelector('.price-badge');
    if (btn.dataset.tierCheckout === profile?.plan) {
      if (badge) badge.style.display = '';
      btn.textContent = 'Current plan';
      btn.disabled = true;
      btn.style.opacity = '.6';
      btn.style.cursor = 'default';
    }
  });
}

if (document.body.hasAttribute('data-require-auth')) {
  guardAndPopulate();
}

// ============================================
// Marketing nav (index.html): swap Sign in/Get started
// for a Dashboard link when a session already exists
// ============================================
async function reflectAuthStateOnMarketingNav() {
  const ctaBox = document.querySelector('.nav-cta');
  if (!ctaBox || !supabaseClient || !supabaseClient.auth) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      ctaBox.innerHTML = `<a href="os-shell.html" class="btn btn-solid">Go to OS Shell</a>`;
    }
  } catch (_) {}
}
if (document.querySelector('.nav-cta') && !document.body.hasAttribute('data-require-auth')) {
  reflectAuthStateOnMarketingNav();
}
