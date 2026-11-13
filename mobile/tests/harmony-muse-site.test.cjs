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
