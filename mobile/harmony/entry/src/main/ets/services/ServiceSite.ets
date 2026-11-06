import common from '@ohos.app.ability.common';
import preferences from '@ohos.data.preferences';
import { serviceURL, httpsOrigin } from '../security/GatewayURL';

function chatServiceURL(value: string): string {
  const clean = value.trim();
  const query = clean.indexOf('?');
  if (query < 0) return serviceURL(clean);
  if (clean.substring(query) !== '?view=plugin-chat') throw new Error('Chat 地址仅支持 view=plugin-chat，不能包含其他参数或片段');
  return serviceURL(clean.substring(0, query)) + '?view=plugin-chat';
}

export class ServiceSite {
  id: string;
  name: string;
  url: string;
  loginOrigin: string;
  enabled: boolean;
  constructor(id: string, name: string, url: string, loginOrigin: string = '', enabled: boolean = true) {
    this.id = id; this.name = name; this.url = url ? (id === 'chat' ? chatServiceURL(url) : serviceURL(url)) : '';
    this.loginOrigin = loginOrigin || (this.url ? httpsOrigin(this.url) : '');
    this.enabled = enabled;
  }
}

export function serviceCredentialURL(site: ServiceSite): string {
  return site.id === 'chat' && site.url.endsWith('?view=plugin-chat') ? site.url.substring(0, site.url.indexOf('?')) : site.url;
}

export class ServiceStore {
  private prefs?: preferences.Preferences;

  async load(context: common.UIAbilityContext): Promise<ServiceSite[]> {
    this.prefs = await preferences.getPreferences(context, { name: 'bridge-services' });
    const sites = [new ServiceSite('keeper', 'Keeper', 'https://libo.siasunagv.cn/keeper/'),
      new ServiceSite('cpa', 'CPA', ''), new ServiceSite('magpie', 'Magpie', 'https://libo.siasunagv.cn/magpie/'),
      new ServiceSite('chat', 'Chat', 'https://libo.siasunagv.cn/magpie/?view=plugin-chat')];
    for (const site of sites) {
      if (site.id === 'keeper') continue;
      const saved = await this.prefs.get(site.id, '');
      if (saved === '') continue;
      if (typeof saved !== 'string' || saved.length > 8192) {
        if (site.id === 'chat') { site.url = ''; site.loginOrigin = ''; site.enabled = false; }
        continue;
      }
      try {
        const row = JSON.parse(saved) as ServiceSite;
        if (site.id === 'chat' && row.enabled !== undefined && typeof row.enabled !== 'boolean') throw new Error('站点启用状态无效');
        const enabled = site.id === 'chat' && row.enabled === false ? false : true;
        const url = site.id === 'chat' && !enabled && row.url === '' ? '' :
          site.id === 'chat' ? chatServiceURL(row.url) : serviceURL(row.url);
        const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim().substring(0, 16) : site.name;
        site.url = url; site.name = name; site.loginOrigin = url ? httpsOrigin(url) : ''; site.enabled = enabled;
      } catch (_) {
        if (site.id === 'chat') { site.url = ''; site.loginOrigin = ''; site.enabled = false; }
      }
    }
    return sites;
  }

  async save(site: ServiceSite): Promise<void> {
    if (!this.prefs || (site.id !== 'cpa' && site.id !== 'magpie' && site.id !== 'chat')) throw new Error('此站点地址不能修改');
    if (site.id === 'chat' && typeof site.enabled !== 'boolean') throw new Error('站点启用状态无效');
    const url = site.id === 'chat' && site.enabled === false && !site.url.trim() ? '' :
      site.id === 'chat' ? chatServiceURL(site.url) : serviceURL(site.url);
    const clean = new ServiceSite(site.id, site.name.trim().substring(0, 16), url, '', site.id === 'chat' ? site.enabled : true);
    await this.prefs.put(site.id, JSON.stringify(clean));
    await this.prefs.flush();
  }
}
