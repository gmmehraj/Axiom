// ============================================
// AXIOM / JARVIS — multilingual voice
// Thin wrapper around the Web Speech API (SpeechRecognition +
// SpeechSynthesis), kept language-aware via AxiomI18n's active language.
//
// Browser support note: SpeechRecognition is Chrome/Edge/Safari (webkit-
// prefixed) only — Firefox doesn't implement it. Every call here checks for
// availability and fails soft (calling opts.onUnsupported) rather than
// throwing, since jarvis.js already has a "mic unavailable" toast path for
// exactly this case.
// ============================================
window.AxiomVoice = (function () {
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let voicesCache = [];

  function refreshVoices() {
    voicesCache = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    return voicesCache;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
    refreshVoices();
  }

  // Returns the synthesis voices whose lang matches the given locale code,
  // trying an exact match first ("hi-IN") then falling back to the base
  // subtag ("hi") since browsers vary in how many region variants they ship.
  function voicesFor(langCode) {
    const base = langCode.split('-')[0];
    const exact = voicesCache.filter(v => v.lang.toLowerCase().startsWith(langCode.toLowerCase()));
    if (exact.length) return exact;
    return voicesCache.filter(v => v.lang.toLowerCase().startsWith(base.toLowerCase()));
  }

  // Maps our internal registry codes (which include script subtags like
  // "zh-Hans" for UI purposes) to the BCP-47 tags speech APIs expect.
  const SPEECH_LANG_MAP = {
    'zh-Hans': 'zh-CN',
    'zh-Hant': 'zh-TW',
  };
  function toSpeechLang(code) {
    return SPEECH_LANG_MAP[code] || code;
  }

  function startListening(opts = {}) {
    if (!SpeechRecognitionImpl) {
      if (opts.onUnsupported) opts.onUnsupported();
      return null;
    }
    if (recognizer) { try { recognizer.stop(); } catch { /* already stopped */ } }

    const lang = toSpeechLang(opts.lang || (window.AxiomI18n ? window.AxiomI18n.getLanguage() : 'en'));
    recognizer = new SpeechRecognitionImpl();
    recognizer.lang = lang;
    recognizer.interimResults = !!opts.interim;
    recognizer.continuous = !!opts.continuous;

    recognizer.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const transcript = result[0].transcript;
      if (opts.onResult) opts.onResult(transcript, result.isFinal);
    };
    recognizer.onerror = (event) => { if (opts.onError) opts.onError(event.error); };
    recognizer.onend = () => { if (opts.onEnd) opts.onEnd(); };

    recognizer.start();
    return recognizer;
  }

  function stopListening() {
    if (recognizer) { try { recognizer.stop(); } catch { /* no-op */ } }
  }

  function speak(text, opts = {}) {
    if (!window.speechSynthesis) {
      if (opts.onUnsupported) opts.onUnsupported();
      return;
    }
    const lang = toSpeechLang(opts.lang || (window.AxiomI18n ? window.AxiomI18n.getLanguage() : 'en'));
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = opts.rate || 1;
    utterance.pitch = opts.pitch != null ? opts.pitch : 1;
    utterance.volume = opts.volume != null ? opts.volume : 1;

    const preferredVoiceName = opts.voiceName || localStorage.getItem('axiom_voice_' + lang);
    const candidates = voicesFor(lang);
    const chosen = (preferredVoiceName && candidates.find(v => v.name === preferredVoiceName)) || candidates[0];
    if (chosen) utterance.voice = chosen;

    if (opts.onStart) utterance.onstart = opts.onStart;
    if (opts.onEnd) utterance.onend = opts.onEnd;
    if (opts.onError) utterance.onerror = (e) => opts.onError(e.error);
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function pauseSpeaking() {
    if (window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.pause();
  }

  function resumeSpeaking() {
    if (window.speechSynthesis && window.speechSynthesis.paused) window.speechSynthesis.resume();
  }

  function isSpeaking() {
    return !!(window.speechSynthesis && window.speechSynthesis.speaking);
  }

  function isPaused() {
    return !!(window.speechSynthesis && window.speechSynthesis.paused);
  }

  function allVoices() {
    return voicesCache;
  }

  // ---- Device enumeration (mic / speaker) ----
  // Labels are only populated by the browser once mic permission has been
  // granted at least once in this origin — that's a browser privacy rule,
  // not something we can work around, so callers should expect generic
  // "Microphone 1" labels until requestMicAccess() has succeeded once.
  async function listInputDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  async function listOutputDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audiooutput');
  }

  // setSinkId (routing audio output to a chosen speaker/headset) is a
  // Chromium-only API — Safari and Firefox have no equivalent yet, so
  // callers should feature-detect via isOutputSelectionSupported().
  function isOutputSelectionSupported() {
    return typeof HTMLMediaElement !== 'undefined' && !!HTMLMediaElement.prototype.setSinkId;
  }

  // Requests mic access with the given constraints (echo cancellation /
  // noise suppression / a specific deviceId) and immediately releases the
  // stream — callers that need the live stream should call
  // navigator.mediaDevices.getUserMedia() directly. This exists so
  // Settings can "test" a device and so device labels unlock, without
  // leaving a mic track open in the background.
  async function requestMicAccess(constraints = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error('getUserMedia unsupported');
      err.code = 'unsupported';
      throw err;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: constraints.echoCancellation !== false,
          noiseSuppression: constraints.noiseSuppression !== false,
          ...(constraints.deviceId ? { deviceId: { exact: constraints.deviceId } } : {})
        }
      });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch (err) {
      const mapped = new Error(err.message);
      mapped.code = (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') ? 'permission-denied'
        : (err.name === 'NotFoundError') ? 'no-device'
        : 'unknown';
      throw mapped;
    }
  }

  return {
    isRecognitionSupported: () => !!SpeechRecognitionImpl,
    isSynthesisSupported: () => !!window.speechSynthesis,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    pauseSpeaking,
    resumeSpeaking,
    isSpeaking,
    isPaused,
    voicesFor,
    allVoices,
    toSpeechLang,
    refreshVoices,
    listInputDevices,
    listOutputDevices,
    isOutputSelectionSupported,
    requestMicAccess,
  };
})();
