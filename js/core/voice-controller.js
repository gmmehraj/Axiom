// ============================================
// AXIOM — JarvisVoiceController (Phase 3)
// App-level voice orchestration built on top of AxiomVoice and the
// provider registry. Browser Web Speech remains the STT fallback;
// ElevenLabs can own TTS without changing the public controller API.
// ============================================
window.JarvisVoiceController = (function () {
  const SETTINGS_KEY = 'axiom_voice_settings';

  const DEFAULTS = {
    rate: 1,
    pitch: 1,
    volume: 1,
    autoSpeak: true,
    continuous: false,
    micDeviceId: '',
    speakerDeviceId: '',
    voiceLang: '',
    voiceName: '',
    noiseSuppression: true,
    echoCancellation: true,
    // Cloud TTS settings. These are identifiers/settings only — never secrets.
    voiceProvider: 'elevenlabs',
    elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
    elevenLabsModelId: 'eleven_multilingual_v2',
    elevenLabsStability: 0.45,
    elevenLabsSimilarity: 0.8,
    elevenLabsStyle: 0.15,
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

  let state = 'idle';
  function setState(next, extra) {
    state = next;
    document.dispatchEvent(new CustomEvent('axiom:voice-state', { detail: { state: next, ...extra } }));
  }
  function getState() { return state; }

  const ERROR_MESSAGES = {
    'not-allowed': "Microphone access was denied. Allow microphone access in your browser's site settings to use voice.",
    'permission-denied': "Microphone access was denied. Allow microphone access in your browser's site settings to use voice.",
    'service-not-allowed': 'Speech recognition is blocked by your browser or an extension.',
    'no-speech': "Didn't catch that — no speech was detected.",
    'audio-capture': 'No microphone was found. Check that one is connected and enabled.',
    'no-device': 'No microphone was found. Check that one is connected and enabled.',
    'network': 'Voice recognition needs a network connection — check your connection and try again.',
    'aborted': null,
    'unsupported': "Your browser doesn't support voice input. Try the latest Chrome, Edge, or Safari.",
    'timeout': 'Listening timed out.',
    'unknown': 'Something went wrong with the microphone.',
  };
  function normalizeError(code) {
    const message = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.unknown;
    return { code, message };
  }

  function isSupported() {
    const provider = getSettings().voiceProvider;
    const cloud = !!(window.AxiomElevenLabsVoice && window.AxiomVoiceAdapters);
    return {
      recognition: window.AxiomVoice ? window.AxiomVoice.isRecognitionSupported() : false,
      synthesis: provider === 'elevenlabs' ? cloud : (window.AxiomVoice ? window.AxiomVoice.isSynthesisSupported() : false),
    };
  }

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

  let handsFreeActive = false;
  let userStoppedListening = false;

  function stopListening() {
    userStoppedListening = true;
    handsFreeActive = false;
    if (window.AxiomVoice) window.AxiomVoice.stopListening();
    stopTimer();
    if (state === 'listening') setState('idle');
  }

  function pushToTalkStart(opts = {}) {
    if (!window.AxiomVoice || !window.AxiomVoice.isRecognitionSupported()) {
      if (opts.onError) opts.onError(normalizeError('unsupported'));
      return;
    }
    interrupt();
    userStoppedListening = false;
    setState('listening');
    startTimer(opts.onTick);
    window.AxiomVoice.startListening({
      lang: window.AxiomVoice.toSpeechLang(activeLang()),
      interim: true,
      continuous: false,
      onResult: (text, isFinal) => {
        if (isFinal) { stopTimer(); if (opts.onFinal) opts.onFinal(text); }
        else if (opts.onInterim) opts.onInterim(text);
      },
      onError: (err) => {
        stopTimer();
        if (state === 'listening') setState('idle');
        const normalized = normalizeError(err);
        if (normalized.message && opts.onError) opts.onError(normalized);
      },
      onEnd: () => { stopTimer(); if (state === 'listening') setState('idle'); },
    });
  }

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
          if (isFinal && text.trim()) { if (opts.onFinal) opts.onFinal(text); }
          else if (opts.onInterim) opts.onInterim(text);
        },
        onError: (err) => {
          const normalized = normalizeError(err);
          if (err === 'no-speech') { relisten(); return; }
          handsFreeActive = false; stopTimer(); setState('idle');
          if (normalized.message && opts.onError) opts.onError(normalized);
        },
        onEnd: () => {
          if (handsFreeActive && !userStoppedListening) relisten();
          else { stopTimer(); setState('idle'); }
        },
      });
    };
    relisten();
  }

  function isHandsFreeActive() { return handsFreeActive; }

  function speak(text, opts = {}) {
    if (!text || !String(text).trim()) return Promise.resolve();
    const s = getSettings();
    const useElevenLabs = s.voiceProvider === 'elevenlabs';

    // The cloud bridge owns ElevenLabs TTS. Do not require browser
    // speechSynthesis support when cloud TTS is selected.
    if (useElevenLabs && window.AxiomElevenLabsVoice && window.AxiomVoiceAdapters) {
      return window.AxiomElevenLabsVoice.speak(String(text), {
        lang: opts.lang || activeLang(),
        voiceId: opts.voiceId,
        modelId: opts.modelId,
        volume: s.volume,
        onStart: () => { setState('speaking', { provider: 'elevenlabs' }); if (opts.onStart) opts.onStart(); },
        onEnd: () => { if (state === 'speaking') setState('idle'); if (opts.onEnd) opts.onEnd(); },
        onError: (err) => { if (state === 'speaking') setState('idle'); if (opts.onError) opts.onError(err); },
      });
    }

    if (!window.AxiomVoice || !window.AxiomVoice.isSynthesisSupported()) {
      if (opts.onError) opts.onError(normalizeError('unsupported'));
      return Promise.reject(new Error('Speech synthesis is not available.'));
    }
    if (opts.interrupt !== false) window.AxiomVoice.stopSpeaking();
    return new Promise((resolve, reject) => {
      window.AxiomVoice.speak(text, {
        lang: window.AxiomVoice.toSpeechLang(opts.lang || activeLang()),
        rate: s.rate, pitch: s.pitch, volume: s.volume,
        voiceName: s.voiceName || undefined,
        onStart: () => { setState('speaking', { provider: 'browser' }); if (opts.onStart) opts.onStart(); },
        onEnd: () => { if (state === 'speaking') setState('idle'); if (opts.onEnd) opts.onEnd(); resolve(); },
        onError: (err) => { if (state === 'speaking') setState('idle'); if (opts.onError) opts.onError(normalizeError(err)); reject(err); },
      });
    });
  }

  function pauseSpeaking() { if (window.AxiomVoice) window.AxiomVoice.pauseSpeaking(); setState('paused'); }
  function resumeSpeaking() { if (window.AxiomVoice) window.AxiomVoice.resumeSpeaking(); setState('speaking'); }
  function stopSpeaking() {
    if (window.AxiomElevenLabsVoice) window.AxiomElevenLabsVoice.cancel();
    if (window.AxiomVoice) window.AxiomVoice.stopSpeaking();
    if (state === 'speaking' || state === 'paused') setState('idle');
  }
  function interrupt() {
    if (window.AxiomElevenLabsVoice) window.AxiomElevenLabsVoice.cancel();
    if (window.AxiomVoice && window.AxiomVoice.isSpeaking()) window.AxiomVoice.stopSpeaking();
  }

  async function requestMicPermission() {
    const s = getSettings();
    await window.AxiomVoice.requestMicAccess({ echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, deviceId: s.micDeviceId || undefined });
  }
  async function listDevices() {
    const [inputs, outputs] = await Promise.all([window.AxiomVoice.listInputDevices(), window.AxiomVoice.listOutputDevices()]);
    return { inputs, outputs, outputSelectable: window.AxiomVoice.isOutputSelectionSupported() };
  }

  function bindShortcuts({ onPTTDown, onPTTUp, onToggleMic, onStopSpeaking } = {}) {
    function isTypingTarget(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); }
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTypingTarget(e.target) && onPTTDown && !e.repeat) { e.preventDefault(); onPTTDown(); }
      if (e.key === 'Escape' && onStopSpeaking && (state === 'speaking' || state === 'paused')) { onStopSpeaking(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') { e.preventDefault(); if (onToggleMic) onToggleMic(); }
    });
    document.addEventListener('keyup', (e) => { if (e.code === 'Space' && !isTypingTarget(e.target) && onPTTUp) onPTTUp(); });
  }

  return {
    DEFAULTS, getSettings, saveSettings, isSupported, getState,
    pushToTalkStart, handsFreeStart, stopListening, isHandsFreeActive,
    speak, pauseSpeaking, resumeSpeaking, stopSpeaking, interrupt,
    requestMicPermission, listDevices, bindShortcuts, normalizeError,
  };
})();
