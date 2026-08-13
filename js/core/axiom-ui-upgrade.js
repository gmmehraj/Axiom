/* AXIOM UI Upgrade — desktop shell
 * Anime.js is optional: CDN availability must never block the app.
 * Motion-style spring interactions are implemented with WAAPI/CSS so
 * the existing vanilla architecture stays lightweight.
 */
(function(){'use strict';
  function ready(){
    var root=document.querySelector('main,body');
    if(!root || !location.pathname.endsWith('os-shell.html')) return;
    root.classList.add('ax-ui-upgrade');
    document.querySelectorAll('.ax-card,.card,[class*="card"]').forEach(function(el){el.classList.add('ax-ui-reveal');});
    requestAnimationFrame(function(){
      document.querySelectorAll('.ax-ui-reveal').forEach(function(el,i){
        if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){el.style.opacity='1';el.style.transform='none';return;}
        el.animate([{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'translateY(0)'}],{duration:520,delay:Math.min(i*45,360),easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
      });
    });
    // Anime.js enhancement hook: use it only for cinematic sequences when present.
    if(window.anime){document.querySelectorAll('[data-anime-reveal]').forEach(function(el){window.anime({targets:el,opacity:[0,1],translateY:[12,0],duration:650,easing:'easeOutExpo'});});}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ready,{once:true}); else ready();
})();
