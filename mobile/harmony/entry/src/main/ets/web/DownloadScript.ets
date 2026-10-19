export const DOWNLOAD_LIMIT: number = 20 * 1024 * 1024;

/** Native callers supply only an already allowlisted URL and an unpredictable slot. */
export function downloadStartScript(target: string, slot: string): string {
  // shortcut: attachments are capped at 20 MiB; use a cancellable native stream when its API can forbid redirects.
  return `(() => {
    if (window !== top) return false;
    const slot = ${JSON.stringify(slot)}, target = ${JSON.stringify(target)};
    const state = { status: 'loading', name: 'download', size: 0, chunks: [], error: '' };
    const abort = new AbortController(); state.abort = () => abort.abort(); window[slot] = state;
    const timer = setTimeout(() => abort.abort(), 120000);
    (async () => {
      let reader;
      try {
        const response = await fetch(target, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: abort.signal });
        if (!response.ok || response.redirected || new URL(response.url).origin !== location.origin || !response.body) throw new Error('下载未通过来源校验或登录已失效');
        const expected = response.headers.get('content-length');
        if (expected && (!/^\\d+$/.test(expected) || Number(expected) > ${DOWNLOAD_LIMIT})) throw new Error('文件超过 20 MiB，请在电脑或浏览器下载');
        const disposition = response.headers.get('content-disposition') || '';
        const utf8 = /filename\\*=UTF-8''([^;]+)/i.exec(disposition);
        const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(disposition);
        try { state.name = utf8 ? decodeURIComponent(utf8[1]) : plain ? (plain[1] || plain[2]) : 'download'; } catch {}
        reader = response.body.getReader();
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          state.size += item.value.byteLength;
          if (state.size > ${DOWNLOAD_LIMIT}) throw new Error('文件超过 20 MiB，请在电脑或浏览器下载');
          for (let offset = 0; offset < item.value.length; offset += 32768) {
            let text = ''; const end = Math.min(offset + 32768, item.value.length);
            for (let i = offset; i < end; i++) text += String.fromCharCode(item.value[i]);
            state.chunks.push(btoa(text));
          }
        }
        if (expected && Number(expected) !== state.size) throw new Error('下载连接中断，请重新下载');
        state.status = 'ready';
      } catch (error) {
        if (reader) { try { await reader.cancel(); } catch {} }
        abort.abort(); state.chunks = []; state.status = 'error';
        state.error = error && error.message ? error.message : '下载失败，请重试';
      } finally { clearTimeout(timer); }
    })();
    return true;
  })()`;
}

export function downloadPollScript(slot: string): string {
  return `(() => { const s = window[${JSON.stringify(slot)}]; return JSON.stringify(s ? { status: s.status, name: s.name, size: s.size, count: s.chunks.length, error: s.error } : { status: 'error', error: '下载页面已经变化' }); })()`;
}

export function downloadChunkScript(slot: string, index: number): string {
  return `(() => { const s = window[${JSON.stringify(slot)}]; if (!s || s.status !== 'ready') return ''; const value = s.chunks[${index}]; s.chunks[${index}] = ''; return value || ''; })()`;
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
