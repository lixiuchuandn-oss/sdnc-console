/**
 * 管理端 `/admin` 入口：根路径常量；**登录后默认落地页唯一以** `GET /api/auth/admin-default-home`
 *（与后端 `resolveAdminDefaultHome`）为准。
 */
import { API_BASE_URL } from '../services/api';
import { getToken } from './tokenStorage';

export const ADMIN_HOME_BASE = '/admin' as const;

/** 与 `GET /api/auth/login` 的 `adminDefaultHome`、`GET /api/auth/admin-default-home` 响应体对齐 */
export type AdminDefaultHomePayload = {
  defaultPath: string;
  favoritePoolId?: string;
  licenseFeatures?: string[];
  steps?: unknown[];
};

/** 唯一首页顺位：向后端拉取（须已写入 token） */
export async function fetchAdminDefaultHomeFromApi(): Promise<AdminDefaultHomePayload> {
  const token = getToken();
  if (!token) {
    throw new Error('未登录');
  }
  const base = API_BASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/api/auth/admin-default-home`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<AdminDefaultHomePayload>;
}

export function isSystemAdminRole(role: string): boolean {
  const r = String(role || '').toLowerCase();
  return r === 'super_admin' || r === 'admin';
}
