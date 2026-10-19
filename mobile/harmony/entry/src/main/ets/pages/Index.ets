import common from '@ohos.app.ability.common';
import pasteboard from '@ohos.pasteboard';
import promptAction from '@ohos.promptAction';
import util from '@ohos.util';
import webview from '@ohos.web.webview';
import window from '@ohos.window';
import notificationManager from '@ohos.notificationManager';
import deviceInfo from '@ohos.deviceInfo';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { Computer, ComputerStore } from '../data/ComputerStore';
import { connectionURL, gatewayConnection, sameGateway, isPreviewShell, acceptsDownload, externalHTTP, validPrompt, chatURL } from '../security/GatewayURL';
import { loadMobileScripts, mobileScript, uploadGestureScript, BACK_SCRIPT } from '../web/WebScripts';
import { webString } from '../web/DownloadScript';
import { AttachmentDownload, DownloadFile, selectUpload, saveAttachment, discardAttachment, clearStaleAttachments } from '../web/Files';
import { ForegroundEvents } from '../notifications/ForegroundEvents';
import { ServiceSite, ServiceStore } from '../services/ServiceSite';
import { ServiceWeb } from '../services/ServiceWeb';
import { NavigationAppearance } from '../appearance/NavigationAppearance';
import { detectSystemGlass, NavigationMaterial, SystemGlassAdapter } from '../appearance/NavigationMaterial';

class BarColors {
  top: string = '';
  bottom: string = '';
}

@Entry
@Component
struct Index {
  @StorageProp('bridgeForeground') @Watch('foregroundChanged') foreground: boolean = true;
  @StorageProp('bridgeTarget') @Watch('notificationOpened') pendingTarget: string = '';
  @State computers: Computer[] = [];
  @State connected: boolean = false;
  @State address: string = '';
  @State manual: boolean = false;
  @State ready: boolean = false;
  @State language: string = 'zh';
  @State status: string = '';
  @State editBase: string = '';
  @State editName: string = '';
  @State downloadBusy: boolean = false;
  @State downloadLabel: string = '';
  @State downloadName: string = '';
  @State alerts: boolean = false;
  @State activeTab: string = 'codex';
  @State services: ServiceSite[] = [];
  @State loadedServices: ServiceSite[] = [];
  @State configId: string = '';
  @State serviceName: string = '';
  @State serviceAddress: string = '';
  @State savingServices: string[] = [];
  @State navigationBlur: number = 100;
  @State navigationSystem: boolean = true;
  @State navigationThickness: number = 1;
  @State editNavigationBlur: number = 100;
  @State editNavigationSystem: boolean = true;
  @State editNavigationThickness: number = 1;
  @State navigationSettings: boolean = false;
  @State savingNavigation: boolean = false;
  @State systemGlassAvailable: boolean = false;
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private store: ComputerStore = new ComputerStore();
  private controller: webview.WebviewController = new webview.WebviewController();
  private base: string = '';
  private target: string = '';
  private token: string = '';
  private scripts: string = '';
  private generation: number = 0;
  private interaction: number = 0;
  private attachment?: AttachmentDownload;
  private downloaded?: DownloadFile;
  private events: ForegroundEvents = new ForegroundEvents();
  private serviceStore: ServiceStore = new ServiceStore();
  private configGeneration: number = 0;
  private codexTop: string = '#f5f5f3';
  private systemGlass?: SystemGlassAdapter;

  aboutToAppear(): void { this.updateBars(this.codexTop); this.initialize(); }
  aboutToDisappear(): void { this.events.stop(); this.cancelDownload(); this.flushCookies(); }

  private async initialize(): Promise<void> {
    try {
      clearStaleAttachments(this.context);
      this.computers = await this.store.load(this.context);
      this.language = await this.store.savedLanguage();
      this.alerts = await this.store.savedAlerts();
      const appearance = await this.store.savedNavigationAppearance();
      this.navigationBlur = appearance.blur;
      this.navigationSystem = appearance.system;
      this.navigationThickness = appearance.thickness;
      this.services = await this.serviceStore.load(this.context);
      this.scripts = await loadMobileScripts(this.context);
      webview.WebCookieManager.putAcceptCookieEnabled(true);
      webview.WebCookieManager.putAcceptThirdPartyCookieEnabled(false);
      this.ready = true;
      this.notificationOpened();
      detectSystemGlass(deviceInfo.sdkApiVersion, () => import('../appearance/SystemGlass26')).then((adapter: SystemGlassAdapter | undefined) => {
        this.systemGlass = adapter;
        this.systemGlassAvailable = adapter !== undefined;
      });
    } catch (_) { this.message(this.L('无法读取应用资源，请重新打开或安装应用。', 'Cannot load app resources. Please restart or reinstall.')); }
  }

  private L(zh: string, en: string): string { return this.language === 'en' ? en : zh; }
  private message(value: string): void { AlertDialog.show({ message: value, confirm: { value: this.L('好', 'OK'), action: () => {} } }); }
  private error(error: Error): void { this.message(error.message || this.L('操作失败，请重试', 'Operation failed. Please try again.')); }
  private currentURL(): string { try { return this.controller.getUrl(); } catch (_) { return ''; } }
  private flushCookies(): void { webview.WebCookieManager.saveCookieAsync().catch(() => {}); }

  private foregroundChanged(): void {
    if (!this.foreground) { this.events.stop(); this.interaction = 0; this.flushCookies(); }
    else this.startEvents();
  }

  private notificationOpened(): void {
    if (!this.ready || !this.pendingTarget) return;
    const target = this.pendingTarget;
    AppStorage.setOrCreate('bridgeTarget', '');
    for (const computer of this.computers) {
      if (!sameGateway(target, computer.base)) continue;
      try {
        if (target !== computer.base + '/') {
          const prefix = computer.base + '/#';
          if (!target.startsWith(prefix)) return;
          const fragment = target.substring(prefix.length).split('~');
          if (fragment.length !== 2 || chatURL(computer.base, decodeURIComponent(fragment[0]), decodeURIComponent(fragment[1])) !== target) return;
        }
        this.activeTab = 'codex'; this.closeServiceConfig();
        if (this.connected && this.base === computer.base) this.controller.loadUrl(target);
        else this.connect(target, computer.base);
      } catch (_) {}
      return;
    }
  }

  private startEvents(): void {
    if (this.activeTab !== 'codex' || !this.alerts || !this.foreground || !this.connected || !this.token || !sameGateway(this.currentURL(), this.base)) return;
    const ticket = this.generation;
    const base = this.base;
    this.events.start(this.context, this.controller, base, () => this.activeTab === 'codex' && this.alerts && this.foreground && this.connected &&
      ticket === this.generation && base === this.base && sameGateway(this.currentURL(), base));
  }

  private selectTab(id: string): void {
    this.interaction = 0;
    this.closeServiceConfig();
    this.activeTab = id;
    if (id === 'codex') { this.updateBars(this.codexTop); this.startEvents(); return; }
    this.events.stop();
    this.updateBars('#f5f5f3');
    const site = this.services.find((item: ServiceSite) => item.id === id);
    if (!site) return;
    if (!site.url) { this.configureService(site); return; }
    if (!this.loadedServices.some((item: ServiceSite) => item.id === id)) this.loadedServices = this.loadedServices.concat([site]);
  }

  private configureService(site: ServiceSite): void {
    this.configGeneration++;
    this.configId = site.id; this.serviceName = site.name; this.serviceAddress = site.url;
  }

  private closeServiceConfig(): void { this.configGeneration++; this.configId = ''; }

  private async saveService(): Promise<void> {
    const id = this.configId, address = this.serviceAddress, name = this.serviceName, ticket = this.configGeneration;
    if (!id || this.savingServices.includes(id)) return;
    if (id === 'keeper') { this.closeServiceConfig(); return; }
    this.savingServices = this.savingServices.concat([id]);
    try {
      const site = new ServiceSite(id, name || (id === 'cpa' ? 'CPA' : 'Magpie'), address);
      await this.serviceStore.save(site);
      this.services = this.services.map((item: ServiceSite) => item.id === id ? site : item);
      this.loadedServices = this.loadedServices.filter((item: ServiceSite) => item.id !== id).concat([site]);
      if (ticket === this.configGeneration && id === this.configId && address === this.serviceAddress && name === this.serviceName) this.closeServiceConfig();
    } catch (error) {
      if (ticket === this.configGeneration && id === this.configId) this.error(error as Error);
      else promptAction.showToast({ message: this.L('站点设置保存失败，请返回设置重试。', 'Site settings were not saved. Return to settings and retry.') });
    } finally { this.savingServices = this.savingServices.filter((item: string) => item !== id); }
  }

  private async toggleAlerts(): Promise<void> {
    if (this.alerts) {
      this.alerts = false; this.events.stop(); await this.store.alerts(false); return;
    }
    try {
      await notificationManager.requestEnableNotification(this.context);
      if (!await notificationManager.isNotificationEnabled()) throw new Error(this.L('请在系统设置中允许通知。', 'Allow notifications in system settings.'));
      this.alerts = true;
      await this.store.alerts(true);
      this.startEvents();
      this.message(this.L('仅在 App 前台时提醒当前电脑的新任务消息；首次连接及恢复前台不补发历史提醒。请同时在电脑网关开启“手机 App 通知收件箱”。',
        'New task notifications run only while this app is in the foreground and connected to this computer. Existing events are not replayed. Enable “Mobile app notification inbox” in the gateway too.'));
    } catch (error) { this.error(error as Error); }
  }

  private choose(value: string): void {
    try {
      const selected = gatewayConnection(value);
      const target = connectionURL(value);
      AlertDialog.show({
        title: this.L('连接到这台电脑？', 'Connect to this computer?'),
        message: selected.base + this.L('\n请确认这是你自己的网关。', '\nMake sure this is your own gateway.'),
        primaryButton: { value: this.L('取消', 'Cancel'), action: () => {} },
        secondaryButton: { value: this.L('连接', 'Connect'), action: () => { this.connect(target); } }
      });
    } catch (error) { this.error(error as Error); }
  }

  private async scan(): Promise<void> {
    try {
      const result = await scanBarcode.startScanForResult(this.context, {
        scanTypes: [scanCore.ScanType.QR_CODE], enableMultiMode: false, enableAlbum: true
      });
      if (result.originalValue) this.choose(result.originalValue);
    } catch (_) {
      promptAction.showToast({ message: this.L('扫码已取消或不可用，可继续粘贴网关地址。', 'Scan cancelled or unavailable. You can paste a gateway address.') });
    }
  }

  private async pasteAddress(): Promise<void> {
    try {
      const data = await pasteboard.getSystemPasteboard().getData();
      const value = data.getPrimaryText();
      if (value) this.address = value.substring(0, 8192);
    } catch (_) { this.message(this.L('无法读取剪贴板，请长按输入框粘贴。', 'Cannot read clipboard. Long press the address field to paste.')); }
  }

  private async connect(target: string, knownBase: string = ''): Promise<void> {
    if (!this.ready) return;
    try {
      const selected = gatewayConnection(knownBase || target);
      if (knownBase && !sameGateway(target, selected.base)) throw new Error('聊天链接无效');
      this.home();
      this.base = selected.base;
      this.target = target;
      const rows = this.computers.filter((item: Computer) => item.base !== this.base);
      const old = this.computers.find((item: Computer) => item.base === this.base);
      rows.unshift(new Computer(this.base, old ? old.name : selected.host, Date.now()));
      this.computers = rows.slice(0, 100);
      await this.store.save(this.computers);
      this.status = this.L('正在连接 · ', 'Connecting · ') + this.base;
      this.connected = true;
    } catch (error) { this.error(error as Error); }
  }

  private home(): void {
    this.events.stop();
    this.generation++;
    this.token = '';
    this.interaction = 0;
    this.cancelDownload();
    this.flushCookies();
    this.connected = false;
    this.status = '';
    this.base = '';
    this.target = '';
    this.codexTop = '#f5f5f3';
    this.updateBars('#f5f5f3');
  }

  private async rename(computer: Computer): Promise<void> {
    try {
      const name = this.editName.trim().substring(0, 80) || gatewayConnection(computer.base).host;
      this.computers = this.computers.map((item: Computer) => new Computer(item.base, item.base === computer.base ? name : item.name, item.opened));
      await this.store.save(this.computers);
      this.editBase = '';
    } catch (error) { this.error(error as Error); }
  }

  private remove(computer: Computer): void {
    AlertDialog.show({
      title: this.L('移除这台电脑？', 'Remove this computer?'),
      message: computer.base + this.L('\n清除本机保存的连接和此网关 Cookie，电脑上的聊天不受影响。', '\nRemove its saved connection and gateway cookies from this device. Computer chats are kept.'),
      primaryButton: { value: this.L('取消', 'Cancel'), action: () => {} },
      secondaryButton: { value: this.L('移除', 'Remove'), action: () => { this.removeComputer(computer); } }
    });
  }

  private async removeComputer(computer: Computer): Promise<void> {
    try {
      const cookies = await webview.WebCookieManager.fetchCookie(computer.base + '/');
      const selected = gatewayConnection(computer.base);
      const path = selected.base.substring(selected.origin.length) + '/';
      for (const cookie of cookies.split(';')) {
        const name = cookie.trim().split('=')[0];
        if (new RegExp('^[!#$%&\'*+.^_`|~0-9A-Za-z-]+$').test(name)) {
          await webview.WebCookieManager.configCookie(computer.base + '/', name + '=; Path=' + path + '; Max-Age=0; HttpOnly; SameSite=Strict' + (computer.base.startsWith('https:') ? '; Secure' : ''), false, true);
        }
      }
      await webview.WebCookieManager.saveCookieAsync();
      this.computers = this.computers.filter((item: Computer) => item.base !== computer.base);
      await this.store.save(this.computers);
    } catch (error) { this.error(error as Error); }
  }

  private async pageFinished(target: string): Promise<void> {
    const current = this.currentURL();
    if (!this.connected || !sameGateway(target, this.base) || !sameGateway(current, this.base) || isPreviewShell(current, this.base) || isPreviewShell(target, this.base)) return;
    const ticket = this.generation;
    const token = this.token;
    try {
      await this.controller.runJavaScript(mobileScript(this.scripts, token, current));
      if (ticket === this.generation) this.status = '';
      this.flushCookies();
      if (ticket === this.generation) this.startEvents();
    } catch (_) { if (ticket === this.generation) this.status = this.L('页面适配失败，请在菜单中刷新。', 'Page setup failed. Refresh from the menu.'); }
  }

  private intercept(request: WebResourceRequest): boolean {
    const target = request.getRequestUrl();
    if (!request.isMainFrame()) return !isPreviewShell(target, this.base);
    if (isPreviewShell(target, this.base)) return true;
    const gesture = request.isRequestGesture() && this.foreground;
    if (target === 'codexbridge://home' && gesture && sameGateway(this.currentURL(), this.base)) { this.home(); return true; }
    if (acceptsDownload(target, this.base) && gesture && sameGateway(this.currentURL(), this.base)) { this.beginDownload(target); return true; }
    if (sameGateway(target, this.base)) return false;
    if (gesture && externalHTTP(target) && sameGateway(this.currentURL(), this.base)) this.openExternal(target);
    return true;
  }

  private openExternal(target: string): void {
    AlertDialog.show({
      title: this.L('在浏览器打开外部链接？', 'Open external link in browser?'), message: target.substring(0, 1024),
      primaryButton: { value: this.L('取消', 'Cancel'), action: () => {} },
      secondaryButton: { value: this.L('打开', 'Open'), action: () => {
        this.context.startAbility({ action: 'ohos.want.action.viewData', uri: target, entities: ['entity.system.browsable'] })
          .catch(() => { this.message(this.L('没有可用的浏览器', 'No browser available')); });
      } }
    });
  }

  private prompt(event: OnPromptEvent): boolean {
    if (!event.message.startsWith('codexbridge-')) {
      if (isPreviewShell(event.url, this.base)) { event.result.handleCancel(); return true; }
      return false;
    }
    const command = this.foreground && this.connected ? validPrompt(event.message, this.token, event.url, this.currentURL(), this.base) : '';
    if (command === 'computer') {
      const computer = this.computers.find((item: Computer) => item.base === this.base);
      event.result.handlePromptConfirm(computer ? computer.name : gatewayConnection(this.base).host);
    } else if (command === 'copy' && this.activeTab === 'codex' && event.value.length <= 262144 && this.interaction > 0 && Date.now() - this.interaction < 15000) {
      this.interaction = 0;
      try {
        pasteboard.getSystemPasteboard().setDataSync(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, event.value));
        event.result.handlePromptConfirm('copied');
      } catch (_) { event.result.handleCancel(); }
    } else if (command === 'language' && (event.value === 'zh' || event.value === 'en')) {
      this.language = event.value;
      this.store.language(event.value).catch(() => {});
      event.result.handlePromptConfirm('saved');
    } else if (command === 'system-bars' && this.activeTab === 'codex' && event.value.length < 100) {
      try {
        const colors = JSON.parse(event.value) as BarColors;
        if (!new RegExp('^#[0-9a-fA-F]{6}$').test(colors.top) || !new RegExp('^#[0-9a-fA-F]{6}$').test(colors.bottom)) throw new Error('color');
        this.codexTop = colors.top;
        this.updateBars(colors.top);
        event.result.handlePromptConfirm('saved');
      } catch (_) { event.result.handleCancel(); }
    } else if (command === 'session' || command === 'logout') {
      this.events.stop(); this.flushCookies();
      if (command === 'session') this.startEvents();
      event.result.handlePromptConfirm(command === 'session' ? 'saved' : 'cleared');
    } else {
      // No secret backup is restored after auth loss; the gateway login page remains authoritative.
      event.result.handleCancel();
    }
    return true;
  }

  private updateBars(top: string): void {
    window.getLastWindow(this.context).then((current: window.Window) => {
      current.setWindowSystemBarProperties({ statusBarColor: top, navigationBarColor: '#f5f5f3',
        statusBarContentColor: this.barText(top), navigationBarContentColor: '#202124' }).catch(() => {});
    }).catch(() => {});
  }

  private barText(color: string): string {
    const red = parseInt(color.substring(1, 3), 16), green = parseInt(color.substring(3, 5), 16), blue = parseInt(color.substring(5, 7), 16);
    return red * 0.299 + green * 0.587 + blue * 0.114 > 150 ? '#202124' : '#ffffff';
  }

  private navigationIcon(id: string): Resource {
    const selected = this.activeTab === id;
    if (id === 'codex') return selected ? $r('app.media.nav_codex_selected') : $r('app.media.nav_codex');
    if (id === 'keeper') return selected ? $r('app.media.nav_keeper_selected') : $r('app.media.nav_keeper');
    if (id === 'cpa') return selected ? $r('app.media.nav_cpa_selected') : $r('app.media.nav_cpa');
    return selected ? $r('app.media.nav_magpie_selected') : $r('app.media.nav_magpie');
  }

  private openNavigationSettings(): void {
    if (!this.ready || this.savingNavigation || this.navigationSettings) return;
    this.editNavigationBlur = this.navigationBlur;
    this.editNavigationSystem = this.navigationSystem;
    this.editNavigationThickness = this.navigationThickness;
    this.navigationSettings = true;
  }

  private navigationMaterial(): NavigationMaterial {
    return new NavigationMaterial(this.navigationSettings ? this.editNavigationBlur : this.navigationBlur,
      this.navigationSettings ? this.editNavigationSystem : this.navigationSystem,
      this.navigationSettings ? this.editNavigationThickness : this.navigationThickness,
      this.systemGlassAvailable ? this.systemGlass : undefined);
  }

  private async saveNavigationSettings(): Promise<void> {
    if (this.savingNavigation) return;
    const value = new NavigationAppearance(this.editNavigationSystem, this.editNavigationBlur, this.editNavigationThickness);
    this.savingNavigation = true;
    try {
      await this.store.navigationAppearance(value);
      this.navigationBlur = value.blur;
      this.navigationSystem = value.system;
      this.navigationThickness = value.thickness;
      this.navigationSettings = false;
    } catch (error) { this.error(error as Error); }
    finally { this.savingNavigation = false; }
  }

  @Builder
  private navigationSettingsPanel() {
    Scroll() {
      Column({ space: 16 }) {
        Text(this.L('底栏外观', 'Navigation appearance')).fontSize(23).fontWeight(FontWeight.Bold).fontColor('#202124').width('100%')
        Stack() {
          Row({ space: 24 }) {
            Circle().width(54).height(54).fill('#A9C8FF')
            Circle().width(42).height(42).fill('#FFD9A5')
          }
          Row({ space: 8 }) {
            Image($r('app.media.nav_codex_selected')).width(24).height(24)
            Text('Codex+').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#303640')
          }.width('85%').height(54).justifyContent(FlexAlign.Center).borderRadius(27).attributeModifier(this.navigationMaterial())
        }.height(76).width('100%')
        Row({ space: 12 }) {
          Text(this.L('系统沉浸材质', 'System immersive material')).fontSize(16).fontColor('#202124').layoutWeight(1)
          Toggle({ type: ToggleType.Switch, isOn: this.editNavigationSystem && this.systemGlassAvailable })
            .enabled(this.systemGlassAvailable && !this.savingNavigation)
            .onChange((value: boolean) => { this.editNavigationSystem = value; })
        }.width('100%').constraintSize({ minHeight: 44 })
        if (this.systemGlassAvailable && this.editNavigationSystem) {
          Text(this.L('系统提供五档材质厚度；实际效果遵循设备能力和系统设置。', 'Five material presets follow this device and its system settings.'))
            .fontSize(13).fontColor('#59636F').width('100%')
          Row({ space: 4 }) {
            ForEach(this.language === 'en' ? ['Lightest', 'Thin', 'Regular', 'Thick', 'Thickest'] : ['超薄', '薄', '标准', '厚', '超厚'], (label: string, index: number) => {
              Button(label).layoutWeight(1).height(44).padding({ left: 2, right: 2 }).fontSize(12)
                .fontColor(this.editNavigationThickness === index ? '#FFFFFF' : '#303640')
                .backgroundColor(this.editNavigationThickness === index ? '#0A59F7' : '#E8EDF2').borderRadius(12)
                .enabled(!this.savingNavigation).onClick(() => { this.editNavigationThickness = index; })
            }, (label: string) => label)
          }.width('100%')
        } else {
          Text(this.systemGlassAvailable ? this.L('可连续调整背景模糊，拖动时实时预览。', 'Adjust background blur with a live preview.') :
            this.L('此设备目前未启用系统沉浸材质，使用可调背景模糊。', 'System immersive material is unavailable here; adjustable background blur is used.'))
            .fontSize(13).fontColor('#59636F').width('100%')
          Row() {
            Text(this.L('模糊强度', 'Blur strength')).fontSize(16).fontColor('#202124').layoutWeight(1)
            Text(this.editNavigationBlur.toString() + '%').fontSize(14).fontColor('#59636F')
          }.width('100%')
          Slider({ value: this.editNavigationBlur, min: 0, max: 100, step: 1 }).width('100%').enabled(!this.savingNavigation)
            .showTips(true).onChange((value: number) => { this.editNavigationBlur = Math.round(value); })
        }
        Text(this.L('长按任意页签的底栏可再次打开。设置只保存在本机，不刷新网页。', 'Long-press the navigation on any tab to return. Settings stay on this device; pages keep their state.'))
          .fontSize(13).fontColor('#59636F').width('100%')
        Row({ space: 12 }) {
          Button(this.L('恢复默认', 'Reset')).layoutWeight(1).height(48).backgroundColor('#E8EDF2').fontColor('#303640')
            .enabled(!this.savingNavigation).onClick(() => { this.editNavigationBlur = 100; this.editNavigationSystem = true; this.editNavigationThickness = 1; })
          Button(this.savingNavigation ? this.L('保存中…', 'Saving…') : this.L('完成', 'Done')).layoutWeight(1).height(48)
            .backgroundColor('#0A59F7').fontColor('#FFFFFF').enabled(!this.savingNavigation).onClick(() => { this.saveNavigationSettings(); })
        }.width('100%')
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 20, right: 20, top: 8, bottom: 24 })
    }.width('100%').height('100%')
  }

  @Builder
  private navigationItem(id: string, label: string) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 4 }) {
        Image(this.navigationIcon(id)).width(24).height(24).objectFit(ImageFit.Contain)
          .draggable(false).accessibilityLevel('no')
        Text(label).width('100%').fontSize(12).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .textAlign(TextAlign.Center).fontWeight(this.activeTab === id ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(this.activeTab === id ? '#0A59F7' : '#303640')
      }.width('100%').justifyContent(FlexAlign.Center)
    }.layoutWeight(1).constraintSize({ minHeight: 60 }).padding({ left: 3, right: 3, top: 8, bottom: 8 })
      .backgroundColor(Color.Transparent).borderRadius(30)
      .accessibilityGroup(true).accessibilityText(label + (this.activeTab === id ? this.L('，已选中', ', selected') : ''))
      .onClick(() => { this.selectTab(id); })
  }

  private async upload(event: OnShowFileSelectorEvent): Promise<void> {
    const ticket = this.generation;
    const base = this.base;
    if (this.activeTab !== 'codex' || !this.foreground || !sameGateway(this.currentURL(), base) || isPreviewShell(this.currentURL(), base) ||
      event.fileSelector.getMode() === FileSelectorMode.FileOpenFolderMode || event.fileSelector.getMode() === FileSelectorMode.FileSaveMode) {
      event.result.handleFileList([]); return;
    }
    try {
      const gesture = await this.controller.runJavaScript(uploadGestureScript(this.token));
      if (webString(gesture) !== 'true' || ticket !== this.generation || base !== this.base || !this.foreground) {
        event.result.handleFileList([]); return;
      }
      const selected = await selectUpload(this.context, event.fileSelector.getMode() === FileSelectorMode.FileOpenMultipleMode);
      event.result.handleFileList(ticket === this.generation && base === this.base && sameGateway(this.currentURL(), base) ? selected : []);
    } catch (_) { event.result.handleFileList([]); }
  }

  private async beginDownload(target: string): Promise<void> {
    if (this.downloadBusy || this.downloaded) { this.message(this.L('请先保存或取消当前下载。', 'Save or cancel the current download first.')); return; }
    if (!this.foreground || !sameGateway(this.currentURL(), this.base) || !acceptsDownload(target, this.base)) return;
    const ticket = this.generation;
    const base = this.base;
    const task = new AttachmentDownload();
    this.attachment = task;
    this.downloadBusy = true;
    this.downloadLabel = this.L('正在下载…', 'Downloading…');
    try {
      const result = await task.fetch(this.context, this.controller, target, base,
        () => ticket === this.generation && this.base === base && sameGateway(this.currentURL(), base),
        (bytes: number) => { if (ticket === this.generation) this.downloadLabel = this.L('正在下载 · ', 'Downloading · ') + (bytes / 1024).toFixed(0) + ' KiB'; });
      if (ticket !== this.generation || this.attachment !== task) { discardAttachment(result); return; }
      this.downloaded = result;
      this.downloadName = result.name;
      this.downloadLabel = this.L('下载完成，请选择保存位置。', 'Download complete. Choose where to save.');
    } catch (error) { if (ticket === this.generation && this.attachment === task) { this.downloadLabel = ''; this.error(error as Error); } }
    finally { if (ticket === this.generation && this.attachment === task) this.downloadBusy = false; }
  }

  private cancelDownload(): void {
    if (this.attachment) this.attachment.cancel(this.controller);
    if (this.downloaded) discardAttachment(this.downloaded);
    this.attachment = undefined;
    this.downloaded = undefined;
    this.downloadBusy = false;
    this.downloadLabel = '';
    this.downloadName = '';
  }

  private async saveDownload(): Promise<void> {
    const file = this.downloaded;
    if (!file || this.downloadBusy) return;
    this.downloadBusy = true;
    try {
      if (await saveAttachment(this.context, file)) {
        this.cancelDownload();
        promptAction.showToast({ message: this.L('文件已保存', 'File saved') });
      }
    } catch (error) { this.error(error as Error); }
    finally { this.downloadBusy = false; }
  }

  private webAction(script: string): void {
    if (sameGateway(this.currentURL(), this.base) && !isPreviewShell(this.currentURL(), this.base)) this.controller.runJavaScript(script).catch(() => {});
  }

  onBackPress(): boolean {
    if (this.navigationSettings) { if (!this.savingNavigation) this.navigationSettings = false; return true; }
    if (this.configId) { if (!this.savingServices.includes(this.configId)) this.closeServiceConfig(); return true; }
    if (this.activeTab !== 'codex') { this.selectTab('codex'); return true; }
    if (!this.connected) return false;
    const ticket = this.generation;
    if (!sameGateway(this.currentURL(), this.base)) { this.home(); return true; }
    this.controller.runJavaScript(BACK_SCRIPT).then((result: string) => {
      if (ticket === this.generation && webString(result) !== 'true') this.home();
    }).catch(() => { if (ticket === this.generation) this.home(); });
    return true;
  }

  @Builder
  private gatewayMenu() {
    Menu() {
      MenuItem({ content: this.L('返回电脑列表', 'Computers') }).onClick(() => { this.home(); })
      MenuItem({ content: this.L('账号与接入', 'Accounts and access') }).onClick(() => {
        this.webAction("(() => { if (typeof window.BridgeNavigation?.accounts === 'function') return window.BridgeNavigation.accounts(); document.getElementById('accounts-button')?.click(); })()");
      })
      MenuItem({ content: this.L('外观与显示', 'Appearance') }).onClick(() => { this.webAction("document.querySelector('[data-open-appearance]')?.click()"); })
      MenuItem({ content: this.L('底栏外观', 'Navigation appearance') }).onClick(() => { this.openNavigationSettings(); })
      MenuItem({ content: this.L('刷新页面', 'Refresh') }).onClick(() => { this.controller.refresh(); })
      MenuItem({ content: this.alerts ? this.L('关闭前台任务通知', 'Disable foreground alerts') : this.L('开启前台任务通知', 'Enable foreground alerts') }).onClick(() => { this.toggleAlerts(); })
      MenuItem({ content: this.L('关于鸿蒙版', 'About HarmonyOS') }).onClick(() => {
        this.message(this.L('Codex Mobile Bridge 2.1.1 · HarmonyOS\n聊天、配对与文件管理沿用电脑网关。任务通知仅当前电脑、App 前台有效；首版不含后台推送和设备密钥凭据恢复。附件下载上限 20 MiB。',
          'Codex Mobile Bridge 2.1.1 · HarmonyOS\nChats, pairing and files use your gateway. Alerts run for the current computer while this app is visible. Background push and encrypted credential recovery are not included. Attachment limit: 20 MiB.'));
      })
    }
  }

  @Builder
  private computerCard(computer: Computer) {
    Column({ space: 10 }) {
      Button() {
        Column({ space: 6 }) {
          Text(computer.name).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#202124').width('100%').textAlign(TextAlign.Start).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(computer.base).fontSize(13).fontColor('#777b80').width('100%').textAlign(TextAlign.Start).maxLines(2)
        }.width('100%')
      }.type(ButtonType.Normal).backgroundColor(Color.Transparent).padding(0).width('100%')
      .accessibilityText(this.L('连接 ', 'Connect to ') + computer.name).onClick(() => { this.connect(computer.base + '/'); })
      if (this.editBase === computer.base) {
        TextInput({ text: this.editName, placeholder: this.L('电脑名称', 'Computer name') }).maxLength(80).onChange((value: string) => { this.editName = value; })
        Row({ space: 8 }) {
          Button(this.L('取消', 'Cancel')).layoutWeight(1).backgroundColor('#f4f5f7').fontColor('#202124').onClick(() => { this.editBase = ''; })
          Button(this.L('保存', 'Save')).layoutWeight(1).backgroundColor('#202124').fontColor('#ffffff').onClick(() => { this.rename(computer); })
        }
      } else {
        Row({ space: 8 }) {
          Button(this.L('重命名', 'Rename')).layoutWeight(1).height(44).borderRadius(12).backgroundColor('#f4f5f7').fontColor('#202124')
            .onClick(() => { this.editBase = computer.base; this.editName = computer.name; })
          Button(this.L('移除', 'Remove')).layoutWeight(1).height(44).borderRadius(12).backgroundColor('#f4f5f7').fontColor('#b44235').onClick(() => { this.remove(computer); })
        }
      }
    }.alignItems(HorizontalAlign.Start).width('100%').padding({ left: 20, right: 20, top: 16, bottom: 16 }).backgroundColor('#ffffff').borderRadius(22)
  }

  build() {
    Column() {
      Stack() {
        Column() {
      if (!this.connected) {
        Row() {
          Text('Codex Bridge').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#202124').layoutWeight(1)
          Button(this.language === 'en' ? '中文' : 'EN').height(44).backgroundColor(Color.Transparent).fontColor('#777b80')
            .onClick(() => { this.language = this.language === 'en' ? 'zh' : 'en'; this.store.language(this.language).catch(() => {}); })
        }.height(56).padding({ left: 20, right: 12 })
        Scroll() {
          Column({ space: 16 }) {
            Text(this.L('电脑上的工作，\n带在身边。', 'Your computer’s work,\nalways with you.')).fontSize(30).fontWeight(FontWeight.Bold).fontColor('#202124').textAlign(TextAlign.Center).margin({ top: 30 })
            Text(this.L('继续聊天、查看结果，让电脑替你运行。', 'Keep chatting and check results while your computer works.')).fontSize(15).fontColor('#777b80').textAlign(TextAlign.Center).margin({ bottom: 10 })
            Column({ space: 8 }) {
              Button(this.L('扫码连接电脑', 'Scan to connect')).height(54).fontSize(16).width('100%').backgroundColor('#202124').fontColor('#ffffff').borderRadius(16).enabled(this.ready).onClick(() => { this.scan(); })
              Button(this.L('输入网关地址', 'Enter gateway address')).height(54).fontSize(16).width('100%').backgroundColor('#f4f5f7').fontColor('#202124').borderRadius(12).enabled(this.ready).onClick(() => { this.manual = !this.manual; })
              if (this.manual) {
                TextInput({ text: this.address, placeholder: 'https://' }).type(InputType.URL).maxLength(8192).fontSize(16).onChange((value: string) => { this.address = value; })
                Row({ space: 8 }) {
                  Button(this.L('粘贴', 'Paste')).layoutWeight(1).height(44).backgroundColor('#f4f5f7').fontColor('#202124').borderRadius(12).onClick(() => { this.pasteAddress(); })
                  Button(this.L('继续', 'Continue')).layoutWeight(1).height(44).backgroundColor('#202124').fontColor('#ffffff').borderRadius(12).onClick(() => { this.choose(this.address); })
                }
              }
            }.padding(20).width('100%').backgroundColor('#ffffff').borderRadius(22)
            Text(this.L('我的电脑', 'My computers')).fontSize(19).fontWeight(FontWeight.Bold).fontColor('#202124').width('100%').margin({ top: 8 })
            if (this.computers.length === 0) {
              Column({ space: 8 }) {
                Text(this.L('还没有连接的电脑', 'No computers yet')).fontSize(17).fontColor('#202124').width('100%')
                Text(this.L('在电脑网关中展开“扫码登录”，然后用上方按钮扫描。', 'Expand “Scan to sign in” in your computer gateway, then scan it above.')).fontSize(14).fontColor('#777b80').width('100%')
              }.padding(20).width('100%').backgroundColor('#ffffff').borderRadius(22).alignItems(HorizontalAlign.Start)
            }
            ForEach(this.computers, (computer: Computer) => { this.computerCard(computer); }, (computer: Computer) => computer.base)
            Text(this.L('外出使用 HTTPS 地址；局域网地址需要连接同一网络。', 'Use HTTPS away from home. LAN addresses need the same network.')).fontSize(13).fontColor('#777b80').textAlign(TextAlign.Center)
          }.padding({ left: 20, right: 20, bottom: 24 }).width('100%')
        }.layoutWeight(1).width('100%')
      } else {
        if (this.status) { Text(this.status).fontSize(12).fontColor('#777b80').padding(6).width('100%').textAlign(TextAlign.Center) }
        Stack({ alignContent: Alignment.TopEnd }) {
          Web({ src: this.target, controller: this.controller })
            .javaScriptAccess(true).domStorageAccess(true).fileAccess(false).mixedMode(MixedMode.None).multiWindowAccess(false).geolocationAccess(false)
            .onControllerAttached(() => {
              // Older gateways recognize the Android suffix; the first token identifies the real host to newer gateways.
              this.controller.setCustomUserAgent(this.controller.getUserAgent() + ' BridgeMobile/2.1.1-HarmonyOS BridgeMobile/2.1.1-Android');
            })
            .onPageBegin(() => { this.events.stop(); this.generation++; this.token = util.generateRandomUUID(); this.interaction = 0; this.cancelDownload(); })
            .onPageEnd((event) => { if (event) this.pageFinished(event.url); })
            .onLoadIntercept((event) => event ? this.intercept(event.data) : true)
            .onPrompt((event) => event ? this.prompt(event) : true)
            .onAlert((event) => { if (event && isPreviewShell(event.url, this.base)) { event.result.handleCancel(); return true; } return false; })
            .onConfirm((event) => { if (event && isPreviewShell(event.url, this.base)) { event.result.handleCancel(); return true; } return false; })
            .onShowFileSelector((event) => { if (event) this.upload(event); return true; })
            .onDownloadStart((event) => { if (event && this.foreground && this.interaction > 0 && Date.now() - this.interaction < 15000) { this.interaction = 0; this.beginDownload(event.url); } })
            .onErrorReceive((event) => { if (event && event.request.isMainFrame()) this.status = this.L('连接失败，请在菜单中刷新。', 'Connection failed. Refresh from the menu.'); })
            .onTouch((event: TouchEvent) => { if (event.type === TouchType.Up && this.foreground) this.interaction = Date.now(); })
            .onKeyEvent((event: KeyEvent) => { if (event.type === KeyType.Up && this.foreground) this.interaction = Date.now(); })
            .width('100%').height('100%')
          Button('•••').width(48).height(48).fontSize(18).fontColor('#777b80').backgroundColor('#f4f5f7').borderRadius(16).margin({ top: 4, right: 8 })
            .accessibilityText(this.L('电脑与聊天选项', 'Computer and chat options')).bindMenu(this.gatewayMenu)
        }.width('100%').layoutWeight(1)
        if (this.downloadLabel) {
          Column({ space: 8 }) {
            if (this.downloadName) { Text(this.downloadName).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#202124').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }) }
            Text(this.downloadLabel).fontSize(13).fontColor('#777b80')
            Row({ space: 8 }) {
              Button(this.L('取消下载', 'Cancel')).height(44).layoutWeight(1).backgroundColor('#f4f5f7').fontColor('#202124').onClick(() => { this.cancelDownload(); })
              if (this.downloadName) { Button(this.L('保存文件', 'Save file')).height(44).layoutWeight(1).backgroundColor('#202124').fontColor('#ffffff').enabled(!this.downloadBusy).onClick(() => { this.saveDownload(); }) }
            }
          }.padding(16).width('100%').backgroundColor('#ffffff')
        }
      }
        }.width('100%').height('100%').visibility(this.activeTab === 'codex' ? Visibility.Visible : Visibility.Hidden)
        ForEach(this.loadedServices, (site: ServiceSite) => {
          ServiceWeb({ site: site, active: this.activeTab === site.id && !this.configId,
            onConfigure: () => { this.configureService(site); } })
            .visibility(this.activeTab === site.id && !this.configId ? Visibility.Visible : Visibility.Hidden)
        }, (site: ServiceSite) => site.id + '|' + site.url)
        if (this.configId) {
          Column({ space: 16 }) {
            Text(this.configId === 'keeper' ? 'Keeper' : '配置管理站点').fontSize(23).fontWeight(FontWeight.Bold).fontColor('#202124').width('100%')
            Text(this.configId === 'keeper' ? 'Keeper 使用固定地址。登录信息可在网页工具栏中保存；你在应用内自行输入。' : '填写真实 HTTPS 地址。保存后首次加载；之后切换页签保留网页。修改地址会重新加载此站点。')
              .fontSize(14).fontColor('#777b80').width('100%')
            TextInput({ text: this.serviceName, placeholder: '站点名称' }).maxLength(16).enabled(this.configId !== 'keeper' && !this.savingServices.includes(this.configId)).onChange((value: string) => { this.serviceName = value; })
            TextInput({ text: this.serviceAddress, placeholder: 'https://' }).type(InputType.URL).maxLength(4096).enabled(this.configId !== 'keeper' && !this.savingServices.includes(this.configId)).onChange((value: string) => { this.serviceAddress = value; })
            Text('请勿在地址中包含用户名、密码或访问令牌。登录后 Cookie 由系统网页组件保存。').fontSize(13).fontColor('#777b80').width('100%')
            Button(this.savingServices.includes(this.configId) ? '保存中…' : (this.configId === 'keeper' ? '返回网页' : '保存并打开')).width('100%').height(54).backgroundColor('#202124').fontColor('#ffffff').enabled(!this.savingServices.includes(this.configId)).onClick(() => { this.saveService(); })
            Button('取消').width('100%').height(48).backgroundColor('#f4f5f7').fontColor('#202124').enabled(!this.savingServices.includes(this.configId)).onClick(() => { this.selectTab('codex'); })
          }.alignItems(HorizontalAlign.Start).padding(24).width('100%').height('100%').backgroundColor('#f5f5f3')
        }
      }.width('100%').layoutWeight(1)
      Row() {
        Row({ space: 2 }) {
          this.navigationItem('codex', 'Codex')
          ForEach(this.services, (site: ServiceSite) => {
            this.navigationItem(site.id, site.name)
          }, (site: ServiceSite) => site.id)
        }.padding({ left: 6, right: 6, top: 5, bottom: 5 }).width('90%').constraintSize({ maxWidth: 380 })
          .borderRadius(999)
          .attributeModifier(this.navigationMaterial())
          .priorityGesture(LongPressGesture({ repeat: false, duration: 600 }).onAction(() => { this.openNavigationSettings(); }))
      }.width('100%').justifyContent(FlexAlign.Center).padding({ top: 12, bottom: 2 })
    }.width('100%').height('100%').backgroundColor('#f5f5f3')
      .bindSheet($$this.navigationSettings, this.navigationSettingsPanel(), { height: '70%', showClose: !this.savingNavigation,
        backgroundColor: '#f5f5f3' })
  }
}
