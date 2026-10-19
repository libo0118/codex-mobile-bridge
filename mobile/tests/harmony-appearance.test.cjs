const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');
const root = path.join(__dirname, '../harmony/entry/src/main/ets');

function load(relative, names, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8').replace(/^import[^\n]+\n/gm, '').replace(/\bexport /g, '');
  const scope = vm.createContext(dependencies);
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'strip' }) + '\nthis.result = {' + names.join(',') + '};', scope);
  return scope.result;
}
const model = load('appearance/NavigationAppearance.ets', ['NavigationAppearance', 'decodeNavigationAppearance']);
const plain = value => JSON.parse(JSON.stringify(value));
const defaults = { system: true, blur: 100, thickness: 1 };

test('navigation appearance validates old, malformed and out-of-range preferences', () => {
  for (const value of ['', '{', 'null', '0', '[]', 'x'.repeat(257), '{"system":"true","blur":"50","thickness":null}']) {
    assert.deepEqual(plain(model.decodeNavigationAppearance(value)), defaults);
  }
  assert.deepEqual(plain(model.decodeNavigationAppearance('{"system":false,"blur":43.8,"thickness":3}')), { system: false, blur: 44, thickness: 3 });
  assert.deepEqual(plain(new model.NavigationAppearance(false, -1, 12)), { system: false, blur: 0, thickness: 4 });
  assert.deepEqual(plain(new model.NavigationAppearance(true, Infinity, NaN)), defaults);
});

test('appearance persistence survives a new store and cannot overwrite connections or alerts', async () => {
  const records = new Map([['computers', '[]'], ['language', 'en'], ['alerts', true]]);
  let flushes = 0;
  const prefs = { get: async (key, fallback) => records.has(key) ? records.get(key) : fallback,
    put: async (key, value) => records.set(key, value), flush: async () => { flushes++; } };
  const { ComputerStore } = load('data/ComputerStore.ets', ['ComputerStore'], { ...model, preferences: { getPreferences: async () => prefs } });
  const first = new ComputerStore(); await first.load({});
  await first.navigationAppearance(new model.NavigationAppearance(false, 37, 4));
  const second = new ComputerStore(); await second.load({});
  assert.deepEqual(plain(await second.savedNavigationAppearance()), { system: false, blur: 37, thickness: 4 });
  assert.equal(records.get('computers'), '[]'); assert.equal(records.get('language'), 'en'); assert.equal(records.get('alerts'), true);
  assert.equal(flushes, 1);
  prefs.flush = async () => { throw new Error('storage error'); };
  await assert.rejects(second.navigationAppearance(new model.NavigationAppearance()), /storage error/);
});

const graphics = load('appearance/NavigationMaterial.ets', ['detectSystemGlass', 'NavigationMaterial'], {
  BlurStyle: { NONE: 'none', COMPONENT_REGULAR: 'regular' }, ThemeColorMode: { LIGHT: 'light' },
  BlurStyleActivePolicy: { FOLLOWS_WINDOW_ACTIVE_STATE: 'focus' }
});

test('old systems never import the API 26 module and modern capability failures fall back', async () => {
  let loaded = 0;
  const adapter = {};
  const loader = async () => { loaded++; return { createSystemGlass: () => adapter }; };
  for (const version of [14, 23, 25, NaN]) assert.equal(await graphics.detectSystemGlass(version, loader), undefined);
  assert.equal(loaded, 0);
  assert.equal(await graphics.detectSystemGlass(26, loader), adapter);
  assert.equal(loaded, 1);
  assert.equal(await graphics.detectSystemGlass(26, async () => { throw new Error('module unavailable'); }), undefined);
  assert.equal(await graphics.detectSystemGlass(26, async () => ({ createSystemGlass() { throw new Error('unsupported API'); } })), undefined);
  assert.equal(await graphics.detectSystemGlass(26, async () => ({ createSystemGlass: () => undefined })), undefined);
});

test('material modes are exclusive and a custom blur value reaches the native API', () => {
  const calls = [];
  const target = { backgroundBlurStyle: (style, options) => calls.push(['blur', style, options]), border: value => calls.push(['border', value]), shadow: value => calls.push(['shadow', value]) };
  const adapter = { apply: (_target, thickness) => calls.push(['system', thickness]), clear: () => calls.push(['clear']) };
  new graphics.NavigationMaterial(37, true, 3, adapter).applyNormalAttribute(target);
  assert.deepEqual(plain(calls), [['blur', 'none', null], ['system', 3]]);
  calls.length = 0;
  new graphics.NavigationMaterial(37, false, 3, adapter).applyNormalAttribute(target);
  assert.equal(calls[0][0], 'clear'); assert.equal(calls[1][1], 'regular'); assert.equal(calls[1][2].scale, .37);
  calls.length = 0;
  new graphics.NavigationMaterial(0, true, 3).applyNormalAttribute(target);
  assert.equal(calls[0][1], 'regular'); assert.equal(calls[0][2].scale, 0);
  calls.length = 0;
  new graphics.NavigationMaterial(NaN, false, 3).applyNormalAttribute(target);
  assert.equal(calls[0][2].scale, 1);
});
