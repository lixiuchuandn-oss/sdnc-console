import { getSystemSetting } from '../config/systemSettings';
import type { User } from '../entities/User';

/** 管理员密码策略（存于 system-settings JSON 字符串） */
export type AdminPasswordPolicy = {
  passwordComplexityEnabled: boolean;
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

const PASSWORD_COMPLEXITY_ON_MIN_LENGTH = 8;
const PASSWORD_COMPLEXITY_OFF_MIN_LENGTH = 1;
const PASSWORD_DEFAULT_MAX_LENGTH = 64;
const PASSWORD_COMPLEXITY_MIN_CHAR_TYPES = 3;

const DEFAULT_POLICY: AdminPasswordPolicy = {
  passwordComplexityEnabled: false,
  minLength: PASSWORD_COMPLEXITY_OFF_MIN_LENGTH,
  maxLength: PASSWORD_DEFAULT_MAX_LENGTH,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecial: false,
  maxPasswordAgeDays: 0,
  requirePasswordChangeOnFirstLogin: false,
};

const SETTING_KEY = 'auth.admin_password_policy';

function inferPasswordComplexityEnabled(j: Partial<AdminPasswordPolicy>): boolean {
  if (j.passwordComplexityEnabled !== undefined) {
    return Boolean(j.passwordComplexityEnabled);
  }
  return Boolean(j.requireUppercase || j.requireLowercase || j.requireDigit || j.requireSpecial);
}

function normalizePolicyFields(j: Partial<AdminPasswordPolicy>): AdminPasswordPolicy {
  const complexityOn = inferPasswordComplexityEnabled(j);
  const minLength = complexityOn
    ? PASSWORD_COMPLEXITY_ON_MIN_LENGTH
    : PASSWORD_COMPLEXITY_OFF_MIN_LENGTH;
  return {
    passwordComplexityEnabled: complexityOn,
    minLength,
    maxLength: Math.max(
      minLength,
      Math.min(256, Number(j.maxLength) || PASSWORD_DEFAULT_MAX_LENGTH),
    ),
    requireUppercase: false,
    requireLowercase: false,
    requireDigit: false,
    requireSpecial: false,
    maxPasswordAgeDays: Math.max(0, Math.min(3650, Number(j.maxPasswordAgeDays) || 0)),
    requirePasswordChangeOnFirstLogin: Boolean(j.requirePasswordChangeOnFirstLogin),
  };
}

export function getDefaultAdminPasswordPolicy(): AdminPasswordPolicy {
  return { ...DEFAULT_POLICY };
}

export function parseAdminPasswordPolicy(raw?: string | null): AdminPasswordPolicy {
  const base = getDefaultAdminPasswordPolicy();
  if (!raw || !String(raw).trim()) return base;
  try {
    const j = JSON.parse(String(raw)) as Partial<AdminPasswordPolicy>;
    return normalizePolicyFields(j);
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

function countPasswordCharTypes(password: string): number {
  const p = String(password ?? '');
  let n = 0;
  if (/[A-Z]/.test(p)) n += 1;
  if (/[a-z]/.test(p)) n += 1;
  if (/[0-9]/.test(p)) n += 1;
  if (hasSpecialChar(p)) n += 1;
  return n;
}

export function validatePasswordAgainstPolicy(
  password: string,
  policy: AdminPasswordPolicy,
  opts?: { username?: string },
): { ok: true } | { ok: false; message: string } {
  const p = String(password ?? '');
  const complexityOn = Boolean(policy.passwordComplexityEnabled);
  const minLen = complexityOn
    ? PASSWORD_COMPLEXITY_ON_MIN_LENGTH
    : PASSWORD_COMPLEXITY_OFF_MIN_LENGTH;

  if (p.length < minLen) {
    return {
      ok: false,
      message: minLen <= 1 ? '密码不能为空' : `密码长度不能少于 ${minLen} 位`,
    };
  }
  if (p.length > policy.maxLength) {
    return { ok: false, message: `密码长度不能超过 ${policy.maxLength} 位` };
  }

  if (complexityOn) {
    if (countPasswordCharTypes(p) < PASSWORD_COMPLEXITY_MIN_CHAR_TYPES) {
      return {
        ok: false,
        message: '密码须包含数字、大写字母、小写字母、特殊字符中的至少三项',
      };
    }
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
