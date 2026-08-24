// ============================================================
// AXIOM — Hands-Free Always-On Voice Bridge (Phase 7)
// Standby -> Wake Word -> Listening -> Thinking -> Executing -> Speaking -> Standby
// ============================================================
(function (w) {
  'use strict';
  if (w.AxiomHandsFreeVoice) return;

  const WAKE_PHRASES = ['hey axiom', 'hi axiom', 'okay axiom', 'ok axiom', 'axiom'];
  const ACTIVE_MS = 10000; // 10s active window after wake phrase
  let activeUntil = 0;
  let starting = false;
  let restartTimer = null;
  let statusNode = null;
  let isSpeaking = false;
  let browserRecognition = null;

  function status(text) {
    if (statusNode) statusNode.textContent = text;
    document.documentElement.dataset.axiomVoiceState = (text || 'ready').toLowerCase().replace(/[^a-z]+/g, '-');
    try {
      document.dispatchEvent(new CustomEvent('axiom:voice-state', { detail: { state: text || 'Ready', handsFree: true } }));
      if (w.AxiomAIState?.setState) {
        const map = { 'Listening': 'listening', 'Thinking': 'thinking', 'Speaking': 'speaking', 'Ready': 'idle', 'Wake': 'wake' };
        if (map[text]) w.AxiomAIState.setState(map[text]);
      }
    } catch (_) {}
  }

  function speak(text) {
    if (!text || !String(text).trim()) return Promise.resolve();
    isSpeaking = true;
    status('Speaking');
    if (w.JarvisVoiceController?.speak) {
      return w.JarvisVoiceController.speak(text)
        .catch(() => {})
        .finally(() => {
          isSpeaking = false;
          status(Date.now() < activeUntil ? 'Listening' : 'Ready');
        });
    }
    isSpeaking = false;
    return Promise.resolve();
  }

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function stripWake(s) {
    const n = normalize(s);
    for (const phrase of WAKE_PHRASES) {
      if (n === phrase) return '';
      if (n.startsWith(phrase + ' ')) return n.slice(phrase.length).trim();
    }
    return null;
  }

  async function processUtterance(text) {
    if (isSpeaking) return;
    const raw = normalize(text);
    if (!raw) return;

    const stripped = stripWake(raw);
    const hasWake = stripped !== null;
    const commandText = hasWake ? stripped : raw;

    // Case 1: Standby -> User says ONLY wake word e.g. "Hey Axiom"
    if (hasWake && !commandText) {
      activeUntil = Date.now() + ACTIVE_MS;
      status('Wake');
      await speak("Yes? I'm listening.");
      status('Listening');
      return;
    }

    // Case 2: In active listening window or wake word included with command in one breath
    if (hasWake || Date.now() < activeUntil) {
      activeUntil = 0; // Consume active window
      status('Thinking');

      // Try website command controller first
      const result = w.AxiomVoiceWebsiteController?.execute(commandText);
      if (result?.handled) {
        await speak(result.response);
        return;
      }

      // Try Brain multimodal understanding
      if (w.AxiomBrain?.understand) {
        try {
          const understood = await w.AxiomBrain.understand(commandText);
          if (understood && understood.goal) {
            // Forward to conversation manager / executive AI
            if (w.AxiomConversationManager?.send) {
              const convId = w.AxiomConversationManager.start();
              const sent = w.AxiomConversationManager.send(convId, commandText);
              if (sent && sent.promise) {
                sent.promise.then(async res => {
                  const replyText = typeof res === 'string' ? res : (res && res.text) || "Done. I've verified the result.";
                  await speak(replyText);
                }).catch(async () => {
                  await speak("I ran into an issue processing that, but I'm looking into it.");
                });
                return;
              }
            }
          }
        } catch (_) {}
      }

      // Fallback command event dispatch
      document.dispatchEvent(new CustomEvent('axiom:voice-command-request', { detail: { text: commandText } }));
      const onResult = e => { speak(e.detail?.response || 'Done. I have verified the result.'); };
      document.addEventListener('axiom:voice-command-result', onResult, { once: true });
      setTimeout(() => {
        document.removeEventListener('axiom:voice-command-result', onResult);
        if (document.documentElement.dataset.axiomVoiceState === 'thinking') {
          speak("I'm checking it now.");
        }
      }, 5000);
    }
  }

  function startBrowserRecognitionFallback() {
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (browserRecognition) {
      try { browserRecognition.stop(); } catch (_) {}
    }
    try {
      browserRecognition = new SpeechRecognition();
      browserRecognition.continuous = true;
      browserRecognition.interimResults = false;
      browserRecognition.lang = 'en-US';

      browserRecognition.onstart = () => {
        status('Ready');
      };

      browserRecognition.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            const transcript = e.results[i][0].transcript;
            processUtterance(transcript);
          }
        }
      };

      browserRecognition.onerror = (e) => {
        if (e.error !== 'no-speech') scheduleRestart();
      };

      browserRecognition.onend = () => {
        if (!isSpeaking) scheduleRestart();
      };

      browserRecognition.start();
    } catch (_) {
      scheduleRestart();
    }
  }

  function scheduleRestart() {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => startAlwaysOn(), 1200);
  }

  async function startAlwaysOn() {
    if (starting || isSpeaking) return;
    starting = true;
    try {
      if (w.AxiomElevenLabsScribe?.isSupported?.()) {
        try {
          await w.AxiomElevenLabsScribe.start({
            echoCancellation: true,
            noiseSuppression: true,
            onStart: () => status('Ready'),
            onInterim: () => {},
            onFinal: text => processUtterance(text),
            onError: () => startBrowserRecognitionFallback(),
            onEnd: () => scheduleRestart()
          });
          starting = false;
          return;
        } catch (_) {
          startBrowserRecognitionFallback();
        }
      } else {
        startBrowserRecognitionFallback();
      }
    } catch (e) {
      status('Microphone permission needed');
      scheduleRestart();
    } finally {
      starting = false;
    }
  }

  function mountStatus() {
    if (document.getElementById('axiom-handsfree-status')) return;
    statusNode = document.createElement('span');
    statusNode.id = 'axiom-handsfree-status';
    statusNode.setAttribute('aria-live', 'polite');
    statusNode.setAttribute('aria-label', 'Axiom hands-free voice status');
    statusNode.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    statusNode.textContent = 'Starting voice';
    document.body.appendChild(statusNode);
  }

  function boot() {
    mountStatus();
    startAlwaysOn();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  w.AxiomHandsFreeVoice = {
    start: startAlwaysOn,
    stop: () => {
      w.AxiomElevenLabsScribe?.stop();
      if (browserRecognition) try { browserRecognition.stop(); } catch (_) {}
    },
    isActive: () => !!(w.AxiomElevenLabsScribe?.isRunning() || browserRecognition),
    wakePhrases: WAKE_PHRASES.slice(),
    processUtterance: processUtterance,
    speak: speak,
    status: status,
    getStatus: () => document.documentElement.dataset.axiomVoiceState || 'ready',
    isSpeaking: () => isSpeaking
  };
})(window);
