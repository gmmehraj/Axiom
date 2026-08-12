// ============================================================
// AXIOM AI OS — Milestone 5: Agent Collaboration Workflows
// ------------------------------------------------------------
// Named, reusable multi-agent workflows. A workflow does not talk
// to any agent directly — it only calls AxiomAgentManager.dispatch
// (a structured `task:assign` event, same as everything else) and
// listens for `task:completed` on the shared bus, so collaboration
// happens entirely through the Milestone 4 runtime rather than a
// side channel.
//
// Public surface — window.AxiomWorkflows:
//   .researchAndRemember(text) -> Promise<summary>
// ============================================================
window.AxiomWorkflows = (function () {
  'use strict';

  function extractTopic(text) {
    var m = /^\s*research\s+(.+)$/i.exec(String(text || ''));
    return (m ? m[1] : String(text || '')).trim() || 'the requested topic';
  }

  // Waits for one specific agent+task to complete (or fail), regardless of
  // whatever else is happening on the bus concurrently.
  function onTaskSettled(bus, agentId, taskId) {
    return new Promise(function (resolve, reject) {
      var offDone = bus.on('task:completed', function (env) {
        if (env.payload.agent !== agentId || env.payload.task.id !== taskId) return;
        offDone(); offFail();
        resolve(env.payload.result);
      });
      var offFail = bus.on('task:failed', function (env) {
        if (env.payload.agent !== agentId || env.payload.task.id !== taskId) return;
        offDone(); offFail();
        reject(new Error(env.payload.error || (agentId + ' task failed.')));
      });
    });
  }

  // "Research React." -> Browser Agent collects, Memory Agent stores,
  // Planner Agent drafts next steps, Assistant Agent presents the result.
  // Exactly the Step 5 example in the milestone brief.
  function researchAndRemember(text) {
    var MGR = window.AxiomAgentManager;
    var RT = window.AxiomAgentRuntime;
    if (!MGR || !RT) return Promise.reject(new Error('Agent runtime is not available on this page.'));
    var bus = RT.bus;
    var topic = extractTopic(text);

    var browseTaskId = MGR.dispatch('agent.browser', { intent: 'research-workflow', op: 'search-web', query: topic, text: text });
    return onTaskSettled(bus, 'agent.browser', browseTaskId)
      .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
      .then(function (findings) {
        var noteBits = [];
        if (findings && findings.note) noteBits.push(findings.note);
        else if (findings && findings.navigated) noteBits.push('Opened ' + findings.navigated + ' while researching.');
        var note = 'Researched "' + topic + '". ' + (noteBits.join(' ') || 'See browser workspace for details.');

        var memTaskId = MGR.dispatch('agent.memory', { intent: 'remember', op: 'remember', note: note, tags: ['research', topic] });
        return onTaskSettled(bus, 'agent.memory', memTaskId)
          .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
          .then(function (memResult) { return { findings: findings, memResult: memResult }; });
      })
      .then(function (acc) {
        var planTaskId = MGR.dispatch('agent.planner', {
          intent: 'plan', op: 'create-plan',
          goal: 'Next steps after researching ' + topic,
          steps: [
            'Review the findings on ' + topic,
            'Decide whether deeper research is needed',
            'Apply what was learned about ' + topic
          ]
        });
        return onTaskSettled(bus, 'agent.planner', planTaskId)
          .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
          .then(function (planResult) { return Object.assign(acc, { planResult: planResult }); });
      })
      .then(function (acc) {
        var summary = 'Researched "' + topic + '", saved the findings to memory, and drafted next steps.';
        var assistTaskId = MGR.dispatch('agent.assistant', { intent: 'converse', text: summary, presenting: true, workflow: 'researchAndRemember' });
        return onTaskSettled(bus, 'agent.assistant', assistTaskId)
          .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
          .then(function (assistResult) {
            bus.emit('workflow:complete', 'system', { name: 'researchAndRemember', topic: topic });
            return {
              ok: true, topic: topic, summary: summary,
              findings: acc.findings, memory: acc.memResult, plan: acc.planResult, presented: assistResult
            };
          });
      });
  }

  // "Process this document." -> File Agent reads/summarizes -> Vision Agent
  // OCRs it ONLY if the File Agent reports it needs image text (e.g. a
  // scanned PDF with no extractable text) -> Memory Agent stores the result
  // -> Assistant Agent presents it. Exactly the Step 9 "Documents" example.
  function documentWorkflow(fileOrTask) {
    var MGR = window.AxiomAgentManager;
    var RT = window.AxiomAgentRuntime;
    if (!MGR || !RT) return Promise.reject(new Error('Agent runtime is not available on this page.'));
    var bus = RT.bus;
    var file = fileOrTask && fileOrTask.file ? fileOrTask.file : fileOrTask;
    var filename = (file && file.name) || (fileOrTask && fileOrTask.filename) || 'the document';

    var fileTaskId = MGR.dispatch('agent.file', { intent: 'documents-workflow', op: 'summarize', file: file });
    return onTaskSettled(bus, 'agent.file', fileTaskId)
      .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
      .then(function (fileResult) {
        // The File Agent came back empty-handed (0 extracted characters) —
        // most likely a scanned/image-only PDF — so hand it to Vision for
        // OCR rather than reporting a false "no text" result.
        var needsVision = fileResult && fileResult.ok && fileResult.result &&
          typeof fileResult.result.chars === 'number' && fileResult.result.chars === 0;
        if (!needsVision) return { fileResult: fileResult, visionResult: null };

        var visionTaskId = MGR.dispatch('agent.vision', { intent: 'documents-workflow', op: 'ocr', file: file });
        return onTaskSettled(bus, 'agent.vision', visionTaskId)
          .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
          .then(function (visionResult) { return { fileResult: fileResult, visionResult: visionResult }; });
      })
      .then(function (acc) {
        var text = (acc.visionResult && acc.visionResult.text) ||
          (acc.fileResult && acc.fileResult.result && (acc.fileResult.result.summary || acc.fileResult.result.text)) || '';
        var note = 'Processed "' + filename + '". ' + (text ? (String(text).slice(0, 300)) : 'No extractable text was found.');
        var memTaskId = MGR.dispatch('agent.memory', { intent: 'remember', op: 'remember', note: note, tags: ['document', filename] });
        return onTaskSettled(bus, 'agent.memory', memTaskId)
          .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
          .then(function (memResult) { return Object.assign(acc, { memResult: memResult, note: note }); });
      })
      .then(function (acc) {
        var assistTaskId = MGR.dispatch('agent.assistant', { intent: 'converse', text: acc.note, presenting: true, workflow: 'documentWorkflow' });
        return onTaskSettled(bus, 'agent.assistant', assistTaskId)
          .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
          .then(function (assistResult) {
            bus.emit('workflow:complete', 'system', { name: 'documentWorkflow', filename: filename });
            return { ok: true, filename: filename, file: acc.fileResult, vision: acc.visionResult, memory: acc.memResult, presented: assistResult };
          });
      });
  }

  // "Investigate this bug." / "Analyze the project then plan the fix." ->
  // Coding Agent investigates -> Browser Agent looks up anything external
  // (docs/issue trackers) it's given -> Planner Agent drafts next steps ->
  // Assistant Agent presents. Exactly the Step 9 "Development" example.
  function developmentWorkflow(text) {
    var MGR = window.AxiomAgentManager;
    var RT = window.AxiomAgentRuntime;
    if (!MGR || !RT) return Promise.reject(new Error('Agent runtime is not available on this page.'));
    var bus = RT.bus;
    var description = String(text || '').trim() || 'the reported issue';

    var codeTaskId = MGR.dispatch('agent.coding', { intent: 'development-workflow', op: 'bug-investigation', description: description, text: description });
    return onTaskSettled(bus, 'agent.coding', codeTaskId)
      .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
      .then(function (codeResult) {
        // Browser Agent only runs if the investigation names something to
        // look up (e.g. an error string worth searching for docs on).
        var lookup = codeResult && codeResult.ok && codeResult.result && codeResult.result.hypothesis;
        if (!lookup) return { codeResult: codeResult, browseResult: null };
        var browseTaskId = MGR.dispatch('agent.browser', { intent: 'development-workflow', op: 'search-web', query: description });
        return onTaskSettled(bus, 'agent.browser', browseTaskId)
          .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
          .then(function (browseResult) { return { codeResult: codeResult, browseResult: browseResult }; });
      })
      .then(function (acc) {
        var planTaskId = MGR.dispatch('agent.planner', {
          intent: 'plan', op: 'create-plan',
          goal: 'Fix: ' + description,
          steps: ['Confirm the root cause', 'Write/adjust tests that reproduce it', 'Apply and review the fix (requires explicit confirmation)', 'Verify the fix resolves the issue']
        });
        return onTaskSettled(bus, 'agent.planner', planTaskId)
          .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
          .then(function (planResult) { return Object.assign(acc, { planResult: planResult }); });
      })
      .then(function (acc) {
        var summary = 'Investigated "' + description + '" and drafted a fix plan. No files were modified automatically.';
        var assistTaskId = MGR.dispatch('agent.assistant', { intent: 'converse', text: summary, presenting: true, workflow: 'developmentWorkflow' });
        return onTaskSettled(bus, 'agent.assistant', assistTaskId)
          .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; })
          .then(function (assistResult) {
            bus.emit('workflow:complete', 'system', { name: 'developmentWorkflow', description: description });
            return { ok: true, description: description, summary: summary, investigation: acc.codeResult, research: acc.browseResult, plan: acc.planResult, presented: assistResult };
          });
      });
  }

  return { researchAndRemember: researchAndRemember, documentWorkflow: documentWorkflow, developmentWorkflow: developmentWorkflow };
})();
