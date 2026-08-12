// ============================================================
// AXIOM AI OS — Agent Definition: File Agent
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
  id: 'agent.file',
  name: 'File Agent',
  description: 'Handles documents and files: parsing, text extraction, and summarization of PDFs, DOCX, and transcripts in the Workspace.',
  icon: '\uD83D\uDCC4',
  canonicalState: 'heavy',
  capabilities: ['parse-file', 'extract-text', 'summarize-file', 'search-files', 'organize-files', 'handoff'],
  tools: ['document_search', 'ocr', 'summarization'],
  subscriptions: ['task:assign'],
  // Milestone 5: "open/read/summarize" go through file-processing.js
  // (already real — pdf.js/mammoth/xlsx/tesseract), "search/organize"
  // reuse AxiomAgents.runTool('workspace_search', …) against the
  // existing workspace_files table, and "pass to other agents" is a
  // structured task:assign to whichever agent should take it next —
  // no new file-handling system is introduced anywhere here.
  handler: async function (task, ctx) {
    var fp = global.FileProcessing;
    var mem = global.AxiomAgents;
    var op = task.op || (task.file ? 'summarize' : (task.query ? 'search' : 'organize'));

    var run = function () {
      switch (op) {
        case 'open':
        case 'read':
        case 'summarize':
          if (!task.file) throw new Error('"' + op + '" requires a file.');
          if (!fp || typeof fp.extractText !== 'function') throw new Error('File processing is unavailable on this page.');
          return fp.extractText(task.file, task.opts).then(function (text) {
            text = text || '';
            var out = { filename: task.file.name, chars: text.length };
            if (op === 'summarize') out.summary = text.length > 400 ? text.slice(0, 400).trim() + '…' : text;
            else out.text = text;
            return out;
          });
        case 'search':
          if (!mem || typeof mem.runTool !== 'function') throw new Error('Workspace file search is unavailable on this page.');
          if (!task.query) throw new Error('"search" requires a query.');
          return mem.runTool('workspace_search', { query: task.query, limit: task.limit || 10 });
        case 'organize':
          if (!mem || typeof mem.runTool !== 'function') throw new Error('Workspace file listing is unavailable on this page.');
          return mem.runTool('workspace_search', { query: task.query || '', limit: task.limit || 50 }).then(function (files) {
            var byKind = {};
            (files || []).forEach(function (f) { var k = f.kind || 'other'; (byKind[k] = byKind[k] || []).push(f); });
            return { total: (files || []).length, byKind: byKind };
          });
        case 'pass':
          if (!task.targetAgent) throw new Error('"pass" requires a targetAgent.');
          if (!ctx.manager || typeof ctx.manager.dispatch !== 'function') throw new Error('No manager available to hand the file off.');
          ctx.manager.dispatch(task.targetAgent, Object.assign(
            { intent: task.targetIntent || 'file', file: task.file, filename: task.filename }, task.targetTask || {}));
          return Promise.resolve({ handedOffTo: task.targetAgent });
        default:
          throw new Error('Unsupported file op "' + op + '".');
      }
    };

    var kit = global.AxiomCapabilityKit;
    try {
      var result = kit
        ? await kit.withCapability('file:' + op, task, ctx, run, { timeoutMs: 15000, retries: 1 })
        : await run();
      return { ok: true, op: op, result: result };
    } catch (e) {
      return { ok: false, op: op, error: String(e && e.message || e) };
    }
  }
}
  );
})(window);
