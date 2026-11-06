const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');

const root = path.join(__dirname, '../harmony/entry/src/main/ets');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const strip = code => stripTypeScriptTypes(code.replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, ''), { mode: 'strip' });
const defaultURL = 'https://libo.siasunagv.cn/magpie/?view=plugin-chat';

function sites(initial = {}) {
  const records = new Map(Object.entries(initial));
  const preferences = { getPreferences: async () => ({
    get: async (key, fallback) => records.get(key) ?? fallback,
    put: async (key, value) => records.set(key, value), flush: async () => {}
  }) };
  const context = vm.createContext({ preferences });
  vm.runInContext(strip(source('security/GatewayURL.ets') + '\n' + source('services/ServiceSite.ets')) +
    '\nthis.api = { ServiceSite, ServiceStore, serviceCredentialURL, credentialScopeMatches };', context);
  return { ...context.api, records, store: new context.api.ServiceStore() };
}

test('Chat is appended enabled with an exact deep link while existing rows stay enabled', async () => {
  const h = sites({ cpa: JSON.stringify({ name: 'Old CPA', url: 'https://example.test/cpa/' }),
    magpie: JSON.stringify({ name: 'Magpie', url: 'https://example.test/magpie/' }) });
  const list = await h.store.load({});
  assert.deepEqual(Array.from(list, item => item.id), ['keeper', 'cpa', 'magpie', 'chat']);
  assert.deepEqual(Array.from(list, item => item.enabled), [true, true, true, true]);
  assert.equal(list[3].url, defaultURL);
  assert.equal(list[3].loginOrigin, 'https://libo.siasunagv.cn');
  assert.equal(list[1].name, 'Old CPA');
  assert.equal(new h.ServiceSite('magpie', 'M', 'https://example.test/m/', 'https://login.example.test').loginOrigin,
    'https://login.example.test', 'the fourth constructor argument is unchanged');
});

test('Chat disable, empty URL, custom address and restart round-trip without changing other sites', async () => {
  const h = sites(); await h.store.load({});
  await h.store.save(new h.ServiceSite('chat', 'Chat', '', '', false));
  let row = JSON.parse(h.records.get('chat'));
  assert.equal(row.enabled, false); assert.equal(row.url, '');
  let chat = (await h.store.load({})).find(item => item.id === 'chat');
  assert.equal(chat.enabled, false); assert.equal(chat.url, '');
  await h.store.save(new h.ServiceSite('chat', 'Personal Chat', 'https://EXAMPLE.test/talk/?view=plugin-chat', '', true));
  chat = (await h.store.load({})).find(item => item.id === 'chat');
  assert.equal(chat.enabled, true); assert.equal(chat.url, 'https://example.test/talk/?view=plugin-chat');
  assert.equal(h.serviceCredentialURL(chat), 'https://example.test/talk/');
  await h.store.save(new h.ServiceSite('chat', 'Chat', 'https://example.test/talk/', '', false));
  chat = (await h.store.load({})).find(item => item.id === 'chat');
  assert.equal(chat.enabled, false); assert.equal(chat.url, 'https://example.test/talk/');
  await assert.rejects(h.store.save(new h.ServiceSite('chat', 'Chat', '', '', true)));
  await assert.rejects(h.store.save({ id: 'chat', name: 'Chat', url: '', enabled: undefined }));
  await assert.rejects(h.store.save(new h.ServiceSite('keeper', 'Keeper', 'https://example.test/')));
  await assert.rejects(h.store.save(new h.ServiceSite('cpa', 'CPA', '')));
  assert.throws(() => new h.ServiceSite('magpie', 'Magpie', 'https://example.test/?view=plugin-chat'));
});

test('Chat settings reject secrets, fragment, non-HTTPS and malformed stored state', async () => {
  const h = sites(); await h.store.load({});
  for (const url of ['https://example.test/?token=secret', 'https://example.test/?view=plugin-chat&token=secret',
    'https://example.test/?view=plugin-chat#secret', 'https://user:password@example.test/?view=plugin-chat',
    'http://localhost/?view=plugin-chat', 'https://example.test/#secret']) {
    assert.throws(() => new h.ServiceSite('chat', 'Chat', url), undefined, url);
  }
  for (const row of ['{broken', JSON.stringify({ url: defaultURL + '&token=secret', enabled: true }),
    JSON.stringify({ url: defaultURL, enabled: 'false' }), 'x'.repeat(8193)]) {
    h.records.set('chat', row);
    const chat = (await h.store.load({})).find(item => item.id === 'chat');
    assert.equal(chat.enabled, false); assert.equal(chat.url, '');
  }
  h.records.set('chat', JSON.stringify({ name: 'Chat', url: defaultURL }));
  assert.equal((await h.store.load({})).find(item => item.id === 'chat').enabled, true);
});

test('Chat credential scope uses only the configured path and never broadens to other paths', () => {
  const h = sites(), chat = new h.ServiceSite('chat', 'Chat', defaultURL), scope = h.serviceCredentialURL(chat);
  assert.equal(h.credentialScopeMatches(defaultURL, scope, scope), true);
  assert.equal(h.credentialScopeMatches('https://libo.siasunagv.cn/keeper/', scope, scope), false);
  assert.equal(h.credentialScopeMatches('https://evil.example/magpie/', scope, scope), false);
  assert.equal(h.credentialScopeMatches('https://libo.siasunagv.cn/magpie/%2e%2e/keeper/', scope, scope), false);
  const context = vm.createContext({ preferences: { getPreferences: async () => ({ get: async (_, fallback) => fallback }) } });
  vm.runInContext(strip(source('security/GatewayURL.ets') + '\n' + source('services/CredentialVault.ets')) +
    '\nthis.vault = new CredentialVault();', context);
  return context.vault.has({}, 'chat', scope).then(value => assert.equal(value, false));
});

const context = vm.createContext({});
vm.runInContext(strip(source('services/ChatUi.ets')) + '\nthis.chatUiScript = chatUiScript;', context);
const { chatUiScript } = context;

function page(start, expected = start, { initial = true, mainFrame = true, nav = true, frame = false, button = false, activated = false } = {}) {
  const calls = { clicks: 0, observers: [], timers: new Map(), listeners: new Map(), styles: [] };
  let href = start, hasFrame = frame, hasButton = button, timerID = 0;
  const attrs = new Map();
  const location = { get href() { return href; }, get search() { return new URL(href).search; }, get hash() { return new URL(href).hash; } };
  const document = {
    documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k) },
    body: {}, head: { appendChild: node => calls.styles.push(node) },
    createElement: tag => ({ tag, id: '', textContent: '' }),
    querySelector(selector) {
      if (selector === '#nav') return nav ? {} : null;
      if (selector === '#view-plugin-chat>iframe.plugin-frame') return hasFrame ? {} : null;
      if (/^#nav button\[data-view="[a-z0-9-]+"\]\[aria-current="page"\]$/.test(selector)) return nav ? {} : null;
      if (selector === '#nav button[data-view="plugin-chat"][data-plugin-page]') return hasButton ? {
        disabled: false, click() { calls.clicks++; href = defaultURL; }
      } : null;
      throw new Error('unexpected selector ' + selector);
    },
    addEventListener: (name, fn) => calls.listeners.set(name, fn), removeEventListener: name => calls.listeners.delete(name)
  };
  class MutationObserver { constructor(fn) { this.callback = fn; calls.observers.push(this); } observe() {} }
  const sandbox = { location, document, MutationObserver, navigator: { userActivation: { hasBeenActive: activated } },
    setTimeout: fn => { calls.timers.set(++timerID, fn); return timerID; }, clearTimeout: id => calls.timers.delete(id) };
  sandbox.window = sandbox; sandbox.top = mainFrame ? sandbox : {};
  vm.createContext(sandbox);
  return { calls, attrs, sandbox, run: () => vm.runInContext(chatUiScript(expected, defaultURL, initial), sandbox),
    href(value) { href = value; }, frame(value) { hasFrame = value; }, button(value) { hasButton = value; },
    sync() { calls.observers[0].callback(); } };
}

test('actual injected host script handles delayed plugin registration once and preserves navigation', () => {
  const usage = 'https://libo.siasunagv.cn/magpie/?view=usage', p = page(usage);
  assert.equal(p.run(), 'ready'); assert.equal(p.calls.clicks, 0); assert.equal(p.attrs.has('data-bridge-chat'), false);
  p.button(true); p.sync(); assert.equal(p.calls.clicks, 1); assert.equal(p.calls.timers.size, 0);
  p.frame(true); p.sync(); assert.equal(p.attrs.has('data-bridge-chat'), true);
  assert.match(p.calls.styles[0].textContent, /#view-plugin-chat>iframe\.plugin-frame/);
  p.href(usage); p.sync(); assert.equal(p.attrs.has('data-bridge-chat'), false);
  assert.equal(p.calls.clicks, 1, 'subsequent user navigation is never overridden');
  p.href(defaultURL); p.sync(); assert.equal(p.attrs.has('data-bridge-chat'), true);
});

test('initial fallback accepts another recognized Magpie view, not an unrelated query', () => {
  const providers = 'https://libo.siasunagv.cn/magpie/?view=providers';
  const p = page(providers, providers, { button: true });
  assert.equal(p.run(), 'ready'); assert.equal(p.calls.clicks, 1);
  for (const url of ['https://libo.siasunagv.cn/magpie/?view=providers&token=x',
    'https://libo.siasunagv.cn/other/?view=providers']) {
    const other = page(url, url, { button: true });
    assert.equal(other.run(), 'outside'); assert.equal(other.calls.clicks, 0);
  }
});

test('pending initial navigation is cancelled by a real user action or timeout', () => {
  const usage = 'https://libo.siasunagv.cn/magpie/?view=usage';
  for (const cancel of ['pointerdown', 'keydown', 'timeout']) {
    const p = page(usage); assert.equal(p.run(), 'ready');
    if (cancel === 'timeout') [...p.calls.timers.values()][0]();
    else p.calls.listeners.get(cancel)({ isTrusted: true });
    p.button(true); p.sync(); assert.equal(p.calls.clicks, 0, cancel);
  }
});

test('sticky user activation before script installation prevents the automatic initial switch', () => {
  const usage = 'https://libo.siasunagv.cn/magpie/?view=usage';
  const p = page(usage, usage, { activated: true, button: true });
  assert.equal(p.run(), 'ready');
  assert.equal(p.calls.clicks, 0);
  assert.equal(p.calls.timers.size, 0);
  assert.equal(p.calls.listeners.size, 0);
  p.sync(); assert.equal(p.calls.clicks, 0);
  const unsupported = page(usage, usage, { button: true });
  delete unsupported.sandbox.navigator.userActivation;
  assert.equal(unsupported.run(), 'ready'); assert.equal(unsupported.calls.clicks, 1);
});

test('injection ignores another page, login, wrong URL and iframe execution', () => {
  const other = 'https://libo.siasunagv.cn/magpie/?view=providers';
  for (const p of [page(other, other, { initial: false }), page(defaultURL, defaultURL, { nav: false }),
    page(defaultURL, defaultURL, { mainFrame: false }), page(other, defaultURL)]) {
    assert.equal(p.run(), 'outside'); assert.equal(p.calls.styles.length, 0); assert.equal(p.calls.clicks, 0);
  }
  assert.equal(chatUiScript(defaultURL, 'https://example.test/', true), '"outside"');
});

test('native Chat injection reports failures only for the still-current page', async () => {
  let reject;
  const code = source('services/ServiceWeb.ets').split('  @Builder')[0]
    .replace(/@\w+(?:\([^()\n]*\))?\s*/g, '').replace('export struct ServiceWeb', 'class ServiceWeb') + '\n}';
  const sandbox = vm.createContext({ ServiceSite: class {}, getContext: () => ({}), chatUiScript,
    httpsOrigin: url => new URL(url).origin, webString: value => value,
    webview: { WebviewController: class {
      getUrl() { return defaultURL; }
      runJavaScript() { return new Promise((_, fail) => { reject = fail; }); }
    } } });
  vm.runInContext(strip(code) + '\nthis.service = new ServiceWeb();', sandbox);
  const service = sandbox.service;
  service.site = { id: 'chat', url: defaultURL, loginOrigin: 'https://libo.siasunagv.cn' };
  service.initialURL = defaultURL; service.currentURL = defaultURL; service.active = true;
  service.chatCommand(); reject(Error('failed')); await Promise.resolve(); await Promise.resolve();
  assert.match(service.status, /适配失败/);
  service.status = ''; service.chatCommand(); service.currentURL = 'https://libo.siasunagv.cn/magpie/?view=usage';
  reject(Error('stale')); await Promise.resolve(); await Promise.resolve();
  assert.equal(service.status, '');
});
