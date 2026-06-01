import { apiDelete, apiPost, apiRequest, apiPatch } from './api';

// ===== ECS 创建依赖与生命周期（华为云）=====
export const fetchHuaweiFlavors = async (cloudId: string, availabilityZone?: string) => {
  const qs = availabilityZone ? `?availabilityZone=${encodeURIComponent(availabilityZone)}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/flavors${qs}`);
};
export const fetchHuaweiAvailabilityZones = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/availability-zones`);
};
export const fetchHuaweiImages = async (cloudId: string, params?: { imagetype?: string; osType?: string }) => {
  const q: string[] = [];
  if (params?.imagetype) q.push(`imagetype=${encodeURIComponent(params.imagetype)}`);
  if (params?.osType) q.push(`osType=${encodeURIComponent(params.osType)}`);
  return await apiRequest(`/api/clouds/${cloudId}/resources/images${q.length ? `?${q.join('&')}` : ''}`);
};
export const fetchHuaweiKeypairs = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/key-pairs`);
};
export const createHuaweiKeypair = async (cloudId: string, name: string, publicKey?: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/key-pairs`, { name, publicKey });
};
export const deleteHuaweiKeypair = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/key-pairs/${encodeURIComponent(name)}`);
};
export const createHuaweiServer = async (
  cloudId: string,
  payload: {
    name?: string;
    imageRef: string;
    flavorRef: string;
    vpcid: string;
    subnetId: string;
    availabilityZone?: string;
    rootVolumeType?: string;
    rootVolumeSize?: number;
    count?: number;
    keyName?: string;
    adminPass?: string;
    securityGroupIds?: string[];
    dataVolumes?: Array<{ volumetype?: string; size?: number }>;
  },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs`, payload);
};
export const deleteHuaweiServer = async (cloudId: string, instanceId: string, deleteVolume?: boolean) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}`, { deleteVolume });
};

// ===== EVS 云盘/快照写操作（华为云）=====
export const createHuaweiVolume = async (
  cloudId: string,
  payload: { availabilityZone: string; volumeType?: string; size: number; name?: string; description?: string; count?: number },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/disks`, payload);
};
export const deleteHuaweiVolume = async (cloudId: string, diskId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/disks/${encodeURIComponent(diskId)}`);
};
export const resizeHuaweiVolume = async (cloudId: string, diskId: string, newSize: number) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/disks/${encodeURIComponent(diskId)}/resize`, { newSize });
};
export const attachHuaweiVolume = async (cloudId: string, diskId: string, instanceId: string, device?: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/disks/${encodeURIComponent(diskId)}/attach`, { instanceId, device });
};
export const detachHuaweiVolume = async (cloudId: string, diskId: string, instanceId: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/disks/${encodeURIComponent(diskId)}/detach`, { instanceId });
};
export const createHuaweiSnapshot = async (cloudId: string, payload: { diskId: string; name?: string; description?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/snapshots`, payload);
};
export const deleteHuaweiSnapshot = async (cloudId: string, snapshotId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/snapshots/${encodeURIComponent(snapshotId)}`);
};

// ===== EIP 申请/释放（华为云）=====
export const allocateHuaweiEip = async (
  cloudId: string,
  payload: { ipType?: string; bandwidthName?: string; bandwidthSize?: number; shareType?: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/eips`, payload);
};
export const releaseHuaweiEip = async (cloudId: string, eipId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/eips/${encodeURIComponent(eipId)}`);
};

// ===== NAT SNAT/DNAT 规则（华为云）=====
export const fetchHuaweiSnatRules = async (cloudId: string, natGatewayId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/nat-gateways/snat-rules?natGatewayId=${encodeURIComponent(natGatewayId)}`);
};
export const createHuaweiSnatRule = async (
  cloudId: string,
  payload: { natGatewayId: string; floatingIpId: string; cidr?: string; subnetId?: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/nat-gateways/snat-rules`, payload);
};
export const deleteHuaweiSnatRule = async (cloudId: string, natGatewayId: string, snatRuleId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/nat-gateways/snat-rules`, { natGatewayId, snatRuleId });
};
export const fetchHuaweiDnatRules = async (cloudId: string, natGatewayId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/nat-gateways/dnat-rules?natGatewayId=${encodeURIComponent(natGatewayId)}`);
};
export const createHuaweiDnatRule = async (
  cloudId: string,
  payload: { natGatewayId: string; floatingIpId: string; protocol: string; externalServicePort: number; internalServicePort: number; privateIp?: string; portId?: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/nat-gateways/dnat-rules`, payload);
};
export const deleteHuaweiDnatRule = async (cloudId: string, natGatewayId: string, dnatRuleId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/nat-gateways/dnat-rules`, { natGatewayId, dnatRuleId });
};

// ===== RDS 云数据库（华为云）=====
export const fetchHuaweiRds = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/rds`);
};
export const fetchHuaweiRdsDatastores = async (cloudId: string, engine: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/rds/datastores?engine=${encodeURIComponent(engine)}`);
};
export const fetchHuaweiRdsFlavors = async (cloudId: string, engine: string, version?: string) => {
  const q = version ? `&version=${encodeURIComponent(version)}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/rds/flavors?engine=${encodeURIComponent(engine)}${q}`);
};
export const createHuaweiRds = async (
  cloudId: string,
  payload: {
    name: string; engine: string; engineVersion: string; flavorRef: string;
    volumeType: string; volumeSize: number; vpcId: string; subnetId: string;
    securityGroupId: string; availabilityZone: string; password: string; port?: number;
  },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/rds`, payload);
};
export const deleteHuaweiRds = async (cloudId: string, dbInstanceId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/rds/${encodeURIComponent(dbInstanceId)}`);
};
export const restartHuaweiRds = async (cloudId: string, dbInstanceId: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/rds/${encodeURIComponent(dbInstanceId)}/restart`, {});
};

// ===== CES 告警规则（华为云）=====
export const fetchHuaweiAlarms = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/monitor/alarms`);
};
export const createHuaweiAlarm = async (
  cloudId: string,
  payload: {
    alarmName: string; namespace: string; metricName: string; instanceId?: string; dimensionName?: string;
    period?: number; filter?: string; comparisonOperator?: string; threshold?: number; unit?: string; count?: number; alarmLevel?: number;
  },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/monitor/alarms`, payload);
};
export const setHuaweiAlarmAction = async (cloudId: string, alarmId: string, enabled: boolean) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/monitor/alarms/${encodeURIComponent(alarmId)}/action`, { enabled });
};
export const deleteHuaweiAlarm = async (cloudId: string, alarmId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/monitor/alarms/${encodeURIComponent(alarmId)}`);
};

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
  if (params?.deviceId) qs.push(`deviceId=${encodeURIComponent(params.deviceId)}`);
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
