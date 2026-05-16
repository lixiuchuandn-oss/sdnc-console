/** 与后端 auth.admin_password_policy 一致 */
export type AdminPasswordPolicy = {
  /** 开启后：至少 8 位，且数字/大写/小写/特殊字符至少满足三项 */
  passwordComplexityEnabled: boolean;
  minLength: number;
  maxLength: number;
  /** 历史字段；新策略由 passwordComplexityEnabled 统一控制，保存时为 false */
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  maxPasswordAgeDays: number;
  /** 新建系统用户首次登录后须自行修改密码 */
  requirePasswordChangeOnFirstLogin: boolean;
};

export const PASSWORD_COMPLEXITY_ON_MIN_LENGTH = 8;
export const PASSWORD_COMPLEXITY_OFF_MIN_LENGTH = 1;
export const PASSWORD_DEFAULT_MAX_LENGTH = 64;
export const PASSWORD_COMPLEXITY_MIN_CHAR_TYPES = 3;

/** 策略未加载时的客户端校验回退（与后端默认一致：复杂度关闭、最少 1 位） */
export const DEFAULT_ADMIN_PASSWORD_POLICY: AdminPasswordPolicy = {
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

const SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

export function countPasswordCharTypes(password: string): number {
  const p = String(password ?? '');
  let n = 0;
  if (/[A-Z]/.test(p)) n += 1;
  if (/[a-z]/.test(p)) n += 1;
  if (/[0-9]/.test(p)) n += 1;
  if (SPECIAL_RE.test(p)) n += 1;
  return n;
}

export function isPasswordComplexityEnabled(policy: AdminPasswordPolicy): boolean {
  return Boolean(policy.passwordComplexityEnabled);
}

/** 从已存策略推断「启用密码复杂度」开关（兼容旧版按项勾选） */
export function inferPasswordComplexityEnabled(parsed: Partial<AdminPasswordPolicy>): boolean {
  if (parsed.passwordComplexityEnabled !== undefined) {
    return Boolean(parsed.passwordComplexityEnabled);
  }
  return Boolean(
    parsed.requireUppercase ||
      parsed.requireLowercase ||
      parsed.requireDigit ||
      parsed.requireSpecial,
  );
}

export function buildAdminPasswordPolicyPayload(input: {
  passwordComplexityEnabled: boolean;
  maxPasswordAgeDays: number;
  requirePasswordChangeOnFirstLogin: boolean;
}): AdminPasswordPolicy {
  const on = input.passwordComplexityEnabled;
  return {
    passwordComplexityEnabled: on,
    minLength: on ? PASSWORD_COMPLEXITY_ON_MIN_LENGTH : PASSWORD_COMPLEXITY_OFF_MIN_LENGTH,
    maxLength: PASSWORD_DEFAULT_MAX_LENGTH,
    requireUppercase: false,
    requireLowercase: false,
    requireDigit: false,
    requireSpecial: false,
    maxPasswordAgeDays: input.maxPasswordAgeDays,
    requirePasswordChangeOnFirstLogin: input.requirePasswordChangeOnFirstLogin,
  };
}

export function getPasswordComplexityHint(policy: AdminPasswordPolicy | null): string {
  if (!policy || !isPasswordComplexityEnabled(policy)) {
    return '密码长度至少 1 位';
  }
  return '密码至少 8 位，且须包含数字、大写字母、小写字母、特殊字符中的至少三项';
}

export function validateAdminPasswordClient(
  policy: AdminPasswordPolicy,
  password: string,
  username?: string,
): string | null {
  const p = String(password ?? '');
  const minLen = isPasswordComplexityEnabled(policy)
    ? PASSWORD_COMPLEXITY_ON_MIN_LENGTH
    : PASSWORD_COMPLEXITY_OFF_MIN_LENGTH;

  if (p.length < minLen) {
    return minLen <= 1 ? '密码不能为空' : `密码长度不能少于 ${minLen} 位`;
  }
  if (p.length > policy.maxLength) {
    return `密码长度不能超过 ${policy.maxLength} 位`;
  }

  if (isPasswordComplexityEnabled(policy)) {
    if (countPasswordCharTypes(p) < PASSWORD_COMPLEXITY_MIN_CHAR_TYPES) {
      return '密码须包含数字、大写字母、小写字母、特殊字符中的至少三项';
    }
  }

  const un = username?.trim();
  if (un && un.length >= 3 && p.toLowerCase().includes(un.toLowerCase())) {
    return '密码不能包含用户名';
  }
  return null;
}
