import axios from 'axios';

const API_BASE = '/api/system';

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