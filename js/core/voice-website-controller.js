// AXIOM — Voice Website Controller
(function(w){'use strict';
const routes={dashboard:['dashboard','home'],brain:['brain'],memory:['memory'],browser:['browser'],automation:['automation'],playground:['playground','chat'],settings:['settings'],billing:['billing'],analytics:['analytics'],tools:['tools'],files:['files']};
function emit(name,detail){document.dispatchEvent(new CustomEvent(name,{detail}));}
function normalize(text){return String(text||'').toLowerCase().replace(/[!?.,]/g,' ').replace(/\s+/g,' ').trim();}
function findRoute(t){for(const [route,aliases] of Object.entries(routes)){if(aliases.some(a=>t===a||t.includes('open '+a)||t.includes('go to '+a)||t.includes('show '+a)||t.includes('take me to '+a)))return route;}return null;}
function navigate(route){const candidates=['/'+route+'.html',route+'.html','/'+route,'#'+route];const target=candidates[0];try{if(w.AxiomRouter?.navigate){w.AxiomRouter.navigate(route);return true;}if(w.router?.navigate){w.router.navigate(route);return true;}if(location.pathname.endsWith('/'+route+'.html')||location.pathname===target)return true;location.href=target;return true;}catch(e){emit('axiom:voice-command-error',{error:e,command:route});return false;}}
function execute(text){const t=normalize(text);if(!t)return{handled:false};if(/^(stop|cancel|be quiet|shut up)( axiom)?$/.test(t)||t.includes('stop speaking')){w.JarvisVoiceController?.stopSpeaking();emit('axiom:voice-command',{intent:'stop-speaking'});return{handled:true,intent:'stop-speaking',response:'Okay, I’ll stop.'};}
if(t.includes('hide sidebar')||t.includes('close sidebar')){document.body.classList.add('ax-sidebar-hidden');emit('axiom:voice-command',{intent:'hide-sidebar'});return{handled:true,intent:'hide-sidebar',response:'Done, I hid the sidebar.'};}
if(t.includes('show sidebar')||t.includes('open sidebar')){document.body.classList.remove('ax-sidebar-hidden');emit('axiom:voice-command',{intent:'show-sidebar'});return{handled:true,intent:'show-sidebar',response:'There you go.'};}
const route=findRoute(t);if(route){const ok=navigate(route);const name=route.charAt(0).toUpperCase()+route.slice(1);return{handled:true,intent:'navigate',target:route,response:ok?'Opening '+name+'.':'I couldn’t open '+name+'.'};}
if(t.includes('analyze this image')||t.includes('analyze the image')){document.dispatchEvent(new CustomEvent('axiom:vision-command',{detail:{action:'analyze'}}));return{handled:true,intent:'vision-analyze',response:'Sure, I’ll analyze the image.'};}
if(t.includes('capture screen')||t.includes('analyze my screen')||t.includes('look at my screen')){document.dispatchEvent(new CustomEvent('axiom:vision-command',{detail:{action:'screenshot'}}));return{handled:true,intent:'vision-screenshot',response:'I’ll take a look at your screen.'};}
if(t.includes('go back')||t==='back'){history.back();return{handled:true,intent:'back',response:'Going back.'};}
if(t.includes('go forward')||t==='forward'){history.forward();return{handled:true,intent:'forward',response:'Going forward.'};}
return{handled:false};}
function attach(){if(w.AxiomVoiceWebsiteController)return;w.AxiomVoiceWebsiteController={execute};document.addEventListener('axiom:voice-command-request',e=>{const text=e.detail?.text||'';const result=execute(text);if(result.handled)emit('axiom:voice-command-result',result);});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach);else attach();
})(window);
