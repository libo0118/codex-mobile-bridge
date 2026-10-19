import common from '@ohos.app.ability.common';
import preferences from '@ohos.data.preferences';
import { serviceURL, httpsOrigin } from '../security/GatewayURL';

export class ServiceSite {
  id: string;
  name: string;
  url: string;
  loginOrigin: string;
  constructor(id: string, name: string, url: string, loginOrigin: string = '') {
    this.id = id; this.name = name; this.url = url ? serviceURL(url) : '';
    this.loginOrigin = loginOrigin || (this.url ? httpsOrigin(this.url) : '');
  }
}

export class ServiceStore {
  private prefs?: preferences.Preferences;

  async load(context: common.UIAbilityContext): Promise<ServiceSite[]> {
    this.prefs = await preferences.getPreferences(context, { name: 'bridge-services' });
    const sites = [new ServiceSite('keeper', 'Keeper', 'https://libo.siasunagv.cn/keeper/'),
      new ServiceSite('cpa', 'CPA', ''), new ServiceSite('magpie', 'Magpie', 'https://libo.siasunagv.cn/magpie/')];
    for (const site of sites) {
      if (site.id === 'keeper') continue;
      const saved = await this.prefs.get(site.id, '');
      if (typeof saved !== 'string' || saved.length > 8192) continue;
      try {
        const row = JSON.parse(saved) as ServiceSite;
        site.url = serviceURL(row.url);
        site.name = typeof row.name === 'string' && row.name.trim() ? row.name.trim().substring(0, 16) : site.name;
        site.loginOrigin = httpsOrigin(site.url);
      } catch (_) { /* Unconfigured or invalid sites remain explicit empty entries. */ }
    }
    return sites;
  }

  async save(site: ServiceSite): Promise<void> {
    if (!this.prefs || (site.id !== 'cpa' && site.id !== 'magpie')) throw new Error('此站点地址不能修改');
    const clean = new ServiceSite(site.id, site.name.trim().substring(0, 16), serviceURL(site.url));
    await this.prefs.put(site.id, JSON.stringify(clean));
    await this.prefs.flush();
  }
}
