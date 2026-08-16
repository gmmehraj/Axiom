// AXIOM — Personalized voice greeting
(function (w) {
  'use strict';
  const GREETING_KEY = 'axiom_voice_greeted_session';
  let spoken = false;

  function firstName(user) {
    const meta = user && user.user_metadata || {};
    const raw = meta.full_name || meta.name || meta.display_name || meta.preferred_username || user?.email?.split('@')[0] || '';
    return String(raw).trim().split(/\s+/)[0] || 'there';
  }

  async function getUser() {
    try {
      if (w.AxiomSupabaseAuth) {
        if (typeof w.AxiomSupabaseAuth.getUser === 'function') {
          const u = await w.AxiomSupabaseAuth.getUser();
          if (u) return u.user || u;
        }
        if (typeof w.AxiomSupabaseAuth.getSession === 'function') {
          const s = await w.AxiomSupabaseAuth.getSession();
          if (s) return s.user || s.session?.user || null;
        }
      }
    } catch (_) {}
    try {
      if (w.supabase?.auth?.getUser) {
        const r = await w.supabase.auth.getUser();
        if (!r.error && r.data?.user) return r.data.user;
      }
    } catch (_) {}
    return null;
  }

  async function speakGreeting(user) {
    if (spoken || !user) return false;
    const sessionMarker = user.id + ':' + new Date().toISOString().slice(0, 10);
    try { if (sessionStorage.getItem(GREETING_KEY) === sessionMarker) return false; } catch (_) {}
    const name = firstName(user);
    const hour = new Date().getHours();
    const period = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const text = `${period}, ${name}. Welcome back. I'm Axiom. How can I help you?`;
    spoken = true;
    try { sessionStorage.setItem(GREETING_KEY, sessionMarker); } catch (_) {}
    document.dispatchEvent(new CustomEvent('axiom:user-greeting', { detail: { user, name, text } }));
    try {
      if (w.AxiomElevenLabsVoice && typeof w.AxiomElevenLabsVoice.speak === 'function') {
        await w.AxiomElevenLabsVoice.speak(text);
        return true;
      }
      if (w.JarvisVoiceController && typeof w.JarvisVoiceController.speak === 'function') {
        await w.JarvisVoiceController.speak(text);
        return true;
      }
      if (w.speechSynthesis) {
        w.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.96;
        utterance.pitch = 1.02;
        w.speechSynthesis.speak(utterance);
        return true;
      }
    } catch (_) {}
    return false;
  }

  async function init() {
    for (let i = 0; i < 30; i++) {
      const user = await getUser();
      if (user) { await new Promise(r => setTimeout(r, 700)); return speakGreeting(user); }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  w.AxiomVoiceGreeting = { init, speakGreeting, getUser, firstName };
})(window);
