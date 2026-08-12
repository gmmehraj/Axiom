// ============================================
// AXIOM — JarvisVoiceController (Phase 3)
// App-level voice orchestration built entirely on top of AxiomVoice
// (voice.js), which owns the raw Web Speech API calls. This file owns:
//   - persisted voice settings (rate/pitch/volume/devices/modes)
//   - push-to-talk vs. hands-free/continuous conversation mode
//   - interrupting AI speech when the user starts talking
//   - normalized error codes + a shared axiom:voice-state event so any
//     page (JARVIS panel, Playground, Settings) can drive the same
//     mic/speaker UI off one source of truth
//   - global keyboard shortcuts (Space / Esc / Ctrl+M)
//
// Nothing here touches Supabase, billing, or the AI Core reactor — it only
// dispatches DOM events that existing code (jarvis.js, core-ui.js) can
// listen for, same pattern as the existing axiom:chat-state event.
//
// Load order required on the page: voice.js, then this file.
// ============================================
window.JarvisVoiceController = (function () {
  const SETTINGS_KEY = 'axiom_voice_settings';

  const DEFAULTS = {
    rate: 1,            // 0.5 - 2
    pitch: 1,            // 0 - 2
    volume: 1,            // 0 - 1
    autoSpeak: true,         // read JARVIS's replies aloud automatically
    continuous: false,        // hands-free / continuous conversation mode
    micDeviceId: '',
    speakerDeviceId: '',
    voiceLang: '',            // '' = follow the interface language
    voiceName: '',            // '' = browser default for that language
    noiseSuppression: true,
    echoCancellation: true,
  };

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings(patch) {
    const next = { ...getSettings(), ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    document.dispatchEvent(new CustomEvent('axiom:voice-settings-changed', { detail: next }));
    return next;
  }

  function activeLang() {
    const s = getSettings();
    if (s.voiceLang) return s.voiceLang;
    return window.AxiomI18n ? window.AxiomI18n.getLanguage() : 'en';
  }

  // ---- shared state (idle / listening / speaking / thinking / error) ----
  let state = 'idle';
  function setState(next, extra) {
    state = next;
    document.dispatchEvent(new CustomEvent('axiom:voice-state', { detail: { state: next, ...extra } }));
  }
  function getState() { return state; }

  // ---- error normalization ----
  // Maps the handful of raw error strings the Web Speech API produces
  // (which vary a little browser to browser) to a small stable set of
  // codes the UI can branch on, plus a friendly message.
  const ERROR_MESSAGES = {
    'not-allowed': "Microphone access was denied. Allow microphone access in your browser's site settings to use voice.",
    'permission-denied': "Microphone access was denied. Allow microphone access in your browser's site settings to use voice.",
    'service-not-allowed': 'Speech recognition is blocked by your browser or an extension.',
    'no-speech': "Didn't catch that — no speech was detected.",
    'audio-capture': 'No microphone was found. Check that one is connected and enabled.',
    'no-device': 'No microphone was found. Check that one is connected and enabled.',
    'network': 'Voice recognition needs a network connection — check your connection and try again.',
    'aborted': null, // user-initiated stop, not a real error
    'unsupported': "Your browser doesn't support voice input. Try the latest Chrome, Edge, or Safari.",
    'timeout': 'Listening timed out.',
    'unknown': 'Something went wrong with the microphone.',
  };
  function normalizeError(code) {
    const message = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.unknown;
    return { code, message };
  }

  function isSupported() {
    return {
      recognition: window.AxiomVoice ? window.AxiomVoice.isRecognitionSupported() : false,
      synthesis: window.AxiomVoice ? window.AxiomVoice.isSynthesisSupported() : false,
    };
  }

  // ---- recording timer ----
  let timerHandle = null;
  let timerStart = 0;
  function startTimer(onTick) {
    stopTimer();
    timerStart = Date.now();
    timerHandle = setInterval(() => {
      const secs = Math.floor((Date.now() - timerStart) / 1000);
      if (onTick) onTick(secs);
    }, 250);
  }
  function stopTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  // ---- listening (push-to-talk + hands-free) ----
  let handsFreeActive = false;
  let userStoppedListening = false;

  function stopListening() {
    userStoppedListening = true;
    handsFreeActive = false;
    window.AxiomVoice.stopListening();
    stopTimer();
    if (state === 'listening') setState('idle');
  }

  // opts: { onInterim(text), onFinal(text), onError({code,message}), onTick(seconds) }
  function pushToTalkStart(opts = {}) {
    if (!window.AxiomVoice || !window.AxiomVoice.isRecognitionSupported()) {
      if (opts.onError) opts.onError(normalizeError('unsupported'));
      return;
    }
    // Interrupt any AI speech in progress — talking over JARVIS should
    // stop it, not queue behind it.
    interrupt();

    userStoppedListening = false;
    setState('listening');
    startTimer(opts.onTick);

    window.AxiomVoice.startListening({
      lang: window.AxiomVoice.toSpeechLang(activeLang()),
      interim: true,
      continuous: false,
      onResult: (text, isFinal) => {
        if (isFinal) {
          stopTimer();
          if (opts.onFinal) opts.onFinal(text);
        } else if (opts.onInterim) {
          opts.onInterim(text);
        }
      },
      onError: (err) => {
        stopTimer();
        if (state === 'listening') setState('idle');
        const normalized = normalizeError(err);
        if (normalized.message && opts.onError) opts.onError(normalized);
      },
      onEnd: () => {
        stopTimer();
        if (state === 'listening') setState('idle');
      },
    });
  }

  // Continuous conversation mode: keeps re-listening after every final
  // result until the user explicitly stops it, so a whole back-and-forth
  // can happen hands-free. Each finished utterance fires onFinal — the
  // caller decides when to also speak the reply back before we resume
  // listening (see JarvisVoiceController.speak's onEnd hook usage).
  function handsFreeStart(opts = {}) {
    if (!window.AxiomVoice || !window.AxiomVoice.isRecognitionSupported()) {
      if (opts.onError) opts.onError(normalizeError('unsupported'));
      return;
    }
    interrupt();
    userStoppedListening = false;
    handsFreeActive = true;
    setState('listening');
    startTimer(opts.onTick);

    const relisten = () => {
      if (!handsFreeActive || userStoppedListening) return;
      window.AxiomVoice.startListening({
        lang: window.AxiomVoice.toSpeechLang(activeLang()),
        interim: true,
        continuous: true,
        onResult: (text, isFinal) => {
          if (isFinal && text.trim()) {
            if (opts.onFinal) opts.onFinal(text);
          } else if (opts.onInterim) {
            opts.onInterim(text);
          }
        },
        onError: (err) => {
          const normalized = normalizeError(err);
          if (err === 'no-speech') { relisten(); return; } // keep waiting in hands-free mode
          handsFreeActive = false;
          stopTimer();
          setState('idle');
          if (normalized.message && opts.onError) opts.onError(normalized);
        },
        onEnd: () => {
          // Recognition auto-stops after a pause even in continuous mode
          // on most browsers — restart it seamlessly unless the user (or
          // an unrecoverable error) turned hands-free off.
          if (handsFreeActive && !userStoppedListening) relisten();
          else { stopTimer(); setState('idle'); }
        },
      });
    };
    relisten();
  }

  function isHandsFreeActive() { return handsFreeActive; }

  // ---- speaking (TTS) ----
  function speak(text, opts = {}) {
    if (!window.AxiomVoice || !window.AxiomVoice.isSynthesisSupported()) {
      if (opts.onError) opts.onError(normalizeError('unsupported'));
      return;
    }
    if (!text || !text.trim()) return;
    const s = getSettings();
    if (opts.interrupt !== false) window.AxiomVoice.stopSpeaking();

    window.AxiomVoice.speak(text, {
      lang: window.AxiomVoice.toSpeechLang(opts.lang || activeLang()),
      rate: s.rate,
      pitch: s.pitch,
      volume: s.volume,
      voiceName: s.voiceName || undefined,
      onStart: () => { setState('speaking'); if (opts.onStart) opts.onStart(); },
      onEnd: () => { if (state === 'speaking') setState('idle'); if (opts.onEnd) opts.onEnd(); },
      onError: (err) => {
        if (state === 'speaking') setState('idle');
        if (opts.onError) opts.onError(normalizeError(err));
      },
    });
  }

  function pauseSpeaking() { window.AxiomVoice.pauseSpeaking(); setState('paused'); }
  function resumeSpeaking() { window.AxiomVoice.resumeSpeaking(); setState('speaking'); }
  function stopSpeaking() {
    window.AxiomVoice.stopSpeaking();
    if (state === 'speaking' || state === 'paused') setState('idle');
  }

  // Stops whichever of listening/speaking is currently active — used
  // whenever the other one is about to start, so the two never overlap
  // (talking over JARVIS interrupts it; JARVIS replying stops the mic).
  function interrupt() {
    if (window.AxiomVoice && window.AxiomVoice.isSpeaking()) window.AxiomVoice.stopSpeaking();
  }

  // ---- devices ----
  async function requestMicPermission() {
    const s = getSettings();
    await window.AxiomVoice.requestMicAccess({
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      deviceId: s.micDeviceId || undefined,
    });
  }

  async function listDevices() {
    const [inputs, outputs] = await Promise.all([
      window.AxiomVoice.listInputDevices(),
      window.AxiomVoice.listOutputDevices(),
    ]);
    return { inputs, outputs, outputSelectable: window.AxiomVoice.isOutputSelectionSupported() };
  }

  // ---- keyboard shortcuts ----
  // Space = push-to-talk (held) — only while the target isn't a text
  // field, so typing a space in chat still works normally.
  // Esc = stop speaking (falls through to existing panel-close behavior
  // if nothing was speaking).
  // Ctrl/Cmd+M = toggle mic on/off.
  function bindShortcuts({ onPTTDown, onPTTUp, onToggleMic, onStopSpeaking } = {}) {
    function isTypingTarget(el) {
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTypingTarget(e.target) && onPTTDown && !e.repeat) {
        e.preventDefault();
        onPTTDown();
      }
      if (e.key === 'Escape' && (window.AxiomVoice && window.AxiomVoice.isSpeaking())) {
        if (onStopSpeaking) onStopSpeaking();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (onToggleMic) onToggleMic();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && !isTypingTarget(e.target) && onPTTUp) onPTTUp();
    });
  }

  return {
    DEFAULTS,
    getSettings,
    saveSettings,
    isSupported,
    getState,
    pushToTalkStart,
    handsFreeStart,
    stopListening,
    isHandsFreeActive,
    speak,
    pauseSpeaking,
    resumeSpeaking,
    stopSpeaking,
    interrupt,
    requestMicPermission,
    listDevices,
    bindShortcuts,
    normalizeError,
  };
})();
