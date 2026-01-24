// API服务函数
// 远端访问时，如果 .env 指向 localhost，会导致请求打到访问者本机而非服务器。
// 这里做一个健壮性处理：当检测到页面不在 localhost，但 REACT_APP_API_URL 包含 localhost 时，改用同主机的 4002 端口。
const defaultApiBase = (() => {
  const envUrl = process.env.REACT_APP_API_URL;
  if (envUrl) {
    if (typeof window !== 'undefined') {
      const isPageLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const envIsLocalhost = /localhost|127\.0\.0\.1/.test(envUrl);
      if (!isPageLocalhost && envIsLocalhost) {
        return `${window.location.protocol}//${window.location.hostname}:5001`;
      }
    }
    return envUrl;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:5001`;
  }
  return 'http://localhost:5001';
})();

export const API_BASE_URL = defaultApiBase;

// 获取认证token
export const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
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

// 通用请求函数
export const apiRequest = async (endpoint: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: getAuthHeaders(),
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用 POST 请求
export const apiPost = async (endpoint: string, body: any = {}) => {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

export const apiDelete = async (endpoint: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用 PATCH 请求
export const apiPatch = async (endpoint: string, body: any = {}) => {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 获取云资源池数据
export const fetchClouds = async () => {
  return await apiRequest('/api/clouds');
};



// 获取用户数据
export const fetchUsers = async () => {
  return await apiRequest('/api/users');
};






// 获取租户数据
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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

// 云资源池：查询单个 VPC（华为云）
export const showCloudProviderVpc = async (cloudId: string, vpcId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(vpcId)}`, {
    method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

// 云资源池：查询单个 安全组（华为云）
export const showCloudProviderSecurityGroup = async (cloudId: string, sgId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}`, {
    method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createHuaweiCloudSecurityGroup = async (
  cloudId: string,
  payload: { name: string; description?: string; enterprise_project_id?: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ security_group: payload }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteHuaweiCloudSecurityGroup = async (
  cloudId: string,
  sgId: string
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createHuaweiCloudSecurityGroupRule = async (
  cloudId: string,
  sgId: string,
  payload: { direction: string; protocol?: string; ethertype?: string; port_range_min?: number; port_range_max?: number; remote_ip_prefix?: string; remote_group_id?: string; description?: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ rule: payload }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteHuaweiCloudSecurityGroupRule = async (
  cloudId: string,
  sgId: string,
  ruleId: string
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules/${encodeURIComponent(ruleId)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateHuaweiCloudSecurityGroupRule = async (
  cloudId: string,
  sgId: string,
  ruleId: string,
  payload: { direction: string; protocol?: string; ethertype?: string; port_range_min?: number; port_range_max?: number; remote_ip_prefix?: string; remote_group_id?: string; description?: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules/${encodeURIComponent(ruleId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ rule: payload }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

// 云资源池：创建 VPC（华为云）
export const createHuaweiCloudVpc = async (
  cloudId: string,
  payload: { cidr: string; ipv6_cidr?: string; name?: string; description?: string; enterprise_project_id?: string; tags?: string[]; block_service_endpoint_states?: string; enable_network_address_usage_metrics?: boolean }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vpcs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ vpc: payload }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

// 云资源池：更新 VPC（华为云）
export const updateHuaweiCloudVpc = async (
  cloudId: string,
  vpcId: string,
  payload: { name?: string; description?: string; cidr?: string; enterprise_project_id?: string; tags?: string[]; block_service_endpoint_states?: string; enable_network_address_usage_metrics?: boolean }
) => {
  const token = localStorage.getItem('token');
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(vpcId)}`;
  const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ vpc: payload }), credentials: 'include' as RequestCredentials });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchSaseDiscoveredAssets = async (params?: any) => {
  const q = new URLSearchParams();
  if (params?.cloudId) q.append('cloud_id', params.cloudId);
  if (params?.domainId) q.append('domain_id', params.domainId);
  return apiRequest(`/api/sase/gateways/assets?${q.toString()}`);
};

export const fetchCloudVpcs = async (cloudId: string) => {
  const token = localStorage.getItem('token');
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

export const fetchCloudProviderEcs = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs`, {
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

// 云资源池：ECS 管理操作（启动/停止/重启/删除）
export const startCloudProviderEcs = async (cloudId: string, instanceId: string) => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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

export const fetchAliyunEcsVncUrl = async (cloudId: string, instanceId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/vnc-url`, {
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

export const fetchCloudProviderEcsVncUrl = async (cloudId: string, instanceId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/vnc-url`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHuaweiEcsMetrics = async (cloudId: string, instanceId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/metrics`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHuaweiCesMetrics = async (cloudId: string, instanceId: string, payload?: any) => {
  const token = localStorage.getItem('token');
  const body = payload || {};
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/ces-metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHuaweiCesAvailableMetrics = async (cloudId: string, instanceId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/ces-available-metrics`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHuaweiEcsAuditLogs = async (cloudId: string, instanceId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/audit-logs`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHuaweiEcsAuditTraces = async (cloudId: string, instanceId: string, params?: { start?: number; end?: number; limit?: number; traceName?: string }) => {
  const token = localStorage.getItem('token');
  const qs: string[] = [];
  if (params?.start != null) qs.push(`start=${encodeURIComponent(String(params.start))}`);
  if (params?.end != null) qs.push(`end=${encodeURIComponent(String(params.end))}`);
  if (params?.limit != null) qs.push(`limit=${encodeURIComponent(String(params.limit))}`);
  if (params?.traceName != null && String(params.traceName).trim()) qs.push(`trace_name=${encodeURIComponent(String(params.traceName))}`);
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/audit-traces${qs.length ? ('?' + qs.join('&')) : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchAliyunEcsMetrics = async (cloudId: string, instanceId: string, params?: { metric?: string; period?: number; start?: number; end?: number }) => {
  const token = localStorage.getItem('token');
  const qs: string[] = [];
  if (params?.metric) qs.push(`metric=${encodeURIComponent(params.metric)}`);
  if (params?.period != null) qs.push(`period=${encodeURIComponent(String(params.period))}`);
  if (params?.start != null) qs.push(`start=${encodeURIComponent(String(params.start))}`);
  if (params?.end != null) qs.push(`end=${encodeURIComponent(String(params.end))}`);
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/metrics${qs.length ? ('?' + qs.join('&')) : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const attachCloudProviderEni = async (cloudId: string, eniId: string, instanceId: string, options?: { trunkNetworkInstanceId?: string; networkCardIndex?: number; waitForNetworkConfigurationReady?: boolean }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/enis/${encodeURIComponent(eniId)}/attach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify({ instanceId, ...options }),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const detachCloudProviderEni = async (cloudId: string, eniId: string, instanceId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/enis/${encodeURIComponent(eniId)}/detach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify({ instanceId }),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchAliyunEcsHistoryEvents = async (cloudId: string, instanceId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/history-events`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHuaweiPorts = async (cloudId: string, params?: { deviceId?: string }) => {
  const token = localStorage.getItem('token');
  const qs = params?.deviceId ? `?deviceId=${encodeURIComponent(params.deviceId)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ports${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const bindHuaweiEip = async (cloudId: string, eipId: string, portId: string) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/eips/${encodeURIComponent(eipId)}/bind`, { port_id: portId });
};

export const unbindHuaweiEip = async (cloudId: string, eipId: string) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/eips/${encodeURIComponent(eipId)}/unbind`, {});
};

export const updateHuaweiPortSourceDestCheck = async (
  cloudId: string,
  portId: string,
  payload: { enabled?: boolean; allowed_ip?: string }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/ports/${encodeURIComponent(portId)}/source-dest-check`, payload);
};

export const addHuaweiPortSecurityGroup = async (
  cloudId: string,
  portId: string,
  sgId: string
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/ports/${encodeURIComponent(portId)}/security-groups`, { add: sgId });
};

export const removeHuaweiPortSecurityGroup = async (
  cloudId: string,
  portId: string,
  sgId: string
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/ports/${encodeURIComponent(portId)}/security-groups`, { remove: sgId });
};

export const setHuaweiPortSecurityGroups = async (
  cloudId: string,
  portId: string,
  sgIds: string[]
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/ports/${encodeURIComponent(portId)}/security-groups`, { set: sgIds });
};

export const fetchHarvesterNads = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/nads`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterNamespaces = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/namespaces`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterVolumes = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterAvailableVolumes = async (cloudId: string, namespace?: string) => {
  const token = localStorage.getItem('token');
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/available-volumes${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterStorageClasses = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/storage-classes`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterImages = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const attachHarvesterVolumeToVm = async (
  cloudId: string,
  instanceId: string,
  payload: { name: string; bus?: string; pvcNamespace: string; pvcName: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(instanceId)}/add-volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const attachHarvesterVolumeToVmByName = async (
  cloudId: string,
  vmNamespace: string,
  vmName: string,
  payload: { name?: string; diskName?: string; bus?: string; pvcNamespace: string; pvcName: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(vmNamespace)}/${encodeURIComponent(vmName)}/add-volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const exportHarvesterImageFromVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { displayName?: string; targetStorageClassName?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/export-image`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const createHarvesterVolumeSnapshot = async (cloudId: string, namespace: string, pvcName: string, payload: { name?: string; snapshotClassName?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/snapshots`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const updateHarvesterVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { sizeGi?: number; size?: string; accessModes?: string[]; volumeMode?: string; storageClassName?: string; annotations?: Record<string,string>; labels?: Record<string,string> }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const cloneHarvesterVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { targetNamespace?: string; newName: string; sizeGi?: number; size?: string; storageClassName?: string; fromSnapshotName?: string; accessModes?: string[]; volumeMode?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/clone`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload||{}), credentials: 'include'
  });
  if (!res.ok) { const t=await res.text(); try{ const j=JSON.parse(t); throw new Error(String(j?.message||j?.error||t)); }catch{ throw new Error(t);} }
  return await res.json();
};

export const detachHarvesterVolumeFromVm = async (
  cloudId: string,
  instanceId: string,
  payload: { name: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(instanceId)}/remove-volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteHarvesterVolume = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
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

export const deleteHarvesterImage = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};


export const createHarvesterVolume = async (cloudId: string, payload: { namespace: string; name: string; sizeGi?: number; size?: string; accessModes?: string[]; volumeMode?: string; storageClassName?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/volumes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload), credentials: 'include'
  });
  if (!res.ok) {
    const text = await res.text();
    try { const json = JSON.parse(text); throw new Error(String(json?.message || json?.error || text)); } catch { throw new Error(text); }
  }
  return await res.json();
};

export const createHarvesterImage = async (cloudId: string, payload: { namespace: string; name?: string; displayName?: string; sourceType?: string; url?: string; targetStorageClassName?: string; storageClassParameters?: Record<string,string> }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const updateHarvesterImage = async (cloudId: string, namespace: string, name: string, payload: { displayName?: string; retry?: number; targetStorageClassName?: string; storageClassParameters?: Record<string,string> }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterNodes = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/nodes`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
      credentials: 'include',
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Harvester nodes fetch failed', res.status, errorText);
      throw new Error(`Harvester 节点查询失败：${res.status} ${errorText}`);
    }
    const data = await res.json();
    console.log('Harvester nodes fetched', data);
    return data;
  } catch (e: any) {
    console.error('Harvester nodes fetch error', e);
    throw e;
  }
};

export const fetchHarvesterHealth = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/health`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchKubeOvnVpcs = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/kubeovn/vpcs`, {
    method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchKubeOvnSubnets = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/kubeovn/subnets`, {
    method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchHarvesterGpuResources = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/gpu-resources`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterSystemPods = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/system-pods`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterVmDetail = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterVmVncUrl = async (cloudId: string, namespace: string, name: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/vnc-url`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

// CSM：虚拟安全网元
export const fetchCsmVirtualElements = async (cloudId: string) => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/pool-id`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCsmPoolId = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/pool-id`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchCsmAssets = async (cloudId: string, params: any = {}) => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/csm/network/assets/${assetId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteCsmServiceChain = async (cloudId: string, chainId: string, params?: { pool_id?: string }) => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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

export const updateHarvesterVmSpec = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload: { cpu?: number; memory?: string; runStrategy?: 'Always'|'Manual'|'RerunOnFailure'|'Halted'; cpuSockets?: number; cpuCores?: number; cpuThreads?: number; dedicatedCPUPlacement?: boolean; cpuRequest?: number; cpuLimit?: number; memoryLimit?: string; gpuMode?: 'passthrough'|'vgpu'|'sriov'; gpuResourceName?: string; gpuCount?: number }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/spec`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  });
  if (!res.ok) { const t = await res.text(); try { const j = JSON.parse(t); throw new Error(String(j?.message || j?.error || t)); } catch { throw new Error(t); } }
  return await res.json();
};

export const createHarvesterVm = async (
  cloudId: string,
  payload: {
    namespace: string;
    name: string;
    cpu: number;
    memory: string;
    image: string;
    networks?: string[];
    userData?: string;
    systemDiskSize?: string;
    storageClassName?: string;
    nodeName?: string;
    nodeSelector?: Record<string,string>;
    diskBus?: string;
    runStrategy?: 'Always'|'Manual'|'RerunOnFailure'|'Halted';
    bootUseEfi?: boolean;
    efiPersistent?: boolean;
    efiSecureBoot?: boolean;
    tpmEnabled?: boolean;
    tpmPersistent?: boolean;
    useUsbTablet?: boolean;
    installGuestAgent?: boolean;
    gpuMode?: 'passthrough'|'vgpu'|'sriov';
    gpuResourceName?: string;
    gpuCount?: number;
    usbDevices?: string[];
    cpuSockets?: number;
    cpuCores?: number;
    cpuThreads?: number;
    cpuModel?: string;
    cpuModelCustom?: string;
    dedicatedCPUPlacement?: boolean;
    isolateEmulatorThread?: boolean;
    cpuRequest?: number;
    cpuLimit?: number;
    memoryLimit?: string;
    memoryRequestGi?: number;
    hotExpandEnabled?: boolean;
    sshNames?: string[];
    extraDisks?: Array<{ name: string; size?: string; bus?: string; storageClassName?: string; type?: 'disk'; image?: string; sourceType?: 'new'|'existing'; pvc?: string }>;
    netIfaces?: Array<{ name: string; type?: string; model?: string }>;
    rootSourceType?: 'image'|'existing';
    rootImage?: string;
    rootPvc?: string;
    rootName?: string;
    rootBus?: string;
    rootDeviceType?: 'disk'|'cdrom';
    rootSize?: string;
  }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const previewHarvesterVm = async (
  cloudId: string,
  payload: any
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/vms/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const fetchHarvesterUsbResources = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/usb-resources`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
  return await res.json();
};

export const deleteCloudProviderEcs = async (cloudId: string, instanceId: string, deleteImage?: boolean) => {
  const token = localStorage.getItem('token');
  let url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}`;
  if (deleteImage) {
    url += `?deleteImage=true`;
  }
  const res = await fetch(url, {
    method: 'DELETE',
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

export const fetchCloudProviderVSwitches = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vswitches`, {
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

// 云资源池：创建云端 VSwitch（当前支持阿里云）
export const createCloudProviderVSwitch = async (cloudId: string, payload: { VpcId: string; ZoneId: string; CidrBlock: string; VSwitchName?: string; Description?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vswitches`, {
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

// 云资源池：删除云端 VSwitch（当前支持阿里云）
export const deleteCloudProviderVSwitch = async (cloudId: string, vswitchId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/vswitches/${encodeURIComponent(vswitchId)}`);
};

// 华为云：子网（与阿里云 vswitches 对应）
export const fetchCloudProviderSubnets = async (cloudId: string) => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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

// 安全组（Aliyun 首期）创建
export const createCloudProviderSecurityGroup = async (
  cloudId: string,
  payload: { vpcId: string; name: string; description?: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups`, {
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

// 安全组（Aliyun 首期）更新（名称/描述）
export const updateCloudProviderSecurityGroup = async (
  cloudId: string,
  sgId: string,
  payload: { name?: string; description?: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${sgId}`, {
    method: 'PATCH',
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

// 安全组（Aliyun 首期）删除
export const deleteCloudProviderSecurityGroup = async (cloudId: string, sgId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${sgId}`, {
    method: 'DELETE',
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
  const token = localStorage.getItem('token');
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

export const createCloudProviderSecurityGroupRule = async (cloudId: string, sgId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, {
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

export const deleteCloudProviderSecurityGroupRule = async (cloudId: string, sgId: string, payload: any) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, {
    method: 'DELETE',
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

// 云资源池：查询阿里云 弹性网卡（ENI）列表（支持按 VPC/VSwitch/ECS 过滤）
export const fetchCloudProviderEnis = async (cloudId: string, params?: { vpcId?: string; vSwitchId?: string; instanceId?: string } & Record<string, any>) => {
  const qs = (() => {
    const p: string[] = [];
    if (params?.vpcId) p.push(`vpcId=${encodeURIComponent(params.vpcId)}`);
    if (params?.vSwitchId) p.push(`vSwitchId=${encodeURIComponent(params.vSwitchId)}`);
    if (params?.instanceId) p.push(`instanceId=${encodeURIComponent(params.instanceId)}`);
    if (params) {
      Object.keys(params).forEach(k => {
        if (k !== 'vpcId' && k !== 'vSwitchId' && k !== 'instanceId' && params[k] !== undefined) {
          p.push(`${k}=${encodeURIComponent(String(params[k]))}`);
        }
      });
    }
    return p.length ? `?${p.join('&')}` : '';
  })();
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/enis${qs}`, {
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

// 云资源池：创建阿里云 弹性网卡（ENI）
export const createCloudProviderEni = async (
  cloudId: string,
  payload: { vSwitchId: string; securityGroupId: string; name?: string; description?: string; ipv4Address?: string }
) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/enis`, {
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

// 云资源池：更新阿里云 弹性网卡（ENI）属性（名称/描述）
export const updateCloudProviderEni = async (
  cloudId: string,
  eniId: string,
  payload: { name?: string; description?: string; sourceDestCheck?: boolean }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/enis/${encodeURIComponent(eniId)}`, payload);
};

// 云资源池：删除阿里云 弹性网卡（ENI）
export const deleteCloudProviderEni = async (cloudId: string, eniId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/enis/${encodeURIComponent(eniId)}`);
};

export const fetchCloudProviderEips = async (cloudId: string) => {
  const token = localStorage.getItem('token');
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
export const associateAliyunEip = async (cloudId: string, allocationId: string, payload: { InstanceId?: string; NetworkInterfaceId?: string; PrivateIpAddress?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/eips/${encodeURIComponent(allocationId)}/associate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};
export const unassociateAliyunEip = async (cloudId: string, allocationId: string, payload?: { InstanceId?: string; NetworkInterfaceId?: string; PrivateIpAddress?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/eips/${encodeURIComponent(allocationId)}/unassociate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchCloudProviderLoadBalancers = async (cloudId: string) => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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

// 路由表条目（详细路由）
export const fetchCloudProviderRouteEntries = async (cloudId: string, routeTableId: string) => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-entries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ routeTableId, route }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, oldRoute: { destination: string; nexthop: string }, newRoute: { type: string; destination: string; nexthop: string; description?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-entries`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ routeTableId, oldRoute, newRoute }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const modCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, route: { type: string; destination: string; nexthop: string; description?: string }) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-entries`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ routeTableId, route }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, route: { destination: string; nexthop: string }) => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(payload), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const associateCloudProviderRouteTable = async (cloudId: string, routeTableId: string, subnetIds: string[]) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}/associate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ subnetIds }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const disassociateCloudProviderRouteTable = async (cloudId: string, routeTableId: string, subnetIds: string[]) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}/disassociate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ subnetIds }), credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteCloudProviderRouteTable = async (cloudId: string, routeTableId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

// 全部资源池云主机聚合
export const fetchAllInstances = async () => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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

// 云资源池：查询阿里云 网络 ACL 列表（支持按 VPC 过滤）
export const fetchCloudProviderNetworkAcls = async (cloudId: string, params?: { vpcId?: string }) => {
  const qs = params?.vpcId ? `?vpcId=${encodeURIComponent(params.vpcId)}` : '';
  const token = localStorage.getItem('token');
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

// 云资源池：创建阿里云 网络 ACL
export const createCloudProviderNetworkAcl = async (
  cloudId: string,
  payload: { vpcId: string; name: string; description?: string }
) => {
  const token = localStorage.getItem('token');
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

// 云资源池：更新阿里云 网络 ACL 属性
export const updateCloudProviderNetworkAcl = async (
  cloudId: string,
  aclId: string,
  payload: { name?: string; description?: string }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/network-acls/${encodeURIComponent(aclId)}`, payload);
};

// 云资源池：删除阿里云 网络 ACL
export const deleteCloudProviderNetworkAcl = async (cloudId: string, aclId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/network-acls/${encodeURIComponent(aclId)}`);
};

export const fetchCloudProviderDisks = async (cloudId: string) => {
  const token = localStorage.getItem('token');
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
  const token = localStorage.getItem('token');
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
  return await apiRequest('/api/dashboard/stats');
}; 

export const fetchDashboardRecentActivities = async () => {
  return await apiRequest('/api/dashboard/recent-activities');
}; 

export const fetchDashboardCloudUsage = async () => {
  return await apiRequest('/api/dashboard/cloud-usage');
};

// ===== SRv6 隧道 =====
export const fetchSrv6Tunnels = async () => {
  return await apiRequest('/api/networks/srv6');
};

export const createSrv6Tunnel = async (payload: { name: string; peA: string; peB: string; ceA: string; ceB: string }) => {
  return await apiPost('/api/networks/srv6', payload);
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

export const fetchIPsecVPNsMerged = async (params?: { vrId?: string }) => {
  const qs: string[] = ['includeDevice=1'];
  if (params?.vrId) qs.push(`vrId=${encodeURIComponent(params.vrId)}`);
  const url = `/api/networks/ipsec${qs.length ? ('?' + qs.join('&')) : ''}`;
  return await apiRequest(url);
};

export const createIPsecVPN = async (payload: any) => {
  return await apiPost('/api/networks/ipsec', payload);
};

export const deleteIPsecVPN = async (id: string) => {
  return await apiDelete(`/api/networks/ipsec/${id}`);
};

// ===== 服务目录（Service Catalog）=====
export const fetchServices = async () => {
  return await apiRequest('/api/services');
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
