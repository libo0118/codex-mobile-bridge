/** A selected gateway is an HTTP origin plus its optional relay scope. */
export class GatewayAddress {
  base: string = '';
  origin: string = '';
  path: string = '/';
  query: string = '';
  fragment: string = '';
  host: string = '';
  hasQuery: boolean = false;
  hasFragment: boolean = false;
}

function parse(value: string, allowPublicHTTP: boolean = false): GatewayAddress {
  if (value.length > 8192 || new RegExp('[\\x00-\\x20\\x7f\\\\]').test(value)) {
    throw new Error('网关地址包含无效字符');
  }
  const match = new RegExp('^(https?):\\/\\/([^/?#]+)([^?#]*)(\\?[^#]*)?(#.*)?$', 'i').exec(value);
  if (!match) throw new Error('请填写完整的 HTTP 或 HTTPS 网关地址');
  const authority = match[2].toLowerCase();
  const hostMatch = new RegExp('^(\\[[0-9a-f:]+\\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]+))?$').exec(authority);
  if (!hostMatch || authority.indexOf('@') >= 0) throw new Error('网关地址不能包含账号或密码');
  const port = hostMatch[2] ? Number(hostMatch[2]) : -1;
  if (port !== -1 && (port < 1 || port > 65535)) throw new Error('网关端口无效');
  const host = hostMatch[1];
  if (host.indexOf('..') >= 0 || host === '.' || host === '[]') throw new Error('网关主机名无效');
  const scheme = match[1].toLowerCase();
  if (scheme === 'http' && !allowPublicHTTP && !localHost(host)) throw new Error('公网地址必须使用 HTTPS；HTTP 仅限局域网');
  const result = new GatewayAddress();
  result.origin = scheme + '://' + authority;
  result.path = match[3] || '/';
  result.query = match[4] ? match[4].substring(1) : '';
  result.fragment = match[5] ? match[5].substring(1) : '';
  result.hasQuery = !!match[4];
  result.hasFragment = !!match[5];
  result.host = host;
  return result;
}

export function localHost(host: string): boolean {
  if (host === 'localhost' || host === '[::1]') return true;
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const numbers: number[] = [];
  for (const part of parts) {
    const number = Number(part);
    if (!new RegExp('^[0-9]+$').test(part) || number < 0 || number > 255 || String(number) !== part) return false;
    numbers.push(number);
  }
  return numbers[0] === 10 || numbers[0] === 127 ||
    (numbers[0] === 192 && numbers[1] === 168) ||
    (numbers[0] === 172 && numbers[1] >= 16 && numbers[1] <= 31);
}

export function gatewayConnection(value: string): GatewayAddress {
  const result = parse(value.trim());
  if (result.hasQuery || !new RegExp('^/(?:d/[a-f0-9]{32}/?)?$').test(result.path)) {
    throw new Error('请使用电脑网关提供的根地址或中继地址，不含查询参数');
  }
  if (result.fragment && !new RegExp('^pair=[A-Za-z0-9_-]{43}$').test(result.fragment)) {
    throw new Error('请使用电脑网关提供的地址或二维码');
  }
  result.base = result.origin + (result.path.indexOf('/d/') === 0 ? result.path.replace(new RegExp('/$'), '') : '');
  return result;
}

export function connectionURL(value: string): string {
  const result = gatewayConnection(value);
  return result.base + '/' + (result.fragment ? '#' + result.fragment : '');
}

export function sameGateway(target: string, base: string): boolean {
  try {
    const selected = gatewayConnection(base);
    if (selected.fragment || selected.base !== base) return false;
    const requested = parse(target);
    const scope = selected.base.substring(selected.origin.length) + '/';
    return requested.origin === selected.origin && requested.path.indexOf(scope) === 0 &&
      requested.path.indexOf('%') < 0 && !new RegExp('(?:^|/)\\.{1,2}(?:/|$)').test(requested.path);
  } catch (_) { return false; }
}

export function apiPath(target: string, base: string): string {
  if (!sameGateway(target, base)) return '';
  const requested = parse(target);
  const selected = gatewayConnection(base);
  return '/' + requested.path.substring(selected.base.length - selected.origin.length + 1);
}

export function isPreviewShell(target: string, base: string): boolean {
  return target === base + '/html-preview-shell';
}

export function acceptsDownload(target: string, base: string): boolean {
  if (!sameGateway(target, base)) return false;
  const address = parse(target);
  if (address.hasFragment) return false;
  const path = apiPath(target, base);
  if (path === '/api/sessions/diagnostics') {
    return !address.hasQuery || new RegExp('^thread=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$').test(address.query);
  }
  return new RegExp('^(?:/api/sessions/[0-9a-f-]{36}/(?:files/[a-f0-9]{64}|workspace/download)|/api/desktop-sessions/(?:claude|deepseek)/workspace/download)$').test(path);
}

export function externalHTTP(target: string): boolean {
  try { parse(target, true); return true; } catch (_) { return false; }
}

export function httpsOrigin(target: string): string {
  const result = parse(target);
  if (!result.origin.startsWith('https://')) throw new Error('管理站点必须使用 HTTPS');
  return result.origin;
}

export function serviceURL(value: string): string {
  const clean = value.trim();
  const result = parse(clean);
  if (!result.origin.startsWith('https://') || result.hasQuery || result.hasFragment) throw new Error('请填写不含账号、参数或片段的 HTTPS 站点地址');
  return result.origin + result.path;
}

export function credentialScopeMatches(current: string, scope: string, configured: string): boolean {
  try {
    const page = parse(current), selected = parse(serviceURL(configured)), saved = parse(serviceURL(scope));
    const prefix = selected.path.replace(new RegExp('/+$'), '') || '/';
    const savedPath = saved.path.replace(new RegExp('/+$'), '') || '/';
    if (page.origin !== selected.origin || saved.origin !== selected.origin || savedPath !== prefix ||
      page.path.indexOf('%') >= 0 || new RegExp('(?:^|/)\\.{1,2}(?:/|$)').test(page.path)) return false;
    return prefix === '/' || page.path === prefix || page.path.startsWith(prefix + '/');
  } catch (_) { return false; }
}

export function chatURL(base: string, thread: string, host: string): string {
  const selected = gatewayConnection(base);
  const desktop = host === 'desktop:claude' || host === 'desktop:deepseek';
  if (selected.base !== base || selected.fragment || !thread || !host || thread.length > 512 || host.length > 256 ||
    new RegExp('[\\x00-\\x1f\\x7f]').test(thread + host) ||
    (!desktop && (host.startsWith('desktop:') || !new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$').test(thread)))) {
    throw new Error('聊天链接无效');
  }
  return base + '/#' + encodeURIComponent(thread).replace(new RegExp('~', 'g'), '%7E').replace(new RegExp('\\*', 'g'), '%2A') + '~' + encodeURIComponent(host);
}

export function validPrompt(message: string, token: string, source: string, current: string, base: string): string {
  if (!token || !sameGateway(source, base) || !sameGateway(current, base) ||
    isPreviewShell(source, base) || isPreviewShell(current, base)) return '';
  for (const command of ['computer', 'copy', 'language', 'system-bars', 'session', 'auth-lost', 'logout']) {
    if (message === 'codexbridge-' + command + ':' + token) return command;
  }
  return '';
}

export function safeFilename(value: string): string {
  const cleaned = value.replace(new RegExp('[\\x00-\\x1f\\x7f/\\\\:*?"<>|]', 'g'), '_').trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned.substring(0, 180) : 'download';
}
