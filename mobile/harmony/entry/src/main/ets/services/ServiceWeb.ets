import common from '@ohos.app.ability.common';
import webview from '@ohos.web.webview';
import { ServiceSite } from './ServiceSite';
import { httpsOrigin, externalHTTP, credentialScopeMatches } from '../security/GatewayURL';
import { ServiceCredentials } from './ServiceCredentials';
import { webString } from '../web/DownloadScript';
import { credentialFillScript } from './CredentialFill';
import { CredentialKind } from './CredentialVault';

@Component
export struct ServiceWeb {
  @Prop site: ServiceSite = new ServiceSite('', '', '');
  @Prop active: boolean = false;
  onConfigure: () => void = () => {};
  @State status: string = '';
  @State currentURL: string = '';
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private controller: webview.WebviewController = new webview.WebviewController();
  private initialURL: string = '';

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

  @Builder
  private pageMenu() {
    Menu() {
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

  build() {
    Column() {
      Row({ space: 8 }) {
        Text(this.site.name).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#202124').layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Button('返回').height(44).fontSize(14).backgroundColor('#f4f5f7').fontColor('#202124').enabled(this.active).onClick(() => { this.back(); })
        ServiceCredentials({ serviceId: this.site.id, configuredUrl: this.site.url, currentUrl: this.currentURL, active: this.active,
          onFill: (username: string, secret: string, scope: string, kind: CredentialKind) => { this.fill(username, secret, scope, kind); } })
        Button('•••').width(44).height(44).fontSize(17).backgroundColor('#f4f5f7').fontColor('#202124').enabled(this.active)
          .accessibilityText('页面选项').bindMenu(this.pageMenu)
      }.height(56).padding({ left: 16, right: 12 }).width('100%').backgroundColor('#f5f5f3')
      if (this.status) { Text(this.status).fontSize(12).fontColor('#777b80').padding(6).width('100%') }
      Web({ src: this.initialURL, controller: this.controller })
        .javaScriptAccess(true).domStorageAccess(true).fileAccess(false).mixedMode(MixedMode.None).multiWindowAccess(false).geolocationAccess(false)
        .onLoadIntercept((event) => event ? this.navigate(event.data) : true)
        .onPageBegin((event) => { if (event) { this.currentURL = event.url; this.status = ''; } })
        .onPageEnd((event) => {
          if (event && this.allowed(event.url)) { this.currentURL = event.url; webview.WebCookieManager.saveCookieAsync().catch(() => {}); }
        })
        .onRefreshAccessedHistory((event) => { if (event) this.currentURL = event.url; })
        .onErrorReceive((event) => { if (event && event.request.isMainFrame()) this.status = '连接失败，请检查网络后手动刷新。'; })
        .width('100%').layoutWeight(1)
    }.width('100%').height('100%').backgroundColor('#f5f5f3')
  }
}
