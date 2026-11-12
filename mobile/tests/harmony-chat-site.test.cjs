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

test('loading legacy Chat preferences never rewrites or deletes the saved record', async () => {
  for (const enabled of [true,false]) {
    const saved=JSON.stringify({name:'Saved Chat',url:'https://example.test/chat/?view=plugin-chat',enabled});
    const h=sites({chat:saved}), before=[...h.records];
    const chat=(await h.store.load({})).find(site=>site.id==='chat');
    assert.equal(chat.name,'Saved Chat'); assert.equal(chat.enabled,enabled);
    assert.equal(chat.url,'https://example.test/chat/?view=plugin-chat');
    assert.deepEqual([...h.records],before);
  }
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
vm.runInContext(strip(source('services/ChatUi.ets')) + '\nthis.api = { chatUiScript, chatUiActionScript };', context);
const { chatUiScript, chatUiActionScript } = context.api;
const token = 'a'.repeat(32);

function page(start, expected = start, { initial = true, mainFrame = true, nav = true, frame = false, button = false, activated = false } = {}) {
  const calls = { clicks: 0, observers: [], timers: new Map(), listeners: new Map(), windowListeners: new Map(), styles: [], messages: [], prompts: [] };
  let href = start, hasFrame = frame, hasButton = button, timerID = 0, random = 0, accepted = true, selected = true, hidden = false;
  const frameListeners = new Map();
  const contentWindow = { postMessage(message, origin) { calls.messages.push({message, origin}); } };
  const frameNode = { contentWindow, sandbox:'allow-scripts', getAttribute: name => name === 'sandbox' ? frameNode.sandbox : null,
    addEventListener: (name, fn) => frameListeners.set(name, fn), removeEventListener: name => frameListeners.delete(name) };
  const attrs = new Map();
  const location = { get href() { return href; }, get search() { return new URL(href).search; }, get hash() { return new URL(href).hash; } };
  const document = {
    documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k) },
    body: {}, head: { appendChild: node => calls.styles.push(node) },
    createElement: tag => ({ tag, id: '', textContent: '' }),
    querySelector(selector) {
      if (selector === '#nav') return nav ? {} : null;
      if (selector === '#view-plugin-chat') return {hidden};
      if (selector === '#nav button[data-view="plugin-chat"][data-plugin-page][aria-current="page"]') return selected ? {} : null;
      if (selector === '#view-plugin-chat>iframe.plugin-frame') return hasFrame ? frameNode : null;
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
    crypto: { getRandomValues(bytes) { bytes.fill(++random); return bytes; } },
    prompt: (message, value) => { calls.prompts.push({message, value}); return accepted ? 'saved' : null; },
    addEventListener: (name, fn) => calls.windowListeners.set(name, fn),
    setTimeout: (fn, ms) => { fn.ms = ms; calls.timers.set(++timerID, fn); return timerID; }, clearTimeout: id => calls.timers.delete(id) };
  sandbox.window = sandbox; sandbox.top = mainFrame ? sandbox : {};
  vm.createContext(sandbox);
  return { calls, attrs, sandbox, contentWindow, frameNode, frameListeners, run: (currentToken = token) => vm.runInContext(chatUiScript(expected, defaultURL, initial, currentToken), sandbox),
    href(value) { href = value; }, frame(value) { hasFrame = value; }, button(value) { hasButton = value; },
    selected(value) { selected = value; }, hidden(value) { hidden = value; },
    accept(value) { accepted = value; },
    message(data, overrides = {}) { calls.windowListeners.get('message')({data, origin:'null', source:contentWindow, ...overrides}); },
    action(action, currentToken = token) { return vm.runInContext(chatUiActionScript(href, currentToken, action), sandbox); },
    sync() { calls.observers[0].callback(); } };
}

test('actual injected host script handles delayed plugin registration once and preserves navigation', () => {
  const usage = 'https://libo.siasunagv.cn/magpie/?view=usage', p = page(usage);
  assert.equal(p.run(), 'ready'); assert.equal(p.calls.clicks, 0); assert.equal(p.attrs.has('data-bridge-chat'), false);
  p.button(true); p.sync(); assert.equal(p.calls.clicks, 1); assert.equal(p.calls.timers.size, 0);
  p.frame(true); p.sync(); assert.equal(p.attrs.has('data-bridge-chat'), true);
  assert.match(p.calls.styles[0].textContent, /#view-plugin-chat>iframe\.plugin-frame/);
  assert.match(p.calls.styles[0].textContent, /html\[data-bridge-chat\] body\.web>header\.top/);
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

test('delayed initial fallback never clicks after the current native token is rejected', () => {
  const usage = 'https://libo.siasunagv.cn/magpie/?view=usage', p = page(usage);
  p.accept(false); p.run(); p.button(true); p.sync(); assert.equal(p.calls.clicks,0);
  p.accept(true); p.sync(); assert.equal(p.calls.clicks,1);
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
  assert.equal(chatUiScript(defaultURL, 'https://example.test/', true, token), '"outside"');
});

test('iframe handoff accepts only the current opaque frame and nonce, and forwards only UI intentions', () => {
  const p = page(defaultURL, defaultURL, {frame:true}); assert.equal(p.run(), 'ready');
  const bind = p.calls.messages[0]; assert.equal(bind.origin, '*');
  assert.equal(bind.message.action, 'bind'); assert.equal(bind.message.nativeNavigation, false);
  assert.match(bind.message.nonce, /^[0-9a-f]{32}$/);
  assert.equal(p.calls.prompts.at(-1).value, 'list');
  const mode = {type:'bridge-chat-ui', v:1, nonce:bind.message.nonce, mode:'chat'};
  const count = p.calls.prompts.length;
  for (const [data, options] of [
    [mode, {source:{}}], [mode, {origin:'https://libo.siasunagv.cn'}],
    [{...mode,nonce:'f'.repeat(32)}, {}], [{...mode,v:2}, {}], [{...mode,mode:'other'}, {}],
    [{...mode,id:'secret'}, {}], [null, {}]
  ]) p.message(data, options);
  assert.equal(p.calls.prompts.length, count);
  p.message(mode); assert.equal(p.calls.prompts.at(-1).value, 'chat');
  assert.equal(p.calls.messages.at(-1).message.nativeNavigation, true);
  const after = p.calls.messages.length; p.message(mode);
  assert.equal(p.calls.messages.length, after, 'acknowledgement does not cause a bind loop');
  assert.equal(p.action('back'), 'sent');
  assert.equal(p.calls.messages.at(-1).message.action, 'back');
  assert.equal(p.calls.timers.size, 1);
  p.message({...mode,mode:'list'}); assert.equal(p.calls.timers.size, 0);
  assert.equal(p.calls.prompts.at(-1).value, 'list');
  assert.equal(p.action('settings'), 'sent'); p.message({...mode,mode:'list'});
  assert.equal(p.action('send'), 'unavailable');
  assert.ok(p.calls.messages.every(({message,origin}) => origin === '*' && !JSON.stringify(message).includes(token)));
  assert.ok(p.calls.prompts.every(({message}) => message === 'bridge-chat-ui:' + token));
});

test('rejected or lost native acknowledgement restores child navigation and stale frames cannot hide the dock', () => {
  const p = page(defaultURL, defaultURL, {frame:true}); p.accept(false); p.run();
  let nonce = p.calls.messages.at(-1).message.nonce;
  p.message({type:'bridge-chat-ui',v:1,nonce,mode:'chat'});
  assert.equal(p.calls.messages.at(-1).message.nativeNavigation, false);
  assert.equal(p.action('back'), 'unavailable');
  p.accept(true); p.message({type:'bridge-chat-ui',v:1,nonce,mode:'chat'});
  assert.equal(p.calls.messages.at(-1).message.nativeNavigation, true);
  assert.equal(p.action('back'), 'sent');
  const watchdog = [...p.calls.timers.values()].find(fn => fn.ms === 1500); assert.ok(watchdog); watchdog();
  assert.equal(p.calls.prompts.at(-1).value, 'list');
  assert.equal(p.calls.messages.at(-1).message.nativeNavigation, false);
  assert.equal(p.action('back'), 'unavailable');
  const failed = p.calls.prompts.length;
  p.message({type:'bridge-chat-ui',v:1,nonce,mode:'chat'});
  assert.equal(p.calls.prompts.length,failed, 'a bind(false) echo cannot immediately hide the dock again');
  p.message({type:'bridge-chat-ui',v:1,nonce,mode:'list'});
  assert.equal(p.calls.messages.at(-1).message.nativeNavigation,true, 'manual return to list allows a fresh handoff');
  p.frameListeners.get('load')();
  const next = p.calls.messages.at(-1).message.nonce; assert.notEqual(next, nonce);
  const count = p.calls.prompts.length;
  p.message({type:'bridge-chat-ui',v:1,nonce,mode:'chat'});
  assert.equal(p.calls.prompts.length, count);
  nonce = next; p.message({type:'bridge-chat-ui',v:1,nonce,mode:'chat'});
  p.href('https://libo.siasunagv.cn/magpie/?view=usage'); p.sync();
  assert.equal(p.attrs.has('data-bridge-chat'), false);
  const left = p.calls.prompts.length; p.message({type:'bridge-chat-ui',v:1,nonce,mode:'chat'});
  assert.equal(p.calls.prompts.length, left);
});

test('list header handoff is optional for published plugins and accepts only its boolean receipt', () => {
  const p = page(defaultURL, defaultURL, {frame:true}); p.run();
  const bind = p.calls.messages.at(-1).message;
  assert.equal(bind.nativeListHeader, false);
  const mode = {type:'bridge-chat-ui',v:1,nonce:bind.nonce,mode:'list'};
  p.message(mode);
  assert.equal(p.calls.prompts.at(-1).value, 'list', 'published plugin 3 retains its own list controls');
  assert.equal(p.calls.messages.at(-1).message.nativeListHeader, true);
  p.message({...mode,nativeListHeader:true});
  assert.equal(p.calls.prompts.at(-1).value, 'list-header');
  assert.equal(p.action('new'), 'sent');
  assert.equal(p.calls.messages.at(-1).message.action, 'new');
  const count = p.calls.prompts.length;
  p.message({...mode,nativeListHeader:'true'});
  p.message({...mode,nativeListHeader:true,extra:'rejected'});
  assert.equal(p.calls.prompts.length, count);
  p.message({...mode,mode:'chat',nativeListHeader:true});
  assert.equal(p.calls.prompts.at(-1).value, 'chat-header');
  p.message(mode);
  assert.equal(p.calls.prompts.at(-1).value, 'list', 'legacy receipt does not claim native list controls');
});

test('removed frames and modified sandbox cannot report state even before the mutation observer runs', () => {
  const p = page(defaultURL, defaultURL, {frame:true}); p.run();
  const nonce = p.calls.messages[0].message.nonce, data = {type:'bridge-chat-ui',v:1,nonce,mode:'chat'};
  let count = p.calls.prompts.length; p.frame(false); p.message(data); assert.equal(p.calls.prompts.length,count);
  p.frame(true); p.frameNode.sandbox = 'allow-scripts allow-same-origin'; p.message(data); assert.equal(p.calls.prompts.length,count);
  p.sync(); assert.equal(p.attrs.has('data-bridge-chat'),false);
});

test('a matching URL cannot hide Magpie chrome until the Chat view is visibly selected', () => {
  for (const change of [p=>p.selected(false), p=>p.hidden(true)]) {
    const p = page(defaultURL, defaultURL, {frame:true}); change(p); p.run();
    assert.equal(p.attrs.has('data-bridge-chat'),false); assert.equal(p.calls.messages.length,0);
    p.selected(true); p.hidden(false); p.sync();
    assert.equal(p.attrs.has('data-bridge-chat'),true); assert.equal(p.calls.messages[0].message.action,'bind');
  }
});

test('native Chat injection reports failures only for the still-current page', async () => {
  let reject;
  const code = source('services/ServiceWeb.ets').split('  @Builder')[0]
    .replace(/@\w+(?:\([^()\n]*\))?\s*/g, '').replace('export struct ServiceWeb', 'class ServiceWeb') + '\n}';
  const sandbox = vm.createContext({ ServiceSite: class {}, getContext: () => ({}), chatUiScript, chatUiActionScript,
    httpsOrigin: url => new URL(url).origin, webString: value => value,
    webview: { WebviewController: class {
      getUrl() { return defaultURL; }
      runJavaScript() { return new Promise((_, fail) => { reject = fail; }); }
    } } });
  vm.runInContext(strip(code) + '\nthis.service = new ServiceWeb();', sandbox);
  const service = sandbox.service;
  service.site = { id: 'chat', url: defaultURL, loginOrigin: 'https://libo.siasunagv.cn' };
  service.initialURL = defaultURL; service.currentURL = defaultURL; service.active = true; service.chatToken = token;
  service.chatCommand(); reject(Error('failed')); await Promise.resolve(); await Promise.resolve();
  assert.match(service.status, /适配失败/);
  service.status = ''; service.chatCommand(); service.currentURL = 'https://libo.siasunagv.cn/magpie/?view=usage';
  reject(Error('stale')); await Promise.resolve(); await Promise.resolve();
  assert.equal(service.status, '');
  service.currentURL = defaultURL; service.chatCommand(); service.chatGeneration++;
  reject(Error('stale generation')); await Promise.resolve(); await Promise.resolve();
  assert.equal(service.status, '');
});

test('real native prompt and injected script require the current Chat document, token and mode', async () => {
  const p = page(defaultURL, defaultURL, {frame:true});
  const code = source('services/ServiceWeb.ets').split('  @Builder')[0]
    .replace(/@\w+(?:\([^()\n]*\))?\s*/g, '').replace('export struct ServiceWeb', 'class ServiceWeb') + '\n}';
  let serial = 0, backward = 0;
  const native = vm.createContext({ ServiceSite:class {}, getContext:()=>({}), chatUiScript, chatUiActionScript,
    util:{generateRandomUUID:()=>String(++serial).padStart(32, '0')}, httpsOrigin:value=>new URL(value).origin,
    webString:value=>value, webview:{WebviewController:class {}} });
  vm.runInContext(strip(code) + '\nthis.service = new ServiceWeb();', native);
  const service = native.service, states = [], replies = [];
  Object.assign(service, {site:{id:'chat',url:defaultURL,enabled:true},initialURL:defaultURL,currentURL:defaultURL,active:true,
    onChatMode:value=>states.push(value), controller:{
      getUrl:()=>p.sandbox.location.href,
      runJavaScript:async script=>vm.runInContext(script,p.sandbox),
      backward:()=>backward++, accessBackward:()=>true
    }});
  p.sandbox.prompt = (message,value) => {
    let answer = null;
    service.chatPrompt({message,value,url:p.sandbox.location.href,result:{
      handlePromptConfirm:value=>{answer=value;replies.push(value);},handleCancel:()=>replies.push('cancel')
    }});
    return answer;
  };
  service.newChatToken(); service.chatCommand(); await Promise.resolve();
  const firstToken = service.chatToken, nonce = p.calls.messages[0].message.nonce;
  p.message({type:'bridge-chat-ui',v:1,nonce,mode:'chat'});
  assert.equal(service.chatMode, true); assert.equal(states.at(-1),true); assert.equal(replies.at(-1),'saved');
  p.frame(false); p.sync(); assert.equal(service.chatMode,false, 'removing the live frame restores the native dock');
  p.frame(true); p.sync();
  const rebound = p.calls.messages.at(-1).message.nonce;
  p.message({type:'bridge-chat-ui',v:1,nonce:rebound,mode:'chat'}); assert.equal(service.chatMode,true);
  p.message({type:'bridge-chat-ui',v:1,nonce:rebound,mode:'list',nativeListHeader:true});
  assert.equal(service.chatListHeader,true); assert.equal(service.chatMode,false);
  p.message({type:'bridge-chat-ui',v:1,nonce:rebound,mode:'chat',nativeListHeader:true});
  assert.equal(service.chatListHeader,true); assert.equal(service.chatMode,true);
  service.requestBack(); await Promise.resolve();
  assert.equal(p.calls.messages.at(-1).message.action,'back'); assert.equal(backward,0);
  p.message({type:'bridge-chat-ui',v:1,nonce:rebound,mode:'list'}); assert.equal(service.chatMode,false);
  const event = {message:'bridge-chat-ui:'+firstToken,value:'chat',url:defaultURL,result:{
    handlePromptConfirm:value=>replies.push(value),handleCancel:()=>replies.push('cancel')
  }};
  for (const changed of [{url:defaultURL+'#old'}, {message:'bridge-chat-ui:'+ 'f'.repeat(32)}, {value:'chat-id'},
    {value:'true'}]) {
    service.chatPrompt({...event,...changed}); assert.equal(replies.at(-1),'cancel'); assert.equal(service.chatMode,false);
  }
  service.active = false; service.chatPrompt(event); assert.equal(replies.at(-1),'cancel');
  service.active = true; service.currentURL = defaultURL+'#old'; service.chatPrompt(event); assert.equal(replies.at(-1),'cancel');
  service.currentURL = defaultURL; p.href('https://libo.siasunagv.cn/magpie/?view=usage'); service.chatPrompt(event); assert.equal(replies.at(-1),'cancel');
  service.currentURL = p.sandbox.location.href;
  service.chatPrompt({...event,url:service.currentURL}); assert.equal(replies.at(-1),'cancel', 'fallback cannot report chat');
  service.chatPrompt({...event,url:service.currentURL,value:'list'}); assert.equal(replies.at(-1),'saved', 'recognized fallback can only acknowledge list');
  service.currentURL = defaultURL;
  p.href(defaultURL); service.site.id = 'magpie'; service.chatPrompt(event); assert.equal(replies.at(-1),'cancel');
  service.site.id = 'chat'; service.site.enabled = false; service.chatPrompt(event); assert.equal(replies.at(-1),'cancel');
  service.site.enabled = true; service.newChatToken(); service.chatPrompt(event); assert.equal(replies.at(-1),'cancel');
  assert.notEqual(service.chatToken,firstToken); assert.equal(service.chatMode,false);
  const actions = [];
  service.chatMode = true;
  service.controller.runJavaScript = async script => { actions.push(script); return actions.length === 1 ? 'unavailable' : 'sent'; };
  service.chatAction('back'); await Promise.resolve(); await Promise.resolve();
  assert.equal(service.chatMode,false); assert.equal(states.at(-1),false);
  assert.match(service.status,/尚未就绪/); assert.equal(actions.length,2); assert.match(actions[1],/\.suspend\(/);
});

test('system back in a Chat conversation sends its UI request before any tab switch', () => {
  const index = source('pages/Index.ets');
  const back = index.slice(index.indexOf('  onBackPress()'), index.indexOf('  @Builder', index.indexOf('  onBackPress()')));
  const sandbox = vm.createContext({});
  vm.runInContext(strip('class Page {' + back + '}') + ';this.Page=Page;', sandbox);
  const page = new sandbox.Page(), tabs = [];
  Object.assign(page,{activeTab:'chat',chatInConversation:true,keeperBackRequest:0,selectTab:id=>tabs.push(id)});
  assert.equal(page.onBackPress(),true); assert.equal(page.keeperBackRequest,1); assert.deepEqual(tabs,[]);
  page.chatInConversation = false; page.onBackPress(); assert.deepEqual(tabs,['codex']);
});
