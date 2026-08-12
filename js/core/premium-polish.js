/* ============================================================
   AXIOM AI OS V13 — Phase 10: Global Premium Polish Engine
   ------------------------------------------------------------
   - Cursor-reactive glass physics (tilt + shimmer)
   - Page entrance animations
   - Mobile bottom dock awareness
   - Reduced motion wiring
   - Dock magnification
   - Card dimming containers
   - Performance monitoring (FPS counter)
   ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = {
    cursorPhysics: true,
    mouseParallax: true,
    dockMagnification: true,
    pageEntrance: true,
    fpsCounter: false,
  };

  // ============================================================
  // 0. REDUCED MOTION STATE — shared read used by every effect
  //    below. CSS handles `animation`/`transition` properties on
  //    its own via the `.ax-reduced-motion` body class (see
  //    initReducedMotion), but the cursor-tilt/parallax/dock-zoom
  //    effects in this file write `transform` directly from a
  //    mousemove listener, which no CSS media query can reach —
  //    this is the JS-side equivalent, checked once per handler
  //    call instead of duplicating a matchMedia lookup in each.
  // ============================================================
  let prefersReducedMotion = false;
  function isReducedMotion() { return prefersReducedMotion; }

  // ============================================================
  // 1. CURSOR PHYSICS — Glass card tilt + shimmer
  // ============================================================
  function initCursorPhysics() {
    if (!CONFIG.cursorPhysics) return;

    const trackables = document.querySelectorAll('.ax-cursor-track');
    const shimmers = document.querySelectorAll('.ax-cursor-shimmer');
    if (!trackables.length && !shimmers.length) return;

    // Both listeners used to run their own getBoundingClientRect()
    // + style write per element on every raw mousemove — on a fast
    // mouse that's two full forced-layout passes per event outside
    // any frame budget. Coalesced into one rAF-scheduled pass: the
    // latest event position is recorded synchronously (cheap), and
    // the actual DOM reads/writes happen at most once per animation
    // frame, using the same event for both element sets.
    let pendingEvent = null;
    let scheduled = false;

    function apply() {
      scheduled = false;
      if (!pendingEvent || isReducedMotion()) return;
      const e = pendingEvent;

      trackables.forEach(el => {
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        el.style.setProperty('--ax-cursor-x', x);
        el.style.setProperty('--ax-cursor-y', y);
      });

      shimmers.forEach(el => {
        const rect = el.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
        const y = ((e.clientY - rect.top) / rect.height * 100).toFixed(1);
        el.style.setProperty('--ax-cursor-x-percent', x + '%');
        el.style.setProperty('--ax-cursor-y-percent', y + '%');
      });
    }

    document.addEventListener('mousemove', (e) => {
      if (isReducedMotion()) return;
      pendingEvent = e;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(apply);
      }
    }, { passive: true });
  }

  // ============================================================
  // 2. MOUSE PARALLAX — Hero/panel depth layers
  // ============================================================
  function initMouseParallax() {
    if (!CONFIG.mouseParallax) return;

    const layers = document.querySelectorAll('[data-parallax]');
    if (!layers.length) return;

    let pendingEvent = null;
    let scheduled = false;

    function apply() {
      scheduled = false;
      if (!pendingEvent || isReducedMotion()) return;
      const e = pendingEvent;
      const cx = e.clientX / window.innerWidth - 0.5;
      const cy = e.clientY / window.innerHeight - 0.5;

      layers.forEach(layer => {
        const depth = parseFloat(layer.getAttribute('data-parallax')) || 0.05;
        const x = cx * depth * 40;
        const y = cy * depth * 40;
        layer.style.transform = `translate(${x}px, ${y}px)`;
      });
    }

    document.addEventListener('mousemove', (e) => {
      if (isReducedMotion()) return;
      pendingEvent = e;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(apply);
      }
    }, { passive: true });
  }

  // ============================================================
  // 3. DOCK MAGNIFICATION — Apple-style zoom
  // ============================================================
  function initDockMagnification() {
    if (!CONFIG.dockMagnification) return;

    const dock = document.querySelector('.ax-dock');
    if (!dock) return;

    const items = dock.querySelectorAll('.ax-dock-item');
    if (!items.length) return;

    // The quick magnify transition now lives on this class in
    // ax-dock.css (using the standard motion tokens) instead of
    // being written as a raw inline string on every item on every
    // mousemove — that was identical work repeated dozens of times
    // a second for no visual benefit, since the value never changed.
    dock.classList.add('ax-dock-magnify');

    let pendingX = null;
    let scheduled = false;

    function apply() {
      scheduled = false;
      if (pendingX === null || isReducedMotion()) return;
      const dockRect = dock.getBoundingClientRect();
      const mouseX = pendingX;

      items.forEach(item => {
        const itemRect = item.getBoundingClientRect();
        const itemCenter = itemRect.left + itemRect.width / 2 - dockRect.left;
        const itemDist = Math.abs(mouseX - itemCenter);
        const itemScale = itemDist < 60 ?
          1 + (1 - itemDist / 60) * 0.12 :
          1;
        item.style.transform = `scale(${itemScale})`;
      });
    }

    dock.addEventListener('mousemove', (e) => {
      if (isReducedMotion()) return;
      const dockRect = dock.getBoundingClientRect();
      pendingX = e.clientX - dockRect.left;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(apply);
      }
    }, { passive: true });

    dock.addEventListener('mouseleave', () => {
      pendingX = null;
      items.forEach(item => {
        item.style.transform = 'scale(1)';
      });
    });
  }

  // ============================================================
  // 4. PAGE ENTRANCE — Staggered card entrances
  // ============================================================
  function initPageEntrance() {
    if (!CONFIG.pageEntrance) return;

    const page = document.querySelector('.ax-page');
    if (page) {
      page.classList.add('ax-page-entrance');
    }

    // Stagger children after entrance
    const staggerContainers = document.querySelectorAll('.ax-stagger');
    staggerContainers.forEach(container => {
      const children = container.children;
      Array.from(children).forEach((child, i) => {
        child.style.animationDelay = (i * 60) + 'ms';
      });
    });
  }

  // ============================================================
  // 5. REDUCED MOTION — Respect OS + manual toggle
  // ============================================================
  function initReducedMotion() {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = query.matches;
    if (prefersReducedMotion) {
      document.body.classList.add('ax-reduced-motion');
    }

    // Listen for changes. This previously read
    // '(precedes-reduced-motion: reduce)' — an invalid media query
    // string, so the browser silently never matched it and this
    // listener never fired. A user who toggled their OS-level
    // reduced-motion setting mid-session (rather than having it set
    // before load) never actually got the update, and none of the
    // JS-driven cursor/parallax/dock effects below ever picked up
    // the change either, since they all read this same flag.
    query.addEventListener('change', (e) => {
      prefersReducedMotion = e.matches;
      document.body.classList.toggle('ax-reduced-motion', e.matches);
    });

    // Wire manual toggle if settings toggle exists
    const motionToggle = document.getElementById('axReducedMotion');
    if (motionToggle) {
      motionToggle.addEventListener('change', () => {
        prefersReducedMotion = motionToggle.checked;
        document.body.classList.toggle('ax-reduced-motion', motionToggle.checked);
      });
    }

    // Listen for custom event from settings
    document.addEventListener('ax-reduced-motion-change', (e) => {
      prefersReducedMotion = !!e.detail;
      document.body.classList.toggle('ax-reduced-motion', e.detail);
    });
  }

  // ============================================================
  // 6. CARD DIMMING — Hover dim non-interacted cards
  // ============================================================
  function initCardDimming() {
    const containers = document.querySelectorAll('.ax-dimmable-container');
    containers.forEach(container => {
      const dimmables = container.querySelectorAll('.ax-dimmable');
      if (dimmables.length < 2) return;

      dimmables.forEach(el => {
        el.addEventListener('mouseenter', () => {
          dimmables.forEach(other => {
            if (other !== el) other.style.opacity = '0.6';
          });
        });
        el.addEventListener('mouseleave', () => {
          dimmables.forEach(other => {
            other.style.opacity = '';
          });
        });
      });
    });
  }

  // ============================================================
  // 7. FPS COUNTER (optional, for debug)
  // ============================================================
  let fpsInterval = null;
  function initFPSCounter() {
    if (!CONFIG.fpsCounter) return;

    const fpsEl = document.createElement('div');
    fpsEl.id = 'axFPS';
    fpsEl.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;font-family:JetBrains Mono,monospace;font-size:.7rem;color:rgba(255,255,255,.3);padding:4px 8px;border-radius:8px;background:rgba(0,0,0,.5);backdrop-filter:blur(8px);pointer-events:none;';
    document.body.appendChild(fpsEl);

    let frames = 0;
    let lastTime = performance.now();

    function countFPS() {
      frames++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        fpsEl.textContent = `${frames} FPS`;
        frames = 0;
        lastTime = now;
      }
      requestAnimationFrame(countFPS);
    }
    requestAnimationFrame(countFPS);
  }

  // ============================================================
  // 8. MOBILE DOCK — Hide/show on scroll
  // ============================================================
  function initMobileDock() {
    const dock = document.querySelector('.ax-dock');
    if (!dock) return;

    let lastScroll = 0;
    const isMobile = () => window.innerWidth < 768;

    window.addEventListener('scroll', () => {
      if (!isMobile()) return;
      const currentScroll = window.pageYOffset;
      if (isReducedMotion()) {
        // Keep the show/hide behavior itself (it's a functional
        // affordance, not decoration) but skip animating it —
        // jump straight to the end state instead of tweening.
        dock.style.transition = 'none';
      } else {
        dock.style.transition = 'transform 0.3s cubic-bezier(.19, 1, .22, 1)';
      }
      if (currentScroll > lastScroll && currentScroll > 100) {
        dock.style.transform = 'translateY(100%)';
      } else {
        dock.style.transform = 'translateY(0)';
      }
      lastScroll = currentScroll;
    }, { passive: true });
  }

  // ============================================================
  // 9. MOBILE VOICE FAB
  // ============================================================
  function initVoiceFAB() {
    const fab = document.querySelector('.ax-voice-fab');
    if (!fab && window.innerWidth < 768) {
      const voiceBtn = document.createElement('button');
      voiceBtn.className = 'ax-voice-fab';
      voiceBtn.setAttribute('aria-label', 'Voice input');
      voiceBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" stroke="currentColor" stroke-width="1.6"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      voiceBtn.addEventListener('click', () => {
        // Dispatch voice toggle event
        document.dispatchEvent(new CustomEvent('ax-voice-toggle'));
      });
      document.body.appendChild(voiceBtn);
    }
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Wait for DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }

    function run() {
      // Runs first: every other effect below reads the shared
      // prefersReducedMotion flag this sets, so it needs to be
      // current before any mousemove/scroll listener can fire.
      initReducedMotion();
      initCursorPhysics();
      initMouseParallax();
      initDockMagnification();
      initPageEntrance();
      initCardDimming();
      initFPSCounter();
      initMobileDock();

      // Voice FAB only on mobile
      if (window.innerWidth < 768) {
        initVoiceFAB();
      }
      window.addEventListener('resize', () => {
        if (window.innerWidth < 768) initVoiceFAB();
      });

      console.log('[PremiumPolish] Applied global premium effects');
    }
  }

  init();

  global.AxiomPremiumPolish = {
    CONFIG,
    initCursorPhysics,
    initMouseParallax,
    initDockMagnification,
  };

})(window);

