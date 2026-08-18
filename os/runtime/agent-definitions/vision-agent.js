// ============================================================
// AXIOM AI OS — Agent Definition: Vision Agent
// ------------------------------------------------------------
// Split out of the former monolithic os/runtime/agent-definitions.js
// as part of Phase 8 Part 2 (Code Quality & Maintainability). Behavior
// is unchanged — this is the exact same spec object, just given its
// own file. See os/runtime/agent-definitions/_shared.js for the
// `tick`/`has` helpers and os/runtime/agent-definitions/_assemble.js
// for how every agent file's spec is collected into the same
// window.AxiomAgentDefinitions / window.AxiomAgentDefinitionsById
// globals the rest of the runtime already depends on.
// ============================================================
(function (global) {
  'use strict';
  var tick = global.AxiomAgentDefHelpers.tick;
  var has = global.AxiomAgentDefHelpers.has;

  (global.__axiomAgentDefs = global.__axiomAgentDefs || []).push(
{
  id: 'agent.vision',
  name: 'Vision Agent',
  description: 'Analyzes images: description, visual Q&A, and OCR text extraction via the existing file-processing pipeline.',
  icon: '\uD83D\uDDBC\uFE0F',
  canonicalState: 'vision',
  capabilities: ['describe-image', 'ocr', 'visual-qa', 'screenshot', 'file-agent-handoff'],
  tools: ['image_analysis', 'ocr'],
  subscriptions: ['task:assign'],
  // Milestone 6: routed through vision-adapter-kit.js so no model- or
  // vendor-specific logic lives in this handler — it only asks "the
  // active adapter" to analyze/OCR, same shape as the Voice Agent below.
  handler: async function (task, ctx) {
    var fp = global.FileProcessing;
    var adapters = global.AxiomVisionAdapters;

    if (task.op === 'ocr' && task.file) {
      if (adapters) {
        try { var r = await adapters.ocr(task.file, task.opts); return { ok: true, op: 'ocr', text: r.text }; }
        catch (e) { return { ok: false, op: 'ocr', error: String(e.message || e) }; }
      }
      if (fp && typeof fp.ocrImage === 'function') {
        try { var text = await fp.ocrImage(task.file, task.opts); return { ok: true, op: 'ocr', text: text }; }
        catch (e) { return { ok: false, op: 'ocr', error: String(e.message || e) }; }
      }
    }

    if (task.op === 'diagnose' || task.op === 'diagnose-image' || task.op === 'analyze') {
      if (global.AxiomVision && typeof global.AxiomVision.diagnoseVisual === 'function') {
        try {
          var diag = await global.AxiomVision.diagnoseVisual(task.image || task.file, task.opts || {});
          return { ok: true, op: task.op, result: diag };
        } catch (e) { return { ok: false, op: task.op, error: String(e.message || e) }; }
      }
    }

    if (task.op === 'analyze-screen' || task.op === 'screen-diagnostics') {
      if (global.AxiomVision && typeof global.AxiomVision.analyzeScreen === 'function') {
        try {
          var screenRes = await global.AxiomVision.analyzeScreen(task.opts || {});
          return { ok: true, op: 'analyze-screen', result: screenRes };
        } catch (e) { return { ok: false, op: 'analyze-screen', error: String(e.message || e) }; }
      }
    }

    if (task.op === 'analyze-video' || task.op === 'video-understanding') {
      if (global.AxiomVision && typeof global.AxiomVision.analyzeVideo === 'function') {
        try {
          var vidRes = await global.AxiomVision.analyzeVideo(task.video || task.file, task.opts || {});
          return { ok: true, op: 'analyze-video', result: vidRes };
        } catch (e) { return { ok: false, op: 'analyze-video', error: String(e.message || e) }; }
      }
    }

    if (task.op === 'describe-image' || task.op === 'visual-qa') {
      if (adapters) {
        try { var res = await adapters.analyzeImage(task.image || task.file, { question: task.question }); return { ok: true, op: task.op, result: res }; }
        catch (e) { return { ok: false, op: task.op, error: String(e.message || e), note: 'No image-analysis adapter registered.' }; }
      }
    }

    if (task.op === 'screenshot') {
      if (adapters) {
        var canvas = await adapters.captureScreenshot(task.element || document.body);
        var dataUrl = canvas ? canvas.toDataURL('image/jpeg', 0.8) : null;
        return { ok: true, op: 'screenshot', captured: !!canvas, dataUrl: dataUrl, note: canvas ? undefined : 'DOM screenshot rendered.' };
      }
    }

    if (task.op === 'send-to-file-agent') {
      if (adapters && ctx.manager) {
        try {
          var taskId = adapters.sendToFileAgent(ctx.manager, task.visionResult, task.meta);
          return { ok: true, op: 'send-to-file-agent', dispatchedTaskId: taskId };
        } catch (e) { return { ok: false, op: 'send-to-file-agent', error: String(e.message || e) }; }
      }
    }

    await tick(220);
    return { ok: true, note: 'Vision op "' + (task.op || 'describe') + '" acknowledged.' };
  }
}
  );
})(window);
