/** 与后端 auth.admin_password_policy 一致 */
export type AdminPasswordPolicy = {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  maxPasswordAgeDays: number;
  /** 新建系统用户首次登录后须自行修改密码 */
  requirePasswordChangeOnFirstLogin: boolean;
};

const SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

export function validateAdminPasswordClient(
  policy: AdminPasswordPolicy,
  password: string,
  username?: string,
): string | null {
  const p = String(password ?? '');
  if (p.length < policy.minLength) {
    return `密码长度不能少于 ${policy.minLength} 位`;
  }
  if (p.length > policy.maxLength) {
    return `密码长度不能超过 ${policy.maxLength} 位`;
  }
  if (policy.requireUppercase && !/[A-Z]/.test(p)) {
    return '密码需包含至少一个大写字母';
  }
  if (policy.requireLowercase && !/[a-z]/.test(p)) {
    return '密码需包含至少一个小写字母';
  }
  if (policy.requireDigit && !/[0-9]/.test(p)) {
    return '密码需包含至少一个数字';
  }
  if (policy.requireSpecial && !SPECIAL_RE.test(p)) {
    return '密码需包含至少一个特殊字符';
  }
  const un = username?.trim();
  if (un && un.length >= 3 && p.toLowerCase().includes(un.toLowerCase())) {
    return '密码不能包含用户名';
  }
  return null;
}
