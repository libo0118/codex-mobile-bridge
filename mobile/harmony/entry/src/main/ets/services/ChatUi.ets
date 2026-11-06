// The plugin remains an opaque sandbox; only its UI mode crosses this bridge.
export function chatUiScript(expectedURL: string, configuredURL: string, initial: boolean, token: string): string {
  const suffix = '?view=plugin-chat';
  if (!configuredURL.endsWith(suffix) || !new RegExp('^[0-9a-f]{32}$').test(token)) return '"outside"';
  const base = configuredURL.substring(0, configuredURL.length - suffix.length);
  return `(function(){
    if(window!==window.top||location.href!==${JSON.stringify(expectedURL)})return 'outside';
    const base=${JSON.stringify(base)}, target=${JSON.stringify(configuredURL)}, doc=document, html=doc.documentElement;
    if(window.__bridgeChatUiV1){window.__bridgeChatUiV1.refresh(${JSON.stringify(token)});return 'ready';}
    const here=()=>location.href.split(/[?#]/)[0]===base;
    const view=()=>location.href===target;
    const fallback=()=>here()&&!location.hash&&/^\\?view=[a-z0-9-]+$/.test(location.search);
    if(!doc.querySelector('#nav')||(!view()&&!(${initial ? 'true' : 'false'}&&fallback())))return 'outside';
    if(!window.crypto||!window.crypto.getRandomValues)return 'unavailable';
    const style=doc.createElement('style');style.id='bridge-chat-host-style';
    style.textContent='@media(max-width:600px){html[data-bridge-chat] body.web>header.top,html[data-bridge-chat] #nav{display:none!important}html[data-bridge-chat] #view-plugin-chat{padding:0!important;overflow:hidden;min-height:0}html[data-bridge-chat] #view-plugin-chat>iframe.plugin-frame{width:100%;min-width:0;min-height:0}}';
    doc.head.appendChild(style);
    let pending=${initial ? 'true' : 'false'}&&!(typeof navigator!=='undefined'&&navigator.userActivation&&navigator.userActivation.hasBeenActive), timer;
    let token=${JSON.stringify(token)}, frame, nonce='', handed=false, failed=false, watchdog;
    function stop(){pending=false;clearTimeout(timer);doc.removeEventListener('pointerdown',cancel,true);doc.removeEventListener('keydown',cancel,true);}
    function cancel(event){if(event.isTrusted)stop();}
    function post(action, nativeNavigation){
      if(!frame||!frame.contentWindow||!nonce)return;
      const message={type:'bridge-chat-ui',v:1,nonce,action};
      if(action==='bind')message.nativeNavigation=nativeNavigation;
      frame.contentWindow.postMessage(message,'*');
    }
    function report(mode){return view()&&window.prompt('bridge-chat-ui:'+token,mode)==='saved';}
    function release(){
      clearTimeout(watchdog);
      if(frame){if(handed)post('bind',false);frame.removeEventListener('load',reload);}
      frame=undefined;nonce='';handed=false;failed=false;
    }
    function currentFrame(){
      if(!token||!view()||!doc.querySelector('#nav button[data-view="plugin-chat"][data-plugin-page][aria-current="page"]'))return;
      const section=doc.querySelector('#view-plugin-chat'), candidate=doc.querySelector('#view-plugin-chat>iframe.plugin-frame');
      return section&&!section.hidden&&candidate&&candidate.getAttribute('sandbox')==='allow-scripts'&&candidate.contentWindow?candidate:undefined;
    }
    function reload(){
      if(currentFrame()!==frame){sync();return;}
      clearTimeout(watchdog);handed=false;failed=false;
      nonce=Array.from(window.crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
      report('list');post('bind',false);
    }
    function sync(){
      const next=currentFrame();
      if(next){
        html.setAttribute('data-bridge-chat','');
        if(next!==frame){release();frame=next;frame.addEventListener('load',reload);reload();}
      }else{html.removeAttribute('data-bridge-chat');if(frame)report('list');release();}
      if(!pending)return;
      if(view()&&next){stop();return;}
      if(!view()&&!fallback()){stop();return;}
      const current=!view()&&fallback()&&doc.querySelector('#nav button[data-view="'+location.search.substring(6)+'"][aria-current="page"]');
      const button=current&&doc.querySelector('#nav button[data-view="plugin-chat"][data-plugin-page]');
      if(button&&!button.disabled&&window.prompt('bridge-chat-ui:'+token,'list')==='saved'){stop();button.click();}
    }
    window.addEventListener('message',event=>{
      const m=event.data;
      if(!token||!frame||currentFrame()!==frame||event.source!==frame.contentWindow||event.origin!=='null'||!m||typeof m!=='object'||
        Object.keys(m).sort().join(',')!=='mode,nonce,type,v'||m.type!=='bridge-chat-ui'||m.v!==1||m.nonce!==nonce||
        (m.mode!=='list'&&m.mode!=='chat'))return;
      if(failed){if(m.mode!=='list')return;failed=false;}
      clearTimeout(watchdog);
      const accepted=report(m.mode);
      if(accepted&&!handed){handed=true;post('bind',true);}
      else if(!accepted&&handed){handed=false;post('bind',false);}
    });
    const observer=new MutationObserver(sync);
    observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-current','sandbox']});
    if(pending){doc.addEventListener('pointerdown',cancel,true);doc.addEventListener('keydown',cancel,true);timer=setTimeout(stop,15000);}
    window.__bridgeChatUiV1={
      refresh(next){release();token=next;sync();},
      action(current,command){
        if(!token||current!==token||!frame||currentFrame()!==frame||!handed||!['back','settings'].includes(command))return 'unavailable';
        clearTimeout(watchdog);post(command);
        watchdog=setTimeout(()=>{handed=false;failed=true;report('list');post('bind',false);},1500);
        return 'sent';
      },
      suspend(current){if(current!==token)return;stop();release();token='';html.removeAttribute('data-bridge-chat');}
    };
    sync();return 'ready';
  })()`;
}

export function chatUiActionScript(expectedURL: string, token: string, action: string): string {
  if (!new RegExp('^[0-9a-f]{32}$').test(token) || ['back', 'settings', 'suspend'].indexOf(action) < 0) return '"unavailable"';
  return `(function(){
    if(window!==window.top||location.href!==${JSON.stringify(expectedURL)}||!window.__bridgeChatUiV1)return 'unavailable';
    ${action === 'suspend' ? 'window.__bridgeChatUiV1.suspend(' + JSON.stringify(token) + ');return \'sent\';' :
      'return window.__bridgeChatUiV1.action(' + JSON.stringify(token) + ',' + JSON.stringify(action) + ');'}
  })()`;
}
