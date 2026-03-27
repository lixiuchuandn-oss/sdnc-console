import { getSystemSetting } from '../config/systemSettings';
import type { User } from '../entities/User';

/** 管理员密码策略（存于 system-settings JSON 字符串） */
export type AdminPasswordPolicy = {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  /** 0 表示不强制过期 */
  maxPasswordAgeDays: number;
  /** 开启后，新建系统用户首次登录前须自行修改密码（passwordChangedAt 为空直至用户改密） */
  requirePasswordChangeOnFirstLogin: boolean;
};

const DEFAULT_POLICY: AdminPasswordPolicy = {
  minLength: 8,
  maxLength: 64,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecial: false,
  maxPasswordAgeDays: 0,
  requirePasswordChangeOnFirstLogin: false,
};

const SETTING_KEY = 'auth.admin_password_policy';

export function getDefaultAdminPasswordPolicy(): AdminPasswordPolicy {
  return { ...DEFAULT_POLICY };
}

export function parseAdminPasswordPolicy(raw?: string | null): AdminPasswordPolicy {
  const base = getDefaultAdminPasswordPolicy();
  if (!raw || !String(raw).trim()) return base;
  try {
    const j = JSON.parse(String(raw)) as Partial<AdminPasswordPolicy>;
    return {
      minLength: Math.max(1, Math.min(128, Number(j.minLength) || base.minLength)),
      maxLength: Math.max(1, Math.min(256, Number(j.maxLength) || base.maxLength)),
      requireUppercase: Boolean(j.requireUppercase),
      requireLowercase: Boolean(j.requireLowercase),
      requireDigit: Boolean(j.requireDigit),
      requireSpecial: Boolean(j.requireSpecial),
      maxPasswordAgeDays: Math.max(0, Math.min(3650, Number(j.maxPasswordAgeDays) || 0)),
      requirePasswordChangeOnFirstLogin: Boolean(j.requirePasswordChangeOnFirstLogin),
    };
  } catch {
    return base;
  }
}

export function getAdminPasswordPolicy(): AdminPasswordPolicy {
  return parseAdminPasswordPolicy(getSystemSetting(SETTING_KEY));
}

/** 对外展示（不含内部键名变更） */
export function getPublicAdminPasswordPolicy(): AdminPasswordPolicy {
  return getAdminPasswordPolicy();
}

function hasSpecialChar(s: string): boolean {
  return /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(s);
}

export function validatePasswordAgainstPolicy(
  password: string,
  policy: AdminPasswordPolicy,
  opts?: { username?: string },
): { ok: true } | { ok: false; message: string } {
  const p = String(password ?? '');
  if (p.length < policy.minLength) {
    return { ok: false, message: `密码长度不能少于 ${policy.minLength} 位` };
  }
  if (p.length > policy.maxLength) {
    return { ok: false, message: `密码长度不能超过 ${policy.maxLength} 位` };
  }
  if (policy.requireUppercase && !/[A-Z]/.test(p)) {
    return { ok: false, message: '密码需包含至少一个大写字母' };
  }
  if (policy.requireLowercase && !/[a-z]/.test(p)) {
    return { ok: false, message: '密码需包含至少一个小写字母' };
  }
  if (policy.requireDigit && !/[0-9]/.test(p)) {
    return { ok: false, message: '密码需包含至少一个数字' };
  }
  if (policy.requireSpecial && !hasSpecialChar(p)) {
    return { ok: false, message: '密码需包含至少一个特殊字符' };
  }
  const un = opts?.username?.trim();
  if (un && un.length >= 3 && p.toLowerCase().includes(un.toLowerCase())) {
    return { ok: false, message: '密码不能包含用户名' };
  }
  return { ok: true };
}

/** 用于有效期：无记录时用账号创建时间，避免存量用户立即过期 */
export function getAdminPasswordReferenceDate(user: User): Date {
  const d = user.passwordChangedAt ?? user.createdAt;
  return d instanceof Date ? d : new Date(d as unknown as string);
}

export function isAdminPasswordExpired(user: User, policy?: AdminPasswordPolicy): boolean {
  const pol = policy ?? getAdminPasswordPolicy();
  if (!pol.maxPasswordAgeDays || pol.maxPasswordAgeDays <= 0) return false;
  const ref = getAdminPasswordReferenceDate(user).getTime();
  const maxMs = pol.maxPasswordAgeDays * 24 * 60 * 60 * 1000;
  return Date.now() - ref > maxMs;
}

/** 管理员是否须先改密再使用（密码过期或策略要求首次登录改密且尚未自行改密） */
export function adminMustChangePassword(user: User, policy?: AdminPasswordPolicy): boolean {
  const pol = policy ?? getAdminPasswordPolicy();
  if (isAdminPasswordExpired(user, pol)) return true;
  if (pol.requirePasswordChangeOnFirstLogin && user.passwordChangedAt == null) {
    return true;
  }
  return false;
}
