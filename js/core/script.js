// ============================================
// Shared: is this a "fine pointer, wide viewport" device?
// Re-checked live so rotating a tablet or resizing a window
// re-evaluates hover-only effects correctly.
// ============================================
function isDesktopPointer() {
  return window.matchMedia('(min-width: 901px)').matches &&
         window.matchMedia('(pointer: fine)').matches;
}

// ============================================
// Mobile nav toggle (full-screen drawer, scroll-locked, a11y state)
// ============================================
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

function closeMenu() {
  navLinks.classList.remove('open');
  navToggle.classList.remove('active');
  navToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
}
function openMenu() {
  navLinks.classList.add('open');
  navToggle.classList.add('active');
  navToggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open');
}

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.contains('open');
    isOpen ? closeMenu() : openMenu();
  });
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', closeMenu);
  });
  // Close drawer automatically if the viewport grows past the collapse point
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeMenu();
  });
  // Escape key closes the drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navLinks.classList.contains('open')) closeMenu();
  });
}

// ============================================
// Nav background on scroll
// ============================================
const navEl = document.querySelector('.nav');
if (navEl) {
  window.addEventListener('scroll', () => {
    navEl.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });
}

// ============================================
// Scroll progress bar
// ============================================
const progressBar = document.getElementById('progressBar');
if (progressBar) {
  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY;
    const height = document.documentElement.scrollHeight - window.innerHeight;
    const progress = height > 0 ? (scrollTop / height) * 100 : 0;
    progressBar.style.width = progress + '%';
  }, { passive: true });
}

// ============================================
// Premium loader
// ============================================
const loader = document.getElementById('loader');
if (loader) {
  window.addEventListener('load', () => {
    setTimeout(() => loader.classList.add('hide'), 900);
  });
  if (document.readyState === 'complete') {
    setTimeout(() => loader.classList.add('hide'), 900);
  }
}

// ============================================
// Scroll reveal for cards
// ============================================
const revealTargets = document.querySelectorAll('.tool-card, .price-card, .stat, .showcase-card');
if ('IntersectionObserver' in window && revealTargets.length) {
  revealTargets.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealTargets.forEach(el => io.observe(el));
}

// ============================================
// Cursor glow (desktop, fine pointer only)
// ============================================
const glow = document.querySelector('.cursor-glow');
if (glow && isDesktopPointer()) {
  let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
  let glowX = mouseX, glowY = mouseY;
  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  function animateGlow() {
    glowX += (mouseX - glowX) * 0.12;
    glowY += (mouseY - glowY) * 0.12;
    glow.style.left = glowX + 'px';
    glow.style.top = glowY + 'px';
    requestAnimationFrame(animateGlow);
  }
  animateGlow();
}

// ============================================
// 3D tilt on showcase/tool cards (desktop, fine pointer only)
// ============================================
if (isDesktopPointer()) {
  const tiltCards = document.querySelectorAll('.showcase-card, .tool-card');
  tiltCards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rotateX = ((y - rect.height / 2) / 18) * -1;
      const rotateY = (x - rect.width / 2) / 18;
      card.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0px)';
    });
  });
}

// ============================================
// Animated stat counters
// ============================================
const stats = document.querySelectorAll('.stat-num');
if ('IntersectionObserver' in window && stats.length) {
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseFloat(el.dataset.target);
      const decimal = parseInt(el.dataset.decimal) || 0;
      const suffix = el.dataset.suffix || '';
      const duration = 1600;
      const start = performance.now();
      function update(now) {
        const progress = Math.min((now - start) / duration, 1);
        const current = target * (1 - Math.pow(1 - progress, 3));
        el.textContent = current.toFixed(decimal) + suffix;
        if (progress < 1) requestAnimationFrame(update);
      }
      requestAnimationFrame(update);
      counterObserver.unobserve(el);
    });
  }, { threshold: 0.5 });
  stats.forEach(stat => counterObserver.observe(stat));
}

// ============================================
// Rising background particles (fewer on small/low-power screens)
// ============================================
const particleContainer = document.getElementById('particles');
if (particleContainer) {
  const count = window.innerWidth < 640 ? 18 : (window.innerWidth < 1024 ? 32 : 50);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = (8 + Math.random() * 10) + 's';
    p.style.animationDelay = (Math.random() * 10) + 's';
    p.style.opacity = String(Math.random() * 0.5);
    const size = 2 + Math.random() * 4;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    frag.appendChild(p);
  }
  particleContainer.appendChild(frag);
}

// ============================================
// Magnetic buttons (desktop, fine pointer only) + click ripple (everywhere)
// ============================================
const buttons = document.querySelectorAll('.btn');
if (isDesktopPointer()) {
  buttons.forEach(button => {
    button.addEventListener('mousemove', (e) => {
      const rect = button.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const moveX = (x - rect.width / 2) * 0.15;
      const moveY = (y - rect.height / 2) * 0.15;
      button.style.transform = `translate(${moveX}px, ${moveY}px)`;
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translate(0,0)';
    });
  });
}
buttons.forEach(button => {
  button.addEventListener('click', (e) => {
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX ? e.clientX - rect.left - size / 2 : rect.width / 2 - size / 2;
    const y = e.clientY ? e.clientY - rect.top - size / 2 : rect.height / 2 - size / 2;
    ripple.style.width = size + 'px';
    ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
});

// ============================================
// Auth pages: "Continue with email" reveals the email/password form
// ============================================
const emailCta = document.getElementById('emailCta');
const emailForm = document.getElementById('emailForm');
const oauthGroup = document.getElementById('oauthGroup');
const emailDivider = document.getElementById('emailDivider');
const backToOptions = document.getElementById('backToOptions');

if (emailCta && emailForm && oauthGroup && emailDivider) {
  emailCta.addEventListener('click', () => {
    oauthGroup.classList.add('hidden');
    emailDivider.classList.add('hidden');
    emailCta.classList.add('hidden');
    emailForm.classList.remove('hidden');
    const firstInput = emailForm.querySelector('input');
    if (firstInput) firstInput.focus();
  });
}
if (backToOptions && emailForm && oauthGroup && emailDivider && emailCta) {
  backToOptions.addEventListener('click', () => {
    emailForm.classList.add('hidden');
    oauthGroup.classList.remove('hidden');
    emailDivider.classList.remove('hidden');
    emailCta.classList.remove('hidden');
  });
}