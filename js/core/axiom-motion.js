// AXIOM — Unified motion layer
// Anime.js: high-detail DOM timelines / Core ambience
// Motion: interaction + in-view transitions
// Falls back to native Web Animations when external modules are unavailable.
(function () {
  'use strict';

  const CDN = {
    anime: 'https://esm.sh/animejs@4.5.0',
    motion: 'https://esm.sh/motion@12.43.0'
  };

  const prefersReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function nativeAnimate(el, keyframes, options) {
    if (!el || prefersReduced() || !el.animate) return;
    el.animate(keyframes, { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both', ...options });
  }

  function loadModule(url) {
    return import(/* @vite-ignore */ url).catch(() => null);
  }

  async function init() {
    if (prefersReduced()) return;

    const [anime, motion] = await Promise.all([
      loadModule(CDN.anime),
      loadModule(CDN.motion)
    ]);

    window.AxiomMotion = { anime, motion };
    document.documentElement.dataset.axiomMotion = 'ready';

    const animate = anime?.animate;
    const inView = motion?.inView;

    // Kokonut-style command / AI surfaces: reveal with spring-like easing.
    document.querySelectorAll('[data-axiom-motion="reveal"]').forEach((el, i) => {
      if (inView) {
        inView(el, () => {
          if (animate) animate(el, { opacity: [0, 1], y: [10, 0], duration: 520, delay: i * 35, ease: 'outExpo' });
          else nativeAnimate(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420 });
        }, { amount: 0.15 });
      } else {
        nativeAnimate(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, delay: i * 35 });
      }
    });

    // Backlit hover language: only animate elements explicitly opted in.
    document.querySelectorAll('[data-backlit]').forEach(el => {
      const enter = () => {
        el.classList.add('is-backlit-active');
        if (animate) animate(el, { '--backlit-strength': [0, 1], duration: 260, ease: 'outQuad' });
      };
      const leave = () => {
        el.classList.remove('is-backlit-active');
        if (animate) animate(el, { '--backlit-strength': [1, 0], duration: 320, ease: 'outQuad' });
      };
      el.addEventListener('pointerenter', enter, { passive: true });
      el.addEventListener('pointerleave', leave, { passive: true });
      el.addEventListener('focusin', enter);
      el.addEventListener('focusout', leave);
    });

    // Premium press feedback for buttons without changing layout.
    document.querySelectorAll('button, [role="button"], .ax-btn').forEach(el => {
      if (el.dataset.axiomPressBound) return;
      el.dataset.axiomPressBound = 'true';
      el.addEventListener('pointerdown', () => {
        if (animate) animate(el, { scale: 0.975, duration: 90, ease: 'outQuad' });
      }, { passive: true });
      el.addEventListener('pointerup', () => {
        if (animate) animate(el, { scale: 1, duration: 180, ease: 'outBack' });
      }, { passive: true });
      el.addEventListener('pointercancel', () => {
        if (animate) animate(el, { scale: 1, duration: 120, ease: 'outQuad' });
      }, { passive: true });
    });

    // Optional AI Core pulse hook. Existing Core implementation remains untouched.
    document.querySelectorAll('[data-axiom-core-pulse]').forEach(el => {
      if (!animate) return;
      animate(el, {
        scale: [1, 1.018, 1],
        opacity: [0.94, 1, 0.94],
        duration: 2600,
        ease: 'inOutSine',
        loop: true
      });
    });
  }

  window.addEventListener('DOMContentLoaded', () => { init(); }, { once: true });
})();
