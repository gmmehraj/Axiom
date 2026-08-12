// ============================================
// Toast helper (used across dashboard/billing/settings/playground)
// ============================================
function showToast(message) {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  // Built with DOM nodes rather than an innerHTML template so this stays
  // safe even if a future caller passes text derived from user input.
  toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(span);
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'opacity .25s, transform .25s';
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

// ============================================
// Sidebar toggle (mobile drawer)
// ============================================
const sidebar = document.querySelector('.app-sidebar');
const menuToggle = document.querySelector('.app-menu-toggle');
let scrim = document.querySelector('.sidebar-scrim');
if (sidebar && menuToggle) {
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'sidebar-scrim';
    document.body.appendChild(scrim);
  }
  const closeSidebar = () => { sidebar.classList.remove('open'); scrim.classList.remove('open'); };
  const openSidebar = () => { sidebar.classList.add('open'); scrim.classList.add('open'); };
  menuToggle.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  scrim.addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => { if (window.innerWidth > 900) closeSidebar(); });
}

// ============================================
// Playground: tool switcher
// ============================================
const pgToolBtns = document.querySelectorAll('.pg-tool-btn');
const pgPanels = document.querySelectorAll('.pg-panel');
pgToolBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tool;
    pgToolBtns.forEach(b => b.classList.remove('active'));
    pgPanels.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.querySelector(`.pg-panel[data-tool="${target}"]`);
    if (panel) panel.classList.add('active');
  });
});

// ============================================
// Playground: OpenRouter-powered chat
// Requires openrouter-config.js + openrouter-client.js (window.OpenRouter)
// and model-selector.js (window.ModelSelector) to be loaded BEFORE this
// file. Both are guarded below so this block degrades safely — and only
// once — if either is missing, or if this page has no chat panel at all.
// ============================================
const chatForm = document.getElementById('chatForm');
const chatWindow = document.getElementById('chatWindow');
const chatInput = document.getElementById('chatInput');
const modelSelect = document.getElementById('modelSelect');
const creditsBanner = document.getElementById('creditsBanner');

let chatHistory = [];              // { role: 'user' | 'assistant', content: string }[] — sent to the API as-is
let uiMessages = [];                // { id, role, content, el, bubble, model } — mirrors chatHistory (minus the system row), 1:1 with visible messages
let chatAbortController = null;    // cancels an in-flight stream if a new message is sent
let msgSeq = 0;

function nextMsgId() { return 'm' + (++msgSeq); }

function historyOffset() {
  return (chatHistory[0] && chatHistory[0].role === 'system') ? 1 : 0;
}

// Removes uiMessages[idx..] (and their DOM) plus the matching tail of
// chatHistory, so regenerate/edit/branch can rewind the conversation to
// any earlier point before continuing from there.
function truncateFromUiIndex(idx) {
  for (let i = idx; i < uiMessages.length; i++) {
    if (uiMessages[i] && uiMessages[i].el) uiMessages[i].el.remove();
  }
  uiMessages.length = idx;
  chatHistory.length = historyOffset() + idx;
}

function currentModel() {
  return (typeof ModelSelector !== 'undefined' && ModelSelector.getSelectedModel())
    || (typeof OpenRouterConfig !== 'undefined' ? OpenRouterConfig.DEFAULT_MODEL : null);
}

// Builds one message bubble. Rendering (markdown/mermaid/code actions) and
// the hover action toolbar (copy/regenerate/edit/branch) are layered on by
// ai-workspace-ultimate.js when it's present, so this stays a plain,
// dependency-free fallback on its own.
function addChatMessage(role, text, meta) {
  if (!chatWindow) return null;
  meta = meta || {};
  const id = meta.id || nextMsgId();

  const msg = document.createElement('div');
  msg.className = `ax-message ${role} ax-msg-in`;
  msg.dataset.msgId = id;

  const avatar = document.createElement('div');
  avatar.className = 'ax-msg-avatar';
  avatar.textContent = role === 'user' ? 'You' : 'AX';

  const col = document.createElement('div');
  col.className = 'ax-msg-col';

  const bubble = document.createElement('div');
  bubble.className = 'ax-msg-bubble';
  bubble.textContent = text;
  col.appendChild(bubble);

  msg.appendChild(avatar);
  msg.appendChild(col);
  chatWindow.appendChild(msg);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // Screen reader users can't see a new bubble appear the way sighted
  // users can — announce it via the shared live region from
  // accessibility.js. Streamed replies are announced separately once
  // complete (see streamAssistantReply's onDone) to avoid re-announcing
  // on every token; this covers everything else that calls
  // addChatMessage directly (errors, the "no response" fallback, and
  // any non-streaming assistant turn).
  if (role === 'assistant' && text && window.AxiomA11y && typeof window.AxiomA11y.announce === 'function') {
    window.AxiomA11y.announce(text);
  }

  if (window.AxiomChatUltimate && typeof window.AxiomChatUltimate.decorateMessage === 'function') {
    window.AxiomChatUltimate.decorateMessage(msg, { id, role, content: text, model: meta.model });
  }
  document.dispatchEvent(new CustomEvent('axiom:message-appended', { detail: { id, role, el: msg, bubble } }));
  return msg;
}

// A message that's already complete (no streaming) — used for the user's
// own turn, and for rebuilding a forked/branched session in one shot.
function appendFinishedTurn(role, content, meta) {
  meta = meta || {};
  const id = meta.id || nextMsgId();
  const el = addChatMessage(role, content, { id, model: meta.model });
  const bubble = el ? el.querySelector('.ax-msg-bubble') : null;
  chatHistory.push({ role, content });
  uiMessages.push({ id, role, content, el, bubble, model: meta.model });
  if (role === 'assistant' && window.AxiomChatUltimate && typeof window.AxiomChatUltimate.finalizeMessage === 'function') {
    window.AxiomChatUltimate.finalizeMessage(el, bubble, content, { id });
  }
  return { id, el, bubble };
}

// Like appendFinishedTurn, but lets the content sent to the API differ
// from what's displayed — e.g. a vision message's `content` is an array
// of {type, text/image_url} blocks, while the bubble should just show a
// short "attached image" label. Keeps chatHistory and uiMessages 1:1
// either way, so regenerate/edit truncation math never desyncs.
function appendRawTurn(role, apiContent, displayText, meta) {
  meta = meta || {};
  const id = meta.id || nextMsgId();
  const el = addChatMessage(role, displayText, { id, model: meta.model });
  const bubble = el ? el.querySelector('.ax-msg-bubble') : null;
  chatHistory.push({ role, content: apiContent });
  uiMessages.push({ id, role, content: displayText, el, bubble, model: meta.model });
  return { id, el, bubble };
}

function createTypingMessage() {
  if (!chatWindow) return null;
  const typingMsg = document.createElement('div');
  typingMsg.className = 'ax-message assistant ax-msg-in';
  // Same bubble/avatar structure as a real reply -- just an "AI is thinking"
  // label next to the existing dot animation, and a breathing avatar so the
  // thinking state reads clearly at a glance before tokens start arriving.
  typingMsg.innerHTML = `<div class="ax-msg-avatar is-thinking">AX</div><div class="ax-msg-col"><div class="ax-msg-bubble"><span class="ax-typing"><span class="ax-typing-label">Thinking</span><span class="ax-typing-dots"><span></span><span></span><span></span></span></span></div></div>`;
  chatWindow.appendChild(typingMsg);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return typingMsg;
}

// Runs ONE streaming round-trip against the current chatHistory. Resolves
// with { fullText, toolCalls, finishReason, aborted, errored, id, el, bubble, model }
// — never rejects. This is the same OpenRouter.streamChat() transport used
// before tool-calling wiring landed; it now also forwards `tools` (when the
// live tool executor has any to offer) and reports back any tool_calls the
// model asked for, but does not itself decide what to do with them — that
// loop lives in streamAssistantReply() below.
function runOneStreamRound(model, temperature, tools, signal, showTyping) {
  return new Promise((resolve) => {
    const typingMsg = showTyping ? createTypingMessage() : null;
    let bubble = null, el = null, started = false;
    const id = nextMsgId();

    let pendingText = null;
    let framePending = false;
    let streamEnded = false;
    function flushPendingText() {
      framePending = false;
      if (streamEnded || !bubble || pendingText === null) return;
      bubble.textContent = pendingText;
      chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'thinking' } }));

    OpenRouter.streamChat({
      model,
      messages: chatHistory,
      temperature,
      tools: (Array.isArray(tools) && tools.length > 0) ? tools : undefined,
      signal,
      onToken: (_delta, fullText) => {
        if (!started) {
          started = true;
          if (typingMsg) typingMsg.remove();
          el = addChatMessage('assistant', '', { id, model });
          bubble = el ? el.querySelector('.ax-msg-bubble') : null;
          document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'answering' } }));
        }
        if (bubble) {
          pendingText = fullText;
          if (!framePending) {
            framePending = true;
            requestAnimationFrame(flushPendingText);
          }
        }
      },
      onDone: (fullText, aborted, extra) => {
        streamEnded = true;
        if (bubble) bubble.textContent = fullText;
        const toolCalls = extra && Array.isArray(extra.toolCalls) ? extra.toolCalls : null;
        const finishReason = extra ? extra.finishReason : null;
        if (aborted) {
          document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'idle' } }));
          resolve({ aborted: true, fullText, toolCalls: null, finishReason, id, el, bubble, model, started });
          return;
        }
        if (!started && !toolCalls) {
          if (typingMsg) typingMsg.remove();
        }
        resolve({ aborted: false, fullText, toolCalls, finishReason, id, el, bubble, model, started });
      },
      onError: (err) => {
        document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'error' } }));
        if (typingMsg) typingMsg.remove();
        resolve({ aborted: false, errored: err, fullText: '', toolCalls: null, finishReason: null, id, el: null, bubble: null, model, started: false });
      }
    });
  });
}

// Maximum number of tool round-trips (model -> tool_calls -> tool results ->
// model again) for a single user turn, per spec §9. Local to this
// request/continuation loop only — not a global subsystem.
const MAX_TOOL_ROUNDS = 8;

// Runs a full assistant turn against the current chatHistory, including any
// live tool-calling round-trips, and streams the final answer into the chat
// window. Shared by the normal submit flow, Regenerate, and Edit-and-resend
// so credits/agents/system-prompt/tool-calling logic only lives once.
async function streamAssistantReply(opts) {
  opts = opts || {};
  const model = opts.model || currentModel();
  const temperature = opts.temperature;

  document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'thinking' } }));

  if (chatAbortController) chatAbortController.abort();
  chatAbortController = new AbortController();
  const signal = chatAbortController.signal;

  // Live tool definitions — sourced entirely from the existing AXIOM tool
  // registry via the bridge, never invented here. Absent/empty when the
  // executor or bridge isn't loaded, or no agent currently exposes tools —
  // in which case this turn behaves exactly as it did before tool wiring.
  let tools = null;
  if (window.AxiomLiveToolExecutor && typeof window.AxiomLiveToolExecutor.ensureInitialized === 'function') {
    window.AxiomLiveToolExecutor.ensureInitialized();
    tools = window.AxiomLiveToolExecutor.getToolDefinitions();
  }

  const seenToolCallIds = new Set(); // duplicate tool_call.id protection (spec §10), scoped to this user turn

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isFirstRound = round === 0;
    const result = await runOneStreamRound(model, temperature, tools, signal, isFirstRound);

    if (result.errored) {
      const err = result.errored;
      console.error('[Playground] chat error:', err);
      showToast(err.message || 'Something went wrong talking to the AI.');
      addChatMessage('assistant', `⚠️ ${err.message || 'Request failed.'}`);
      if (err.code === 'NO_CREDITS') {
        if (window.AxiomProfile) window.AxiomProfile.credits = 0;
        updateCreditsBanner();
      }
      return null;
    }

    if (result.aborted) {
      if (window.AxiomLiveToolExecutor && typeof window.AxiomLiveToolExecutor.cancelPending === 'function') {
        window.AxiomLiveToolExecutor.cancelPending('stream_aborted');
      }
      return null;
    }

    const hasToolCalls = Array.isArray(result.toolCalls) && result.toolCalls.length > 0;

    if (!hasToolCalls) {
      // Normal final turn — identical finishing behavior to before tool
      // wiring landed.
      document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'idle' } }));
      if (!result.started) {
        addChatMessage('assistant', "I didn't get a response back — please try again.");
        return null;
      }
      const { id, el, bubble, fullText } = result;
      chatHistory.push({ role: 'assistant', content: fullText });
      uiMessages.push({ id, role: 'assistant', content: fullText, el, bubble, model });
      if (window.AxiomA11y && typeof window.AxiomA11y.announce === 'function') {
        window.AxiomA11y.announce(fullText);
      }
      if (window.AxiomChatUltimate && typeof window.AxiomChatUltimate.finalizeMessage === 'function') {
        window.AxiomChatUltimate.finalizeMessage(el, bubble, fullText, { id, model });
      }
      refreshCreditsDisplay();
      return { id, el, bubble, fullText, model };
    }

    // ---- Tool-calling round: preserve the assistant message that
    // requested the calls (with the ORIGINAL tool_call.id values), execute
    // every call, append one role:"tool" message per call (spec §6), then
    // loop back for the model's follow-up. ----
    if (result.started && result.bubble) {
      result.bubble.textContent = result.fullText || 'Using tools…';
    }

    chatHistory.push({
      role: 'assistant',
      content: result.fullText || null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.argumentsRaw !== undefined ? tc.argumentsRaw : JSON.stringify(tc.arguments || {}) }
      }))
    });

    document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'using-tools' } }));

    if (!window.AxiomLiveToolExecutor || typeof window.AxiomLiveToolExecutor.executeToolCall !== 'function') {
      // No executor loaded — every call fails safely, model gets a chance
      // to respond to that rather than the turn silently hanging.
      result.toolCalls.forEach((tc) => {
        chatHistory.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'Tool execution is unavailable in this session.' }) });
      });
      continue;
    }

    // spec §7: execute every call in this round independently, wait for ALL
    // results, only then continue.
    const executions = result.toolCalls.map((tc) => {
      if (seenToolCallIds.has(tc.id)) {
        return Promise.resolve({ tool_call_id: tc.id, content: JSON.stringify({ error: 'Duplicate tool_call.id in this turn — skipped.' }) });
      }
      seenToolCallIds.add(tc.id);
      return window.AxiomLiveToolExecutor.executeToolCall(tc.raw || { id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.argumentsRaw } });
    });

    const toolResults = await Promise.all(executions);

    if (signal.aborted) {
      if (window.AxiomLiveToolExecutor && typeof window.AxiomLiveToolExecutor.cancelPending === 'function') {
        window.AxiomLiveToolExecutor.cancelPending('stream_aborted');
      }
      return null;
    }

    toolResults.forEach((r) => {
      chatHistory.push({ role: 'tool', tool_call_id: r.tool_call_id, content: r.content });
    });
    // continue loop -> follow-up request through the SAME openrouter-client
    // transport, with the updated chatHistory (spec: "then send the
    // complete updated conversation back through the existing
    // Supabase/OpenRouter transport").
  }

  // Tool-turn limit reached (spec §9) — surface this the same way any other
  // incomplete turn is surfaced, rather than looping forever.
  document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'idle' } }));
  addChatMessage('assistant', '⚠️ Reached the tool-call limit for this turn (8 rounds) without a final answer.');
  return null;
}

function hasCredits() {
  const profile = window.AxiomProfile;
  return !profile || (profile.credits ?? 0) > 0; // profile not loaded yet: don't block optimistically
}
function updateCreditsBanner() {
  if (!creditsBanner) return;
  creditsBanner.style.display = hasCredits() ? 'none' : 'flex';
}
document.addEventListener('axiom:profile-ready', updateCreditsBanner);

async function refreshCreditsDisplay() {
  if (typeof AXIOM_DEV_MODE !== 'undefined' && AXIOM_DEV_MODE) {
    window.AxiomProfile = { ...(window.AxiomProfile || {}), credits: AXIOM_DEV_PROFILE.credits };
    document.querySelectorAll('[data-user-credits]').forEach(el => el.textContent = AXIOM_DEV_PROFILE.credits.toLocaleString());
    updateCreditsBanner();
    return;
  }
  if (typeof supabaseClient === 'undefined') return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('credits')
    .eq('id', session.user.id)
    .single();
  if (!profile) return;
  window.AxiomProfile = { ...(window.AxiomProfile || {}), credits: profile.credits };
  document.querySelectorAll('[data-user-credits]').forEach(el => el.textContent = profile.credits.toLocaleString());
  updateCreditsBanner();
}

if (chatForm && chatWindow && chatInput) {
  if (typeof OpenRouter === 'undefined') {
    console.error(
      '[Playground] window.OpenRouter is missing — chat disabled. ' +
      'Make sure openrouter-config.js and openrouter-client.js load before app.js.'
    );
    if (typeof showToast === 'function') showToast('Chat is unavailable: OpenRouter failed to load.');
  } else {
    updateCreditsBanner();

    if (modelSelect && typeof ModelSelector !== 'undefined') {
      ModelSelector.init(modelSelect);
    } else if (!modelSelect) {
      console.warn('[Playground] #modelSelect not found — chat will use the default model only.');
    } else {
      console.error('[Playground] window.ModelSelector is missing — make sure model-selector.js loads before app.js.');
    }

    // Builds (or refreshes) the language instruction that keeps the model's
    // replies in step with whatever language the UI is set to, while still
    // letting the user's own words override it — mirrors jarvis.js's
    // buildSystemPrompt() so the two chat surfaces behave consistently.
    function buildPlaygroundSystemPrompt() {
      const meta = window.AxiomI18n && window.AxiomI18n.getLanguageMeta ? window.AxiomI18n.getLanguageMeta() : null;
      if (!meta || meta.code === 'en') return null;
      return `Default to replying in ${meta.name} (${meta.native}), the user's current interface language, unless they write in a different language — then mirror the language(s) they actually used, including naturally handling mixed-language messages.`;
    }

    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;

      if (!hasCredits()) {
        updateCreditsBanner();
        showToast(window.t ? window.t('playground.outOfCredits') : "You're out of credits. Top up in Billing.");
        return;
      }

      // Phase 6: when the AI Agent System is loaded on this page (see
      // agents.js / agent-chat-bridge.js), the active agent supplies the
      // system prompt (persona + its memory of this user) and preferred
      // temperature, layered on top of the existing language prompt
      // rather than replacing it. Pages without AxiomAgents (or before
      // sign-in resolves an active agent) fall back to the old
      // language-only prompt untouched.
      const langPrompt = buildPlaygroundSystemPrompt();
      let activeAgent = null;
      let systemPrompt = langPrompt;
      if (typeof AxiomAgents !== 'undefined') {
        try {
          activeAgent = await AxiomAgents.getActive();
          systemPrompt = await AxiomAgents.buildSystemPrompt(activeAgent, { basePrompt: langPrompt });
        } catch (err) {
          console.warn('[Playground] AxiomAgents unavailable, falling back to plain chat:', err.message);
        }
      }

      // Keep exactly one system message at index 0, refreshed each send so
      // an agent switch or language switch mid-conversation takes effect
      // on the next message.
      if (chatHistory[0] && chatHistory[0].role === 'system') {
        if (systemPrompt) chatHistory[0].content = systemPrompt;
        else chatHistory.shift();
      } else if (systemPrompt) {
        chatHistory.unshift({ role: 'system', content: systemPrompt });
      }

      // Part 5 — Compare mode: when active, the Ultimate module fans this
      // message out to several models side-by-side instead of the normal
      // single-reply flow. It reads/writes chatHistory via
      // window.AxiomChatState, so credits/agents/system-prompt handling
      // above still applies once, right here.
      if (window.AxiomChatUltimate && typeof window.AxiomChatUltimate.compareModeActive === 'function'
          && window.AxiomChatUltimate.compareModeActive()) {
        chatInput.value = '';
        chatInput.style.height = 'auto';
        await window.AxiomChatUltimate.handleCompareSend(text);
        return;
      }

      appendFinishedTurn('user', text);
      chatInput.value = '';
      chatInput.style.height = 'auto';

      // Milestone 5: hand the same text to the Multi-Agent Runtime so
      // "Open YouTube", "Remember: buy milk", "Create a plan for X" etc.
      // actually reach the Browser/Memory/Planner/File agents. This is a
      // background side-effect — it never blocks or replaces the normal
      // streamed AI reply below, and a routing failure never surfaces as
      // a chat error.
      if (window.AxiomAgentManager && typeof window.AxiomAgentManager.route === 'function') {
        try { window.AxiomAgentManager.route(text, { via: 'chat' }); }
        catch (err) { console.warn('[Playground] agent routing failed:', err); }
      }

      const temperature = activeAgent && typeof activeAgent.temperature === 'number' ? activeAgent.temperature : undefined;
      await streamAssistantReply({ model: currentModel(), temperature });
    });

    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
    });
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.requestSubmit();
      }
    });

    // ============================================
    // Part 5 — public surface for ai-workspace-ultimate.js: regenerate,
    // edit-and-resend, fork/branch and compare all operate through these
    // primitives instead of re-implementing the send pipeline.
    // ============================================
    window.AxiomChatState = {
      get chatHistory() { return chatHistory; },
      get uiMessages() { return uiMessages; },
      chatWindow,
      chatInput,
      chatForm,
      historyOffset,
      truncateFromUiIndex,
      currentModel,
      appendFinishedTurn,
      appendRawTurn,
      streamAssistantReply,
      nextMsgId,

      // Replaces the *contents* of the live chatHistory/uiMessages arrays
      // (rather than reassigning them) so every closure above keeps
      // working after switching to a forked/branched session.
      replaceSession(newHistory, newUiMessages) {
        if (chatAbortController) chatAbortController.abort();
        chatHistory.length = 0;
        if (Array.isArray(newHistory)) newHistory.forEach(m => chatHistory.push(m));
        uiMessages.length = 0;
        if (Array.isArray(newUiMessages)) newUiMessages.forEach(m => uiMessages.push(m));
      },

      async regenerate(assistantId) {
        const idx = uiMessages.findIndex(m => m.id === assistantId);
        if (idx === -1) return null;
        truncateFromUiIndex(idx);
        return streamAssistantReply({ model: currentModel() });
      },

      async editAndResend(userId, newText) {
        const idx = uiMessages.findIndex(m => m.id === userId);
        if (idx === -1) return null;
        truncateFromUiIndex(idx);
        appendFinishedTurn('user', newText);
        return streamAssistantReply({ model: currentModel() });
      }
    };
  }
}

// ============================================
// Playground: mock generation (image/video/voice/code)
// ============================================
document.querySelectorAll('.gen-generate-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.closest('.pg-panel');
    const outputs = panel.querySelectorAll('.gen-output');
    outputs.forEach(o => {
      o.classList.add('loading');
      o.innerHTML = '';
    });
    setTimeout(() => {
outputs.forEach((o, i) => {
        o.classList.remove('loading');
        const gradients = [
          'linear-gradient(155deg,rgba(255,255,255,.15) 0%,rgba(255,255,255,.05) 55%,rgba(0,0,0,.3) 100%)',
          'linear-gradient(155deg,#F6C453 0%,#F2657A 55%,#2A0E18 100%)',
          'linear-gradient(155deg,#4FD1C5 0%,#1F6E68 55%,#081615 100%)',
          'linear-gradient(155deg,rgba(200,200,255,.3) 0%,rgba(255,255,255,.1) 55%,rgba(0,0,0,.3) 100%)'
        ];
        o.style.background = gradients[i % gradients.length];
      });
      showToast(window.t ? window.t('playground.generationComplete') : 'Generation complete');
    }, 1400);
  });
});

// ============================================
// Chips (single-select within a row)
// ============================================
document.querySelectorAll('.chip-row').forEach(row => {
  row.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      row.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
});

// ============================================
// Settings: tabs
// ============================================
const settingsTabs = document.querySelectorAll('.settings-tab');
const settingsPanels = document.querySelectorAll('.settings-panel');
settingsTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    settingsTabs.forEach(t => t.classList.remove('active'));
    settingsPanels.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.settings-panel[data-tab="${target}"]`)?.classList.add('active');
  });
});

// ============================================
// Generic mock-save buttons (settings, billing) — just confirms via toast
// ============================================
document.querySelectorAll('[data-mock-save]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    showToast(btn.dataset.mockSave || 'Saved');
  });
});

// ============================================
// Voice (Phase 3): Scribe chat mic — push-to-talk / hands-free, wired
// through JarvisVoiceController exactly like the JARVIS side panel, so
// both chat surfaces behave identically. Guarded so pages without a chat
// panel (or without voice-controller.js loaded) are unaffected.
// ============================================
(function () {
  const pgMic = document.getElementById('pgMic');
  if (!pgMic || !chatForm || !chatInput || typeof window.JarvisVoiceController === 'undefined') return;

  const wave = document.getElementById('pgVoiceWave');
  const hint = document.getElementById('pgVoiceHint');
  const DEFAULT_HINT = hint ? hint.textContent : '';
  let voiceActive = false;

  function setHint(text, isError) {
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('is-error', !!isError);
  }

  function setActive(on) {
    voiceActive = on;
    pgMic.classList.toggle('on', on);
    pgMic.setAttribute('aria-pressed', String(on));
    if (wave) wave.classList.toggle('active', on);
  }

  function onFinal(transcript) {
    setActive(false);
    setHint(DEFAULT_HINT);
    chatInput.value = transcript;
    chatForm.requestSubmit();
  }
  function onErr(err) {
    setActive(false);
    setHint(err.message, true);
    setTimeout(() => setHint(DEFAULT_HINT), 4000);
  }

  function start() {
    if (!window.JarvisVoiceController.isSupported().recognition) {
      onErr(window.JarvisVoiceController.normalizeError('unsupported'));
      return;
    }
    setActive(true);
    document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'listening' } }));
    if (typeof JarvisMic !== 'undefined') JarvisMic.enable();
    const settings = window.JarvisVoiceController.getSettings();
    const fn = settings.continuous ? window.JarvisVoiceController.handsFreeStart : window.JarvisVoiceController.pushToTalkStart;
    fn({
      onInterim: (text) => setHint(`Listening… "${text}"`),
      onFinal,
      onError: onErr,
      onTick: (secs) => { if (voiceActive) setHint(`Listening… 0:${String(secs).padStart(2, '0')}`); },
    });
  }
  function stop() {
    window.JarvisVoiceController.stopListening();
    setActive(false);
    setHint(DEFAULT_HINT);
    document.dispatchEvent(new CustomEvent('axiom:chat-state', { detail: { state: 'idle' } }));
  }

  pgMic.addEventListener('click', () => (voiceActive ? stop() : start()));

  // Auto-speak JARVIS's replies once they finish streaming, same
  // auto-speak / continuous-mode settings as the JARVIS panel. Tracks how
  // much of chatHistory has already been spoken so that 'idle' events
  // fired for other reasons (e.g. the user just released the mic without
  // saying anything) don't re-trigger speech for an old reply.
  let spokenUpTo = chatHistory.length;
  document.addEventListener('axiom:chat-state', (e) => {
    if (!(e.detail && e.detail.state === 'idle')) return;
    if (chatHistory.length <= spokenUpTo) return;
    spokenUpTo = chatHistory.length;
    const last = chatHistory[chatHistory.length - 1];
    if (last.role !== 'assistant') return;
    const settings = window.JarvisVoiceController.getSettings();
    if (settings.autoSpeak && window.AxiomVoice && window.AxiomVoice.isSynthesisSupported()) {
      window.JarvisVoiceController.speak(last.content, {
        onEnd: () => { if (window.JarvisVoiceController.getSettings().continuous) start(); },
      });
    }
  });

  window.JarvisVoiceController.bindShortcuts({
    onPTTDown: () => { if (!voiceActive && document.activeElement !== chatInput) start(); },
    onPTTUp: () => { if (voiceActive && !window.JarvisVoiceController.getSettings().continuous) stop(); },
    onToggleMic: () => (voiceActive ? stop() : start()),
    onStopSpeaking: () => window.JarvisVoiceController.stopSpeaking(),
  });
})();

// ============================================
// Voice (Phase 3): Playground "Voice" tool — real text-to-speech preview.
// Presets adjust rate/pitch for this one-off preview only (the persisted
// Settings > Voice preferences are untouched); "Cast a new voice" hands
// off to the full Voice Settings panel instead of guessing a new voice.
// ============================================
(function () {
  const speakBtn = document.getElementById('voiceSpeakBtn');
  const script = document.getElementById('voiceScriptInput');
  const wave = document.getElementById('voiceWave');
  const elapsed = document.getElementById('voiceElapsed');
  const statusText = document.getElementById('voiceStatusText');
  const presetRow = document.getElementById('voicePresetRow');
  if (!speakBtn || !script || typeof window.JarvisVoiceController === 'undefined') return;

  if (wave) wave.classList.add('is-idle');

  const PRESETS = {
    warm: { rate: 0.95, pitch: 0.95 },
    bright: { rate: 1.15, pitch: 1.2 },
    calm: { rate: 0.85, pitch: 0.85 },
  };
  let activePreset = PRESETS.warm;

  if (presetRow) {
    presetRow.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        presetRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const key = chip.dataset.preset;
        if (key === 'cast') { window.location.href = 'settings.html#language'; return; }
        activePreset = PRESETS[key] || PRESETS.warm;
      });
    });
  }

  let timerHandle = null;
  function startTimerUI() {
    const startedAt = Date.now();
    timerHandle = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      if (elapsed) elapsed.textContent = `0:${String(secs).padStart(2, '0')}`;
    }, 250);
  }
  function stopTimerUI() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }

  speakBtn.addEventListener('click', () => {
    const text = script.value.trim();
    if (!text) { showToast('Type a script first.'); return; }
    if (!window.JarvisVoiceController.isSupported().synthesis) {
      showToast("Your browser doesn't support speech synthesis.");
      return;
    }
    if (wave) { wave.classList.remove('is-idle'); }
    if (statusText) statusText.textContent = 'Speaking…';
    startTimerUI();
    const settings = window.JarvisVoiceController.getSettings();
    window.AxiomVoice.speak(text, {
      lang: window.AxiomVoice.toSpeechLang(settings.voiceLang || (window.AxiomI18n ? window.AxiomI18n.getLanguage() : 'en')),
      rate: activePreset.rate,
      pitch: activePreset.pitch,
      volume: settings.volume,
      voiceName: settings.voiceName || undefined,
      onEnd: () => {
        stopTimerUI();
        if (wave) wave.classList.add('is-idle');
        if (statusText) statusText.textContent = 'Ready';
        if (elapsed) elapsed.textContent = '0:00';
      },
      onError: () => {
        stopTimerUI();
        if (wave) wave.classList.add('is-idle');
        if (statusText) statusText.textContent = 'Ready';
        showToast('Speech synthesis failed.');
      },
    });
  });
})();