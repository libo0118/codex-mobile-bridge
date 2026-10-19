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
