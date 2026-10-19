import UIAbility from '@ohos.app.ability.UIAbility';
import window from '@ohos.window';
import webview from '@ohos.web.webview';
import Want from '@ohos.app.ability.Want';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want): void { this.openNotification(want); }
  onNewWant(want: Want): void { this.openNotification(want); }

  private openNotification(want: Want): void {
    const target = want.parameters ? want.parameters['bridgeTarget'] : undefined;
    if (typeof target === 'string' && target.length <= 8192) AppStorage.setOrCreate('bridgeTarget', target);
  }

  onWindowStageCreate(stage: window.WindowStage): void {
    AppStorage.setOrCreate('bridgeForeground', true);
    stage.loadContent('pages/Index');
  }

  onForeground(): void {
    AppStorage.setOrCreate('bridgeForeground', true);
  }

  onBackground(): void {
    AppStorage.setOrCreate('bridgeForeground', false);
    webview.WebCookieManager.saveCookieAsync().catch(() => {});
  }
}
