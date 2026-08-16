// AXIOM — Hands-free always-on voice bridge
// No microphone button. While the Axiom page is open and microphone permission
// is granted, Scribe stays ready for the wake phrase and routes commands to the
// existing website controller. A browser permission prompt is still required.
(function(w){'use strict';
  const WAKE_PHRASES=['hey axiom','hi axiom','okay axiom','ok axiom','axiom'];
  const ACTIVE_MS=9000;
  let activeUntil=0;
  let starting=false;
  let restartTimer=null;
  let statusNode=null;

  function status(text){
    if(statusNode) statusNode.textContent=text;
    document.documentElement.dataset.axiomVoiceState=(text||'ready').toLowerCase().replace(/[^a-z]+/g,'-');
    try{document.dispatchEvent(new CustomEvent('axiom:voice-state',{detail:{state:text||'Ready',handsFree:true}}));}catch(_){}
  }
  function speak(text){
    if(!text) return Promise.resolve();
    if(w.JarvisVoiceController?.speak) return Promise.resolve(w.JarvisVoiceController.speak(text)).catch(()=>{});
    return Promise.resolve();
  }
  function normalize(s){return String(s||'').toLowerCase().replace(/[.,!?;:]/g,' ').replace(/\s+/g,' ').trim();}
  function stripWake(s){
    const n=normalize(s);
    for(const phrase of WAKE_PHRASES){
      if(n===phrase)return '';
      if(n.startsWith(phrase+' '))return n.slice(phrase.length).trim();
    }
    return null;
  }
  function command(text){
    const clean=stripWake(text);
    if(clean===null && Date.now()>activeUntil)return false;
    const commandText=clean===null?normalize(text):clean;
    if(!commandText){activeUntil=Date.now()+ACTIVE_MS; status('Listening'); return true;}
    activeUntil=0;
    status('Thinking');
    const result=w.AxiomVoiceWebsiteController?.execute(commandText);
    if(result?.handled){
      status('Speaking');
      speak(result.response).finally(()=>status('Listening'));
      return true;
    }
    document.dispatchEvent(new CustomEvent('axiom:voice-command-request',{detail:{text:commandText}}));
    const onResult=e=>{status('Speaking');speak(e.detail?.response||'Done.').finally(()=>status('Listening'));};
    document.addEventListener('axiom:voice-command-result',onResult,{once:true});
    setTimeout(()=>{document.removeEventListener('axiom:voice-command-result',onResult);if(document.documentElement.dataset.axiomVoiceState==='thinking'){status('Listening');speak("I didn't understand that command.");}},6000);
    return true;
  }
  function scheduleRestart(){
    clearTimeout(restartTimer);
    restartTimer=setTimeout(()=>startAlwaysOn(),800);
  }
  async function startAlwaysOn(){
    if(starting)return;
    starting=true;
    try{
      if(!w.AxiomElevenLabsScribe?.isSupported?.()) throw new Error('Realtime voice is not supported in this browser.');
      if(w.AxiomElevenLabsScribe.isRunning()){starting=false;return;}
      status('Listening');
      await w.AxiomElevenLabsScribe.start({
        echoCancellation:true,
        noiseSuppression:true,
        onStart:()=>status('Listening'),
        onInterim:()=>{},
        onFinal:text=>command(text),
        onError:e=>{status('Voice reconnecting');scheduleRestart();},
        onEnd:()=>{status('Voice reconnecting');scheduleRestart();}
      });
    }catch(e){
      status('Microphone permission needed');
      // Retry after a short delay. The browser will only show its permission
      // prompt when appropriate; a denied permission cannot be bypassed.
      scheduleRestart();
    }finally{starting=false;}
  }
  function mountStatus(){
    statusNode=document.createElement('span');
    statusNode.id='axiom-handsfree-status';
    statusNode.setAttribute('aria-live','polite');
    statusNode.setAttribute('aria-label','Axiom hands-free voice status');
    statusNode.style.cssText='position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    statusNode.textContent='Starting voice';
    document.body.appendChild(statusNode);
  }
  function boot(){
    if(!w.AxiomElevenLabsScribe){setTimeout(boot,250);return;}
    mountStatus();
    startAlwaysOn();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  w.AxiomHandsFreeVoice={start:startAlwaysOn,stop:()=>w.AxiomElevenLabsScribe?.stop(),isActive:()=>!!w.AxiomElevenLabsScribe?.isRunning(),wakePhrases:WAKE_PHRASES.slice()};
})(window);
