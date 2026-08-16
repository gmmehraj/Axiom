// ============================================================
// AXIOM — ElevenLabs voice provider
// ------------------------------------------------------------
// Secure cloud TTS adapter. The ElevenLabs API key never reaches
// the browser; audio is requested from the authenticated Supabase
// Edge Function and played locally.
// ============================================================
(function (global) {
  'use strict';
  var EDGE_ACTION = 'elevenlabs-tts';
  // Axiom default voice: user-selected ElevenLabs voice.
  var DEFAULT_VOICE_ID = 'dVTC43Yewy5fAIcmsISI';
  var DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
  var providerReady = false;
  var currentAudio = null;

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
      if (global.AxiomSupabaseAuth && typeof global.AxiomSupabaseAuth.getSession === 'function') session = await global.AxiomSupabaseAuth.getSession();
    } catch (_) {}
    if (!session || !session.access_token) throw new Error('Please sign in to use ElevenLabs voice.');
    return {
      Authorization: 'Bearer ' + session.access_token,
      apikey: (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : ''),
      'Content-Type': 'application/json'
    };
  }

  async function request(payload) {
    var url = getSupabaseUrl();
    if (!url) throw new Error('Axiom voice service is not configured.');
    var response = await fetch(url.replace(/\/$/, '') + '/functions/v1/' + EDGE_ACTION, {
      method: 'POST', headers: await authHeaders(), body: JSON.stringify(payload)
    });
    if (!response.ok) {
      var detail = '';
      try { var json = await response.json(); detail = json && json.error ? String(json.error) : ''; } catch (_) {}
      throw new Error(detail || ('ElevenLabs request failed (' + response.status + ').'));
    }
    return response;
  }

  async function requestAudio(payload) { return (await request(payload)).blob(); }

  function playBlob(blob, opts) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      var cleaned = false;
      function cleanup() { if (!cleaned) { cleaned = true; URL.revokeObjectURL(url); } }
      function finish() { cleanup(); if (currentAudio === audio) currentAudio = null; }
      audio.onplay = function () { if (opts && opts.onStart) opts.onStart(); };
      audio.onended = function () { finish(); if (opts && opts.onEnd) opts.onEnd(); resolve(); };
      audio.onerror = function () { finish(); if (opts && opts.onError) opts.onError('audio-error'); reject(new Error('Unable to play ElevenLabs audio.')); };
      audio.volume = opts && typeof opts.volume === 'number' ? Math.max(0, Math.min(1, opts.volume)) : 1;
      currentAudio = audio;
      global.__AxiomElevenAudio = audio;
      audio.play().catch(function (err) { finish(); if (opts && opts.onError) opts.onError('playback-blocked'); reject(err); });
    });
  }

  var adapter = {
    isSupported: function () { return !!global.fetch && !!global.Audio; },
    speak: async function (text, opts) {
      opts = opts || {};
      var settings = global.JarvisVoiceController && global.JarvisVoiceController.getSettings ? global.JarvisVoiceController.getSettings() : {};
      var lang = opts.lang || settings.voiceLang || (global.AxiomI18n ? global.AxiomI18n.getLanguage() : 'en');
      var voiceId = opts.voiceId || settings.elevenLabsVoiceId || DEFAULT_VOICE_ID;
      var modelId = opts.modelId || settings.elevenLabsModelId || DEFAULT_MODEL_ID;

      cancel();
      var payload = {
        action: 'speak', text: String(text || ''), voice_id: voiceId, model_id: modelId,
        voice_settings: {
          stability: typeof settings.elevenLabsStability === 'number' ? settings.elevenLabsStability : 0.45,
          similarity_boost: typeof settings.elevenLabsSimilarity === 'number' ? settings.elevenLabsSimilarity : 0.8,
          style: typeof settings.elevenLabsStyle === 'number' ? settings.elevenLabsStyle : 0.15,
          use_speaker_boost: true
        }
      };
      if (modelId !== 'eleven_multilingual_v2' && lang) payload.language_code = String(lang).replace('_', '-').split('-')[0];
      var blob = await requestAudio(payload);
      return playBlob(blob, opts);
    },
    cancel: cancel
  };

  function cancel() {
    var audio = currentAudio || global.__AxiomElevenAudio;
    if (audio) { try { audio.pause(); audio.currentTime = 0; } catch (_) {} currentAudio = null; }
    global.__AxiomElevenAudio = null;
  }

  function register() {
    if (providerReady) return true;
    if (!global.AxiomVoiceAdapters) return false;
    global.AxiomVoiceAdapters.registerTTSProvider('elevenlabs', adapter);
    global.AxiomVoiceAdapters.setActiveTTS('elevenlabs');
    providerReady = true;
    document.dispatchEvent(new CustomEvent('axiom:voice-provider-ready', { detail: { provider: 'elevenlabs', voiceId: DEFAULT_VOICE_ID } }));
    return true;
  }

  register();
  var retry = setInterval(function () { if (register()) clearInterval(retry); }, 100);

  global.AxiomElevenLabsVoice = {
    register: register, speak: adapter.speak, cancel: adapter.cancel,
    getConfig: function () {
      var s = global.JarvisVoiceController && global.JarvisVoiceController.getSettings ? global.JarvisVoiceController.getSettings() : {};
      return { provider: 'elevenlabs', voiceId: s.elevenLabsVoiceId || DEFAULT_VOICE_ID, modelId: s.elevenLabsModelId || DEFAULT_MODEL_ID };
    }
  };
})(window);
