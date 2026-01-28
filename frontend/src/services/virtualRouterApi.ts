import axios from 'axios';
import { API_BASE_URL, apiRequest, getAuthHeaders as getBaseAuthHeaders } from './api';

// ============================================================================
// Part 1: Lifecycle Management (Migrated from vrApi.ts)
// Direct access via /api-proxy with HMAC signature
// ============================================================================

// Debug logging
function logDebug(message: string) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[VR_DEBUG] ${message}`);
  }
}

function logError(message: string) {
  console.error(`[VR_DEBUG_ERROR] ${message}`);
}

// Proxy path for direct CSM access
const PROXY_BASE_URL = '/api-proxy';
const PROXY_PATH = '/api-proxy';

export interface AuthInfo {
  Authorization: string;
  tonce: number;
}

// Helper to get auth headers with signature
export const getAuthInfo = async (
  path: string = "/V2/ctcontrol/VR1/pagelist",
  method: string = "GET",
  other: string = "page_size=3&page_num=1",
  body?: any
): Promise<AuthInfo> => {
  logDebug('开始获取认证信息');
  
  try {
    const ACCESS_KEY = "Cloudmap%23123";
    const SECRET_KEY = "Cloudmap%23123";
    
    // 构建URL - 开发环境使用代理路径，生产环境使用直接URL
    // Note: In vrApi.ts logic, it seemed to rely on relative path /api-proxy
    const baseUrl = process.env.NODE_ENV === 'development' ? PROXY_PATH : PROXY_BASE_URL;
    
    let authUrl = `${baseUrl}/api/sign?` +
      `url=${encodeURIComponent(path)}&` +
      `method=${method}&` +
      `accessKey=${ACCESS_KEY}&` +
      `secretKey=${SECRET_KEY}`;
    
    if (other) {
      authUrl += `&other=${encodeURIComponent(other)}`;
    }
    
    // 发送POST请求，传递 body 以便后端计算 Body Hash
    const response = await axios.post(authUrl, body || '', {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.data || !response.data.data) {
      throw new Error('认证响应数据格式错误');
    }
    
    const authInfo = response.data.data;
    if (!authInfo.Authorization || !authInfo.tonce) {
      throw new Error('认证信息不完整');
    }
    
    return authInfo as AuthInfo;
  } catch (error: any) {
    logError(`❌ 获取认证信息失败: ${error.message}`);
    throw error;
  }
};

export const vrApiUtils = {
  testAuth: async () => {
    try {
      const authInfo = await getAuthInfo();
      return { success: true, authInfo };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

// Legacy vrApi object for backward compatibility
export const vrApi = {
  getVRInstances: async (pageSize: number = 3, pageNum: number = 1) => {
    try {
      const path = "/V2/ctcontrol/VR1/pagelist";
      const method = "GET";
      const other = `page_size=${pageSize}&page_num=${pageNum}`;
      const authInfo = await getAuthInfo(path, method, other);
      
      const baseUrl = process.env.NODE_ENV === 'development' ? PROXY_PATH : PROXY_BASE_URL;
      const apiUrl = `${baseUrl}/V2/ctcontrol/VR1/pagelist?page_size=${pageSize}&page_num=${pageNum}`;
      
      const response = await axios.get(apiUrl, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          },
        timeout: 20000
      });
      return response.data;
    } catch (error: any) {
      logError(`获取VR实例列表失败: ${error.message}`);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  },
  
  getVRInstance: async (vmId: string) => {
    try {
      const path = `/V2/ctcontrol/VR1/${vmId}`;
      const authInfo = await getAuthInfo(path, 'GET', '');
      const baseUrl = process.env.NODE_ENV === 'development' ? PROXY_PATH : PROXY_BASE_URL;
      const response = await axios.get(`${baseUrl}/V2/ctcontrol/VR1/${vmId}`, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          }
      });
      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  },
  
  createVRInstance: async (data: any) => {
    try {
      const path = `/V2/ctcontrol/VR1`;
      const authInfo = await getAuthInfo(path, 'POST', '', data);
      const baseUrl = process.env.NODE_ENV === 'development' ? PROXY_PATH : PROXY_BASE_URL;
      const response = await axios.post(`${baseUrl}/V2/ctcontrol/VR1`, data, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          }
      });
      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  },
  
  updateVRInstance: async (vmId: string, data: any) => {
    try {
      const path = `/V2/ctcontrol/VR1/${vmId}`;
      const authInfo = await getAuthInfo(path, 'PUT', '', data);
      const baseUrl = process.env.NODE_ENV === 'development' ? PROXY_PATH : PROXY_BASE_URL;
      const response = await axios.put(`${baseUrl}/V2/ctcontrol/VR1/${vmId}`, data, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          }
      });
      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  },
  
  deleteVRInstance: async (vmId: string) => {
    try {
      const path = `/V2/ctcontrol/VR1/${vmId}`;
      const authInfo = await getAuthInfo(path, 'DELETE', '');
      const baseUrl = process.env.NODE_ENV === 'development' ? PROXY_PATH : PROXY_BASE_URL;
      const response = await axios.delete(`${baseUrl}/V2/ctcontrol/VR1/${vmId}`, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          }
      });
      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  },

  getAll: async () => {
    try {
      const res = await vrApi.getVRInstances(1000, 1);
      const data = res?.data ?? res;
      const list = Array.isArray(data?.page) ? data.page : 
                   Array.isArray(data?.list) ? data.list : 
                   Array.isArray(data?.rows) ? data.rows :
                   Array.isArray(data) ? data : [];
      return list;
    } catch (e: any) {
      logError(`获取所有VR实例失败: ${e.message}`);
      return [];
    }
  }
};

// ============================================================================
// Part 2: Configuration Management (Migrated from vrConfigApi.ts & vr2Api.ts)
// Uses Backend API (Source of Truth)
// ============================================================================

export const getVRConfig = async (uuid: string) => {
  // Use the cached endpoint to ensure we get data from DB
  const res = await fetch(`${API_BASE_URL}/api/vr-config/${uuid}/cached`, {
    method: 'GET',
    headers: getBaseAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    return null;
  }
  const json = await res.json();
  return json?.data ?? null;
};

// Alias for clarity
export const getVRConfigCached = getVRConfig;

export const saveVRConfig = async (uuid: string, config: any, meta?: { cloudId?: string; cloudName?: string; vmId?: string }) => {
  const body: any = { uuid, config };
  if (meta) {
    if (meta.cloudId !== undefined) body.cloudId = meta.cloudId;
    if (meta.cloudName !== undefined) body.cloudName = meta.cloudName;
    if (meta.vmId !== undefined) body.vmId = meta.vmId;
  }
  const res = await fetch(`${API_BASE_URL}/api/vr-config/upsert`, {
    method: 'POST',
    headers: getBaseAuthHeaders(),
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const setVRRole = async (uuid: string, role: 'PE' | 'CE' | '标准' | 'SASE') => {
  const res = await fetch(`${API_BASE_URL}/api/vr-config/set-role`, {
    method: 'POST',
    headers: getBaseAuthHeaders(),
    body: JSON.stringify({ uuid, role }),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const getVRRoles = async (uuids: string[]) => {
  const qs = uuids && uuids.length ? `?uuids=${encodeURIComponent(uuids.join(','))}` : '';
  const res = await fetch(`${API_BASE_URL}/api/vr-config/roles${qs}`, {
    method: 'GET',
    headers: getBaseAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const json = await res.json();
  return (json?.data?.roles ?? {}) as Record<string, string>;
};

// Realtime Config (Expert Mode)
const fetchVR2 = async (uuid: string): Promise<any> => {
  if (!uuid) throw new Error('缺少UUID');
  
  const url = `${API_BASE_URL}/api/vr-config/${uuid}/realtime`;

  const res = await fetch(url, {
    method: 'GET',
    headers: getBaseAuthHeaders()
  });

  if (!res.ok) {
    const txt = await res.text();
    try {
        const json = JSON.parse(txt);
        throw new Error(json.msg || json.message || `VR配置查询失败: ${res.status}`);
    } catch (e) {
        if (e instanceof Error && e.message.startsWith('VR配置查询失败')) throw e;
        throw new Error(`VR配置查询失败: ${res.status} ${txt}`);
    }
  }

  const json = await res.json();
  return json.data;
};

export const getVR2Config = async (uuid: string): Promise<any> => {
  return await fetchVR2(uuid);
};

export const getVR2ConfigRaw = getVR2Config;

// ============================================================================
// Part 3: Discovery & Cache (Migrated from vrCacheApi.ts)
// ============================================================================

export const fetchVrCachePageList = async (pageSize: number = 50, pageNum: number = 1) => {
  const url = `${API_BASE_URL}/api/vr-cache/pagelist?page_size=${pageSize}&page_num=${pageNum}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: getBaseAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = await res.json();
  return json;
};

export const fetchVrRealtimeList = async (pageSize: number = 50, pageNum: number = 1) => {
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

export const normalizeVrRows = (rows: any[]): Array<{ uuid: string; name: string }> => {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((item: any) => ({
      uuid: item.uuid || item.vm_id || item.id || item.vmId || item.vm_uuid || '',
      name: item.name || item.vm_name || item.vmName || item.uuid || '未命名VR',
    }))
    .filter(v => v.uuid);
};

export default {
  // Lifecycle
  vrApi,
  getAuthInfo,
  
  // Config
  getVRConfig,
  getVRConfigCached,
  saveVRConfig,
  setVRRole,
  getVRRoles,
  getVR2Config,
  getVR2ConfigRaw,
  
  // Cache
  fetchVrCachePageList,
  fetchVrRealtimeList,
  upsertVrCache,
  normalizeVrRows
};
