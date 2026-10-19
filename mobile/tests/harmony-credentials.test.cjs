const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');

const sourceRoot = path.join(__dirname, '../harmony/entry/src/main/ets');
const securitySource = fs.readFileSync(path.join(sourceRoot, 'security/GatewayURL.ets'), 'utf8');
const vaultSource = fs.readFileSync(path.join(sourceRoot, 'services/CredentialVault.ets'), 'utf8');
const keeper = 'https://libo.siasunagv.cn/keeper/';
const magpie = 'https://libo.siasunagv.cn/magpie/';

// Executes the production ArkTS service; the platform adapter models HUKS with Node AES-GCM.
function harness() {
  const records = new Map(), keys = new Map(), sessions = new Map();
  const state = { failure: '', encryptions: 0, decryptions: 0, generations: 0, aborts: 0, nextHandle: 1 };
  const tags = Object.fromEntries(['ALGORITHM', 'KEY_SIZE', 'PURPOSE', 'PADDING', 'BLOCK_MODE', 'NONCE', 'ASSOCIATED_DATA', 'AE_TAG']
    .map(name => ['HUKS_TAG_' + name, name]));
  const prop = (options, tag) => options.properties.find(item => item.tag === tag)?.value;
  const fail = name => { if (state.failure === name) throw new Error('simulated ' + name); };
  const prefs = {
    get: async (key, fallback) => { fail('get'); return records.get(key) ?? fallback; },
    put: async (key, value) => { fail('put'); assert.equal(typeof value, 'string'); records.set(key, value); },
    delete: async key => { fail('delete'); records.delete(key); },
    flush: async () => { fail('flush'); }
  };
  const huks = {
    HuksTag: tags, HuksKeyAlg: { HUKS_ALG_AES: 2 }, HuksKeySize: { HUKS_AES_KEY_SIZE_256: 256 },
    HuksKeyPurpose: { HUKS_KEY_PURPOSE_ENCRYPT: 1, HUKS_KEY_PURPOSE_DECRYPT: 2 },
    HuksKeyPadding: { HUKS_PADDING_NONE: 0 }, HuksCipherMode: { HUKS_MODE_GCM: 3 },
    isKeyItemExist: async alias => {
      fail('key');
      if (state.failure === 'missing-key-code') throw { code: 12000011 };
      return keys.has(alias);
    },
    generateKeyItem: async (alias, options) => {
      fail('generate');
      assert.equal(prop(options, 'KEY_SIZE'), 256);
      assert.equal(prop(options, 'BLOCK_MODE'), 3);
      assert.equal(prop(options, 'PURPOSE'), 3);
      assert.equal(keys.has(alias), false, 'existing key must never be overwritten');
      state.generations++;
      keys.set(alias, crypto.randomBytes(32));
    },
    initSession: async (alias, options) => {
      fail('init');
      if (!keys.has(alias)) throw new Error('missing key');
      const handle = state.nextHandle++;
      sessions.set(handle, { key: keys.get(alias), options });
      return { handle };
    },
    finishSession: async (handle, options) => {
      if (state.beforeFinish) await state.beforeFinish();
      fail('finish');
      const session = sessions.get(handle);
      assert.ok(session);
      const nonce = prop(session.options, 'NONCE'), aad = prop(session.options, 'ASSOCIATED_DATA');
      assert.equal(nonce.length, 12);
      let output;
      if (prop(session.options, 'PURPOSE') === 1) {
        state.encryptions++;
        state.plainInput = options.inData;
        const cipher = crypto.createCipheriv('aes-256-gcm', session.key, nonce);
        cipher.setAAD(aad);
        output = Buffer.concat([cipher.update(options.inData), cipher.final(), cipher.getAuthTag()]);
      } else {
        state.decryptions++;
        const decipher = crypto.createDecipheriv('aes-256-gcm', session.key, nonce);
        decipher.setAAD(aad);
        const tag = prop(session.options, 'AE_TAG');
        assert.equal(tag.length, 16);
        decipher.setAuthTag(tag);
        output = Buffer.concat([decipher.update(options.inData), decipher.final()]);
      }
      sessions.delete(handle);
      const outData = new Uint8Array(output);
      if (prop(session.options, 'PURPOSE') === 2) state.plainOutput = outData;
      return { outData };
    },
    abortSession: async handle => { state.aborts++; sessions.delete(handle); }
  };
  const context = {
    Uint8Array, huks,
    cryptoFramework: { createRandom: () => ({ generateRandom: async length => {
      fail('random'); return { data: new Uint8Array(crypto.randomBytes(state.failure === 'short-random' ? 4 : length)) };
    } }) },
    util: {
      TextEncoder: class { encodeInto(value) { return new Uint8Array(Buffer.from(value, 'utf8')); } },
      TextDecoder: { create: (encoding, options) => ({ decodeWithStream: bytes => new TextDecoder(encoding, options).decode(bytes) }) },
      Base64Helper: class {
        encodeToStringSync(bytes) { return Buffer.from(bytes).toString('base64'); }
        decodeSync(value) { return new Uint8Array(Buffer.from(value, 'base64')); }
      }
    },
    preferences: { getPreferences: async (_, options) => {
      fail('preferences'); assert.equal(options.name, 'bridge-service-credentials'); return prefs;
    } }
  };
  vm.createContext(context);
  const code = (securitySource + '\n' + vaultSource).replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, '');
  vm.runInContext(stripTypeScriptTypes(code, { mode: 'strip' }) +
    '\nthis.api = { CredentialVault, credentialScope, credentialScopeMatches };', context);
  const vault = new context.api.CredentialVault();
  function replacePayload(serviceId, payload) {
    const record = JSON.parse(records.get(serviceId));
    const nonce = Buffer.from(record.nonce, 'base64');
    const cipher = crypto.createCipheriv('aes-256-gcm', [...keys.values()][0], nonce);
    cipher.setAAD(Buffer.from('codex-bridge-service-credential:v1\n' + serviceId + '\n' + record.scope));
    record.ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
    records.set(serviceId, JSON.stringify(record));
  }
  return { ...context.api, vault, records, keys, state, replacePayload };
}

test('credential scopes normalize host and trailing slash and enforce HTTPS path boundaries', () => {
  const h = harness();
  assert.equal(h.credentialScope('HTTPS://EXAMPLE.COM/keeper///'), 'https://example.com/keeper');
  assert.equal(h.credentialScope('https://example.com'), 'https://example.com/');
  const scope = h.credentialScope(keeper);
  assert.equal(h.credentialScopeMatches(keeper + 'login?next=quota', scope, keeper), true);
  for (const url of [magpie, keeper.replace('https:', 'http:'), 'https://evil.example/keeper/',
    'https://libo.siasunagv.cn/keeper-other/', keeper + '../magpie/', keeper + '%2e%2e/magpie/']) {
    assert.equal(h.credentialScopeMatches(url, scope, keeper), false, url);
  }
  for (const url of ['http://localhost/keeper', 'https://user:pass@example.com/', keeper + '?key=secret',
    keeper + '#secret', keeper + '%6cogin', keeper + '../', 'https://example.com/keeper\\login']) {
    assert.throws(() => h.credentialScope(url), undefined, url);
  }
});

test('passwords round-trip through AES-GCM; only scoped nonce and ciphertext persist', async () => {
  const h = harness(), username = '操作员@example.com', secret = '私密密码-😀-never-plaintext';
  await h.vault.save({}, 'keeper', keeper, username, secret);
  const first = JSON.parse(h.records.get('keeper'));
  assert.equal(h.records.get('keeper').includes(username), false);
  assert.equal(h.records.get('keeper').includes(secret), false);
  assert.ok(h.state.plainInput.every(byte => byte === 0), 'encryption input bytes are cleared');
  assert.equal(await h.vault.has({}, 'keeper', keeper), true);
  assert.equal(h.state.decryptions, 0, 'presence checks do not decrypt');
  const value = await h.vault.load({}, 'keeper', keeper);
  assert.equal(value.username, username);
  assert.equal(value.secret, secret);
  assert.equal(value.kind, 'password');
  assert.ok(h.state.plainOutput.every(byte => byte === 0), 'decryption output bytes are cleared');
  await h.vault.save({}, 'keeper', keeper, username, secret);
  const second = JSON.parse(h.records.get('keeper'));
  assert.notEqual(second.nonce, first.nonce);
  assert.notEqual(second.ciphertext, first.ciphertext);
  assert.equal(h.state.generations, 1);
});

test('site changes never decrypt the old scope and service IDs are authenticated', async () => {
  const h = harness();
  await h.vault.save({}, 'keeper', keeper, '', 'secret');
  assert.equal(await h.vault.has({}, 'keeper', magpie), false);
  assert.equal(await h.vault.load({}, 'keeper', magpie), undefined);
  assert.equal(h.state.decryptions, 0);
  h.records.set('magpie', h.records.get('keeper'));
  await assert.rejects(h.vault.load({}, 'magpie', keeper), /无法解密/);
  await h.vault.remove({}, 'keeper', magpie);
  assert.equal(h.records.has('keeper'), false, 'forget also clears a previous configured scope');
});

test('private entry URLs stay encrypted and reject another origin, path, unsafe scheme or userinfo', async () => {
  const h = harness(), link = magpie + '?key=private-key-that-must-stay-encrypted#accounts';
  await h.vault.save({}, 'magpie', magpie, '', link, 'entry-link');
  assert.equal(h.records.get('magpie').includes('private-key'), false);
  assert.equal(h.records.get('magpie').includes('?key='), false);
  const saved = await h.vault.load({}, 'magpie', magpie);
  assert.equal(saved.kind, 'entry-link');
  assert.equal(saved.secret, link);
  for (const url of [keeper + '?key=x', 'https://evil.example/magpie/?key=x',
    magpie.replace('https:', 'http:') + '?key=x', 'https://name:pass@libo.siasunagv.cn/magpie/?key=x',
    'https://libo.siasunagv.cn/magpie-other/?key=x', magpie + '%2e%2e/keeper/?key=x']) {
    await assert.rejects(h.vault.save({}, 'magpie', magpie, '', url, 'entry-link'), /私密入口/);
  }
});

test('tampered ciphertext, nonce, unknown kind and authenticated out-of-scope links are rejected', async () => {
  const h = harness();
  await h.vault.save({}, 'keeper', keeper, '', 'secret');
  const original = h.records.get('keeper');
  for (const field of ['ciphertext', 'nonce']) {
    const record = JSON.parse(original), bytes = Buffer.from(record[field], 'base64');
    bytes[0] ^= 1;
    record[field] = bytes.toString('base64');
    h.records.set('keeper', JSON.stringify(record));
    await assert.rejects(h.vault.load({}, 'keeper', keeper), /无法解密/);
  }
  for (const payload of [
    { scope: h.credentialScope(keeper), username: '', secret: 'secret', kind: 'unknown' },
    { scope: h.credentialScope(keeper), username: '', secret: magpie + '?key=x', kind: 'entry-link' },
    { scope: h.credentialScope(magpie), username: '', secret: 'secret', kind: 'password' }
  ]) {
    h.records.set('keeper', original);
    h.replacePayload('keeper', payload);
    await assert.rejects(h.vault.load({}, 'keeper', keeper), /无法解密/);
  }
  h.records.set('keeper', original);
  h.replacePayload('keeper', { scope: h.credentialScope(keeper), username: '', secret: 'legacy' });
  assert.equal((await h.vault.load({}, 'keeper', keeper)).kind, 'password');
  h.records.set('keeper', '{broken');
  await assert.rejects(h.vault.has({}, 'keeper', keeper), /已损坏/);
});

test('key, random, encryption and storage errors fail closed; a failed write does not block the next', async () => {
  for (const failure of ['key', 'generate', 'init', 'finish', 'random', 'short-random', 'preferences', 'put', 'flush']) {
    const h = harness();
    h.state.failure = failure;
    await assert.rejects(h.vault.save({}, 'keeper', keeper, '', 'never-plaintext'), /无法安全保存/);
    for (const value of h.records.values()) assert.equal(value.includes('never-plaintext'), false, failure);
    assert.ok(h.state.plainInput === undefined || h.state.plainInput.every(byte => byte === 0));
    if (failure === 'finish') assert.equal(h.state.aborts, 1);
    h.state.failure = '';
    await h.vault.save({}, 'keeper', keeper, '', 'recovered');
    assert.equal((await h.vault.load({}, 'keeper', keeper)).secret, 'recovered');
  }
  const h = harness();
  h.state.failure = 'missing-key-code';
  await h.vault.save({}, 'keeper', keeper, '', 'secret');
  h.state.failure = '';
  h.keys.clear();
  await assert.rejects(h.vault.load({}, 'keeper', keeper), /无法解密/);
  assert.equal(h.state.generations, 1, 'decrypt never regenerates a lost key');
  h.state.failure = 'get';
  await assert.rejects(h.vault.has({}, 'keeper', keeper), /simulated get/);
  h.state.failure = 'delete';
  await assert.rejects(h.vault.remove({}, 'keeper', keeper), /无法忘记/);
});

test('forget waits for an in-flight save across Vault instances and leaves no resurrected record', async () => {
  const h = harness();
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  h.state.beforeFinish = async () => { started(); await gate; };
  const save = h.vault.save({}, 'keeper', keeper, '', 'secret');
  await entered;
  const remove = new h.CredentialVault().remove({}, 'keeper', keeper);
  release();
  await Promise.all([save, remove]);
  assert.equal(h.records.size, 0);
  assert.equal(await h.vault.load({}, 'keeper', keeper), undefined);
});
