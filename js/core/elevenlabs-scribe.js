// ============================================================
// AXIOM — ElevenLabs Scribe v2 Realtime STT
// ------------------------------------------------------------
// Browser microphone -> short-lived server token -> ElevenLabs
// Scribe Realtime WebSocket. The ElevenLabs API key never reaches
// the browser. Falls back cleanly to AxiomVoice when unavailable.
// ============================================================
(function () {
  'use strict';

  const FALLBACK_SUPABASE_URL = 'https://oduzhebaobaojbchxjci.supabase.co';
  const WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
  const SAMPLE_RATE = 16000;
  let socket = null;
  let stream = null;
  let context = null;
  let source = null;
  let processor = null;
  let running = false;
  let sessionId = null;

  function getSupabaseUrl() {
    try {
      if (window.AxiomSupabaseEnv && typeof window.AxiomSupabaseEnv.validate === 'function') {
        const env = window.AxiomSupabaseEnv.validate();
        if (env && env.url) return env.url;
      }
    } catch (_) {}
    try { if (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) return SUPABASE_URL; } catch (_) {}
    return FALLBACK_SUPABASE_URL;
  }

  async function findAccessToken() {
    try {
      if (window.AxiomSupabaseAuth && typeof window.AxiomSupabaseAuth.getSession === 'function') {
        const session = await window.AxiomSupabaseAuth.getSession();
        if (session && session.access_token) return session.access_token;
      }
    } catch (_) {}
    const direct = window.AxiomSupabaseAccessToken || window.__AXIOM_SUPABASE_ACCESS_TOKEN;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
        const raw = localStorage.getItem(key); if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.access_token) return parsed.access_token;
        if (parsed && parsed.currentSession && parsed.currentSession.access_token) return parsed.currentSession.access_token;
      }
    } catch (_) {}
    return '';
  }

  async function fetchToken() {
    const token = await findAccessToken();
    if (!token) throw new Error('Please sign in again to use realtime voice input.');
    const endpoint = getSupabaseUrl().replace(/\/$/, '') + '/functions/v1/elevenlabs-scribe-token';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', apikey: (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '') },
      body: JSON.stringify({ token_type: 'realtime_scribe' }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token) throw new Error(data.error || 'Could not create an ElevenLabs Scribe session.');
    return data.token;
  }

  function downsample(buffer, inputRate) {
    if (inputRate === SAMPLE_RATE) return buffer;
    const ratio = inputRate / SAMPLE_RATE;
    const length = Math.round(buffer.length / ratio);
    const result = new Float32Array(length);
    let offset = 0;
    for (let i = 0; i < length; i++) {
      const nextOffset = Math.min(buffer.length, Math.round((i + 1) * ratio));
      let sum = 0; let count = 0;
      for (let j = offset; j < nextOffset; j++) { sum += buffer[j]; count++; }
      result[i] = count ? sum / count : 0;
      offset = nextOffset;
    }
    return result;
  }

  function pcm16Base64(float32) {
    const bytes = new Uint8Array(float32.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < float32.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    return btoa(binary);
  }

  async function start(options) {
    options = options || {};
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.WebSocket) throw new Error('Realtime voice input is not supported in this browser.');
    const token = await fetchToken();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: options.echoCancellation !== false, noiseSuppression: options.noiseSuppression !== false, autoGainControl: true } });
    context = new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    socket = new WebSocket(WS_URL + '?model_id=scribe_v2_realtime&audio_format=pcm_16000&sample_rate=' + SAMPLE_RATE + '&token=' + encodeURIComponent(token));
    socket.binaryType = 'arraybuffer';

    socket.onopen = function () {
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = function (event) {
        if (!running || !socket || socket.readyState !== WebSocket.OPEN) return;
        const pcm = downsample(event.inputBuffer.getChannelData(0), context.sampleRate);
        socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcm16Base64(pcm), commit: false }));
      };
      source.connect(processor);
      const mute = context.createGain(); mute.gain.value = 0;
      processor.connect(mute); mute.connect(context.destination);
      running = true;
      if (options.onStart) options.onStart();
    };

    socket.onmessage = function (event) {
      let data; try { data = JSON.parse(event.data); } catch (_) { return; }
      if (data.message_type === 'session_started') sessionId = data.session_id || null;
      if (data.message_type === 'partial_transcript' && options.onInterim) options.onInterim(data.text || '');
      if (data.message_type === 'committed_transcript' && options.onFinal) options.onFinal(data.text || '');
      if (data.message_type === 'error' || data.message_type === 'rate_limited') {
        if (options.onError) options.onError(new Error(data.error || 'ElevenLabs Scribe error.'));
        stop();
      }
    };
    socket.onerror = function () { if (options.onError) options.onError(new Error('ElevenLabs Scribe connection failed.')); };
    socket.onclose = function () { const wasRunning = running; cleanup(); if (wasRunning && options.onEnd) options.onEnd(); };
  }

  function stop() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true })); } catch (_) {}
      try { socket.close(); } catch (_) {}
    }
    cleanup();
  }

  function cleanup() {
    running = false; sessionId = null;
    if (processor) { try { processor.disconnect(); } catch (_) {} processor.onaudioprocess = null; processor = null; }
    if (source) { try { source.disconnect(); } catch (_) {} source = null; }
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); }); stream = null;
    if (context) { try { context.close(); } catch (_) {} context = null; }
    socket = null;
  }

  window.AxiomElevenLabsScribe = {
    isSupported: function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.WebSocket); },
    isRunning: function () { return running; },
    getSessionId: function () { return sessionId; },
    start: start,
    stop: stop,
    fetchToken: fetchToken,
  };
})();
