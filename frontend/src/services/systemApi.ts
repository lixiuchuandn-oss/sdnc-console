import axios from 'axios';

const API_BASE = '/api/system';
const API_THREATS = '/api/threats';

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
  const token = localStorage.getItem('token');
  const res = await axios.get(`${API_BASE}/dify-config`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return res.data as any;
}

export async function updateDifyConfig(payload: DifyConfig): Promise<{ config: DifyConfig & { apiKey?: string } }> {
  const token = localStorage.getItem('token');
  const res = await axios.patch(`${API_BASE}/dify-config`, payload, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
  return res.data as any;
}

export async function uploadSecurityLogs(files: File[]): Promise<{ ok: boolean; count: number; files: { fileName: string }[] }> {
  const token = localStorage.getItem('token');
  const form = new FormData();
  files.forEach(f => form.append('files', f, f.name));
  const res = await axios.post(`${API_BASE}/upload-security-logs`, form, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 180000,
  });
  return res.data as any;
}

export async function listSecurityLogs(): Promise<{ logs: { fileName: string; sizeBytes: number; modifiedAt: number; ext: string }[] }> {
  const token = localStorage.getItem('token');
  const res = await axios.get(`${API_BASE}/security-logs`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 30000,
  });
  return res.data as any;
}

export async function getSystemSetting(key: string): Promise<any> {
  const token = localStorage.getItem('token');
  const res = await axios.get(`${API_BASE}/settings/${key}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return res.data?.data || res.data;
}

export async function updateSystemSetting(key: string, value: string): Promise<{ key: string; value: string }> {
  const token = localStorage.getItem('token');
  const res = await axios.patch(`${API_BASE}/settings/${key}`, { value }, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
  return res.data?.data || res.data;
}

export async function importThreatEvents(file: File): Promise<{ ok: boolean; count: number; message: string }> {
  const token = localStorage.getItem('token');
  const form = new FormData();
  form.append('file', file);
  const res = await axios.post(`${API_THREATS}/import-csv`, form, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 180000,
  });
  return res.data;
}

export async function listThreatEvents(page = 1, pageSize = 10): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
  const token = localStorage.getItem('token');
  const res = await axios.get(`${API_THREATS}`, {
    params: { page, pageSize },
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return res.data;
}
