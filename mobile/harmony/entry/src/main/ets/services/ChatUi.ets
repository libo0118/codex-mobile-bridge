// The plugin frame stays sandboxed; this only adjusts the observed Magpie host view.
export function chatUiScript(expectedURL: string, configuredURL: string, initial: boolean): string {
  const suffix = '?view=plugin-chat';
  if (!configuredURL.endsWith(suffix)) return '"outside"';
  const base = configuredURL.substring(0, configuredURL.length - suffix.length);
  return `(function(){
    if(window!==window.top||location.href!==${JSON.stringify(expectedURL)})return 'outside';
    const base=${JSON.stringify(base)}, doc=document, html=doc.documentElement;
    if(window.__bridgeChatUiV1){window.__bridgeChatUiV1.sync();return 'ready';}
    const here=()=>location.href.split(/[?#]/)[0]===base;
    const view=()=>here()&&location.search==='?view=plugin-chat'&&!location.hash;
    const fallback=()=>here()&&!location.hash&&/^\\?view=[a-z0-9-]+$/.test(location.search);
    if(!doc.querySelector('#nav')||(!view()&&!(${initial ? 'true' : 'false'}&&fallback())))return 'outside';
    const style=doc.createElement('style');style.id='bridge-chat-host-style';
    style.textContent='@media(max-width:600px){html[data-bridge-chat] #view-plugin-chat{padding:0!important;overflow:hidden;min-height:0}html[data-bridge-chat] #view-plugin-chat>iframe.plugin-frame{width:100%;min-width:0;min-height:0}}';
    doc.head.appendChild(style);
    let pending=${initial ? 'true' : 'false'}&&!(typeof navigator!=='undefined'&&navigator.userActivation&&navigator.userActivation.hasBeenActive), timer;
    function stop(){pending=false;clearTimeout(timer);doc.removeEventListener('pointerdown',cancel,true);doc.removeEventListener('keydown',cancel,true);}
    function cancel(event){if(event.isTrusted)stop();}
    function sync(){
      const frame=doc.querySelector('#view-plugin-chat>iframe.plugin-frame');
      if(view()&&frame)html.setAttribute('data-bridge-chat','');else html.removeAttribute('data-bridge-chat');
      if(!pending)return;
      if(view()&&frame){stop();return;}
      if(!view()&&!fallback()){stop();return;}
      const current=fallback()&&doc.querySelector('#nav button[data-view="'+location.search.substring(6)+'"][aria-current="page"]');
      const button=current&&doc.querySelector('#nav button[data-view="plugin-chat"][data-plugin-page]');
      if(button&&!button.disabled){stop();button.click();}
    }
    const observer=new MutationObserver(sync);
    observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-current']});
    if(pending){doc.addEventListener('pointerdown',cancel,true);doc.addEventListener('keydown',cancel,true);timer=setTimeout(stop,15000);}
    window.__bridgeChatUiV1={sync};sync();return 'ready';
  })()`;
}
