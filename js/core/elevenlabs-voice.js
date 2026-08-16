// ============================================================
// AXIOM — ElevenLabs voice provider
// ------------------------------------------------------------
// Registers ElevenLabs as the cloud TTS adapter without exposing
// ELEVENLABS_API_KEY to the browser. Audio is requested from the
// authenticated Supabase Edge Function and played locally.
// ============================================================
(function (global) {
  'use strict';

  var EDGE_ACTION = 'elevenlabs-tts';
  var DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
  var DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
  var providerReady = false;

  function getSupabaseUrl() {
    try {
      if (global.AxiomSupabaseEnv && typeof global.AxiomSupabaseEnv.validate === 'function') {
        var env = global.AxiomSupabaseEnv.validate();
        if (env && env.url) return env.url;
      }
    } catch (_) {}
    try { if (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) return SUPABASE_URL; } catch (_) {}
    return '';
  }

  async function authHeaders() {
    var session = null;
    try {
      if (global.AxiomSupabaseAuth && typeof global.AxiomSupabaseAuth.getSession === 'function') {
        session = await global.AxiomSupabaseAuth.getSession();
      }
    } catch (_) {}
    if (!session || !session.access_token) throw new Error('Please sign in to use ElevenLabs voice.');
    return {
      Authorization: 'Bearer ' + session.access_token,
      apikey: (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : ''),
      'Content-Type': 'application/json'
    };
  }

  async function requestAudio(payload) {
    var url = getSupabaseUrl();
    if (!url) throw new Error('Axiom voice service is not configured.');
    var headers = await authHeaders();
    var response = await fetch(url.replace(/\/$/, '') + '/functions/v1/' + EDGE_ACTION, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      var detail = '';
      try { var json = await response.json(); detail = json && json.error ? String(json.error) : ''; } catch (_) {}
      throw new Error(detail || ('ElevenLabs request failed (' + response.status + ').'));
    }
    return response.blob();
  }

  function playBlob(blob, opts) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      var cleaned = false;
      function cleanup() {
        if (cleaned) return;
        cleaned = true;
        URL.revokeObjectURL(url);
      }
      audio.onplay = function () { if (opts && opts.onStart) opts.onStart(); };
      audio.onended = function () { cleanup(); if (opts && opts.onEnd) opts.onEnd(); resolve(); };
      audio.onerror = function () { cleanup(); if (opts && opts.onError) opts.onError('audio-error'); reject(new Error('Unable to play ElevenLabs audio.')); };
      audio.volume = opts && typeof opts.volume === 'number' ? Math.max(0, Math.min(1, opts.volume)) : 1;
      global.__AxiomElevenAudio = audio;
      audio.play().catch(function (err) { cleanup(); if (opts && opts.onError) opts.onError('playback-blocked'); reject(err); });
    });
  }

  var adapter = {
    isSupported: function () { return !!global.fetch && !!global.Audio; },
    speak: async function (text, opts) {
      opts = opts || {};
      var settings = global.JarvisVoiceController && global.JarvisVoiceController.getSettings
        ? global.JarvisVoiceController.getSettings()
        : {};
      var lang = opts.lang || settings.voiceLang || (global.AxiomI18n ? global.AxiomI18n.getLanguage() : 'en');
      var languageCode = String(lang).replace('_', '-');
      var voiceId = opts.voiceId || settings.elevenLabsVoiceId || DEFAULT_VOICE_ID;
      var modelId = opts.modelId || settings.elevenLabsModelId || DEFAULT_MODEL_ID;

      if (global.__AxiomElevenAudio) {
        try { global.__AxiomElevenAudio.pause(); global.__AxiomElevenAudio.currentTime = 0; } catch (_) {}
      }

      var blob = await requestAudio({
        action: 'speak',
        text: String(text || ''),
        voice_id: voiceId,
        model_id: modelId,
        language_code: languageCode,
        voice_settings: {
          stability: typeof settings.elevenLabsStability === 'number' ? settings.elevenLabsStability : 0.45,
          similarity_boost: typeof settings.elevenLabsSimilarity === 'number' ? settings.elevenLabsSimilarity : 0.8,
          style: typeof settings.elevenLabsStyle === 'number' ? settings.elevenLabsStyle : 0.15,
          use_speaker_boost: true
        }
      });
      return playBlob(blob, opts);
    },
    cancel: function () {
      if (global.__AxiomElevenAudio) {
        try { global.__AxiomElevenAudio.pause(); global.__AxiomElevenAudio.currentTime = 0; } catch (_) {}
      }
    }
  };

  function register() {
    if (!global.AxiomVoiceAdapters || providerReady) return;
    global.AxiomVoiceAdapters.registerTTSProvider('elevenlabs', adapter);
    global.AxiomVoiceAdapters.setActiveTTS('elevenlabs');
    providerReady = true;
  }

  register();
  global.AxiomElevenLabsVoice = { register: register, speak: adapter.speak, cancel: adapter.cancel };
})(window);
