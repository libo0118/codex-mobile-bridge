import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import picker from '@ohos.file.picker';
import util from '@ohos.util';
import webview from '@ohos.web.webview';
import { acceptsDownload, safeFilename } from '../security/GatewayURL';
import { DOWNLOAD_LIMIT, downloadStartScript, downloadPollScript, downloadChunkScript, downloadClearScript, webString } from './DownloadScript';

class DownloadState {
  status: string = '';
  name: string = 'download';
  size: number = 0;
  count: number = 0;
  error: string = '';
}

export class DownloadFile {
  path: string;
  name: string;
  size: number;
  constructor(path: string, name: string, size: number) {
    this.path = path;
    this.name = name;
    this.size = size;
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

  cancel(controller: webview.WebviewController): void {
    this.cancelled = true;
    if (this.slot) controller.runJavaScript(downloadClearScript(this.slot)).catch(() => {});
    if (this.temp) { try { fs.unlinkSync(this.temp); } catch (_) {} }
  }

  async fetch(context: common.UIAbilityContext, controller: webview.WebviewController, target: string, base: string,
    valid: () => boolean, progress: (bytes: number) => void): Promise<DownloadFile> {
    if (!acceptsDownload(target, base) || !valid()) throw new Error('此下载不是当前电脑的附件');
    this.slot = '__bridgeDownload_' + util.generateRandomUUID().replace(new RegExp('-', 'g'), '');
    this.temp = context.cacheDir + '/bridge-attachment-' + util.generateRandomUUID();
    let openFile: fs.File | undefined;
    try {
      await controller.runJavaScript(downloadStartScript(target, this.slot));
      let state = new DownloadState();
      const deadline = Date.now() + 125000;
      while (state.status !== 'ready') {
        if (this.cancelled || !valid()) throw new Error('电脑连接已变化，下载已取消');
        if (Date.now() > deadline) throw new Error('下载超时，请重试');
        const result = await controller.runJavaScript(downloadPollScript(this.slot));
        state = JSON.parse(webString(result)) as DownloadState;
        if (state.status === 'error') throw new Error(state.error || '下载失败，请重试');
        progress(state.size);
        if (state.status !== 'ready') await new Promise<void>((resolve) => { setTimeout(resolve, 250); });
      }
      if (state.size < 0 || state.size > DOWNLOAD_LIMIT || state.count < 0 || state.count > 20000) throw new Error('附件大小无效');
      openFile = await fs.open(this.temp, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      const decoder = new util.Base64Helper();
      let total = 0;
      for (let index = 0; index < state.count; index++) {
        if (this.cancelled || !valid()) throw new Error('电脑连接已变化，下载已取消');
        const encoded = webString(await controller.runJavaScript(downloadChunkScript(this.slot, index)));
        if (!encoded || encoded.length > 43692) throw new Error('下载数据不完整，请重试');
        const bytes = decoder.decodeSync(encoded);
        total += bytes.byteLength;
        if (total > DOWNLOAD_LIMIT) throw new Error('文件超过 20 MiB，请在电脑或浏览器下载');
        const written = await fs.write(openFile.fd, bytes.buffer);
        if (written !== bytes.byteLength) throw new Error('无法完整保存下载文件');
      }
      if (total !== state.size || this.cancelled || !valid()) throw new Error('下载数据不完整，请重试');
      await fs.close(openFile);
      openFile = undefined;
      return new DownloadFile(this.temp, safeFilename(state.name), total);
    } catch (error) {
      if (openFile) { try { await fs.close(openFile); } catch (_) {} }
      try { fs.unlinkSync(this.temp); } catch (_) {}
      throw error;
    } finally {
      controller.runJavaScript(downloadClearScript(this.slot)).catch(() => {});
    }
  }
}

export async function saveAttachment(context: common.UIAbilityContext, file: DownloadFile): Promise<boolean> {
  const documentPicker = new picker.DocumentViewPicker(context);
  const destinations = await documentPicker.save({ newFileNames: [file.name] });
  if (!destinations.length) return false;
  let source: fs.File | undefined;
  let destination: fs.File | undefined;
  try {
    source = await fs.open(file.path, fs.OpenMode.READ_ONLY);
    destination = await fs.open(destinations[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    await fs.copyFile(source.fd, destination.fd);
    return true;
  } catch (error) {
    // A failed copy must not leave a partially written attachment looking successful.
    if (destination) { try { await fs.close(destination); } catch (_) {} destination = undefined; }
    try { await fs.unlink(destinations[0]); } catch (_) {}
    throw error;
  } finally {
    if (source) await fs.close(source);
    if (destination) await fs.close(destination);
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
