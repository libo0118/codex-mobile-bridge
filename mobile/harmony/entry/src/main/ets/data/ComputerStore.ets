import common from '@ohos.app.ability.common';
import preferences from '@ohos.data.preferences';
import { gatewayConnection } from '../security/GatewayURL';
import { NavigationAppearance, decodeNavigationAppearance } from '../appearance/NavigationAppearance';

export class Computer {
  base: string = '';
  name: string = '';
  opened: number = 0;
  constructor(base: string, name: string, opened: number = 0) {
    this.base = base;
    this.name = name;
    this.opened = opened;
  }
}

export class ComputerStore {
  private prefs?: preferences.Preferences;

  async load(context: common.UIAbilityContext): Promise<Computer[]> {
    this.prefs = await preferences.getPreferences(context, { name: 'bridge-computers' });
    const saved = await this.prefs.get('computers', '');
    if (typeof saved !== 'string' || saved.length > 65536) return [];
    const result: Computer[] = [];
    try {
      const rows = JSON.parse(saved) as Computer[];
      for (const row of rows) {
        if (result.length >= 100) break;
        try {
          const address = gatewayConnection(row.base);
          if (address.base !== row.base || address.fragment || result.some((item: Computer) => item.base === row.base)) continue;
          result.push(new Computer(row.base, typeof row.name === 'string' ? row.name.substring(0, 80) : address.host,
            typeof row.opened === 'number' && Number.isFinite(row.opened) ? row.opened : 0));
        } catch (_) { /* Invalid saved entries cannot become trusted connections. */ }
      }
    } catch (_) { return []; }
    return result.sort((left: Computer, right: Computer) => right.opened - left.opened);
  }

  async save(rows: Computer[]): Promise<void> {
    if (!this.prefs) throw new Error('电脑列表尚未就绪，请重试');
    await this.prefs.put('computers', JSON.stringify(rows));
    await this.prefs.flush();
  }

  async language(value: string): Promise<void> {
    if (!this.prefs || (value !== 'zh' && value !== 'en')) return;
    await this.prefs.put('language', value);
    await this.prefs.flush();
  }

  async savedLanguage(): Promise<string> {
    if (!this.prefs) return 'zh';
    return await this.prefs.get('language', 'zh') === 'en' ? 'en' : 'zh';
  }

  async alerts(value: boolean): Promise<void> {
    if (!this.prefs) return;
    await this.prefs.put('alerts', value);
    await this.prefs.flush();
  }

  async savedAlerts(): Promise<boolean> {
    return this.prefs ? await this.prefs.get('alerts', false) === true : false;
  }

  async savedNavigationAppearance(): Promise<NavigationAppearance> {
    if (!this.prefs) return new NavigationAppearance();
    const saved = await this.prefs.get('navigationAppearance', '');
    return typeof saved === 'string' ? decodeNavigationAppearance(saved) : new NavigationAppearance();
  }

  async navigationAppearance(value: NavigationAppearance): Promise<void> {
    if (!this.prefs) throw new Error('应用设置尚未就绪，请重试');
    const saved = new NavigationAppearance(value.system, value.blur, value.thickness);
    await this.prefs.put('navigationAppearance', JSON.stringify(saved));
    await this.prefs.flush();
  }
}
