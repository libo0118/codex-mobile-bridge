const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');

const root = path.join(__dirname, '../harmony/entry/src/main/ets');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const strip = code => stripTypeScriptTypes(code.replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, ''), {mode:'strip'});
const api = vm.createContext({});
vm.runInContext(strip(source('security/GatewayURL.ets') + '\n' + source('services/KeeperUi.ets')) +
  '\nthis.keeper = {keeperPage, keeperUiScript, KEEPER_UI_SCRIPT};', api);
const {keeperPage, keeperUiScript} = api.keeper;
const base = 'https://libo.siasunagv.cn/keeper/';

test('Keeper adapter accepts only the exact HTTPS Keeper scope, including native action rechecks', () => {
  for (const url of [base, base.slice(0, -1), base + 'auth-files?provider=codex', base + 'overview']) assert.equal(keeperPage(url), true, url);
  for (const url of [base.replace('https:', 'http:'), base.replace('/keeper/', '/cpa/'), base.replace('/keeper/', '/magpie/'),
    base.replace('/keeper/', '/keeper-other/'), base + '../magpie/', base + '%2e%2e/magpie/', base + '%61uth-files',
    'https://user:secret@libo.siasunagv.cn/keeper/', 'https://evil.example/keeper/']) {
    assert.equal(keeperPage(url), false, url);
    assert.equal(keeperUiScript(url, 'auth'), '"outside"');
  }
});

function page(url = base, frame = false) {
  const calls = [];
  const context = vm.createContext({URL, location:{href:url}, __bridgeKeeperUiV1:{sync(){calls.push('sync');}, open(group){calls.push(group); return 'open';}, back(){calls.push('back'); return true;}}});
  context.window = context; context.top = frame ? {} : context;
  return {context,calls};
}

test('page injection requires the current main frame and never initializes same-origin CPA or Magpie', () => {
  for (const [url, frame] of [[base,true], [base + 'auth-files',false], ['https://libo.siasunagv.cn/cpa/',false], ['https://libo.siasunagv.cn/magpie/',false]]) {
    const p = page(url, frame);
    assert.equal(vm.runInContext(keeperUiScript(base, 'providers'), p.context), 'outside');
    assert.deepEqual(p.calls, []);
  }
});

test('repeat injection reuses the existing observer and only whitelisted UI commands execute', () => {
  const p = page();
  assert.equal(vm.runInContext(keeperUiScript(base, 'providers'), p.context), 'open');
  assert.deepEqual(p.calls, ['sync', 'providers']);
  p.calls.length = 0;
  assert.equal(vm.runInContext(keeperUiScript(base, 'back'), p.context), 'closed');
  assert.deepEqual(p.calls, ['sync', 'back']);
  p.calls.length = 0;
  vm.runInContext(keeperUiScript(base, '"; throw Error("injected"); //'), p.context);
  assert.deepEqual(p.calls, ['sync']);
});

test('public semantic hooks recognize all shipped languages and preserve unknown tool groups', () => {
  const runtime = api.keeper.KEEPER_UI_SCRIPT;
  const helpers = runtime.slice(runtime.indexOf('  const q ='), runtime.indexOf('  const style ='));
  const collector = runtime.slice(runtime.indexOf('  function collect()'), runtime.indexOf('  function close()'));
  const node = (label = '', attrs = {}, queries = {}) => ({textContent:label,isConnected:true,
    getAttribute:key=>attrs[key] ?? null,querySelector:key=>queries[key]?.[0] || null,querySelectorAll:key=>queries[key] || []});
  for (const [heading,aria,inspect,quota] of [
    ['认证文件','凭证供应商筛选','巡检','更新限额'],
    ['認證檔案','憑證供應商篩選','巡檢','更新限額'],
    ['Auth Files','Credential provider filters','Inspect','Update Quotas']]) {
    const view = node('quota',{'aria-pressed':'true'}), input = node(), scan = node(inspect), refresh = node(quota);
    const authHeader = node('',{}, {'label input[type="checkbox"]':[input], '[role="group"][aria-label] button[aria-pressed]':[view,view], 'button':[view,view,scan,refresh]});
    const auth = node('',{}, {'h3.keeper-card-title':[node(heading)]}); auth.firstElementChild=authHeader;
    const bar = node('',{'aria-label':aria},{'button[aria-pressed]':[node('Cursor 1')]});
    const doc = node('',{}, {'section.keeper-card-surface':[auth], '[role="toolbar"][aria-label]':[bar]});
    const context = vm.createContext({doc}); vm.runInContext(helpers + collector + ';this.collect=collect;',context);
    const result = context.collect(); assert.equal(result.authHeader,authHeader); assert.equal(result.quota,refresh);
    assert.equal(result.inspect,scan); assert.equal(result.providerBar,bar); assert.equal(result.views.length,2);
    refresh.textContent = 'Unknown new operation'; assert.equal(context.collect().quota,undefined,'unknown header cannot satisfy folding prerequisites');
  }
});

function serviceHarness() {
  const callbacks = [], timers = new Map(), calls = []; let timerId = 0;
  const adapters = {ServiceSite:class {}, getContext:()=>({}), keeperPage, keeperUiScript, webString:v=>v,
    setTimeout:fn=>{timers.set(++timerId, fn); return timerId;}, clearTimeout:id=>timers.delete(id),
    webview:{WebviewController:class {getUrl(){return this.url || base;} runJavaScript(script){calls.push(script); return new Promise((resolve,reject)=>callbacks.push({resolve,reject}));}}}};
  const context = vm.createContext(adapters);
  const component = source('services/ServiceWeb.ets').split('  @Builder')[0]
    .replace(/@\w+(?:\([^()\n]*\))?\s*/g, '').replace('export struct ServiceWeb', 'class ServiceWeb') + '\n}';
  vm.runInContext(strip(component) + '\nthis.service = new ServiceWeb();', context);
  const service = context.service; let appBack = 0;
  service.site = {id:'keeper'}; service.active = true; service.currentURL = base; service.onAppBack = () => appBack++;
  return {service,callbacks,timers,calls,appBack:()=>appBack};
}

test('native back consumes Keeper secondary panels before returning to Codex', async () => {
  const h = serviceHarness(); h.service.requestBack();
  h.callbacks[0].resolve('closed'); await Promise.resolve();
  assert.equal(h.appBack(), 0); assert.equal(h.timers.size, 0);
  h.service.requestBack(); h.callbacks[1].resolve('none'); await Promise.resolve();
  assert.equal(h.appBack(), 1);
  h.service.active = false; h.service.requestBack(); assert.equal(h.callbacks.length, 2);
});

test('native back timeout is bounded and stale requests cannot steal a different tab or navigation', async () => {
  const h = serviceHarness(); h.service.requestBack();
  [...h.timers.values()][0](); assert.equal(h.appBack(), 1);
  h.callbacks[0].resolve('none'); await Promise.resolve(); assert.equal(h.appBack(), 1);
  h.service.requestBack(); h.service.active = false; h.callbacks[1].reject(Error('hidden')); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.appBack(), 1);
  h.service.active = true; h.service.requestBack(); h.service.currentURL = base + 'overview';
  h.callbacks[2].resolve('none'); await Promise.resolve(); assert.equal(h.appBack(), 1);
  h.service.currentURL = base; h.service.requestBack(); h.service.requestBack();
  h.callbacks[3].resolve('none'); await Promise.resolve(); assert.equal(h.appBack(), 1);
  h.callbacks[4].resolve('none'); await Promise.resolve(); assert.equal(h.appBack(), 2);
});

test('Index delegates only Keeper back; credential menu requests do not bypass existing form scope checks', () => {
  const index = source('pages/Index.ets');
  const back = index.slice(index.indexOf('  onBackPress()'), index.indexOf('  @Builder', index.indexOf('  onBackPress()')));
  const context = vm.createContext({}); vm.runInContext(strip('class Page {' + back + '}') + ';this.Page=Page;', context);
  const page = new context.Page(), tabs = []; page.selectTab = id=>tabs.push(id); page.keeperBackRequest = 0;
  page.activeTab = 'keeper'; assert.equal(page.onBackPress(), true); assert.equal(page.keeperBackRequest, 1); assert.deepEqual(tabs, []);
  page.activeTab = 'cpa'; page.onBackPress(); assert.deepEqual(tabs, ['codex']);
  const credentials = source('services/ServiceCredentials.ets');
  const request = credentials.match(/private requestOpen\(\): void \{([^\n]+)\}/)[1];
  const panel = {active:true,busy:false,open:false,show(){this.open=true;}};
  const run = new Function(request);
  run.call(panel); assert.equal(panel.open, true);
  panel.open=false; panel.active=false; run.call(panel); assert.equal(panel.open, false);
  panel.active=true; panel.busy=true; run.call(panel); assert.equal(panel.open, false);
  assert.match(credentials, /credentialScopeMatches\(this.currentUrl, scope, this.configuredUrl\)/);
});
