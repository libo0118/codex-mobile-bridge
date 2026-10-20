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
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'strip' }) + '\nthis.api = {' + names.join(',') + '};', scope);
  return scope.api;
}
const policy = load('data/DownloadSettings.ets', ['DEFAULT_DOWNLOAD_LIMIT_MIB', 'MAX_DOWNLOAD_LIMIT_MIB', 'isDownloadLimitMiB', 'parseDownloadLimitMiB', 'downloadLimitBytes']);
const scripts = load('web/DownloadScript.ets', ['downloadStartScript', 'downloadPollScript', 'downloadClearScript', 'webString', 'downloadTimeoutMs', 'validDownloadBytes',
  'DOWNLOAD_CHUNK_BYTES', 'DOWNLOAD_QUEUE_CHUNKS', 'DOWNLOAD_BATCH_CHUNKS'], policy);
const base = 'https://example.com/d/' + 'a'.repeat(32);
const target = base + '/api/sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/files/' + 'b'.repeat(64);
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };

function browser(options = {}) {
  let reads = 0, cancelled = false, signal;
  const timers = new Map(); let timerId = 0;
  const scope = vm.createContext({ URL, AbortController, btoa, Uint8Array, location: { origin: 'https://example.com' },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, request) => {
      assert.equal(url, target); assert.equal(request.credentials, 'same-origin');
      assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store'); signal = request.signal;
      if (options.failure) throw Error(options.failure);
      let index = 0;
      return { ok: options.ok ?? true, status: options.status ?? 200, redirected: options.redirected ?? false, url: options.url ?? target,
        headers: { get: name => name === 'content-length' ? options.length ?? null : options.disposition ?? 'attachment; filename="sample.bin"' },
        body: options.noBody ? null : { getReader: () => ({ read: async () => {
          reads++;
          if (options.read) return options.read(index++, request.signal);
          if (options.disconnect && index > 0) throw Error('disconnected');
          const bytes = (options.chunks ?? [new Uint8Array([1, 2, 3])])[index++];
          return bytes ? { done: false, value: bytes } : { done: true };
        }, cancel: async () => { cancelled = true; } }) }
      };
    }
  });
  vm.runInContext('window=this;top=this;', scope);
  return { scope, timers, execute: code => vm.runInContext(code, scope), get reads() { return reads; },
    get cancelled() { return cancelled; }, get signal() { return signal; },
    start(limit) { return this.execute(scripts.downloadStartScript(target, 'slot', limit)); },
    poll() { return JSON.parse(this.execute(scripts.downloadPollScript('slot'))); },
    clear() { return this.execute(scripts.downloadClearScript('slot')); }
  };
}

function native(options = {}) {
  const web = browser(options), cache = new Map(), calls = [], fds = new Map(); let nextFd = 10, uuid = 0;
  let valid = true, task, bridgeCalls = 0;
  const fileSystem = { OpenMode: { CREATE: 64, READ_WRITE: 2, TRUNC: 512, READ_ONLY: 0 },
    open: async (name, mode) => {
      calls.push(['open', name, mode]);
      if (mode & 64) cache.set(name, Buffer.alloc(0));
      if (!cache.has(name)) throw Error('missing cache');
      const fd = ++nextFd; fds.set(fd, name); return { fd };
    },
    write: async (fd, bytes) => {
      calls.push(['write', bytes.byteLength]);
      if (options.beforeWrite) await options.beforeWrite({ web, task, invalidate: () => { valid = false; } });
      if (options.writeFailure) throw Error('disk full');
      const written = options.partialWrite ? bytes.byteLength - 1 : bytes.byteLength;
      cache.set(fds.get(fd), Buffer.concat([cache.get(fds.get(fd)), Buffer.from(bytes).subarray(0, written)]));
      return written;
    },
    stat: async fd => ({ size: cache.get(fds.get(fd)).length + (options.badStat ? 1 : 0) }),
    close: async file => { calls.push(['close', file.fd]); fds.delete(file.fd); },
    unlinkSync: name => { calls.push(['unlink', name]); cache.delete(name); }
  };
  const controller = { runJavaScript: async code => {
    if (++bridgeCalls === options.stallBridgeAt) return new Promise(() => {});
    let result = web.execute(code);
    if (typeof result === 'string' && result.startsWith('{') && options.tamper) result = options.tamper(JSON.parse(result));
    return JSON.stringify(result);
  } };
  const api = load('web/Files.ets', ['AttachmentDownload', 'DownloadFile', 'saveAttachment'], { ...policy, ...scripts,
    fs: fileSystem, util: { generateRandomUUID: () => `aaaaaaaa-aaaa-aaaa-aaaa-${String(++uuid).padStart(12, '0')}`,
      Base64Helper: class { decodeSync(value) { return Buffer.from(value, 'base64'); } } },
    ...(options.timeoutMs ? { downloadTimeoutMs: () => options.timeoutMs } : {}),
    Uint8Array, setTimeout: (resolve, delay) => delay === 100 ? setImmediate(resolve) : setTimeout(resolve, delay), clearTimeout,
    acceptsDownload: (url, gateway) => url === target && gateway === base,
    safeFilename: value => value.replace(/[\\/]/g, '_'), picker: {} });
  task = new api.AttachmentDownload(options.limit ?? policy.downloadLimitBytes(policy.DEFAULT_DOWNLOAD_LIMIT_MIB));
  return { api, task, controller, web, cache, calls,
    invalidate: () => { valid = false; },
    fetch: () => task.fetch({ cacheDir: '/cache' }, controller, options.target ?? target, base, () => valid, options.progress ?? (() => {})) };
}

test('download setting defaults to 200 MiB and accepts only bounded whole decimal MB values', () => {
  assert.equal(policy.DEFAULT_DOWNLOAD_LIMIT_MIB, 200); assert.equal(policy.MAX_DOWNLOAD_LIMIT_MIB, 4096);
  assert.equal(policy.downloadLimitBytes(200), 209715200); assert.equal(policy.downloadLimitBytes(4096), 4294967296);
  for (const value of [0, -1, 1.1, NaN, Infinity, 4097, '200', null, true]) {
    assert.equal(policy.isDownloadLimitMiB(value), false); assert.throws(() => policy.downloadLimitBytes(value));
  }
  for (const value of ['', '0', '-1', '+2', '1.5', '1e2', '0x10', 'Infinity', '4097', '200MB']) assert.equal(policy.parseDownloadLimitMiB(value), undefined);
  assert.equal(policy.parseDownloadLimitMiB(' 200 '), 200); assert.equal(policy.parseDownloadLimitMiB('0002'), 2);
  assert.equal(scripts.downloadTimeoutMs(200 * 1024 * 1024), 1720000);
  assert.equal(scripts.downloadTimeoutMs(1), 600000); assert.equal(scripts.downloadTimeoutMs(4096 * 1024 * 1024), 7200000);
});

test('producer applies backpressure at eight chunks and each synchronous pull is bounded', async () => {
  const chunk = new Uint8Array(32768).fill(7), web = browser({ chunks: Array(40).fill(chunk) });
  try {
    assert.equal(web.start(2 * 1024 * 1024), true); await tick();
    assert.equal(web.scope.slot.chunks.length, 8); assert.equal(web.reads, 8);
    assert.equal(web.scope.slot.status, 'loading');
    const first = web.poll(); assert.equal(first.chunks.length, 4); assert.equal(first.offset, 0);
    assert.ok(JSON.stringify(first).length < 180000); await tick();
    assert.equal(web.scope.slot.chunks.length, 8); assert.equal(web.reads, 12);
    let count = first.chunks.length;
    for (let i = 0; i < 30; i++) {
      const state = web.poll(); count += state.chunks.length; assert.ok(web.scope.slot.chunks.length <= 8);
      await tick(); if (state.status === 'ready' && count === state.count) break;
    }
    assert.equal(count, 40); assert.equal(web.scope.slot.status, 'ready');
  } finally { web.clear(); }
});

test('new default allows a header above the previous 20 MiB cap without allocating a full file', async () => {
  let release;
  const web = browser({ length: String(21 * 1024 * 1024), read: () => new Promise(resolve => { release = resolve; }) });
  web.start(); await tick(); assert.equal(web.scope.slot.status, 'loading'); assert.equal(web.reads, 1);
  web.clear(); release({ done: true }); await tick(); assert.equal(web.signal.aborted, true); assert.equal(web.scope.slot, undefined);
});

test('redirects, invalid header, overflow and truncation fail closed and release queued data', async () => {
  for (const options of [{ failure: 'redirect rejected' }, { url: 'https://evil.com/file' }, { redirected: true }, { ok: false }, { noBody: true },
    { length: '4' }, { length: '' }, { length: '-1' }, { length: '1e1' }, { length: '9007199254740993' },
    { chunks: [new Uint8Array(3), new Uint8Array(1)] }, { length: '2' }, { disconnect: true }]) {
    const web = browser(options);
    try { web.start(3); await tick(); assert.equal(web.scope.slot.status, 'error', JSON.stringify(options)); assert.equal(web.scope.slot.chunks.length, 0); }
    finally { web.clear(); }
  }
});

test('gateway rejection distinguishes download policy, login and other HTTP errors without reading a body', async () => {
  for (const [status, message] of [[400, /网关下载上限/], [413, /网关下载上限/], [401, /重新登录/], [403, /重新登录/], [500, /网关下载失败/]]) {
    const web = browser({ ok: false, status });
    try {
      web.start(3); await tick(); const state = web.poll();
      assert.equal(state.status, 'error'); assert.match(state.error, message); assert.match(state.error, new RegExp('HTTP ' + status));
      assert.equal(web.reads, 0); assert.equal(state.chunks.length, 0); assert.equal(web.timers.size, 0);
    } finally { web.clear(); }
  }
});

test('cancelling a producer waiting for queue capacity wakes it and clears its slot and timer', async () => {
  const web = browser({ chunks: Array(10).fill(new Uint8Array(32768)) });
  web.start(400000); await tick(); assert.equal(web.scope.slot.chunks.length, 8);
  const state = web.scope.slot; web.clear(); await tick();
  assert.equal(state.status, 'error'); assert.equal(state.chunks.length, 0); assert.equal(web.cancelled, true);
  assert.equal(web.signal.aborted, true); assert.equal(web.scope.slot, undefined); assert.equal(web.timers.size, 0);
});

test('the finite browser deadline also releases a stalled full queue', async () => {
  const web = browser({ chunks: Array(10).fill(new Uint8Array(32768)) });
  web.start(400000); await tick(); assert.equal(web.timers.size, 1);
  web.timers.values().next().value(); await tick();
  assert.equal(web.scope.slot.status, 'error'); assert.equal(web.scope.slot.chunks.length, 0);
  assert.equal(web.cancelled, true); assert.equal(web.signal.aborted, true); assert.equal(web.timers.size, 0); web.clear();
});

test('native consumer writes while fetching and completes only after EOF and all queued bytes', async () => {
  let release, first = true, observedBeforeEOF = false;
  const h = native({ limit: 3, read: async () => {
    if (first) { first = false; return { done: false, value: new Uint8Array([1, 2, 3]) }; }
    return new Promise(resolve => { release = resolve; });
  }, beforeWrite: async () => { observedBeforeEOF = true; assert.equal(h.web.scope[Object.keys(h.web.scope).find(key => key.startsWith('__bridgeDownload_'))].status, 'loading'); } });
  const pending = h.fetch(); await tick();
  assert.equal(observedBeforeEOF, true); assert.equal(h.cache.values().next().value.length, 3);
  let done = false; pending.then(() => { done = true; }); await tick(); assert.equal(done, false);
  release({ done: true }); const file = await pending;
  assert.equal(file.size, 3); assert.equal(file.maxBytes, 3); assert.equal(h.cache.get(file.path).toString('hex'), '010203');
  assert.equal(h.calls.filter(call => call[0] === 'write').length, 1); assert.equal(h.web.timers.size, 0);
});

test('native download reconstructs multiple batches with constant queue and exact decoded bytes', async () => {
  const data = new Uint8Array(32768).fill(123), h = native({ limit: 400000, chunks: Array(10).fill(data), length: String(327680) });
  const file = await h.fetch(); assert.equal(file.size, 327680);
  assert.deepEqual(h.cache.get(file.path), Buffer.alloc(327680, 123)); assert.equal(h.web.timers.size, 0);
});

test('zero-byte streams are valid only after complete EOF; declared nonempty truncated streams are discarded', async () => {
  const h = native({ limit: 1, length: '0', chunks: [] });
  const file = await h.fetch(); assert.equal(file.size, 0); assert.equal(h.cache.get(file.path).length, 0);
  const broken = native({ limit: 3, length: '3', chunks: [] });
  await assert.rejects(broken.fetch(), /连接中断/); assert.equal(broken.cache.size, 0);
});

test('native validation rejects malformed metadata and chunks before reporting a ready file', async () => {
  const changes = [state => ({ ...state, offset: 1 }), state => ({ ...state, size: -1 }), state => ({ ...state, size: '3' }),
    state => ({ ...state, count: 4.5 }), state => ({ ...state, name: 'x'.repeat(1025) }), state => ({ ...state, chunks: ['%%%'] }),
    state => ({ ...state, chunks: ['AQ='] }), state => ({ ...state, chunks: [''] }), state => ({ ...state, chunks: [1] }),
    state => ({ ...state, chunks: Array(5).fill('AQ==') }), state => ({ ...state, status: 'unexpected' }),
    state => ({ ...state, chunks: ['AAAA'.repeat(10924)] }), state => ({ ...state, size: 2 })];
  for (const change of changes) {
    const h = native({ limit: 3, tamper: state => JSON.stringify(change(state)) });
    await assert.rejects(h.fetch()); assert.equal(h.cache.size, 0); assert.equal(h.web.timers.size, 0);
  }
});

test('partial writes, disk failures, size inconsistency and midstream overflow remove partial native caches', async () => {
  for (const options of [{ partialWrite: true }, { writeFailure: true }, { badStat: true },
    { chunks: [new Uint8Array(2), new Uint8Array(2)] }, { beforeWrite: async ({ invalidate }) => invalidate() }]) {
    const h = native({ limit: 3, ...options }); await assert.rejects(h.fetch()); assert.equal(h.cache.size, 0); assert.equal(h.web.timers.size, 0);
  }
});

test('task cancellation and URL/connection changes never return a ready file', async () => {
  const h = native({ limit: 3, beforeWrite: async ({ task }) => task.cancel(h.controller) });
  await assert.rejects(h.fetch()); assert.equal(h.cache.size, 0);
  const changed = native({ target: 'https://evil.com/file' }); await assert.rejects(changed.fetch()); assert.equal(changed.calls.length, 0);
  const stale = native(); stale.invalidate(); await assert.rejects(stale.fetch()); assert.equal(stale.calls.length, 0);
  for (const value of [0, -1, 1.5, NaN, Infinity, 4294967297]) assert.throws(() => new h.api.AttachmentDownload(value));
});

async function within(pending) {
  let timer;
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('native bridge test watchdog')), 150);
    })]);
  } finally { clearTimeout(timer); }
}

test('native bridge deadline covers stalled start and queue-drain calls', async () => {
  for (const stallBridgeAt of [1, 2]) {
    const h = native({ limit: 3, stallBridgeAt, timeoutMs: 15 });
    try {
      await assert.rejects(within(h.fetch()), /下载超时/);
      assert.equal(h.cache.size, 0);
      assert.equal(h.calls.filter(call => call[0] === 'close').length, 1);
      assert.equal(h.web.timers.size, 0);
    } finally { h.task.cancel(h.controller); }
  }
});

test('native bridge cancellation immediately releases a stalled call and partial cache', async () => {
  const h = native({ limit: 3, stallBridgeAt: 2, timeoutMs: 1000 });
  const pending = h.fetch(); await tick();
  h.task.cancel(h.controller);
  await assert.rejects(within(pending), /取消/);
  assert.equal(h.cache.size, 0);
  assert.equal(h.calls.filter(call => call[0] === 'close').length, 1);
  assert.equal(h.web.timers.size, 0);
});

test('download freezes its own budget before, during and after unrelated preference changes', async () => {
  let setting = 3;
  const h = native({ limit: setting, beforeWrite: async () => { setting = 1; } });
  setting = 2; const file = await h.fetch(); setting = 1;
  assert.equal(file.maxBytes, 3); assert.equal(file.size, 3); assert.equal(setting, 1);
  // The save path validates against the captured task budget, not a later preference/default.
  const calls = [], cached = { size: 3 }, destination = { size: 0 };
  const saveApi = load('web/Files.ets', ['saveAttachment'], { ...policy, ...scripts, fs: {
    OpenMode: { READ_ONLY: 0, READ_WRITE: 2 }, open: async uri => ({ fd: uri.startsWith('/cache') ? 1 : 2 }),
    stat: async fd => fd === 1 ? cached : destination, close: async () => {}, copyFile: async () => { calls.push('copy'); destination.size = 3; }
  }, picker: { DocumentViewPicker: class { async save() { return ['file://documents/output.bin']; } } } });
  assert.equal(await saveApi.saveAttachment({ cacheDir: '/cache' }, file), true); assert.deepEqual(calls, ['copy']);
});
