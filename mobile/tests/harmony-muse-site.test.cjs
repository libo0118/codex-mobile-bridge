const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');
const root = path.join(__dirname, '../harmony/entry/src/main');
const read = name => fs.readFileSync(path.join(root, 'ets', name), 'utf8');
const strip = code => stripTypeScriptTypes(code.replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, ''), { mode: 'strip' });
function services(initial = {}) {
  const records = new Map(Object.entries(initial));
  const preferences = { getPreferences: async () => ({ get: async (key, fallback) => records.get(key) ?? fallback,
    put: async (key, value) => records.set(key, value), flush: async () => {} }) };
  const context = vm.createContext({ preferences });
  vm.runInContext(strip(read('security/GatewayURL.ets') + '\n' + read('services/ServiceSite.ets')) + '\nthis.api={ServiceSite,ServiceStore,serviceCredentialURL};', context);
  return { ...context.api, records, store: new context.api.ServiceStore() };
}

test('Muse is a separate HTTPS site and never consumes or rewrites saved Chat preferences', async () => {
  const saved = JSON.stringify({ name: 'Legacy Chat', url: 'https://example.test/chat/?view=plugin-chat', enabled: true });
  const h = services({ chat: saved });
  const list = await h.store.load({});
  const muse = list.find(site => site.id === 'muse');
  assert.ok(muse); assert.equal(muse.name, 'Muse'); assert.equal(muse.url, 'https://muse.ai/');
  assert.equal(muse.loginOrigin, 'https://muse.ai'); assert.equal(muse.enabled, true);
  assert.equal(h.records.get('chat'), saved); assert.equal(h.records.has('muse'), false);
  await h.store.save(new h.ServiceSite('muse', 'Muse', 'https://muse.ai/'));
  assert.equal(h.records.get('chat'), saved);
  assert.equal(JSON.parse(h.records.get('muse')).url, 'https://muse.ai/');
  for (const url of ['http://muse.ai/', 'https://user:secret@muse.ai/', 'https://muse.ai/?token=secret', 'https://muse.ai/#secret']) {
    assert.throws(() => new h.ServiceSite('muse', 'Muse', url), undefined, url);
  }
});

test('bottom tabs and conversation switch menu replace only the hidden Chat slot with Muse', () => {
  const index = read('pages/Index.ets');
  const filters = [...index.matchAll(/this\.services\.filter\(\(site: ServiceSite\) => ([^\n]+?)\),/g)];
  const sites = [{ id:'keeper' }, { id:'cpa' }, { id:'magpie' }, { id:'muse' }, { id:'chat' }];
  assert.equal(filters.length, 2);
  for (const [, predicate] of filters) assert.deepEqual(sites.filter(new Function('site', 'return ' + predicate)).map(site => site.id), ['keeper','magpie','muse']);
  assert.match(index, /id === 'muse'.*nav_muse_selected.*nav_muse/);
  assert.match(index, /id === 'muse' \? 'Muse'/);
  assert.doesNotMatch(index, /MenuItem\(\{ content:.*Chat 设置/);
});

test('Muse uses an isolated credential namespace and never the legacy Chat injection protocol', async () => {
  const context = vm.createContext({ preferences: { getPreferences: async () => ({ get: async (_, fallback) => fallback }) } });
  vm.runInContext(strip(read('security/GatewayURL.ets') + '\n' + read('services/CredentialVault.ets')) + '\nthis.vault=new CredentialVault();', context);
  assert.equal(await context.vault.has({}, 'muse', 'https://muse.ai/'), false);
  const web = read('services/ServiceWeb.ets');
  assert.match(web, /if \(this\.site\.id !== 'chat'\) return;/);
  assert.doesNotMatch(web, /site\.id === 'muse'.*(?:chatUi|magpieUi|chatCommand)/);
  assert.match(web, /mixedMode\(MixedMode\.None\).*multiWindowAccess\(false\)/);
});

test('Muse redraw uses self-contained 24px vector marks, not the Chat bubble or remote images', () => {
  for (const name of ['nav_muse.svg','nav_muse_selected.svg']) {
    const svg = fs.readFileSync(path.join(root, 'resources/base/media', name), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /stroke-linecap="round"/);
    assert.doesNotMatch(svg, /<image|href=|script|display-p3/);
  }
});

function serviceWeb() {
  const source = read('services/ServiceWeb.ets'), dialogs = [], launches = [], webCalls = [];
  const logic = source.slice(0, source.indexOf('  @Builder')).replace(/@\w+(?:\([^()\n]*\))?\s*/g, '')
    .replace('struct ServiceWeb', 'class ServiceWeb') + '\n}';
  const context = vm.createContext({ getContext: () => ({ startAbility: async want => { launches.push(want); } }),
    ServiceSite: class {}, webview: { WebCookieManager: { saveCookieAsync: async () => {} }, WebviewController: class {
      loadUrl() { webCalls.push('loadUrl'); } refresh() { webCalls.push('refresh'); } runJavaScript() { webCalls.push('script'); return Promise.resolve(''); }
    } }, AlertDialog: { show: dialog => dialogs.push(dialog) } });
  vm.runInContext(strip(read('security/GatewayURL.ets') + '\n' + logic) + '\nthis.page = new ServiceWeb();', context);
  context.page.site = { id: 'muse', url: 'https://muse.ai/', loginOrigin: 'https://muse.ai' };
  context.page.active = true; context.page.initialURL = context.page.site.url; context.page.currentURL = context.page.site.url;
  return { page: context.page, dialogs, launches, webCalls, emit(name, event) {
    const start = source.indexOf('.' + name + '(');
    assert.notEqual(start, -1, name + ' must be wired to the Web component');
    const call = source.slice(start).split(/\r?\n        (?=\.[a-zA-Z])/)[0].trim();
    const callback = call.slice(name.length + 2, -1);
    return vm.runInContext('(function () { return ' + callback + '; }).call(page)', context)(event);
  } };
}
const request = (url, main = true, gesture = false) => ({ getRequestUrl: () => url, isMainFrame: () => main, isRequestGesture: () => gesture });

test('Muse #weblink stays same-origin through navigation and history callbacks without reload or DOM injection', () => {
  const h = serviceWeb(), url = 'https://muse.ai/#weblink';
  assert.equal(h.page.allowed(url), true);
  assert.equal(h.emit('onLoadIntercept', { data: request(url) }), false);
  h.emit('onPageBegin', { url }); h.emit('onPageEnd', { url });
  h.emit('onRefreshAccessedHistory', { url }); h.page.activeChanged();
  assert.equal(h.page.currentURL, url); assert.equal(h.page.initialURL, 'https://muse.ai/');
  assert.equal(h.page.status, ''); assert.equal(h.dialogs.length, 0); assert.equal(h.launches.length, 0);
  assert.deepEqual(h.webCalls, []);
  assert.match(read('services/ServiceWeb.ets'), /Web\(\{ src: this\.initialURL, controller: this\.controller \}\)/);
});

test('blocked automatic top-level navigation is visible without opening an external app or leaking its URL', () => {
  const h = serviceWeb(), target = 'https://external.example/login?code=private-code#private-token';
  assert.equal(h.page.navigate(request(target)), true);
  assert.match(h.page.status, /拦截/);
  assert.doesNotMatch(h.page.status, /external|private-code|private-token/);
  assert.equal(h.dialogs.length, 0); assert.equal(h.launches.length, 0);
  h.page.status = '';
  assert.equal(h.page.navigate(request('https://muse.ai/login')), false);
  assert.equal(h.page.navigate(request(target, false)), false);
  assert.equal(h.page.status, '');
  assert.equal(h.page.navigate(request(target, true, true)), true);
  assert.equal(h.dialogs.length, 1); assert.equal(h.launches.length, 0);
});

test('HTTP and network failures show numeric main-frame diagnostics, not page contents or subresource errors', () => {
  const h = serviceWeb();
  const failed = request('https://muse.ai/?private=token');
  h.emit('onHttpErrorReceive', { request: failed, response: { getResponseCode: () => 403 } });
  assert.match(h.page.status, /HTTP 403/); assert.doesNotMatch(h.page.status, /private|token/);
  h.emit('onErrorReceive', { request: failed, error: { getErrorCode: () => -105 } });
  assert.match(h.page.status, /-105/);
  h.page.status = '';
  h.emit('onHttpErrorReceive', { request: request('https://muse.ai/image', false), response: { getResponseCode: () => 404 } });
  h.emit('onErrorReceive', { request: request('https://muse.ai/image', false), error: { getErrorCode: () => -105 } });
  assert.equal(h.page.status, '');
});

test('Muse opens only its configured public URL in the system browser after an explicit active action', async () => {
  const h = serviceWeb();
  h.page.currentURL = 'https://muse.ai/login?private=token#secret';
  assert.equal(h.launches.length, 0);
  await h.page.openInBrowser();
  assert.equal(h.launches.length, 1); assert.equal(h.launches[0].uri, 'https://muse.ai/');
  h.page.active = false; await h.page.openInBrowser();
  h.page.active = true; h.page.site.id = 'magpie'; await h.page.openInBrowser();
  assert.equal(h.launches.length, 1);
  h.page.site.id = 'muse'; h.page.context.startAbility = async () => { throw new Error('unavailable'); };
  await h.page.openInBrowser(); assert.match(h.page.status, /无法打开系统浏览器/);
  assert.match(read('services/ServiceWeb.ets'), /MenuItem\(\{ content: '用系统浏览器打开 Muse' \}\)\.onClick\(\(\) => \{ this\.openInBrowser\(\); \}\)/);
});
