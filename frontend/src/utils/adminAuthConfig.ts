/** 与后端 auth.admin_auth_config 一致 */
export type AdminAuthConfig = {
  /** 登录允许错误次数 */
  maxLoginAttempts: number;
  /** 错误统计周期（分钟） */
  loginFailureWindowMinutes: number;
  /** 登录失败锁定间隔（分钟） */
  loginLockDurationMinutes: number;
  /** 页面超时时间（分钟） */
  pageTimeoutMinutes: number;
};

export const DEFAULT_ADMIN_AUTH_CONFIG: AdminAuthConfig = {
  maxLoginAttempts: 5,
  loginFailureWindowMinutes: 5,
  loginLockDurationMinutes: 3,
  pageTimeoutMinutes: 60,
};

export function parseAdminAuthConfig(raw?: string | null): AdminAuthConfig {
  const base = { ...DEFAULT_ADMIN_AUTH_CONFIG };
  if (!raw || !String(raw).trim()) return base;
  try {
    const j = JSON.parse(String(raw)) as Partial<AdminAuthConfig>;
    return {
      maxLoginAttempts: Math.max(1, Math.min(100, Number(j.maxLoginAttempts) || base.maxLoginAttempts)),
      loginFailureWindowMinutes: Math.max(
        1,
        Math.min(1440, Number(j.loginFailureWindowMinutes) || base.loginFailureWindowMinutes),
      ),
      loginLockDurationMinutes: Math.max(
        1,
        Math.min(1440, Number(j.loginLockDurationMinutes) || base.loginLockDurationMinutes),
      ),
      pageTimeoutMinutes: Math.max(1, Math.min(1440, Number(j.pageTimeoutMinutes) || base.pageTimeoutMinutes)),
    };
  } catch {
    return base;
  }
}
