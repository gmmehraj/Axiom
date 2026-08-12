// ============================================================
// AXIOM — PART 5: AI WORKSPACE ULTIMATE
// ------------------------------------------------------------
// Layers Cursor/Claude/ChatGPT-grade chat features on top of the
// existing playground pipeline (app.js) without touching its
// credits/agent/system-prompt logic:
//   - Markdown + code blocks (copy/run/canvas) + Mermaid diagrams
//   - Per-message actions: Copy, Regenerate, Edit, Branch
//   - Fork chat (conversation tabs)
//   - Compare responses across multiple models
//   - Premium input bar: glass, animated border, AI glow,
//     model switcher, quick tools, drag/drop + camera + screen
//     capture attachments, PDF text extraction, OCR
//   - AI follow-up suggestion chips
//
// Depends on window.AxiomChatState (exposed by app.js). Degrades
// to a no-op if that isn't present (e.g. this page has no chat).
// ============================================================
(function () {
  'use strict';

  function boot() {
    const state = window.AxiomChatState;
    const chatWindow = document.getElementById('chatWindow');
    if (!state || !chatWindow) return; // no chat panel on this page

    // ----------------------------------------------------------
    // Lazy CDN loader (mermaid / pdf.js / tesseract) — only ever
    // fetched the first time a feature that needs them is used.
    // ----------------------------------------------------------
    const _libs = {};
    function loadScript(src) {
      if (_libs[src]) return _libs[src];
      _libs[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(s);
      });
      return _libs[src];
    }
    async function ensureMermaid() {
      if (window.mermaid) return window.mermaid;
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js');
      window.mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
      return window.mermaid;
    }
    async function ensurePdfJs() {
      if (window.pdfjsLib) return window.pdfjsLib;
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      return window.pdfjsLib;
    }
    async function ensureTesseract() {
      if (window.Tesseract) return window.Tesseract;
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js');
      return window.Tesseract;
    }

    // ============================================================
    // 1) MARKDOWN RENDERING (custom, dependency-free, escapes HTML
    //    first so nothing user- or model-supplied can inject markup)
    // ============================================================
    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Extremely small syntax highlighter — just enough to make code
    // blocks look alive without pulling in a full highlighter dependency.
    function highlightCode(code, lang) {
      let html = escapeHtml(code);
      const kw = /\b(function|const|let|var|return|if|else|for|while|class|import|export|from|async|await|new|try|catch|def|print|public|static|void|int|string|end|do|then|null|undefined|true|false)\b/g;
      html = html
        .replace(/(\/\/.*$)/gm, '§C$1§/C')
        .replace(/(#.*$)/gm, (m) => (lang === 'python' || lang === 'bash' || lang === 'sh' ? '§C' + m + '§/C' : m))
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, '§S$1§/S')
        .replace(kw, '§K$&§/K')
        .replace(/\b(\d+(\.\d+)?)\b/g, '§N$1§/N');
      html = html
        .replace(/§C(.*?)§\/C/g, '<span class="tok-com">$1</span>')
        .replace(/§S(.*?)§\/S/g, '<span class="tok-str">$1</span>')
        .replace(/§K(.*?)§\/K/g, '<span class="tok-kw">$1</span>')
        .replace(/§N(.*?)§\/N/g, '<span class="tok-num">$1</span>');
      return html;
    }

    const RUNNABLE = new Set(['js', 'javascript']);
    const HTML_LIKE = new Set(['html', 'svg']);

    function renderCodeBlock(lang, code) {
      lang = (lang || 'text').toLowerCase();
      const blockId = 'cb' + Math.random().toString(36).slice(2, 9);
      const canRun = RUNNABLE.has(lang);
      const canCanvas = HTML_LIKE.has(lang) || canRun;
      const isMermaid = lang === 'mermaid';
      if (isMermaid) {
        return `<div class="ax-mermaid-block" id="${blockId}" data-code="${encodeURIComponent(code)}"><span class="ax-mermaid-loading">Rendering diagram…</span></div>`;
      }
      return `<div class="ax-code-block" data-code="${encodeURIComponent(code)}" data-lang="${escapeHtml(lang)}">
        <div class="ax-code-block-header"><span>${escapeHtml(lang)}</span>
          <div class="ax-code-block-actions">
            ${canRun ? `<button type="button" class="ax-code-btn" data-action="run">${iconPlay()}Run</button>` : ''}
            ${canCanvas ? `<button type="button" class="ax-code-btn" data-action="canvas">${iconCanvas()}Canvas</button>` : ''}
            <button type="button" class="ax-code-btn" data-action="copy">${iconCopy()}Copy</button>
          </div>
        </div>
        <code class="ax-code-block-content">${highlightCode(code, lang)}</code>
      </div>`;
    }

    function renderInline(text) {
      let html = escapeHtml(text);
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
      html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      return html;
    }

    function renderMarkdown(src) {
      if (!src) return '';
      const blocks = [];
      // Pull out fenced code blocks first so their contents are never
      // touched by inline/paragraph formatting below.
      let working = src.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
        blocks.push(renderCodeBlock(lang, code.replace(/\n$/, '')));
        return `\u0000${blocks.length - 1}\u0000`;
      });

      const lines = working.split('\n');
      let html = '';
      let i = 0;
      let listBuffer = null; // { tag: 'ul'|'ol', items: [] }
      function flushList() {
        if (!listBuffer) return;
        html += `<${listBuffer.tag}>${listBuffer.items.map(it => `<li>${renderInline(it)}</li>`).join('')}</${listBuffer.tag}>`;
        listBuffer = null;
      }
      while (i < lines.length) {
        const line = lines[i];
        const placeholderMatch = line.match(/^\u0000(\d+)\u0000$/);
        if (placeholderMatch) {
          flushList();
          html += blocks[Number(placeholderMatch[1])];
          i++; continue;
        }
        if (/^\s*$/.test(line)) { flushList(); i++; continue; }
        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h) { flushList(); html += `<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`; i++; continue; }
        const bq = line.match(/^>\s?(.*)$/);
        if (bq) { flushList(); html += `<blockquote>${renderInline(bq[1])}</blockquote>`; i++; continue; }
        const ol = line.match(/^\s*\d+\.\s+(.*)$/);
        if (ol) {
          if (!listBuffer || listBuffer.tag !== 'ol') { flushList(); listBuffer = { tag: 'ol', items: [] }; }
          listBuffer.items.push(ol[1]); i++; continue;
        }
        const ul = line.match(/^\s*[-*]\s+(.*)$/);
        if (ul) {
          if (!listBuffer || listBuffer.tag !== 'ul') { flushList(); listBuffer = { tag: 'ul', items: [] }; }
          listBuffer.items.push(ul[1]); i++; continue;
        }
        flushList();
        html += `<p>${renderInline(line)}</p>`;
        i++;
      }
      flushList();
      return html;
    }

    // ============================================================
    // 2) ICONS (kept tiny + inline so no extra asset requests)
    // ============================================================
    function iconCopy() { return '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.6"/></svg>'; }
    function iconRegenerate() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 13a7 7 0 0012.3 3.6M19 11A7 7 0 006.7 7.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; }
    function iconEdit() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'; }
    function iconBranch() { return '<svg viewBox="0 0 24 24" fill="none"><circle cx="6" cy="6" r="2.2" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="18" r="2.2" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="12" r="2.2" stroke="currentColor" stroke-width="1.6"/><path d="M6 8.2V18M6 8.2c0 3.5 3 4.8 8 6.4" stroke="currentColor" stroke-width="1.6"/></svg>'; }
    function iconPlay() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M8 5l12 7-12 7V5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'; }
    function iconCanvas() { return '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M3 9h18M9 3v18" stroke="currentColor" stroke-width="1.6"/></svg>'; }
    function iconCheck() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }

    // ============================================================
    // 3) MESSAGE ACTIONS — Copy / Regenerate / Edit / Branch
    // ============================================================
    function decorateMessage(el, meta) {
      if (!el || el.querySelector('.ax-msg-actions')) return;
      const col = el.querySelector('.ax-msg-col');
      if (!col) return;
      const actions = document.createElement('div');
      actions.className = 'ax-msg-actions';

      const copyBtn = actionBtn(iconCopy(), 'Copy', () => {
        const bubble = el.querySelector('.ax-msg-bubble');
        const textToCopy = bubble ? (bubble.dataset.rawText || bubble.textContent) : '';
        navigator.clipboard?.writeText(textToCopy).then(() => flashDone(copyBtn));
      });
      actions.appendChild(copyBtn);

      if (meta.role === 'assistant') {
        actions.appendChild(actionBtn(iconRegenerate(), 'Regenerate', async () => {
          await window.AxiomChatState.regenerate(meta.id);
        }));
      }
      if (meta.role === 'user') {
        actions.appendChild(actionBtn(iconEdit(), 'Edit', () => startEdit(el, meta)));
      }
      actions.appendChild(actionBtn(iconBranch(), 'Branch from here', () => branchFromMessage(meta.id)));

      col.appendChild(actions);
      if (meta.model) {
        const tag = document.createElement('div');
        tag.className = 'ax-msg-model-tag';
        tag.textContent = meta.model;
        col.appendChild(tag);
      }
    }

    function actionBtn(svg, title, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ax-msg-action';
      btn.title = title;
      btn.innerHTML = svg;
      btn.addEventListener('click', onClick);
      return btn;
    }
    function flashDone(btn) {
      const original = btn.innerHTML;
      btn.innerHTML = iconCheck();
      btn.classList.add('is-done');
      setTimeout(() => { btn.innerHTML = original; btn.classList.remove('is-done'); }, 1200);
    }

    function startEdit(el, meta) {
      const bubble = el.querySelector('.ax-msg-bubble');
      if (!bubble || el.querySelector('.ax-msg-edit-box')) return;
      const original = bubble.dataset.rawText || bubble.textContent;
      bubble.style.display = 'none';
      const box = document.createElement('textarea');
      box.className = 'ax-msg-edit-box';
      box.value = original;
      const rowActions = document.createElement('div');
      rowActions.className = 'ax-msg-edit-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => { box.remove(); rowActions.remove(); bubble.style.display = ''; });
      const saveBtn = document.createElement('button');
      saveBtn.className = 'primary';
      saveBtn.textContent = 'Save & resend';
      saveBtn.addEventListener('click', async () => {
        const newText = box.value.trim();
        if (!newText) return;
        await window.AxiomChatState.editAndResend(meta.id, newText);
      });
      rowActions.appendChild(cancelBtn);
      rowActions.appendChild(saveBtn);
      bubble.after(box, rowActions);
      box.focus();
    }

    // ============================================================
    // 4) FORK CHAT — conversation tabs (branch/fork a session)
    // ============================================================
    let sessions = [];   // { id, title, history: [...], ui: [...serializable...] }
    let activeSessionId = null;
    let tabsEl = null;

    function ensureTabsBar() {
      if (tabsEl) return tabsEl;
      tabsEl = document.createElement('div');
      tabsEl.className = 'ax-chat-tabs';
      const newBtn = document.createElement('button');
      newBtn.type = 'button';
      newBtn.className = 'ax-chat-tab-new';
      newBtn.title = 'New chat';
      newBtn.textContent = '+';
      newBtn.addEventListener('click', () => createSession('New chat', [], []));
      chatWindow.parentElement.insertBefore(tabsEl, chatWindow);
      tabsEl.appendChild(newBtn);
      return tabsEl;
    }

    function serializeCurrent() {
      return {
        history: state.chatHistory.map(m => ({ role: m.role, content: m.content })),
        ui: state.uiMessages.map(m => ({ id: m.id, role: m.role, content: m.content, model: m.model }))
      };
    }

    function renderSessionIntoDom(ui) {
      chatWindow.innerHTML = '';
      // Rebuild using app.js's own turn builder so ids/DOM/history all
      // stay perfectly in sync with the rest of the app.
      const rebuiltHistory = [];
      const rebuiltUi = [];
      ui.forEach(m => {
        const result = rawAppendTurn(m.role, m.content, { id: m.id, model: m.model });
        rebuiltHistory.push({ role: m.role, content: m.content });
        rebuiltUi.push({ id: m.id, role: m.role, content: m.content, el: result.el, bubble: result.bubble, model: m.model });
      });
      state.replaceSession(rebuiltHistory, rebuiltUi);
    }

    // Thin wrapper so a fresh session always renders through the exact
    // same path (addChatMessage + finalize) as a normal turn.
    function rawAppendTurn(role, content, meta) {
      return state.appendFinishedTurn(role, content, meta);
    }

    function createSession(title, history, ui) {
      const id = 'sess' + Math.random().toString(36).slice(2, 8);
      if (activeSessionId) {
        const active = sessions.find(s => s.id === activeSessionId);
        if (active) { const snap = serializeCurrent(); active.history = snap.history; active.ui = snap.ui; }
      }
      sessions.push({ id, title, history: history || [], ui: ui || [] });
      switchSession(id);
      return id;
    }

    function switchSession(id) {
      if (activeSessionId) {
        const active = sessions.find(s => s.id === activeSessionId);
        if (active) { const snap = serializeCurrent(); active.history = snap.history; active.ui = snap.ui; }
      }
      activeSessionId = id;
      const target = sessions.find(s => s.id === id);
      if (!target) return;
      renderSessionIntoDom(target.ui);
      renderTabs();
    }

    function renderTabs() {
      const bar = ensureTabsBar();
      bar.querySelectorAll('.ax-chat-tab').forEach(t => t.remove());
      const newBtn = bar.querySelector('.ax-chat-tab-new');
      sessions.forEach(s => {
        const tab = document.createElement('div');
        tab.className = 'ax-chat-tab' + (s.id === activeSessionId ? ' active' : '');
        tab.innerHTML = `${iconBranch()}<span>${escapeHtml(s.title)}</span>`;
        tab.addEventListener('click', (e) => { if (e.target.closest('.ax-tab-close')) return; switchSession(s.id); });
        if (sessions.length > 1) {
          const close = document.createElement('button');
          close.className = 'ax-tab-close';
          close.textContent = '✕';
          close.addEventListener('click', () => {
            const idx = sessions.findIndex(x => x.id === s.id);
            sessions.splice(idx, 1);
            if (activeSessionId === s.id) switchSession(sessions[Math.max(0, idx - 1)].id);
            else renderTabs();
          });
          tab.appendChild(close);
        }
        bar.insertBefore(tab, newBtn);
      });
      bar.style.display = sessions.length > 1 ? 'flex' : 'none';
    }

    function branchFromMessage(messageId) {
      const idx = state.uiMessages.findIndex(m => m.id === messageId);
      if (idx === -1) return;
      const upTo = state.uiMessages.slice(0, idx + 1).map(m => ({ id: m.id, role: m.role, content: m.content, model: m.model }));
      if (!sessions.length) {
        const snap = serializeCurrent();
        createSession('Main', snap.history, snap.ui);
      }
      createSession('Branch', [], upTo);
      if (typeof showToast === 'function') showToast('Branched into a new chat tab.');
    }

    // First time any fork/branch action happens, silently capture the
    // pre-existing conversation as "Main" so the user never loses it.
    function ensureMainSession() {
      if (sessions.length) return;
      const snap = serializeCurrent();
      sessions.push({ id: 'sess-main', title: 'Main', history: snap.history, ui: snap.ui });
      activeSessionId = 'sess-main';
    }

    // ============================================================
    // 5) AI SUGGESTIONS
    // ============================================================
    function buildSuggestions(content) {
      const hasCode = /```/.test(content);
      const isShort = content.length < 240;
      const picks = [];
      if (hasCode) picks.push('Explain this code', 'Add error handling', 'Write tests for this');
      else if (isShort) picks.push('Go deeper', 'Give an example', 'Summarize in 3 bullets');
      else picks.push('Summarize this', 'Turn this into a checklist', 'What are the tradeoffs?');
      return picks.slice(0, 3);
    }

    function attachSuggestions(el, content) {
      const col = el.querySelector('.ax-msg-col');
      if (!col) return;
      const old = col.querySelector('.ax-suggestions');
      if (old) old.remove();
      // Only the most recent assistant message keeps its suggestions.
      chatWindow.querySelectorAll('.ax-suggestions').forEach(n => n.remove());
      const row = document.createElement('div');
      row.className = 'ax-suggestions';
      buildSuggestions(content).forEach(text => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ax-suggestion-chip';
        chip.textContent = text;
        chip.addEventListener('click', () => {
          state.chatInput.value = text;
          state.chatForm.requestSubmit();
        });
        row.appendChild(chip);
      });
      col.appendChild(row);
    }

    // ============================================================
    // 6) FINALIZE — markdown, mermaid, code block wiring, suggestions
    // ============================================================
    async function finalizeMessage(el, bubble, content, meta) {
      if (!bubble) return;
      bubble.dataset.rawText = content;
      bubble.innerHTML = renderMarkdown(content);
      wireCodeBlocks(bubble);
      await renderMermaidBlocks(bubble);
      if (meta && (meta.id || true) && el.classList.contains('assistant')) {
        attachSuggestions(el, content);
      }
      chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function wireCodeBlocks(scope) {
      scope.querySelectorAll('.ax-code-block').forEach(block => {
        if (block.dataset.wired) return;
        block.dataset.wired = '1';
        const code = decodeURIComponent(block.dataset.code || '');
        const lang = block.dataset.lang || 'text';
        block.querySelectorAll('.ax-code-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action === 'copy') { navigator.clipboard?.writeText(code).then(() => flashDone(btn)); }
            if (action === 'run') runCode(block, lang, code);
            if (action === 'canvas') openCanvas(lang, code);
          });
        });
      });
    }

    async function renderMermaidBlocks(scope) {
      const blocks = scope.querySelectorAll('.ax-mermaid-block');
      if (!blocks.length) return;
      try {
        const mermaid = await ensureMermaid();
        for (const block of blocks) {
          const code = decodeURIComponent(block.dataset.code || '');
          try {
            const { svg } = await mermaid.render('mm' + Math.random().toString(36).slice(2, 9), code);
            block.innerHTML = svg + `<button type="button" class="ax-mermaid-expand" title="Open in Canvas">${iconCanvas()}</button>`;
            block.querySelector('.ax-mermaid-expand').addEventListener('click', () => openCanvas('mermaid-svg', svg));
          } catch (err) {
            block.innerHTML = `<span class="ax-mermaid-loading">Couldn't render this diagram (${escapeHtml(err.message || 'syntax error')}).</span>`;
          }
        }
      } catch (err) {
        blocks.forEach(b => { b.innerHTML = '<span class="ax-mermaid-loading">Diagram renderer failed to load.</span>'; });
      }
    }

    // ------------------------- Code execution -------------------------
    function runCode(block, lang, code) {
      let out = block.querySelector('.ax-code-run-output');
      if (!out) {
        out = document.createElement('div');
        out.className = 'ax-code-run-output';
        block.appendChild(out);
      }
      out.classList.remove('is-error');
      out.textContent = 'Running…';

      if (HTML_LIKE.has(lang) && lang !== 'js' && lang !== 'javascript') {
        openCanvas(lang, code);
        out.textContent = 'Opened in Canvas →';
        return;
      }

      // Sandboxed JS execution: a same-origin-free iframe with console
      // output piped back via postMessage. No access to the parent page.
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts';
      iframe.style.display = 'none';
      const srcdoc = `<script>
        const send = (type, args) => parent.postMessage({ __axRun: true, type, args }, '*');
        ['log','error','warn'].forEach(k => {
          const orig = console[k];
          console[k] = (...args) => { send(k, args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(e){ return String(a); } })); orig && orig.apply(console, args); };
        });
        try {
          ${code}
        } catch (e) { send('error', [e.message]); }
        send('done', []);
      <\/script>`;
      iframe.srcdoc = srcdoc;
      const lines = [];
      function onMsg(e) {
        if (!e.data || !e.data.__axRun) return;
        if (e.data.type === 'done') {
          window.removeEventListener('message', onMsg);
          iframe.remove();
          out.textContent = lines.length ? lines.join('\n') : '(no output)';
          return;
        }
        if (e.data.type === 'error') out.classList.add('is-error');
        lines.push(`[${e.data.type}] ` + e.data.args.join(' '));
      }
      window.addEventListener('message', onMsg);
      document.body.appendChild(iframe);
      setTimeout(() => { if (iframe.isConnected) { window.removeEventListener('message', onMsg); iframe.remove(); if (!lines.length) out.textContent = '(no output — script may still be running)'; } }, 4000);
    }

    // ============================================================
    // 7) CANVAS PANEL — live preview of HTML/SVG/JS output
    // ============================================================
    let canvasPanel, canvasScrim, canvasFrame;
    function ensureCanvas() {
      if (canvasPanel) return;
      canvasScrim = document.createElement('div');
      canvasScrim.className = 'ax-canvas-scrim';
      canvasPanel = document.createElement('div');
      canvasPanel.className = 'ax-canvas-panel';
      canvasPanel.innerHTML = `
        <div class="ax-canvas-head">
          <h4>Canvas</h4>
          <div class="ax-canvas-head-actions">
            <button type="button" class="ax-code-btn" data-canvas-close>${iconCheck()} Done</button>
          </div>
        </div>
        <div class="ax-canvas-body"><iframe sandbox="allow-scripts"></iframe></div>`;
      document.body.appendChild(canvasScrim);
      document.body.appendChild(canvasPanel);
      canvasFrame = canvasPanel.querySelector('iframe');
      canvasPanel.querySelector('[data-canvas-close]').addEventListener('click', closeCanvas);
      canvasScrim.addEventListener('click', closeCanvas);
    }
    function openCanvas(lang, code) {
      ensureCanvas();
      let doc;
      if (lang === 'mermaid-svg') {
        doc = `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0a;">${code}</body></html>`;
      } else if (lang === 'svg') {
        doc = `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;">${code}</body></html>`;
      } else if (lang === 'js' || lang === 'javascript') {
        doc = `<html><body style="margin:0;font-family:monospace;background:#0a0a0a;color:#eee;padding:16px;"><script>${code}<\/script></body></html>`;
      } else {
        doc = code;
      }
      canvasFrame.srcdoc = doc;
      canvasPanel.classList.add('open');
      canvasScrim.classList.add('open');
    }
    function closeCanvas() {
      canvasPanel.classList.remove('open');
      canvasScrim.classList.remove('open');
    }

    // ============================================================
    // 8) COMPARE RESPONSES — send to multiple models side-by-side
    // ============================================================
    let compareActive = false;
    let compareModels = [];

    function compareModeActive() { return compareActive; }

    function pickDefaultCompareModels() {
      const current = state.currentModel();
      const modelSelect = document.getElementById('modelSelect');
      const options = modelSelect ? Array.from(modelSelect.options).map(o => o.value) : [];
      const alt = options.find(v => v && v !== current) || current;
      return [current, alt];
    }

    async function handleCompareSend(text) {
      state.appendFinishedTurn('user', text);
      const models = compareModels.length ? compareModels : pickDefaultCompareModels();
      const grid = document.createElement('div');
      grid.className = 'ax-compare-grid';
      const wrapper = document.createElement('div');
      wrapper.className = 'ax-message assistant ax-msg-in';
      wrapper.style.maxWidth = '100%';
      wrapper.innerHTML = `<div class="ax-msg-avatar">AX</div>`;
      const col = document.createElement('div');
      col.className = 'ax-msg-col';
      col.style.width = '100%';
      col.appendChild(grid);
      wrapper.appendChild(col);
      chatWindow.appendChild(wrapper);
      chatWindow.scrollTop = chatWindow.scrollHeight;

      const cards = models.map(model => {
        const card = document.createElement('div');
        card.className = 'ax-compare-card';
        card.innerHTML = `<div class="ax-compare-card-head"><span class="ax-compare-model">${escapeHtml(model)}</span></div>
          <div class="ax-compare-body">Thinking…</div>`;
        grid.appendChild(card);
        return { model, card, body: card.querySelector('.ax-compare-body'), text: '' };
      });

      await Promise.all(cards.map(c => runCompareModel(c)));

      cards.forEach(c => {
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'ax-compare-keep';
        keep.textContent = 'Keep this response';
        keep.addEventListener('click', () => {
          grid.remove();
          state.chatHistory.push({ role: 'assistant', content: c.text });
          const el = document.createElement('div');
          el.className = 'ax-message assistant ax-msg-in';
          el.innerHTML = `<div class="ax-msg-avatar">AX</div><div class="ax-msg-col"><div class="ax-msg-bubble"></div></div>`;
          wrapper.replaceWith(el);
          const bubble = el.querySelector('.ax-msg-bubble');
          const id = state.nextMsgId();
          el.dataset.msgId = id;
          state.uiMessages.push({ id, role: 'assistant', content: c.text, el, bubble, model: c.model });
          decorateMessage(el, { id, role: 'assistant', model: c.model });
          finalizeMessage(el, bubble, c.text, { id });
        });
        c.card.appendChild(keep);
      });
    }

    function runCompareModel(c) {
      return new Promise((resolve) => {
        let full = '';
        // Compare mode can have several of these streaming concurrently,
        // so batching each card's textContent write to one per animation
        // frame (rather than one per token) matters even more here than
        // for a single chat stream.
        let framePending = false;
        let streamEnded = false;
        function flushPending() {
          framePending = false;
          if (streamEnded) return;
          c.body.textContent = full;
        }
        OpenRouter.streamChat({
          model: c.model,
          messages: state.chatHistory,
          onToken: (_d, fullText) => {
            full = fullText;
            if (!framePending) {
              framePending = true;
              requestAnimationFrame(flushPending);
            }
          },
          onDone: (fullText) => {
            streamEnded = true;
            full = fullText || full;
            c.text = full;
            c.body.innerHTML = renderMarkdown(full);
            wireCodeBlocks(c.body);
            renderMermaidBlocks(c.body);
            resolve();
          },
          onError: (err) => { streamEnded = true; c.body.textContent = '⚠️ ' + (err.message || 'Request failed.'); resolve(); }
        });
      });
    }

    // ============================================================
    // 9) PREMIUM INPUT BAR — glass wrap, quick tools, model chip,
    //    attachments (files/images/PDF/camera/screen/OCR)
    // ============================================================
    let attachments = []; // { id, name, kind, dataUrl?, text? }

    function buildInputBarChrome() {
      const bar = document.getElementById('chatForm');
      if (!bar || bar.dataset.ultimateWired) return;
      bar.dataset.ultimateWired = '1';

      // Wrap the existing prompt bar in the glass/animated-border shell.
      const wrap = document.createElement('div');
      wrap.className = 'ax-prompt-wrap';
      bar.parentElement.insertBefore(wrap, bar);
      wrap.appendChild(bar);

      document.addEventListener('axiom:chat-state', (e) => {
        wrap.classList.toggle('is-answering', e.detail && (e.detail.state === 'thinking' || e.detail.state === 'answering'));
      });

      // Quick tools row
      const tools = document.createElement('div');
      tools.className = 'ax-quick-tools';
      tools.innerHTML = `
        <button type="button" class="ax-qt-btn" data-tool="image">${iconCanvas()}Image</button>
        <button type="button" class="ax-qt-btn" data-tool="camera">${camIcon()}Camera</button>
        <button type="button" class="ax-qt-btn" data-tool="screen">${screenIcon()}Screen</button>
        <button type="button" class="ax-qt-btn" data-tool="mermaid">${diagramIcon()}Diagram</button>
        <button type="button" class="ax-qt-btn" data-tool="compare">${compareIcon()}Compare</button>
      `;
      wrap.parentElement.insertBefore(tools, wrap);

      // Attachments tray
      const tray = document.createElement('div');
      tray.className = 'ax-attach-tray';
      tray.style.display = 'none';
      wrap.parentElement.insertBefore(tray, wrap);

      // Compare banner
      const compareBanner = document.createElement('div');
      compareBanner.className = 'ax-compare-banner';
      compareBanner.style.display = 'none';
      compareBanner.innerHTML = `<span>Compare mode is on — your next message goes to <strong>2 models</strong> at once.</span>`;
      wrap.parentElement.insertBefore(compareBanner, tools);

      // Model switcher chip
      const modelSelect = document.getElementById('modelSelect');
      const actionsRow = bar.querySelector('.ax-prompt-actions');
      if (actionsRow && modelSelect) {
        const switcher = document.createElement('div');
        switcher.className = 'ax-model-switcher';
        switcher.innerHTML = `<button type="button" class="ax-model-chip"><span data-model-label>Model</span>${chevronIcon()}</button>
          <div class="ax-model-dropdown"></div>`;
        actionsRow.insertBefore(switcher, actionsRow.firstChild);
        const chipBtn = switcher.querySelector('.ax-model-chip');
        const dropdown = switcher.querySelector('.ax-model-dropdown');
        const label = switcher.querySelector('[data-model-label]');

        function syncLabel() {
          const opt = modelSelect.options[modelSelect.selectedIndex];
          label.textContent = opt ? opt.textContent : 'Model';
        }
        function renderDropdown() {
          dropdown.innerHTML = '';
          Array.from(modelSelect.children).forEach(node => {
            if (node.tagName === 'OPTGROUP') {
              const g = document.createElement('div');
              g.className = 'ax-model-dropdown-group';
              g.textContent = node.label;
              dropdown.appendChild(g);
              Array.from(node.children).forEach(opt => dropdown.appendChild(renderOption(opt)));
            } else if (node.tagName === 'OPTION') {
              dropdown.appendChild(renderOption(node));
            }
          });
        }
        function renderOption(opt) {
          const row = document.createElement('div');
          row.className = 'ax-model-option' + (opt.value === modelSelect.value ? ' selected' : '');
          row.textContent = opt.textContent;
          row.addEventListener('click', () => {
            modelSelect.value = opt.value;
            modelSelect.dispatchEvent(new Event('change'));
            syncLabel();
            dropdown.classList.remove('open');
          });
          return row;
        }
        chipBtn.addEventListener('click', () => { renderDropdown(); dropdown.classList.toggle('open'); });
        document.addEventListener('click', (e) => { if (!switcher.contains(e.target)) dropdown.classList.remove('open'); });
        modelSelect.addEventListener('change', syncLabel);
        setTimeout(syncLabel, 300); // model-selector.js populates the <select> asynchronously
      }

      // Quick tool wiring
      tools.querySelectorAll('.ax-qt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tool = btn.dataset.tool;
          if (tool === 'image') triggerFilePicker('image/*');
          if (tool === 'camera') openCapture('camera');
          if (tool === 'screen') openCapture('screen');
          if (tool === 'mermaid') insertMermaidTemplate();
          if (tool === 'compare') {
            compareActive = !compareActive;
            btn.classList.toggle('active', compareActive);
            compareBanner.style.display = compareActive ? 'flex' : 'none';
          }
        });
      });

      wireAttachButton(tray);
      wireDragAndDrop(bar, tray);
      trayEl = tray;
    }

    let trayEl = null;

    function triggerFilePicker(accept) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '*/*';
      input.multiple = true;
      input.addEventListener('change', () => handleFiles(input.files));
      input.click();
    }

    function wireAttachButton(tray) {
      const attachBtn = document.getElementById('pgAttachBtn');
      if (!attachBtn) return;
      attachBtn.addEventListener('click', () => triggerFilePicker('image/*,application/pdf,.txt,.md,.csv,.json'));
    }

    function wireDragAndDrop(bar, tray) {
      const promptBar = bar.querySelector('.ax-prompt-bar') || bar;
      ['dragover', 'dragenter'].forEach(evt => promptBar.addEventListener(evt, (e) => { e.preventDefault(); promptBar.classList.add('is-drag-over'); }));
      ['dragleave', 'drop'].forEach(evt => promptBar.addEventListener(evt, (e) => { e.preventDefault(); promptBar.classList.remove('is-drag-over'); }));
      promptBar.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
    }

    function renderTray() {
      if (!trayEl) return;
      trayEl.innerHTML = '';
      trayEl.style.display = attachments.length ? 'flex' : 'none';
      attachments.forEach(a => {
        const chip = document.createElement('div');
        chip.className = 'ax-attach-chip';
        const thumb = a.dataUrl && a.kind === 'image'
          ? `<img class="ax-attach-thumb" src="${a.dataUrl}" alt="">`
          : `<span class="ax-attach-icon">${a.kind === 'pdf' ? pdfIcon() : fileIcon()}</span>`;
        chip.innerHTML = `${thumb}<span class="ax-attach-meta"><span class="ax-attach-fname">${escapeHtml(a.name)}</span><span class="ax-attach-sub">${a.sub || ''}</span></span>
          ${a.kind === 'image' ? `<button type="button" data-ocr title="Extract text (OCR)">${diagramIcon()}</button>` : ''}
          <button type="button" data-remove title="Remove">✕</button>`;
        const ocrBtn = chip.querySelector('[data-ocr]');
        if (ocrBtn) ocrBtn.addEventListener('click', () => runOcr(a));
        chip.querySelector('[data-remove]').addEventListener('click', () => {
          attachments = attachments.filter(x => x.id !== a.id);
          renderTray();
        });
        trayEl.appendChild(chip);
      });
    }

    function handleFiles(fileList) {
      Array.from(fileList).forEach(file => {
        const id = 'att' + Math.random().toString(36).slice(2, 8);
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = () => {
            attachments.push({ id, name: file.name, kind: 'image', dataUrl: reader.result, sub: prettySize(file.size) });
            renderTray();
          };
          reader.readAsDataURL(file);
        } else if (file.type === 'application/pdf') {
          attachments.push({ id, name: file.name, kind: 'pdf', sub: 'Extracting…' });
          renderTray();
          extractPdfText(file).then(text => {
            const a = attachments.find(x => x.id === id);
            if (a) { a.text = text; a.sub = `${text.split(/\s+/).length} words extracted`; renderTray(); }
          }).catch(() => {
            const a = attachments.find(x => x.id === id);
            if (a) { a.sub = 'Could not read PDF'; renderTray(); }
          });
        } else {
          const reader = new FileReader();
          reader.onload = () => {
            attachments.push({ id, name: file.name, kind: 'file', text: String(reader.result).slice(0, 8000), sub: prettySize(file.size) });
            renderTray();
          };
          reader.readAsText(file);
        }
      });
    }

    function prettySize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    async function extractPdfText(file) {
      const pdfjsLib = await ensurePdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = '';
      const maxPages = Math.min(pdf.numPages, 15);
      for (let p = 1; p <= maxPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(' ') + '\n';
        if (text.length > 12000) break;
      }
      return text.slice(0, 12000);
    }

    async function runOcr(attachment) {
      if (!attachment.dataUrl) return;
      attachment.sub = 'Reading text…';
      renderTray();
      try {
        const Tesseract = await ensureTesseract();
        const { data } = await Tesseract.recognize(attachment.dataUrl, 'eng');
        attachment.text = (data && data.text || '').trim();
        attachment.sub = attachment.text ? `${attachment.text.split(/\s+/).length} words found — added to message` : 'No text found';
        renderTray();
        if (attachment.text) {
          state.chatInput.value = (state.chatInput.value ? state.chatInput.value + '\n\n' : '') + attachment.text;
          state.chatInput.dispatchEvent(new Event('input'));
        }
      } catch (err) {
        attachment.sub = 'OCR failed to load';
        renderTray();
      }
    }

    function insertMermaidTemplate() {
      const template = '```mermaid\nflowchart TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do the thing]\n  B -->|No| D[Skip it]\n```';
      state.chatInput.value = (state.chatInput.value ? state.chatInput.value + '\n' : '') + template;
      state.chatInput.dispatchEvent(new Event('input'));
      state.chatInput.focus();
    }

    // ------------------------- Camera / screen capture -------------------------
    let captureModal, captureStream;
    function ensureCaptureModal() {
      if (captureModal) return;
      captureModal = document.createElement('div');
      captureModal.className = 'ax-capture-modal';
      captureModal.innerHTML = `<div class="ax-capture-card">
        <h4 data-capture-title>Capture</h4>
        <div class="ax-capture-viewport"><video autoplay playsinline muted></video><canvas style="display:none;"></canvas></div>
        <div class="ax-capture-actions">
          <button type="button" data-cancel>Cancel</button>
          <button type="button" class="primary" data-snap>Capture</button>
        </div>
      </div>`;
      document.body.appendChild(captureModal);
      captureModal.querySelector('[data-cancel]').addEventListener('click', closeCapture);
      captureModal.querySelector('[data-snap]').addEventListener('click', snapCapture);
    }
    async function openCapture(mode) {
      ensureCaptureModal();
      captureModal.querySelector('[data-capture-title]').textContent = mode === 'camera' ? 'Camera' : 'Screen capture';
      const video = captureModal.querySelector('video');
      try {
        captureStream = mode === 'camera'
          ? await navigator.mediaDevices.getUserMedia({ video: true })
          : await navigator.mediaDevices.getDisplayMedia({ video: true });
        video.srcObject = captureStream;
        video.style.display = '';
        captureModal.querySelector('canvas').style.display = 'none';
        captureModal.classList.add('open');
      } catch (err) {
        if (typeof showToast === 'function') showToast('Could not access ' + (mode === 'camera' ? 'camera' : 'screen') + ': ' + err.message);
      }
    }
    function snapCapture() {
      const video = captureModal.querySelector('video');
      const canvas = captureModal.querySelector('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      attachments.push({ id: 'att' + Math.random().toString(36).slice(2, 8), name: 'capture.png', kind: 'image', dataUrl, sub: 'Captured just now' });
      renderTray();
      closeCapture();
    }
    function closeCapture() {
      if (captureStream) { captureStream.getTracks().forEach(t => t.stop()); captureStream = null; }
      captureModal.classList.remove('open');
    }

    // Small inline icons for quick-tools (kept local to avoid clutter above)
    function camIcon() { return '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="15" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M17 10l5-3v10l-5-3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'; }
    function screenIcon() { return '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; }
    function diagramIcon() { return '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="6" rx="1.4" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="15" width="7" height="6" rx="1.4" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 9v3a2 2 0 002 2H14M17.5 15v-1a2 2 0 00-2-2H14" stroke="currentColor" stroke-width="1.6"/></svg>'; }
    function compareIcon() { return '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="8" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="4" width="8" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/></svg>'; }
    function pdfIcon() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6"/></svg>'; }
    function fileIcon() { return pdfIcon(); }
    function chevronIcon() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }

    // ============================================================
    // 10) WIRE ATTACHMENT CONTEXT INTO OUTGOING MESSAGES
    // ------------------------------------------------------------
    // Prepends a short, plain-text note about each attachment to the
    // user's message before it's sent, and renders a proper preview
    // (image/file chip) inside their own chat bubble.
    // ============================================================
    const originalSubmitCapture = (e) => {
      if (!attachments.length) return;
      const notes = attachments.map(a => {
        if (a.kind === 'image') return `[Attached image: ${a.name}]`;
        if (a.kind === 'pdf') return `[Attached PDF "${a.name}"${a.text ? ' — extracted text:\n' + a.text.slice(0, 4000) : ''}]`;
        return `[Attached file "${a.name}"${a.text ? ':\n' + a.text.slice(0, 4000) : ''}]`;
      });
      state.chatInput.value = (notes.join('\n') + '\n\n' + state.chatInput.value).trim();
      const pending = attachments.slice();
      attachments = [];
      renderTray();
      // After the DOM turn is appended by app.js, drop in visual previews.
      requestAnimationFrame(() => {
        const lastUserEl = [...chatWindow.querySelectorAll('.ax-message.user')].pop();
        const bubble = lastUserEl && lastUserEl.querySelector('.ax-msg-bubble');
        if (!bubble) return;
        pending.forEach(a => {
          if (a.kind === 'image' && a.dataUrl) {
            const img = document.createElement('img');
            img.className = 'ax-msg-image';
            img.src = a.dataUrl;
            bubble.appendChild(img);
          } else {
            const chip = document.createElement('div');
            chip.className = 'ax-msg-file';
            chip.innerHTML = `${pdfIcon()}<div class="ax-file-info"><span class="ax-file-name">${escapeHtml(a.name)}</span><span class="ax-file-size">${escapeHtml(a.sub || '')}</span></div>`;
            bubble.appendChild(chip);
          }
        });
      });
    };
    // NOTE: a second listener on chatForm itself would still fire *after*
    // app.js's handler (same-element listeners run in registration order,
    // capture flag notwithstanding) — so this is attached on document's
    // capture phase instead, which runs while the event is still on its
    // way down to the form.
    document.addEventListener('submit', (e) => {
      if (e.target === document.getElementById('chatForm')) originalSubmitCapture(e);
    }, true);

    // ============================================================
    // BOOT
    // ============================================================
    buildInputBarChrome();

    // Decorate/finalize any message app.js rendered before this script
    // finished loading (e.g. the static welcome bubble in the HTML).
    document.querySelectorAll('.ax-message').forEach(el => {
      const role = el.classList.contains('user') ? 'user' : 'assistant';
      const id = el.dataset.msgId || state.nextMsgId();
      el.dataset.msgId = id;
      decorateMessage(el, { id, role });
    });

    document.addEventListener('axiom:message-appended', (e) => {
      // handled inline by addChatMessage's direct call to decorateMessage;
      // this listener exists for any future cross-module consumers.
    });

    // ============================================================
    // INTEGRATION WITH AxiomChatCore (sidebar persistence)
    // ============================================================
    function saveCurrentConversation() {
      if (!window.AxiomChatCore || !state) return;
      const convo = window.AxiomChatCore.getCurrent();
      if (!convo) return;
      const messages = state.uiMessages.map(m => ({
        role: m.role,
        content: m.content,
        model: m.model
      }));
      convo.messages = messages;
      window.AxiomChatCore.save();
    }

    // Save after each new message
    const origFinalize = finalizeMessage;
    finalizeMessage = async function(el, bubble, content, meta) {
      await origFinalize.call(this, el, bubble, content, meta);
      // Render Math/LaTeX after markdown
      if (window.AxiomChatCore && window.renderMathInElement && bubble) {
        try { window.renderMathInElement(bubble); } catch (e) { /* ignore */ }
      }
      saveCurrentConversation();
    };

    // Handle conversation selection from sidebar
    document.addEventListener('ax-convo-select', (e) => {
      if (!e.detail || !e.detail.id) return;
      const convo = window.AxiomChatCore && window.AxiomChatCore.getById(e.detail.id);
      if (!convo) return;

      // Save current session first
      saveCurrentConversation();

      // Clear chat window
      chatWindow.innerHTML = '';

      // Rebuild messages
      if (convo.messages && convo.messages.length > 0) {
        convo.messages.forEach((msg, idx) => {
          const el = document.createElement('div');
          el.className = `ax-message ${msg.role} ax-msg-in`;
          el.innerHTML = `<div class="ax-msg-avatar">${msg.role === 'assistant' ? 'AX' : 'You'}</div>
            <div class="ax-msg-col"><div class="ax-msg-bubble"></div></div>`;
          chatWindow.appendChild(el);
          const bubble = el.querySelector('.ax-msg-bubble');
          const meta = { id: 'msg_' + idx, role: msg.role, model: msg.model };
          el.dataset.msgId = meta.id;
          decorateMessage(el, meta);
          finalizeMessage(el, bubble, msg.content, meta);
        });
      } else {
        // Empty conversation
        chatWindow.innerHTML = `<div class="ax-message assistant ax-msg-in">
          <div class="ax-msg-avatar">AX</div>
          <div class="ax-msg-bubble">Start a new conversation...</div>
        </div>`;
      }

      // Update state uiMessages
      if (state && convo.messages) {
        state.uiMessages = [];
        state.chatHistory = [];
        convo.messages.forEach((msg) => {
          state.chatHistory.push({ role: msg.role, content: msg.content });
        });
        // Rebuild uiMessages from DOM
        chatWindow.querySelectorAll('.ax-message').forEach(el => {
          const role = el.classList.contains('user') ? 'user' : 'assistant';
          const bubble = el.querySelector('.ax-msg-bubble');
          const content = bubble ? (bubble.dataset.rawText || bubble.textContent) : '';
          const id = el.dataset.msgId || 'msg_' + Math.random().toString(36).slice(2, 8);
          state.uiMessages.push({ id, role, content, el, bubble });
        });
      }
    });

    // Save on page unload
    window.addEventListener('beforeunload', saveCurrentConversation);

    // Save periodically
    setInterval(saveCurrentConversation, 10000);

    window.AxiomChatUltimate = {
      decorateMessage,
      finalizeMessage,
      compareModeActive,
      handleCompareSend,
      renderMarkdown,
      branchFromMessage,
      ensureMainSession,
      saveCurrentConversation
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
