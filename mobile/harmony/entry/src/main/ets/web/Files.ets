import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import picker from '@ohos.file.picker';
import util from '@ohos.util';
import webview from '@ohos.web.webview';
import { acceptsDownload, safeFilename } from '../security/GatewayURL';
import { DEFAULT_DOWNLOAD_LIMIT_MIB, downloadLimitBytes } from '../data/DownloadSettings';
import { DOWNLOAD_CHUNK_BYTES, DOWNLOAD_QUEUE_CHUNKS, DOWNLOAD_BATCH_CHUNKS, validDownloadBytes, downloadTimeoutMs, downloadStartScript, downloadPollScript, downloadClearScript, webString } from './DownloadScript';

class DownloadState {
  status: string = '';
  name: string = 'download';
  size: number = 0;
  count: number = 0;
  offset: number = 0;
  chunks: string[] = [];
  error: string = '';
}

export class DownloadFile {
  path: string;
  name: string;
  size: number;
  readonly maxBytes: number;
  constructor(path: string, name: string, size: number,
    maxBytes: number = downloadLimitBytes(DEFAULT_DOWNLOAD_LIMIT_MIB)) {
    this.path = path;
    this.name = name;
    this.size = size;
    this.maxBytes = maxBytes;
  }
}

export async function selectUpload(context: common.UIAbilityContext, multiple: boolean): Promise<string[]> {
  const documentPicker = new picker.DocumentViewPicker(context);
  const selected = await documentPicker.select({ maxSelectNumber: multiple ? 20 : 1 });
  if (selected.length > (multiple ? 20 : 1)) throw new Error('选择的文件过多');
  for (const uri of selected) {
    if (!uri.startsWith('file://')) throw new Error('请从系统文件选择器重新选择文件');
    const file = await fs.open(uri, fs.OpenMode.READ_ONLY);
    await fs.close(file);
  }
  return selected;
}

export class AttachmentDownload {
  private slot: string = '';
  private cancelled: boolean = false;
  private temp: string = '';
  private readonly maxBytes: number;
  private rejectPending?: () => void;

  constructor(maxBytes: number = downloadLimitBytes(DEFAULT_DOWNLOAD_LIMIT_MIB)) {
    if (!validDownloadBytes(maxBytes)) throw new Error('下载阈值无效');
    this.maxBytes = maxBytes;
  }

  cancel(controller: webview.WebviewController): void {
    this.cancelled = true;
    if (this.rejectPending) this.rejectPending();
    if (this.slot) controller.runJavaScript(downloadClearScript(this.slot)).catch(() => {});
    if (this.temp) { try { fs.unlinkSync(this.temp); } catch (_) {} }
  }

  private async runScript(controller: webview.WebviewController, script: string, deadline: number): Promise<string> {
    if (this.cancelled) throw new Error('下载已取消');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('下载超时，请重试');
    let timer: number = -1;
    try {
      return await new Promise<string>((resolve, reject): void => {
        this.rejectPending = (): void => { reject(new Error('下载已取消')); };
        timer = setTimeout((): void => { reject(new Error('下载超时，请重试')); }, remaining);
        controller.runJavaScript(script).then((value: string): void => { resolve(value); }, (error: Error): void => { reject(error); });
      });
    } finally {
      if (timer !== -1) clearTimeout(timer);
      this.rejectPending = undefined;
    }
  }

  async fetch(context: common.UIAbilityContext, controller: webview.WebviewController, target: string, base: string,
    valid: () => boolean, progress: (bytes: number) => void): Promise<DownloadFile> {
    if (!acceptsDownload(target, base) || !valid()) throw new Error('此下载不是当前电脑的附件');
    this.slot = '__bridgeDownload_' + util.generateRandomUUID().replace(new RegExp('-', 'g'), '');
    this.temp = context.cacheDir + '/bridge-attachment-' + util.generateRandomUUID();
    const deadline = Date.now() + downloadTimeoutMs(this.maxBytes);
    let openFile: fs.File | undefined;
    try {
      openFile = await fs.open(this.temp, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      const started = await this.runScript(controller, downloadStartScript(target, this.slot, this.maxBytes), deadline);
      if (webString(started) !== 'true') throw new Error('下载页面已经变化');
      const decoder = new util.Base64Helper();
      let total = 0;
      let consumed = 0;
      let observedSize = 0;
      let name = 'download';
      for (;;) {
        if (this.cancelled || !valid()) throw new Error('电脑连接已变化，下载已取消');
        if (Date.now() > deadline) throw new Error('下载超时，请重试');
        const result = await this.runScript(controller, downloadPollScript(this.slot), deadline);
        const jsonLimit = DOWNLOAD_BATCH_CHUNKS * 43692 + 4096;
        if (typeof result !== 'string' || result.length > jsonLimit * 2 + 8) throw new Error('下载数据无效');
        const json = webString(result);
        if (typeof json !== 'string' || json.length > jsonLimit) throw new Error('下载数据无效');
        const state = JSON.parse(json) as DownloadState;
        if (!state) throw new Error('下载数据无效');
        if (state.status === 'error') throw new Error(typeof state.error === 'string' ? state.error.slice(0, 512) : '下载失败，请重试');
        if ((state.status !== 'loading' && state.status !== 'ready') || typeof state.name !== 'string' || state.name.length > 1024 ||
          !Number.isInteger(state.size) || state.size < observedSize || state.size > this.maxBytes ||
          !Number.isInteger(state.count) || state.count < consumed || state.count > state.size || state.size > state.count * DOWNLOAD_CHUNK_BYTES ||
          state.offset !== consumed || !Array.isArray(state.chunks) || state.chunks.length > DOWNLOAD_BATCH_CHUNKS ||
          state.count < consumed + state.chunks.length || state.count - consumed - state.chunks.length > DOWNLOAD_QUEUE_CHUNKS) {
          throw new Error('下载数据无效');
        }
        observedSize = state.size;
        name = state.name;
        for (const encoded of state.chunks) {
          if (this.cancelled || !valid()) throw new Error('电脑连接已变化，下载已取消');
          if (typeof encoded !== 'string' || !encoded || encoded.length > 43692 ||
            !new RegExp('^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$').test(encoded)) throw new Error('下载数据不完整，请重试');
          const bytes = decoder.decodeSync(encoded);
          const expected = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
          if (bytes.byteLength !== expected || expected < 1 || expected > DOWNLOAD_CHUNK_BYTES) throw new Error('下载数据无效');
          total += bytes.byteLength;
          if (total > this.maxBytes || total > state.size) throw new Error('文件超过本次下载阈值或大小无效');
          const payload = new Uint8Array(bytes.byteLength);
          payload.set(bytes);
          const written = await fs.write(openFile.fd, payload.buffer);
          if (written !== bytes.byteLength) throw new Error('无法完整保存下载文件');
          if (this.cancelled || !valid()) throw new Error('电脑连接已变化，下载已取消');
          if (Date.now() > deadline) throw new Error('下载超时，请重试');
          consumed++;
        }
        progress(total);
        if (state.status === 'ready' && consumed === state.count) {
          if (total !== state.size) throw new Error('下载数据不完整，请重试');
          break;
        }
        if (!state.chunks.length) await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
      }
      if ((await fs.stat(openFile.fd)).size !== total || this.cancelled || !valid()) throw new Error('下载数据不完整，请重试');
      if (Date.now() > deadline) throw new Error('下载超时，请重试');
      await fs.close(openFile);
      openFile = undefined;
      return new DownloadFile(this.temp, safeFilename(name), total, this.maxBytes);
    } catch (error) {
      if (openFile) { try { await fs.close(openFile); } catch (_) {} }
      try { fs.unlinkSync(this.temp); } catch (_) {}
      throw new Error((error as Error).message || '下载失败，请重试');
    } finally {
      controller.runJavaScript(downloadClearScript(this.slot)).catch(() => {});
    }
  }
}

export async function saveAttachment(context: common.UIAbilityContext, file: DownloadFile): Promise<boolean> {
  let source: fs.File | undefined;
  let destination: fs.File | undefined;
  try {
    const prefix = context.cacheDir + '/bridge-attachment-';
    if (!file.path.startsWith(prefix) || !new RegExp('^[0-9a-fA-F-]{36}$').test(file.path.slice(prefix.length)) ||
      !validDownloadBytes(file.maxBytes) || !Number.isInteger(file.size) || file.size < 0 || file.size > file.maxBytes) {
      throw new Error('下载缓存无效，请重新下载');
    }
    source = await fs.open(file.path, fs.OpenMode.READ_ONLY);
    if ((await fs.stat(source.fd)).size !== file.size) throw new Error('下载缓存不完整，请重新下载');
    const documentPicker = new picker.DocumentViewPicker(context);
    const destinations = await documentPicker.save({ newFileNames: [file.name] });
    if (!destinations.length) return false;
    if (destinations.length !== 1 || !destinations[0].startsWith('file://')) throw new Error('请从系统文件选择器重新选择保存位置');
    destination = await fs.open(destinations[0], fs.OpenMode.READ_WRITE);
    if ((await fs.stat(destination.fd)).size !== 0) throw new Error('所选文件已有内容，未覆盖。请换一个文件名保存。');
    try {
      await fs.copyFile(source.fd, destination.fd);
      if ((await fs.stat(destination.fd)).size !== file.size) throw new Error('incomplete');
    } catch (_) { throw new Error('保存未完成，目标可能留有不完整文件；请检查后换名保存。'); }
    return true;
  } finally {
    try { if (destination) await fs.close(destination); }
    finally { if (source) await fs.close(source); }
  }
}

export function discardAttachment(file: DownloadFile): void {
  try { fs.unlinkSync(file.path); } catch (_) {}
}

export function clearStaleAttachments(context: common.UIAbilityContext): void {
  try {
    for (const name of fs.listFileSync(context.cacheDir)) {
      if (new RegExp('^bridge-attachment-[0-9a-fA-F-]{36}$').test(name)) {
        try { fs.unlinkSync(context.cacheDir + '/' + name); } catch (_) {}
      }
    }
  } catch (_) {}
}
