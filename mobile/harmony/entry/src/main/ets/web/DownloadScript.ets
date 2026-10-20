import { DEFAULT_DOWNLOAD_LIMIT_MIB, MAX_DOWNLOAD_LIMIT_MIB, downloadLimitBytes } from '../data/DownloadSettings';

export const DOWNLOAD_CHUNK_BYTES: number = 32768;
export const DOWNLOAD_QUEUE_CHUNKS: number = 8;
export const DOWNLOAD_BATCH_CHUNKS: number = 4;

export function validDownloadBytes(maxBytes: number): boolean {
  return Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_DOWNLOAD_LIMIT_MIB * 1024 * 1024;
}

export function downloadTimeoutMs(maxBytes: number): number {
  if (!validDownloadBytes(maxBytes)) throw new Error('下载阈值无效');
  return Math.max(600000, Math.min(7200000, 120000 + Math.ceil(maxBytes / 131072) * 1000));
}

/** Native callers supply only an already allowlisted URL and an unpredictable slot. */
export function downloadStartScript(target: string, slot: string,
  maxBytes: number = downloadLimitBytes(DEFAULT_DOWNLOAD_LIMIT_MIB)): string {
  const timeout = downloadTimeoutMs(maxBytes);
  return `(() => {
    if (window !== top || new URL(${JSON.stringify(target)}).origin !== location.origin) return false;
    const slot = ${JSON.stringify(slot)}, target = ${JSON.stringify(target)};
    const state = { status: 'loading', name: 'download', size: 0, count: 0, offset: 0, chunks: [], error: '', wake: null };
    const abort = new AbortController();
    state.abort = () => { abort.abort(); state.chunks = []; if (state.wake) { const wake = state.wake; state.wake = null; wake(); } };
    window[slot] = state;
    const timer = setTimeout(state.abort, ${timeout});
    const active = () => { if (abort.signal.aborted || window[slot] !== state) throw new Error('下载已取消或超时，请重试'); };
    (async () => {
      let reader;
      try {
        const response = await fetch(target, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: abort.signal });
        active();
        if (response.redirected || new URL(response.url).origin !== location.origin) throw new Error('下载未通过来源校验');
        if (!response.ok) {
          if (response.status === 400 || response.status === 413) throw new Error('电脑网关拒绝下载，请检查网关下载上限（HTTP ' + response.status + '）');
          if (response.status === 401 || response.status === 403) throw new Error('下载登录已失效，请重新登录（HTTP ' + response.status + '）');
          throw new Error('电脑网关下载失败（HTTP ' + response.status + '），请重试');
        }
        if (!response.body) throw new Error('下载响应无数据，请重试');
        const header = response.headers.get('content-length');
        const expected = header === null ? undefined : Number(header);
        if (header !== null && (!/^\\d+$/.test(header) || !Number.isSafeInteger(expected) || expected > ${maxBytes})) throw new Error('文件超过本次下载阈值或大小无效');
        const disposition = response.headers.get('content-disposition') || '';
        const utf8 = /filename\\*=UTF-8''([^;]+)/i.exec(disposition);
        const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(disposition);
        try { state.name = (utf8 ? decodeURIComponent(utf8[1]) : plain ? (plain[1] || plain[2]) : 'download').slice(0, 1024); } catch {}
        reader = response.body.getReader();
        let received = 0;
        for (;;) {
          active();
          while (state.chunks.length >= ${DOWNLOAD_QUEUE_CHUNKS}) { await new Promise(resolve => { state.wake = resolve; }); active(); }
          const item = await reader.read();
          active();
          if (item.done) break;
          if (!(item.value instanceof Uint8Array)) throw new Error('下载数据无效');
          received += item.value.byteLength;
          if (received > ${maxBytes}) throw new Error('文件超过本次下载阈值');
          for (let offset = 0; offset < item.value.length; offset += ${DOWNLOAD_CHUNK_BYTES}) {
            while (state.chunks.length >= ${DOWNLOAD_QUEUE_CHUNKS}) { await new Promise(resolve => { state.wake = resolve; }); active(); }
            let text = ''; const end = Math.min(offset + ${DOWNLOAD_CHUNK_BYTES}, item.value.length);
            for (let i = offset; i < end; i++) text += String.fromCharCode(item.value[i]);
            active(); state.chunks.push(btoa(text)); state.size += end - offset; state.count++;
          }
        }
        if (expected !== undefined && expected !== received) throw new Error('下载连接中断，请重新下载');
        state.status = 'ready';
      } catch (error) {
        state.abort(); state.status = 'error';
        state.error = (error && error.message ? error.message : '下载失败，请重试').slice(0, 512);
        if (reader) { try { await reader.cancel(); } catch {} }
      } finally { clearTimeout(timer); }
    })();
    return true;
  })()`;
}

/** Synchronous queue drain: ArkWeb need not await a JavaScript Promise. */
export function downloadPollScript(slot: string): string {
  return `(() => {
    const s = window[${JSON.stringify(slot)}];
    if (!s) return JSON.stringify({status:'error',error:'下载页面已经变化'});
    const offset = s.offset, chunks = s.chunks.splice(0, ${DOWNLOAD_BATCH_CHUNKS}); s.offset += chunks.length;
    const result = JSON.stringify({status:s.status,name:s.name,size:s.size,count:s.count,offset,chunks,error:s.error});
    if (s.wake) { const wake = s.wake; s.wake = null; wake(); }
    return result;
  })()`;
}

export function downloadClearScript(slot: string): string {
  return `(() => { const s = window[${JSON.stringify(slot)}]; if (s && s.abort) s.abort(); delete window[${JSON.stringify(slot)}]; })()`;
}

export function webString(value: string): string {
  if (value.charAt(0) === '"') {
    try { return JSON.parse(value) as string; } catch (_) { return ''; }
  }
  return value;
}
