const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');
const root = path.join(__dirname, '../harmony/entry/src/main/ets');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const strip = code => stripTypeScriptTypes(code.replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, ''), { mode: 'strip' });
const api = vm.createContext({});
vm.runInContext(strip(['security/GatewayURL.ets', 'web/CodeyUi.ets', 'web/DownloadScript.ets', 'web/DisplayStyle.ets', 'web/ProviderSwitcher.ets', 'web/WebScripts.ets'].map(read).join('\n')) +
  '\nthis.api = { newConnectionURL, connectionURL, gatewayConnection, serviceURL, sameGateway, isPreviewShell, validPrompt, CodeyUiState, decodeCodeyUiState, codeyUiScript, codeyUiActionScript, webString, mobileScript, BACK_SCRIPT };', api);
const s = api.api, url = 'https://gateway.example/';

test('only new bare LAN hosts default to 18787; explicit URLs, ports and public HTTPS retain their meaning', async () => {
  for (const [input, expected] of [
    [' localhost ', 'http://localhost:18787/'], ['127.0.0.1', 'http://127.0.0.1:18787/'], ['192.168.0.2', 'http://192.168.0.2:18787/'],
    ['[::1]', 'http://[::1]:18787/'], ['localhost:8765', 'http://localhost:8765/'], ['gateway.example', url],
    ['gateway.example:8443', 'https://gateway.example:8443/'], ['http://localhost', 'http://localhost/'],
    ['http://localhost:8765/', 'http://localhost:8765/'], ['https://localhost/', 'https://localhost/'],
    [url + '#pair=' + 'a'.repeat(43), url + '#pair=' + 'a'.repeat(43)]
  ]) assert.equal(s.newConnectionURL(input), expected, input);
  for (const value of ['', '//localhost', 'http://gateway.example', 'localhost:0', 'localhost:65536', 'user:secret@localhost', 'localhost/?token=secret']) {
    assert.throws(() => s.newConnectionURL(value), undefined, value);
  }
  const saved = [{base:'http://localhost:8765',name:'Existing LAN',opened:2}, {base:'https://gateway.example',name:'Existing HTTPS',opened:1}];
  const preferences = { getPreferences: async () => ({get: async () => JSON.stringify(saved), put: async () => { throw Error('must not migrate'); }}) };
  const storeScope = vm.createContext({preferences, gatewayConnection:s.gatewayConnection});
  vm.runInContext(strip(read('data/ComputerStore.ets')) + '\nthis.store = new ComputerStore();', storeScope);
  assert.deepEqual(JSON.parse(JSON.stringify(await storeScope.store.load({}))), saved);
  assert.equal(s.serviceURL('https://gateway.example:8443/keeper/'), 'https://gateway.example:8443/keeper/');
  assert.equal(s.serviceURL('https://gateway.example/cpa/'), 'https://gateway.example/cpa/');
  assert.equal(s.serviceURL('https://gateway.example/magpie/'), 'https://gateway.example/magpie/');
});

function element(tag = 'DIV', textContent = '', attrs = {}) {
  const queries = new Map(), classes = new Set();
  return {tagName:tag, textContent, isConnected:true, disabled:false, checked:false, attrs:{...attrs}, children:[], queries,
    classList:{contains:name=>classes.has(name), add:name=>classes.add(name), remove:name=>classes.delete(name)},
    getAttribute(name) { return this.attrs[name] ?? null; }, setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; },
    querySelector(selector) { return queries.get(selector)?.[0]; }, querySelectorAll(selector) { return queries.get(selector) || []; },
    closest(selector) { return selector === 'label' ? this.label : selector === '[hidden]' && this.panel ? this : undefined; },
    matches(selector) { return selector === 'input' ? tag === 'INPUT' : selector === 'input[type="checkbox"]' ? tag === 'INPUT' && attrs.type === 'checkbox' : selector === 'button[aria-pressed]' && tag === 'BUTTON' && this.getAttribute('aria-pressed') !== null; }
  };
}

function page({checkbox = false, ack = true, sheet = true, frame = false, href = url, failRule = -1} = {}) {
  const doc = element(), workspace = element(), list = element('ASIDE'), footer = element('FOOTER'), heading = element(), host = element();
  const title = element('H1', 'Codex'), search = element('BUTTON'), create = element('BUTTON'), paired = element('SPAN', '已配对'), back = element('BUTTON');
  const archive = checkbox ? element('INPUT', '', {type:'checkbox'}) : element('BUTTON', '归档会话', {'aria-pressed':'false'});
  archive.label = element('LABEL', '归档会话');
  const consoleButton = element('BUTTON', 'Codey 控制台'), logout = element('BUTTON', '', {'aria-label':'退出此设备'});
  const clicks = [], states = [], rules = [], timers = new Map(), observers = [], listeners = new Map(); let timer = 0;
  const map = (node, selector, values) => node.queries.set(selector, values);
  map(doc, '.remote-shell .remote-codex-workspace', [workspace]); map(workspace, ':scope > .remote-thread-list', [list]);
  map(list, ':scope > .remote-sidebar-footer', [footer]); map(footer, 'button,input,a,select', [archive,consoleButton,logout]);
  map(list, ':scope > .remote-list-heading', [heading]); map(list, ':scope > .remote-host', [host]); map(list, ':scope > .remote-navigation', [element()]);
  map(heading, ':scope > h1', [title]); map(heading, ':scope > button[aria-label="搜索会话"]', [search]); map(heading, ':scope > button[aria-label="新建会话"]', [create]);
  map(host, ':scope > span', [element('SPAN','本地电脑'),paired]); map(host, ':scope > .remote-paired', [paired]); heading.children = [title,search,create];
  map(workspace, '.remote-chat-header > button.remote-back[aria-label="返回会话列表"]', [back]);
  archive.click = () => { clicks.push('archive'); if (checkbox) archive.checked = !archive.checked; else archive.setAttribute('aria-pressed', String(archive.getAttribute('aria-pressed') !== 'true')); };
  consoleButton.click = () => { clicks.push('console'); workspace.panel = true; };
  logout.click = () => { clicks.push('logout'); map(doc, '.remote-shell .remote-codex-workspace', []); };
  back.click = () => { clicks.push('back'); workspace.classList.remove('has-selection'); };
  doc.body = element('BODY'); doc.documentElement = element('HTML'); doc.addEventListener = (name, fn) => listeners.set(name, fn);
  doc.getElementById = id => id === 'root' ? doc.body : undefined;
  doc.styleSheets = sheet ? [{href:url + 'app.css', cssRules:rules, insertRule(rule,index) { if (index === failRule) throw Error('CSS unsupported'); rules.splice(index,0,rule); }, deleteRule:index=>rules.splice(index,1)}] : [];
  const location = {href, get origin() { return new URL(this.href).origin; }};
  const context = vm.createContext({URL, document:doc, location, requestAnimationFrame:fn=>{timers.set(++timer,fn);return timer;},
    MutationObserver:class { constructor(fn) { this.callback = fn; observers.push(this); } observe() {} },
    prompt:(command,value)=>{ assert.equal(command,'codexbridge-codey-ui:token'); states.push(JSON.parse(value)); return ack ? 'saved' : null; },
    addEventListener:(name,fn)=>listeners.set(name,fn)});
  context.window = context; context.top = frame ? {} : context;
  const run = () => vm.runInContext(s.codeyUiScript(url,'token'),context);
  const flush = (timestamp = 1234) => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn=>fn(timestamp)); };
  const action = command => vm.runInContext(s.codeyUiActionScript(url,command),context);
  return {doc,workspace,list,footer,heading,archive,consoleButton,logout,back,clicks,states,rules,observers,listeners,context,run,flush,action,pending:()=>timers.size};
}

test('Codey host compacts only after native acknowledgement, without moving React nodes or executing actions', () => {
  const h = page(); h.run();
  assert.equal(h.states.at(-1).supported, true); assert.equal(h.states.at(-1).chat, false);
  assert.equal(h.footer.getAttribute('data-hos-codey-footer'), ''); assert.equal(h.workspace.getAttribute('data-hos-codey-header'), '');
  assert.deepEqual(h.heading.children.map(node=>node.tagName), ['H1','BUTTON','BUTTON']); assert.deepEqual(h.clicks, []);
  assert.ok(h.rules.some(rule=>rule.includes('.remote-host') && rule.includes('grid-area:1/2')));
  assert.ok(h.rules.some(rule=>rule.includes('新建会话') && rule.includes('grid-area:1/4')));
  assert.ok(h.rules.every(rule=>!rule.includes('composer')), 'keep the existing textarea, single toolbar and popovers untouched');
  const count = h.rules.length; h.run(); assert.equal(h.observers.length,1); assert.equal(h.rules.length,count); assert.equal(h.states.length,2);
  const rejected = page({ack:false}); rejected.run(); assert.equal(rejected.footer.getAttribute('data-hos-codey-footer'), null);
});

test('the production Harmony injection reaches a Codey React root without changing the shared mobile scripts', () => {
  const h = page(); vm.runInContext(s.mobileScript('', 'token', url), h.context);
  assert.equal(h.footer.getAttribute('data-hos-codey-footer'),''); assert.deepEqual(h.clicks,[]);
  const gateway = page(); gateway.doc.getElementById = () => undefined;
  vm.runInContext(s.mobileScript('', 'token', url), gateway.context);
  assert.equal(gateway.context.__bridgeHarmonyCodeyUi,undefined); assert.equal(gateway.observers.length,0);
});

test('native actions click only the current original archive checkbox/button, console and device logout', () => {
  for (const checkbox of [false,true]) {
    const h = page({checkbox}); h.run(); assert.deepEqual(h.clicks,[]);
    assert.equal(h.action('archive'),'clicked'); h.flush(); assert.equal(h.states.at(-1).archived,true);
    assert.deepEqual(h.clicks,['archive']); assert.equal(h.action('console'),'clicked'); h.flush();
    assert.equal(h.states.at(-1).canConsole,false); assert.equal(h.states.at(-1).chat,false);
    assert.equal(h.action('archive'),'unavailable'); assert.equal(h.action('logout'),'clicked'); h.flush();
    assert.deepEqual(h.clicks,['archive','console','logout']); assert.equal(h.states.at(-1).supported,false);
    assert.equal(h.footer.getAttribute('data-hos-codey-footer'),null);
  }
});

test('chat/list transitions preserve a back path and disabled back consumes system return without leaving the Web', () => {
  const h = page(); h.run(); h.workspace.classList.add('has-selection'); h.context.__bridgeHarmonyCodeyUi.sync();
  assert.equal(h.states.at(-1).chat,true); assert.equal(h.states.at(-1).canBack,true);
  assert.ok(h.rules.some(rule=>rule.includes('@media (max-width:760px)') && rule.includes('[data-hos-codey-header].has-selection > .remote-thread-list { display:none; }')),
    'compact grid must not override the original narrow-screen chat/list visibility');
  h.back.disabled = true; assert.equal(vm.runInContext(s.BACK_SCRIPT,h.context),true); assert.deepEqual(h.clicks,[]);
  h.back.disabled = false; assert.equal(h.action('back'),'clicked'); h.flush();
  assert.equal(h.states.at(-1).chat,false); assert.deepEqual(h.clicks,['back']);
});

test('unknown controls, missing sheets or CSS failure preserve the original UI; unknown headings are not rearranged', () => {
  for (const options of [{sheet:false},{failRule:2}]) {
    const h = page(options); h.run(); assert.equal(h.states.at(-1).supported,false); assert.equal(h.rules.length,0);
    assert.equal(h.footer.getAttribute('data-hos-codey-footer'),null);
  }
  const h = page(); h.run(); h.heading.children.push(element('BUTTON','Unknown')); h.context.__bridgeHarmonyCodeyUi.sync();
  assert.equal(h.workspace.getAttribute('data-hos-codey-header'),null); assert.equal(h.footer.getAttribute('data-hos-codey-footer'),'');
  h.footer.queries.get('button,input,a,select').push(element('BUTTON','Unknown')); h.context.__bridgeHarmonyCodeyUi.sync();
  assert.equal(h.states.at(-1).supported,false); assert.equal(h.footer.getAttribute('data-hos-codey-footer'),null); assert.equal(h.action('logout'),'unavailable');
});

test('main-frame, exact target and static action allowlist reject stale navigation and injected commands', () => {
  for (const options of [{frame:true},{href:'https://other.example/'},{href:url + 'other'}]) {
    const h = page(options); assert.equal(h.run(),'changed'); assert.equal(h.observers.length,0); assert.deepEqual(h.clicks,[]);
  }
  const h = page(); h.run();
  assert.equal(h.action('logout"); throw Error("injected"); //'),'unavailable');
  h.context.location.href = url + 'other'; assert.equal(h.action('logout'),'changed'); assert.equal(h.context.__bridgeHarmonyCodeyUi.action('logout'),'changed');
  assert.deepEqual(h.clicks,[]); assert.equal(h.states.at(-1).supported,false);
});

test('streamed transcript text does not poll native menu state; changed footer labels still restore the original controls', () => {
  const h = page(); h.run();
  h.observers[0].callback([{target:{nodeType:3,parentElement:{closest:()=>({})}}}]); assert.equal(h.pending(),0);
  h.consoleButton.textContent = 'Unknown tool'; h.observers[0].callback([{target:{nodeType:3,parentElement:h.footer}}]);
  assert.equal(h.pending(),1); h.flush(); assert.equal(h.states.at(-1).supported,false); assert.equal(h.footer.getAttribute('data-hos-codey-footer'),null);
});

test('page-state payload is boolean-only; new native prompt keeps the token and source boundaries', () => {
  const valid = {...new s.CodeyUiState(), supported:true, chat:true};
  assert.equal(s.decodeCodeyUiState(JSON.stringify(valid)).chat,true);
  for (const value of ['', 'null', '[]', '{', JSON.stringify({...valid,chat:'true'}), JSON.stringify({...valid,supported:false}), 'x'.repeat(513)]) assert.equal(s.decodeCodeyUiState(value),undefined);
  assert.equal(s.validPrompt('codexbridge-codey-ui:token','token',url,url,url.slice(0,-1)),'codey-ui');
  for (const [token,source,current] of [['old',url,url],['token','https://other.example/',url],['token',url,url+'html-preview-shell']]) {
    assert.equal(s.validPrompt('codexbridge-codey-ui:'+token,'token',source,current,url.slice(0,-1)),'');
  }
});

const index = read('pages/Index.ets');
const dockExpression = index.slice(index.indexOf("}.width('100%').justifyContent(FlexAlign.Center).padding({ top: this.activeTab === 'chat' ? 2 : 12"))
  .match(/\.visibility\(([\s\S]*?)\)\r?\n/)[1];
const promptMethod = index.match(/  private prompt\(event: OnPromptEvent\): boolean \{[\s\S]*?\n  \}/)[0];
vm.runInContext(strip('class NativePrompt {\n'+promptMethod+'\n}\nthis.NativePrompt = NativePrompt;'),api);
test('native state acknowledgement rejects a mismatched prompt source and malformed payload before changing the dock', () => {
  const native = new api.NativePrompt(), replies = [];
  const state = {...new s.CodeyUiState(),supported:true,chat:true};
  Object.assign(native,{foreground:true,connected:true,activeTab:'codex',token:'token',base:url.slice(0,-1),currentURL:()=>url,codeyUi:new s.CodeyUiState()});
  const event = {message:'codexbridge-codey-ui:token',url,value:JSON.stringify(state),result:{handlePromptConfirm:value=>replies.push(value),handleCancel:()=>replies.push('cancel')}};
  assert.equal(native.prompt(event),true); assert.equal(native.codeyUi.chat,true); assert.deepEqual(replies,['saved']);
  native.codeyUi = new s.CodeyUiState();
  for (const changed of [{url:url+'other'},{url:'https://other.example/'},{message:'codexbridge-codey-ui:old'},{value:'{"chat":true}'}]) {
    native.prompt({...event,...changed}); assert.equal(native.codeyUi.chat,false); assert.equal(replies.at(-1),'cancel');
  }
  native.activeTab = 'keeper'; native.prompt(event); assert.equal(native.codeyUi.chat,false); assert.equal(replies.at(-1),'cancel');
});

const menuMethods = index.slice(index.indexOf('  private captureGatewayMenu()'),index.indexOf('  onBackPress()'));
vm.runInContext(strip('class NativeMenu {\n'+menuMethods+'\n}\nthis.NativeMenu = NativeMenu;'),api);
test('native menu captures the open target and rejects changed generations, origins, inactive tabs and unavailable pages', async () => {
  const calls = [], native = new api.NativeMenu();
  Object.assign(native,{foreground:true,connected:true,activeTab:'codex',codeyUi:{supported:true},generation:3,base:url.slice(0,-1),controller:{runJavaScript:async script=>{calls.push(script); return '"clicked"';}}, currentURL:()=>url});
  native.captureGatewayMenu(); await native.openCodeyControl('archive'); assert.equal(calls.length,1);
  for (const changed of [{generation:4},{currentURL:()=>url+'other'},{currentURL:()=>'https://other.example/'},{activeTab:'keeper'},{foreground:false},{codeyUi:{supported:false}}]) {
    const original = Object.fromEntries(Object.keys(changed).map(key=>[key,native[key]])); Object.assign(native,changed);
    await native.openCodeyControl('logout'); assert.equal(calls.length,1); Object.assign(native,original);
  }
  assert.match(index,/查看归档会话[^\n]+\.selected\(this\.codeyUi\.archived\)\.selectIcon\(true\)/);
  assert.match(index,/bindMenu\(this\.gatewayMenu, \{ onAppear:.*captureGatewayMenu/);
  const visible = new Function('Visibility','return '+dockExpression);
  Object.assign(native,{activeTab:'codex',connected:true,codeyUi:{chat:true}}); assert.equal(visible.call(native,{None:'none',Visible:'visible'}),'none');
  native.codeyUi.chat = false; assert.equal(visible.call(native,{None:'none',Visible:'visible'}),'visible');
  native.codeyUi.chat = true; native.activeTab='keeper'; assert.equal(visible.call(native,{None:'none',Visible:'visible'}),'visible');
  native.activeTab='chat'; native.chatInConversation=true; native.configId='';
  assert.equal(visible.call(native,{None:'none',Visible:'visible'}),'none');
  native.chatInConversation=false; assert.equal(visible.call(native,{None:'none',Visible:'visible'}),'visible');
  native.chatInConversation=true; native.configId='chat'; assert.equal(visible.call(native,{None:'none',Visible:'visible'}),'visible');
});

const componentLogic = index.slice(0,index.indexOf('  @Builder')).replace(/@\w+(?:\([^()\n]*\))?\s*/g,'').replace('struct Index','class Index') + '\n}';
Object.assign(api,{getContext:()=>({}),DEFAULT_DOWNLOAD_LIMIT_MIB:200,ComputerStore:class {},ServiceStore:class {},ForegroundEvents:class {},webview:{WebviewController:class {}}});
vm.runInContext(strip(componentLogic)+'\nthis.NativePage = Index;',api);
const dockVisibility = new Function('Visibility','return '+dockExpression);
const dock = native => dockVisibility.call(native,{None:'hidden',Visible:'visible'});

function nativePage(h) {
  const native = new api.NativePage(), requests = [], replies = [];
  const controller = {getUrl:()=>h.context.location.href,runJavaScript:async script=>{requests.push(script);return JSON.stringify(vm.runInContext(script,h.context));},
    refresh:()=>assert.fail('tab/foreground restore must not reload the Web'),loadUrl:()=>assert.fail('tab/foreground restore must not navigate the Web')};
  Object.assign(native,{foreground:true,connected:true,activeTab:'codex',token:'token',base:url.slice(0,-1),generation:3,scripts:'',controller,
    services:['keeper','cpa','magpie'].map(id=>({id,name:id,url:'https://services.example/'+id+'/'})),
    events:{start(){},stop(){}},updateBars(){},flushCookies(){}});
  h.context.prompt = (message,value) => {
    h.states.push(JSON.parse(value)); let reply = null;
    native.prompt({message,value,url:h.context.location.href,result:{handlePromptConfirm:value=>{reply=value;},handleCancel(){}}});
    replies.push(reply); return reply;
  };
  return {native,controller,requests,replies};
}

test('returning from Keeper refreshes rejected background list state without any new DOM mutation or Web reload', async () => {
  const h = page(), {native,controller,replies} = nativePage(h);
  const body = h.doc.body, context = h.context, composer = element('TEXTAREA'), messages = element();
  composer.value = 'unsent draft'; messages.scrollTop = 129.7;
  h.doc.queries.set('.remote-composer-dock textarea',[composer]); h.doc.queries.set('.remote-messages',[messages]);
  h.workspace.classList.add('has-selection'); h.run();
  assert.equal(dock(native),'hidden');
  native.selectTab('keeper'); h.workspace.classList.remove('has-selection'); h.context.__bridgeHarmonyCodeyUi.sync();
  assert.equal(replies.at(-1),null); assert.equal(native.codeyUi.chat,true); assert.equal(h.footer.getAttribute('data-hos-codey-footer'),null);
  const notifications = h.states.length;
  native.selectTab('codex'); await new Promise(setImmediate);
  assert.equal(native.codeyUi.chat,false); assert.equal(native.codeyUi.supported,true); assert.equal(dock(native),'visible');
  assert.ok(h.states.length > notifications); assert.equal(h.footer.getAttribute('data-hos-codey-footer'),'');
  assert.equal(native.controller,controller); assert.equal(h.context,context); assert.equal(h.doc.body,body);
  assert.equal(h.doc.querySelector('.remote-composer-dock textarea'),composer); assert.equal(composer.value,'unsent draft');
  assert.equal(h.doc.querySelector('.remote-messages'),messages); assert.equal(messages.scrollTop,129.7); assert.deepEqual(h.clicks,[]);
});

test('foreground restore refreshes rejected page state through the same foreground-only native bridge', async () => {
  for (const loggedOut of [false,true]) {
    const h = page(), {native,replies} = nativePage(h);
    h.workspace.classList.add('has-selection'); h.run(); assert.equal(dock(native),'hidden');
    native.foreground = false; native.foregroundChanged();
    if (loggedOut) h.doc.queries.set('.remote-shell .remote-codex-workspace',[]);
    else h.workspace.classList.remove('has-selection');
    h.context.__bridgeHarmonyCodeyUi.sync();
    assert.equal(replies.at(-1),null); assert.equal(native.codeyUi.chat,true);
    native.foreground = true; native.foregroundChanged(); await new Promise(setImmediate);
    assert.equal(native.codeyUi.chat,false); assert.equal(native.codeyUi.supported,!loggedOut); assert.equal(dock(native),'visible');
    assert.equal(replies.at(-1),'saved'); assert.equal(h.footer.getAttribute('data-hos-codey-footer'),loggedOut ? null : '');
  }
});

test('returning from CPA or Magpie after logout or unknown controls cannot keep a stale chat dock or hide original tools', async () => {
  for (const id of ['cpa','magpie']) {
    const h = page(), {native,replies} = nativePage(h);
    h.workspace.classList.add('has-selection'); h.run(); native.selectTab(id);
    if (id === 'cpa') h.doc.queries.set('.remote-shell .remote-codex-workspace',[]);
    else h.consoleButton.textContent = 'Unknown tool';
    h.context.__bridgeHarmonyCodeyUi.sync();
    assert.equal(replies.at(-1),null); assert.equal(native.codeyUi.chat,true);
    native.selectTab('codex'); await new Promise(setImmediate);
    assert.equal(replies.at(-1),'saved'); assert.equal(native.codeyUi.supported,false); assert.equal(dock(native),'visible');
    assert.equal(h.footer.getAttribute('data-hos-codey-footer'),null); assert.deepEqual(h.clicks,[]);
  }
});

test('a page finishing for the first time on another tab recovers its rejected initial notification on return', async () => {
  for (const id of ['keeper','cpa','magpie']) {
    const h = page(), {native,replies,requests} = nativePage(h);
    h.workspace.classList.add('has-selection'); native.selectTab(id);
    await native.pageFinished(url);
    assert.equal(replies.at(-1),null); assert.equal(native.codeyUi.supported,false); assert.equal(h.footer.getAttribute('data-hos-codey-footer'),null);
    const observer = h.observers[0], adapter = h.context.__bridgeHarmonyCodeyUi;
    native.selectTab('codex'); await new Promise(setImmediate);
    assert.equal(replies.at(-1),'saved'); assert.equal(native.codeyUi.chat,true); assert.equal(dock(native),'hidden');
    assert.equal(h.footer.getAttribute('data-hos-codey-footer'),''); assert.equal(requests.length,2);
    assert.equal(h.context.__bridgeHarmonyCodeyUi,adapter); assert.equal(h.observers.length,1); assert.equal(h.observers[0],observer);
  }
});

test('a native reset with the same cached signature forces a notification, while animation-frame timestamps do not', async () => {
  const h = page(), {native} = nativePage(h);
  h.workspace.classList.add('has-selection'); h.run(); const notifications = h.states.length;
  native.codeyUi = new s.CodeyUiState();
  h.listeners.get('resize')(); h.flush(9876);
  assert.equal(h.states.length,notifications); assert.equal(native.codeyUi.chat,false, 'ordinary sync cannot repair a native reset');
  native.selectTab('keeper'); native.selectTab('codex'); await new Promise(setImmediate);
  assert.equal(h.states.length,notifications+1); assert.equal(native.codeyUi.chat,true); assert.equal(dock(native),'hidden');
});

test('return refresh binds the current full URL and token without replacing the existing page adapter', async () => {
  const h = page(), {native,replies} = nativePage(h); h.run();
  const adapter = h.context.__bridgeHarmonyCodeyUi;
  native.selectTab('keeper'); h.context.location.href = url+'#current-thread'; native.token = 'current-token'; native.generation++;
  h.workspace.classList.add('has-selection');
  native.selectTab('codex'); await new Promise(setImmediate);
  assert.equal(replies.at(-1),'saved'); assert.equal(native.codeyUi.chat,true); assert.equal(h.context.__bridgeHarmonyCodeyUi,adapter);
  assert.equal(h.action('logout'),'changed'); assert.deepEqual(h.clicks,[]);
  h.workspace.classList.remove('has-selection'); adapter.sync();
  assert.equal(replies.at(-1),'saved'); assert.equal(native.codeyUi.chat,false);
});

test('restore fails safely for an unavailable page, a subframe or a rejected native bridge', async () => {
  for (const failure of ['unavailable','frame','rejected','script error']) {
    const h = page(), {native} = nativePage(h);
    h.workspace.classList.add('has-selection'); h.run(); native.selectTab('keeper');
    if (failure === 'unavailable') { delete h.context.__bridgeHarmonyCodeyUi; h.doc.getElementById = () => undefined; }
    if (failure === 'frame') h.context.top = {};
    if (failure === 'rejected') h.context.prompt = () => null;
    if (failure === 'script error') native.controller.runJavaScript = async () => { throw Error('ArkWeb failure'); };
    native.selectTab('codex'); await new Promise(setImmediate);
    assert.equal(native.codeyUi.supported,false); assert.equal(dock(native),'visible'); assert.deepEqual(h.clicks,[]);
    if (failure === 'script error') assert.match(native.status,/页面适配失败/);
  }
});

test('restore does not inject into inactive, disconnected, untrusted or preview pages', async () => {
  for (const changed of [{foreground:false},{connected:false},{activeTab:'keeper'},{token:''},
    {currentURL:()=> 'https://other.example/'},{currentURL:()=>url+'html-preview-shell'}]) {
    const h = page(), {native,requests} = nativePage(h); Object.assign(native,changed);
    await native.syncCodeyUi(); assert.equal(requests.length,0); assert.equal(native.codeyUi.supported,false);
  }
  const h = page(), {native,requests} = nativePage(h);
  native.selectTab('keeper'); native.foreground = false; native.foregroundChanged(); native.foreground = true; native.foregroundChanged();
  await new Promise(setImmediate); assert.equal(requests.length,0);
});

test('queued restore scripts still reject changed targets, tokens and background tabs before updating native state', async () => {
  for (const changed of ['target','token','tab','foreground']) {
    const h = page(), {native,replies} = nativePage(h); let script;
    native.controller.runJavaScript = async value => { script = value; return '"ready"'; };
    await native.syncCodeyUi();
    if (changed === 'target') h.context.location.href = url+'other';
    if (changed === 'token') { native.token = 'new-token'; native.generation++; }
    if (changed === 'tab') native.selectTab('keeper');
    if (changed === 'foreground') { native.foreground = false; native.foregroundChanged(); }
    vm.runInContext(script,h.context);
    assert.equal(native.codeyUi.supported,false); assert.equal(dock(native),'visible'); assert.deepEqual(h.clicks,[]);
    if (changed === 'target') assert.equal(replies.length,0); else assert.equal(replies.at(-1),null);
  }
});

test('an old restore failure cannot overwrite a newer navigation or inactive target', async () => {
  for (const changed of [{generation:4},{token:'new-token'},{currentURL:()=>url+'other'},{activeTab:'keeper'},{foreground:false},{connected:false}]) {
    const h = page(), {native} = nativePage(h); let reject;
    native.controller.runJavaScript = () => new Promise((_,fail)=>{reject=fail;});
    const pending = native.syncCodeyUi(); Object.assign(native,changed);
    const current = native.codeyUi = {...new s.CodeyUiState(),supported:true,chat:true}; native.status = 'new page status';
    reject(Error('late ArkWeb failure')); await pending;
    assert.equal(native.codeyUi,current); assert.equal(native.status,'new page status');
  }
});
