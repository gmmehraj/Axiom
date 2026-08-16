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
      const result = await provider.adapter.analyze({ image, prompt: options.prompt || 'Describe this image accurately and concisely.', model: options.model, signal: options.signal });
      emit('axiom:vision-result', { provider: provider.name, result });
      emit('axiom:vision-state', { state: 'complete', provider: provider.name });
      return result;
    } catch (error) {
      emit('axiom:vision-state', { state: 'error', provider: provider.name, error: String(error && error.message || error) });
      throw error;
    }
  }

  async function analyzeScreenshot(options = {}) {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') throw new Error('Screen capture is not supported by this browser.');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise(resolve => setTimeout(resolve, 120));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      return await analyze(canvas.toDataURL('image/jpeg', 0.82), options);
    } finally {
      stream.getTracks().forEach(track => track.stop());
    }
  }

  global.AxiomVision = { registerVisionProvider, getProvider, isSupported, validateImage, fileToDataUrl, analyze, analyzeScreenshot };
})(window);
