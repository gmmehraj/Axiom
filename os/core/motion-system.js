// ============================================================
// AXIOM AI OS — Motion System (Phase 3: Spring Physics)
// ------------------------------------------------------------
// Everything below is driven by a real damped mass-spring-damper
// simulation (see the Spring class), not cubic-bezier curves.
// Two flavors are used depending on the job:
//
//  - LIVE springs (the Spring class): tick every frame via
//    rAF, can be retargeted mid-flight without losing velocity.
//    Used for anything interactive/continuous — hover, press,
//    drag inertia, magnetic cursor, floating widgets, the
//    elastic dock.
//
//  - SAMPLED springs (springSamples / animateSpring): the same
//    simulation is pre-run once to produce a keyframe track,
//    then handed to the Web Animations API. Used for one-shot
//    enter/exit choreography — fade/scale/slide-in, page
//    transitions — where a single non-interruptible run is fine
//    and WAAPI gives us compositor-thread performance.
//
// Public API is intentionally unchanged from the old CSS-based
// version (fadeIn, fadeOut, scaleIn, slideIn, staggerIn, init,
// SPRING, DURATIONS, ...) so existing call sites (os-shell.js)
// keep working — they just get real spring motion for free now.
// New capabilities are added alongside: inertia, momentum,
// hoverLift (now spring-based), magneticCursor, floatingWidget,
// elasticDock, rippleClick, draggable.
// ============================================================
window.AxiomMotion = (function() {
  'use strict';

  // ---------------------------------------------------------
  // 1. THE SPRING — a real damped harmonic oscillator.
  //    F = -stiffness * (value - target) - damping * velocity
  //    a = F / mass ; v += a*dt ; value += v*dt
  // ---------------------------------------------------------
  const PRESETS = {
    gentle: { stiffness: 120, damping: 16, mass: 1 },   // settles smoothly, tiny/no overshoot
    snappy: { stiffness: 340, damping: 22, mass: 1 },   // quick, slight overshoot — buttons, dock
    wobbly: { stiffness: 180, damping: 10, mass: 1 },   // visible bounce — magnetic pull, ripple bloom
    stiff:  { stiffness: 420, damping: 30, mass: 1 },   // fast, almost no overshoot — drag follow
    slow:   { stiffness: 60,  damping: 18, mass: 1 },   // lazy, ambient — floating widgets
    elastic:{ stiffness: 260, damping: 9,  mass: 1 },   // pronounced bounce — elastic dock
  };

  // Kept in lockstep with styles/motion-tokens.css:
  // fast -> --motion-duration-fast, normal -> --motion-duration-base,
  // slow -> --motion-duration-slow, reveal -> --motion-duration-reveal.
  // If you change a value here, change it there too.
  const DURATIONS = { fast: 150, normal: 250, slow: 400, reveal: 600 };

  class Spring {
    constructor(preset = 'gentle', value = 0) {
      const p = typeof preset === 'string' ? (PRESETS[preset] || PRESETS.gentle) : preset;
      this.stiffness = p.stiffness;
      this.damping = p.damping;
      this.mass = p.mass || 1;
      this.value = value;
      this.velocity = 0;
      this.target = value;
      this._raf = null;
      this._onUpdate = null;
      this._onRest = null;
      this._last = 0;
    }
    onUpdate(fn) { this._onUpdate = fn; return this; }
    onRest(fn) { this._onRest = fn; return this; }
    // retarget WITHOUT killing current velocity — this is what
    // makes interrupted springs (flick the dock while it's mid
    // bounce, move the cursor away from a magnetic button mid
    // pull) feel continuous instead of snapping.
    to(target, velocityBoost = 0) {
      this.target = target;
      this.velocity += velocityBoost;
      this._start();
      return this;
    }
    set(value) {
      this.value = value;
      this.velocity = 0;
      this.target = value;
      if (this._onUpdate) this._onUpdate(value, this.velocity);
      return this;
    }
    stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      return this;
    }
    _start() {
      if (this._raf) return;
      this._last = performance.now();
      const step = (now) => {
        const dt = Math.min((now - this._last) / 1000, 1 / 30);
        this._last = now;
        const force = -this.stiffness * (this.value - this.target);
        const dampingForce = -this.damping * this.velocity;
        const accel = (force + dampingForce) / this.mass;
        this.velocity += accel * dt;
        this.value += this.velocity * dt;
        if (this._onUpdate) this._onUpdate(this.value, this.velocity);
        const atRest = Math.abs(this.target - this.value) < 0.001 && Math.abs(this.velocity) < 0.001;
        if (atRest) {
          this.value = this.target;
          this.velocity = 0;
          if (this._onUpdate) this._onUpdate(this.value, 0);
          this._raf = null;
          if (this._onRest) this._onRest();
          return;
        }
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }
  }

  // ---------------------------------------------------------
  // 2. SAMPLED SPRINGS — pre-run the same simulation 0 -> 1
  //    once, producing a WAAPI keyframe track with genuine
  //    spring overshoot baked in (instead of a cubic-bezier
  //    approximation of one).
  // ---------------------------------------------------------
  function springSamples(preset = 'gentle', { from = 0, to = 1, initialVelocity = 0, maxDurationMs = 1400 } = {}) {
    const p = typeof preset === 'string' ? (PRESETS[preset] || PRESETS.gentle) : preset;
    const dt = 1000 / 120;
    let value = from, velocity = initialVelocity, t = 0;
    const samples = [{ t: 0, value }];
    while (t < maxDurationMs) {
      const force = -p.stiffness * (value - to);
      const dampingForce = -p.damping * velocity;
      const accel = (force + dampingForce) / (p.mass || 1);
      velocity += accel * (dt / 1000);
      value += velocity * (dt / 1000);
      t += dt;
      samples.push({ t, value });
      if (Math.abs(value - to) < 0.002 && Math.abs(velocity) < 0.002) {
        samples.push({ t: t + dt, value: to });
        break;
      }
    }
    return samples;
  }

  const lerp = (a, b, t) => a + (b - a) * t;

  // Drives one scalar spring 0->1 (with real overshoot) and uses
  // it to interpolate transform/opacity between two states.
  function animateSpring(el, from = {}, to = {}, { preset = 'gentle', onFinish } = {}) {
    if (!el) return null;
    const samples = springSamples(preset, { from: 0, to: 1 });
    const total = samples[samples.length - 1].t || 1;
    const keyframes = samples.map(s => {
      const x = lerp(from.x || 0, to.x || 0, s.value);
      const y = lerp(from.y || 0, to.y || 0, s.value);
      const scale = lerp(from.scale ?? 1, to.scale ?? 1, s.value);
      const rotate = lerp(from.rotate || 0, to.rotate || 0, s.value);
      const opacity = lerp(from.opacity ?? 1, to.opacity ?? 1, Math.min(1, Math.max(0, s.value)));
      return {
        transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(4)}) rotate(${rotate.toFixed(2)}deg)`,
        opacity,
        offset: Math.min(1, s.t / total),
      };
    });
    const anim = el.animate(keyframes, { duration: total, easing: 'linear', fill: 'both' });
    if (onFinish) anim.onfinish = onFinish;
    return anim;
  }

  // ---------------------------------------------------------
  // 3. ENTER / EXIT CHOREOGRAPHY (spring-sampled)
  // ---------------------------------------------------------
  function fadeIn(el) {
    return animateSpring(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0 }, { preset: 'gentle' });
  }
  function fadeOut(el, onFinish) {
    return animateSpring(el, { opacity: 1, y: 0 }, { opacity: 0, y: -10 }, { preset: 'stiff', onFinish });
  }
  function scaleIn(el) {
    return animateSpring(el, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1 }, { preset: 'snappy' });
  }
  function slideIn(el, dir = 'right') {
    const off = 34;
    const from = {
      right: { x: off, y: 0 }, left: { x: -off, y: 0 },
      up: { x: 0, y: 22 }, down: { x: 0, y: -22 },
    }[dir] || { x: off, y: 0 };
    return animateSpring(el, { ...from, opacity: 0 }, { x: 0, y: 0, opacity: 1 }, { preset: 'gentle' });
  }
  function staggerIn(container, itemSelector, opts = {}) {
    if (!container) return;
    const items = container.querySelectorAll(itemSelector);
    items.forEach((el, i) => setTimeout(() => fadeIn(el), (opts.stagger ?? 40) * i));
  }
  function waveEffect(el) {
    if (!el) return;
    const s = new Spring('wobbly', 1);
    s.onUpdate(v => { el.style.transform = `scale(${v})`; });
    s.to(1.03);
    setTimeout(() => s.to(1), 90);
  }
  function glowPulse(el, color = 'rgba(255,255,255,.15)') {
    if (!el) return;
    el.animate([
      { boxShadow: `0 0 0 0 ${color}` },
      { boxShadow: `0 0 20px 4px ${color}` },
      { boxShadow: `0 0 0 0 ${color}` },
    ], { duration: 2000, iterations: Infinity, easing: 'ease-in-out' });
  }

  // Spring-driven page transition: outgoing content springs
  // down/away, then incoming content springs up/in with a real
  // settle-bounce — nothing swaps instantly.
  function pageTransition(container, renderFn) {
    if (!container) return;
    animateSpring(container, { opacity: 1, y: 0, scale: 1 }, { opacity: 0, y: -10, scale: 0.98 }, {
      preset: 'stiff',
      onFinish: () => {
        if (typeof renderFn === 'function') renderFn(container);
        animateSpring(container, { opacity: 0, y: 12, scale: 0.97 }, { opacity: 1, y: 0, scale: 1 }, { preset: 'wobbly' });
      },
    });
  }

  // ---------------------------------------------------------
  // 4. LIVE INTERACTION SPRINGS
  // ---------------------------------------------------------

  // Hover lift — a persistent spring per element so rapid
  // enter/leave (mouse skimming across a row of cards) carries
  // real velocity instead of restarting from zero each time.
  const liftRegistry = new WeakMap();
  function hoverLift(el, { liftY = -5, scale = 1.014, preset = 'snappy' } = {}) {
    if (!el || liftRegistry.has(el)) return;
    const spring = new Spring(preset, 0);
    spring.onUpdate(v => {
      el.style.transform = `translateY(${(liftY * v).toFixed(2)}px) scale(${(1 + (scale - 1) * v).toFixed(4)})`;
      el.style.boxShadow = `0 ${(6 + 14 * v).toFixed(0)}px ${(18 + 26 * v).toFixed(0)}px rgba(0,0,0,${(0.22 + 0.14 * v).toFixed(2)})`;
    });
    el.addEventListener('mouseenter', () => spring.to(1));
    el.addEventListener('mouseleave', () => spring.to(0));
    liftRegistry.set(el, spring);
  }

  // Spring press — compress on press, bounce back on release.
  const pressRegistry = new WeakMap();
  function springPress(el, { downScale = 0.955, preset = 'wobbly' } = {}) {
    if (!el || pressRegistry.has(el)) return;
    const spring = new Spring(preset, 1);
    spring.onUpdate(v => { el.style.transform = `scale(${v.toFixed(4)})`; });
    el.addEventListener('mousedown', () => spring.to(downScale));
    el.addEventListener('mouseup', () => spring.to(1));
    el.addEventListener('mouseleave', () => spring.to(1));
    pressRegistry.set(el, spring);
  }

  // Magnetic cursor — element leans toward the pointer while
  // it's within `radius`, springs back to rest once it leaves.
  function magneticCursor(el, { radius = 90, strength = 0.35, preset = 'wobbly' } = {}) {
    if (!el) return;
    const sx = new Spring(preset, 0);
    const sy = new Spring(preset, 0);
    let raf = null;
    const apply = () => { el.style.transform = `translate(${sx.value.toFixed(2)}px, ${sy.value.toFixed(2)}px)`; };
    sx.onUpdate(apply);
    sy.onUpdate(apply);
    document.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < radius) {
        const pull = (1 - dist / radius) * strength;
        sx.to(dx * pull);
        sy.to(dy * pull);
      } else {
        sx.to(0);
        sy.to(0);
      }
    });
  }

  // Floating widgets — continuous ambient drift. The target is
  // re-randomized every couple of seconds rather than looped on
  // a fixed keyframe track, so no two widgets ever sync up and
  // the motion never reads as "on rails".
  function floatingWidget(el, { ampX = 6, ampY = 10, preset = 'slow' } = {}) {
    if (!el) return null;
    const sx = new Spring(preset, 0);
    const sy = new Spring(preset, 0);
    const srot = new Spring('slow', 0);
    const apply = () => {
      el.style.transform = `translate(${sx.value.toFixed(2)}px, ${sy.value.toFixed(2)}px) rotate(${srot.value.toFixed(2)}deg)`;
    };
    sx.onUpdate(apply); sy.onUpdate(apply); srot.onUpdate(apply);
    let stopped = false;
    (function wander() {
      if (stopped) return;
      sx.to((Math.random() * 2 - 1) * ampX);
      sy.to((Math.random() * 2 - 1) * ampY);
      srot.to((Math.random() * 2 - 1) * 1.2);
      setTimeout(wander, 1800 + Math.random() * 1600);
    })();
    return () => { stopped = true; sx.stop(); sy.stop(); srot.stop(); };
  }

  // Ripple click — expanding ring from the click point, driven
  // by a spring so the bloom has a touch of overshoot rather
  // than a linear material-design expand.
  function spawnRipple(el, clientX, clientY, color = 'rgba(255,255,255,.35)') {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.overflow = el.style.overflow || 'hidden';
    const r = el.getBoundingClientRect();
    const span = document.createElement('span');
    const size = Math.max(r.width, r.height) * 1.8;
    Object.assign(span.style, {
      position: 'absolute',
      left: (clientX - r.left) + 'px',
      top: (clientY - r.top) + 'px',
      width: '0px', height: '0px',
      marginLeft: '0px', marginTop: '0px',
      borderRadius: '50%',
      background: color,
      pointerEvents: 'none',
      transform: 'translate(-50%,-50%)',
      zIndex: 0,
    });
    el.appendChild(span);
    const spring = new Spring('wobbly', 0);
    spring.onUpdate(v => {
      const s = size * v;
      span.style.width = s + 'px';
      span.style.height = s + 'px';
      span.style.opacity = String(Math.max(0, 1 - v));
    });
    spring.onRest(() => span.remove());
    spring.to(1);
  }
  function rippleClick(el, { color = 'rgba(255,255,255,.35)' } = {}) {
    if (!el) return;
    el.addEventListener('mousedown', (e) => spawnRipple(el, e.clientX, e.clientY, color));
  }

  // Draggable with inertia/momentum — 1:1 follow while dragging,
  // then on release the element keeps coasting on its release
  // velocity with exponential friction, and (if bounds are given)
  // springs back elastically the moment it would leave them.
  function draggable(el, { bounds = null, friction = 0.94, onRelease } = {}) {
    if (!el) return;
    let x = 0, y = 0, vx = 0, vy = 0;
    let dragging = false, lastX = 0, lastY = 0, lastT = 0;
    let coastRaf = null;

    function apply() { el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`; }

    function clampToBounds() {
      if (!bounds) return null;
      const overX = x < bounds.minX ? bounds.minX - x : x > bounds.maxX ? bounds.maxX - x : 0;
      const overY = y < bounds.minY ? bounds.minY - y : y > bounds.maxY ? bounds.maxY - y : 0;
      return (overX || overY) ? { overX, overY } : null;
    }

    function coast() {
      x += vx / 60; y += vy / 60;
      vx *= friction; vy *= friction;
      apply();
      const over = clampToBounds();
      if (over) {
        cancelAnimationFrame(coastRaf); coastRaf = null;
        // spring the overshoot back to 0 elastically
        const startX = x, startY = y;
        const sx = new Spring('elastic', 0); const sy = new Spring('elastic', 0);
        sx.onUpdate(v => { x = startX + (over.overX * (1 - v)); apply(); });
        sy.onUpdate(v => { y = startY + (over.overY * (1 - v)); apply(); });
        sx.to(1); sy.to(1);
        return;
      }
      if (Math.hypot(vx, vy) > 4) coastRaf = requestAnimationFrame(coast);
    }

    el.addEventListener('mousedown', (e) => {
      dragging = true; el.style.cursor = 'grabbing';
      if (coastRaf) cancelAnimationFrame(coastRaf);
      lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
      vx = 0; vy = 0;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      vx = (e.clientX - lastX) / dt * 16; // px per frame(~16ms), used as release velocity
      vy = (e.clientY - lastY) / dt * 16;
      x += e.clientX - lastX;
      y += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY; lastT = now;
      apply();
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; el.style.cursor = 'grab';
      if (onRelease) onRelease({ x, y, vx, vy });
      coastRaf = requestAnimationFrame(coast);
    });
  }

  // ---------------------------------------------------------
  // 5. ELASTIC DOCK — macOS-style magnification. Uses event
  //    delegation on the dock container so it keeps working
  //    even after items are re-rendered (the dock is rebuilt
  //    dynamically by os-shell.js).
  // ---------------------------------------------------------
  const dockInit = new WeakSet();
  function elasticDock(dockEl, itemSelector = '.ax-dock-item', { radius = 110, maxScale = 1.5, preset = 'elastic' } = {}) {
    if (!dockEl || dockInit.has(dockEl)) return;
    dockInit.add(dockEl);
    const springs = new WeakMap();
    function springFor(item) {
      let s = springs.get(item);
      if (!s) {
        s = new Spring(preset, 1);
        s.onUpdate(v => {
          item.style.transform = `translateY(${(-6 * (v - 1) / (maxScale - 1)).toFixed(2)}px) scale(${v.toFixed(4)})`;
          item.style.zIndex = v > 1.02 ? 5 : 1;
        });
        springs.set(item, s);
      }
      return s;
    }
    dockEl.addEventListener('mousemove', (e) => {
      dockEl.querySelectorAll(itemSelector).forEach(item => {
        const r = item.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const dist = Math.abs(e.clientX - cx);
        const falloff = Math.max(0, 1 - dist / radius);
        const target = 1 + (maxScale - 1) * falloff;
        springFor(item).to(target);
      });
    });
    dockEl.addEventListener('mouseleave', () => {
      dockEl.querySelectorAll(itemSelector).forEach(item => springFor(item).to(1));
    });
    // click ripple on whichever dock item was actually clicked
    dockEl.addEventListener('mousedown', (e) => {
      const item = e.target.closest(itemSelector);
      if (!item) return;
      spawnRipple(item, e.clientX, e.clientY, 'rgba(255,255,255,.28)');
    });
  }

  // ---------------------------------------------------------
  // 6. AUTO-INIT — data-motion opt-ins (unchanged attribute
  //    names + a few new ones), plus automatic elastic-dock
  //    wiring for any `.ax-dock` found on the page.
  // ---------------------------------------------------------
  const HANDLERS = {
    'fade-in': fadeIn,
    'scale-in': scaleIn,
    'hover-lift': hoverLift,
    'spring-press': springPress,
    'magnetic': magneticCursor,
    'float': floatingWidget,
    'ripple': rippleClick,
  };

  function applyTo(el) {
    const motion = el.dataset.motion;
    if (motion && HANDLERS[motion]) HANDLERS[motion](el);
  }

  function init() {
    document.querySelectorAll('[data-motion]').forEach(applyTo);
    document.querySelectorAll('[data-motion="stagger"]').forEach(el => {
      Array.from(el.children).forEach((child, i) => {
        child.style.opacity = '0';
        setTimeout(() => fadeIn(child), i * 40);
      });
    });
    document.querySelectorAll('.ax-dock').forEach(dock => elasticDock(dock));
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('[data-motion]')) applyTo(node);
        if (node.matches && node.matches('.ax-dock')) elasticDock(node);
        if (node.querySelectorAll) {
          node.querySelectorAll('[data-motion]').forEach(applyTo);
          node.querySelectorAll('.ax-dock').forEach(elasticDock);
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return {
    // engine
    Spring, PRESETS, SPRING: {
      gentle: 'cubic-bezier(.19,1,.22,1)', snappy: 'cubic-bezier(.34,1.56,.64,1)',
      smooth: 'cubic-bezier(.4,0,.2,1)', linear: 'cubic-bezier(0,0,1,1)',
    }, // legacy alias kept in case any old call site reads AxiomMotion.SPRING.* directly
    DURATIONS,
    animateSpring, springSamples,
    // enter/exit
    fadeIn, fadeOut, scaleIn, slideIn, staggerIn, waveEffect, glowPulse, pageTransition,
    // live interaction
    hoverLift, springPress, magneticCursor, floatingWidget, rippleClick, spawnRipple, draggable, elasticDock,
    // lifecycle
    init,
  };
})();
