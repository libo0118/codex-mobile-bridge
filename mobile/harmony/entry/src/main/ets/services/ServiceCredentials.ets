import common from '@ohos.app.ability.common';
import { CredentialVault, credentialScope, CredentialKind } from './CredentialVault';
import { credentialScopeMatches } from '../security/GatewayURL';

@Component
export struct ServiceCredentials {
  @Prop @Watch('scopeChanged') serviceId: string = '';
  @Prop @Watch('scopeChanged') configuredUrl: string = '';
  @Prop @Watch('scopeChanged') currentUrl: string = '';
  @Prop @Watch('scopeChanged') active: boolean = false;
  onFill: (username: string, secret: string, scope: string, kind: CredentialKind) => void = () => {};
  @State @Watch('sheetChanged') open: boolean = false;
  @State username: string = '';
  @State secret: string = '';
  @State saved: boolean = false;
  @State busy: boolean = false;
  @State feedback: string = '';
  @State kind: CredentialKind = 'password';
  private generation: number = 0;
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private vault: CredentialVault = new CredentialVault();

  aboutToDisappear(): void { this.scopeChanged(); }

  private scopeChanged(): void {
    this.generation++;
    this.open = false;
    this.username = ''; this.secret = ''; this.feedback = ''; this.busy = false;
  }

  private sheetChanged(): void {
    if (!this.open) { this.generation++; this.username = ''; this.secret = ''; this.busy = false; }
  }

  private valid(ticket: number, id: string, configured: string, current: string, scope: string): boolean {
    return this.samePanel(ticket, id, configured, current) && credentialScopeMatches(this.currentUrl, scope, this.configuredUrl);
  }

  private samePanel(ticket: number, id: string, configured: string, current: string): boolean {
    return this.active && this.open && ticket === this.generation && id === this.serviceId && configured === this.configuredUrl && current === this.currentUrl;
  }

  private async show(): Promise<void> {
    this.generation++;
    this.username = ''; this.secret = ''; this.feedback = ''; this.saved = false;
    this.open = true;
    const ticket = this.generation, id = this.serviceId, configured = this.configuredUrl, current = this.currentUrl;
    try {
      const scope = credentialScope(configured);
      if (!this.valid(ticket, id, configured, current, scope)) { this.feedback = '当前页面不在此站点的登录范围内。'; return; }
      const saved = await this.vault.has(this.context, id, scope);
      if (this.valid(ticket, id, configured, current, scope)) this.saved = saved;
    } catch (_) { if (this.samePanel(ticket, id, configured, current)) this.feedback = '无法读取安全存储状态，可忘记该站点登录信息后重新保存。'; }
  }

  private async save(): Promise<void> {
    const ticket = this.generation, id = this.serviceId, configured = this.configuredUrl, current = this.currentUrl;
    try {
      const scope = credentialScope(configured);
      if (!this.valid(ticket, id, configured, current, scope) || !this.secret || this.busy) return;
      this.busy = true;
      await this.vault.save(this.context, id, scope, this.username, this.secret, this.kind);
      if (this.valid(ticket, id, configured, current, scope)) { this.saved = true; this.feedback = '已安全保存。需要时使用下方的已保存信息。'; }
    } catch (_) { if (ticket === this.generation) this.feedback = '安全保存失败，未使用明文存储。'; }
    finally { if (ticket === this.generation) { this.secret = ''; this.username = ''; this.busy = false; } }
  }

  private async fillSaved(): Promise<void> {
    const ticket = this.generation, id = this.serviceId, configured = this.configuredUrl, current = this.currentUrl;
    try {
      const scope = credentialScope(configured);
      if (!this.valid(ticket, id, configured, current, scope) || this.busy) return;
      this.busy = true;
      const credential = await this.vault.load(this.context, id, scope);
      if (!credential) { if (ticket === this.generation) this.feedback = '此站点还没有保存登录信息。'; return; }
      try {
        if (this.valid(ticket, id, configured, current, scope) && credential.scope === scope) {
          if (credential.kind !== this.kind) { this.feedback = credential.kind === 'entry-link' ? '已保存的是私密入口链接，请先选择该方式。' : '已保存的是密码或管理密钥，请先选择该方式。'; return; }
          this.onFill(credential.username, credential.secret, credential.scope, credential.kind);
          this.open = false;
        }
      } finally { credential.secret = ''; credential.username = ''; }
    } catch (_) { if (ticket === this.generation) this.feedback = '无法解密登录信息，请重新保存。'; }
    finally { if (ticket === this.generation) this.busy = false; }
  }

  private async remove(): Promise<void> {
    const ticket = this.generation, id = this.serviceId, configured = this.configuredUrl, current = this.currentUrl;
    try {
      const scope = credentialScope(configured);
      if (!this.samePanel(ticket, id, configured, current) || this.busy) return;
      this.busy = true;
      await this.vault.remove(this.context, id, scope);
      if (this.samePanel(ticket, id, configured, current)) { this.saved = false; this.feedback = '已删除该站点本机保存的登录信息，包括更改地址前的记录。'; }
    } catch (_) { if (ticket === this.generation) this.feedback = '删除失败，请重试。'; }
    finally { if (ticket === this.generation) { this.secret = ''; this.username = ''; this.busy = false; } }
  }

  @Builder
  private sheetContent() {
    Column({ space: 12 }) {
      Text('登录信息').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#202124').width('100%')
      Text(this.configuredUrl).fontSize(13).fontColor('#777b80').width('100%').maxLines(2)
      Row({ space: 8 }) {
        Button('密码/管理密钥').layoutWeight(1).height(44).fontSize(13).fontColor(this.kind === 'password' ? '#ffffff' : '#202124').backgroundColor(this.kind === 'password' ? '#202124' : '#f4f5f7').enabled(!this.busy)
          .onClick(() => { this.kind = 'password'; this.secret = ''; this.username = ''; this.feedback = ''; })
        Button('私密入口链接').layoutWeight(1).height(44).fontSize(13).fontColor(this.kind === 'entry-link' ? '#ffffff' : '#202124').backgroundColor(this.kind === 'entry-link' ? '#202124' : '#f4f5f7').enabled(!this.busy)
          .onClick(() => { this.kind = 'entry-link'; this.secret = ''; this.username = ''; this.feedback = ''; })
      }.width('100%')
      Text(this.kind === 'entry-link' ? '在本机粘贴启动服务时给出的完整 HTTPS 私密链接。仅“打开安全入口”时使用，不写入普通站点设置。' : '密码或管理密钥由你在本机输入并明确保存。填入后请自行确认登录；应用不会自动提交。').fontSize(14).fontColor('#777b80').width('100%')
      if (this.kind === 'password') { TextInput({ text: this.username, placeholder: '用户名（可选）' }).maxLength(512).enabled(!this.busy).onChange((value: string) => { this.username = value; }) }
      TextInput({ text: this.secret, placeholder: this.kind === 'entry-link' ? '完整 HTTPS 私密入口链接' : '密码或管理密钥' }).type(InputType.Password).maxLength(this.kind === 'entry-link' ? 8192 : 4096).enabled(!this.busy).onChange((value: string) => { this.secret = value; })
      if (this.feedback) { Text(this.feedback).fontSize(13).fontColor('#777b80').width('100%') }
      Button('安全保存').width('100%').height(48).backgroundColor('#202124').fontColor('#ffffff').enabled(!this.busy && !!this.secret).onClick(() => { this.save(); })
      if (this.saved) {
        Button(this.kind === 'entry-link' ? '打开安全入口' : '填入已保存').width('100%').height(48).backgroundColor('#f4f5f7').fontColor('#202124').enabled(!this.busy).onClick(() => { this.fillSaved(); })
      }
      Button('忘记该站点登录信息').width('100%').height(44).backgroundColor(Color.Transparent).fontColor('#b44235').enabled(!this.busy).onClick(() => { this.remove(); })
      Button('关闭').width('100%').height(44).backgroundColor(Color.Transparent).fontColor('#777b80').onClick(() => { this.open = false; })
    }.padding(24).width('100%').backgroundColor('#ffffff').alignItems(HorizontalAlign.Start)
  }

  build() {
    Button('登录信息').height(44).fontSize(14).backgroundColor('#f4f5f7').fontColor('#202124').enabled(this.active)
      .onClick(() => { this.show(); })
      .bindSheet($$this.open, this.sheetContent(), { height: SheetSize.FIT_CONTENT, showClose: true })
  }
}
