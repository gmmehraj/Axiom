// AXIOM — Voice UI bridge
// Connects any [data-axiom-voice] control (or a safe injected fallback)
// to JarvisVoiceController. Keeps command handling in the existing controller.
(function(w){'use strict';
function speak(text){if(text&&w.JarvisVoiceController?.speak) return w.JarvisVoiceController.speak(text).catch(()=>{});}
function command(text, ui){
  if(!text||!text.trim()) return;
  ui.status.textContent='Thinking…';
  const result=w.AxiomVoiceWebsiteController?.execute(text);
  if(result?.handled){ui.status.textContent='Speaking…'; speak(result.response).finally(()=>ui.status.textContent='Ready'); return;}
  document.dispatchEvent(new CustomEvent('axiom:voice-command-request',{detail:{text}}));
  const onResult=e=>{document.removeEventListener('axiom:voice-command-result',onResult);ui.status.textContent='Speaking…';speak(e.detail?.response||'Done.').finally(()=>ui.status.textContent='Ready');};
  document.addEventListener('axiom:voice-command-result',onResult,{once:true});
  setTimeout(()=>{document.removeEventListener('axiom:voice-command-result',onResult);if(ui.status.textContent==='Thinking…'){ui.status.textContent='Ready';speak("I didn't understand that command.");}},5000);
}
function bind(root){if(!root||root.dataset.axiomVoiceBound)return;root.dataset.axiomVoiceBound='1';
 const btn=root.matches('button,[role=button]')?root:root.querySelector('[data-axiom-voice-button]')||root;
 const status=root.querySelector?.('[data-axiom-voice-status]')||document.querySelector('[data-axiom-voice-status]')||document.createElement('span');
 if(!status.parentNode){status.dataset.axiomVoiceStatus='';status.textContent='Ready';status.style.cssText='margin-left:8px;font-size:12px;opacity:.7';root.appendChild(status);}
 let listening=false;
 const start=()=>{if(listening)return;listening=true;status.textContent='Listening…';btn.setAttribute('aria-pressed','true');w.JarvisVoiceController?.pushToTalkStart({onInterim:t=>{status.textContent=t||'Listening…';},onFinal:t=>{listening=false;btn.setAttribute('aria-pressed','false');command(t,statusUi());},onError:e=>{listening=false;btn.setAttribute('aria-pressed','false');status.textContent=e?.message||'Voice error';setTimeout(()=>status.textContent='Ready',2500);},onEnd:()=>{listening=false;btn.setAttribute('aria-pressed','false');}});};
 const stop=()=>{if(!listening)return;w.JarvisVoiceController?.stopListening();listening=false;btn.setAttribute('aria-pressed','false');status.textContent='Ready';};
 function statusUi(){return{status, get textContent(){return status.textContent}, set textContent(v){status.textContent=v;}};}
 btn.addEventListener('click',()=>listening?stop():start());
}
function inject(){
 if(document.querySelector('[data-axiom-voice]')){document.querySelectorAll('[data-axiom-voice]').forEach(bind);return;}
 const wrap=document.createElement('div');wrap.dataset.axiomVoice='true';wrap.setAttribute('aria-label','Axiom voice control');wrap.style.cssText='position:fixed;right:24px;bottom:24px;z-index:2147483000;display:flex;align-items:center;gap:8px;font-family:inherit';
 const btn=document.createElement('button');btn.type='button';btn.dataset.axiomVoiceButton='';btn.textContent='🎙️';btn.title='Talk to Axiom';btn.setAttribute('aria-label','Talk to Axiom');btn.style.cssText='width:52px;height:52px;border-radius:50%;border:1px solid rgba(160,220,255,.35);background:rgba(10,20,32,.9);color:white;font-size:22px;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.3)';
 const status=document.createElement('span');status.dataset.axiomVoiceStatus='';status.textContent='Ready';status.style.cssText='padding:7px 10px;border-radius:10px;background:rgba(10,20,32,.86);color:white;font-size:12px';wrap.append(btn,status);document.body.appendChild(wrap);bind(wrap);
}
function boot(){const run=()=>setTimeout(inject,0);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();}
boot();
})(window);
