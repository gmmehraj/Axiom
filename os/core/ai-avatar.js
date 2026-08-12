// ============================================================
// AXIOM — Holographic AI Avatar (Part 10: AXIOM ULTIMATE)
// A living face, not just an orb: eyes that track the cursor,
// blinking, expressions, a talking mouth — plus Dynamic Core
// Evolution (rings + particles grow with days of use) and
// Ultimate Voice (reacts instantly to axiom:voice-state events
// dispatched anywhere in the app).
// ============================================================
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(init);

  function init() {
    if (!window.AxiomBrain) return;
    if (document.querySelector('.axiom-avatar')) return;

    const day = window.AxiomBrain.dayCount();
    // Core Evolution: ring/particle count grows with usage, caps for sanity.
    const ringCount = Math.min(4, 1 + Math.floor(day / 7));      // +1 ring every ~week, up to 4
    const particleCount = Math.min(10, 3 + Math.floor(day / 3)); // +1 particle every 3 days, up to 10

    const avatar = document.createElement('div');
    avatar.className = 'axiom-avatar';
    avatar.setAttribute('role', 'button');
    avatar.setAttribute('aria-label', 'AI Avatar — click for status');

    let ringsHtml = '';
    for (let i = 0; i < ringCount; i++) ringsHtml += `<div class="axiom-avatar-ring r${i + 1}"></div>`;

    let particlesHtml = '';
    for (let i = 0; i < particleCount; i++) {
      const orbit = 30 + Math.random() * 14;
      const dur = 6 + Math.random() * 10;
      const delay = -Math.random() * dur;
      particlesHtml += `<div class="axiom-avatar-particle" style="--orbit:${orbit}px; top:50%; left:50%; margin:-1.5px; animation-duration:${dur}s; animation-delay:${delay}s;"></div>`;
    }

    avatar.innerHTML = `
      ${ringsHtml}
      ${particlesHtml}
      <div class="axiom-avatar-face">
        <div class="axiom-eyes">
          <div class="axiom-eye"></div>
          <div class="axiom-eye"></div>
        </div>
        <div class="axiom-mouth"></div>
      </div>
    `;
    document.body.appendChild(avatar);

    const panel = document.createElement('div');
    panel.className = 'axiom-avatar-panel';
    panel.innerHTML = `
      <h4>AI Status</h4>
      <div class="row"><span>Day</span><b data-axiom-day>${day}</b></div>
      <div class="row"><span>State</span><b data-axiom-activity>Idle</b></div>
      <div class="row"><span>Time of day</span><b data-axiom-tod>—</b></div>
      <div class="row"><span>Active agents</span><b data-axiom-agents>4</b></div>
    `;
    document.body.appendChild(panel);

    // ---- Reduced Motion (Phase 3 · Part 2) ----
    // CSS `prefers-reduced-motion` rules elsewhere in the app already
    // stop this component's *animations* (ring spin, particle orbit,
    // idle breathing — see the @media block added to ai-avatar.css).
    // What CSS can't reach is the two bits of continuous motion this
    // file drives directly in JS: the cursor-follow eye parallax
    // (exactly the kind of "content that moves in response to user
    // input" WCAG's reduced-motion guidance calls out) and the rapid
    // randomized talking-mouth flicker. Both are handled below;
    // everything else in this file (blink scheduling, mood/state
    // handling, the status panel) is unaffected.
    const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduceMotion = !!(motionQuery && motionQuery.matches);
    if (motionQuery) {
      const onMotionChange = e => { reduceMotion = e.matches; };
      if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
      else if (motionQuery.addListener) motionQuery.addListener(onMotionChange); // Safari <14 fallback
    }

    // ---- eye tracking ----
    // Skipped entirely under reduced motion rather than just damped —
    // a face that silently tracks the cursor everywhere on the page
    // is the parallax/cursor-follow pattern reduced-motion exists to
    // opt out of, not something to make merely smaller.
    const eyes = avatar.querySelectorAll('.axiom-eye');
    let pendingEvent = null;
    let eyeFramePending = false;
    function applyEyeTransform() {
      eyeFramePending = false;
      if (reduceMotion || !pendingEvent) return;
      const rect = avatar.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = Math.max(-1, Math.min(1, (pendingEvent.clientX - cx) / 300));
      const dy = Math.max(-1, Math.min(1, (pendingEvent.clientY - cy) / 300));
      eyes.forEach(eye => { eye.style.transform = `translate(${dx * 2.5}px, ${dy * 2.5}px)`; });
    }
    document.addEventListener('mousemove', e => {
      if (reduceMotion) return;
      pendingEvent = e;
      if (!eyeFramePending) {
        eyeFramePending = true;
        requestAnimationFrame(applyEyeTransform);
      }
    }, { passive: true });

    // ---- blinking ----
    function scheduleBlink() {
      const wait = 2200 + Math.random() * 3500;
      setTimeout(() => {
        avatar.classList.add('blinking');
        setTimeout(() => avatar.classList.remove('blinking'), 130);
        scheduleBlink();
      }, wait);
    }
    scheduleBlink();

    // ---- click toggles status panel ----
    let open = false;
    avatar.addEventListener('click', () => {
      open = !open;
      panel.classList.toggle('open', open);
    });
    document.addEventListener('click', e => {
      if (open && !panel.contains(e.target) && !avatar.contains(e.target)) {
        open = false;
        panel.classList.remove('open');
      }
    });

    // ---- talking mouth animation while speaking ----
    const mouth = avatar.querySelector('.axiom-mouth');
    let talkTimer = null;
    function startTalking() {
      stopTalking();
      // Reduced motion: still needs to *show* speaking is happening
      // (removing the tell entirely would make that state unreadable)
      // but a slower interval with a smaller size range reads as a
      // gentle pulse instead of a rapid flicker.
      const interval = reduceMotion ? 320 : 110;
      const baseH = reduceMotion ? 4 : 3;
      const rangeH = reduceMotion ? 3 : 7;
      const baseW = reduceMotion ? 16 : 14;
      const rangeW = reduceMotion ? 5 : 10;
      talkTimer = setInterval(() => {
        mouth.style.height = (baseH + Math.random() * rangeH) + 'px';
        mouth.style.width = (baseW + Math.random() * rangeW) + 'px';
      }, interval);
    }
    function stopTalking() {
      if (talkTimer) clearInterval(talkTimer);
      talkTimer = null;
      mouth.style.height = '3px';
      mouth.style.width = '16px';
    }

    // ---- react to AxiomBrain state ----
    function applyState(state) {
      avatar.className = avatar.className.replace(/\smood-\S+/g, '');
      avatar.classList.add('mood-' + state.activity);
      if (state.activity === 'speaking') startTalking(); else stopTalking();

      panel.querySelector('[data-axiom-day]').textContent = state.day;
      panel.querySelector('[data-axiom-activity]').textContent =
        state.activity.charAt(0).toUpperCase() + state.activity.slice(1);
      panel.querySelector('[data-axiom-tod]').textContent =
        state.timeOfDay.charAt(0).toUpperCase() + state.timeOfDay.slice(1);
      panel.querySelector('[data-axiom-agents]').textContent = state.agentCount || 4;
    }

    applyState(window.AxiomBrain.getState());
    window.AxiomBrain.on('change', applyState);

    // ---- Ultimate Voice: any page's voice controller reacts here ----
    // Milestone 3: this used to write straight into AxiomBrain, racing
    // with anything else that also derives Brain's 'activity' field.
    // ai-state-manager.js is now the one place that writes
    // AxiomBrain's activity (driveBrain()), so when it's present this
    // listener steps aside entirely. The raw listener is kept as a
    // fallback only for the (currently nonexistent) case of this file
    // loading without ai-state-manager.js, so nothing regresses.
    if (!window.AxiomAIState) {
      document.addEventListener('axiom:voice-state', e => {
        const s = (e.detail && e.detail.state) || 'idle';
        const activity = s === 'paused' ? 'idle' : s; // listening | speaking | idle
        window.AxiomBrain.setState({ activity });
      });
    }
  }
})();
