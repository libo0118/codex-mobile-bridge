// Only replace the identified Magpie header; its view navigation and login page stay intact.
export function magpieUiScript(expectedURL: string, configuredURL: string, action: string = ''): string {
  if (['', 'refresh', 'settings'].indexOf(action) < 0) return '"outside"';
  return `(function(){
    if(window!==window.top||location.href!==${JSON.stringify(expectedURL)})return 'outside';
    const configured=new URL(${JSON.stringify(configuredURL)}), current=new URL(location.href), doc=document;
    if(current.origin!==configured.origin||current.pathname!==configured.pathname)return 'outside';
    const header=doc.querySelector('body.web>header.top'), nav=doc.querySelector('#nav');
    const refresh=header&&header.querySelector('button#sync'), settings=header&&header.querySelector('button#prefs');
    if(!nav||!refresh||!settings)return 'outside';
    if(!doc.getElementById('bridge-magpie-header-style')){
      const style=doc.createElement('style');style.id='bridge-magpie-header-style';
      style.textContent='@media(max-width:600px){body.web>header.top{display:none!important}}';doc.head.appendChild(style);
    }
    const command=${JSON.stringify(action)};
    if(!command)return 'ready';
    const button=command==='refresh'?refresh:settings;
    if(button.disabled)return 'unavailable';
    button.click();return 'clicked';
  })()`;
}
