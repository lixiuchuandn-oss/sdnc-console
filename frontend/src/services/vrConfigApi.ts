import { API_BASE_URL } from './api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

export const getVRConfig = async (uuid: string) => {
  // Use the cached endpoint to ensure we get data from DB
  const res = await fetch(`${API_BASE_URL}/api/vr-config/${uuid}/cached`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    // 404 返回空
    return null;
  }
  const json = await res.json();
  return json?.data ?? null;
};

export const getVRConfigCached = getVRConfig; // Alias for clarity

export const saveVRConfig = async (uuid: string, config: any, meta?: { cloudId?: string; cloudName?: string; vmId?: string }) => {
  const body: any = { uuid, config };
  if (meta) {
    if (meta.cloudId !== undefined) body.cloudId = meta.cloudId;
    if (meta.cloudName !== undefined) body.cloudName = meta.cloudName;
    if (meta.vmId !== undefined) body.vmId = meta.vmId;
  }
  const res = await fetch(`${API_BASE_URL}/api/vr-config/upsert`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

// 新增：设置VR角色（PE/CE）
export const setVRRole = async (uuid: string, role: 'PE' | 'CE' | '标准' | 'SASE') => {
  const res = await fetch(`${API_BASE_URL}/api/vr-config/set-role`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ uuid, role }),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

// 新增：批量获取VR角色映射
export const getVRRoles = async (uuids: string[]) => {
  const qs = uuids && uuids.length ? `?uuids=${encodeURIComponent(uuids.join(','))}` : '';
  const res = await fetch(`${API_BASE_URL}/api/vr-config/roles${qs}`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const json = await res.json();
  return (json?.data?.roles ?? {}) as Record<string, string>;
};