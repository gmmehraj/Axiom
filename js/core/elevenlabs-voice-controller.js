// ============================================================
// AXIOM — ElevenLabs bridge for JarvisVoiceController
// ============================================================
(function (global) {
  'use strict';
  var installed = false;
  var DEFAULT_VOICE_ID = 'dVTC43Yewy5fAIcmsISI';
  var DEFAULT_MODEL_ID = 'eleven_multilingual_v2';

  function emit(state, extra) {
    document.dispatchEvent(new CustomEvent('axiom:voice-state', { detail: Object.assign({ state: state, provider: 'elevenlabs' }, extra || {}) }));
  }

  function install() {
    if (installed || !global.JarvisVoiceController || !global.AxiomVoiceAdapters) return false;
    var controller = global.JarvisVoiceController;
    var originalSpeak = controller.speak;
    var originalStop = controller.stopSpeaking;

    controller.speak = function (text, opts) {
      opts = opts || {};
      if (!text || !String(text).trim()) return Promise.resolve();
      var settings = controller.getSettings ? controller.getSettings() : {};
      var useEleven = settings.voiceProvider !== 'browser';
      var providers = global.AxiomVoiceAdapters.listProviders ? global.AxiomVoiceAdapters.listProviders() : { tts: [] };
      var hasEleven = providers.tts.indexOf('elevenlabs') !== -1;
      if (!useEleven || !hasEleven) return originalSpeak(text, opts);

      var voiceId = opts.voiceId || settings.voiceId || settings.elevenLabsVoiceId || DEFAULT_VOICE_ID;
      var modelId = opts.modelId || settings.modelId || settings.elevenLabsModelId || DEFAULT_MODEL_ID;
      if (opts.interrupt !== false && global.AxiomElevenLabsVoice) {
        try { global.AxiomElevenLabsVoice.cancel(); } catch (_) {}
      }
      emit('speaking', { voiceId: voiceId, modelId: modelId });
      if (opts.onStart) opts.onStart();
      global.AxiomVoiceAdapters.setActiveTTS('elevenlabs');
      return global.AxiomVoiceAdapters.speak(String(text), {
        lang: opts.lang,
        voiceId: voiceId,
        modelId: modelId,
        volume: settings.volume,
        onStart: function () {},
        onEnd: function () { emit('idle'); if (opts.onEnd) opts.onEnd(); },
        onError: function (err) { emit('error', { error: err }); }
      }).catch(function (err) {
        emit('error', { error: 'elevenlabs-error' });
        if (global.AxiomVoice && global.AxiomVoice.isSynthesisSupported && global.AxiomVoice.isSynthesisSupported()) {
          try {
            return new Promise(function (resolve, reject) {
              global.AxiomVoice.speak(String(text), {
                lang: global.AxiomVoice.toSpeechLang(opts.lang || settings.voiceLang || 'en'),
                rate: settings.rate, pitch: settings.pitch, volume: settings.volume,
                voiceName: settings.voiceName || undefined,
                onStart: function () { emit('speaking', { provider: 'browser-fallback' }); },
                onEnd: function () { emit('idle', { provider: 'browser-fallback' }); if (opts.onEnd) opts.onEnd(); resolve(); },
                onError: function (browserErr) { emit('idle', { provider: 'browser-fallback' }); if (opts.onError) opts.onError(browserErr); reject(browserErr); }
              });
            });
          } catch (_) {}
        }
        emit('idle');
        if (opts.onError) opts.onError('elevenlabs-error');
        throw err;
      });
    };

    controller.stopSpeaking = function () {
      try { if (global.AxiomElevenLabsVoice) global.AxiomElevenLabsVoice.cancel(); } catch (_) {}
      try { return originalStop(); } catch (_) { return undefined; }
    };
    installed = true;
    return true;
  }
  var installAttempts = 0;
  var timer = setInterval(function () {
    installAttempts++;
    if (install() || installAttempts >= 50) clearInterval(timer);
  }, 100);
  install();
})(window);
