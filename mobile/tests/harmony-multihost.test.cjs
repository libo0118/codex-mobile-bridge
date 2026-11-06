const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');
const root = path.join(__dirname, '../harmony/entry/src/main/ets');
const source = fs.readFileSync(path.join(root, 'pages/Index.ets'), 'utf8').replace(/\r\n/g, '\n');
const segment = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const logic = (source.slice(0, source.indexOf('  @Builder')) +
  segment('  private async upload(', '  @Builder\n  private gatewayMenu()') + '\n}')
  .replace(/^import[^\n]+\n/gm, '').replace(/@\w+(?:\([^()\n]*\))?\s*/g, '').replace('struct Index', 'class Index');
let serial = 0;
class Controller {
  constructor() { this.url = ''; this.document = { composer: { value: '' }, messages: { scrollTop: 0 } }; this.loads = []; this.scripts = []; }
  get draft() { return this.document.composer.value; }
  set draft(value) { this.document.composer.value = value; }
  getUrl() { return this.url; }
  async runJavaScript(script) { this.scripts.push(script); return '"true"'; }
  loadUrl(url) { this.loads.push(url); this.url = url; }
  refresh() { assert.fail('switch must never refresh'); }
}
class ServiceSite {
  constructor(id, name, url, loginOrigin = '', enabled = true) { Object.assign(this, { id, name, url, loginOrigin, enabled }); }
}
class CodeyUiState { constructor() { Object.assign(this, { supported: false, chat: false }); } }
class Computer { constructor(base, name, opened) { Object.assign(this, { base, name, opened }); } }
const scope = vm.createContext({
  getContext: () => ({}), webview: { WebviewController: Controller, WebCookieManager: { saveCookieAsync: async () => {} } },
  Computer, ComputerStore: class {}, ServiceStore: class {}, ForegroundEvents: class {}, CodeyUiState, ServiceSite,
  DEFAULT_DOWNLOAD_LIMIT_MIB: 200, util: { generateRandomUUID: () => 'token-' + ++serial },
  gatewayConnection: url => { const u = new URL(url); return { base: u.origin, host: u.hostname }; },
  sameGateway: (url, base) => url.startsWith(base + '/'), isPreviewShell: url => url.includes('preview-shell'),
  mobileScript: (_scripts, token, url) => 'mobile:' + token + ':' + url, codeyUiScript: (url, token) => 'ui:' + token + ':' + url,
  webString: value => JSON.parse(value), uploadGestureScript: token => token,
  FileSelectorMode: { FileOpenMultipleMode: 1, FileOpenFolderMode: 2, FileSaveMode: 3 },
  acceptsCameraPhoto: () => true, discardCapture: capture => scope.discards.push(capture.path), discards: [],
  capturePhoto: async (_ctx, canOpen) => canOpen() ? { path: 'owned', uri: 'file://owned' } : undefined,
  selectUpload: async () => ['file://file'], acceptsDownload: () => true,
  promptAction: { showToast() {} }, URL, console
});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'security/GatewayURL.ets'), 'utf8').replace(/\bexport /g, ''), { mode: 'strip' }), scope);
vm.runInContext(stripTypeScriptTypes(logic, { mode: 'strip' }) + '\nthis.Page = Index;', scope);
function page() {
  const p = new scope.Page();
  Object.assign(p, { ready: true, foreground: true, context: {}, alerts: false, scripts: '',
    store: { save: async () => {}, language: async () => {} }, events: { start() {}, stop() {} },
    updateBars() {}, flushCookies() {}, error(e) { throw e; } });
  return p;
}
const enter = async (p, base) => { await p.connect(base + '/'); const s = p.gatewaySessions.find(value => value.base === base); s.controller.url = base + '/#chat'; p.gatewayPageBegin(s); return s; };

test('opened hosts keep independent controllers, URL and unsent draft across switches and computer list', async () => {
  const p = page(), a = await enter(p, 'https://a.example');
  a.controller.draft = 'draft on A'; a.controller.document.messages.scrollTop = 132;
  const aDocument = a.controller.document, aComposer = aDocument.composer, aMessages = aDocument.messages;
  const b = await enter(p, 'https://b.example'); b.controller.draft = 'draft on B';
  await p.connect('https://a.example/');
  assert.equal(p.controller, a.controller); assert.equal(p.currentURL(), 'https://a.example/#chat');
  assert.equal(p.controller.draft, 'draft on A'); assert.deepEqual(a.controller.loads, []);
  assert.equal(p.controller.document, aDocument); assert.equal(p.controller.document.composer, aComposer);
  assert.equal(p.controller.document.messages, aMessages); assert.equal(aMessages.scrollTop, 132);
  p.home(); await p.connect('https://b.example/');
  assert.equal(p.controller, b.controller); assert.equal(p.controller.draft, 'draft on B');
  assert.deepEqual(b.controller.loads, []); assert.equal(p.gatewaySessions.length, 2);
});

test('late picker completion cannot cross hosts, including switching away and back', async () => {
  const p = page(), a = await enter(p, 'https://a.example'); let finish;
  scope.capturePhoto = async () => new Promise(resolve => { finish = resolve; });
  const replies = [], event = { fileSelector: { getMode: () => 0, getAcceptType: () => ['image/jpeg'], isCapture: () => true },
    result: { handleFileList: value => replies.push(Array.from(value)) } };
  const pending = p.upload(event, a); await new Promise(setImmediate);
  const b = await enter(p, 'https://b.example'); await p.connect('https://a.example/');
  finish({ path: 'owned', uri: 'file://owned' }); await pending;
  assert.deepEqual(replies, [[]]); assert.equal(scope.discards.at(-1), 'owned');
  assert.equal(p.controller, a.controller); assert.equal(b.controller.loads.length, 0);
});

test('a hidden page begin and prompt cannot mutate the currently selected host', async () => {
  const p = page(), a = await enter(p, 'https://a.example'), b = await enter(p, 'https://b.example');
  const token = p.token, generation = p.generation; p.status = 'B status';
  p.gatewayPageBegin(a);
  assert.equal(p.controller, b.controller); assert.equal(p.token, token); assert.equal(p.generation, generation); assert.equal(p.status, 'B status');
  let cancelled = 0;
  assert.equal(p.gatewayPrompt(a, { message: 'codexbridge-codey-ui:' + a.token, url: a.controller.url, result: { handleCancel() { cancelled++; } } }), true);
  assert.equal(cancelled, 1); assert.equal(p.codeyUi.supported, false);
});

test('Chat disabled during save unloads only Chat and preserves a newer open config', async () => {
  const p = page(); const chat = new ServiceSite('chat', 'Chat', 'https://chat.example/', '', true);
  const keeper = new ServiceSite('keeper', 'Keeper', 'https://keeper.example/');
  p.services = [keeper, chat]; p.loadedServices = [keeper, chat]; p.activeTab = 'chat';
  p.configureService(chat); p.serviceEnabled = false; let release;
  p.serviceStore = { save: async () => new Promise(resolve => { release = resolve; }) };
  const pending = p.saveService(); p.selectTab('codex'); p.configureService(keeper); release(); await pending;
  assert.equal(p.services.find(value => value.id === 'chat').enabled, false);
  assert.deepEqual(Array.from(p.loadedServices, value => value.id), ['keeper']);
  assert.equal(p.activeTab, 'codex'); assert.equal(p.configId, 'keeper');
});

test('opening an existing notification explicitly navigates only that controller; rename keeps it', async () => {
  const p = page(), a = await enter(p, 'https://a.example'), b = await enter(p, 'https://b.example');
  const aDraft = a.controller.draft = 'still here';
  p.editName = 'A renamed'; await p.rename(p.computers.find(value => value.base === a.base));
  assert.equal(p.gatewaySessions.find(value => value.base === a.base), a);
  await p.connect('https://a.example/#thread~host', 'https://a.example', true);
  assert.equal(p.controller, a.controller); assert.equal(p.controller.draft, aDraft);
  assert.deepEqual(a.controller.loads, ['https://a.example/#thread~host']); assert.deepEqual(b.controller.loads, []);
});

test('pending connection saves are serialized and only the latest selection activates', async () => {
  const p = page(), writes = []; let first;
  p.store.save = async rows => { writes.push(rows.map(row => row.base)); if (writes.length === 1) await new Promise(resolve => { first = resolve; }); };
  const connectA = p.connect('https://a.example/'); await new Promise(setImmediate);
  const connectB = p.connect('https://b.example/'); await new Promise(setImmediate);
  assert.equal(writes.length, 1); assert.equal(p.connected, false);
  first(); await Promise.all([connectA, connectB]);
  assert.deepEqual(writes.map(value => Array.from(value)), [['https://a.example'], ['https://b.example', 'https://a.example']]);
  assert.equal(p.base, 'https://b.example'); assert.equal(p.gatewaySessions.length, 1);
});

test('opening a 101st host is rejected without evicting drafts or saved computers; existing hosts remain switchable', async () => {
  const p = page();
  for (let i = 0; i < 100; i++) {
    const session = await enter(p, `https://host${i}.example`);
    session.controller.draft = `draft ${i}`;
  }
  const sessions = Array.from(p.gatewaySessions), computers = Array.from(p.computers);
  let writes = 0; p.store.save = async () => { writes++; };
  await assert.rejects(p.connect('https://host100.example/'), /100/);
  assert.equal(writes, 0);
  assert.deepEqual(Array.from(p.gatewaySessions), sessions);
  assert.deepEqual(Array.from(p.computers), computers);
  assert.equal(sessions[0].controller.draft, 'draft 0');
  await p.connect('https://host0.example/');
  assert.equal(p.controller, sessions[0].controller);
  assert.equal(p.controller.draft, 'draft 0');
  assert.deepEqual(p.controller.loads, []);
  assert.equal(p.gatewaySessions.length, 100);
  scope.webview.WebCookieManager.fetchCookie = async () => '';
  await p.removeComputer(p.computers.find(item => item.base === 'https://host0.example'));
  assert.equal(p.gatewaySessions.length, 99);
  await p.connect('https://host100.example/');
  assert.equal(p.gatewaySessions.length, 100);
  assert.equal(p.base, 'https://host100.example');
});

test('a hidden host finishes in its own controller without changing the selected host status', async () => {
  const p = page(), a = await enter(p, 'https://a.example'), b = await enter(p, 'https://b.example');
  let finish; a.controller.runJavaScript = script => { a.controller.scripts.push(script); return new Promise(resolve => { finish = resolve; }); };
  p.status = 'B status'; const pending = p.gatewayPageFinished(a, a.controller.url);
  assert.ok(a.controller.scripts.at(-1).includes('token-')); assert.equal(b.controller.scripts.some(value => value.startsWith('mobile:')), false);
  finish('"ok"'); await pending; assert.equal(p.status, 'B status'); assert.equal(p.controller, b.controller);
});

test('an obsolete save-picker completion cannot cancel the next host download', async () => {
  const p = page(), a = await enter(p, 'https://a.example'); let finish; const discarded = [];
  scope.discardAttachment = file => discarded.push(file.name); scope.saveAttachment = () => new Promise(resolve => { finish = resolve; });
  p.downloaded = { name: 'old' }; const saving = p.saveDownload();
  await enter(p, 'https://b.example'); const newer = { name: 'new' };
  assert.deepEqual(discarded, [], 'the source must remain until the pending save ends');
  p.downloaded = newer; p.downloadBusy = true; p.downloadLabel = 'B download';
  finish(true); await saving;
  assert.equal(p.downloaded, newer); assert.equal(p.downloadBusy, true); assert.equal(p.downloadLabel, 'B download');
  assert.deepEqual(discarded, ['old']);
  assert.notEqual(p.controller, a.controller);
});

test('a failed save after switching identifies its original computer without changing the new download', async () => {
  const p = page(), a = await enter(p, 'https://a.example'); let fail; const discarded = [], messages = [];
  p.message = message => messages.push(message);
  scope.discardAttachment = file => discarded.push(file.name); scope.saveAttachment = () => new Promise((resolve, reject) => { fail = reject; });
  p.downloaded = { name: 'old' }; const saving = p.saveDownload();
  await enter(p, 'https://b.example'); const newer = { name: 'new' }; p.downloaded = newer; p.downloadBusy = true;
  assert.deepEqual(discarded, []); fail(Error('incomplete destination')); await saving;
  assert.equal(p.downloaded, newer); assert.equal(p.downloadBusy, true); assert.deepEqual(discarded, ['old']);
  assert.ok(messages[0].includes(a.base)); assert.ok(messages[0].includes('incomplete destination'));
});

test('disabling active Chat returns to Codex and re-enabling does not eagerly load it', async () => {
  const p = page(), chat = new ServiceSite('chat', 'Chat', 'https://chat.example/', '', true);
  p.services = [chat]; p.loadedServices = [chat]; p.activeTab = 'chat';
  p.serviceStore = { save: async () => {} }; p.configureService(chat); p.serviceEnabled = false; await p.saveService();
  assert.equal(p.activeTab, 'codex'); assert.equal(p.loadedServices.length, 0); assert.equal(p.services[0].enabled, false);
  p.configureChat(); p.serviceEnabled = true; await p.saveService();
  assert.equal(p.activeTab, 'codex'); assert.equal(p.loadedServices.length, 0); assert.equal(p.services[0].enabled, true);
  p.selectTab('chat'); assert.equal(p.loadedServices.length, 1); assert.equal(p.activeTab, 'chat');
});

test('inactive host file-selection callback cancels exactly once without inspecting a gesture', async () => {
  const p = page(), a = await enter(p, 'https://a.example'); await enter(p, 'https://b.example');
  const replies = []; await p.upload({ fileSelector: { getMode: () => assert.fail('inactive selector') },
    result: { handleFileList: value => replies.push(Array.from(value)) } }, a);
  assert.deepEqual(replies, [[]]);
});

test('relay scopes at the same origin still retain separate controllers, tokens and drafts', async () => {
  const p = page(), first = 'https://relay.example/d/' + 'a'.repeat(32), second = 'https://relay.example/d/' + 'b'.repeat(32);
  const a = await enter(p, first); a.controller.draft = 'relay A';
  const b = await enter(p, second); b.controller.draft = 'relay B';
  assert.notEqual(a.token, b.token); assert.notEqual(a.controller, b.controller);
  await p.connect(first + '/'); assert.equal(p.controller.draft, 'relay A'); assert.equal(p.token, a.token);
  await p.connect(second + '/'); assert.equal(p.controller.draft, 'relay B'); assert.equal(p.token, b.token);
  assert.deepEqual(a.controller.loads, []); assert.deepEqual(b.controller.loads, []);
});
