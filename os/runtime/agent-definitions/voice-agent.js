// ============================================================
// AXIOM AI OS — Agent Definition: Voice Agent
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
  id: 'agent.voice',
  name: 'Voice Agent',
  description: 'Owns speech in and out: listens through the mic controller and speaks responses via the voice subsystem.',
  icon: '\uD83C\uDF99\uFE0F',
  canonicalState: 'voice',
  capabilities: ['listen', 'transcribe', 'speak', 'route-voice-command'],
  tools: ['voice'],
  subscriptions: ['task:assign', 'voice:command'],
  // Milestone 6: prefers voice-adapter-kit.js (provider-agnostic
  // STT/TTS adapters) and falls back to the existing VoiceController if
  // the kit isn't loaded on this page — no provider is hard-coded here.
  handler: async function (task, ctx) {
    var voice = global.VoiceController || global.AxiomVoice || null;
    var adapters = global.AxiomVoiceAdapters;

    if (task.op === 'speak' && task.text) {
      if (adapters) {
        try { await adapters.speak(task.text, task.opts); return { ok: true, op: 'speak', spoke: task.text }; }
        catch (e) { /* fall through to legacy VoiceController */ }
      }
      if (voice && typeof voice.speak === 'function') {
        try { voice.speak(task.text); return { ok: true, op: 'speak', spoke: task.text }; }
        catch (e) { return { ok: false, op: 'speak', error: String(e.message || e) }; }
      }
    }
    if (task.op === 'transcribe') {
      if (adapters) {
        try { var r = await adapters.transcribe(task.opts); return { ok: true, op: 'transcribe', text: r.text }; }
        catch (e) { return { ok: false, op: 'transcribe', error: String(e.message || e) }; }
      }
    }
    if (task.op === 'listen') {
      if (adapters) {
        try {
          var stopFn = adapters.startListening(function (r) {
            ctx.bus.emit('voice:transcript', ctx.agent.id, { text: r.text });
          });
          return { ok: true, op: 'listen', listening: true, hasStop: typeof stopFn === 'function' };
        } catch (e) { /* fall through to legacy VoiceController */ }
      }
      if (voice && typeof voice.startListening === 'function') {
        try { voice.startListening(); return { ok: true, op: 'listen', listening: true }; }
        catch (e) { return { ok: false, op: 'listen', error: String(e.message || e) }; }
      }
    }
    if (task.op === 'route-voice-command' && task.text) {
      if (adapters) {
        try { return { ok: true, op: 'route-voice-command', decision: adapters.routeVoiceCommand(task.text) }; }
        catch (e) { return { ok: false, op: 'route-voice-command', error: String(e.message || e) }; }
      }
    }
    await tick(120);
    return { ok: true, note: 'Voice op "' + (task.op || 'noop') + '" acknowledged.' };
  }
}
  );
})(window);
