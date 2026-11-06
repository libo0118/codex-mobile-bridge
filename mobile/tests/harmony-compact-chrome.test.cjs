const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');
const root = path.join(__dirname, '../harmony/entry/src/main/ets');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const strip = code => stripTypeScriptTypes(code.replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, ''), {mode:'strip'});
const ctx = vm.createContext({});
vm.runInContext(strip(read('services/MagpieUi.ets')) + ';this.script=magpieUiScript;',ctx);
const base = 'https://example.test/magpie/';

function magpie({href=base+'?view=usage',main=true,header=true,nav=true,disabled=false}={}) {
  const calls = [], styles = [];
  const button = name => ({disabled,click(){calls.push(name);}});
  const sync = button('refresh'), prefs = button('settings');
  const document = {
    querySelector(selector) {
      if (selector === '#nav') return nav ? {} : null;
      if (selector === 'body.web>header.top') return header ? {querySelector:s => s === 'button#sync' ? sync : s === 'button#prefs' ? prefs : null} : null;
      throw Error('Unexpected selector');
    },
    getElementById: () => styles[0], createElement: () => ({}), head:{appendChild:style=>styles.push(style)}
  };
  const sandbox = {location:{href},document,URL}; sandbox.window=sandbox; sandbox.top=main?sandbox:{};
  return {calls,styles,run:(action='',expected=href)=>vm.runInNewContext(ctx.script(expected,base,action),sandbox)};
}

test('Magpie native toolbar reuses original refresh/settings, never reloads or sends model requests',()=>{
  const p=magpie(); assert.equal(p.run(),'ready'); assert.equal(p.calls.length,0);
  assert.match(p.styles[0].textContent,/max-width:600px/);
  assert.match(p.styles[0].textContent,/body\.web>header\.top/);
  assert.doesNotMatch(p.styles[0].textContent,/#nav/);
  assert.equal(p.run('refresh'),'clicked'); assert.equal(p.run('settings'),'clicked');
  assert.deepEqual(p.calls,['refresh','settings']); assert.equal(p.styles.length,1);
  assert.equal(p.run('send'),'outside');
});

test('Magpie login, another path/origin, stale URL and child frames never lose their toolbar',()=>{
  for (const options of [{header:false},{nav:false},{href:'https://other.test/magpie/'},{href:'https://example.test/login/'},{main:false}]) {
    const p=magpie(options); assert.equal(p.run(),'outside'); assert.equal(p.styles.length,0); assert.deepEqual(p.calls,[]);
  }
  const p=magpie(); assert.equal(p.run('',base+'?view=providers'),'outside');
  const disabled=magpie({disabled:true}); assert.equal(disabled.run('refresh'),'unavailable'); assert.deepEqual(disabled.calls,[]);
});

test('all visible tabs share a flat 56vp row and CPA remains reachable from both Codex menus',()=>{
  const index=read('pages/Index.ets');
  const item=index.slice(index.indexOf('  private navigationItem('),index.indexOf('  private async upload('));
  assert.match(item,/\.height\(56\)/); assert.doesNotMatch(item,/activeTab === 'chat' \?/);
  const tabs=index.slice(index.lastIndexOf("this.navigationItem('codex', 'Codex')"));
  assert.match(tabs,/site\.enabled !== false && site\.id !== 'cpa'/);
  assert.match(tabs,/\.width\('100%'\)\.height\(56\)/);
  assert.doesNotMatch(tabs,/borderRadius\(999\)|NavigationChrome|maxWidth: 440|padding\(\{ top:/);
  assert.match(index,/private gatewayMenu\(\)[\s\S]*?content: 'CPA'[\s\S]*?this\.selectTab\('cpa'\)/);
  assert.match(index,/private computerMenu\(\)[\s\S]*?content: 'CPA'[\s\S]*?this\.selectTab\('cpa'\)/);
  assert.match(tabs,/chatInConversation\) \? Visibility\.None/);
});

test('CPA and other service switches retain existing Codex controllers and loaded Web instances',()=>{
  const index=read('pages/Index.ets');
  const method=index.slice(index.indexOf('  private selectTab('),index.indexOf('  private configureService('));
  const sandbox=vm.createContext({}); vm.runInContext(strip('class Page {'+method+'};this.Page=Page;'),sandbox);
  const page=new sandbox.Page(), gateway={controller:{reload(){throw Error('must not reload');}},draft:'retained'};
  const cpa={id:'cpa',url:'https://example.test/cpa/'}, keeper={id:'keeper',url:'https://example.test/keeper/'};
  Object.assign(page,{services:[cpa,keeper],loadedServices:[],gatewaySessions:[gateway],codexTop:'#ffffff',
    closeServiceConfig(){},events:{stop(){}},updateBars(){},startEvents(){},syncCodeyUi(){},configureService(){throw Error('configured already');}});
  page.selectTab('cpa'); const loaded=page.loadedServices; assert.equal(loaded[0],cpa);
  page.selectTab('codex'); page.selectTab('keeper'); page.selectTab('cpa');
  assert.equal(page.loadedServices.length,2); assert.equal(page.loadedServices[0],cpa);
  assert.equal(page.gatewaySessions[0],gateway); assert.equal(gateway.draft,'retained');
  assert.doesNotMatch(method,/loadUrl|\.refresh\(|\.reload\(|\.filter\(/);
});

test('native Magpie header keeps refresh/settings visible and moves return/credentials into its menu',()=>{
  const service=read('services/ServiceWeb.ets');
  const header=service.slice(service.indexOf('  private servicePage()'));
  assert.match(header,/this\.site\.id === 'magpie'[\s\S]*?service_header_refresh[\s\S]*?service_header_settings/);
  assert.match(header,/} else if \(this\.site\.id !== 'chat' \|\| !this\.chatReady\)/);
  assert.match(service,/private pageMenu\(\)[\s\S]*?this\.site\.id === 'magpie'[\s\S]*?content: '网页返回'[\s\S]*?content: '登录信息'/);
  assert.match(header,/this\.site\.id === 'chat' && this\.chatListHeader && !this\.chatMode/);
});
