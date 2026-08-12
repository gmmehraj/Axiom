// ============================================================
// AXIOM — Module 10: AI State Engine
// ------------------------------------------------------------
// Everything in Module 10 (holographic environment, global
// lighting, particle system, dashboard "aliveness", camera
// parallax) needs to react to the AI's current state CONSISTENTLY,
// from one place. This file is that one place.
//
// It does not replace or modify the Reactor (Module 1), the Face
// (Modules 2/8.x/9), or the Conversation Bridge (Module 4) — it is
// a thin, additive listener on top of AxiomConversationBridge's
// existing public API (window.AxiomConversationBridge.getState /
// .onStateChange, unchanged), plus one small piece of its own
// logic for a 7th state — "sleeping" — that the Bridge deliberately
// has no concept of, because sleeping isn't a conversation state,
// it's a purely ambient/presentation idea ("nobody has touched
// anything in a while").
//
// Supported states (superset consumed by every Module 10 subsystem):
//   idle · listening · thinking · speaking · heavy · error · sleeping
//
// On pages without the Bridge (Billing, Settings, AI Agents — pages
// with no live conversation), the engine simply stays "idle" (and
// is still eligible to fall asleep after inactivity), so ambient
// effects still work everywhere the Bridge isn't mounted.
//
// Public API — window.AxiomOSState — a new surface only. Nothing
// exported by any other module is renamed, wrapped, or removed.
//
//   AxiomOSState.getState()        -> current state string
//   AxiomOSState.onChange(fn)      -> subscribe; returns an unsubscribe fn
//   AxiomOSState.isReducedMotion() -> bool; every Module 10 subsystem
//                                      checks this before animating
//
// The engine also mirrors the current state onto
// <html data-ai-state="...">, so any stylesheet (this module's or a
// future one) can react to it declaratively via
// `[data-ai-state="thinking"]` selectors with zero extra JS.
// ============================================================
(function () {
  'use strict';

  var STATES = ['idle', 'listening', 'thinking', 'speaking', 'heavy', 'error', 'sleeping'];
  var SLEEP_AFTER_MS = 90000; // 90s of total inactivity while idle -> sleeping
  var root = document.documentElement;

  var current = null; // null (not 'idle') so the very first apply() always runs
  var listeners = new Set();
  var sleepTimer = null;
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function isReducedMotion() { return reduced; }

  function apply(next) {
    if (STATES.indexOf(next) === -1 || next === current) return;
    current = next;
    root.setAttribute('data-ai-state', current);
    listeners.forEach(function (fn) { try { fn(current); } catch (e) { /* isolated */ } });
    try {
      document.dispatchEvent(new CustomEvent('axiom:os-state', { detail: { state: current } }));
    } catch (e) { /* isolated */ }
  }

  // ---- Sleeping detection ---------------------------------------------
  // Purely presentational and independent of the Bridge's own idea of
  // "idle": it only engages after a real stretch of zero input, and any
  // input (or any real conversation state) cancels it immediately.
  function armSleep() {
    clearTimeout(sleepTimer);
    if (current === 'idle') {
      sleepTimer = setTimeout(function () {
        if (current === 'idle') apply('sleeping');
      }, SLEEP_AFTER_MS);
    }
  }
  function wake() {
    if (current === 'sleeping') apply('idle');
    armSleep();
  }
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (evt) {
    window.addEventListener(evt, wake, { passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) wake();
  });

  // ---- Conversation Bridge integration (preferred source of truth) ----
  function fromBridge(next) {
    apply(next);
    armSleep();
  }

  if (window.AxiomConversationBridge && typeof window.AxiomConversationBridge.onStateChange === 'function') {
    apply(typeof window.AxiomConversationBridge.getState === 'function' ? window.AxiomConversationBridge.getState() : 'idle');
    window.AxiomConversationBridge.onStateChange(fromBridge);
  } else {
    apply('idle');
  }
  armSleep();

  window.AxiomOSState = {
    STATES: STATES.slice(),
    getState: function () { return current; },
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    isReducedMotion: isReducedMotion,
  };
})();
