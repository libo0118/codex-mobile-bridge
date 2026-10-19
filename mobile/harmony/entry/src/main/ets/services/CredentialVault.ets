import common from '@ohos.app.ability.common';
import { BusinessError } from '@ohos.base';
import preferences from '@ohos.data.preferences';
import huks from '@ohos.security.huks';
import cryptoFramework from '@ohos.security.cryptoFramework';
import util from '@ohos.util';
import { serviceURL, httpsOrigin, credentialScopeMatches } from '../security/GatewayURL';

export type CredentialKind = 'password' | 'entry-link';

export class ServiceCredential {
  scope: string;
  username: string;
  secret: string;
  kind: CredentialKind;
  constructor(scope: string, username: string, secret: string, kind: CredentialKind = 'password') {
    this.scope = scope; this.username = username; this.secret = secret; this.kind = kind;
  }
}

class EncryptedCredential {
  version: number = 1;
  scope: string = '';
  nonce: string = '';
  ciphertext: string = '';
}

const KEY_ALIAS: string = 'codex-bridge-service-credentials-v1';
const PREFERENCES_NAME: string = 'bridge-service-credentials';
let writes: Promise<void> = Promise.resolve();

export function credentialScope(configuredUrl: string): string {
  const clean = serviceURL(configuredUrl);
  if (!credentialScopeMatches(clean, clean, clean)) throw new Error('登录范围必须是有效的 HTTPS 站点路径');
  const origin = httpsOrigin(clean);
  return origin + (clean.substring(origin.length).replace(new RegExp('/+$'), '') || '/');
}

function checkService(serviceId: string): void {
  if (serviceId !== 'keeper' && serviceId !== 'cpa' && serviceId !== 'magpie') throw new Error('管理站点无效');
}

function checkedCredential(scope: string, username: string, secret: string, kind: CredentialKind): ServiceCredential {
  if (typeof username !== 'string' || username.length > 512 || typeof secret !== 'string' || !secret ||
    secret.length > (kind === 'entry-link' ? 8192 : 4096) || (kind !== 'password' && kind !== 'entry-link')) {
    throw new Error('登录信息无效或过长');
  }
  if (kind === 'entry-link' && !credentialScopeMatches(secret, scope, scope)) {
    throw new Error('私密入口必须属于所配置的 HTTPS 站点和路径');
  }
  return new ServiceCredential(scope, username, secret, kind);
}

function keyProperties(): huks.HuksParam[] {
  return [
    { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
    { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
    { tag: huks.HuksTag.HUKS_TAG_PURPOSE,
      value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT | huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT },
    { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
    { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM }
  ];
}

async function ensureKey(): Promise<void> {
  let exists: boolean = false;
  try { exists = await huks.isKeyItemExist(KEY_ALIAS, { properties: [] }); }
  catch (error) { if ((error as BusinessError).code !== 12000011) throw new Error('无法访问系统安全密钥'); }
  if (!exists) {
    // HUKS generates and retains the AES key; no key material is imported or exported.
    await huks.generateKeyItem(KEY_ALIAS, { properties: keyProperties() });
  }
}

async function cipher(serviceId: string, scope: string, nonce: Uint8Array, input: Uint8Array,
  decrypt: boolean): Promise<Uint8Array> {
  const aad = new util.TextEncoder().encodeInto('codex-bridge-service-credential:v1\n' + serviceId + '\n' + scope);
  const properties: huks.HuksParam[] = [
    { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
    { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
    { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: decrypt ? huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT : huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT },
    { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
    { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM },
    { tag: huks.HuksTag.HUKS_TAG_NONCE, value: nonce },
    { tag: huks.HuksTag.HUKS_TAG_ASSOCIATED_DATA, value: aad }
  ];
  if (decrypt) properties.push({ tag: huks.HuksTag.HUKS_TAG_AE_TAG, value: input.slice(input.length - 16) });
  const session = await huks.initSession(KEY_ALIAS, { properties: properties });
  try {
    const result = await huks.finishSession(session.handle,
      { properties: properties, inData: decrypt ? input.slice(0, input.length - 16) : input });
    if (!result.outData || result.outData.length === 0 || (!decrypt && result.outData.length < 17)) {
      throw new Error('系统加密未返回有效结果');
    }
    return result.outData;
  } catch (_) {
    await huks.abortSession(session.handle, { properties: [] }).catch(() => {});
    throw new Error('系统安全存储操作失败，未填入登录信息');
  }
}

async function readRecord(prefs: preferences.Preferences, serviceId: string): Promise<EncryptedCredential | undefined> {
  const saved = await prefs.get(serviceId, '');
  if (saved === '') return undefined;
  if (typeof saved !== 'string' || saved.length > 65536) throw new Error('保存的登录信息已损坏，请忘记后重新保存');
  try {
    const record = JSON.parse(saved) as EncryptedCredential;
    if (record.version !== 1 || typeof record.scope !== 'string' || credentialScope(record.scope) !== record.scope ||
      typeof record.nonce !== 'string' || typeof record.ciphertext !== 'string') throw new Error('invalid');
    const base64 = new util.Base64Helper();
    const nonce = base64.decodeSync(record.nonce), ciphertext = base64.decodeSync(record.ciphertext);
    if (nonce.length !== 12 || ciphertext.length < 17 || ciphertext.length > 32784 ||
      base64.encodeToStringSync(nonce) !== record.nonce || base64.encodeToStringSync(ciphertext) !== record.ciphertext) {
      throw new Error('invalid');
    }
    return record;
  } catch (_) { throw new Error('保存的登录信息已损坏，请忘记后重新保存'); }
}

export class CredentialVault {
  async has(context: common.UIAbilityContext, serviceId: string, scope: string): Promise<boolean> {
    checkService(serviceId);
    const selected = credentialScope(scope);
    await writes;
    const prefs = await preferences.getPreferences(context, { name: PREFERENCES_NAME });
    const record = await readRecord(prefs, serviceId);
    return !!record && record.scope === selected;
  }

  async load(context: common.UIAbilityContext, serviceId: string, scope: string): Promise<ServiceCredential | undefined> {
    checkService(serviceId);
    const selected = credentialScope(scope);
    await writes;
    const prefs = await preferences.getPreferences(context, { name: PREFERENCES_NAME });
    const record = await readRecord(prefs, serviceId);
    if (!record || record.scope !== selected) return undefined;
    let plaintext: Uint8Array = new Uint8Array();
    try {
      const base64 = new util.Base64Helper();
      plaintext = await cipher(serviceId, selected, base64.decodeSync(record.nonce), base64.decodeSync(record.ciphertext), true);
      const value = JSON.parse(util.TextDecoder.create('utf-8', { fatal: true }).decodeWithStream(plaintext)) as ServiceCredential;
      if (value.scope !== selected) throw new Error('invalid');
      return checkedCredential(selected, value.username, value.secret, value.kind === undefined ? 'password' : value.kind);
    } catch (_) { throw new Error('无法解密保存的登录信息，请忘记后重新保存'); }
    finally { plaintext.fill(0); }
  }

  async save(context: common.UIAbilityContext, serviceId: string, scope: string, username: string, secret: string,
    kind: CredentialKind = 'password'): Promise<void> {
    checkService(serviceId);
    const selected = credentialScope(scope);
    const value = checkedCredential(selected, username, secret, kind);
    const operation = writes.then(async () => {
      const plaintext = new util.TextEncoder().encodeInto(JSON.stringify(value));
      try {
        if (plaintext.length > 32768) throw new Error('登录信息过长');
        await ensureKey();
        const nonce = (await cryptoFramework.createRandom().generateRandom(12)).data;
        if (nonce.length !== 12) throw new Error('系统未生成有效随机数');
        const ciphertext = await cipher(serviceId, selected, nonce, plaintext, false);
        const base64 = new util.Base64Helper();
        const record = new EncryptedCredential();
        record.scope = selected;
        record.nonce = base64.encodeToStringSync(nonce);
        record.ciphertext = base64.encodeToStringSync(ciphertext);
        const prefs = await preferences.getPreferences(context, { name: PREFERENCES_NAME });
        await prefs.put(serviceId, JSON.stringify(record));
        await prefs.flush();
      } catch (_) { throw new Error('无法安全保存登录信息；未改用明文存储'); }
      finally { plaintext.fill(0); value.secret = ''; value.username = ''; }
    });
    writes = operation.catch(() => {});
    await operation;
  }

  async remove(context: common.UIAbilityContext, serviceId: string, scope: string): Promise<void> {
    checkService(serviceId);
    credentialScope(scope);
    const operation = writes.then(async () => {
      try {
        const prefs = await preferences.getPreferences(context, { name: PREFERENCES_NAME });
        await prefs.delete(serviceId);
        await prefs.flush();
      } catch (_) { throw new Error('无法忘记登录信息，请重试'); }
    });
    writes = operation.catch(() => {});
    await operation;
  }
}
