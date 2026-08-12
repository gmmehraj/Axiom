// ============================================================
// AXIOM AI OS — Milestone 6: Voice Agent Adapter Kit
// ------------------------------------------------------------
// Prepares the Voice Agent architecture WITHOUT hard-coding any
// specific speech provider. Concrete speech backends (browser
// Web Speech API today; a cloud STT/TTS vendor later) register
// themselves as adapters against one small interface, and the
// Voice Agent only ever talks to "the active adapter" — never to
// a vendor SDK directly. Swapping providers later is a
// registerSTTProvider()/registerTTSProvider() call, not a rewrite
// of the Voice Agent.
//
// Adapter contract (both optional — an adapter can implement
// either half, or both):
//   STT adapter:  { transcribe(opts) -> Promise<{ text }> ,
//                   start(onResult) -> stop(), isSupported() }
//   TTS adapter:  { speak(text, opts) -> Promise<void>,
//                   cancel(), isSupported() }
//
// A "browser" adapter is registered by default using the Web
// Speech API (SpeechRecognition / speechSynthesis) purely as a
// working reference implementation — it is not a required
// dependency, and the kit degrades gracefully (isSupported():
// false) wherever that API doesn't exist.
//
// Public surface — window.AxiomVoiceAdapters:
//   .registerSTTProvider(name, adapter)
//   .registerTTSProvider(name, adapter)
//   .setActiveSTT(name) / .setActiveTTS(name)
//   .listProviders() -> { stt:[names], tts:[names] }
//   .transcribe(opts) -> Promise<{ text }>
//   .speak(text, opts) -> Promise<void>
//   .startListening(onResult) -> stopFn
//   .routeVoiceCommand(text) -> routing decision (via AxiomTaskRouter)
// ============================================================
window.AxiomVoiceAdapters = (function () {
  'use strict';

  var sttProviders = {};
  var ttsProviders = {};
  var activeSTT = null;
  var activeTTS = null;

  function registerSTTProvider(name, adapter) {
    if (!name || !adapter) throw new Error('registerSTTProvider requires a name and adapter.');
    sttProviders[name] = adapter;
    if (!activeSTT) activeSTT = name;
    return name;
  }
  function registerTTSProvider(name, adapter) {
    if (!name || !adapter) throw new Error('registerTTSProvider requires a name and adapter.');
    ttsProviders[name] = adapter;
    if (!activeTTS) activeTTS = name;
    return name;
  }
  function setActiveSTT(name) { if (sttProviders[name]) activeSTT = name; return activeSTT; }
  function setActiveTTS(name) { if (ttsProviders[name]) activeTTS = name; return activeTTS; }
  function listProviders() { return { stt: Object.keys(sttProviders), tts: Object.keys(ttsProviders) }; }

  function transcribe(opts) {
    var adapter = activeSTT && sttProviders[activeSTT];
    if (!adapter || typeof adapter.transcribe !== 'function') {
      return Promise.reject(new Error('No speech-to-text adapter is registered/active.'));
    }
    return Promise.resolve(adapter.transcribe(opts || {}));
  }

  function startListening(onResult) {
    var adapter = activeSTT && sttProviders[activeSTT];
    if (!adapter || typeof adapter.start !== 'function') {
      throw new Error('No speech-to-text adapter supports continuous listening.');
    }
    return adapter.start(onResult);
  }

  function speak(text, opts) {
    var adapter = activeTTS && ttsProviders[activeTTS];
    if (!adapter || typeof adapter.speak !== 'function') {
      return Promise.reject(new Error('No text-to-speech adapter is registered/active.'));
    }
    return Promise.resolve(adapter.speak(text, opts || {}));
  }

  // "Voice command routing": a transcribed utterance is handed to the SAME
  // Task Router every other request goes through — voice is just another
  // entry point into routing, not a parallel decision system.
  function routeVoiceCommand(text) {
    var router = window.AxiomTaskRouter;
    if (!router) throw new Error('Task Router is unavailable on this page.');
    return router.route(text);
  }

  // -------------------- Default "browser" adapter (Web Speech API) -------
  // A real, working implementation — not a stub — but entirely optional:
  // if SpeechRecognition/speechSynthesis don't exist, isSupported() says
  // so and the Voice Agent handler falls back gracefully (Step 6, Voice
  // Agent already has a non-live fallback in agent-definitions.js).
  (function registerBrowserAdapter() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    registerSTTProvider('browser', {
      isSupported: function () { return !!SpeechRecognition; },
      transcribe: function () {
        return new Promise(function (resolve, reject) {
          if (!SpeechRecognition) { reject(new Error('SpeechRecognition is not available in this browser.')); return; }
          var rec = new SpeechRecognition();
          rec.lang = 'en-US';
          rec.interimResults = false;
          rec.maxAlternatives = 1;
          rec.onresult = function (e) { resolve({ text: e.results[0][0].transcript }); };
          rec.onerror = function (e) { reject(new Error('Speech recognition error: ' + e.error)); };
          rec.onend = function () { /* resolved/rejected already, or the caller hears silence */ };
          try { rec.start(); } catch (e) { reject(e); }
        });
      },
      start: function (onResult) {
        if (!SpeechRecognition) throw new Error('SpeechRecognition is not available in this browser.');
        var rec = new SpeechRecognition();
        rec.lang = 'en-US';
        rec.continuous = true;
        rec.interimResults = false;
        rec.onresult = function (e) {
          var text = e.results[e.results.length - 1][0].transcript;
          try { onResult({ text: text }); } catch (err) { /* isolate listener errors */ }
        };
        rec.start();
        return function stop() { try { rec.stop(); } catch (e) { /* already stopped */ } };
      }
    });

    registerTTSProvider('browser', {
      isSupported: function () { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); },
      speak: function (text, opts) {
        return new Promise(function (resolve, reject) {
          if (!window.speechSynthesis) { reject(new Error('speechSynthesis is not available in this browser.')); return; }
          var utter = new SpeechSynthesisUtterance(String(text || ''));
          if (opts && opts.rate) utter.rate = opts.rate;
          if (opts && opts.pitch) utter.pitch = opts.pitch;
          utter.onend = function () { resolve(); };
          utter.onerror = function (e) { reject(new Error('Speech synthesis error: ' + e.error)); };
          window.speechSynthesis.speak(utter);
        });
      },
      cancel: function () { if (window.speechSynthesis) window.speechSynthesis.cancel(); }
    });
  })();

  return {
    registerSTTProvider: registerSTTProvider,
    registerTTSProvider: registerTTSProvider,
    setActiveSTT: setActiveSTT,
    setActiveTTS: setActiveTTS,
    listProviders: listProviders,
    transcribe: transcribe,
    startListening: startListening,
    speak: speak,
    routeVoiceCommand: routeVoiceCommand
  };
})();
