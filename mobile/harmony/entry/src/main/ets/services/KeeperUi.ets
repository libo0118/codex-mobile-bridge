import { credentialScopeMatches } from '../security/GatewayURL';

export function keeperPage(target: string): boolean {
  return credentialScopeMatches(target, 'https://libo.siasunagv.cn/keeper', 'https://libo.siasunagv.cn/keeper/');
}

// shortcut: adapt public semantic DOM hooks; an unrecognized control stays in the original layout.
export const KEEPER_UI_SCRIPT: string = String.raw`
(() => {
  const allowed = () => {
    try {
      const u = new URL(location.href);
      return window === window.top && u.origin === 'https://libo.siasunagv.cn' &&
        !u.username && !u.password && !u.pathname.includes('%') &&
        (u.pathname === '/keeper' || u.pathname.startsWith('/keeper/'));
    } catch (_) { return false; }
  };
  if (!allowed()) return 'outside';
  if (window.__bridgeKeeperUiV1) { window.__bridgeKeeperUiV1.sync(); return 'ready'; }
  const doc = document, html = doc.documentElement;
  const q = (s, root = doc) => root.querySelector(s);
  const all = (s, root = doc) => Array.from(root.querySelectorAll(s));
  const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const title = el => (el?.getAttribute('aria-label') || text(el)).slice(0, 100);
  const enabled = el => !!el && el.isConnected && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.getAttribute('aria-busy') !== 'true';
  const style = doc.createElement('style');
  style.id = 'bridge-keeper-style';
  style.textContent =
    'html[data-hos-keeper] {font-family:system-ui,sans-serif;font-size:16px;line-height:1.5}' +
    'html[data-hos-keeper] body{background:var(--bg-secondary,#f5f6f8)}' +
    'html[data-hos-keeper="compact"] [data-hos-keeper-fold]{display:none!important}' +
    'html[data-hos-keeper] [data-keeper-page]{--keeper-page-padding-top:12px;--keeper-page-padding-x:12px;--keeper-density:.9;min-width:0}' +
    'html[data-hos-keeper] main{min-width:0}' +
    'html[data-hos-keeper] .keeper-card-surface{border-radius:18px;box-shadow:none;border-color:var(--border-color);min-width:0}' +
    'html[data-hos-keeper] .keeper-card-title{font-size:18px;line-height:1.4}' +
    'html[data-hos-keeper] .keeper-card-subtitle{font-size:13px;line-height:1.5}' +
    'html[data-hos-keeper] section.keeper-card-surface article{font-size:16px;line-height:1.5;border-radius:14px;margin:10px 0;padding:14px 12px;background:var(--bg-secondary);border:1px solid var(--border-color);min-width:0}' +
    'html[data-hos-keeper] section.keeper-card-surface article button{min-height:44px;min-width:44px}' +
    'html[data-hos-keeper] section.keeper-card-surface article>*{min-width:0;overflow-wrap:anywhere}' +
    '#bridge-keeper-summary{min-height:48px;display:flex;align-items:center;padding:0 16px;gap:8px;color:var(--text-secondary,#616975);font-size:13px}' +
    '#bridge-keeper-summary button{font:inherit;font-size:17px;font-weight:650;min-height:44px;border:0;background:transparent;color:var(--text-primary,#202124);padding:0;max-width:100%;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}' +
    '#bridge-keeper-summary span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#bridge-keeper-layer{position:fixed;inset:0;z-index:2147483600;background:#0005;display:flex;align-items:flex-start;padding:56px 12px 12px}' +
    '#bridge-keeper-layer[hidden]{display:none!important}' +
    '#bridge-keeper-panel{font-size:16px;line-height:1.5;width:100%;max-height:100%;overflow:auto;overscroll-behavior:contain;border-radius:22px;background:var(--floating-surface,var(--bg-secondary,#fff));color:var(--text-primary,#202124);border:1px solid var(--border-color,#ddd);box-shadow:0 12px 36px #0003;padding:8px;scrollbar-width:thin}' +
    '#bridge-keeper-panel header{display:flex;align-items:center;gap:8px;padding:4px 4px 8px;border-bottom:1px solid var(--border-color,#ddd);margin-bottom:6px}' +
    '#bridge-keeper-panel h2{font-size:19px;line-height:1.4;margin:0;flex:1}' +
    '#bridge-keeper-panel button{font:inherit;min-height:46px;border:0;border-radius:12px;background:transparent;color:inherit;padding:10px 12px;cursor:pointer;text-align:left;line-height:1.5;touch-action:manipulation}' +
    '#bridge-keeper-panel header button{font-size:14px;padding:8px;min-width:44px}' +
    '#bridge-keeper-panel .keeper-choice{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px}' +
    '#bridge-keeper-panel .keeper-choice[aria-pressed="true"],#bridge-keeper-panel .keeper-choice[aria-checked="true"]{background:var(--bg-tertiary,#edf2ff);font-weight:650}' +
    '#bridge-keeper-panel button:active{background:var(--bg-hover,#eee)}#bridge-keeper-panel button:focus-visible{outline:2px solid #0a59f7;outline-offset:-2px}' +
    '#bridge-keeper-panel button:disabled{opacity:.45;cursor:default}' +
    '#bridge-keeper-panel p{font-size:13px;color:var(--text-secondary,#6d737c);margin:12px;line-height:1.6}' +
    'html[data-hos-keeper-original="tools"] [data-hos-keeper-fold="header"],html[data-hos-keeper-original="filters"] [data-hos-keeper-fold="toolbar"]{display:block!important;position:fixed!important;z-index:2147483601!important;top:var(--bridge-keeper-source-top,126px)!important;left:24px!important;right:24px!important;width:auto!important;max-height:calc(100vh - var(--bridge-keeper-source-top,126px) - 24px);overflow:auto!important;background:var(--floating-surface,var(--bg-secondary));padding:12px!important;border-radius:14px!important;border:1px solid var(--border-color)}' +
    'html[data-hos-keeper-original="tools"] [data-hos-keeper-brand]{display:none!important}' +
    'html[data-hos-keeper-original="tools"] [data-hos-keeper-fold="header"]>div{width:100%;flex-wrap:wrap;justify-content:flex-start}' +
    'html[data-hos-keeper-original="tools"] [data-hos-keeper-fold="header"] button,html[data-hos-keeper-original="tools"] [data-hos-keeper-fold="header"] a{min-height:44px;min-width:44px}' +
    'html[data-hos-keeper-original="filters"] [data-hos-keeper-fold="toolbar"] [data-dashboard-tabs],html[data-hos-keeper-original="filters"] [data-dashboard-collapse],html[data-hos-keeper-original="filters"] [data-dashboard-page-trigger],html[data-hos-keeper-original="filters"] [data-dashboard-refresh],html[data-hos-keeper-original="filters"] [data-dashboard-page-menu]{display:none!important}' +
    'html[data-hos-keeper-original="filters"] [data-hos-keeper-fold="toolbar"]>div,html[data-hos-keeper-original="filters"] [data-dashboard-filters]{display:flex!important;flex-direction:column!important;width:100%!important;height:auto!important;gap:10px!important}' +
    'html[data-hos-keeper-original="filters"] [data-dashboard-filter]{width:100%!important;min-width:0!important}' +
    'html[data-hos-keeper-original="filters"] [data-dashboard-filter] button,html[data-hos-keeper-original="filters"] [data-dashboard-filter] input,html[data-hos-keeper-original="filters"] [data-dashboard-filter] select{min-height:44px;font-size:16px}' +
    'html[data-hos-keeper-original] [role="listbox"],html[data-hos-keeper-original] [data-dashboard-header] [role="menu"]{z-index:2147483602!important}' +
    '@media(prefers-reduced-motion:reduce){#bridge-keeper-layer *{scroll-behavior:auto!important}}';
  doc.head.appendChild(style);
  const summary = doc.createElement('div'); summary.id = 'bridge-keeper-summary';
  const sectionButton = doc.createElement('button'); sectionButton.type = 'button'; sectionButton.setAttribute('aria-label', '切换 Keeper 页面');
  const providerLabel = doc.createElement('span'); summary.append(sectionButton, providerLabel);
  const layer = doc.createElement('div'); layer.id = 'bridge-keeper-layer'; layer.hidden = true;
  const panel = doc.createElement('section'); panel.id = 'bridge-keeper-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  layer.appendChild(panel); doc.body.prepend(summary); doc.body.appendChild(layer);
  let group = '', scheduled = 0, signature = '', compact = true, marked = new Set(), previousFocus;
  function collect() {
    const header = q('[data-dashboard-header]'), toolbar = q('[data-dashboard-toolbar]');
    const pages = all('[data-dashboard-tabs] a').filter(a => a.getAttribute('href'));
    const providerBar = all('[role="toolbar"][aria-label]').find(el => /^(Credential provider filters|凭证供应商筛选|憑證供應商篩選)$/i.test(el.getAttribute('aria-label')) && all('button[aria-pressed]', el).length > 0);
    const providers = providerBar ? all('button[aria-pressed]', providerBar) : [];
    const auth = all('section.keeper-card-surface').find(el => /^(认证文件|認證檔案|認證文件|Auth(?:entication)? files)$/i.test(text(q('h3.keeper-card-title', el))));
    const authHeader = auth?.firstElementChild;
    const only = authHeader && q('label input[type="checkbox"]', authHeader);
    const views = authHeader ? all('[role="group"][aria-label] button[aria-pressed]', authHeader) : [];
    const buttons = authHeader ? all('button', authHeader) : [];
    const inspect = buttons.find(b => /^(巡检|巡檢|Inspect|Inspection)$/i.test(text(b)));
    const quota = buttons.find(b => /^(更新限额|正在刷新限额|更新限額|正在重新整理限額|Update Quotas|Refreshing quotas)$/i.test(text(b)));
    return { header, toolbar, pages, providerBar, providers, authHeader, only, views, inspect, quota,
      refresh: q('[data-dashboard-refresh]'), filters: q('[data-dashboard-filters]'),
      pageLabel: text(q('[data-dashboard-page-label]')) || text(pages.find(p => p.getAttribute('aria-selected') === 'true' || p.getAttribute('aria-current') === 'page')) || '管理页面' };
  }
  function close() {
    group = ''; layer.hidden = true; html.removeAttribute('data-hos-keeper-original'); html.style.removeProperty('--bridge-keeper-source-top'); signature = '';
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
  }
  function click(find, dismiss = false) {
    if (!allowed()) { restore(); return; }
    const el = find(collect());
    if (!enabled(el)) { schedule(); return; }
    if (dismiss) close();
    el.click(); schedule();
  }
  function choice(label, find, selected, role = '', dismiss = false) {
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'keeper-choice'; b.textContent = label;
    const source = find(collect()); b.disabled = !enabled(source);
    if (role) {
      b.setAttribute('role', role); b.setAttribute(role === 'switch' ? 'aria-checked' : 'aria-pressed', String(!!selected));
      const mark = doc.createElement('span'); mark.setAttribute('aria-hidden', 'true');
      mark.textContent = role === 'switch' ? (selected ? '已开启' : '已关闭') : selected ? '✓' : ''; b.appendChild(mark);
    }
    b.addEventListener('click', () => click(find, dismiss)); panel.appendChild(b);
  }
  function note(value) { const p = doc.createElement('p'); p.textContent = value; panel.appendChild(p); }
  function render(m) {
    if (!group || layer.hidden) return;
    const state = JSON.stringify([group, m.pages.map(p => [text(p), p.getAttribute('href'), p.getAttribute('aria-selected'), p.getAttribute('aria-current')]),
      m.providers.map(p => [text(p), p.getAttribute('aria-pressed'), enabled(p)]), m.only?.checked,
      m.views.map(p => [text(p), p.getAttribute('aria-pressed'), enabled(p)]), enabled(m.refresh), enabled(m.inspect), enabled(m.quota), text(m.quota),
      !!m.header, !!m.filters]);
    if (state === signature) return;
    signature = state; const focused = doc.activeElement?.getAttribute('data-choice'); panel.replaceChildren(); panel.style.minHeight = '';
    const head = doc.createElement('header'), heading = doc.createElement('h2'), exit = doc.createElement('button');
    const names = { pages:'页面切换', providers:'平台筛选', auth:'认证文件', tools:'站点工具', filters:'页面筛选' };
    heading.textContent = names[group]; heading.id = 'bridge-keeper-menu-title'; panel.setAttribute('aria-labelledby', heading.id);
    exit.textContent = '关闭'; exit.type = 'button'; exit.addEventListener('click', close); head.append(heading, exit); panel.appendChild(head);
    html.removeAttribute('data-hos-keeper-original');
    if (group === 'pages') {
      for (const page of m.pages) {
        const href = page.getAttribute('href');
        choice(text(page), next => next.pages.find(p => p.getAttribute('href') === href), page.getAttribute('aria-selected') === 'true' || page.getAttribute('aria-current') === 'page', 'button', true);
      }
      if (m.refresh) choice(title(m.refresh) || '刷新数据', next => next.refresh);
      if (m.filters) { const b = doc.createElement('button'); b.type = 'button'; b.className = 'keeper-choice'; b.textContent = '页面筛选 ›'; b.addEventListener('click', () => open('filters')); panel.appendChild(b); }
      if (!m.pages.length) note('当前页面没有可识别的导航，原网页导航已保留。');
    } else if (group === 'providers') {
      for (const source of m.providers) {
        const key = text(source).replace(/\s*\d+\s*$/, '');
        choice(text(source), next => next.providers.find(p => text(p).replace(/\s*\d+\s*$/, '') === key), source.getAttribute('aria-pressed') === 'true', 'button', true);
      }
      if (!m.providers.length) note('当前页面没有平台筛选，原网页控件已保留。');
    } else if (group === 'auth') {
      if (m.only) choice('仅启用', next => next.only, m.only.checked, 'switch');
      for (const view of m.views) {
        const key = text(view);
        choice(key, next => next.views.find(p => text(p) === key), view.getAttribute('aria-pressed') === 'true', 'button');
      }
      if (m.inspect) choice(text(m.inspect), next => next.inspect, m.inspect.getAttribute('aria-pressed') === 'true', 'button', true);
      if (m.quota) choice(text(m.quota), next => next.quota);
      if (!m.authHeader) note('进入认证文件页面后，可在此切换显示方式和使用原网页操作。');
    } else if (group === 'tools' && m.header) {
      html.setAttribute('data-hos-keeper-original', 'tools');
    } else if (group === 'filters' && m.filters && m.toolbar) {
      html.setAttribute('data-hos-keeper-original', 'filters');
    } else { note('当前页面没有这些工具，原网页控件已保留。'); }
    const source = group === 'tools' ? m.header : group === 'filters' ? m.toolbar : null;
    if (source) {
      const top = Math.ceil(head.getBoundingClientRect().bottom + 8);
      html.style.setProperty('--bridge-keeper-source-top', top + 'px');
      panel.style.minHeight = Math.ceil(top - panel.getBoundingClientRect().top + source.getBoundingClientRect().height + 14) + 'px';
    }
    all('button', panel).forEach((b, i) => b.setAttribute('data-choice', String(i)));
    if (focused) q('[data-choice="' + focused + '"]', panel)?.focus({preventScroll:true});
  }
  function restore() {
    observer.disconnect(); cancelAnimationFrame(scheduled); close(); doc.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize);
    for (const el of marked) el.removeAttribute('data-hos-keeper-fold');
    all('[data-hos-keeper-brand]').forEach(el => el.removeAttribute('data-hos-keeper-brand'));
    html.removeAttribute('data-hos-keeper'); style.remove(); summary.remove(); layer.remove(); delete window.__bridgeKeeperUiV1;
  }
  function sync() {
    scheduled = 0; if (!allowed()) { restore(); return; }
    const m = collect(), next = new Map();
    if (m.header) next.set(m.header, 'header');
    if (m.toolbar && m.pages.length && m.refresh) next.set(m.toolbar, 'toolbar');
    if (m.providerBar && m.providers.length) next.set(m.providerBar, 'providers');
    if (m.authHeader && m.only && m.views.length === 2 && m.inspect && m.quota) next.set(m.authHeader, 'auth');
    for (const el of marked) if (!next.has(el)) el.removeAttribute('data-hos-keeper-fold');
    next.forEach((value, el) => { if (el.getAttribute('data-hos-keeper-fold') !== value) el.setAttribute('data-hos-keeper-fold', value); });
    marked = new Set(next.keys());
    const brand = m.header && all('a', m.header).find(a => !!q('img', a) && text(a) === 'KEEPER');
    if (brand && !brand.hasAttribute('data-hos-keeper-brand')) brand.setAttribute('data-hos-keeper-brand', '');
    const layout = compact ? 'compact' : 'original'; if (html.getAttribute('data-hos-keeper') !== layout) html.setAttribute('data-hos-keeper', layout);
    if (sectionButton.textContent !== m.pageLabel) sectionButton.textContent = m.pageLabel;
    const selected = m.providers.find(p => p.getAttribute('aria-pressed') === 'true');
    const label = selected ? text(selected) : ''; if (providerLabel.textContent !== label) providerLabel.textContent = label;
    render(m);
  }
  function schedule() { if (!scheduled) scheduled = requestAnimationFrame(sync); }
  function open(value) {
    if (!allowed()) { restore(); return 'outside'; }
    if (value === 'close') { close(); return 'closed'; }
    if (value === 'layout') { compact = !compact; close(); sync(); return compact ? 'compact' : 'original'; }
    if (!['pages','providers','auth','tools','filters'].includes(value)) return 'unknown';
    previousFocus = doc.activeElement; group = value; layer.hidden = false; signature = ''; sync(); q('button', panel)?.focus({preventScroll:true}); return 'open';
  }
  sectionButton.addEventListener('click', () => open('pages'));
  layer.addEventListener('click', e => { if (e.target === layer) close(); });
  const onKey = e => {
    if (!group) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const original = html.getAttribute('data-hos-keeper-original');
      const sources = original === 'tools' ? q('[data-hos-keeper-fold="header"]') : original === 'filters' ? q('[data-dashboard-filters]') : null;
      const nodes = [...all('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)', panel), ...(sources ? all('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)', sources) : [])].filter(el => el.getClientRects().length);
      if (nodes.length && ((e.shiftKey && doc.activeElement === nodes[0]) || (!e.shiftKey && doc.activeElement === nodes[nodes.length - 1]))) { e.preventDefault(); (e.shiftKey ? nodes[nodes.length - 1] : nodes[0]).focus(); }
    }
  };
  const onResize = () => { signature = ''; schedule(); };
  window.addEventListener('resize', onResize);
  doc.addEventListener('keydown', onKey);
  const observer = new MutationObserver(records => {
    if (records.some(r => r.target !== html && !summary.contains(r.target) && !layer.contains(r.target) && r.attributeName !== 'data-hos-keeper-fold' && r.attributeName !== 'data-hos-keeper-brand')) schedule();
  });
  observer.observe(doc.body, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-pressed','aria-selected','aria-current','aria-busy','disabled','checked','data-theme']});
  const back = () => { if (!allowed()) { restore(); return false; } if (!group) return false; close(); return true; };
  window.__bridgeKeeperUiV1 = {open, sync, restore, back}; sync(); return 'ready';
})()
`;

export function keeperUiScript(expectedURL: string, command: string = ''): string {
  if (!keeperPage(expectedURL)) return '"outside"';
  const action = ['pages', 'providers', 'auth', 'tools', 'filters', 'layout', 'close', 'back'].indexOf(command) >= 0 ? command : '';
  return '(function(){if(window!==window.top||location.href!==' + JSON.stringify(expectedURL) + ')return "outside";const result=' +
    KEEPER_UI_SCRIPT + ';return ' + (action === 'back' ? '(window.__bridgeKeeperUiV1?.back()?"closed":"none")' :
    action ? 'window.__bridgeKeeperUiV1?.open(' + JSON.stringify(action) + ')||result' : 'result') + ';})()';
}
