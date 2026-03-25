import { apiRequest, apiPatch, apiUpload, API_BASE_URL } from './api';

const API_BASE = '/api/system';
const API_THREATS = '/api/threats';

/** 未登录可读：后端 system-settings 中全部 ui.* 扁平 KV */
export async function getPublicSystemUi(): Promise<Record<string, string> | null> {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/public/system-ui`;
  const res = await fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const json = await res.json();
  const d = json?.data;
  if (!d || typeof d !== 'object') return null;
  return d as Record<string, string>;
}

export type DifyConfig = {
  baseUrl?: string;
  apiKey?: string;
  workflowId?: string;
  logsDir?: string;
  reportsDir?: string;
  mode?: 'workflow' | 'chat';
  fileVarName?: string;
};

export async function getDifyConfig(): Promise<{ config: DifyConfig & { apiKey?: string } }> {
  return await apiRequest(`${API_BASE}/dify-config`);
}

export async function updateDifyConfig(payload: DifyConfig): Promise<{ config: DifyConfig & { apiKey?: string } }> {
  return await apiPatch(`${API_BASE}/dify-config`, payload);
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

export async function importThreatEvents(file: File): Promise<{ ok: boolean; count: number; message: string }> {
  const form = new FormData();
  form.append('file', file);
  return await apiUpload(`${API_THREATS}/import-csv`, form);
}

export async function listThreatEvents(page = 1, pageSize = 10): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
  return await apiRequest(`${API_THREATS}?page=${page}&pageSize=${pageSize}`);
}
