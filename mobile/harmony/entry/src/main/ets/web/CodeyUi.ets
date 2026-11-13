export class CodeyUiState {
  supported: boolean = false;
  chat: boolean = false;
  archived: boolean = false;
  canArchive: boolean = false;
  canConsole: boolean = false;
  canLogout: boolean = false;
  canBack: boolean = false;
}

export function decodeCodeyUiState(value: string): CodeyUiState | undefined {
  if (value.length > 512) return undefined;
  try {
    const state = JSON.parse(value) as CodeyUiState;
    if (!state || typeof state.supported !== 'boolean' || typeof state.chat !== 'boolean' || typeof state.archived !== 'boolean' ||
      typeof state.canArchive !== 'boolean' || typeof state.canConsole !== 'boolean' || typeof state.canLogout !== 'boolean' || typeof state.canBack !== 'boolean') return undefined;
    if (!state.supported && (state.chat || state.archived || state.canArchive || state.canConsole || state.canLogout || state.canBack)) return undefined;
    return state;
  } catch (_) { return undefined; }
}

// Note: explicit v2 DOM and released v1 fallback keep the same native authorization boundary.
export const CODEY_UI_SCRIPT: string = String.raw`((notify, expectedURL) => {
  if (!document.body || !document.getElementById('root')) return 'unavailable';
  const key = '__bridgeHarmonyCodeyUi';
  if (window[key]) { window[key].refresh(notify, expectedURL); return 'ready'; }
  const doc = document, html = doc.documentElement;
  const q = (selector, root = doc) => root.querySelector(selector);
  const all = (selector, root) => Array.from(root.querySelectorAll(selector));
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const enabled = node => !!node && node.isConnected && !node.disabled && node.getAttribute('disabled') === null && node.getAttribute('aria-disabled') !== 'true';
  const allowed = () => window === window.top && location.href === expectedURL;
  const empty = {supported:false, chat:false, archived:false, canArchive:false, canConsole:false, canLogout:false, canBack:false};
  let previous = '', styled = false, scheduled = 0, marked, explicitRoot;
  function collect() {
    const roots = all('.remote-shell [data-codey-ui]', doc);
    explicitRoot = roots[0];
    if (roots.length) return roots.length === 1 && explicitRoot.getAttribute('data-codey-ui') === '2' ? collectV2(explicitRoot) : undefined;
    return collectV1();
  }
  function collectV2(workspace) {
    const scene = workspace.getAttribute('data-codey-scene');
    if (!['list','create','conversation'].includes(scene)) return;
    const footers = all('[data-codey-chrome="footer"]', workspace), headers = all('[data-codey-chrome="header"]', workspace);
    const controls = all('[data-codey-action]', workspace), focused = scene !== 'list';
    if (footers.length !== 1 || headers.length !== 1 || controls.length !== (focused ? 4 : 3)) return;
    const footer = footers[0], v2header = headers[0];
    const find = action => controls.filter(node => node.getAttribute('data-codey-action') === action);
    const archives = find('archive'), consoles = find('console'), logouts = find('logout'), backs = find('back');
    if (archives.length !== 1 || consoles.length !== 1 || logouts.length !== 1 || backs.length !== (focused ? 1 : 0) ||
      !controls.every(clickable) || ![archives[0],consoles[0],logouts[0]].every(node => footer.contains(node)) ||
      !['true','false'].includes(archives[0].getAttribute('aria-pressed'))) return;
    const panel = !!workspace.closest('[hidden]');
    const consoleBacks = panel ? all('.remote-shell [data-codey-console-back]', doc) : [];
    if (panel && (consoleBacks.length !== 1 || !clickable(consoleBacks[0]) || workspace.contains(consoleBacks[0]))) return;
    return {workspace, footer, v2header, panel, back:panel ? consoleBacks[0] : backs[0],
      archive:archives[0], console:consoles[0], logout:logouts[0], chat:!panel && focused};
  }
  const clickable = node => node.matches('button,[role="button"]') && typeof node.click === 'function';
  function collectV1() {
    const workspace = q('.remote-shell .remote-codex-workspace');
    const list = workspace && q(':scope > .remote-thread-list', workspace);
    const footer = list && q(':scope > .remote-sidebar-footer', list);
    if (!footer) return;
    const controls = all('button,input,a,select', footer);
    const archives = controls.filter(node => node.matches('button[aria-pressed]') && /^(归档会话|返回会话)$/.test(text(node)) ||
      node.matches('input[type="checkbox"]') && /^(归档会话|返回会话)$/.test(node.getAttribute('aria-label') || text(node.closest('label'))));
    const consoles = controls.filter(node => node.tagName === 'BUTTON' && text(node) === 'Codey 控制台');
    const logouts = controls.filter(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === '退出此设备');
    if (controls.length !== 3 || archives.length !== 1 || consoles.length !== 1 || logouts.length !== 1 ||
      new Set([archives[0], consoles[0], logouts[0]]).size !== 3) return;
    const heading = q(':scope > .remote-list-heading', list), host = q(':scope > .remote-host', list);
    const title = heading && q(':scope > h1', heading);
    const search = heading && q(':scope > button[aria-label="搜索会话"]', heading);
    const create = heading && q(':scope > button[aria-label="新建会话"]', heading);
    const header = heading?.children.length === 3 && text(title) === 'Codex' && search && create && host &&
      all(':scope > span', host).length === 2 && q(':scope > .remote-paired', host) && q(':scope > .remote-navigation', list);
    const panel = !!workspace.closest('[hidden]');
    const back = panel ? q('.remote-shell .remote-topbar button[aria-label="返回 Codex"]') :
      workspace.classList.contains('has-selection') ? q('.remote-chat-header > button.remote-back[aria-label="返回会话列表"]', workspace) : undefined;
    return {workspace, footer, header, panel, back, archive:archives[0], console:consoles[0], logout:logouts[0],
      chat:!panel && workspace.classList.contains('has-selection') && !!back};
  }
  function style() {
    if (styled) return true;
    const sheet = Array.from(doc.styleSheets).find(s => s.href && new URL(s.href).origin === location.origin);
    if (!sheet) return false;
    const start = sheet.cssRules.length;
    try {
      for (const rule of [
        '[data-hos-codey-footer] { display:none !important; }',
        '[data-hos-codey-v2-header] { padding-right:64px !important; }',
        'html[data-hos-codey-page] .remote-chat-header, html[data-hos-codey-page] .remote-topbar { padding-right:64px; }',
        '[data-hos-codey-header] > .remote-thread-list { display:grid; grid-template-columns:max-content minmax(0,1fr) 44px 44px 48px; grid-template-rows:60px auto minmax(0,1fr); column-gap:2px; padding:0 12px; }',
        '[data-hos-codey-header] .remote-list-heading { display:contents; }',
        '[data-hos-codey-header] .remote-list-heading h1 { grid-area:1/1; align-self:center; font-size:22px; }',
        '[data-hos-codey-header] .remote-list-heading > button[aria-label="搜索会话"] { grid-area:1/3; align-self:center; }',
        '[data-hos-codey-header] .remote-list-heading > button[aria-label="新建会话"] { grid-area:1/4; align-self:center; }',
        '[data-hos-codey-header] .remote-host { grid-area:1/2; align-self:center; min-width:0; margin:0 4px; gap:3px; font-size:12px; white-space:nowrap; overflow:hidden; }',
        '[data-hos-codey-header] .remote-host > svg { display:none; }',
        '[data-hos-codey-header] .remote-host > span:not(.remote-paired) { min-width:0; overflow:hidden; text-overflow:ellipsis; }',
        '[data-hos-codey-header] .remote-paired { flex:none; margin:0; font-size:12px; }',
        '[data-hos-codey-header] .remote-paired::before { content:"· "; }',
        '[data-hos-codey-header] .remote-search { grid-area:2/1/3/-1; margin:0 0 10px; }',
        '[data-hos-codey-header] .remote-navigation { grid-area:3/1/4/-1; padding:0 0 16px; }',
        '@media (max-width:760px) { [data-hos-codey-header].has-selection > .remote-thread-list { display:none; } }'
      ]) sheet.insertRule(rule, sheet.cssRules.length);
      styled = true;
    } catch (_) { while (sheet.cssRules.length > start) sheet.deleteRule(start); }
    return styled;
  }
  function mark(node, name, active) {
    if (!node) return;
    if (active) { if (node.getAttribute(name) !== '') node.setAttribute(name, ''); }
    else if (node.getAttribute(name) !== null) node.removeAttribute(name);
  }
  function clear() {
    mark(marked?.workspace, 'data-hos-codey-header', false);
    mark(marked?.v2header, 'data-hos-codey-v2-header', false);
    mark(marked?.footer, 'data-hos-codey-footer', false);
    mark(html, 'data-hos-codey-page', false); marked = undefined;
  }
  function sync() {
    scheduled = 0;
    const model = allowed() ? collect() : undefined;
    const m = model && style() ? model : undefined;
    const state = m ? {supported:true, chat:m.chat, archived:m.archive.matches('input') ? m.archive.checked : m.archive.getAttribute('aria-pressed') === 'true',
      canArchive:!m.panel && enabled(m.archive), canConsole:!m.panel && enabled(m.console), canLogout:enabled(m.logout), canBack:enabled(m.back)} : empty;
    const signature = JSON.stringify(state);
    const accepted = signature === previous || notify(state);
    if (accepted) previous = signature;
    if (!m || !accepted) { clear(); return; }
    if (marked && (marked.workspace !== m.workspace || marked.footer !== m.footer || marked.v2header !== m.v2header)) clear();
    marked = m;
    mark(m.workspace, 'data-hos-codey-header', !!m.header);
    mark(m.v2header, 'data-hos-codey-v2-header', true);
    mark(m.footer, 'data-hos-codey-footer', true); mark(html, 'data-hos-codey-page', true);
  }
  function schedule() { if (!scheduled) scheduled = requestAnimationFrame(sync); }
  function action(command) {
    if (!allowed()) { sync(); return 'changed'; }
    if (!['archive','console','logout','back'].includes(command)) return 'unavailable';
    sync();
    const m = marked;
    if (!m) return 'unavailable';
    const control = command === 'back' ? m.back : m[command];
    if ((m.panel && (command === 'archive' || command === 'console')) || !enabled(control)) return 'unavailable';
    control.click(); schedule(); return 'clicked';
  }
  const back = () => {
    if (!allowed()) { sync(); return false; }
    sync();
    const m = marked;
    if (!m?.back) return false;
    if (enabled(m.back)) m.back.click();
    schedule(); return true;
  };
  const contract = '.remote-shell,[data-codey-ui],[data-codey-scene],[data-codey-action],[data-codey-chrome],[data-codey-console-back]';
  new MutationObserver(records => {
    if (records.some(record => {
      const node = record.target.nodeType === 3 ? record.target.parentElement : record.target;
      if (explicitRoot) {
        if (record.type === 'characterData') return false;
        if (record.type === 'attributes') return record.attributeName !== 'class' || node === explicitRoot || node?.contains?.(explicitRoot);
        return [...record.addedNodes, ...record.removedNodes].some(changed => changed.nodeType === 1 &&
          (changed.matches(contract) || changed.querySelector(contract)));
      }
      return !node?.closest?.('.remote-messages,.remote-composer-dock');
    })) schedule();
  }).observe(doc.body, {subtree:true, childList:true, characterData:true, attributes:true,
    attributeFilter:['class','hidden','disabled','aria-disabled','aria-pressed','aria-label','role','checked',
      'data-codey-ui','data-codey-scene','data-codey-action','data-codey-chrome','data-codey-console-back']});
  doc.addEventListener('change', event => { if (event.target.closest?.('.remote-sidebar-footer')) schedule(); });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  function refresh(nextNotify, nextURL) { notify = nextNotify; expectedURL = nextURL; previous = ''; sync(); }
  window[key] = {sync, refresh, action, back}; sync(); return 'ready';
})`;

export function codeyUiScript(expectedURL: string, token: string): string {
  return '(() => { if (window !== window.top || location.href !== ' + JSON.stringify(expectedURL) + ') return "changed"; return (' +
    CODEY_UI_SCRIPT + ')(state => window.prompt(' + JSON.stringify('codexbridge-codey-ui:' + token) + ', JSON.stringify(state)) === "saved", ' + JSON.stringify(expectedURL) + '); })()';
}

export function codeyUiActionScript(expectedURL: string, command: string): string {
  if (['archive', 'console', 'logout', 'back'].indexOf(command) < 0) return '"unavailable"';
  return '(() => { if (window !== window.top || location.href !== ' + JSON.stringify(expectedURL) + ') { window.__bridgeHarmonyCodeyUi?.sync(); return "changed"; } return window.__bridgeHarmonyCodeyUi?.action(' + JSON.stringify(command) + ') || "unavailable"; })()';
}
