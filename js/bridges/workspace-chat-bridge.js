// ============================================
// AXIOM — AI Workspace ↔ Chat bridge
// Runs on playground.html only. Reads the handoff workspace.js writes to
// sessionStorage before navigating here (see askJarvisAbout in
// ai/workspace.js), then folds the file into the next message sent through
// the EXISTING chat pipeline in app.js — no changes to how streaming,
// credits, or the chat UI itself work.
//
// Relies on chatHistory / chatInput / chatForm / addChatMessage being
// top-level `let`/`const`/function bindings in app.js — shared global
// script scope, same pattern openrouter-client.js already documents for
// supabaseClient. No-ops entirely if app.js's chat block didn't attach
// (e.g. OpenRouter failed to load).
// ============================================
(function () {
  'use strict';

  const chip = document.getElementById('pgAttachedFile');
  const MAX_INLINE_CHARS = 12000; // keep the context reasonable; longer docs stay downloadable, not fully inlined

  function readPendingFile() {
    const params = new URLSearchParams(location.search);
    const attachId = params.get('attach');
    if (!attachId) return null;
    const raw = sessionStorage.getItem('axiom:pending-file');
    sessionStorage.removeItem('axiom:pending-file'); // one-shot: don't re-attach on refresh
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed.id === attachId ? parsed : null;
    } catch {
      return null;
    }
  }

  function showChip(filename, kind) {
    if (!chip) return;
    chip.style.display = 'flex';
    chip.innerHTML = `${fileGlyph(kind)} Attached: <b>${escapeHtml(filename)}</b> <button type="button" aria-label="Remove attachment">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => { chip.style.display = 'none'; });
  }
  function fileGlyph(kind) {
    return { document: '📄', image: '🖼️', audio: '🎧', video: '🎬' }[kind] || '📎';
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  async function attach(pending) {
    const chatState = window.AxiomChatState;
    if (!chatState || typeof chatInput === 'undefined') return; // chat block didn't init on this page

    showChip(pending.filename, pending.kind);

    if (pending.kind === 'image') {
      // Vision models take content as an array of blocks; openrouter-chat
      // forwards `messages` straight through to OpenRouter, so this just
      // works without touching the Edge Function. appendRawTurn keeps the
      // API-bound array content separate from the short bubble label,
      // while still keeping chatHistory/uiMessages 1:1 for regenerate/edit.
      try {
        const dataUrl = await fetchImageAsDataUrl(pending.id);
        if (dataUrl) {
          chatState.appendRawTurn('user', [
            { type: 'text', text: `I've attached an image (${pending.filename}). Please look at it before answering my next question.` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ], `📎 Attached image: ${pending.filename}`);
        }
      } catch (err) {
        console.warn('[workspace-chat-bridge] could not inline image', err);
      }
    } else if (pending.extractedText) {
      const text = pending.extractedText.length > MAX_INLINE_CHARS
        ? pending.extractedText.slice(0, MAX_INLINE_CHARS) + '\n\n[...truncated — ask about a specific section if you need more.]'
        : pending.extractedText;
      chatState.appendRawTurn('user',
        `Here's the content of "${pending.filename}" for context:\n\n"""\n${text}\n"""`,
        `📎 Attached ${pending.kind}: ${pending.filename}`);
    } else {
      if (typeof addChatMessage === 'function') {
        addChatMessage('assistant', `I see "${pending.filename}" is attached, but I don't have a transcript/extracted text for it yet — run OCR, captioning, or "Generate transcript" from its preview in the Workspace first, then attach it again.`);
      }
    }

    // Prefill the composer with the instruction the user picked in the
    // preview panel (e.g. "Summarize this document"), or a generic prompt,
    // then hand focus back so they just hit Enter.
    chatInput.value = pending.instruction || `What can you tell me about ${pending.filename}?`;
    chatInput.dispatchEvent(new Event('input'));
    chatInput.focus();
  }

  async function fetchImageAsDataUrl(fileId) {
    if (typeof supabaseClient === 'undefined') return null;
    const { data: row, error: rowErr } = await supabaseClient
      .from('workspace_files').select('storage_path, mime_type').eq('id', fileId).single();
    if (rowErr || !row) return null;
    const { data: signed, error: signErr } = await supabaseClient
      .storage.from('workspace-files').createSignedUrl(row.storage_path, 300);
    if (signErr || !signed) return null;
    const res = await fetch(signed.signedUrl);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const pending = readPendingFile();
    if (pending) attach(pending);
  });
})();
