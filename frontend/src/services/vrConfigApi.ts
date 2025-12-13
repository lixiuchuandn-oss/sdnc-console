import { API_BASE_URL } from './api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

export const getVRConfig = async (uuid: string) => {
  const res = await fetch(`${API_BASE_URL}/api/vr-config/${uuid}`, {
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

export const saveVRConfig = async (uuid: string, config: any) => {
  const res = await fetch(`${API_BASE_URL}/api/vr-config/upsert`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ uuid, config }),
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

// ===== 版本管理 =====
export const listVRConfigVersions = async (uuid: string, role: 'PE' | 'CE' | '标准' | 'SASE') => {
  const qs = `?uuid=${encodeURIComponent(uuid)}&role=${encodeURIComponent(role)}`;
  const res = await fetch(`${API_BASE_URL}/api/vr-config/version/list${qs}`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const json = await res.json();
  return (json?.versions ?? []) as Array<{ id: number; uuid: string; role: string; config_json: string; created_at: string }>;
};

export const saveVRConfigVersion = async (uuid: string, role: 'PE' | 'CE' | '标准' | 'SASE', config: any) => {
  const res = await fetch(`${API_BASE_URL}/api/vr-config/version/save`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ uuid, role, config_json: JSON.stringify(config) }),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const getVRConfigVersion = async (id: number) => {
  const res = await fetch(`${API_BASE_URL}/api/vr-config/version/get/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const json = await res.json();
  return json?.version ?? null;
};