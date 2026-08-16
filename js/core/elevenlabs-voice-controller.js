// ============================================================
// AXIOM — ElevenLabs bridge for JarvisVoiceController
// ------------------------------------------------------------
// Keeps the existing controller API intact while routing TTS through
// the active ElevenLabs provider. Browser speech remains a safe fallback.
// ============================================================
(function (global) {
  'use strict';

  var installed = false;

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

      if (opts.interrupt !== false && global.AxiomElevenLabsVoice) {
        try { global.AxiomElevenLabsVoice.cancel(); } catch (_) {}
      }

      emit('speaking');
      if (opts.onStart) opts.onStart();
      global.AxiomVoiceAdapters.setActiveTTS('elevenlabs');

      return global.AxiomVoiceAdapters.speak(String(text), {
        lang: opts.lang,
        voiceId: opts.voiceId,
        modelId: opts.modelId,
        volume: settings.volume,
        onStart: function () {},
        onEnd: function () {
          emit('idle');
          if (opts.onEnd) opts.onEnd();
        },
        onError: function (err) {
          emit('error', { error: err });
        }
      }).catch(function (err) {
        emit('error', { error: 'elevenlabs-error' });

        // Never leave Axiom silent because a cloud TTS request failed.
        // Fall back to the existing browser TTS when it is available.
        if (global.AxiomVoice && global.AxiomVoice.isSynthesisSupported && global.AxiomVoice.isSynthesisSupported()) {
          try {
            return new Promise(function (resolve, reject) {
              global.AxiomVoice.speak(String(text), {
                lang: global.AxiomVoice.toSpeechLang(opts.lang || settings.voiceLang || 'en'),
                rate: settings.rate,
                pitch: settings.pitch,
                volume: settings.volume,
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

  var timer = setInterval(function () {
    if (install()) clearInterval(timer);
  }, 100);
  install();
})(window);
