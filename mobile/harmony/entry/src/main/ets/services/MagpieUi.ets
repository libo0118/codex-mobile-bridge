// Hide only controls handled by the native toolbar; keep Magpie navigation in place.
export function magpieUiScript(expectedURL: string, configuredURL: string, action: string = ''): string {
  if (['', 'refresh', 'settings'].indexOf(action) < 0) return '"outside"';
  return `(function(){
    if(window!==window.top||location.href!==${JSON.stringify(expectedURL)})return 'outside';
    const configured=new URL(${JSON.stringify(configuredURL)}), current=new URL(location.href), doc=document;
    if(current.origin!==configured.origin||current.pathname!==configured.pathname)return 'outside';
    const header=doc.querySelector('body.web>header.top'), nav=doc.querySelector('#nav');
    const refresh=header&&header.querySelector('button#sync');
    const settings=(header&&header.querySelector('button#prefs'))||doc.querySelector('body.web.side-nav #prefs');
    if(!nav||!refresh||!settings){const style=doc.getElementById('bridge-magpie-header-style');if(style)style.remove();return 'outside';}
    if(!doc.getElementById('bridge-magpie-header-style')){
      const style=doc.createElement('style');style.id='bridge-magpie-header-style';
      style.textContent='@media(max-width:600px){body.web>header.top button#sync,body.web>header.top button#prefs,body.web.side-nav #prefs{display:none!important}}';doc.head.appendChild(style);
    }
    const command=${JSON.stringify(action)};
    if(!command)return 'ready';
    const button=command==='refresh'?refresh:settings;
    if(button.disabled)return 'unavailable';
    button.click();return 'clicked';
  })()`;
}
