// ============================================================
// AXIOM — Living Environment (Part 10: AXIOM ULTIMATE)
// The background is alive: it shifts with time of day and
// responds to what the AI is doing right now. Runs on every
// page that has the standard .aurora / .grain layer.
//
// Phase 3 · Part 2 (AI Presence Polish) — this pass:
//  - gives each time-of-day palette its own blend alpha instead
//    of one flat value, so the lighter morning/evening palettes
//    don't wash out foreground text/glass-panel contrast the way
//    the original flat '55' alpha could when a warm, light blob
//    happened to drift under a heading. Darker palettes (night)
//    are bumped up slightly so the environment still reads as
//    "alive" instead of nearly invisible.
//  - scales the activity-driven saturate/brightness boost by the
//    same per-palette factor, for the same reason — the same
//    brightness bump that's barely noticeable against 'night'
//    is a bigger contrast hit against already-light 'morning'.
//  - adds an explicit prefers-reduced-motion guard. CSS wildcard
//    rules elsewhere in the app already zero out this file's
//    injected animation/transition durations, so this is
//    defense-in-depth (and self-documenting) rather than a fix
//    for a real gap: it keeps the palette/activity swap from
//    additionally re-triggering the (already-suppressed) drift
//    speed-up class, and reacts live if the OS setting changes
//    mid-session.
// No change to the public contract: still reads window.AxiomBrain
// and only touches the existing .aurora spans.
// ============================================================
(function () {
  'use strict';

  const PALETTES = {
    morning: ['#FFD9A0', '#FFB37A', '#FF8FA3'],
    day:     ['#6EE7B7', '#60A5FA', '#A78BFA'],
    evening: ['#FF8FA3', '#A78BFA', '#FBBF24'],
    night:   ['#3B82F6', '#6366F1', '#1E1B4B']
  };

  // Per-palette blend alpha (hex suffix on the radial-gradient
  // color) and activity-brightness scale — tuned so the *effective*
  // contribution to the background stays roughly even across
  // themes instead of tracking raw palette brightness 1:1.
  const PALETTE_TUNING = {
    morning: { alpha: '40', boost: 0.55 },
    day:     { alpha: '52', boost: 1 },
    evening: { alpha: '40', boost: 0.55 },
    night:   { alpha: '66', boost: 1 }
  };

  const ACTIVITY_SPEED = {
    idle: 1,
    listening: 1.6,
    thinking: 2.2,
    speaking: 1.8,
    learning: 1.3
  };

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(init);

  function init() {
    const aurora = document.querySelector('.aurora');
    if (!aurora || !window.AxiomBrain) return;

    const spans = aurora.querySelectorAll('span');
    aurora.classList.add('axiom-living');

    const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduceMotion = !!(motionQuery && motionQuery.matches);
    if (motionQuery) {
      const onMotionChange = e => { reduceMotion = e.matches; };
      if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
      else if (motionQuery.addListener) motionQuery.addListener(onMotionChange); // Safari <14 fallback
    }

    // Inject once: transition + pulse keyframe support
    if (!document.getElementById('axiom-living-style')) {
      const style = document.createElement('style');
      style.id = 'axiom-living-style';
      style.textContent = `
        .aurora.axiom-living span { transition: background 1.8s ease, opacity 1.8s ease, filter 1.2s ease; }
        .aurora.axiom-living { transition: filter 1.2s ease; --axiom-env-boost: 1; }
        .aurora.axiom-living.state-listening { filter: saturate(calc(1 + 0.25 * var(--axiom-env-boost))) brightness(calc(1 + 0.05 * var(--axiom-env-boost))); }
        .aurora.axiom-living.state-thinking { filter: saturate(calc(1 + 0.4 * var(--axiom-env-boost))) brightness(calc(1 + 0.1 * var(--axiom-env-boost))); }
        .aurora.axiom-living.state-speaking { filter: saturate(calc(1 + 0.3 * var(--axiom-env-boost))) brightness(calc(1 + 0.08 * var(--axiom-env-boost))); }
        body.axiom-night-mode { --axiom-env-dim: .82; }
      `;
      document.head.appendChild(style);
    }

    function applyPalette(tod) {
      const colors = PALETTES[tod] || PALETTES.day;
      const tuning = PALETTE_TUNING[tod] || PALETTE_TUNING.day;
      spans.forEach((span, i) => {
        span.style.background = `radial-gradient(circle, ${colors[i % colors.length]}${tuning.alpha} 0%, transparent 70%)`;
      });
      aurora.style.setProperty('--axiom-env-boost', tuning.boost);
      document.body.classList.toggle('axiom-night-mode', tod === 'night');
    }

    function applyActivity(activity) {
      aurora.classList.remove('state-idle', 'state-listening', 'state-thinking', 'state-speaking', 'state-learning');
      aurora.classList.add('state-' + activity);
      // The CSS wildcard reduced-motion rules already force these
      // transition/animation durations to ~0, but skipping the
      // per-activity speed-up here too means a reduced-motion user
      // never even briefly computes/holds a "go faster" duration.
      const speed = reduceMotion ? 1 : (ACTIVITY_SPEED[activity] || 1);
      spans.forEach(span => { span.style.animationDuration = (14 / speed) + 's'; });
    }

    function render(state) {
      applyPalette(state.timeOfDay);
      applyActivity(state.activity);
    }

    render(window.AxiomBrain.getState());
    window.AxiomBrain.on('change', render);
  }
})();
