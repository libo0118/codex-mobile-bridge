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
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'strip' }) + '\nthis.result = {' + names.join(',') + '};', scope);
  return scope.result;
}

const settings = load('data/DownloadSettings.ets', ['DEFAULT_DOWNLOAD_LIMIT_MIB', 'MAX_DOWNLOAD_LIMIT_MIB', 'isDownloadLimitMiB', 'parseDownloadLimitMiB', 'downloadLimitBytes']);
const appearance = load('appearance/NavigationAppearance.ets', ['NavigationAppearance', 'decodeNavigationAppearance']);

function storeHarness(initial = []) {
  const cache = new Map([['computers', '[]'], ['language', 'en'], ['alerts', true], ['navigationAppearance', '{"blur":37}'], ['unrelated', 'keep'], ...initial]);
  const durable = new Map(cache);
  const calls = [];
  const prefs = {
    get: async (key, fallback) => cache.has(key) ? cache.get(key) : fallback,
    put: async (key, value) => { calls.push(['put', key, value]); cache.set(key, value); },
    flush: async () => { calls.push(['flush']); for (const [key, value] of cache) durable.set(key, value); }
  };
  const { ComputerStore } = load('data/ComputerStore.ets', ['ComputerStore'], { ...settings, ...appearance, preferences: { getPreferences: async () => prefs } });
  return { cache, durable, calls, prefs, create: async () => { const store = new ComputerStore(); await store.load({}); return store; }, ComputerStore };
}

test('missing or corrupt download preference defaults to 200 MB and invalid setters write nothing', async () => {
  const h = storeHarness();
  assert.equal(await new h.ComputerStore().savedDownloadLimitMiB(), 200);
  const store = await h.create();
  assert.equal(await store.savedDownloadLimitMiB(), 200);
  for (const invalid of [0, -1, 4097, 1.5, NaN, Infinity, '200', true, null, {}, []]) {
    h.cache.set('downloadLimitMiB', invalid);
    assert.equal(await store.savedDownloadLimitMiB(), 200);
    await assert.rejects(store.downloadLimitMiB(invalid), /1–4096/);
  }
  assert.equal(h.calls.length, 0);
});

test('download preference survives a new store and leaves other settings untouched', async () => {
  const h = storeHarness();
  const before = new Map(h.cache);
  await (await h.create()).downloadLimitMiB(4096);
  assert.equal(await (await h.create()).savedDownloadLimitMiB(), 4096);
  assert.equal(h.durable.get('downloadLimitMiB'), 4096);
  for (const [key, value] of before) assert.equal(h.cache.get(key), value, key);
  assert.deepEqual(h.calls, [['put', 'downloadLimitMiB', 4096], ['flush']]);
});

test('failed download preference flush restores its own cached and persisted value', async () => {
  const h = storeHarness([['downloadLimitMiB', 300]]), store = await h.create();
  const originalFlush = h.prefs.flush;
  let failures = 1;
  h.prefs.flush = async () => { if (failures-- > 0) throw new Error('disk error'); return originalFlush(); };
  await assert.rejects(store.downloadLimitMiB(500), /disk error/);
  assert.equal(await store.savedDownloadLimitMiB(), 300);
  assert.equal(h.durable.get('downloadLimitMiB'), 300);
  assert.equal(h.cache.get('language'), 'en'); assert.equal(h.cache.get('unrelated'), 'keep');
  h.prefs.flush = async () => { throw new Error('persistent disk error'); };
  await assert.rejects(store.downloadLimitMiB(600), /persistent disk error/);
  assert.equal(await store.savedDownloadLimitMiB(), 300);
  assert.equal(h.durable.get('downloadLimitMiB'), 300);
});

test('failed preference put does not replace the original error with rollback errors', async () => {
  const h = storeHarness([['downloadLimitMiB', 300]]), store = await h.create();
  h.prefs.put = async () => { throw new Error('put denied'); };
  await assert.rejects(store.downloadLimitMiB(500), /put denied/);
  assert.equal(await store.savedDownloadLimitMiB(), 300);
  assert.equal(h.durable.get('downloadLimitMiB'), 300);
});

function pageHarness(extra = {}) {
  const source = fs.readFileSync(path.join(root, 'pages/Index.ets'), 'utf8');
  const segment = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  const logic = (source.slice(0, source.indexOf('  @Builder')) +
    segment('  private async beginDownload(', '  private async saveDownload(') +
    segment('  onBackPress()', '  @Builder\n  private gatewayMenu()') + '\n}')
    .replace(/^import[^\n]+\n/gm, '').replace(/@\w+(?:\([^()\n]*\))?\s*/g, '').replace('struct Index', 'class Index');
  const stub = class {};
  const context = vm.createContext({ ...settings, getContext: () => ({}), ComputerStore: stub, ServiceStore: stub,
    ForegroundEvents: stub, webview: { WebviewController: stub }, ...extra });
  vm.runInContext(stripTypeScriptTypes(logic, { mode: 'strip' }) + '\nthis.Page = Index;', context);
  const page = new context.Page();
  page.ready = true;
  return page;
}

test('download settings cancel and dismiss discard drafts and invalid input stays open', async () => {
  const page = pageHarness();
  page.openDownloadSettings(); assert.equal(page.editDownloadLimit, '200');
  page.editDownloadLimit = '350'; page.closeDownloadSettings();
  page.openDownloadSettings(); assert.equal(page.editDownloadLimit, '200');
  let dismisses = 0;
  page.editDownloadLimit = '350'; page.dismissDownloadSettings({ dismiss: () => { dismisses++; } });
  assert.equal(dismisses, 1); assert.equal(page.downloadLimitMiB, 200);
  page.openDownloadSettings();
  for (const value of ['', '0', '4097', '-1', '+1', '1.5', '1e2', '200MB']) {
    page.editDownloadLimit = value;
    await page.saveDownloadSettings();
    assert.equal(page.downloadSettings, true); assert.equal(page.downloadLimitMiB, 200); assert.ok(page.downloadSettingsError);
  }
  assert.equal(page.onBackPress(), true); assert.equal(page.downloadSettings, false);
  page.navigationSettings = true; page.openDownloadSettings(); assert.equal(page.downloadSettings, false);
  page.navigationSettings = false; page.openDownloadSettings(); page.openNavigationSettings(); assert.equal(page.navigationSettings, false);
});

test('download settings update only after persistence and block duplicate save or dismissal', async () => {
  const page = pageHarness();
  let release, saves = 0, dismisses = 0;
  page.store.downloadLimitMiB = async value => { saves++; assert.equal(value, 350); await new Promise(resolve => { release = resolve; }); };
  page.openDownloadSettings(); page.editDownloadLimit = '350';
  const saving = page.saveDownloadSettings(); await page.saveDownloadSettings();
  assert.equal(saves, 1); assert.equal(page.downloadLimitMiB, 200); assert.equal(page.savingDownloadSettings, true);
  page.closeDownloadSettings(); page.dismissDownloadSettings({ dismiss: () => { dismisses++; } });
  assert.equal(page.onBackPress(), true); assert.equal(page.downloadSettings, true); assert.equal(dismisses, 0);
  release(); await saving;
  assert.equal(page.downloadLimitMiB, 350); assert.equal(page.downloadSettings, false); assert.equal(page.savingDownloadSettings, false);
  page.openDownloadSettings(); assert.equal(page.editDownloadLimit, '350');
  page.store.downloadLimitMiB = async () => { throw new Error('storage failed'); };
  page.editDownloadLimit = '600'; await page.saveDownloadSettings();
  assert.equal(page.downloadLimitMiB, 350); assert.equal(page.downloadSettings, true); assert.equal(page.downloadSettingsError, 'storage failed');
});

test('each download snapshots its saved byte budget even while settings change', async () => {
  const tasks = [], files = [];
  class AttachmentDownload {
    constructor(maxBytes) { this.maxBytes = maxBytes; tasks.push(this); }
    async fetch() { return await new Promise(resolve => { this.complete = () => { const file = { name: 'sample.bin', maxBytes: this.maxBytes }; files.push(file); resolve(file); }; }); }
    cancel() {}
  }
  const page = pageHarness({ AttachmentDownload, sameGateway: () => true, acceptsDownload: () => true, discardAttachment: () => {} });
  page.base = 'https://example.com'; page.currentURL = () => page.base + '/';
  page.store.downloadLimitMiB = async () => {};
  const first = page.beginDownload(page.base + '/attachment');
  assert.equal(tasks[0].maxBytes, 200 * 1024 * 1024);
  page.openDownloadSettings(); page.editDownloadLimit = '100'; await page.saveDownloadSettings();
  assert.equal(page.downloadLimitMiB, 100); assert.equal(tasks[0].maxBytes, 200 * 1024 * 1024);
  tasks[0].complete(); await first;
  assert.equal(page.downloaded.maxBytes, 200 * 1024 * 1024);
  page.cancelDownload();
  const second = page.beginDownload(page.base + '/attachment');
  assert.equal(tasks[1].maxBytes, 100 * 1024 * 1024);
  tasks[1].complete(); await second;
  assert.equal(files.length, 2);
});

test('stale download progress cannot replace a new task after cancellation', async () => {
  const tasks = [];
  class AttachmentDownload {
    constructor() { tasks.push(this); }
    fetch(_context, _controller, _target, _base, _valid, progress) {
      this.progress = progress;
      return new Promise((resolve, reject) => { this.complete = resolve; this.fail = reject; });
    }
    cancel() {}
  }
  const page = pageHarness({ AttachmentDownload, sameGateway: () => true, acceptsDownload: () => true, discardAttachment: () => {} });
  page.base = 'https://example.com'; page.currentURL = () => page.base + '/';
  const first = page.beginDownload(page.base + '/first');
  page.cancelDownload();
  const second = page.beginDownload(page.base + '/second');
  const nextLabel = page.downloadLabel;
  tasks[0].progress(1024);
  assert.equal(page.downloadLabel, nextLabel);
  tasks[0].fail(Error('cancelled')); await first;
  assert.equal(page.downloadBusy, true);
  tasks[1].progress(2048); assert.match(page.downloadLabel, /2 KiB/);
  tasks[1].complete({ name: 'second.bin' }); await second;
  assert.equal(page.downloaded.name, 'second.bin');
});
