import { API_BASE_URL, apiDelete, apiPost, apiRequest, getAuthHeaders, apiPatch } from './api';

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

export const fetchHuaweiPorts = async (cloudId: string, params?: { deviceId?: string }) => {
  const token = localStorage.getItem('token');
  const qs: string[] = [];
  if (params?.deviceId) qs.push(`device_id=${encodeURIComponent(params.deviceId)}`);
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/ports${qs.length ? ('?' + qs.join('&')) : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) { throw new Error(await res.text()); }
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
export const deleteHuaweiCloudSubnet = async (cloudId: string, subnetId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(subnetId)}`);
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

// 华为云：子网（与阿里云 vswitches 对应）
export const fetchHuaweiCloudSubnets = async (cloudId: string) => {
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
