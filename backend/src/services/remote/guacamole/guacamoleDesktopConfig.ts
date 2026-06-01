import type { GuacamoleInstance } from '../../../entities/GuacamoleInstance';
import { decryptSecret } from '../../../utils/secretCipher';

export function resolveUnifiedDesktopPassword(instance: GuacamoleInstance): string {
  const enc = String(instance.desktopUserPasswordEncrypted || '').trim();
  if (!enc) {
    throw Object.assign(new Error('请先在云桌面网关设置中配置「云桌面用户统一密码」'), {
      status: 400,
    });
  }
  return decryptSecret(enc);
}

/** 规范化为 Guacamole 可接受的登录名 */
export function normalizeDesktopGuacamoleUsername(raw: string): string {
  const base = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'desktop-user';
}
