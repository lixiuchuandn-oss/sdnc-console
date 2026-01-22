import { API_BASE_URL, apiRequest } from './api';

// 读取后端本地缓存的 VR 列表（无需登录）
export const fetchVrCachePageList = async (pageSize: number = 50, pageNum: number = 1) => {
  const url = `${API_BASE_URL}/api/vr-cache/pagelist?page_size=${pageSize}&page_num=${pageNum}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = await res.json();
  // 约定返回 { code: 200, data: { page: any[], total: number } }
  return json;
};

// 实时从 CSMCTL (通过后端) 获取 VR 列表
export const fetchVrRealtimeList = async (pageSize: number = 50, pageNum: number = 1) => {
  // apiRequest 默认带 token 认证，调用 /api/vr-config/pagelist
  const res = await apiRequest(`/api/vr-config/pagelist?page_size=${pageSize}&page_num=${pageNum}`);
  return res;
};

export const upsertVrCache = async (pageNum: number, pageSize: number, data: any) => {
  const url = `${API_BASE_URL}/api/vr-cache/upsert`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_num: pageNum, page_size: pageSize, data }),
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json;
};

// 规范化为 { uuid, name } 列表，兼容常见字段
export const normalizeVrRows = (rows: any[]): Array<{ uuid: string; name: string }> => {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((item: any) => ({
      uuid: item.uuid || item.vm_id || item.id || item.vmId || item.vm_uuid || '',
      name: item.name || item.vm_name || item.vmName || item.uuid || '未命名VR',
    }))
    .filter(v => v.uuid);
};
