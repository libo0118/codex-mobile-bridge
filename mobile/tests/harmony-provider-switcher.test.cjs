const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');

const root = path.join(__dirname, '../harmony/entry/src/main/ets/web');
const scope = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'DisplayStyle.ets'), 'utf8')
  .replace(/\bexport /g, ''), { mode: 'strip' }), scope);
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'ProviderSwitcher.ets'), 'utf8')
  .replace(/\bexport /g, ''), { mode: 'strip' }) + '\nthis.postlude = PROVIDER_SWITCHER_SCRIPT;', scope);
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'WebScripts.ets'), 'utf8')
  .replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, ''), { mode: 'strip' }) + '\nthis.inject = mobileScript;', scope);

test('Harmony postlude remains behind the exact URL and main-frame guard', () => {
  for (const options of [{ frame: true }, { url: 'https://other.example/' }]) {
    const page = vm.createContext({ location: { href: options.url || 'https://gateway.example/' } });
    page.window = page; page.top = options.frame ? {} : page;
    vm.runInContext(scope.inject('throw Error("shared source executed");', 'token', 'https://gateway.example/'), page);
    assert.equal(page.__bridgeHarmonyProviderSwitcher, undefined);
  }
});

test('Harmony postlude runs after shared mobile setup and repeated injection reuses its observer', () => {
  let syncs = 0, listeners = 0;
  const page = vm.createContext({ location: { href: 'https://gateway.example/' },
    document: { styleSheets: [], addEventListener() { listeners++; } } });
  page.window = page; page.top = page;
  page.__bridgeHarmonyProviderSwitcher = { sync() { syncs++; } };
  vm.runInContext(scope.inject('document.documentElement = { classList: { contains: value => value === "bridge-mobile" } };', 'token', 'https://gateway.example/'), page);
  assert.equal(syncs, 1);
  assert.equal(listeners, 2, 'only existing upload-gesture listeners are added on reinjection');
  assert.equal(page.BridgeMobileCapabilities.diagnosticsExport, true);
});

test('postlude leaves a desktop document untouched without shared mobile setup', () => {
  const page = vm.createContext({ document: { documentElement: { classList: { contains: () => false } } } });
  page.window = page; page.top = page;
  vm.runInContext(scope.postlude, page);
  assert.equal(page.__bridgeHarmonyProviderSwitcher, undefined);
});
