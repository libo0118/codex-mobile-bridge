import common from '@ohos.app.ability.common';
import util from '@ohos.util';

export async function loadMobileScripts(context: common.UIAbilityContext): Promise<string> {
  const decoder = util.TextDecoder.create('utf-8');
  let source = '';
  for (const name of ['mobile-ui.js', 'mobile-clipboard.js', 'mobile-system-bars.js']) {
    const content = await context.resourceManager.getRawFileContent(name);
    source += decoder.decodeWithStream(content) + '\n';
  }
  return source;
}

export function mobileScript(source: string, token: string, expectedURL: string): string {
  return `(() => { if (window !== top || location.href !== ${JSON.stringify(expectedURL)}) return;
    window.BridgeMobileCapabilities = Object.freeze({ diagnosticsExport: true });
    const marker = ${JSON.stringify('__bridgeUpload_' + token)};
    window[marker] = 0;
    document.addEventListener('click', event => { if (event.isTrusted) window[marker] = Date.now(); }, true);
    document.addEventListener('keydown', event => { if (event.isTrusted && (event.key === 'Enter' || event.key === ' ')) window[marker] = Date.now(); }, true);
    ${source.replace(new RegExp('__BRIDGE_CLIPBOARD_TOKEN__', 'g'), token)}
  })()`;
}

export function uploadGestureScript(token: string): string {
  return `(() => { if (window !== top) return false; const marker = ${JSON.stringify('__bridgeUpload_' + token)}; const time = window[marker] || 0; window[marker] = 0; return time > 0 && Date.now() - time < 2000; })()`;
}

export const BACK_SCRIPT: string = `(() => {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) { dialog.close(); return true; }
  if (typeof window.BridgeNavigation?.back === 'function') return window.BridgeNavigation.back();
  if (window.BridgeWorkbench?.back()) return true;
  if (document.getElementById('app')?.classList.contains('chat-open')) { document.getElementById('back')?.click(); return true; }
  return false;
})()`;
