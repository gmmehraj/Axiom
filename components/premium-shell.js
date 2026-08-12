// ============================================
// AXIOM — Premium shell interactions and UI augmentation
// Purely presentational; preserves existing navigation and business logic.
// ============================================
(function () {
  'use strict';

  const NAV_LABELS = new Map([
    ['dashboard.html', 'Home'],
    ['playground.html', 'JARVIS Chat'],
    ['workspace.html', 'Workspace'],
    ['agent-library.html', 'AI Agents'],
    ['billing.html', 'Billing'],
    ['settings.html', 'Settings'],
  ]);

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(() => {
    decorateBody();
    tuneBranding();
    normalizeNavigation();
    populateParticles();
    enhanceTopbar();
    enhanceSidebar();
    hydrateGreeting();
    bindDashboardPrompt();
    restoreDashboardPrompt();
  });

  function decorateBody() {
    const page = pageName();
    if (page === 'dashboard.html') document.body.classList.add('dashboard-page');
    else if (document.body.hasAttribute('data-require-auth')) document.body.classList.add('premium-app-page');
  }

  function pageName() {
    const path = location.pathname.split('/').pop();
    return path || 'dashboard.html';
  }

  function tuneBranding() {
    const logo = document.querySelector('.logo');
    if (!logo || logo.querySelector('.logo-copy')) return;
    const mark = logo.querySelector('.logo-mark');
    const markHtml = mark ? mark.outerHTML : '';
    logo.innerHTML = `${markHtml}<span class="logo-copy"><strong>AXIOM</strong><small>AI STUDIO</small></span>`;

    const greeting = document.querySelector('.dashboard-greeting .eyebrow');
    if (greeting && !greeting.querySelector('.dot')) {
      greeting.innerHTML = '<span class="dot"></span>' + greeting.textContent.trim();
    }
  }

  function normalizeNavigation() {
    document.querySelectorAll('.app-nav-link').forEach((link) => {
      const label = link.querySelector('.label');
      if (!label) return;
      const href = link.getAttribute('href') || '';
      const base = href.split('?')[0];
      if (href === 'playground.html?tool=image') label.textContent = 'Tools';
      else if (href === 'playground.html?tool=voice') label.textContent = 'Voice Studio';
      else if (href === 'settings.html#profile') label.textContent = 'Profile';
      else if (NAV_LABELS.has(base)) label.textContent = NAV_LABELS.get(base);
      else if (/analytics/i.test(label.textContent)) label.textContent = 'Analytics';
      else if (/project/i.test(label.textContent)) label.textContent = 'Projects';
      else if (/memory/i.test(label.textContent)) label.textContent = 'Memory';
      else if (/model/i.test(label.textContent)) label.textContent = 'Models';
    });
  }

  function populateParticles() {
    const holder = document.getElementById('particles');
    if (!holder || holder.childElementCount) return;
    const total = window.innerWidth < 900 ? 34 : 64;
    for (let i = 0; i < total; i += 1) {
      const el = document.createElement('span');
      el.className = 'particle';
      el.style.left = Math.random() * 100 + '%';
      el.style.top = Math.random() * 100 + '%';
      el.style.animationDuration = (18 + Math.random() * 22) + 's';
      el.style.animationDelay = (-Math.random() * 20) + 's';
      el.style.opacity = (0.08 + Math.random() * 0.28).toFixed(2);
      el.style.transform = 'scale(' + (0.45 + Math.random() * 1.7).toFixed(2) + ')';
      holder.appendChild(el);
    }
  }

  function enhanceTopbar() {
    const topbar = document.querySelector('.app-topbar');
    if (!topbar) return;

    const search = topbar.querySelector('.topbar-search');
    if (search) {
      const input = search.querySelector('input');
      if (input && !input.placeholder) input.placeholder = 'Search anything...';
      if (!search.querySelector('kbd')) {
        const kbd = document.createElement('kbd');
        kbd.textContent = '⌘ K';
        search.appendChild(kbd);
      }
    }

    if (topbar.querySelector('.app-topbar-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'app-topbar-actions';
    actions.innerHTML = [
      makeIconButton('Quick action', '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
      makeIconButton('Notifications', '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.7 21a2 2 0 01-3.4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
      makeIconButton('System status', '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.04 1.56V21a2 2 0 01-4 0v-.09A1.7 1.7 0 008.9 19.7a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.56-1.04H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 4.6a1.7 1.7 0 001.04-1.56V3a2 2 0 014 0v.09A1.7 1.7 0 0015.4 4.6a1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 9a1.7 1.7 0 001.56 1.04H21a2 2 0 010 4h-.09A1.7 1.7 0 0019.4 15z" stroke="currentColor" stroke-width="1.4"/>')
    ].join('');
    topbar.appendChild(actions);
  }

  function enhanceSidebar() {
    const sidebar = document.querySelector('.app-sidebar');
    const foot = sidebar && sidebar.querySelector('.app-sidebar-foot');
    if (!sidebar || !foot || foot.querySelector('.app-user-shell')) return;

    const profile = document.createElement('div');
    profile.className = 'app-user-shell';
    const avatar = foot.querySelector('.app-avatar');
    const meta = foot.querySelector('.app-user-meta');
    const logout = foot.querySelector('[data-logout]');
    if (avatar) profile.appendChild(avatar);
    if (meta) profile.appendChild(meta);
    if (logout) profile.appendChild(logout);

    const credits = document.createElement('div');
    credits.className = 'ax-side-card';
    credits.innerHTML = `
      <small>Credits</small>
      <div class="ax-side-metric">
        <div>
          <strong data-user-credits>—</strong>
          <span>/ monthly allocation</span>
        </div>
      </div>
      <div class="credit-bar"><div class="credit-bar-fill" data-credit-bar-fill style="width:0%"></div></div>
    `;

    const system = document.createElement('div');
    system.className = 'ax-side-card';
    system.innerHTML = `
      <small>AXIOM OS</small>
      <div class="ax-side-metric">
        <div>
          <strong style="font-size:1.1rem;">v4.1.0</strong>
          <span>All systems operational</span>
        </div>
      </div>
    `;

    foot.innerHTML = '';
    foot.append(profile, credits, system);

    const syncProfileBits = () => {
      const profileData = window.AxiomProfile || null;
      const name = profile.querySelector('.app-user-name');
      const plan = profile.querySelector('.app-user-plan');
      if (plan) {
        const planText = (plan.textContent || '').trim() || 'Studio Pro';
        plan.innerHTML = `${planText}<span class="plan-pill">PRO</span>`;
      }
      if (name && name.textContent.trim() && !profile.querySelector('.app-user-handle')) {
        const handle = document.createElement('div');
        handle.className = 'app-user-handle';
        handle.textContent = (window.AxiomProfile && window.AxiomProfile.email) || 'godlike@axiom.studio';
        plan && plan.after(handle);
      }
      const capMap = { free: 50, starter: 1200, pro: 4000, creator: 12000 };
      const creditsValue = Number(profileData && profileData.credits || 0);
      const cap = capMap[profileData && profileData.plan] || 50;
      const pct = Math.max(0, Math.min(100, Math.round((creditsValue / cap) * 100)));
      credits.querySelectorAll('[data-user-credits]').forEach((el) => { el.textContent = creditsValue.toLocaleString(); });
      credits.querySelectorAll('[data-credit-bar-fill]').forEach((el) => { el.style.width = pct + '%'; });
    };

    syncProfileBits();
    document.addEventListener('axiom:profile-ready', syncProfileBits);
  }

  function hydrateGreeting() {
    const heroName = document.querySelector('[data-hero-name]');
    if (!heroName) return;
    const update = () => {
      const source = document.querySelector('.app-user-name');
      if (!source || !source.textContent.trim()) return;
      heroName.textContent = source.textContent.trim();
    };
    update();
    document.addEventListener('axiom:profile-ready', update);
  }

  function bindDashboardPrompt() {
    const form = document.getElementById('dashboardPromptForm');
    const input = document.getElementById('dashboardPromptInput');
    if (!form || !input) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = input.value.trim();
      if (!prompt) return;
      try { localStorage.setItem('axiom:dashboardPrompt', prompt); } catch (err) {}
      location.href = 'playground.html';
    });
  }

  function restoreDashboardPrompt() {
    const input = document.getElementById('chatInput');
    const form = document.getElementById('chatForm');
    if (!input || !form) return;
    let prompt = '';
    try {
      prompt = localStorage.getItem('axiom:dashboardPrompt') || '';
      if (prompt) localStorage.removeItem('axiom:dashboardPrompt');
    } catch (err) {
      prompt = '';
    }
    if (!prompt) return;
    input.value = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.click();
    });
  }

  function makeIconButton(title, iconPath) {
    return `<button class="icon-btn" type="button" title="${title}" aria-label="${title}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none">${iconPath}</svg></button>`;
  }
})();
