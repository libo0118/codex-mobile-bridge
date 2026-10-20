import common from '@ohos.app.ability.common';
import webview from '@ohos.web.webview';
import { ServiceSite } from './ServiceSite';
import { httpsOrigin, externalHTTP, credentialScopeMatches } from '../security/GatewayURL';
import { ServiceCredentials } from './ServiceCredentials';
import { webString } from '../web/DownloadScript';
import { credentialFillScript } from './CredentialFill';
import { CredentialKind } from './CredentialVault';
import { keeperPage, keeperUiScript } from './KeeperUi';

@Component
export struct ServiceWeb {
  @Prop site: ServiceSite = new ServiceSite('', '', '');
  @Prop active: boolean = false;
  @Prop @Watch('requestBack') backRequest: number = 0;
  onConfigure: () => void = () => {};
  onAppBack: () => void = () => {};
  @State status: string = '';
  @State currentURL: string = '';
  @State loginRequest: number = 0;
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private controller: webview.WebviewController = new webview.WebviewController();
  private initialURL: string = '';
  private backGeneration: number = 0;

  aboutToAppear(): void { this.initialURL = this.site.url; }

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

  private requestBack(): void {
    if (!this.active || this.site.id !== 'keeper') return;
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
      MenuItem({ content: '刷新页面' }).onClick(() => { if (this.active) this.controller.refresh(); })
      MenuItem({ content: '站点设置' }).onClick(() => { if (this.active) this.onConfigure(); })
    }
  }

  private async fill(username: string, secret: string, scope: string, kind: CredentialKind): Promise<void> {
    const current = this.controller.getUrl();
    if (!this.active || !secret || secret.length > (kind === 'entry-link' ? 8192 : 4096) || username.length > 512 ||
      !credentialScopeMatches(current, scope, this.site.url)) {
      AlertDialog.show({ message: '当前页面与保存的登录范围不匹配，未填入登录信息。', confirm: { value: '好', action: () => {} } });
      return;
    }
    try {
      if (kind === 'entry-link') {
        if (!credentialScopeMatches(secret, scope, this.site.url)) throw new Error('私密入口不属于当前站点');
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
      if (this.site.id === 'keeper') {
        Row({ space: 8 }) {
          Text(this.site.name).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#202124').layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.keeper_header_back')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(12).backgroundColor('#f4f5f7').enabled(this.active)
            .accessibilityText('Keeper 网页返回').onClick(() => { this.back(); })
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.keeper_header_key')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(12).backgroundColor('#f4f5f7').enabled(this.active)
            .accessibilityText('Keeper 登录信息').onClick(() => { if (this.active) this.loginRequest++; })
          Button({ type: ButtonType.Normal, stateEffect: true }) {
            Image($r('app.media.keeper_header_more')).width(24).height(24).objectFit(ImageFit.Contain)
          }.width(44).height(44).padding(10).borderRadius(12).backgroundColor('#f4f5f7').enabled(this.active)
            .accessibilityText('Keeper 页面选项').bindMenu(this.pageMenu)
        }.height(56).padding({ left: 16, right: 12 }).width('100%').backgroundColor('#f5f5f3')
      } else {
        Row({ space: 8 }) {
          Text(this.site.name).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#202124').layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Button('返回').height(44).fontSize(14).backgroundColor('#f4f5f7').fontColor('#202124').enabled(this.active).onClick(() => { this.back(); })
          ServiceCredentials({ serviceId: this.site.id, configuredUrl: this.site.url, currentUrl: this.currentURL, active: this.active,
            onFill: (username: string, secret: string, scope: string, kind: CredentialKind) => { this.fill(username, secret, scope, kind); } })
          Button('•••').width(44).height(44).fontSize(17).backgroundColor('#f4f5f7').fontColor('#202124').enabled(this.active)
            .accessibilityText('页面选项').bindMenu(this.pageMenu)
        }.height(56).padding({ left: 16, right: 12 }).width('100%').backgroundColor('#f5f5f3')
      }
      if (this.status) { Text(this.status).fontSize(12).fontColor('#777b80').padding(6).width('100%') }
      Web({ src: this.initialURL, controller: this.controller })
        .javaScriptAccess(true).domStorageAccess(true).fileAccess(false).mixedMode(MixedMode.None).multiWindowAccess(false).geolocationAccess(false)
        .onLoadIntercept((event) => event ? this.navigate(event.data) : true)
        .onPageBegin((event) => { if (event) { this.currentURL = event.url; this.status = ''; } })
        .onPageEnd((event) => {
          if (event && this.allowed(event.url)) { this.currentURL = event.url; webview.WebCookieManager.saveCookieAsync().catch(() => {}); this.keeperCommand(); }
        })
        .onRefreshAccessedHistory((event) => { if (event) { this.currentURL = event.url; this.keeperCommand(); } })
        .onErrorReceive((event) => { if (event && event.request.isMainFrame()) this.status = '连接失败，请检查网络后手动刷新。'; })
        .width('100%').layoutWeight(1)
    }.width('100%').height('100%').backgroundColor('#f5f5f3')
  }

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      this.servicePage()
      if (this.site.id === 'keeper') {
        ServiceCredentials({ serviceId: this.site.id, configuredUrl: this.site.url, currentUrl: this.currentURL, active: this.active,
          compactTrigger: true, openRequest: this.loginRequest,
          onFill: (username: string, secret: string, scope: string, kind: CredentialKind) => { this.fill(username, secret, scope, kind); } })
      }
    }.width('100%').height('100%')
  }
}
