import { apiRequest, apiPatch, apiUpload, API_BASE_URL } from './api';
import type { AdminPasswordPolicy } from '../utils/adminPasswordPolicy';

const API_BASE = '/api/system';
const API_THREATS = '/api/threats';

/** 未登录可读：后端 system-settings 中全部 ui.* 扁平 KV */
/** 未登录可读：管理员密码策略（与后端 auth.admin_password_policy 一致） */
export async function getPublicAdminPasswordPolicy(): Promise<AdminPasswordPolicy | null> {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/public/admin-password-policy`;
  const res = await fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const json = await res.json();
  const d = json?.data;
  if (!d || typeof d !== 'object') return null;
  return d as AdminPasswordPolicy;
}

export async function getPublicSystemUi(): Promise<Record<string, string> | null> {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/public/system-ui`;
  const res = await fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const json = await res.json();
  const d = json?.data;
  if (!d || typeof d !== 'object') return null;
  return d as Record<string, string>;
}

export async function uploadSecurityLogs(files: File[]): Promise<{ ok: boolean; count: number; files: { fileName: string }[] }> {
  const form = new FormData();
  files.forEach(f => form.append('files', f, f.name));
  return await apiUpload(`${API_BASE}/upload-security-logs`, form);
}

export async function listSecurityLogs(): Promise<{ logs: { fileName: string; sizeBytes: number; modifiedAt: number; ext: string }[] }> {
  return await apiRequest(`${API_BASE}/security-logs`);
}

export async function getSystemSetting(key: string): Promise<any> {
  const data = await apiRequest(`${API_BASE}/settings/${key}`);
  return data?.data || data;
}

export async function updateSystemSetting(key: string, value: string): Promise<{ key: string; value: string }> {
  const data = await apiPatch(`${API_BASE}/settings/${key}`, { value });
  return data?.data || data;
}

export type OfflineUpgradeStatusDto = {
  runtimeVersion: string;
  lastApplied: {
    at: string;
    manifestVersion?: string;
    appliedPublic: boolean;
    appliedServer: boolean;
  } | null;
};

export type OfflineUpgradeApplyResultDto = {
  manifestVersion?: string;
  appliedPublic: boolean;
  appliedServer: boolean;
  needsRestart: boolean;
  message: string;
};

export async function getOfflineUpgradeStatus(): Promise<OfflineUpgradeStatusDto> {
  const res = (await apiRequest(`${API_BASE}/offline-upgrade/status`)) as { data?: OfflineUpgradeStatusDto };
  if (res?.data) return res.data;
  return res as unknown as OfflineUpgradeStatusDto;
}

export async function applyOfflineUpgradeBundle(file: File): Promise<OfflineUpgradeApplyResultDto> {
  const form = new FormData();
  form.append('bundle', file);
  const res = (await apiUpload(`${API_BASE}/offline-upgrade/apply`, form)) as { data?: OfflineUpgradeApplyResultDto };
  if (res?.data) return res.data;
  return res as unknown as OfflineUpgradeApplyResultDto;
}

export async function importThreatEvents(file: File): Promise<{ ok: boolean; count: number; message: string }> {
  const form = new FormData();
  form.append('file', file);
  return await apiUpload(`${API_THREATS}/import-csv`, form);
}

export async function listThreatEvents(page = 1, pageSize = 10): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
  return await apiRequest(`${API_THREATS}?page=${page}&pageSize=${pageSize}`);
}
