import { getSystemSetting } from '../config/systemSettings';

/** 管理员认证配置（存于 system-settings JSON 字符串） */
export type AdminAuthConfig = {
  maxLoginAttempts: number;
  loginFailureWindowMinutes: number;
  loginLockDurationMinutes: number;
  pageTimeoutMinutes: number;
};

const DEFAULT_CONFIG: AdminAuthConfig = {
  maxLoginAttempts: 5,
  loginFailureWindowMinutes: 5,
  loginLockDurationMinutes: 3,
  pageTimeoutMinutes: 60,
};

const SETTING_KEY = 'auth.admin_auth_config';

export function getDefaultAdminAuthConfig(): AdminAuthConfig {
  return { ...DEFAULT_CONFIG };
}

export function parseAdminAuthConfig(raw?: string | null): AdminAuthConfig {
  const base = getDefaultAdminAuthConfig();
  if (!raw || !String(raw).trim()) return base;
  try {
    const j = JSON.parse(String(raw)) as Partial<AdminAuthConfig>;
    return {
      maxLoginAttempts: Math.max(
        1,
        Math.min(100, Number(j.maxLoginAttempts) || base.maxLoginAttempts),
      ),
      loginFailureWindowMinutes: Math.max(
        1,
        Math.min(1440, Number(j.loginFailureWindowMinutes) || base.loginFailureWindowMinutes),
      ),
      loginLockDurationMinutes: Math.max(
        1,
        Math.min(1440, Number(j.loginLockDurationMinutes) || base.loginLockDurationMinutes),
      ),
      pageTimeoutMinutes: Math.max(
        1,
        Math.min(1440, Number(j.pageTimeoutMinutes) || base.pageTimeoutMinutes),
      ),
    };
  } catch {
    return base;
  }
}

export function getAdminAuthConfig(): AdminAuthConfig {
  return parseAdminAuthConfig(getSystemSetting(SETTING_KEY));
}

/** 未登录可读：页面空闲超时（分钟） */
export function getPublicPageTimeoutMinutes(): number {
  return getAdminAuthConfig().pageTimeoutMinutes;
}
