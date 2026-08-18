// ============================================================
// AXIOM — Vision Controller
// ------------------------------------------------------------
// Provider-agnostic image/screenshot analysis entry point.
// Keeps vision payloads out of UI code and routes analysis through
// the existing Axiom model/Brain integration hooks when available.
// ============================================================
(function (global) {
  'use strict';

  const MAX_DATA_URL_CHARS = 12 * 1024 * 1024;
  const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  let provider = null;

  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
  }

  function registerVisionProvider(name, adapter) {
    if (!name || !adapter || typeof adapter.analyze !== 'function') throw new Error('Invalid vision provider.');
    provider = { name, adapter };
    emit('axiom:vision-provider-ready', { provider: name });
    return provider;
  }

  function getProvider() { return provider ? provider.name : null; }
  function isSupported() { return !!provider; }

  function validateImage(file) {
    if (!file) throw new Error('Please select an image.');
    if (file.type && !SUPPORTED_TYPES.has(file.type)) throw new Error('Unsupported image type. Use PNG, JPEG, WebP, or GIF.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Image is too large. Maximum size is 8 MB.');
    return file;
  }

  function fileToDataUrl(file) {
    validateImage(file);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || '');
        if (value.length > MAX_DATA_URL_CHARS) return reject(new Error('Image payload is too large.'));
        resolve(value);
      };
      reader.onerror = () => reject(new Error('Could not read the image.'));
      reader.readAsDataURL(file);
    });
  }

  async function analyze(input, options = {}) {
    if (!provider) throw new Error('No vision provider is configured.');
    let image = input;
    if (typeof File !== 'undefined' && input instanceof File) image = await fileToDataUrl(input);
    if (typeof image !== 'string' || !image.trim()) throw new Error('An image is required.');

    emit('axiom:vision-state', { state: 'analyzing', provider: provider.name });
    try {
      const result = await provider.adapter.analyze({
        image,
        prompt: options.prompt || 'Describe this image accurately and concisely.',
        model: options.model,
        signal: options.signal
      });
      emit('axiom:vision-result', { provider: provider.name, result });
      emit('axiom:vision-state', { state: 'complete', provider: provider.name });
      return result;
    } catch (error) {
      emit('axiom:vision-state', { state: 'error', provider: provider.name, error: String(error && error.message || error) });
      throw error;
    }
  }

  // ---- Structured Image Analysis (Phase 11) ----
  const STRUCTURED_DIAGNOSTIC_PROMPT = `
You are Axiom's Multimodal Vision Intelligence.
Analyze this visual input in detail for any UI/UX issues, layout bugs, responsive problems, alignment, typography, contrast, code errors, or terminal outputs.

Format your response strictly using this structured schema:

WHAT I SEE:
<Describe the elements, components, layout, and visual contents accurately>

WHAT IS WRONG:
<Identify any visual bugs, overflow, misalignment, broken styling, or errors. If nothing is wrong, state "Layout and appearance are clean with no obvious defects.">

LIKELY CAUSE:
<Explain the likely CSS/HTML/JS cause, responsive constraint issue, or missing asset>

HOW TO FIX:
<Provide concrete, actionable code steps or CSS rules to fix the issue>

CONFIDENCE:
<Confidence score percentage, e.g. 95%>
`;

  async function diagnoseVisual(input, options = {}) {
    const prompt = options.prompt ? `${STRUCTURED_DIAGNOSTIC_PROMPT}\n\nAdditional user instruction: ${options.prompt}` : STRUCTURED_DIAGNOSTIC_PROMPT;
    return await analyze(input, { ...options, prompt });
  }

  // ---- Screen Capture Analysis (Phase 12) ----
  async function analyzeScreen(options = {}) {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      throw new Error("I don't currently have permission to capture your screen.");
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise(resolve => setTimeout(resolve, 150));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      stream.getTracks().forEach(track => track.stop());
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      return await diagnoseVisual(dataUrl, options);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error("I don't currently have permission to capture your screen.");
      }
      throw err;
    }
  }

  // ---- Video Understanding & Temporal Keyframe Extraction (Phase 13) ----
  async function extractVideoKeyframes(videoSource, maxFrames = 6) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;

      const url = typeof videoSource === 'string' ? videoSource : URL.createObjectURL(videoSource);
      video.src = url;

      video.onloadedmetadata = async () => {
        const duration = video.duration || 1;
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(width, 1280);
        canvas.height = Math.min(height, 720);
        const ctx = canvas.getContext('2d');

        const step = duration / (maxFrames + 1);
        const frames = [];

        try {
          for (let i = 1; i <= maxFrames; i++) {
            const targetTime = i * step;
            await seekVideo(video, targetTime);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const timestampStr = formatTimestamp(targetTime);
            frames.push({
              time: targetTime,
              timestamp: timestampStr,
              dataUrl: canvas.toDataURL('image/jpeg', 0.8)
            });
          }
          if (typeof videoSource !== 'string') URL.revokeObjectURL(url);
          resolve({ duration, width, height, frames });
        } catch (seekErr) {
          if (typeof videoSource !== 'string') URL.revokeObjectURL(url);
          reject(seekErr);
        }
      };

      video.onerror = () => {
        if (typeof videoSource !== 'string') URL.revokeObjectURL(url);
        reject(new Error('Could not load or read video data.'));
      };
    });
  }

  function seekVideo(video, time) {
    return new Promise(resolve => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = time;
    });
  }

  function formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  async function analyzeVideo(videoSource, options = {}) {
    emit('axiom:vision-state', { state: 'analyzing_video' });
    try {
      const { duration, frames } = await extractVideoKeyframes(videoSource, options.maxFrames || 6);
      if (!frames.length) throw new Error('No keyframes could be extracted from the video.');

      // Run analysis on representative keyframe sequence
      const primaryFrame = frames[Math.floor(frames.length / 2)] || frames[0];
      const videoPrompt = `
You are analyzing a video of duration ${Math.round(duration)}s.
Keyframe timestamps sampled: ${frames.map(f => f.timestamp).join(', ')}.
Analyze temporal progression and report any layout shifts, UI glitches, animation jumps, or errors with exact timestamps (e.g. 00:14 — sidebar jumps).

${STRUCTURED_DIAGNOSTIC_PROMPT}
`;
      const result = await analyze(primaryFrame.dataUrl, { prompt: videoPrompt, ...options });
      emit('axiom:vision-state', { state: 'complete' });
      return {
        ...result,
        duration,
        frames: frames.map(f => ({ time: f.time, timestamp: f.timestamp }))
      };
    } catch (err) {
      emit('axiom:vision-state', { state: 'error', error: err.message });
      throw err;
    }
  }

  global.AxiomVision = {
    registerVisionProvider,
    getProvider,
    isSupported,
    validateImage,
    fileToDataUrl,
    analyze,
    diagnoseVisual,
    analyzeScreenshot: analyzeScreen,
    analyzeScreen,
    extractVideoKeyframes,
    analyzeVideo,
    formatTimestamp
  };
})(window);
