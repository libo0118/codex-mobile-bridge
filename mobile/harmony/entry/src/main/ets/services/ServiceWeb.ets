import common from '@ohos.app.ability.common';
import util from '@ohos.util';
import webview from '@ohos.web.webview';
import { ServiceSite, serviceCredentialURL } from './ServiceSite';
import { httpsOrigin, externalHTTP, credentialScopeMatches } from '../security/GatewayURL';
import { ServiceCredentials } from './ServiceCredentials';
import { webString } from '../web/DownloadScript';
import { credentialFillScript } from './CredentialFill';
import { CredentialKind } from './CredentialVault';
import { keeperPage, keeperUiScript } from './KeeperUi';
import { chatUiScript, chatUiActionScript } from './ChatUi';
import { magpieUiScript } from './MagpieUi';

@Component
export struct ServiceWeb {
  @Prop site: ServiceSite = new ServiceSite('', '', '');
  @Prop @Watch('activeChanged') active: boolean = false;
  @Prop @Watch('requestBack') backRequest: number = 0;
  onConfigure: () => void = () => {};
  onAppBack: () => void = () => {};
  onChatMode: (chat: boolean) => void = () => {};
  @State status: string = '';
  @State currentURL: string = '';
  @State loginRequest: number = 0;
  @State chatMode: boolean = false;
  @State chatReady: boolean = false;
  @State chatListHeader: boolean = false;
  @State magpieReady: boolean = false;
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private controller: webview.WebviewController = new webview.WebviewController();
  private initialURL: string = '';
  private chatInitial: boolean = true;
  private backGeneration: number = 0;
  private chatGeneration: number = 0;
  private chatToken: string = '';

  aboutToAppear(): void { this.initialURL = this.site.url; }
  aboutToDisappear(): void { this.clearChat(); }

  private clearChat(): void {
    this.chatGeneration++;
    this.chatToken = '';
    this.chatMode = false;
    this.chatReady = false;
    this.chatListHeader = false;
    if (this.site.id === 'chat') this.onChatMode(false);
  }

  private newChatToken(): void {
    this.clearChat();
    if (this.site.id === 'chat' && this.active) this.chatToken = util.generateRandomUUID().replace(new RegExp('-', 'g'), '').toLowerCase();
  }

  private activeChanged(): void {
    if (this.site.id === 'magpie') { if (this.active) this.magpieCommand(); return; }
    if (this.site.id !== 'chat') return;
    const oldToken = this.chatToken, current = this.currentURL;
    this.newChatToken();
    if (!this.active && oldToken) {
      try { this.controller.runJavaScript(chatUiActionScript(current, oldToken, 'suspend')).catch(() => {}); } catch (_) {}
    } else if (this.active) this.chatCommand();
  }

  private allowed(target: string): boolean {
    try { const origin = httpsOrigin(target); return origin === httpsOrigin(this.site.url) || origin === this.site.loginOrigin; }
    catch (_) { return false; }
  }

  private navigate(request: WebResourceRequest): boolean {
    const target = request.getRequestUrl();
    if (!request.isMainFrame()) return false;
    if (this.allowed(target)) return false;
    if (request.isRequestGesture() && this.active && externalHTTP(target)) {
      AlertDialog.show({ title: '在浏览器打开外部链接？', message: target.split(new RegExp('[?#]'))[0].substring(0, 1024),
        primaryButton: { value: '取消', action: () => {} },
        secondaryButton: { value: '打开', action: () => {
          this.context.startAbility({ action: 'ohos.want.action.viewData', uri: target, entities: ['entity.system.browsable'] }).catch(() => {});
        } }
      });
    }
    return true;
  }

  private back(): void {
    if (!this.active) return;
    try { if (this.controller.accessBackward()) this.controller.backward(); } catch (_) {}
  }

  private keeperCommand(command: string = ''): void {
    if (this.site.id !== 'keeper') return;
    try {
      const current = this.controller.getUrl();
      if (!keeperPage(current) || (command && !this.active)) return;
      this.controller.runJavaScript(keeperUiScript(current, command)).catch(() => {});
    } catch (_) {}
  }

  private chatCommand(): void {
    if (this.site.id !== 'chat' || !this.active || !this.chatToken) return;
    const ticket = this.chatGeneration, token = this.chatToken;
    try {
      const current = this.controller.getUrl();
      if (!this.allowed(current) || current !== this.currentURL) return;
      this.controller.runJavaScript(chatUiScript(current, this.initialURL, this.chatInitial, token)).then((result: string): void => {
        if (!this.active || ticket !== this.chatGeneration || token !== this.chatToken || this.currentURL !== current) return;
        if (webString(result) === 'ready') this.chatInitial = false;
        else if (webString(result) === 'unavailable') this.status = 'Chat 页面适配失败，请手动刷新。';
      }).catch((): void => {
        if (this.active && ticket === this.chatGeneration && token === this.chatToken && this.currentURL === current) this.status = 'Chat 页面适配失败，请手动刷新。';
      });
    } catch (_) { if (this.active && ticket === this.chatGeneration) this.status = 'Chat 页面适配失败，请手动刷新。'; }
  }

  private magpieCommand(action: string = ''): void {
    if (this.site.id !== 'magpie' || !this.active) return;
    const current = this.currentURL;
    try {
      if (this.controller.getUrl() !== current) return;
      this.controller.runJavaScript(magpieUiScript(current, this.initialURL, action)).then((result: string): void => {
        if (!this.active || this.currentURL !== current || this.controller.getUrl() !== current) return;
        const value = webString(result);
        if (!action) this.magpieReady = value === 'ready';
        else if (value !== 'clicked') this.status = 'Magpie 页面操作不可用，请刷新页面后重试。';
      }).catch((): void => { if (this.active && this.currentURL === current) this.status = 'Magpie 页面适配失败，请在菜单中刷新。'; });
    } catch (_) { if (this.active && this.currentURL === current) this.status = 'Magpie 页面适配失败，请在菜单中刷新。'; }
  }

  private chatAction(action: string): void {
    if (!this.active || this.site.id !== 'chat' || !this.chatToken) return;
    const current = this.currentURL, token = this.chatToken, ticket = this.chatGeneration;
    if (current !== this.initialURL) { this.chatActionFailed(current, token, 'Chat 页面已变化，请手动刷新。'); return; }
    try {
      this.controller.runJavaScript(chatUiActionScript(current, token, action)).then((result: string): void => {
        if (this.active && ticket === this.chatGeneration && current === this.currentURL && webString(result) !== 'sent') {
          this.chatActionFailed(current, token, 'Chat 页面尚未就绪，请手动刷新。');
        }
      }).catch((): void => {
        if (this.active && ticket === this.chatGeneration && current === this.currentURL) this.chatActionFailed(current, token, 'Chat 页面操作失败，请手动刷新。');
      });
    } catch (_) {
      if (this.active && ticket === this.chatGeneration && current === this.currentURL) this.chatActionFailed(current, token, 'Chat 页面操作失败，请手动刷新。');
    }
  }

  private chatActionFailed(current: string, token: string, message: string): void {
    this.clearChat();
    this.status = message;
    try { this.controller.runJavaScript(chatUiActionScript(current, token, 'suspend')).catch(() => {}); } catch (_) {}
  }

  private chatPrompt(event: OnPromptEvent): boolean {
    if (!event.message.startsWith('bridge-chat-ui:')) return false;
    let current = '';
    try { current = this.controller.getUrl(); } catch (_) {}
    const suffix = '?view=plugin-chat';
    const base = this.initialURL.endsWith(suffix) ? this.initialURL.substring(0, this.initialURL.length - suffix.length) : '';
    const fallback = base !== '' && current.startsWith(base) && new RegExp('^\\?view=[a-z0-9-]+$').test(current.substring(base.length));
    if (base !== '' && this.active && this.site.id === 'chat' && this.site.enabled !== false && this.site.url === this.initialURL &&
      this.chatToken && event.message === 'bridge-chat-ui:' + this.chatToken &&
      event.url === current && this.currentURL === current &&
      (current === this.initialURL && ['list', 'chat', 'list-header', 'chat-header'].indexOf(event.value) >= 0 || fallback && event.value === 'list')) {
      this.chatReady = current === this.initialURL;
      this.chatMode = event.value === 'chat' || event.value === 'chat-header';
      this.chatListHeader = event.value === 'list-header' || event.value === 'chat-header';
      this.onChatMode(this.chatMode);
      event.result.handlePromptConfirm('saved');
    } else event.result.handleCancel();
    return true;
  }

  private requestBack(): void {
    if (!this.active) return;
    if (this.site.id === 'chat') { if (this.chatMode) this.chatAction('back'); return; }
    if (this.site.id !== 'keeper') return;
    const ticket = ++this.backGeneration;
    let current: string = this.currentURL;
    try { current = this.controller.getUrl(); } catch (_) {}
    let finished: boolean = false;
    const finish = (consumed: boolean): void => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (!consumed && ticket === this.backGeneration && this.active && this.site.id === 'keeper' && this.currentURL === current) this.onAppBack();
    };
    const timer = setTimeout((): void => { finish(false); }, 1000);
    if (!keeperPage(current)) { finish(false); return; }
    this.controller.runJavaScript(keeperUiScript(current, 'back')).then((result: string): void => { finish(webString(result) === 'closed'); }).catch((): void => { finish(false); });
  }

  @Builder
  private pageMenu() {
    Menu() {
      if (this.site.id === 'keeper') {
        MenuItem({ content: '页面切换' }).onClick(() => { this.keeperCommand('pages'); })
        MenuItem({ content: '平台筛选' }).onClick(() => { this.keeperCommand('providers'); })
        MenuItem({ content: '认证文件' }).onClick(() => { this.keeperCommand('auth'); })
        MenuItem({ content: '站点工具' }).onClick(() => { this.keeperCommand('tools'); })
        MenuItem({ content: '网页返回' }).onClick(() => { this.back(); })
        MenuItem({ content: '登录信息' }).onClick(() => { if (this.active) this.loginRequest++; })
        MenuItem({ content: '切换原网页工具栏' }).onClick(() => { this.keeperCommand('layout'); })
      }
      if (this.site.id === 'chat' && this.chatReady) {
        MenuItem({ content: '对话设置' }).onClick(() => { this.chatAction('settings'); })
        MenuItem({ content: '登录信息' }).onClick(() => { if (this.active) this.loginRequest++; })
      }
      if (this.site.id === 'magpie') {
        MenuItem({ content: '网页返回' }).onClick(() => { this.back(); })
        MenuItem({ content: '登录信息' }).onClick(() => { if (this.active) this.loginRequest++; })
      }
      MenuItem({ content: '刷新页面' }).onClick(() => { if (this.active) this.controller.refresh(); })
      MenuItem({ content: '站点设置' }).onClick(() => { if (this.active) this.onConfigure(); })
    }
  }

  private async fill(username: string, secret: string, scope: string, kind: CredentialKind): Promise<void> {
    const current = this.controller.getUrl();
    if (!this.active || !secret || secret.length > (kind === 'entry-link' ? 8192 : 4096) || username.length > 512 ||
      !credentialScopeMatches(current, scope, serviceCredentialURL(this.site))) {
      AlertDialog.show({ message: '当前页面与保存的登录范围不匹配，未填入登录信息。', confirm: { value: '好', action: () => {} } });
      return;
    }
    try {
      if (kind === 'entry-link') {
        if (!credentialScopeMatches(secret, scope, serviceCredentialURL(this.site))) throw new Error('私密入口不属于当前站点');
        this.controller.loadUrl(secret);
        return;
      }
      const result = await this.controller.runJavaScript(credentialFillScript(username, secret, current));
      if (webString(result) !== 'filled') throw new Error('未找到唯一的登录密码框；请在登录页面手动输入。');
    } catch (_) {
      AlertDialog.show({ message: kind === 'entry-link' ? '安全入口不在当前站点范围内或无法打开。' : '无法明确识别当前登录表单，请手动输入。未提交登录。', confirm: { value: '好', action: () => {} } });
    }
  }

  @Builder
  private servicePage() {
    Column() {
      Row({ space: 8 }) {
        if (this.site.id === 'chat' && this.chatMode) {
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.keeper_header_back')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(22).backgroundColor(Color.Transparent).enabled(this.active)
            .accessibilityText('返回会话列表').onClick(() => { this.chatAction('back'); })
        }
        Text(this.site.name).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#202124').layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.site.id === 'chat' && this.chatListHeader && !this.chatMode) {
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.service_header_new')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(22).backgroundColor(Color.Transparent).enabled(this.active)
            .accessibilityText('新建对话').onClick(() => { this.chatAction('new'); })
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.service_header_settings')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(22).backgroundColor(Color.Transparent).enabled(this.active)
            .accessibilityText('对话设置').onClick(() => { this.chatAction('settings'); })
        }
        if (this.site.id === 'magpie') {
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.service_header_refresh')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(22).backgroundColor(Color.Transparent).enabled(this.active && this.magpieReady)
            .accessibilityText('刷新 Magpie').onClick(() => { this.magpieCommand('refresh'); })
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.service_header_settings')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(22).backgroundColor(Color.Transparent).enabled(this.active && this.magpieReady)
            .accessibilityText('Magpie 设置').onClick(() => { this.magpieCommand('settings'); })
        } else if (this.site.id !== 'chat' || !this.chatReady) {
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.keeper_header_back')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(22).backgroundColor(Color.Transparent).enabled(this.active)
            .accessibilityText(this.site.name + ' 网页返回').onClick(() => { this.back(); })
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.keeper_header_key')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(22).backgroundColor(Color.Transparent).enabled(this.active)
            .accessibilityText(this.site.name + ' 登录信息').onClick(() => { if (this.active) this.loginRequest++; })
        }
        Button({ type: ButtonType.Normal, stateEffect: true }) {
          Image($r('app.media.keeper_header_more')).width(24).height(24).objectFit(ImageFit.Contain)
        }.width(44).height(44).padding(10).borderRadius(22).backgroundColor(Color.Transparent).enabled(this.active)
          .accessibilityText(this.site.name + ' 页面选项').bindMenu(this.pageMenu)
      }.height(56).padding({ left: 16, right: 12 }).width('100%').backgroundColor('#f8f8f5')
      if (this.status) { Text(this.status).fontSize(12).fontColor('#777b80').padding(6).width('100%') }
      Web({ src: this.initialURL, controller: this.controller })
        .javaScriptAccess(true).domStorageAccess(true).fileAccess(false).mixedMode(MixedMode.None).multiWindowAccess(false).geolocationAccess(false)
        .onLoadIntercept((event) => event ? this.navigate(event.data) : true)
        .onPrompt((event) => event ? this.chatPrompt(event) : true)
        .onPageBegin((event) => { if (event) { if (this.site.id === 'chat') this.newChatToken(); this.magpieReady = false; this.currentURL = event.url; this.status = ''; } })
        .onPageEnd((event) => {
          if (event && this.allowed(event.url)) {
            let current = event.url;
            if (this.site.id === 'chat') { try { current = this.controller.getUrl(); } catch (_) { current = ''; } }
            if (event.url === current) { this.currentURL = event.url; webview.WebCookieManager.saveCookieAsync().catch(() => {}); this.keeperCommand(); this.chatCommand(); this.magpieCommand(); }
          }
        })
        .onRefreshAccessedHistory((event) => {
          if (event) {
            if (this.site.id === 'chat') {
              let current = '';
              try { current = this.controller.getUrl(); } catch (_) {}
              if (current !== event.url) return;
            }
            if (this.site.id === 'chat' && event.url !== this.currentURL) this.newChatToken();
            this.currentURL = event.url; this.keeperCommand(); this.chatCommand(); this.magpieCommand();
          }
        })
        .onErrorReceive((event) => {
          if (event && event.request.isMainFrame()) {
            if (this.site.id === 'chat' && event.request.getRequestUrl() === this.currentURL) this.clearChat();
            this.status = '连接失败，请检查网络后手动刷新。';
          }
        })
        .width('100%').layoutWeight(1)
    }.width('100%').height('100%').backgroundColor('#f8f8f5')
  }

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      this.servicePage()
      ServiceCredentials({ serviceId: this.site.id, configuredUrl: serviceCredentialURL(this.site), currentUrl: this.currentURL, active: this.active,
        compactTrigger: true, openRequest: this.loginRequest,
        onFill: (username: string, secret: string, scope: string, kind: CredentialKind) => { this.fill(username, secret, scope, kind); } })
    }.width('100%').height('100%')
  }
}
