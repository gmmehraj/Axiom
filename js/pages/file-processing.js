// ============================================
// AXIOM — AI Workspace file processing
// Exposes window.FileProcessing. Pure client-side extraction so plain
// text (PDF/DOCX/TXT/MD/RTF/CSV/XLSX/PPTX-text) never has to leave the
// browser just to be read. Only image OCR-via-vision-model and audio/video
// transcription cross the network (to analyze-file, see workspace.js).
//
// Every extractor returns the same shape:
//   { text: string, pageCount?: number, meta?: object }
// so workspace.js can store it in workspace_files.extracted_text without
// caring which library produced it.
// ============================================
(function (global) {
  'use strict';

  const CDN = {
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js',
    pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js',
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.0/mammoth.browser.min.js',
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.20.1/xlsx.full.min.js',
    tesseract: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js',
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  };

  const loaded = {}; // url -> Promise, so two extractors racing for the same lib share one <script> tag
  function loadScript(url) {
    if (loaded[url]) return loaded[url];
    loaded[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${url}`));
      document.head.appendChild(s);
    });
    return loaded[url];
  }

  async function ensurePdfJs() {
    if (!global.pdfjsLib) {
      await loadScript(CDN.pdfjs);
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
    }
    return global.pdfjsLib;
  }
  async function ensureMammoth() {
    if (!global.mammoth) await loadScript(CDN.mammoth);
    return global.mammoth;
  }
  async function ensureXlsx() {
    if (!global.XLSX) await loadScript(CDN.xlsx);
    return global.XLSX;
  }
  async function ensureTesseract() {
    if (!global.Tesseract) await loadScript(CDN.tesseract);
    return global.Tesseract;
  }
  async function ensureJSZip() {
    if (!global.JSZip) await loadScript(CDN.jszip);
    return global.JSZip;
  }

  function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
  }
  function fileToText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // -------------------- Documents --------------------

  async function extractPdf(file, { onProgress } = {}) {
    const pdfjsLib = await ensurePdfJs();
    const buf = await fileToArrayBuffer(file);
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(' ') + '\n\n';
      if (onProgress) onProgress(i / doc.numPages);
    }
    return { text: text.trim(), pageCount: doc.numPages, meta: { engine: 'pdf.js' } };
  }

  // Renders one PDF page to a canvas for the preview panel (page nav + zoom).
  async function renderPdfPage(file, pageNumber, scale) {
    const pdfjsLib = await ensurePdfJs();
    const buf = await fileToArrayBuffer(file);
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: scale || 1.2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { canvas, numPages: doc.numPages };
  }

  async function extractDocx(file) {
    const mammoth = await ensureMammoth();
    const buf = await fileToArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return { text: (result.value || '').trim(), meta: { engine: 'mammoth', warnings: result.messages.length } };
  }

  async function extractSpreadsheet(file) {
    const XLSX = await ensureXlsx();
    const buf = await fileToArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array' });
    let text = '';
    wb.SheetNames.forEach((name) => {
      const sheet = wb.Sheets[name];
      text += `# ${name}\n` + XLSX.utils.sheet_to_csv(sheet) + '\n\n';
    });
    return { text: text.trim(), meta: { engine: 'sheetjs', sheets: wb.SheetNames } };
  }

  async function extractPlainText(file) {
    const text = await fileToText(file);
    return { text: text.trim(), meta: { engine: 'text' } };
  }

  // Milestone 6 — File Agent format: JSON. Pretty-prints valid JSON so the
  // extracted "text" stays diffable/readable in memory/planner hand-offs;
  // falls back to the raw text extractor for malformed JSON rather than
  // throwing, so a broken file still hands the caller SOMETHING useful.
  async function extractJson(file) {
    const raw = await fileToText(file);
    try {
      const parsed = JSON.parse(raw);
      const pretty = JSON.stringify(parsed, null, 2);
      const topLevelKeys = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        ? Object.keys(parsed) : null;
      return {
        text: pretty.trim(),
        meta: { engine: 'json', valid: true, isArray: Array.isArray(parsed),
          length: Array.isArray(parsed) ? parsed.length : undefined, topLevelKeys: topLevelKeys }
      };
    } catch (e) {
      return { text: raw.trim(), meta: { engine: 'json', valid: false, parseError: String(e.message || e) } };
    }
  }

  // PPTX is a zip of XML slides — good enough for "extract text" without a
  // full rendering engine, which is out of scope for a browser-only reader.
  async function extractPptx(file) {
    const JSZip = await ensureJSZip();
    const buf = await fileToArrayBuffer(file);
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = parseInt(a.match(/(\d+)/)[1], 10);
        const nb = parseInt(b.match(/(\d+)/)[1], 10);
        return na - nb;
      });
    let text = '';
    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.files[slideFiles[i]].async('text');
      const chunks = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
      text += `# Slide ${i + 1}\n` + chunks.join(' ') + '\n\n';
    }
    return { text: text.trim(), pageCount: slideFiles.length, meta: { engine: 'jszip', slides: slideFiles.length } };
  }

  // RTF has no good browser parser — strip control words well enough for
  // search/chat context; not pixel-perfect, but readable.
  async function extractRtf(file) {
    const raw = await fileToText(file);
    const text = raw
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text, meta: { engine: 'rtf-strip' } };
  }

  // Archives: list contents rather than extracting text from every member.
  async function extractZip(file) {
    const JSZip = await ensureJSZip();
    const buf = await fileToArrayBuffer(file);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    return {
      text: `Archive contents (${names.length} files):\n` + names.slice(0, 500).join('\n'),
      meta: { engine: 'jszip', entryCount: names.length },
    };
  }

  // -------------------- Images --------------------

  async function ocrImage(file, { onProgress } = {}) {
    const Tesseract = await ensureTesseract();
    const { data } = await Tesseract.recognize(file, 'eng', {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
      },
    });
    return { text: (data.text || '').trim(), meta: { engine: 'tesseract.js', confidence: data.confidence } };
  }

  function imageToBase64(file) {
    return fileToDataURL(file).then((dataUrl) => {
      const base64 = dataUrl.split(',')[1];
      return { base64, mimeType: file.type || 'image/png' };
    });
  }

  // -------------------- Audio / Video --------------------

  // Pulls the audio track out of a <video> file into a standalone webm/opus
  // blob using MediaRecorder + an offline media element, so transcription
  // (analyze-file) only ever has to deal with "audio" inputs, never video
  // container formats it doesn't understand.
  async function extractAudioTrackFromVideo(file) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = false;
    video.preload = 'auto';
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Could not read video metadata'));
    });

    const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      URL.revokeObjectURL(url);
      throw new Error('This video has no audio track to transcribe.');
    }
    const audioOnlyStream = new MediaStream(audioTracks);
    const recorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    video.currentTime = 0;
    await video.play().catch(() => {}); // some browsers require a play() to feed captureStream
    await new Promise((resolve) => {
      video.onended = resolve;
      // Safety timeout in case onended never fires for a given codec.
      setTimeout(resolve, (video.duration || 60) * 1000 + 2000);
    });
    recorder.stop();
    await done;
    URL.revokeObjectURL(url);

    return { blob: new Blob(chunks, { type: 'audio/webm' }), duration: video.duration || 0 };
  }

  function readableSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }

  function kindForMime(mimeType, filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    if (ext === 'zip') return 'archive';
    if (['pdf', 'docx', 'doc', 'txt', 'md', 'rtf', 'csv', 'xlsx', 'xls', 'pptx', 'ppt', 'json'].includes(ext)) return 'document';
    return 'other';
  }

  // Routes a File to the right extractor by extension/mime. Returns null
  // for kinds that need a network call (image OCR/caption, audio/video
  // transcription) — workspace.js handles those via analyze-file.
  async function extractText(file, opts) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return extractPdf(file, opts);
    if (ext === 'docx' || ext === 'doc') return extractDocx(file);
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return extractSpreadsheet(file);
    if (ext === 'pptx' || ext === 'ppt') return extractPptx(file);
    if (ext === 'rtf') return extractRtf(file);
    if (ext === 'md' || ext === 'txt') return extractPlainText(file);
    if (ext === 'json') return extractJson(file);
    if (ext === 'zip') return extractZip(file);
    return null;
  }

  global.FileProcessing = {
    kindForMime,
    readableSize,
    extractText,
    extractJson,
    extractPdf,
    renderPdfPage,
    extractDocx,
    extractSpreadsheet,
    extractPptx,
    extractRtf,
    extractZip,
    ocrImage,
    imageToBase64,
    extractAudioTrackFromVideo,
    fileToDataURL,
  };
})(window);
