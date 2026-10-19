import common from '@ohos.app.ability.common';
import notificationManager from '@ohos.notificationManager';
import wantAgent from '@ohos.app.ability.wantAgent';
import util from '@ohos.util';
import webview from '@ohos.web.webview';
import { EventCursor, EventSnapshot, MobileEvent } from './EventCursor';
import { chatURL } from '../security/GatewayURL';
import { webString } from '../web/DownloadScript';

class PollState {
  status: string = '';
  data: EventSnapshot = new EventSnapshot();
}

export class ForegroundEvents {
  private timer: number = -1;
  private epoch: number = 0;
  private slot: string = '';
  private cursor: EventCursor = new EventCursor();
  private controller?: webview.WebviewController;

  stop(): void {
    this.epoch++;
    if (this.timer !== -1) clearTimeout(this.timer);
    this.timer = -1;
    this.cursor.reset();
    if (this.controller && this.slot) {
      this.controller.runJavaScript(`(() => { const s = window[${JSON.stringify(this.slot)}]; if (s && s.abort) s.abort(); delete window[${JSON.stringify(this.slot)}]; })()`).catch(() => {});
    }
    this.slot = '';
  }

  start(context: common.UIAbilityContext, controller: webview.WebviewController, base: string, visible: () => boolean): void {
    this.stop();
    this.controller = controller;
    const epoch = this.epoch;
    this.poll(context, controller, base, visible, epoch);
  }

  private async poll(context: common.UIAbilityContext, controller: webview.WebviewController, base: string,
    visible: () => boolean, epoch: number): Promise<void> {
    if (epoch !== this.epoch || !visible()) return;
    const slot = '__bridgeEvents_' + util.generateRandomUUID().replace(new RegExp('-', 'g'), '');
    this.slot = slot;
    const endpoint = base + '/api/mobile/events?after=' + this.cursor.after();
    try {
      await controller.runJavaScript(`(() => {
        if (window !== top) return;
        const key = ${JSON.stringify(slot)}, state = { status: 'loading' }, abort = new AbortController();
        state.abort = () => abort.abort(); window[key] = state;
        (async () => { const timer = setTimeout(() => abort.abort(), 10000); try {
          const r = await fetch(${JSON.stringify(endpoint)}, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: abort.signal });
          if (!r.ok || r.redirected || new URL(r.url).origin !== location.origin || !r.body) throw new Error('notification request failed');
          const reader = r.body.getReader(), decoder = new TextDecoder(); let text = '', bytes = 0;
          for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
            if (bytes > 1048576) { await reader.cancel(); throw new Error('notification response too large'); }
            text += decoder.decode(chunk.value, { stream: true }); }
          text += decoder.decode(); state.data = JSON.parse(text); state.status = 'ready';
        } catch { state.status = 'error'; } finally { clearTimeout(timer); } })();
      })()`);
      let snapshot: EventSnapshot | undefined;
      for (let attempt = 0; attempt < 45; attempt++) {
        if (epoch !== this.epoch || !visible()) return;
        const raw = await controller.runJavaScript(`JSON.stringify((() => { const s = window[${JSON.stringify(slot)}]; return s ? { status: s.status, data: s.data } : { status: 'error' }; })())`);
        const state = JSON.parse(webString(raw)) as PollState;
        if (state.status === 'error') return;
        if (state.status === 'ready') { snapshot = state.data; break; }
        await new Promise<void>((resolve) => { setTimeout(resolve, 250); });
      }
      if (!snapshot || epoch !== this.epoch || !visible()) return;
      const events = this.cursor.candidates(snapshot, true);
      for (const event of events) {
        if (epoch !== this.epoch || !visible()) return;
        if (event.sequence <= this.cursor.after()) continue;
        await this.publish(context, base, event);
        if (epoch !== this.epoch || !visible()) return;
        this.cursor.delivered(event.sequence);
      }
      this.cursor.complete(snapshot);
    } catch (_) { /* Keep the previous cursor; failed publication can be retried while visible. */ }
    finally {
      controller.runJavaScript(`delete window[${JSON.stringify(slot)}]`).catch(() => {});
      if (epoch === this.epoch && visible()) this.timer = setTimeout(() => { this.poll(context, controller, base, visible, epoch); }, 15000);
    }
  }

  private async publish(context: common.UIAbilityContext, base: string, event: MobileEvent): Promise<void> {
    let target = base + '/';
    try { target = chatURL(base, event.threadId, event.host || 'local'); } catch (_) {}
    const identity = base + '|' + event.id;
    let id = 0;
    for (let index = 0; index < identity.length; index++) id = ((id * 31) + identity.charCodeAt(index)) & 0x7fffffff;
    const tap = await wantAgent.getWantAgent({
      wants: [{ bundleName: context.applicationInfo.name, abilityName: 'EntryAbility', parameters: { bridgeTarget: target } }],
      operationType: wantAgent.OperationType.START_ABILITY, requestCode: id,
      wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
    });
    await notificationManager.publish({ id: id, wantAgent: tap,
      content: { notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: { title: (typeof event.title === 'string' ? event.title : 'Codex Bridge').substring(0, 120),
          text: (typeof event.body === 'string' ? event.body : '').substring(0, 1000), additionalText: 'Codex Bridge' } }
    });
  }
}
