// ============================================
// AXIOM — AI Workspace (ai/workspace.html)
// Depends on: supabase-config.js, dev-config.js, file-processing.js
// (all loaded before this script — see workspace.html script order).
//
// Data flow:
//   File -> Supabase Storage (`workspace-files` bucket, private)
//        -> public.workspace_files row (metadata + extracted_text)
//        -> File Library grid / preview panel / "ask JARVIS" handoff
// ============================================
(function () {
  'use strict';

  const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB, matches the bucket's file_size_limit
  const ACCEPTED_EXT = ['pdf','docx','doc','txt','md','rtf','csv','xlsx','xls','pptx','ppt',
    'png','jpg','jpeg','webp','svg','mp3','wav','ogg','m4a','mp4','mov','webm','zip'];

  const els = {
    grid: document.getElementById('fileGrid'),
    empty: document.getElementById('fileEmpty'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    search: document.getElementById('librarySearch'),
    sort: document.getElementById('librarySort'),
    filterBar: document.getElementById('filterBar'),
    uploadQueue: document.getElementById('uploadQueue'),
    workspaceSwitch: document.getElementById('workspaceSwitch'),
    workspaceMenu: document.getElementById('workspaceMenu'),
    newWorkspaceBtn: document.getElementById('newWorkspaceBtn'),
    previewModal: document.getElementById('previewModal'),
    previewBody: document.getElementById('previewBody'),
    previewTitle: document.getElementById('previewTitle'),
    previewClose: document.getElementById('previewClose'),
  };

  // Module 4: tells the Conversation Bridge (conversation-bridge.js) that a
  // heavy background op (OCR / captioning / transcription) has started or
  // finished, so the Reactor/Face/Dashboard can reflect it. Purely an event
  // dispatch — no-op if the bridge script isn't loaded on a given page.
  function notifyHeavy(phase) {
    try { document.dispatchEvent(new CustomEvent('axiom:heavy-task', { detail: { state: phase, source: 'workspace' } })); } catch (e) { /* non-fatal */ }
  }

  const state = {
    devMode: typeof window.AXIOM_DEV_MODE !== 'undefined' && window.AXIOM_DEV_MODE,
    userId: null,
    workspaces: [],
    activeWorkspaceId: null,
    files: [],           // rows from public.workspace_files (or dev-mode fakes)
    search: '',
    sort: 'recent',
    filterKind: 'all',
    uploads: new Map(),  // localId -> { name, progress, status, error }
  };

  // -------------------- Bootstrapping --------------------

  async function init() {
    bindUploadUI();
    bindLibraryControls();
    bindPreviewModal();

    if (state.devMode) {
      state.userId = 'dev-user';
      state.workspaces = [{ id: 'dev-ws', name: 'My Workspace', is_default: true }];
      state.activeWorkspaceId = 'dev-ws';
      state.files = devSeedFiles();
      renderWorkspaceSwitch();
      renderLibrary();
      return;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return; // data-require-auth redirect (auth.js) already handles this
    state.userId = session.user.id;

    await loadWorkspaces();
    await loadFiles();
    renderWorkspaceSwitch();
    renderLibrary();

    // If we arrived via "Ask JARVIS about this file" from the playground,
    // or a deep link, jump straight to that file's preview.
    const params = new URLSearchParams(location.search);
    const openId = params.get('open');
    if (openId) {
      const f = state.files.find((x) => x.id === openId);
      if (f) openPreview(f);
    }
  }

  async function loadWorkspaces() {
    const { data, error } = await supabaseClient
      .from('workspaces')
      .select('id, name, is_default, created_at')
      .order('created_at', { ascending: true });
    if (error) { console.error('[workspace] loadWorkspaces failed', error); return; }
    state.workspaces = data || [];
    const saved = localStorage.getItem('axiom:active-workspace');
    const fallback = (state.workspaces.find((w) => w.is_default) || state.workspaces[0] || {}).id;
    state.activeWorkspaceId = (saved && state.workspaces.some((w) => w.id === saved)) ? saved : fallback;
  }

  async function loadFiles() {
    if (!state.activeWorkspaceId) { state.files = []; return; }
    const { data, error } = await supabaseClient
      .from('workspace_files')
      .select('*')
      .eq('workspace_id', state.activeWorkspaceId)
      .order('created_at', { ascending: false });
    if (error) { console.error('[workspace] loadFiles failed', error); state.files = []; return; }
    state.files = data || [];
  }

  // -------------------- Workspace switcher --------------------

  function renderWorkspaceSwitch() {
    if (!els.workspaceSwitch) return;
    const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    els.workspaceSwitch.querySelector('[data-ws-name]').textContent = (active && active.name) || 'My Workspace';

    if (els.workspaceMenu) {
      els.workspaceMenu.innerHTML = state.workspaces.map((w) => `
        <button type="button" class="ws-menu-item ${w.id === state.activeWorkspaceId ? 'active' : ''}" data-ws-id="${escapeAttr(w.id)}">
          <span>${escapeHtml(w.name)}</span>
          ${w.is_default ? '<span class="tag">Default</span>' : ''}
        </button>
      `).join('');
      els.workspaceMenu.querySelectorAll('[data-ws-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          state.activeWorkspaceId = btn.getAttribute('data-ws-id');
          localStorage.setItem('axiom:active-workspace', state.activeWorkspaceId);
          els.workspaceMenu.classList.remove('open');
          if (!state.devMode) await loadFiles();
          renderWorkspaceSwitch();
          renderLibrary();
        });
      });
    }
  }

  if (els.workspaceSwitch) {
    els.workspaceSwitch.addEventListener('click', (e) => {
      e.stopPropagation();
      els.workspaceMenu.classList.toggle('open');
    });
    document.addEventListener('click', () => els.workspaceMenu && els.workspaceMenu.classList.remove('open'));
  }
  if (els.newWorkspaceBtn) {
    els.newWorkspaceBtn.addEventListener('click', async () => {
      const name = await promptDialog('Name this workspace:', `Workspace ${state.workspaces.length + 1}`, { title: 'New workspace', confirmLabel: 'Create' });
      if (!name) return;
      if (state.devMode) {
        const ws = { id: 'dev-ws-' + Date.now(), name, is_default: false };
        state.workspaces.push(ws);
        state.activeWorkspaceId = ws.id;
        state.files = [];
        renderWorkspaceSwitch();
        renderLibrary();
        return;
      }
      const { data, error } = await supabaseClient
        .from('workspaces')
        .insert({ owner_id: state.userId, name, is_default: false })
        .select()
        .single();
      if (error) { showToast('Could not create workspace: ' + error.message, 'error'); return; }
      state.workspaces.push(data);
      state.activeWorkspaceId = data.id;
      state.files = [];
      localStorage.setItem('axiom:active-workspace', data.id);
      renderWorkspaceSwitch();
      renderLibrary();
    });
  }

  // -------------------- Upload --------------------

  function bindUploadUI() {
    if (!els.dropzone || !els.fileInput) return;

    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      handleFiles([...els.fileInput.files]);
      els.fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach((evt) =>
      els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((evt) =>
      els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.remove('drag'); }));
    els.dropzone.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
      if (files.length) handleFiles(files);
    });

    // Paste image / screenshot anywhere on the page.
    document.addEventListener('paste', (e) => {
      const items = [...(e.clipboardData ? e.clipboardData.items : [])];
      const imageItems = items.filter((it) => it.type.startsWith('image/'));
      if (!imageItems.length) return;
      const files = imageItems.map((it, i) => {
        const blob = it.getAsFile();
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        return new File([blob], `pasted-${Date.now()}-${i}.${ext}`, { type: blob.type });
      });
      handleFiles(files);
    });
  }

  function validateFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ACCEPTED_EXT.includes(ext)) {
      return `"${file.name}" — unsupported file type (.${ext || 'unknown'}).`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `"${file.name}" is ${window.FileProcessing.readableSize(file.size)} — the limit is 100MB.`;
    }
    if (file.size === 0) {
      return `"${file.name}" is empty.`;
    }
    return null;
  }

  function sanitizeFilename(name) {
    // Strip path separators/control chars; keep it readable. The storage
    // path is further namespaced by uid/workspace/uuid, so this is about
    // hygiene (no "../", no null bytes) rather than uniqueness.
    return name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, '_').slice(0, 180);
  }

  async function handleFiles(fileList) {
    if (!state.activeWorkspaceId && !state.devMode) {
      showToast('No workspace is selected yet — try reloading the page.', 'error');
      return;
    }
    for (const file of fileList) {
      const problem = validateFile(file);
      const localId = 'up_' + Math.random().toString(36).slice(2);
      if (problem) {
        state.uploads.set(localId, { name: file.name, progress: 0, status: 'error', error: problem });
        renderUploadQueue();
        continue;
      }
      state.uploads.set(localId, { name: file.name, progress: 0, status: 'uploading', error: null, file });
      renderUploadQueue();
      uploadOne(localId, file); // fire-and-forget, queue re-renders as it progresses
    }
  }

  async function uploadOne(localId, file) {
    const entry = state.uploads.get(localId);
    const kind = window.FileProcessing.kindForMime(file.type || '', file.name);

    if (state.devMode) {
      // No Supabase session in dev preview — simulate the pipeline so the
      // whole workspace UI (including extraction) is demoable offline.
      entry.progress = 0.5; renderUploadQueue();
      let extracted = null;
      try { extracted = await window.FileProcessing.extractText(file); } catch (_) { /* image/audio/video: no local extractor */ }
      const row = {
        id: localId, owner_id: 'dev-user', workspace_id: state.activeWorkspaceId,
        storage_path: '(dev preview — not uploaded)', filename: file.name, mime_type: file.type || 'application/octet-stream',
        kind, size_bytes: file.size, status: 'ready', extracted_text: extracted ? extracted.text : null,
        page_count: extracted ? extracted.pageCount : null, created_at: new Date().toISOString(),
        _localFile: file,
      };
      state.files.unshift(row);
      state.uploads.delete(localId);
      renderUploadQueue();
      renderLibrary();
      return;
    }

    try {
      const fileId = crypto.randomUUID();
      const storagePath = `${state.userId}/${state.activeWorkspaceId}/${fileId}-${sanitizeFilename(file.name)}`;

      const { error: uploadErr } = await supabaseClient.storage
        .from('workspace-files')
        .upload(storagePath, file, { upsert: false, contentType: file.type || undefined });
      if (uploadErr) throw uploadErr;

      entry.progress = 0.6; entry.status = 'processing'; renderUploadQueue();

      const { data: row, error: insertErr } = await supabaseClient
        .from('workspace_files')
        .insert({
          id: fileId,
          owner_id: state.userId,
          workspace_id: state.activeWorkspaceId,
          storage_path: storagePath,
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          kind,
          size_bytes: file.size,
          status: 'processing',
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      // Documents extract fully client-side and for free (no credits spent).
      // Images/audio/video stay `ready` with no extracted_text until the
      // user explicitly runs OCR/caption/transcript from the preview panel
      // — those calls cost credits, so we never trigger them silently.
      let patch = { status: 'ready' };
      if (kind === 'document') {
        try {
          const extracted = await window.FileProcessing.extractText(file);
          if (extracted) patch = { status: 'ready', extracted_text: extracted.text, page_count: extracted.pageCount || null };
        } catch (extractErr) {
          console.warn('[workspace] extraction failed, file still usable as a raw download', extractErr);
          patch = { status: 'ready' };
        }
      }

      const { data: updated, error: updateErr } = await supabaseClient
        .from('workspace_files')
        .update(patch)
        .eq('id', fileId)
        .select()
        .single();
      if (updateErr) throw updateErr;

      state.files.unshift(updated);
      state.uploads.delete(localId);
      renderUploadQueue();
      renderLibrary();
    } catch (err) {
      console.error('[workspace] upload failed', err);
      entry.status = 'error';
      entry.error = (err && err.message) || 'Upload failed';
      renderUploadQueue();
    }
  }

  function renderUploadQueue() {
    if (!els.uploadQueue) return;
    const entries = [...state.uploads.entries()];
    els.uploadQueue.style.display = entries.length ? 'flex' : 'none';
    els.uploadQueue.innerHTML = entries.map(([id, u]) => `
      <div class="upload-item ${u.status}">
        <div class="upload-item-icon">${fileIcon(u.file ? window.FileProcessing.kindForMime(u.file.type || '', u.name) : 'other')}</div>
        <div class="upload-item-meta">
          <div class="upload-item-name">${escapeHtml(u.name)}</div>
          ${u.status === 'error'
            ? `<div class="upload-item-error">${escapeHtml(u.error)}</div>`
            : `<div class="upload-item-bar"><span style="width:${Math.round((u.progress || 0.1) * 100)}%"></span></div>`}
        </div>
        <div class="upload-item-actions">
          ${u.status === 'error'
            ? `<button type="button" class="icon-btn" data-retry="${id}" title="Retry">↻</button>`
            : `<button type="button" class="icon-btn" data-cancel="${id}" title="Cancel">✕</button>`}
        </div>
      </div>
    `).join('');

    els.uploadQueue.querySelectorAll('[data-cancel]').forEach((btn) =>
      btn.addEventListener('click', () => { state.uploads.delete(btn.getAttribute('data-cancel')); renderUploadQueue(); }));
    els.uploadQueue.querySelectorAll('[data-retry]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-retry');
        const entry = state.uploads.get(id);
        if (entry && entry.file) { entry.status = 'uploading'; entry.error = null; renderUploadQueue(); uploadOne(id, entry.file); }
      }));
  }

  // -------------------- Library: search / sort / filter --------------------

  function bindLibraryControls() {
    if (els.search) els.search.addEventListener('input', () => { state.search = els.search.value.trim().toLowerCase(); renderLibrary(); });
    if (els.sort) els.sort.addEventListener('change', () => { state.sort = els.sort.value; renderLibrary(); });
    if (els.filterBar) {
      els.filterBar.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-kind]');
        if (!chip) return;
        state.filterKind = chip.getAttribute('data-kind');
        els.filterBar.querySelectorAll('[data-kind]').forEach((c) => c.classList.toggle('active', c === chip));
        renderLibrary();
      });
    }
  }

  function visibleFiles() {
    let list = state.files.slice();
    if (state.filterKind !== 'all') list = list.filter((f) => f.kind === state.filterKind);
    if (state.search) {
      list = list.filter((f) =>
        f.filename.toLowerCase().includes(state.search) ||
        (f.extracted_text || '').toLowerCase().includes(state.search));
    }
    switch (state.sort) {
      case 'name': list.sort((a, b) => a.filename.localeCompare(b.filename)); break;
      case 'size': list.sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0)); break;
      case 'oldest': list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); break;
      default: list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // recent
    }
    return list;
  }

  // -------------------- Library: render --------------------

  function fileIcon(kind) {
    const icons = {
      document: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 3v5h5M9 13h6M9 17h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      image: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M4 16l5-4 4 3 3-3 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      audio: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 2h6v11a3 3 0 01-6 0V2Z" stroke="currentColor" stroke-width="1.5"/><path d="M5 11a7 7 0 0014 0M12 18v4M9 22h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      video: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="15" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M17 10l5-3v10l-5-3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
      archive: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v16M8 8h3M8 12h3M8 16h3" stroke="currentColor" stroke-width="1.5"/></svg>',
      other: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/></svg>',
    };
    return icons[kind] || icons.other;
  }

  function renderLibrary() {
    if (!els.grid) return;
    const list = visibleFiles();
    els.empty.style.display = list.length ? 'none' : 'flex';
    els.grid.innerHTML = list.map((f) => `
      <button type="button" class="file-card" data-file-id="${escapeAttr(f.id)}">
        <div class="file-card-thumb kind-${f.kind}">${fileIcon(f.kind)}</div>
        <div class="file-card-meta">
          <div class="file-card-name" title="${escapeAttr(f.filename)}">${escapeHtml(f.filename)}</div>
          <div class="file-card-sub">
            <span class="tag">${f.kind}</span>
            <span>${window.FileProcessing.readableSize(f.size_bytes)}</span>
            ${f.status === 'processing' ? '<span class="dot-pulse"></span>' : ''}
          </div>
        </div>
        <div class="file-card-actions" onclick="event.stopPropagation()">
          <button type="button" class="icon-btn" data-download="${escapeAttr(f.id)}" title="Download"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button type="button" class="icon-btn" data-rename="${escapeAttr(f.id)}" title="Rename"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button type="button" class="icon-btn" data-delete="${escapeAttr(f.id)}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </button>
    `).join('');

    els.grid.querySelectorAll('.file-card').forEach((card) => {
      card.addEventListener('click', () => {
        const f = state.files.find((x) => x.id === card.getAttribute('data-file-id'));
        if (f) openPreview(f);
      });
    });
    els.grid.querySelectorAll('[data-download]').forEach((btn) => btn.addEventListener('click', () => downloadFile(btn.getAttribute('data-download'))));
    els.grid.querySelectorAll('[data-rename]').forEach((btn) => btn.addEventListener('click', () => renameFile(btn.getAttribute('data-rename'))));
    els.grid.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', () => deleteFile(btn.getAttribute('data-delete'))));
  }

  async function downloadFile(id) {
    const f = state.files.find((x) => x.id === id);
    if (!f) return;
    if (state.devMode && f._localFile) {
      const url = URL.createObjectURL(f._localFile);
      const a = document.createElement('a'); a.href = url; a.download = f.filename; a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const { data, error } = await supabaseClient.storage.from('workspace-files').createSignedUrl(f.storage_path, 60);
    if (error) { showToast('Could not create a download link: ' + error.message, 'error'); return; }
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = f.filename; a.target = '_blank'; a.click();
  }

  async function renameFile(id) {
    const f = state.files.find((x) => x.id === id);
    if (!f) return;
    const next = await promptDialog('Rename file:', f.filename, { title: 'Rename file', confirmLabel: 'Rename' });
    if (!next || next === f.filename) return;
    f.filename = next;
    renderLibrary();
    if (state.devMode) return;
    const { error } = await supabaseClient.from('workspace_files').update({ filename: next }).eq('id', id);
    if (error) showToast('Rename failed: ' + error.message, 'error');
  }

  async function deleteFile(id) {
    const f = state.files.find((x) => x.id === id);
    if (!f) return;
    const ok = await confirmDialog(`Delete "${f.filename}"? This can't be undone.`, { title: 'Delete file', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    state.files = state.files.filter((x) => x.id !== id);
    renderLibrary();
    if (state.devMode) return;
    await supabaseClient.storage.from('workspace-files').remove([f.storage_path]);
    const { error } = await supabaseClient.from('workspace_files').delete().eq('id', id);
    if (error) showToast('Delete failed: ' + error.message, 'error');
  }

  // -------------------- Preview panel --------------------

  function bindPreviewModal() {
    if (!els.previewModal) return;
    els.previewClose.addEventListener('click', closePreview);
    els.previewModal.addEventListener('click', (e) => { if (e.target === els.previewModal) closePreview(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePreview(); });
  }
  function closePreview() {
    els.previewModal.classList.remove('open');
    els.previewBody.innerHTML = '';
  }

  async function openPreview(f) {
    els.previewModal.classList.add('open');
    els.previewTitle.textContent = f.filename;
    els.previewBody.innerHTML = `<div class="preview-loading">Loading preview…</div>`;

    const actions = `
      <div class="preview-actions">
        <button type="button" class="btn btn-outline btn-sm" data-ask>Ask JARVIS about this file</button>
        <button type="button" class="btn btn-ghost btn-sm" data-dl>Download</button>
      </div>`;

    if (f.kind === 'document') {
      els.previewBody.innerHTML = `
        ${actions}
        <div class="preview-doc-tools">
          <button type="button" class="chip" data-doc-action="summarize">Summarize</button>
          <button type="button" class="chip" data-doc-action="explain">Explain</button>
          <button type="button" class="chip" data-doc-action="translate">Translate</button>
          <button type="button" class="chip" data-doc-action="rewrite">Rewrite</button>
          <button type="button" class="chip" data-doc-action="key-points">Extract key points</button>
        </div>
        <pre class="preview-text">${escapeHtml(f.extracted_text || '(No extractable text — you can still download the original file.)')}</pre>
      `;
      wireDocActions(f);
    } else if (f.kind === 'image') {
      const src = state.devMode && f._localFile ? URL.createObjectURL(f._localFile) : await signedUrlFor(f);
      els.previewBody.innerHTML = `
        ${actions}
        <div class="preview-image-wrap"><img id="pvImg" src="${src}" alt="${escapeAttr(f.filename)}" style="transform:rotate(0deg)"></div>
        <div class="preview-image-tools">
          <button type="button" class="btn btn-ghost btn-sm" data-rotate>Rotate</button>
          <button type="button" class="btn btn-ghost btn-sm" data-zoom-in>Zoom in</button>
          <button type="button" class="btn btn-ghost btn-sm" data-zoom-out>Zoom out</button>
          <button type="button" class="btn btn-outline btn-sm" data-ocr>Run OCR</button>
          <button type="button" class="btn btn-outline btn-sm" data-caption>Generate caption</button>
        </div>
        <div id="pvImageResult" class="preview-text" style="display:${f.extracted_text ? 'block' : 'none'}">${escapeHtml(f.extracted_text || '')}</div>
      `;
      wireImageTools(f);
    } else if (f.kind === 'audio') {
      const src = state.devMode && f._localFile ? URL.createObjectURL(f._localFile) : await signedUrlFor(f);
      els.previewBody.innerHTML = `
        ${actions}
        <audio controls src="${src}" style="width:100%"></audio>
        <div class="preview-image-tools">
          <button type="button" class="btn btn-outline btn-sm" data-transcribe>Generate transcript</button>
        </div>
        <pre class="preview-text" id="pvTranscript">${escapeHtml(f.extracted_text || '(No transcript yet.)')}</pre>
      `;
      wireAudioTools(f);
    } else if (f.kind === 'video') {
      const src = state.devMode && f._localFile ? URL.createObjectURL(f._localFile) : await signedUrlFor(f);
      els.previewBody.innerHTML = `
        ${actions}
        <video controls src="${src}" style="width:100%;border-radius:12px"></video>
        <div class="preview-image-tools">
          <button type="button" class="btn btn-outline btn-sm" data-transcribe-video>Extract audio + transcribe</button>
        </div>
        <pre class="preview-text" id="pvTranscript">${escapeHtml(f.extracted_text || '(No transcript yet.)')}</pre>
      `;
      wireVideoTools(f);
    } else {
      els.previewBody.innerHTML = `${actions}<p class="preview-text">No inline preview for this file type — download it to view.</p>`;
    }

    els.previewBody.querySelector('[data-ask]')?.addEventListener('click', () => askJarvisAbout(f));
    els.previewBody.querySelector('[data-dl]')?.addEventListener('click', () => downloadFile(f.id));
  }

  async function signedUrlFor(f) {
    const { data, error } = await supabaseClient.storage.from('workspace-files').createSignedUrl(f.storage_path, 3600);
    if (error) { console.error(error); return ''; }
    return data.signedUrl;
  }

  function wireDocActions(f) {
    els.previewBody.querySelectorAll('[data-doc-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const verbs = {
          summarize: 'Summarize this document.',
          explain: 'Explain this document in plain language.',
          translate: 'Translate this document to English (or ask me which language you want).',
          rewrite: 'Rewrite this document to be clearer and more concise.',
          'key-points': 'Extract the key points from this document as a bullet list.',
        };
        askJarvisAbout(f, verbs[btn.getAttribute('data-doc-action')]);
      });
    });
  }

  function wireImageTools(f) {
    const img = els.previewBody.querySelector('#pvImg');
    let rotation = 0, zoom = 1;
    els.previewBody.querySelector('[data-rotate]')?.addEventListener('click', () => { rotation = (rotation + 90) % 360; img.style.transform = `rotate(${rotation}deg) scale(${zoom})`; });
    els.previewBody.querySelector('[data-zoom-in]')?.addEventListener('click', () => { zoom = Math.min(zoom + 0.25, 3); img.style.transform = `rotate(${rotation}deg) scale(${zoom})`; });
    els.previewBody.querySelector('[data-zoom-out]')?.addEventListener('click', () => { zoom = Math.max(zoom - 0.25, 0.5); img.style.transform = `rotate(${rotation}deg) scale(${zoom})`; });

    els.previewBody.querySelector('[data-ocr]')?.addEventListener('click', (e) => runImageOp(f, 'ocr', e.target));
    els.previewBody.querySelector('[data-caption]')?.addEventListener('click', (e) => runImageOp(f, 'caption', e.target));
  }

  async function runImageOp(f, op, btn) {
    const resultEl = els.previewBody.querySelector('#pvImageResult');
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Working…';
    notifyHeavy('start');
    try {
      let text;
      if (op === 'ocr' && !state.devMode) {
        // Local OCR first (free, no credits) — falls back to the vision
        // model only if Tesseract can't find anything useful.
        const local = await window.FileProcessing.ocrImage(f._localFile || await fetchAsFile(f));
        text = local.text && local.text !== '' ? local.text : await callAnalyzeFile({ type: 'image', op: 'ocr', ...(await imageInput(f)) });
      } else if (state.devMode) {
        text = op === 'ocr' ? '(Dev preview — OCR runs against the real vision model once signed in.)' : '(Dev preview — captioning runs against the real vision model once signed in.)';
      } else {
        text = await callAnalyzeFile({ type: 'image', op, ...(await imageInput(f)) });
      }
      resultEl.style.display = 'block';
      resultEl.textContent = text;
      f.extracted_text = text;
      if (!state.devMode) await supabaseClient.from('workspace_files').update({ extracted_text: text }).eq('id', f.id);
    } catch (err) {
      resultEl.style.display = 'block';
      resultEl.textContent = 'Failed: ' + err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
      notifyHeavy('end');
    }
  }

  function wireAudioTools(f) {
    els.previewBody.querySelector('[data-transcribe]')?.addEventListener('click', async (e) => {
      const btn = e.target;
      const out = els.previewBody.querySelector('#pvTranscript');
      btn.disabled = true; btn.textContent = 'Transcribing…';
      notifyHeavy('start');
      try {
        const text = state.devMode
          ? '(Dev preview — transcription runs against the real audio model once signed in.)'
          : await callAnalyzeFile({ type: 'audio', op: 'transcribe', ...(await audioInput(f)) });
        out.textContent = text;
        f.extracted_text = text;
        if (!state.devMode) await supabaseClient.from('workspace_files').update({ extracted_text: text }).eq('id', f.id);
      } catch (err) {
        out.textContent = 'Failed: ' + err.message;
      } finally {
        btn.disabled = false; btn.textContent = 'Generate transcript';
        notifyHeavy('end');
      }
    });
  }

  function wireVideoTools(f) {
    els.previewBody.querySelector('[data-transcribe-video]')?.addEventListener('click', async (e) => {
      const btn = e.target;
      const out = els.previewBody.querySelector('#pvTranscript');
      btn.disabled = true; btn.textContent = 'Extracting audio…';
      notifyHeavy('start');
      try {
        if (state.devMode) {
          out.textContent = '(Dev preview — video transcription runs end-to-end once signed in.)';
          return;
        }
        const videoFile = f._localFile || await fetchAsFile(f);
        const { blob } = await window.FileProcessing.extractAudioTrackFromVideo(videoFile);
        btn.textContent = 'Transcribing…';
        const base64 = await blobToBase64(blob);
        const text = await callAnalyzeFile({ type: 'video', op: 'transcribe', audioBase64: base64, mimeType: 'audio/webm' });
        out.textContent = text;
        f.extracted_text = text;
        await supabaseClient.from('workspace_files').update({ extracted_text: text }).eq('id', f.id);
      } catch (err) {
        out.textContent = 'Failed: ' + err.message;
      } finally {
        btn.disabled = false; btn.textContent = 'Extract audio + transcribe';
        notifyHeavy('end');
      }
    });
  }

  async function imageInput(f) {
    const file = f._localFile || await fetchAsFile(f);
    return window.FileProcessing.imageToBase64(file).then(({ base64, mimeType }) => ({ imageBase64: base64, mimeType }));
  }
  async function audioInput(f) {
    const file = f._localFile || await fetchAsFile(f);
    const base64 = await blobToBase64(file);
    return { audioBase64: base64, mimeType: file.type || 'audio/mpeg' };
  }
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  async function fetchAsFile(f) {
    const url = await signedUrlFor(f);
    const res = await fetch(url);
    const blob = await res.blob();
    return new File([blob], f.filename, { type: f.mime_type });
  }

  async function callAnalyzeFile(task) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('Sign in required.');
    const cfg = window.OpenRouterConfig;
    const endpoint = (cfg && cfg.ANALYZE_FILE_ENDPOINT) || `${SUPABASE_URL}/functions/v1/analyze-file`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(task),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Request failed (HTTP ${res.status})`);
    return json.text;
  }

  // -------------------- Chat handoff --------------------

  function askJarvisAbout(f, instruction) {
    // Hands off to the playground's chat, which reads `axiom:pending-file`
    // from sessionStorage (see workspace-chat-bridge.js) and folds the
    // file's extracted text (or an image block) into the next message.
    sessionStorage.setItem('axiom:pending-file', JSON.stringify({
      id: f.id, filename: f.filename, kind: f.kind,
      extractedText: f.extracted_text || null,
      instruction: instruction || null,
    }));
    location.href = 'playground.html?attach=' + encodeURIComponent(f.id);
  }

  // -------------------- Dev-mode sample data --------------------

  function devSeedFiles() {
    return [
      { id: 'seed-1', filename: 'Q3-strategy-brief.pdf', kind: 'document', mime_type: 'application/pdf', size_bytes: 482_000, status: 'ready', extracted_text: 'This is a sample extracted excerpt so you can see how document preview and "Ask JARVIS" look before signing in.', created_at: new Date().toISOString() },
      { id: 'seed-2', filename: 'product-shot.png', kind: 'image', mime_type: 'image/png', size_bytes: 210_000, status: 'ready', extracted_text: null, created_at: new Date().toISOString() },
      { id: 'seed-3', filename: 'standup-notes.mp3', kind: 'audio', mime_type: 'audio/mpeg', size_bytes: 3_400_000, status: 'ready', extracted_text: null, created_at: new Date().toISOString() },
    ];
  }

  // -------------------- Utils --------------------

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function escapeAttr(s) { return escapeHtml(s); }

  document.addEventListener('DOMContentLoaded', init);
})();
