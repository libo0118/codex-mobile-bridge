const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');

const root = path.join(__dirname, '../harmony/entry/src/main/ets');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const strip = source => stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, ''), { mode: 'strip' });
const uuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function native(options = {}) {
  const calls = [], disk = new Map(), fdPaths = new Map();
  let nextFd = 0;
  const fileSystem = {
    OpenMode: { CREATE: 64, READ_WRITE: 2, READ_ONLY: 0 },
    open: async (uri, mode) => {
      calls.push(['open', uri, mode]);
      const filename = uri.startsWith('file://') ? uri.slice(7) : uri;
      if (mode & 64) disk.set(filename, Buffer.alloc(0));
      if (!disk.has(filename)) throw Error('not readable');
      const fd = ++nextFd; fdPaths.set(fd, filename); return { fd };
    },
    close: async file => { calls.push(['close', file.fd]); fdPaths.delete(file.fd); },
    stat: async fd => ({ size: disk.get(fdPaths.get(fd)).length }),
    unlinkSync: filename => { calls.push(['unlink', filename]); if (!disk.delete(filename)) throw Error('not found'); },
    listFileSync: directory => [...disk.keys()].filter(value => value.startsWith(directory + '/')).map(value => value.slice(directory.length + 1))
  };
  const cameraPicker = {
    PickerMediaType: { PHOTO: 'photo' },
    pick: async (context, types, profile) => {
      calls.push(['camera', context, [...types], { ...profile }]);
      if (options.cameraError) throw Error('camera unavailable');
      if (!options.cancel && !options.empty) disk.set(profile.saveUri.slice(7), Buffer.from([0xff, 0xd8, 0xff]));
      return { resultCode: options.cancel ? -1 : 0, resultUri: options.resultUri ?? profile.saveUri, mediaType: options.mediaType ?? 'photo' };
    }
  };
  const documents = options.documents ?? ['file://docs/file.txt'];
  for (const uri of documents) if (uri.startsWith('file://')) disk.set(uri.slice(7), Buffer.from('content'));
  const scope = vm.createContext({ fs: fileSystem, cameraPicker, camera: { CameraPosition: { CAMERA_POSITION_BACK: 1 } },
    fileUri: { getUriFromPath: name => 'file://' + name }, util: { generateRandomUUID: () => uuid },
    picker: { DocumentViewPicker: class { async select(value) { calls.push(['documents', { ...value }]); return documents; } } } });
  vm.runInContext(strip(read('web/CameraCapture.ets')) + '\n' + strip(read('web/Files.ets')) +
    '\nthis.api = { acceptsCameraPhoto, capturePhoto, discardCapture, clearStaleCaptures, selectUpload };', scope);
  return { api: scope.api, calls, disk, context: { cacheDir: '/cache' } };
}

test('capture accepts JPEG requests only', () => {
  const { api } = native();
  const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  assert.equal(api.acceptsCameraPhoto(imageTypes), true);
  assert.equal(api.acceptsCameraPhoto([' IMAGE/PNG, image/JPEG ,image/gif,image/webp ']), true);
  for (const types of [['image/*'], ['.jpg'], ['.jpeg']]) assert.equal(api.acceptsCameraPhoto(types), true);
  for (const types of [[], [''], ['application/pdf'], ['video/*'], ['image/png'], ['image/webp']]) assert.equal(api.acceptsCameraPhoto(types), false);
});

test('the existing document picker accepts image files and validates selected URI/count', async () => {
  for (const [uri, multiple] of [['file://unindexed/image.jpg', true], ['file://docs/file.txt', false]]) {
    const h = native({ documents: [uri] });
    assert.deepEqual(Array.from(await h.api.selectUpload(h.context, multiple)), [uri]);
    assert.deepEqual(h.calls.find(value => value[0] === 'documents'), ['documents', { maxSelectNumber: multiple ? 20 : 1 }]);
  }
  for (const options of [{ documents: ['https://example/image.jpg'] }, { documents: ['content://other'] }, { documents: ['file://a', 'file://b'] }]) {
    const other = native(options);
    await assert.rejects(other.api.selectUpload(other.context, false));
  }
});

test('native camera uses an app-owned JPEG file, rear camera and no public media URI', async () => {
  const h = native(), image = await h.api.capturePhoto(h.context, () => true);
  const name = `/cache/bridge-camera-${uuid}.jpg`;
  assert.equal(image.path, name); assert.equal(image.uri, 'file://' + name);
  assert.deepEqual(h.calls.find(value => value[0] === 'camera'), ['camera', h.context, ['photo'], { cameraPosition: 1, saveUri: image.uri }]);
  assert.equal(h.disk.has(name), true);
  assert.equal(h.calls.filter(value => value[0] === 'unlink').length, 0, 'a returned file is kept for the Web reader');
  h.api.discardCapture(image); assert.equal(h.disk.has(name), false);
});

test('camera cancellation, failure, wrong result and empty output discard only the unhanded private file', async () => {
  for (const options of [{ cancel: true }, { cameraError: true }, { resultUri: 'file://other/image.jpg' }, { mediaType: 'video' }, { empty: true }]) {
    const h = native(options);
    if (options.cancel) assert.equal(await h.api.capturePhoto(h.context, () => true), undefined);
    else await assert.rejects(h.api.capturePhoto(h.context, () => true));
    assert.equal(h.disk.has(`/cache/bridge-camera-${uuid}.jpg`), false);
    assert.deepEqual(h.calls.filter(value => value[0] === 'unlink').map(value => value[1]), [`/cache/bridge-camera-${uuid}.jpg`]);
  }
});

test('a page change before the system camera opens deletes its unused placeholder', async () => {
  const h = native();
  assert.equal(await h.api.capturePhoto(h.context, () => false), undefined);
  assert.equal(h.calls.some(value => value[0] === 'camera'), false);
  assert.equal(h.disk.has(`/cache/bridge-camera-${uuid}.jpg`), false);
});

test('startup cleanup is one time per process and never touches other caches', () => {
  const h = native();
  const names = [`bridge-camera-${uuid}.jpg`, `bridge-camera-${uuid}.png`, `bridge-camera-${uuid}.jpg.bak`, `bridge-attachment-${uuid}`, 'bridge-camera-------------------------------------.jpg', 'private.jpg'];
  for (const name of names) h.disk.set('/cache/' + name, Buffer.from('old'));
  h.api.clearStaleCaptures(h.context);
  assert.deepEqual(h.calls.filter(value => value[0] === 'unlink').map(value => value[1]), ['/cache/' + names[0]]);
  h.disk.set('/cache/' + names[0], Buffer.from('live'));
  h.api.clearStaleCaptures(h.context); assert.equal(h.disk.has('/cache/' + names[0]), true);
});

function pageHarness(options = {}) {
  const source = read('pages/Index.ets');
  const method = source.match(/  private async upload\(event: OnShowFileSelectorEvent\): Promise<void> \{[\s\S]*?\n  \}/)[0];
  const calls = [], replies = [];
  const scope = vm.createContext({
    FileSelectorMode: { FileOpenMode: 0, FileOpenMultipleMode: 1, FileOpenFolderMode: 2, FileSaveMode: 3 },
    sameGateway: (current, base) => current.startsWith(base + '/'), isPreviewShell: value => value.includes('html-preview-shell'),
    uploadGestureScript: token => token, webString: value => JSON.parse(value),
    acceptsCameraPhoto: types => types.includes('image/jpeg'),
    selectUpload: async (_context, multiple) => { calls.push(['picker', multiple]); if (options.select) return options.select(); return ['file://selected']; },
    capturePhoto: async (_context, canOpen) => { calls.push(['camera']); if (options.capture) return options.capture(canOpen); return { path: '/cache/owned.jpg', uri: 'file://owned.jpg' }; },
    discardCapture: capture => { calls.push(['discard', capture.path]); if (options.discardError) throw Error('cannot delete'); },
    console: { error: value => { calls.push(['error', value]); } }
  });
  vm.runInContext(strip('class Page {\n' + method + '\n}\nthis.Page = Page;'), scope);
  const page = new scope.Page();
  Object.assign(page, { generation: 1, base: 'http://gateway:18787', activeTab: 'codex', foreground: true, token: 'token', context: {},
    currentURL: () => page.url, url: 'http://gateway:18787/#first', L: (zh) => zh,
    controller: { runJavaScript: async () => { if (options.gesture) return options.gesture(); return '"true"'; } } });
  const event = { fileSelector: { getMode: () => options.mode ?? 0, isCapture: () => !!options.isCapture, getAcceptType: () => options.types ?? [] },
    result: { handleFileList: list => { replies.push(Array.from(list)); if (options.callbackError) throw Error('callback error'); } } };
  return { page, event, calls, replies };
}

test('user-initiated capture reaches camera; photos and documents remain separate', async () => {
  for (const [input, call, reply] of [
    [{ isCapture: true, types: ['image/png', 'image/jpeg'] }, ['camera'], ['file://owned.jpg']],
    [{ types: ['image/png', 'image/jpeg'], mode: 1 }, ['picker', true], ['file://selected']],
    [{ types: [], mode: 1 }, ['picker', true], ['file://selected']],
    [{ isCapture: true, types: ['video/*'] }, ['picker', false], ['file://selected']]
  ]) {
    const h = pageHarness(input); await h.page.upload(h.event);
    assert.deepEqual(h.calls[0], call); assert.deepEqual(h.replies, [reply]);
  }
});

test('changes while the gesture is being checked never open a picker', async () => {
  for (const changed of ['generation', 'hash', 'tab', 'foreground']) {
    let release;
    const h = pageHarness({ isCapture: true, types: ['image/jpeg'], gesture: () => new Promise(resolve => { release = resolve; }) });
    const pending = h.page.upload(h.event);
    if (changed === 'generation') h.page.generation++;
    if (changed === 'hash') h.page.url = 'http://gateway:18787/#second';
    if (changed === 'tab') h.page.activeTab = 'keeper';
    if (changed === 'foreground') h.page.foreground = false;
    release('"true"'); await pending;
    assert.deepEqual(h.calls, [], changed); assert.deepEqual(h.replies, [[]], changed);
  }
});

test('the final camera launch rechecks page identity, and a stale library result is not delivered', async () => {
  let proceed;
  const camera = pageHarness({ isCapture: true, types: ['image/jpeg'], capture: canOpen => new Promise(resolve => { proceed = () => resolve(canOpen() ? { path: '/cache/owned.jpg', uri: 'file://owned.jpg' } : undefined); }) });
  const pendingCamera = camera.page.upload(camera.event); await new Promise(setImmediate);
  camera.page.url = 'http://gateway:18787/#second'; proceed(); await pendingCamera;
  assert.deepEqual(camera.replies, [[]]);
  let select;
  const library = pageHarness({ types: ['image/jpeg'], select: () => new Promise(resolve => { select = resolve; }) });
  const pendingLibrary = library.page.upload(library.event); await new Promise(setImmediate);
  library.page.activeTab = 'keeper'; select(['file://selected']); await pendingLibrary;
  assert.deepEqual(library.replies, [[]]);
});

test('gesture, preview, navigation, active tab and picker failures return one cancellation', async () => {
  for (const change of ['gesture', 'generation', 'hash', 'origin', 'tab', 'foreground', 'preview', 'folder', 'camera']) {
    let release;
    const options = { isCapture: true, types: ['image/jpeg'] };
    if (change === 'gesture') options.gesture = () => '"false"';
    if (change === 'folder') options.mode = 2;
    if (change === 'camera') options.capture = async () => { throw Error('no camera'); };
    if (['generation', 'hash', 'origin', 'tab'].includes(change)) options.capture = () => new Promise(resolve => { release = resolve; });
    const h = pageHarness(options);
    if (change === 'foreground') h.page.foreground = false;
    if (change === 'preview') h.page.url += '/html-preview-shell';
    const pending = h.page.upload(h.event);
    if (options.capture && change !== 'camera') {
      await new Promise(setImmediate);
      if (change === 'generation') h.page.generation++;
      if (change === 'hash') h.page.url = 'http://gateway:18787/#second';
      if (change === 'origin') h.page.url = 'http://evil/';
      if (change === 'tab') h.page.activeTab = 'keeper';
      release({ path: '/cache/owned.jpg', uri: 'file://owned.jpg' });
    }
    await pending;
    assert.deepEqual(h.replies, [[]], change);
    if (['generation', 'hash', 'origin', 'tab'].includes(change)) assert.deepEqual(h.calls.at(-1), ['discard', '/cache/owned.jpg']);
    if (['gesture', 'folder', 'foreground', 'preview'].includes(change)) assert.equal(h.calls.some(call => call[0] === 'camera'), false);
  }
});

test('camera may temporarily background the app, and a throwing result handler is never invoked twice', async () => {
  let release;
  const h = pageHarness({ isCapture: true, types: ['image/jpeg'], capture: () => new Promise(resolve => { release = resolve; }), callbackError: true });
  const pending = h.page.upload(h.event); await new Promise(setImmediate); h.page.foreground = false;
  release({ path: '/cache/owned.jpg', uri: 'file://owned.jpg' });
  await assert.rejects(pending, /callback error/);
  assert.deepEqual(h.replies, [['file://owned.jpg']]);
  assert.equal(h.calls.some(call => call[0] === 'discard'), false, 'a possibly handed-off file must not be removed');
});

test('a failed cleanup reports the failure but still sends exactly one cancellation', async () => {
  let release;
  const h = pageHarness({ isCapture: true, types: ['image/jpeg'], discardError: true,
    capture: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.page.upload(h.event); await new Promise(setImmediate); h.page.url += '-new';
  release({ path: '/cache/owned.jpg', uri: 'file://owned.jpg' }); await pending;
  assert.deepEqual(h.replies, [[]]);
  assert.equal(h.calls.filter(call => call[0] === 'discard').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'error').length, 1);
});
