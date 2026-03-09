import { apiDelete, apiPost, apiRequest, apiPatch } from './api';

// 云资源池：查询单个 VPC（华为云）
export const showCloudProviderVpc = async (cloudId: string, vpcId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(vpcId)}`);
};

// 云资源池：查询单个 安全组（华为云）
export const showCloudProviderSecurityGroup = async (cloudId: string, sgId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}`);
};

export const createHuaweiCloudSecurityGroup = async (
  cloudId: string,
  payload: { name: string; description?: string; enterprise_project_id?: string }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/security-groups`, { security_group: payload });
};

export const deleteHuaweiCloudSecurityGroup = async (
  cloudId: string,
  sgId: string
) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}`);
};

export const createHuaweiCloudSecurityGroupRule = async (
  cloudId: string,
  sgId: string,
  payload: { direction: string; protocol?: string; ethertype?: string; port_range_min?: number; port_range_max?: number; remote_ip_prefix?: string; remote_group_id?: string; description?: string }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, { rule: payload });
};

export const deleteHuaweiCloudSecurityGroupRule = async (
  cloudId: string,
  sgId: string,
  ruleId: string
) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules/${encodeURIComponent(ruleId)}`);
};

export const updateHuaweiCloudSecurityGroupRule = async (
  cloudId: string,
  sgId: string,
  ruleId: string,
  payload: { direction: string; protocol?: string; ethertype?: string; port_range_min?: number; port_range_max?: number; remote_ip_prefix?: string; remote_group_id?: string; description?: string }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules/${encodeURIComponent(ruleId)}`, { rule: payload });
};

// 云资源池：创建 VPC（华为云）
export const createHuaweiCloudVpc = async (
  cloudId: string,
  payload: { cidr: string; ipv6_cidr?: string; name?: string; description?: string; enterprise_project_id?: string; tags?: string[]; block_service_endpoint_states?: string; enable_network_address_usage_metrics?: boolean }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/vpcs`, { vpc: payload });
};

// 云资源池：更新 VPC（华为云）
export const updateHuaweiCloudVpc = async (
  cloudId: string,
  vpcId: string,
  payload: { name?: string; description?: string; cidr?: string; enterprise_project_id?: string; tags?: string[]; block_service_endpoint_states?: string; enable_network_address_usage_metrics?: boolean }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(vpcId)}`, { vpc: payload });
};

export const fetchHuaweiEcsMetrics = async (cloudId: string, instanceId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/metrics`);
};

export const fetchHuaweiCesMetrics = async (cloudId: string, instanceId: string, payload?: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/ces-metrics`, payload || {});
};

export const fetchHuaweiCesAvailableMetrics = async (cloudId: string, instanceId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/ces-available-metrics`);
};

export const fetchHuaweiEcsAuditLogs = async (cloudId: string, instanceId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/audit-logs`);
};

export const fetchHuaweiEcsAuditTraces = async (cloudId: string, instanceId: string, params?: { start?: number; end?: number; limit?: number; traceName?: string }) => {
  const qs: string[] = [];
  if (params?.start != null) qs.push(`start=${encodeURIComponent(String(params.start))}`);
  if (params?.end != null) qs.push(`end=${encodeURIComponent(String(params.end))}`);
  if (params?.limit != null) qs.push(`limit=${encodeURIComponent(String(params.limit))}`);
  if (params?.traceName != null && String(params.traceName).trim()) qs.push(`trace_name=${encodeURIComponent(String(params.traceName))}`);
  const endpoint = `/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/audit-traces${qs.length ? ('?' + qs.join('&')) : ''}`;
  return await apiRequest(endpoint);
};

export const fetchHuaweiPorts = async (cloudId: string, params?: { deviceId?: string }) => {
  const qs: string[] = [];
  if (params?.deviceId) qs.push(`device_id=${encodeURIComponent(params.deviceId)}`);
  const endpoint = `/api/clouds/${cloudId}/resources/ports${qs.length ? ('?' + qs.join('&')) : ''}`;
  return await apiRequest(endpoint);
};

// 华为云：创建子网
export const createHuaweiCloudSubnet = async (
  cloudId: string,
  payload: { vpc_id: string; cidr: string; ipv6_cidr?: string; name?: string; description?: string; gateway_ip?: string; dhcp_enable?: boolean; primary_dns?: string; secondary_dns?: string; dnsList?: string[]; availability_zone?: string }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/subnets`, { subnet: payload });
};

// 华为云：更新子网
export const updateHuaweiCloudSubnet = async (
  cloudId: string,
  subnetId: string,
  payload: { name?: string; description?: string; dhcp_enable?: boolean; primary_dns?: string; secondary_dns?: string; dnsList?: string[] }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(subnetId)}`, { subnet: payload });
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
  return await apiRequest(`/api/clouds/${cloudId}/resources/subnets`);
};
