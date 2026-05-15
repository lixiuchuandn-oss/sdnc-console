// API服务函数
// 远端访问时，如果 .env 指向 localhost，会导致请求打到访问者本机而非服务器。
// 当页面不在 localhost 但 REACT_APP_API_URL 仍指向 localhost 时，改为当前页的 origin（同源）。
//
// HTTPS + Nginx 反代时：页面为 https://host/ ，API 必须是同源 https://host/api/... ，不能写成 https://host:5001
//（5001 仅在服务器本机监听，且常为 HTTP；浏览器直连会失败或混合内容被拦）。

// 导入请求管理器（提供去重、缓存、重试功能）
import { requestManager } from '../utils/requestManager';
// 导入统一的 token 存储工具
import { getToken } from '../utils/tokenStorage';

const defaultApiBase = (() => {
  const envUrl = process.env.REACT_APP_API_URL;
  if (envUrl) {
    if (typeof window !== 'undefined') {
      const isPageLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const envIsLocalhost = /localhost|127\.0\.0\.1/.test(envUrl);
      if (!isPageLocalhost && envIsLocalhost) {
        // 避免浏览器去连「用户本机」的 127.0.0.1；但不能用 location.origin（会把 API/WS 留在 :5000）。
        const { protocol, hostname, port } = window.location;
        const isLocalDevPort = port === '3000' || port === '5000' || port === '5173';
        if (isLocalDevPort) {
          return `${protocol}//${hostname}:5001`;
        }
        return window.location.origin;
      }
    }
    return envUrl;
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    const isLocalDevPort = port === '3000' || port === '5000' || port === '5173';
    // 开发态：CRA/Vite 常见端口上，无论 localhost 还是局域网 IP（如 10.x），API 与 WS 都指向同主机 5001。
    // 否则用页面 origin 会导致 ws 打到 :5000，而 kv-vnc 只在后端监听，出现「closed before established」。
    if (isLocalDevPort) {
      return `${protocol}//${hostname}:5001`;
    }
    return window.location.origin;
  }
  return 'http://localhost:5001';
})();

export const API_BASE_URL = defaultApiBase;

// 获取认证token
export const getAuthHeaders = () => {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

const uuidToObjectIdHex = (uuidStr: string): string => {
  const s = String(uuidStr || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) {
    throw new Error('uuid 格式非法');
  }
  const hex = s.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (!(bytes[6] === 0x40 && bytes[7] === 0x00 && bytes[8] === 0x80 && bytes[9] === 0x00)) {
    throw new Error('UUID 不是由 ObjectId 生成的');
  }
  const obj = new Uint8Array(12);
  obj.set(bytes.slice(0, 6), 0);
  obj.set(bytes.slice(10, 16), 6);
  let out = '';
  for (let i = 0; i < 12; i++) out += obj[i].toString(16).padStart(2, '0');
  return out;
};

// Helper: Parse error response
const parseErrorResponse = async (response: Response) => {
    let errorMsg = `HTTP error! status: ${response.status}`;
    try {
        const data = await response.json();
        if (data && typeof data === 'object') {
             // 1. Prefer 'message' field
             if (data.message) {
                 errorMsg = data.message;
                 // Append 'error' detail if exists
                 if (data.error) {
                     const detail = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
                     // Avoid duplication
                     if (!errorMsg.includes(detail)) {
                        errorMsg += `: ${detail}`;
                     }
                 }
             } 
             // 2. Fallback to 'error' field
             else if (data.error) {
                 errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
             }
        }
    } catch (e) {
        // ignore JSON parse error
    }
    const err: any = new Error(errorMsg);
    err.status = response.status;
    err.response = response;
    throw err;
};

/** GET 请求选项：默认不启用内存缓存（控制台资源以新鲜为准）；少数慢变接口可 enableCache: true */
export type ApiGetOptions = {
  skipCache?: boolean;
  silent?: boolean;
  enableCache?: boolean;
  cacheTTL?: number;
};

// 通用请求函数（去重、重试；GET 默认不缓存，按需 opt-in）
export const apiRequest = async (endpoint: string, options?: ApiGetOptions) => {
  try {
    return await requestManager(
      {
        method: 'GET',
        endpoint,
        headers: getAuthHeaders(),
        options: {
          enableDeduplication: true,
          enableCache: options?.enableCache ?? false,
          enableRetry: true,
          skipCache: options?.skipCache || false,
          ...(typeof options?.cacheTTL === 'number' ? { cacheTTL: options.cacheTTL } : {}),
        },
      },
      API_BASE_URL
    );
  } catch (error: any) {
    // 如果是预期的 404 错误且设置了 silent，不记录到控制台
    // 这对于诊断功能很重要，因为 Pod 不存在、PVC 不存在是预期的情况
    const is404 = error?.status === 404 || 
                  error?.message?.includes('404') || 
                  error?.message?.includes('Not Found') ||
                  error?.message?.includes('未找到');
    if (!is404 || !options?.silent) {
      console.error(`API请求失败 ${endpoint}:`, error);
    }
    throw error;
  }
};

// 通用 POST 请求（默认带重试，不缓存，不去重）
// 注意：创建操作禁用去重，确保每次点击都能真正创建
export const apiPost = async (
  endpoint: string,
  body: any = {},
  options?: {
    enableRetry?: boolean;
    retryCount?: number;
    retryDelay?: number;
  }
) => {
  try {
    return await requestManager(
      {
        method: 'POST',
        endpoint,
        body,
        headers: getAuthHeaders(),
        options: {
          enableDeduplication: false, // 创建操作不去重，允许重复创建
          enableCache: false, // POST 请求不缓存
          enableRetry: options?.enableRetry ?? true, // 默认保留重试功能
          retryCount: options?.retryCount,
          retryDelay: options?.retryDelay,
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用 DELETE 请求（带重试，不缓存，不去重）
// 注意：删除操作禁用去重，确保每次删除都能真正执行
// body: 可选的请求体（某些 DELETE 请求需要 body，如删除安全组规则）
export const apiDelete = async (endpoint: string, body?: any) => {
  try {
    return await requestManager(
      {
        method: 'DELETE',
        endpoint,
        body,
        headers: getAuthHeaders(),
        options: {
          enableDeduplication: false, // 删除操作不去重，允许重复删除
          enableCache: false, // DELETE 请求不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用 PUT 请求（带重试，不缓存，不去重）
// 注意：更新操作禁用去重，确保每次更新都能真正执行
export const apiPut = async (endpoint: string, body: any = {}) => {
  try {
    return await requestManager(
      {
        method: 'PUT',
        endpoint,
        body,
        headers: getAuthHeaders(),
        options: {
          enableDeduplication: false, // 更新操作不去重，允许重复更新
          enableCache: false, // PUT 请求不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用文件上传请求（支持 FormData，带重试，不缓存，不去重）
// 注意：文件上传操作禁用去重，确保每次上传都能真正执行
export const apiUpload = async (endpoint: string, formData: FormData, options?: { timeout?: number }) => {
  try {
    return await requestManager(
      {
        method: 'POST',
        endpoint,
        body: formData,
        headers: getAuthHeaders(),
        options: {
          enableDeduplication: false, // 文件上传不去重
          enableCache: false, // 文件上传不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`文件上传失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用 PATCH 请求（带重试，不缓存，不去重）
// 注意：更新操作禁用去重，确保每次更新都能真正执行
export const apiPatch = async (endpoint: string, body: any = {}, options?: { contentType?: string }) => {
  try {
    const headers = { ...getAuthHeaders() };
    // 如果指定了自定义 Content-Type，使用它（例如 application/merge-patch+json）
    if (options?.contentType) {
      headers['Content-Type'] = options.contentType;
    }
    return await requestManager(
      {
        method: 'PATCH',
        endpoint,
        body,
        headers,
        options: {
          enableDeduplication: false, // 更新操作不去重，允许重复更新
          enableCache: false, // PATCH 请求不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 获取云资源池数据
export const fetchClouds = async () => {
  return await apiRequest('/api/clouds');
};

// 获取单个云资源池详情
export const fetchCloudById = async (id: string, options?: { skipCache?: boolean }) => {
  return await apiRequest(`/api/clouds/${id}`, { skipCache: options?.skipCache || false });
};

export type RancherClusterListItem = {
  id: string;
  name: string;
  state: string;
  kubernetesVersion?: string;
};

/** Rancher 资源池下游集群列表（Norman /v3/clusters） */
export const fetchRancherClustersForPool = async (
  poolId: string,
  options?: { skipCache?: boolean },
): Promise<RancherClusterListItem[]> => {
  const json = await apiRequest(`/api/clouds/${encodeURIComponent(poolId)}/rancher/clusters`, {
    skipCache: options?.skipCache ?? true,
  });
  const data = json?.data;
  return Array.isArray(data) ? data : [];
};



// 获取用户数据（不启用 GET 内存缓存，避免与设置页等写操作后列表不同步）
export const fetchUsers = async () => {
  return await apiRequest('/api/users');
};

// 获取租户数据（不启用 GET 内存缓存，避免多入口写租户后其它页仍见旧列表）
export const fetchTenants = async () => {
  return await apiRequest('/api/tenants');
};

export const fetchAvailableResourcePools = async () => {
  return await apiRequest('/api/tenants/available-resource-pools');
};

// User Spaces
export const fetchUserSpaces = async () => {
  return await apiRequest('/api/user-spaces');
};

export const createUserSpace = async (payload: any) => {
  return await apiPost('/api/user-spaces', payload);
};

export const deleteUserSpace = async (id: string) => {
  return await apiDelete(`/api/user-spaces/${id}`);
};

// Organizations of tenant
export const fetchOrganizationsByTenant = async (tenantId: string) => {
  return await apiRequest(`/api/tenants/${tenantId}/organizations`);
};

export const fetchOrganizationResourcePools = async (organizationId: string) => {
  return await apiRequest(`/api/tenants/organizations/${organizationId}/resource-pools`);
};

export const fetchCloudQuotas = async (cloudId:string)=>{
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/quotas`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }

  return await res.json();
};

export const createUserSpaceV2 = async (payload:any)=>{
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/user-spaces`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':token?`Bearer ${token}`:''},
    body: JSON.stringify(payload),
    credentials:'include'
  });
  if(!res.ok){ throw new Error(await res.text()); }
  return await res.json();
};

// 云资源池：查询云端 VPC（当前支持阿里云）
export const fetchCloudProviderVpcs = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vpcs`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

// 云资源池：创建云端 VPC（当前支持阿里云）
export const createCloudProviderVpc = async (cloudId: string, payload: { VpcName?: string; CidrBlock: string; Description?: string; EnableIpv6?: boolean; Ipv6CidrBlock?: string }) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vpcs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({
      ...payload,
      vpc: {
        cidr: payload.CidrBlock,
        name: payload.VpcName,
        description: payload.Description,
      }
    }),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

// 云资源池：删除云端 VPC（当前支持阿里云）
export const deleteCloudProviderVpc = async (cloudId: string, vpcId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(vpcId)}`);
};

// 云资源池：修改云端 VPC（当前支持阿里云）
export const updateCloudProviderVpc = async (cloudId: string, vpcId: string, payload: { VpcName?: string; Description?: string }) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(vpcId)}`, payload);
};



export const fetchSaseDiscoveredAssets = async (params?: any) => {
  const q = new URLSearchParams();
  if (params?.cloudId) q.append('cloud_id', params.cloudId);
  if (params?.domainId) q.append('domain_id', params.domainId);
  return apiRequest(`/api/sase/gateways/assets?${q.toString()}`);
};

export const fetchCloudVpcs = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vpcs`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const fetchCloudProviderEcs = async (
  cloudId: string,
  force: boolean = false,
  mergePublicScenarioNamespaces?: boolean,
) => {
  const token = getToken();
  const params = new URLSearchParams();
  if (force) params.set('force', 'true');
  if (mergePublicScenarioNamespaces !== undefined) {
    params.set('mergePublicScenarioNamespaces', mergePublicScenarioNamespaces ? 'true' : 'false');
  }
  const q = params.toString();
  const qs = q ? `?${q}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs${qs}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

// 云资源池：ECS 管理操作（启动/停止/重启/删除）
export const startCloudProviderEcs = async (cloudId: string, instanceId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const stopCloudProviderEcs = async (cloudId: string, instanceId: string, force: boolean = false) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({ force }),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const rebootCloudProviderEcs = async (cloudId: string, instanceId: string, force: boolean = false) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/reboot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({ force }),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const softRebootCloudProviderEcs = async (cloudId: string, instanceId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/softreboot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const pauseCloudProviderEcs = async (cloudId: string, instanceId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/pause`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const unpauseCloudProviderEcs = async (cloudId: string, instanceId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/unpause`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const fetchCloudProviderEcsVncUrl = async (cloudId: string, instanceId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/vnc-url`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};






export const fetchCloudProviderEips = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/eips`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const fetchCloudProviderLoadBalancers = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/loadbalancers`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const fetchCloudProviderNatGateways = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/nat-gateways`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const fetchCloudProviderRouteTables = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const fetchCloudProviderRouteEntries = async (cloudId: string, routeTableId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-entries?routeTableId=${encodeURIComponent(routeTableId)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const addCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, route: { type: string; destination: string; nexthop: string; description?: string }) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-entries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ routeTableId, route }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, oldRoute: { destination: string; nexthop: string }, newRoute: { type: string; destination: string; nexthop: string; description?: string }) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-entries`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ routeTableId, oldRoute, newRoute }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const modCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, route: { type: string; destination: string; nexthop: string; description?: string }) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-entries`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ routeTableId, route }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, route: { destination: string; nexthop: string }) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-entries`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ routeTableId, route }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createCloudProviderRouteTable = async (
  cloudId: string,
  payload: { vpcId: string; name?: string; description?: string; routes?: Array<{ type: string; destination: string; nexthop: string; description?: string }> }
) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateCloudProviderRouteTable = async (
  cloudId: string,
  routeTableId: string,
  payload: { name?: string; description?: string; routes?: Array<{ type: string; destination: string; nexthop: string; description?: string }> }
) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const associateCloudProviderRouteTable = async (cloudId: string, routeTableId: string, subnetIds: string[]) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}/associate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ subnetIds }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const disassociateCloudProviderRouteTable = async (cloudId: string, routeTableId: string, subnetIds: string[]) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}/disassociate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ subnetIds }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteCloudProviderRouteTable = async (cloudId: string, routeTableId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchCloudProviderNetworkAcls = async (cloudId: string, params?: { vpcId?: string }) => {
  const qs = params?.vpcId ? `?vpcId=${encodeURIComponent(params.vpcId)}` : '';
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/network-acls${qs}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const createCloudProviderNetworkAcl = async (
  cloudId: string,
  payload: { vpcId: string; name: string; description?: string }
) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/network-acls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const updateCloudProviderNetworkAcl = async (
  cloudId: string,
  aclId: string,
  payload: { name?: string; description?: string }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/network-acls/${encodeURIComponent(aclId)}`, payload);
};

export const deleteCloudProviderNetworkAcl = async (cloudId: string, aclId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/network-acls/${encodeURIComponent(aclId)}`);
};

export const deleteCloudProviderEcs = async (cloudId: string, instanceId: string, deleteVolumes?: boolean) => {
  let url = `/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}`;
  const params = new URLSearchParams();
  if (deleteVolumes !== undefined) params.append('deleteVolumes', String(deleteVolumes));
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return await apiDelete(url);
};

export const fetchCloudProviderEnis = async (cloudId: string, params?: { vpcId?: string }) => {
  const token = getToken();
  const qs: string[] = [];
  if (params?.vpcId) qs.push(`vpcId=${encodeURIComponent(params.vpcId)}`);
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/enis${qs.length ? ('?' + qs.join('&')) : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};




export const fetchCsmVirtualElements = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/security/virtual-elements`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};
export const fetchCloudmapVirtualElements = fetchCsmVirtualElements;

// CSM：物理安全网元
export const fetchCsmPhysicalElements = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/security/physical-elements`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};
export const fetchCloudmapPhysicalElements = fetchCsmPhysicalElements;

// CSM：安全网元组
export const fetchCsmElementGroups = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/security/element-groups`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCloudmapElementGroups = fetchCsmElementGroups;

export const fetchCsmServiceChains = async (cloudId: string, params?: { pool_id?: string }) => {
  const token = getToken();
  const qs = params?.pool_id ? `?pool_id=${encodeURIComponent(params.pool_id)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/security/service-chains${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCsmVRouters = async (cloudId: string, params?: { pool_id?: string }) => {
  const token = getToken();
  const qs = params?.pool_id ? `?pool_id=${encodeURIComponent(params.pool_id)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/vrouters${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCsmVRPageList = async (cloudId: string, params?: any) => {
  const token = getToken();
  const search = new URLSearchParams();
  if (params) {
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        search.append(key, String(params[key]));
      }
    });
  }
  // Prevent caching
  search.append('_t', String(Date.now()));
  const qs = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/vr-pagelist${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchTenantVRs = async (params: { tenantId?: string; organizationId?: string } = {}) => {
  const token = getToken();
  const search = new URLSearchParams();
  if (params.tenantId) search.set('tenantId', params.tenantId);
  if (params.organizationId) search.set('organizationId', params.organizationId);
  const qs = search.toString() ? `?${search.toString()}` : '';
  // 改为调用通用的 VR 配置接口
  const res = await fetch(`${API_BASE_URL}/api/vr-config/list${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};
// 兼容旧名称，逐步废弃
export const fetchSaseGateways = fetchTenantVRs;

export const bindTenantVR = async (payload: { vm_id?: string; vr_uuid: string; tenant_id: string; org_id?: string; device_fingerprint?: string; display_name?: string; vr_type?: string }) => {
  const token = getToken();
  // 改为调用通用的 VR 绑定接口
  const res = await fetch(`${API_BASE_URL}/api/vr-config/bind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(String(json?.message || json?.error || text));
    } catch {
      throw new Error(text);
    }
  }
  return await res.json();
};
// 兼容旧名称，逐步废弃
export const bindSaseGateway = bindTenantVR;

export const detectCsmPoolId = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/pool-id`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCsmPoolId = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/pool-id`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCsmAssets = async (cloudId: string, params: any = {}) => {
  const token = getToken();
  const query = new URLSearchParams();
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined && params[key] !== null) {
      query.append(key, String(params[key]));
    }
  });
  const qs = query.toString() ? `?${query.toString()}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/assets${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createCsmAsset = async (cloudId: string, payload: any, params?: { pool_id?: string }) => {
  const token = getToken();
  const qs = params?.pool_id ? `?pool_id=${encodeURIComponent(params.pool_id)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/assets${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json === 'string' ? json : (json?.error || json?.message || '请求失败'));
  }
  const code = Number((json as any)?.data?.code ?? 0);
  const msg = String((json as any)?.data?.msg ?? '');
  if (Number.isFinite(code) && code >= 400) {
    throw new Error(msg || 'CSM 资产创建失败');
  }
  return json;
};

export const deleteCsmAsset = async (cloudId: string, assetId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/assets/${assetId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteCsmServiceChain = async (cloudId: string, chainId: string, params?: { pool_id?: string }) => {
  const token = getToken();
  const qs = params?.pool_id ? `?pool_id=${encodeURIComponent(params.pool_id)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/security/service-chains/${encodeURIComponent(chainId)}${qs}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const createCsmServiceChain = async (cloudId: string, payload: any, params?: { pool_id?: string }) => {
  const token = getToken();
  const qs = params?.pool_id ? `?pool_id=${encodeURIComponent(params.pool_id)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/security/service-chains${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json === 'string' ? json : (json?.error || json?.message || '请求失败'));
  }
  const code = Number((json as any)?.data?.code ?? 0);
  const msg = String((json as any)?.data?.msg ?? '');
  if (Number.isFinite(code) && code >= 400) {
    throw new Error(msg || 'CSM 服务链创建失败');
  }
  return json;
};

export const createCsmServiceChainRaw = async (cloudId: string, payload: any, params?: { pool_id?: string }) => {
  const token = getToken();
  const search = new URLSearchParams();
  if (params?.pool_id) search.set('pool_id', String(params.pool_id));
  search.set('raw', '1');
  const qs = `?${search.toString()}`;
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/security/service-chains${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, body };
};


// 华为云：子网（与阿里云 vswitches 对应）
export const fetchCloudProviderSubnets = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

// 统一子网查询（支持按 VPC 过滤）：阿里云兼容 vswitches，华为云为 subnets
export const fetchCloudProviderSubnetsByVpc = async (cloudId: string, vpcId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets?vpcId=${encodeURIComponent(vpcId)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};


// 华为云：创建子网
export const createHuaweiCloudSubnet = async (
  cloudId: string,
  payload: { vpc_id: string; cidr: string; ipv6_cidr?: string; name?: string; description?: string; gateway_ip?: string; dhcp_enable?: boolean; primary_dns?: string; secondary_dns?: string; dnsList?: string[]; availability_zone?: string }
) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ subnet: payload }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

// 华为云：更新子网
export const updateHuaweiCloudSubnet = async (
  cloudId: string,
  subnetId: string,
  payload: { name?: string; description?: string; dhcp_enable?: boolean; primary_dns?: string; secondary_dns?: string; dnsList?: string[] }
) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(subnetId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ subnet: payload }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

// 华为云：删除子网
export const deleteCloudProviderSubnet = async (cloudId: string, subnetId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(subnetId)}`);
};

export const fetchCloudProviderSecurityGroups = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const fetchCloudProviderSecurityGroupDetail = async (cloudId: string, sgId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};





// 全部资源池云主机聚合
export const fetchAllInstances = async () => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/inventory/instances`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

// 根据云ID获取聚合库存（不刷新，仅筛选）
export const fetchInventoryInstancesByCloud = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/inventory/instances?cloudId=${encodeURIComponent(cloudId)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

// 刷新库存（支持按云ID定向刷新）
export const refreshInventoryInstances = async (cloudId?: string) => {
  const token = getToken();
  const qs = cloudId ? `&cloudId=${encodeURIComponent(cloudId)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/inventory/instances?refresh=true${qs}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

// 慢速全局库存刷新（不传 cloudId，串行且慢速）
export const refreshInventoryInstancesSlow = async () => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/inventory/instances?refresh=true&slow=true`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};



export const fetchCloudProviderDisks = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/disks`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};

export const fetchCloudProviderSnapshots = async (cloudId: string) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/snapshots`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return await res.json();
};


// ===== 云企业网 (CEN) =====
export const fetchCens = async () => {
  return await apiRequest('/api/cens');
};

export const createCen = async (payload: { name: string; description?: string; tenantId: string; strategy?: string }) => {
  return await apiPost('/api/cens', payload);
};

export const updateCen = async (id: string, payload: { name?: string; description?: string; strategy?: string; topology?: string; hubId?: string }) => {
  return await apiPatch(`/api/cens/${id}`, payload);
};

export const deleteCen = async (id: string) => {
  return await apiDelete(`/api/cens/${id}`);
};

export const forceDeleteCen = async (id: string) => {
  return await apiDelete(`/api/cens/${id}?force=1`);
};

export const attachVpcToCen = async (cenId: string, vpcId?: string, securityDomainId?: string) => {
  return await apiPost(`/api/cens/${cenId}/attachments`, { vpcId, securityDomainId });
};

export const fetchCenAttachments = async (cenId: string) => {
  return await apiRequest(`/api/cens/${cenId}/attachments`);
};

export const detachVpcFromCen = async (cenId:string, attachmentId:string)=> {
  return await apiDelete(`/api/cens/${cenId}/attachments/${attachmentId}`);
}; 

 

export const fetchDashboardStats = async () => {
  return await apiRequest('/api/dashboard/stats', { enableCache: true });
}; 

export const fetchDashboardRecentActivities = async () => {
  return await apiRequest('/api/dashboard/recent-activities', { enableCache: true });
}; 

export const fetchDashboardCloudUsage = async () => {
  return await apiRequest('/api/dashboard/cloud-usage', { enableCache: true });
};

// ===== SRv6 隧道 =====
export const fetchSrv6Tunnels = async (options?: { skipCache?: boolean }) => {
  return await apiRequest('/api/networks/srv6', { skipCache: options?.skipCache });
};

// Harvester Extended Resources
// Moved to harvesterApi.ts



export const createSrv6Tunnel = async (payload: { name: string; peA: string; peB: string; ceA: string; ceB: string }) => {
  return await apiPost('/api/networks/srv6', payload);
};

/** 将平台库中该 VR 的 config_json 推送到 CSMctl（与 IPsec deploy/push 一致，走服务端签名） */
export const pushSrv6VrConfigToCsm = async (vrId: string) => {
  return await apiPost('/api/networks/srv6/deploy/push', { vrId });
};

export const fetchSrv6Tunnel = async (id: string) => {
  return await apiRequest(`/api/networks/srv6/${id}`);
};

export const deleteSrv6Tunnel = async (id: string) => {
  return await apiDelete(`/api/networks/srv6/${id}`);
};

// ===== IPsec VPN =====
export const fetchIPsecVPNs = async () => {
  return await apiRequest('/api/networks/ipsec');
};

export const fetchIPsecVPNsMerged = async (params?: { vrId?: string; skipCache?: boolean }) => {
  const qs: string[] = ['includeDevice=1'];
  if (params?.vrId) qs.push(`vrId=${encodeURIComponent(params.vrId)}`);
  const url = `/api/networks/ipsec${qs.length ? ('?' + qs.join('&')) : ''}`;
  return await apiRequest(url, { skipCache: params?.skipCache });
};

export const createIPsecVPN = async (payload: any) => {
  return await apiPost('/api/networks/ipsec', payload);
};

export const deleteIPsecVPN = async (id: string) => {
  return await apiDelete(`/api/networks/ipsec/${id}`);
};

// ===== 服务目录（Service Catalog）=====
/** 列表会随注册/编辑/删除变化，不使用内存缓存，避免创建后刷新仍看到旧数据 */
export const fetchServices = async () => {
  return await apiRequest('/api/services', { enableCache: false });
};

export const createService = async (payload: any) => {
  return await apiPost('/api/services', payload);
};

export const updateService = async (id: string, payload: any) => {
  return await apiPatch(`/api/services/${id}`, payload);
};

export const deleteService = async (id: string) => {
  return await apiDelete(`/api/services/${id}`);
};

// CSM 虚拟安全网元操作
export const operateCsmVm = async (cloudId: string, vmId: string, action: 'start' | 'stop' | 'reboot') => {
  return await apiPost(`/api/clouds/${cloudId}/csm/security/virtual-elements/${encodeURIComponent(vmId)}/action`, { action });
};

export const getCsmVmConsole = async (cloudId: string, vmId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/csm/security/virtual-elements/${encodeURIComponent(vmId)}/console`);
};

export const csmSsoLogin = async (cloudId: string, vmId: string, currentLoginWebPort?: string) => {
  const webId = uuidToObjectIdHex(vmId);
  const port = String(currentLoginWebPort || '8011');
  return await apiPost(`/api/clouds/${cloudId}/csm/security/domain/attach/callOnSSO`, {
    id: webId,
    currentLoginWebPort: port,
  });
};

// ============================================================================
// 代理 API 服务函数（用于 CSM CTL 通信）
// ============================================================================

/**
 * 获取 CSM CTL 签名信息
 * @param path CSM CTL API 路径
 * @param method HTTP 方法
 * @param other 其他查询参数
 * @param bodyRaw 请求体（字符串）
 * @returns 包含 Authorization 和 tonce 的认证信息
 */
export const getProxyAuthInfo = async (
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  other: string = '',
  bodyRaw: string = '',
  accessKey: string = 'Cloudmap#123',
  secretKey: string = 'Cloudmap#123'
): Promise<{ Authorization: string; tonce: string }> => {
  const authUrl = `/api-proxy/api/sign?url=${encodeURIComponent(path)}&method=${method}&other=${encodeURIComponent(other)}&accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`;
  // 注意：
  // 1) 这里如果把 JSON 字符串直接作为 body 交给 requestManager，会被再次 JSON.stringify，导致后端解析为非法 JSON（""{\"uuid\""...）。
  // 2) 因此 bodyRaw 存在时先尝试 JSON.parse 成对象再发送；空 body 发送 {}。
  let signBody: any = {};
  if (bodyRaw && typeof bodyRaw === 'string') {
    try {
      signBody = JSON.parse(bodyRaw);
    } catch {
      // bodyRaw 非 JSON 时退回空对象，避免签名接口因解析失败直接 500
      signBody = {};
    }
  }
  const response = await requestManager(
    {
      method: 'POST',
      endpoint: authUrl,
      body: signBody,
      headers: {
        'Content-Type': 'application/json',
      },
      options: {
        enableDeduplication: false,
        enableCache: false,
        enableRetry: true,
      },
    },
    API_BASE_URL
  );
  const info = (response && response.data) ? response.data : response;
  if (!info?.Authorization || !info?.tonce) throw new Error('签名失败');
  return { Authorization: info.Authorization, tonce: String(info.tonce) };
};

/**
 * 通过代理调用 CSM CTL API
 * @param path CSM CTL API 路径（如 /V2/ctcontrol/VR3/VRConfig/list）
 * @param method HTTP 方法
 * @param other 查询参数（如 uuid=xxx）
 * @param body 请求体（对象，会自动序列化为 JSON）
 * @returns API 响应数据
 */
export const proxyApiRequest = async (
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  other: string = '',
  body?: any,
  accessKey?: string,
  secretKey?: string
): Promise<any> => {
  // 1. 获取签名信息
  const bodyRaw = body ? JSON.stringify(body) : '';
  const authInfo = await getProxyAuthInfo(path, method, other, bodyRaw, accessKey, secretKey);
  
  // 2. 构建请求 URL
  const queryUrl = `/api-proxy${path}${other ? `?${other}` : ''}`;
  
  // 3. 发送请求（使用统一的 API 服务，但需要自定义 headers）
  // DELETE/GET 无 body 时不带 Content-Type: application/json，避免部分 CSM 网关返回异常
  const headers: Record<string, string> = {
    Authorization: authInfo.Authorization,
    tonce: authInfo.tonce,
    Accept: 'application/json',
  };
  if (body != null && ['POST', 'PUT', 'PATCH'].includes(String(method).toUpperCase())) {
    headers['Content-Type'] = 'application/json';
  }
  try {
    return await requestManager(
      {
        method,
        endpoint: queryUrl,
        body: body,
        headers,
        options: {
          enableDeduplication: false, // 代理 API 不去重
          enableCache: false, // 代理 API 不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`代理 API 请求失败 ${path}:`, error);
    throw error;
  }
};

// Harvester Events
