// ============================================================
// AXIOM AI OS — Milestone 6: Vision Agent Adapter Kit
// ------------------------------------------------------------
// Prepares the Vision Agent architecture with clean adapters,
// exactly like voice-adapter-kit.js does for speech. No
// model-specific logic lives here: a "describe image" or "OCR"
// provider is anything that implements the small interface below,
// registered by name. The default "file-processing" adapter wraps
// the existing FileProcessing OCR pipeline (already real —
// tesseract via file-processing.js) so Milestone 5's OCR keeps
// working; it is not a new OCR engine.
//
// Adapter contract:
//   { analyze(image, opts) -> Promise<{ description? , text? }>,
//     isSupported() -> boolean }
// `image` may be a File/Blob, a data URL, or an <img>/<canvas> element —
// each adapter documents what it accepts.
//
// Public surface — window.AxiomVisionAdapters:
//   .registerImageAnalysisProvider(name, adapter)
//   .registerOCRProvider(name, adapter)
//   .setActiveAnalysis(name) / .setActiveOCR(name)
//   .listProviders() -> { analysis:[names], ocr:[names] }
//   .analyzeImage(image, opts) -> Promise<{ description }>
//   .ocr(image, opts) -> Promise<{ text }>
//   .captureScreenshot(el) -> Promise<canvas|null>   (best-effort)
//   .sendToFileAgent(manager, result, meta) -> taskId  (Vision -> File Agent hand-off)
// ============================================================
window.AxiomVisionAdapters = (function () {
  'use strict';

  var analysisProviders = {};
  var ocrProviders = {};
  var activeAnalysis = null;
  var activeOCR = null;

  function registerImageAnalysisProvider(name, adapter) {
    if (!name || !adapter) throw new Error('registerImageAnalysisProvider requires a name and adapter.');
    analysisProviders[name] = adapter;
    if (!activeAnalysis) activeAnalysis = name;
    return name;
  }
  function registerOCRProvider(name, adapter) {
    if (!name || !adapter) throw new Error('registerOCRProvider requires a name and adapter.');
    ocrProviders[name] = adapter;
    if (!activeOCR) activeOCR = name;
    return name;
  }
  function setActiveAnalysis(name) { if (analysisProviders[name]) activeAnalysis = name; return activeAnalysis; }
  function setActiveOCR(name) { if (ocrProviders[name]) activeOCR = name; return activeOCR; }
  function listProviders() { return { analysis: Object.keys(analysisProviders), ocr: Object.keys(ocrProviders) }; }

  function analyzeImage(image, opts) {
    var adapter = activeAnalysis && analysisProviders[activeAnalysis];
    if (!adapter || typeof adapter.analyze !== 'function') {
      return Promise.reject(new Error('No image-analysis adapter is registered/active.'));
    }
    return Promise.resolve(adapter.analyze(image, opts || {}));
  }

  function ocr(image, opts) {
    var adapter = activeOCR && ocrProviders[activeOCR];
    if (!adapter || typeof adapter.analyze !== 'function') {
      return Promise.reject(new Error('No OCR adapter is registered/active.'));
    }
    return Promise.resolve(adapter.analyze(image, opts || {}));
  }

  // "Screenshot processing": captures a DOM element into a canvas using an
  // already-loaded rendering library if the page provides one (e.g.
  // html2canvas), rather than bundling a new one here. Returns null (not a
  // throw) when unsupported, so callers can degrade gracefully.
  function captureScreenshot(el) {
    if (window.html2canvas && el) {
      return window.html2canvas(el).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  // "File Agent collaboration": hands a vision result to the File Agent
  // through the SAME structured task:assign path every agent uses — never
  // a direct call into file-processing.js from here.
  function sendToFileAgent(manager, result, meta) {
    if (!manager || typeof manager.dispatch !== 'function') throw new Error('An AxiomAgentManager instance is required.');
    meta = meta || {};
    return manager.dispatch('agent.file', Object.assign(
      { intent: 'file', op: meta.op || 'organize', visionResult: result }, meta));
  }

  // -------------------- Default "file-processing" OCR adapter ------------
  // Wraps the existing OCR pipeline (Milestone 1-3, tesseract-backed) —
  // this IS the reuse the brief asks for, not a new engine.
  (function registerFileProcessingAdapter() {
    registerOCRProvider('file-processing', {
      isSupported: function () { return !!(window.FileProcessing && typeof window.FileProcessing.ocrImage === 'function'); },
      analyze: function (image, opts) {
        var fp = window.FileProcessing;
        if (!fp || typeof fp.ocrImage !== 'function') return Promise.reject(new Error('FileProcessing OCR is unavailable on this page.'));
        return Promise.resolve(fp.ocrImage(image, opts)).then(function (text) { return { text: text }; });
      }
    });
  })();

  return {
    registerImageAnalysisProvider: registerImageAnalysisProvider,
    registerOCRProvider: registerOCRProvider,
    setActiveAnalysis: setActiveAnalysis,
    setActiveOCR: setActiveOCR,
    listProviders: listProviders,
    analyzeImage: analyzeImage,
    ocr: ocr,
    captureScreenshot: captureScreenshot,
    sendToFileAgent: sendToFileAgent
  };
})();
