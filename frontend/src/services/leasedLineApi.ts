import axios from 'axios';
import type { CreateLeasedLineDto, BatchImportLeasedLineItem, TenantLeasedLine } from '../types/leasedLine';

const API_BASE = '/api/leased-lines';

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 1000): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || '');
      const code = String((e as any)?.code || '');
      if (i === retries || !(msg.includes('ECONNREFUSED') || code === 'ERR_NETWORK')) {
        break;
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function listLeasedLines(keyword?: string): Promise<TenantLeasedLine[]> {
  const token = localStorage.getItem('token');
  const res = await axios.get(API_BASE, {
    params: keyword ? { keyword } : undefined,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return res.data as TenantLeasedLine[];
}

export async function createLeasedLine(payload: CreateLeasedLineDto): Promise<TenantLeasedLine> {
  const token = localStorage.getItem('token');
  const res = await axios.post(API_BASE, payload, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
  return res.data as TenantLeasedLine;
}

export async function batchImportLeasedLines(items: BatchImportLeasedLineItem[]): Promise<{ created: number; items: TenantLeasedLine[] }> {
  const token = localStorage.getItem('token');
  const res = await axios.post(`${API_BASE}/batch`, { items }, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
  return res.data as any;
}

export async function generateSecurityReport(id: string): Promise<{ ok: boolean; filePath?: string; fileName?: string; message?: string }> {
  const token = localStorage.getItem('token');
  const res = await axios.post(`${API_BASE}/${encodeURIComponent(id)}/security-report`, {}, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    timeout: 300000,
  });
  return res.data as any;
}

export async function startSecurityReportTask(id: string): Promise<{ taskId: string }> {
  const token = localStorage.getItem('token');
  const res = await axios.post(`${API_BASE}/${encodeURIComponent(id)}/security-report/task`, {}, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  return res.data as any;
}

export async function getSecurityReportTask(taskId: string): Promise<{ task: any }> {
  const token = localStorage.getItem('token');
  const res = await axios.get(`${API_BASE}/security-report/tasks/${encodeURIComponent(taskId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 30000,
  });
  return res.data as any;
}

export async function cancelSecurityReportTask(taskId: string): Promise<{ ok: boolean }> {
  const token = localStorage.getItem('token');
  const res = await axios.delete(`${API_BASE}/security-report/tasks/${encodeURIComponent(taskId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 30000,
  });
  return res.data as any;
}

export async function removeSecurityReportTask(taskId: string): Promise<{ ok: boolean }> {
  const token = localStorage.getItem('token');
  const res = await axios.delete(`${API_BASE}/security-report/tasks/${encodeURIComponent(taskId)}/remove`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 30000,
  });
  return res.data as any;
}

export async function batchRemoveSecurityReportTasks(taskIds: string[]): Promise<{ deleted: number }> {
  const token = localStorage.getItem('token');
  const res = await axios.delete(`${API_BASE}/security-report/tasks/batch/remove`, {
    data: { ids: taskIds },
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  return res.data as any;
}

export async function listSecurityReportTasks(): Promise<{ tasks: any[] }> {
  const token = localStorage.getItem('token');
  const exec = async () => {
    const res = await axios.get(`${API_BASE}/security-report/tasks`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      timeout: 30000,
    });
    return res.data as any;
  };
  return withRetry(exec, 2, 1000);
}

export async function getSecurityReportTaskOutputs(taskId: string): Promise<{ outputs: any; raw?: any }> {
  const token = localStorage.getItem('token');
  const res = await axios.get(`${API_BASE}/security-report/tasks/${encodeURIComponent(taskId)}/outputs`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 30000,
  });
  return res.data as any;
}

export async function updateLeasedLine(id: string, partial: Partial<CreateLeasedLineDto>): Promise<TenantLeasedLine> {
  const token = localStorage.getItem('token');
  const res = await axios.patch(`${API_BASE}/${id}`, partial, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
  return res.data as TenantLeasedLine;
}

export async function deleteLeasedLine(id: string): Promise<void> {
  const token = localStorage.getItem('token');
  await axios.delete(`${API_BASE}/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

export async function batchDeleteLeasedLines(ids: string[]): Promise<{ deleted: number }> {
  const token = localStorage.getItem('token');
  const res = await axios.delete(`${API_BASE}/batch`, {
    data: { ids },
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
  return res.data as any;
}