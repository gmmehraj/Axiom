/* Axiom mobile/tablet presentation layer — premium system shell. */
(function (w) {
  'use strict';
  var MQ='(max-width:1024px)',PHONE='(max-width:767px)',THRESHOLD=56,SPEED=.35;
  var s={active:false,index:0,ids:[],frames:new Map(),startX:0,startY:0,lastX:0,lastT:0,drag:false,horizontal:false,cleanup:null,coreParent:null,coreNext:null,timeTimer:null};
  function mobile(){return matchMedia(MQ).matches}
  function phone(){return matchMedia(PHONE).matches}
  function reduced(){return matchMedia('(prefers-reduced-motion:reduce)').matches}
  function M(){return w.AxiomAppManifest}
  function icon(n,z){return w.AxiomIcons?w.AxiomIcons.svg(n,z||20):''}
  function esc(v){return String(v||'').replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]})}
  function ws(id){return M().resolveWorkspace(id)}
  function realControl(kind){
    var selectors={
      search:['[data-action="search"]','#searchButton','#globalSearch','.search-trigger','[data-command="search"]','[aria-label*="Search"]'],
      notifications:['[data-action="notifications"]','#notificationsButton','#notificationButton','.notification-trigger','[aria-label*="Notifications"]'],
      desktop:['[data-action="desktop"]','#desktopButton','.desktop-trigger','[aria-label*="Desktop"]'],
      account:['[data-action="account"]','#accountButton','#profileButton','.profile-trigger','[aria-label*="Account"]','[aria-label*="Profile"]']
    }[kind]||[];
    for(var i=0;i<selectors.length;i++){
      var nodes=document.querySelectorAll(selectors[i]);
      for(var j=0;j<nodes.length;j++) if(!nodes[j].closest('#axMobileShell')) return nodes[j];
    }
    return null;
  }
  function activateControl(kind){
    var el=realControl(kind); if(el){el.click();return true}
    if(kind==='desktop'){open('dashboard',{source:'shell'});return true}
    if(kind==='account'){try{w.dispatchEvent(new CustomEvent('axiom:open-account'));return true}catch(_){return false}}
    if(kind==='search'){try{w.dispatchEvent(new CustomEvent('axiom:open-search'));return true}catch(_){return false}}
    if(kind==='notifications'){try{w.dispatchEvent(new CustomEvent('axiom:open-notifications'));return true}catch(_){return false}}
    return false;
  }
  function shell(){
    var el=document.getElementById('axMobileShell');if(el)return el;
    el=document.createElement('section');el.id='axMobileShell';el.className='ax-mobile-shell';el.setAttribute('aria-label','Axiom mobile operating system');
    el.innerHTML='<div class="ax-mobile-ambient" aria-hidden="true"><span></span><span></span></div><header class="ax-mobile-header"><div class="ax-mobile-system-left"><button class="ax-mobile-identity" id="axmHome" aria-label="Axiom Home"><span class="ax-mobile-identity-mark">AX</span><span class="ax-mobile-identity-copy"><strong>AXIOM</strong><small id="axmOnline"><i></i> Online</small></span></button><time class="ax-mobile-time" id="axmTime" aria-label="Current time"></time></div><button class="ax-mobile-search" id="axmSearch" aria-label="Search Axiom" aria-keyshortcuts="Meta+K Control+K"><span class="ax-mobile-search-icon">'+icon('search',20)+'</span><span class="ax-mobile-search-label">Search Axiom</span><span class="ax-mobile-search-sparkle">'+icon('sparkles',18)+'</span></button><div class="ax-mobile-system-right"><button class="ax-mobile-icon-btn axm-secondary" id="axmDesktop" aria-label="Axiom Home / desktop">'+icon('monitor',20)+'</button><button class="ax-mobile-icon-btn axm-secondary" id="axmNotifications" aria-label="Notifications"><span class="ax-mobile-notification-dot" hidden></span>'+icon('bell',20)+'</button><button class="ax-mobile-ax" id="axmAccount" aria-label="Axiom account and system menu">AX</button></div></header><div class="ax-mobile-stage" id="axmStage"><div class="ax-mobile-track" id="axmTrack"></div><div class="ax-mobile-transient" id="axmTransient" hidden></div></div><nav class="ax-mobile-bottom-nav" aria-label="Axiom workspace navigation"><button class="ax-mobile-bottom-launcher" id="axmMenu" aria-label="Open workspaces" aria-haspopup="dialog" aria-expanded="false">'+icon('grid',18)+'<span>Workspaces</span></button><div class="ax-mobile-indicator" id="axmIndicator" role="status" aria-live="polite"></div><button class="ax-mobile-bottom-action" id="axmFab" aria-label="Open workspace launcher">'+icon('sparkles',18)+'</button></nav><div class="ax-mobile-sheet-backdrop" id="axmBackdrop" hidden></div><aside class="ax-mobile-sheet" id="axmSheet" role="dialog" aria-modal="true" aria-labelledby="axmSheetTitle" hidden><div class="ax-mobile-sheet-grab"></div><div class="ax-mobile-sheet-head"><div><span class="ax-mobile-eyebrow">Axiom OS</span><h2 id="axmSheetTitle">Workspaces</h2></div><button class="ax-mobile-icon-btn" id="axmClose" aria-label="Close workspace launcher">'+icon('close',20)+'</button></div><div class="ax-mobile-workspace-list" id="axmList"></div></aside>';
    document.getElementById('axOS').appendChild(el);
    el.querySelector('#axmHome').onclick=function(){open('dashboard',{source:'home'})};
    el.querySelector('#axmSearch').onclick=function(){activateControl('search')};
    el.querySelector('#axmDesktop').onclick=function(){activateControl('desktop')};
    el.querySelector('#axmNotifications').onclick=function(){activateControl('notifications')};
    el.querySelector('#axmAccount').onclick=function(){activateControl('account')};
    el.querySelector('#axmMenu').onclick=function(){menu(true)};
    el.querySelector('#axmFab').onclick=function(){menu(true)};
    el.querySelector('#axmClose').onclick=function(){menu(false)};
    el.querySelector('#axmBackdrop').onclick=function(){menu(false)};
    return el;
  }
  function updateClock(){
    var t=document.getElementById('axmTime');if(!t)return;
    t.textContent=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date());
    t.dateTime=new Date().toISOString();
    var online=document.getElementById('axmOnline');if(online)online.innerHTML='<i></i> '+(navigator.onLine?'Online':'Offline');
  }
  function homeFrame(){
    var f=document.createElement('article');f.className='ax-mobile-frame ax-mobile-home';f.dataset.workspace='dashboard';
    f.innerHTML='<div class="ax-mobile-home-heading"><span class="ax-mobile-eyebrow">AI Core</span><h1>Axiom</h1><p>How can I help you today?</p></div><div class="ax-mobile-home-core" id="axmCore"><div class="ax-mobile-core-copy"><strong>Ask Axiom anything.</strong><button class="ax-mobile-core-action" data-open="chat">Start a conversation <span>↗</span></button></div></div><div class="ax-mobile-home-actions" aria-label="Quick actions"><button class="ax-mobile-home-card" data-open="chat">'+icon('chat',18)+'<span>Chat</span><small>Talk to Axiom</small></button><button class="ax-mobile-home-card" data-open="brain">'+icon('brain',18)+'<span>Brain</span><small>Live AI state</small></button><button class="ax-mobile-home-card" data-open="memory">'+icon('memory',18)+'<span>Memory</span><small>Saved context</small></button><button class="ax-mobile-home-card" data-open="browser">'+icon('browser',18)+'<span>Browse</span><small>Research and web</small></button></div>';
    f.querySelectorAll('[data-open]').forEach(function(b){b.onclick=function(){open(b.dataset.open,{source:'home'})}});return f;
  }
  function unavailable(a){return '<div class="ax-mobile-unavailable"><div class="ax-mobile-unavailable-icon">'+icon(a.icon||'os',42)+'</div><span class="ax-mobile-eyebrow">'+(a.status==='pending'?'Coming soon':'Unavailable')+'</span><h2>'+esc(a.name||'Workspace')+'</h2><p>'+esc(a.description||a.reason||'This workspace is not available in the mobile shell yet.')+'</p><button class="ax-mobile-secondary-btn" data-home>Back to Home</button></div>'}
  function frame(id){var old=s.frames.get(id);if(old)return old;var x=document.createElement('article');x.className='ax-mobile-frame ax-mobile-workspace-frame';x.dataset.workspace=id;var a=ws(id);if(a.status!=='implemented'&&a.status!=='partial')x.innerHTML=unavailable(a);else x.innerHTML='<div class="ax-mobile-frame-loading"><span class="ax-mobile-spinner"></span><span>Loading '+esc(a.name||'workspace')+'…</span></div>';s.frames.set(id,x);return x}
  function load(id){var a=ws(id),f=frame(id);if(!a.route||f.querySelector('iframe'))return;var loading=f.querySelector('.ax-mobile-frame-loading'),i=document.createElement('iframe');i.className='ax-mobile-workspace-iframe';i.title=a.name;i.loading='lazy';i.setAttribute('allow','microphone; clipboard-read; clipboard-write; fullscreen; camera');i.setAttribute('referrerpolicy','strict-origin-when-cross-origin');i.src=a.route;i.onload=function(){f.classList.add('is-loaded');if(loading)loading.remove()};f.appendChild(i)}
  function trim(){var keep=new Set(['dashboard',s.ids[s.index],s.ids[s.index-1],s.ids[s.index+1]]);s.ids.forEach(function(id){if(keep.has(id)||id==='dashboard')return;var f=s.frames.get(id);if(!f)return;var i=f.querySelector('iframe');if(i)i.remove();f.classList.remove('is-loaded')})}
  function coreMobile(){var c=document.getElementById('axiomCore'),host=document.getElementById('axmCore');if(!c||!host)return;if(!s.coreParent){s.coreParent=c.parentNode;s.coreNext=c.nextSibling}if(c.parentNode!==host){host.prepend(c);c.classList.add('ax-mobile-core-mounted')}}
  function coreDesktop(){var c=document.getElementById('axiomCore');if(!c||!s.coreParent||c.parentNode===s.coreParent)return;if(s.coreNext&&s.coreNext.parentNode===s.coreParent)s.coreParent.insertBefore(c,s.coreNext);else s.coreParent.appendChild(c);c.classList.remove('ax-mobile-core-mounted')}
  function render(offset){
    var sh=shell(),track=sh.querySelector('#axmTrack'),id=s.ids[s.index]||'dashboard',a=ws(id);track.style.transform='translate3d('+(offset==null?-s.index*100:offset)+'%,0,0)';
    var title=sh.querySelector('#axmSheetTitle'); if(title)title.textContent=a.name||'Workspaces';
    if(id==='dashboard')coreMobile();else{coreDesktop();load(id)}
    if(w.AxiomAIState&&typeof w.AxiomAIState.setContext==='function')w.AxiomAIState.setContext(id);
    var indicator=sh.querySelector('#axmIndicator');if(indicator){indicator.innerHTML=s.ids.map(function(_,n){return '<i class="'+(n===s.index?'is-active':'')+'"></i>'}).join('');indicator.setAttribute('aria-label','Workspace '+(s.index+1)+' of '+s.ids.length)}
    s.ids.forEach(function(x,n){var f=s.frames.get(x);if(f){f.classList.toggle('is-active',n===s.index);f.setAttribute('aria-hidden',n===s.index?'false':'true')}});
    trim();
  }
  function go(n,source){s.index=Math.max(0,Math.min(s.ids.length-1,n));var t=document.getElementById('axmTrack');if(t)t.classList.toggle('no-motion',reduced());render();if(t)requestAnimationFrame(function(){t.classList.remove('no-motion')});if(source!=='swipe'){try{var u=new URL(location.href);u.hash='workspace='+encodeURIComponent(s.ids[s.index]);history.replaceState({axiomWorkspace:s.ids[s.index]},'',u)}catch(_){}}}
  function transient(a){var h=document.getElementById('axmTransient');if(!h)return false;h.hidden=false;h.innerHTML='<div class="ax-mobile-transient-panel"><header class="ax-mobile-transient-header"><button class="ax-mobile-icon-btn" data-close aria-label="Back">'+icon('arrow-left',20)+'</button><div class="ax-mobile-title-wrap"><span class="ax-mobile-eyebrow">Workspace</span><strong class="ax-mobile-title">'+esc(a.name)+'</strong></div><span></span></header><div class="ax-mobile-transient-body"><div class="ax-mobile-frame-loading"><span class="ax-mobile-spinner"></span><span>Loading '+esc(a.name)+'…</span></div></div></div>';h.querySelector('[data-close]').onclick=function(){h.hidden=true;h.innerHTML=''};var body=h.querySelector('.ax-mobile-transient-body');if(!a.route){body.innerHTML=unavailable(a);body.querySelector('[data-home]').onclick=function(){h.hidden=true;h.innerHTML=''};return true}var i=document.createElement('iframe');i.className='ax-mobile-workspace-iframe';i.title=a.name;i.loading='lazy';i.src=a.route;i.onload=function(){body.querySelector('.ax-mobile-frame-loading')?.remove()};body.appendChild(i);return true}
  function open(id,options){var a=ws(id),h=document.getElementById('axmTransient');if(h){h.hidden=true;h.innerHTML=''}if(!a||a.status==='error'||a.status==='unresolved')return false;if(!s.active){if(w.AxiomWorkspaceManager?.open){w.AxiomWorkspaceManager.open(id,options||{});return true}return false}if(a.presentation==='external')return M().openWorkspace(id,{bypassMobile:true});if(!s.ids.includes(id))return transient(a);go(s.ids.indexOf(id),options?.source||'launcher');menu(false);return true}
  function menu(on){var sh=shell(),sheet=sh.querySelector('#axmSheet'),back=sh.querySelector('#axmBackdrop'),btn=sh.querySelector('#axmMenu');sheet.hidden=!on;back.hidden=!on;sheet.classList.toggle('is-open',on);back.classList.toggle('is-open',on);btn.setAttribute('aria-expanded',String(on));if(on)sh.querySelector('#axmClose').focus()}
  function launcher(){var list=shell().querySelector('#axmList'),primary=new Set(s.ids),all=M().listWorkspaces();list.innerHTML=all.map(function(a){var ok=a.status==='implemented'||a.status==='partial',pri=primary.has(a.id),label=ok?(pri?'Primary':'Available'):(a.status==='pending'?'Coming soon':'Unavailable');return '<button class="ax-mobile-launcher-item '+(pri?'is-primary':'')+'" data-ws="'+esc(a.id)+'" '+(ok?'':'disabled')+'><span class="ax-mobile-launcher-icon">'+icon(a.icon||'os',18)+'</span><span class="ax-mobile-launcher-copy"><strong>'+esc(a.name)+'</strong><small>'+label+'</small></span><span class="ax-mobile-launcher-arrow">›</span></button>'}).join('');list.querySelectorAll('[data-ws]').forEach(function(b){b.onclick=function(){open(b.dataset.ws,{source:'launcher'})}})}
  function start(e){if(!s.active||!phone())return;if(e.pointerType==='mouse')return;var p=e.touches?e.touches[0]:e;s.startX=p.clientX;s.startY=p.clientY;s.lastX=p.clientX;s.lastT=performance.now();s.drag=true;s.horizontal=false;document.getElementById('axmTrack')?.classList.add('is-dragging')}
  function move(e){if(!s.drag||!phone())return;var p=e.touches?e.touches[0]:e,dx=p.clientX-s.startX,dy=p.clientY-s.startY;if(!s.horizontal&&Math.abs(dx)<8&&Math.abs(dy)<8)return;if(!s.horizontal){if(Math.abs(dy)>Math.abs(dx)){s.drag=false;return}s.horizontal=true}var width=document.getElementById('axmStage')?.clientWidth||innerWidth,percent=dx/width*100,base=-s.index*100;document.getElementById('axmTrack').style.transform='translate3d('+(base+Math.max(-100,Math.min(100,percent)))+'%,0,0)';s.lastX=p.clientX;s.lastT=performance.now();if(e.cancelable)e.preventDefault()}
  function end(e){if(!s.drag)return;document.getElementById('axmTrack')?.classList.remove('is-dragging');var p=e.changedTouches?e.changedTouches[0]:e,dx=p.clientX-s.startX,dt=Math.max(1,performance.now()-s.lastT),v=Math.abs(p.clientX-s.lastX)/dt,advance=s.horizontal&&(Math.abs(dx)>=THRESHOLD||v>=SPEED);if(advance)go(s.index+(dx<0?1:-1),'swipe');else render();s.drag=false;s.horizontal=false}
  function cancel(){s.drag=false;s.horizontal=false;document.getElementById('axmTrack')?.classList.remove('is-dragging');render()}
  function bind(){var st=document.getElementById('axmStage');if(!st||s.cleanup)return;st.addEventListener('touchstart',start,{passive:true});st.addEventListener('touchmove',move,{passive:false});st.addEventListener('touchend',end,{passive:true});st.addEventListener('touchcancel',cancel,{passive:true});s.cleanup=function(){st.removeEventListener('touchstart',start);st.removeEventListener('touchmove',move);st.removeEventListener('touchend',end);st.removeEventListener('touchcancel',cancel)}}
  function activate(){if(s.active)return;s.active=true;s.ids=['dashboard'].concat(M().listMobileWorkspaces().map(function(a){return a.id}));var sh=shell(),track=sh.querySelector('#axmTrack');track.innerHTML='';s.frames.clear();s.ids.forEach(function(id){var f=id==='dashboard'?homeFrame():frame(id);s.frames.set(id,f);track.appendChild(f)});launcher();bind();updateClock();clearInterval(s.timeTimer);s.timeTimer=setInterval(updateClock,60000);var current=document.body.dataset.workspace||'dashboard';s.index=Math.max(0,s.ids.indexOf(current));render()}
  function deactivate(){if(!s.active)return;s.active=false;s.cleanup?.();s.cleanup=null;clearInterval(s.timeTimer);s.timeTimer=null;coreDesktop();document.body.dataset.axPresentation='desktop';menu(false)}
  function sync(){if(mobile())activate();else deactivate()}
  var api={init:function(){if(!M()){setTimeout(api.init,0);return}shell();matchMedia(MQ).addEventListener?.('change',sync);addEventListener('resize',sync,{passive:true});addEventListener('online',updateClock);addEventListener('offline',updateClock);sync();w.AxiomMobileWorkspaceNavigator=api},isActive:function(){return s.active},open:open,goTo:function(n){go(n,'launcher')},getCurrentWorkspace:function(){return s.ids[s.index]||'dashboard'}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',api.init,{once:true});else api.init();
})(window);
