const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../harmony/entry/src/main/ets/security/GatewayURL.ets'), 'utf8');
const stripped = stripTypeScriptTypes(source.replace(/\bexport /g, ''), { mode: 'strip' });
const scope = { console };
vm.createContext(scope);
vm.runInContext(stripped + '\nthis.security = { gatewayConnection, connectionURL, sameGateway, apiPath, acceptsDownload, validPrompt, safeFilename, chatURL, serviceURL, credentialScopeMatches };', scope);
const s = scope.security;
const cases = require('./url-cases.json');
for (const [input, expected] of cases.accepted) assert.equal(s.connectionURL(input), expected, input);
for (const input of cases.rejected) assert.throws(() => s.connectionURL(input), undefined, input);
for (const [thread, host, fragment] of cases.desktopAccepted) assert.equal(s.chatURL('https://example.com', thread, host), 'https://example.com/' + fragment);
for (const [thread, host] of cases.desktopRejected) assert.throws(() => s.chatURL('https://example.com', thread, host));
const base = 'https://example.com/d/' + 'a'.repeat(32);
const thread = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12);
const file = `${base}/api/sessions/${thread}/files/${'b'.repeat(64)}`;
assert.equal(s.sameGateway(base + '/', base), true);
assert.equal(s.sameGateway(base + '/?client=claude#chat', base), true);
for (const target of ['https://evil.com/', base + 'evil/', base + '/%2e%2e/api/auth', base + '/../api/auth', base + '/./api/auth', base + '/x\\y', 'https://user@example.com' + base.slice('https://example.com'.length) + '/']) {
  assert.equal(s.sameGateway(target, base), false, target);
}
assert.equal(s.acceptsDownload(file + '?download=1', base), true);
assert.equal(s.apiPath(file, base), `/api/sessions/${thread}/files/${'b'.repeat(64)}`);
for (const target of [file.replace('example.com', 'evil.com'), file + '#fragment', base + '/api/auth', base + '/api/mobile/update/packages/' + 'b'.repeat(64), base + '/api/sessions/diagnostics?thread=bad']) {
  assert.equal(s.acceptsDownload(target, base), false, target);
}
assert.equal(s.acceptsDownload(base + '/api/sessions/diagnostics?thread=' + thread, base), true);
assert.equal(s.validPrompt('codexbridge-copy:secret', 'secret', base + '/', base + '/', base), 'copy');
assert.equal(s.validPrompt('codexbridge-copy:stale', 'secret', base + '/', base + '/', base), '');
assert.equal(s.validPrompt('codexbridge-copy:secret', 'secret', 'https://evil.com/', base + '/', base), '');
assert.equal(s.validPrompt('codexbridge-copy:secret', 'secret', base + '/html-preview-shell', base + '/', base), '');
assert.equal(s.validPrompt('codexbridge-copy:secret', 'secret', base + '/', base + '/html-preview-shell', base), '');
assert.equal(s.safeFilename('../../bad.txt'), '.._.._bad.txt');
console.log('Harmony security: shared URL fixtures and origin, relay, prompt, attachment boundaries passed.');

const downloadSource = fs.readFileSync(path.join(__dirname, '../harmony/entry/src/main/ets/web/DownloadScript.ets'), 'utf8');
const scriptScope = {};
vm.createContext(scriptScope);
vm.runInContext(stripTypeScriptTypes(downloadSource.replace(/\bexport /g, ''), { mode: 'strip' }) + '\nthis.start = downloadStartScript; this.limit = DOWNLOAD_LIMIT;', scriptScope);

async function fetchDownload(response, failure) {
  let cancelled = false;
  const scope = {
    URL, AbortController, setTimeout, clearTimeout, btoa,
    location: { origin: 'https://example.com' },
    fetch: async (target, options) => {
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      if (failure) throw new Error(failure);
      let index = 0;
      return {
        ok: true, redirected: false, url: file, ...response,
        headers: { get: name => name === 'content-length' ? response.length ?? null : 'attachment; filename="sample.txt"' },
        body: { getReader: () => ({
          read: async () => {
            if (response.disconnect && index > 0) throw new Error('disconnected');
            const bytes = (response.chunks ?? [new Uint8Array([1, 2, 3])])[index++];
            return bytes ? { done: false, value: bytes } : { done: true };
          },
          cancel: async () => { cancelled = true; }
        }) }
      };
    }
  };
  vm.createContext(scope);
  vm.runInContext('window=this; top=this;', scope);
  vm.runInContext(scriptScope.start(file, 'slot'), scope);
  for (let attempt = 0; attempt < 100 && scope.slot.status === 'loading'; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  return { state: scope.slot, cancelled };
}

test('attachment becomes ready only after complete bounded same-origin stream', async () => {
  const result = await fetchDownload({ length: '3' });
  assert.equal(result.state.status, 'ready');
  assert.equal(result.state.size, 3);
  assert.equal(Buffer.from(result.state.chunks.join(''), 'base64').toString('hex'), '010203');
});
test('redirect, cross-origin response, oversized header and interrupted stream leave no successful payload', async () => {
  for (const [response, failure] of [
    [{}, 'redirect rejected'], [{ url: 'https://evil.com/file' }], [{ redirected: true }],
    [{ length: String(scriptScope.limit + 1) }], [{ length: '4' }], [{ disconnect: true }],
    [{ chunks: [new Uint8Array(scriptScope.limit), new Uint8Array(1)] }]
  ]) {
    const result = await fetchDownload(response, failure);
    assert.equal(result.state.status, 'error');
    assert.equal(result.state.chunks.length, 0);
  }
});

const eventSource = fs.readFileSync(path.join(__dirname, '../harmony/entry/src/main/ets/notifications/EventCursor.ets'), 'utf8');
const eventScope = {};
vm.createContext(eventScope);
vm.runInContext(stripTypeScriptTypes(eventSource.replace(/\bexport /g, ''), { mode: 'strip' }) + '\nthis.Cursor = EventCursor;', eventScope);
test('foreground events suppress first/history reads and advance only after delivery', () => {
  const cursor = new eventScope.Cursor();
  const snapshot = (sequence, events = [], stream = 'one') => ({ enabled: true, streamId: stream, cursor: sequence, events });
  assert.equal(cursor.candidates(snapshot(5, [{ id: 'old', sequence: 5 }]), true).length, 0);
  const incoming = snapshot(7, [{ id: 'new', sequence: 6 }, { id: 'read', sequence: 7, unread: false }]);
  assert.equal(cursor.candidates(incoming, true).length, 1);
  assert.equal(cursor.candidates(incoming, true).length, 1, 'an HTTP success does not acknowledge failed notification publication');
  cursor.delivered(6);
  assert.equal(cursor.candidates(incoming, true).length, 0);
  cursor.complete(incoming);
  assert.equal(cursor.after(), 7);
  assert.equal(cursor.candidates(snapshot(8, [{ id: 'hidden', sequence: 8 }]), false).length, 0);
  assert.equal(cursor.candidates(snapshot(9, [{ id: 'resume-history', sequence: 9 }]), true).length, 0);
  assert.equal(cursor.candidates(snapshot(10, [{ id: 'visible-new', sequence: 10 }]), true).length, 1);
  assert.equal(cursor.candidates(snapshot(20, [{ id: 'new-stream-history', sequence: 20 }], 'two'), true).length, 0);
});

test('service credentials are bound to HTTPS origin and configured path', () => {
  const keeper = 'https://example.com/keeper/';
  assert.equal(s.credentialScopeMatches(keeper + 'login?tab=admin', keeper, keeper), true);
  assert.equal(s.credentialScopeMatches(keeper + '?key=private#token', keeper, keeper), true, 'private entry URL remains inside the configured scope');
  for (const target of ['https://example.com/cpa/', 'https://evil.com/keeper/', 'http://example.com/keeper/', 'https://example.com/keeper-other/', 'https://example.com/keeper/../cpa/', 'https://example.com/keeper/%2e%2e/cpa/']) {
    assert.equal(s.credentialScopeMatches(target, keeper, keeper), false, target);
  }
  assert.equal(s.credentialScopeMatches(keeper, 'https://example.com/cpa/', keeper), false);
  assert.throws(() => s.serviceURL('https://user:password@example.com/keeper/'));
  assert.throws(() => s.serviceURL('https://example.com/keeper/?token=secret'));
});

const fillSource = fs.readFileSync(path.join(__dirname, '../harmony/entry/src/main/ets/services/CredentialFill.ets'), 'utf8');
const fillScope = {};
vm.createContext(fillScope);
vm.runInContext(stripTypeScriptTypes(fillSource.replace(/\bexport /g, ''), { mode: 'strip' }) + '\nthis.fill = credentialFillScript;', fillScope);
test('explicit credential fill changes a single main-frame form without submitting', () => {
  class Input {
    constructor() { this.disabled = false; this.readOnly = false; this.events = []; }
    getClientRects() { return [1]; }
    set value(value) { this.actual = value; }
    get value() { return this.actual; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  const current = 'https://example.com/keeper/';
  const password = new Input(), username = new Input();
  let passwords = [password];
  const scope = { location: { href: current }, HTMLInputElement: Input, Event: class { constructor(type) { this.type = type; } },
    document: { querySelectorAll: selector => selector === 'input[type="password"]' ? passwords : [username] },
    fetch: () => { throw new Error('must not execute interpolated code'); } };
  vm.createContext(scope);
  vm.runInContext('window=this; top=this;', scope);
  const secret = 'secret\');fetch("https://evil.com");//';
  assert.equal(vm.runInContext(fillScope.fill('alice', secret, current), scope), 'filled');
  assert.equal(password.value, secret);
  assert.equal(username.value, 'alice');
  assert.deepEqual(password.events, ['input', 'change']);
  passwords = [new Input(), new Input()];
  assert.equal(vm.runInContext(fillScope.fill('', 'blocked', current), scope), 'ambiguous');
  assert.equal(passwords[0].value, undefined);
  scope.location.href = 'https://evil.com/';
  assert.equal(vm.runInContext(fillScope.fill('', 'blocked', current), scope), 'changed');
});

const nativeRoot = path.join(__dirname, '../harmony/entry/src/main/ets');
const filesSource = fs.readFileSync(path.join(nativeRoot, 'web/Files.ets'), 'utf8');
function fileSaveHarness(options = {}) {
  const calls = [], userURI = 'file://documents/sample.txt';
  let destinationSize = options.destinationSize ?? 0;
  const fileSystem = {
    OpenMode: { READ_ONLY: 0, READ_WRITE: 2, CREATE: 64, TRUNC: 512 },
    open: async (target, mode) => {
      calls.push(['open', target, mode]);
      if (target !== userURI && options.missingSource) throw new Error('missing cache');
      return { fd: target === userURI ? 20 : 10 };
    },
    stat: async fd => {
      calls.push(['stat', fd]);
      return { size: fd === 10 ? options.sourceSize ?? 3 : destinationSize };
    },
    copyFile: async (source, destination) => {
      calls.push(['copy', source, destination]);
      if (options.copyFailure) { destinationSize = 1; throw new Error('copy interrupted'); }
      destinationSize = options.partialCopy ? 1 : 3;
    },
    close: async file => { calls.push(['close', file.fd]); },
    unlink: async target => { calls.push(['unlink', target]); },
    unlinkSync: target => { calls.push(['unlinkSync', target]); }
  };
  const context = { fs: fileSystem, DOWNLOAD_LIMIT: scriptScope.limit, picker: { DocumentViewPicker: class {
    async save() { calls.push(['picker']); return options.cancelled ? [] : [userURI]; }
  } } };
  vm.createContext(context);
  vm.runInContext(stripTypeScriptTypes(filesSource.replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, ''), { mode: 'strip' }) +
    '\nthis.api = { saveAttachment, DownloadFile };', context);
  return { calls, userURI, save: () => context.api.saveAttachment({ cacheDir: '/cache' },
    new context.api.DownloadFile('/cache/bridge-attachment-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sample.txt', 3)) };
}

test('native save validates the completed cache before opening the system picker', async () => {
  for (const options of [{ missingSource: true }, { sourceSize: 2 }]) {
    const h = fileSaveHarness(options);
    await assert.rejects(h.save());
    assert.equal(h.calls.some(call => call[0] === 'picker'), false);
    assert.equal(h.calls.some(call => call[1] === h.userURI), false);
  }
  const h = fileSaveHarness({ cancelled: true });
  assert.equal(await h.save(), false);
  assert.deepEqual(h.calls.at(-1), ['close', 10]);
});

test('native save refuses an existing nonempty target without truncating, copying or deleting it', async () => {
  const h = fileSaveHarness({ destinationSize: 42 });
  await assert.rejects(h.save(), /已有内容/);
  assert.deepEqual(h.calls.find(call => call[0] === 'open' && call[1] === h.userURI), ['open', h.userURI, 2]);
  assert.equal(h.calls.some(call => ['copy', 'unlink', 'unlinkSync'].includes(call[0])), false);
  assert.deepEqual(h.calls.filter(call => call[0] === 'close').map(call => call[1]), [20, 10]);
});

test('native copy failure and short copy never report success or delete the selected user target', async () => {
  for (const options of [{ copyFailure: true }, { partialCopy: true }]) {
    const h = fileSaveHarness(options);
    await assert.rejects(h.save(), /不完整文件/);
    assert.equal(h.calls.some(call => ['unlink', 'unlinkSync'].includes(call[0])), false);
    assert.deepEqual(h.calls.find(call => call[0] === 'open' && call[1] === h.userURI), ['open', h.userURI, 2]);
    assert.deepEqual(h.calls.filter(call => call[0] === 'close').map(call => call[1]), [20, 10]);
  }
  const h = fileSaveHarness();
  assert.equal(await h.save(), true);
  assert.deepEqual(h.calls.find(call => call[0] === 'copy'), ['copy', 10, 20]);
  assert.equal(h.calls.some(call => ['unlink', 'unlinkSync'].includes(call[0])), false);
});

// Run production component methods with platform adapters; ArkUI rendering is checked separately on device.
function componentLogic(relative, name, adapters) {
  const source = fs.readFileSync(path.join(nativeRoot, relative), 'utf8');
  const logic = source.slice(0, source.indexOf('  @Builder')).replace(/^import .*;\s*$/gm, '')
    .replace(/@\w+(?:\([^()\n]*\))?\s*/g, '').replace(/\bexport /g, '').replace('struct ' + name, 'class ' + name) + '\n}';
  const context = { getContext: () => ({}), ...adapters };
  vm.createContext(context);
  vm.runInContext(stripTypeScriptTypes(logic, { mode: 'strip' }) + '\nthis.Component = ' + name + ';', context);
  return new context.Component();
}

function site(id, url) { return { id, name: id.toUpperCase(), url }; }
function indexLogic() {
  const stub = class {};
  const page = componentLogic('pages/Index.ets', 'Index', { ComputerStore: stub, ServiceStore: stub,
    ForegroundEvents: stub, webview: { WebviewController: stub }, promptAction: { showToast() {} },
    ServiceSite: class { constructor(id, name, url) { this.id = id; this.name = name; this.url = url; } } });
  page.error = error => { throw error; };
  return page;
}

test('an in-flight settings save rejects repeat clicks and cannot close a later configuration', async () => {
  const page = indexLogic(), cpa = site('cpa', 'https://example.com/cpa/'), magpie = site('magpie', 'https://example.com/magpie/');
  page.services = [cpa, magpie];
  let release, saves = 0;
  page.serviceStore.save = async () => { saves++; await new Promise(resolve => { release = resolve; }); };
  page.configureService(cpa);
  const first = page.saveService();
  await page.saveService();
  assert.equal(saves, 1);
  assert.equal(page.savingServices.includes('cpa'), true);
  page.configureService(magpie);
  release();
  await first;
  assert.equal(page.configId, 'magpie');
  assert.equal(page.serviceAddress, magpie.url);
  assert.equal(page.savingServices.length, 0);
  page.serviceStore.save = async () => {};
  await page.saveService();
  assert.equal(page.configId, '');
});

test('returning to settings for the same site keeps the new configuration open after the old save', async () => {
  const page = indexLogic(), cpa = site('cpa', 'https://example.com/cpa/');
  page.services = [cpa];
  let release;
  page.serviceStore.save = async () => { await new Promise(resolve => { release = resolve; }); };
  page.configureService(cpa);
  const saving = page.saveService();
  page.closeServiceConfig();
  page.configureService(cpa);
  release();
  await saving;
  assert.equal(page.configId, 'cpa');
});

test('forget removes the service record even when the configured scope has no saved match', async () => {
  const removed = [];
  const panel = componentLogic('services/ServiceCredentials.ets', 'ServiceCredentials', {
    credentialScope: value => value, credentialScopeMatches: s.credentialScopeMatches,
    CredentialVault: class { async has() { return false; } async remove(_, id, scope) { removed.push([id, scope]); } }
  });
  panel.serviceId = 'cpa'; panel.configuredUrl = 'https://example.com/new-cpa/'; panel.currentUrl = panel.configuredUrl; panel.active = true;
  await panel.show();
  assert.equal(panel.saved, false);
  await panel.remove();
  assert.deepEqual(removed, [['cpa', panel.configuredUrl]]);
  assert.match(panel.feedback, /已删除/);
  panel.active = false;
  await panel.remove();
  assert.equal(removed.length, 1);
});

test('a forgotten record completing after a panel change cannot alter the new panel', async () => {
  let release;
  const panel = componentLogic('services/ServiceCredentials.ets', 'ServiceCredentials', {
    credentialScope: value => value, credentialScopeMatches: s.credentialScopeMatches,
    CredentialVault: class { async remove() { await new Promise(resolve => { release = resolve; }); } }
  });
  panel.serviceId = 'cpa'; panel.configuredUrl = 'https://example.com/cpa/'; panel.currentUrl = panel.configuredUrl; panel.active = true; panel.open = true;
  const removing = panel.remove();
  panel.scopeChanged();
  panel.serviceId = 'magpie'; panel.configuredUrl = 'https://example.com/magpie/'; panel.currentUrl = panel.configuredUrl;
  panel.open = true; panel.feedback = 'new panel';
  release();
  await removing;
  assert.equal(panel.feedback, 'new panel');
});

test('service back uses history without reload; external confirmation hides query and fragment secrets', () => {
  const calls = [], dialogs = [];
  const page = componentLogic('services/ServiceWeb.ets', 'ServiceWeb', {
    ServiceSite: class {}, httpsOrigin: value => new URL(value).origin, externalHTTP: value => /^https?:/.test(value),
    AlertDialog: { show: options => dialogs.push(options) }, webview: { WebviewController: class {
      accessBackward() { return true; } backward() { calls.push('backward'); }
      refresh() { calls.push('refresh'); } loadUrl() { calls.push('loadUrl'); }
    } }
  });
  page.site = site('magpie', 'https://example.com/magpie/'); page.active = true;
  page.back();
  assert.deepEqual(calls, ['backward']);
  const target = 'https://external.example/quota?key=private-secret#private-fragment';
  assert.equal(page.navigate({ getRequestUrl: () => target, isMainFrame: () => true, isRequestGesture: () => true }), true);
  assert.equal(dialogs[0].message, 'https://external.example/quota');
  page.active = false; page.back();
  assert.deepEqual(calls, ['backward']);
});
