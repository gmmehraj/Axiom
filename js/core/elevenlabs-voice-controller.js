// ============================================================
// AXIOM — ElevenLabs bridge for JarvisVoiceController
// ------------------------------------------------------------
// Keeps the existing voice controller API intact while swapping
// its TTS backend to the active AxiomVoiceAdapters provider.
// ============================================================
(function (global) {
  'use strict';

  var installed = false;

  function install() {
    if (installed || !global.JarvisVoiceController || !global.AxiomVoiceAdapters) return false;
    var controller = global.JarvisVoiceController;
    var originalSpeak = controller.speak;
    var originalStop = controller.stopSpeaking;

    controller.speak = function (text, opts) {
      opts = opts || {};
      if (!text || !String(text).trim()) return;

      var settings = controller.getSettings ? controller.getSettings() : {};
      var useEleven = settings.voiceProvider !== 'browser';
      var providers = global.AxiomVoiceAdapters.listProviders ? global.AxiomVoiceAdapters.listProviders() : { tts: [] };
      if (!useEleven || providers.tts.indexOf('elevenlabs') === -1) {
        return originalSpeak(text, opts);
      }

      if (opts.interrupt !== false && global.AxiomElevenLabsVoice) {
        try { global.AxiomElevenLabsVoice.cancel(); } catch (_) {}
      }

      document.dispatchEvent(new CustomEvent('axiom:voice-state', { detail: { state: 'speaking', provider: 'elevenlabs' } }));
      if (opts.onStart) opts.onStart();

      global.AxiomVoiceAdapters.setActiveTTS('elevenlabs');
      return global.AxiomVoiceAdapters.speak(String(text), {
        lang: opts.lang,
        voiceId: opts.voiceId,
        modelId: opts.modelId,
        volume: settings.volume,
        onStart: function () {},
        onEnd: function () {
          document.dispatchEvent(new CustomEvent('axiom:voice-state', { detail: { state: 'idle', provider: 'elevenlabs' } }));
          if (opts.onEnd) opts.onEnd();
        },
        onError: function (err) {
          document.dispatchEvent(new CustomEvent('axiom:voice-state', { detail: { state: 'error', provider: 'elevenlabs', error: err } }));
        }
      }).catch(function (err) {
        document.dispatchEvent(new CustomEvent('axiom:voice-state', { detail: { state: 'idle', provider: 'elevenlabs' } }));
        // If the cloud provider is unavailable, preserve Axiom's existing
        // browser TTS behavior rather than leaving the user speechless.
        if (settings.voiceProvider === 'elevenlabs') {
          if (opts.onError) opts.onError('elevenlabs-error');
          return Promise.reject(err);
        }
        return originalSpeak(text, opts);
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
