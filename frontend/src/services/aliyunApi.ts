import { apiDelete, apiPatch, apiPost, apiRequest } from './api';

// 直接调用阿里云 ECS API (透传)
export const callAliyunEcs = async (cloudId: string, action: string, params: any = {}) => {
  return await apiPost(`/api/clouds/${cloudId}/ecs/call?action=${action}`, params);
};

export const fetchAliyunEcsVncUrl = async (cloudId: string, instanceId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/vnc-url`);
};

export const fetchAliyunEcsMetrics = async (cloudId: string, instanceId: string, params?: { metric?: string; period?: number; start?: number; end?: number }) => {
  const qs: string[] = [];
  if (params?.metric) qs.push(`metric=${encodeURIComponent(params.metric)}`);
  if (params?.period != null) qs.push(`period=${encodeURIComponent(String(params.period))}`);
  if (params?.start != null) qs.push(`start=${encodeURIComponent(String(params.start))}`);
  if (params?.end != null) qs.push(`end=${encodeURIComponent(String(params.end))}`);
  const endpoint = `/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/metrics${qs.length ? ('?' + qs.join('&')) : ''}`;
  return await apiRequest(endpoint);
};

export const fetchAliyunEcsHistoryEvents = async (cloudId: string, instanceId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/history-events`);
};

export const fetchCloudProviderVSwitches = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/vswitches`);
};

// 云资源池：创建云端 VSwitch（当前支持阿里云）
export const createCloudProviderVSwitch = async (cloudId: string, payload: { VpcId: string; ZoneId: string; CidrBlock: string; VSwitchName?: string; Description?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/vswitches`, payload);
};

// 云资源池：删除云端 VSwitch（当前支持阿里云）
export const deleteCloudProviderVSwitch = async (cloudId: string, vswitchId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/vswitches/${encodeURIComponent(vswitchId)}`);
};

export const fetchCloudProviderVpnGateways = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/vpn-gateways`);
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
  return await apiRequest(`/api/clouds/${cloudId}/resources/enis${qs}`);
};

// 云资源池：创建阿里云 弹性网卡（ENI）
export const createCloudProviderEni = async (
  cloudId: string,
  payload: { vSwitchId: string; securityGroupId: string; name?: string; description?: string; ipv4Address?: string }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/enis`, payload);
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

export const attachCloudProviderEni = async (cloudId: string, eniId: string, instanceId: string, options?: { trunkNetworkInstanceId?: string; networkCardIndex?: number; waitForNetworkConfigurationReady?: boolean }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/enis/${encodeURIComponent(eniId)}/attach`, { instanceId, ...options });
};

export const detachCloudProviderEni = async (cloudId: string, eniId: string, instanceId: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/enis/${encodeURIComponent(eniId)}/detach`, { instanceId });
};

export const associateAliyunEip = async (cloudId: string, allocationId: string, payload: { InstanceId?: string; NetworkInterfaceId?: string; PrivateIpAddress?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/eips/${encodeURIComponent(allocationId)}/associate`, payload || {});
};

export const unassociateAliyunEip = async (cloudId: string, allocationId: string, payload?: { InstanceId?: string; NetworkInterfaceId?: string; PrivateIpAddress?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/eips/${encodeURIComponent(allocationId)}/unassociate`, payload || {});
};

export const fetchCloudProviderVpcs = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/vpcs`);
};

// 云资源池：创建云端 VPC（阿里云）
export const createCloudProviderVpc = async (cloudId: string, payload: { VpcName?: string; CidrBlock: string; Description?: string; EnableIpv6?: boolean; Ipv6CidrBlock?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/vpcs`, {
    ...payload,
    vpc: {
      cidr: payload.CidrBlock,
      name: payload.VpcName,
      description: payload.Description,
    }
  });
};

// 云资源池：删除云端 VPC（阿里云）
export const deleteCloudProviderVpc = async (cloudId: string, vpcId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(vpcId)}`);
};

// 云资源池：修改云端 VPC（阿里云）
export const updateCloudProviderVpc = async (cloudId: string, vpcId: string, payload: { VpcName?: string; Description?: string }) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(vpcId)}`, payload);
};

// ECS Operations for Aliyun (Generic but isolated for Aliyun components)
export const startAliyunEcs = async (cloudId: string, instanceId: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/start`, {});
};

export const stopAliyunEcs = async (cloudId: string, instanceId: string, force: boolean = false) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/stop`, { force });
};

export const rebootAliyunEcs = async (cloudId: string, instanceId: string, force: boolean = false) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/reboot`, { force });
};

export const deleteAliyunEcs = async (cloudId: string, instanceId: string) => {
  // Generic delete endpoint for ECS
  return await apiDelete(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}`);
};

export const fetchCloudProviderEcs = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/ecs`);
};

export const fetchCloudProviderSecurityGroups = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/security-groups`);
};

export const createCloudProviderSecurityGroup = async (
  cloudId: string,
  payload: { vpcId: string; name: string; description?: string }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/security-groups`, payload);
};

export const updateCloudProviderSecurityGroup = async (
  cloudId: string,
  sgId: string,
  payload: { name?: string; description?: string }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/security-groups/${sgId}`, payload);
};

export const deleteCloudProviderSecurityGroup = async (cloudId: string, sgId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/security-groups/${sgId}`);
};

export const fetchCloudProviderSecurityGroupDetail = async (cloudId: string, sgId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}`);
};

export const createCloudProviderSecurityGroupRule = async (cloudId: string, sgId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, payload);
};

export const deleteCloudProviderSecurityGroupRule = async (cloudId: string, sgId: string, payload: any) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, payload);
};

export const fetchCloudProviderEips = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/eips`);
};

export const fetchCloudProviderLoadBalancers = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/loadbalancers`);
};

export const fetchCloudProviderNatGateways = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/nat-gateways`);
};

export const fetchCloudProviderRouteTables = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/route-tables`);
};

export const fetchCloudProviderRouteEntries = async (cloudId: string, routeTableId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/route-entries?routeTableId=${encodeURIComponent(routeTableId)}`);
};

export const addCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, route: { type: string; destination: string; nexthop: string; description?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/route-entries`, { routeTableId, route });
};

export const updateCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, oldRoute: { destination: string; nexthop: string }, newRoute: { type: string; destination: string; nexthop: string; description?: string }) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/route-entries`, { routeTableId, oldRoute, newRoute });
};

export const modCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, route: { type: string; destination: string; nexthop: string; description?: string }) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/route-entries`, { routeTableId, route });
};

export const deleteCloudProviderRouteEntry = async (cloudId: string, routeTableId: string, route: { destination: string; nexthop: string }) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/route-entries`, { routeTableId, route });
};

export const createCloudProviderRouteTable = async (
  cloudId: string,
  payload: { vpcId: string; name?: string; description?: string; routes?: Array<{ type: string; destination: string; nexthop: string; description?: string }> }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/route-tables`, payload);
};

export const updateCloudProviderRouteTable = async (
  cloudId: string,
  routeTableId: string,
  payload: { name?: string; description?: string; routes?: Array<{ type: string; destination: string; nexthop: string; description?: string }> }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}`, payload);
};

export const associateCloudProviderRouteTable = async (cloudId: string, routeTableId: string, subnetIds: string[]) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}/associate`, { subnetIds });
};

export const disassociateCloudProviderRouteTable = async (cloudId: string, routeTableId: string, subnetIds: string[]) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}/disassociate`, { subnetIds });
};

export const deleteCloudProviderRouteTable = async (cloudId: string, routeTableId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/route-tables/${encodeURIComponent(routeTableId)}`);
};

export const fetchCloudProviderNetworkAcls = async (cloudId: string, params?: { vpcId?: string }) => {
  const qs = params?.vpcId ? `?vpcId=${encodeURIComponent(params.vpcId)}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/network-acls${qs}`);
};

export const createCloudProviderNetworkAcl = async (
  cloudId: string,
  payload: { vpcId: string; name: string; description?: string }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/network-acls`, payload);
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

export type AliyunAclEntry = {
  name?: string;
  policy?: 'accept' | 'drop';
  protocol?: 'all' | 'tcp' | 'udp' | 'icmp' | 'gre';
  port?: string;
  sourceCidrIp?: string;
  destinationCidrIp?: string;
  description?: string;
};

// 云资源池：更新阿里云网络ACL规则（整组覆盖 ingress/egress）
export const updateCloudProviderNetworkAclEntries = async (
  cloudId: string,
  aclId: string,
  payload: { ingress?: AliyunAclEntry[]; egress?: AliyunAclEntry[] },
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/network-acls/${encodeURIComponent(aclId)}/entries`, payload);
};

// 云资源池：关联网络ACL到交换机
export const associateCloudProviderNetworkAcl = async (cloudId: string, aclId: string, vSwitchIds: string[]) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/network-acls/${encodeURIComponent(aclId)}/associate`, { vSwitchIds });
};

// 云资源池：解除网络ACL与交换机关联
export const unassociateCloudProviderNetworkAcl = async (cloudId: string, aclId: string, vSwitchIds: string[]) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/network-acls/${encodeURIComponent(aclId)}/unassociate`, { vSwitchIds });
};

// 云资源池：申请阿里云 EIP（AllocateEipAddress）
export const allocateCloudProviderEip = async (
  cloudId: string,
  payload: { bandwidth?: number; internetChargeType?: string; name?: string; isp?: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/eips`, payload || {});
};

// 云资源池：释放阿里云 EIP（ReleaseEipAddress）
export const releaseCloudProviderEip = async (cloudId: string, allocationId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/eips/${encodeURIComponent(allocationId)}`);
};

// 云资源池：创建阿里云云盘（CreateDisk）
export const createCloudProviderDisk = async (
  cloudId: string,
  payload: {
    zoneId: string;
    diskCategory?: string;
    size?: number;
    diskName?: string;
    description?: string;
    snapshotId?: string;
    performanceLevel?: string;
  },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/disks`, payload);
};

// 云资源池：删除阿里云云盘（DeleteDisk）
export const deleteCloudProviderDisk = async (cloudId: string, diskId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/disks/${encodeURIComponent(diskId)}`);
};

// 云资源池：扩容阿里云云盘（ResizeDisk）
export const resizeCloudProviderDisk = async (
  cloudId: string,
  diskId: string,
  payload: { newSize: number; type?: 'offline' | 'online' },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/disks/${encodeURIComponent(diskId)}/resize`, payload);
};

// 云资源池：挂载阿里云云盘（AttachDisk）
export const attachCloudProviderDisk = async (
  cloudId: string,
  diskId: string,
  payload: { instanceId: string; deleteWithInstance?: boolean },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/disks/${encodeURIComponent(diskId)}/attach`, payload);
};

// 云资源池：卸载阿里云云盘（DetachDisk）
export const detachCloudProviderDisk = async (
  cloudId: string,
  diskId: string,
  payload: { instanceId: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/disks/${encodeURIComponent(diskId)}/detach`, payload);
};

// 云资源池：回滚阿里云云盘到快照（ResetDisk）
export const rollbackCloudProviderDisk = async (
  cloudId: string,
  diskId: string,
  payload: { snapshotId: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/disks/${encodeURIComponent(diskId)}/reset`, payload);
};

// 云资源池：创建阿里云快照（CreateSnapshot）
export const createCloudProviderSnapshot = async (
  cloudId: string,
  payload: { diskId: string; snapshotName?: string; description?: string; retentionDays?: number },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/snapshots`, payload);
};

// 云资源池：删除阿里云快照（DeleteSnapshot）
export const deleteCloudProviderSnapshot = async (cloudId: string, snapshotId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/snapshots/${encodeURIComponent(snapshotId)}`);
};

// ===== 镜像 / 规格 / 可用区 =====
export const fetchCloudProviderImages = async (cloudId: string, params?: { owner?: string; osType?: string; pageSize?: number }) => {
  const qs: string[] = [];
  if (params?.owner) qs.push(`owner=${encodeURIComponent(params.owner)}`);
  if (params?.osType) qs.push(`osType=${encodeURIComponent(params.osType)}`);
  if (params?.pageSize != null) qs.push(`pageSize=${encodeURIComponent(String(params.pageSize))}`);
  return await apiRequest(`/api/clouds/${cloudId}/resources/images${qs.length ? `?${qs.join('&')}` : ''}`);
};

export const deleteCloudProviderImage = async (cloudId: string, imageId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/images/${encodeURIComponent(imageId)}`);
};

export const createCloudProviderImage = async (
  cloudId: string,
  payload: { instanceId?: string; snapshotId?: string; imageName?: string; description?: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/images`, payload);
};

export const fetchCloudProviderInstanceTypes = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/instance-types`);
};

export const fetchCloudProviderZones = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/zones`);
};

// ===== SSH 密钥对 =====
export const fetchCloudProviderKeyPairs = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/key-pairs`);
};

export const createCloudProviderKeyPair = async (cloudId: string, keyPairName: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/key-pairs`, { keyPairName });
};

export const importCloudProviderKeyPair = async (cloudId: string, keyPairName: string, publicKeyBody: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/key-pairs/import`, { keyPairName, publicKeyBody });
};

export const deleteCloudProviderKeyPair = async (cloudId: string, keyPairName: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/key-pairs/${encodeURIComponent(keyPairName)}`);
};

// ===== ECS 创建与变更 =====
export const createCloudProviderEcs = async (
  cloudId: string,
  payload: {
    imageId: string;
    instanceType: string;
    securityGroupId: string;
    vSwitchId: string;
    zoneId?: string;
    amount?: number;
    instanceName?: string;
    hostName?: string;
    password?: string;
    keyPairName?: string;
    systemDiskCategory?: string;
    systemDiskSize?: number;
    instanceChargeType?: string;
    internetMaxBandwidthOut?: number;
    internetChargeType?: string;
  },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs`, payload);
};

export const modifyCloudProviderEcsSpec = async (cloudId: string, instanceId: string, instanceType: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/modify-spec`, { instanceType });
};

export const resetCloudProviderEcsPassword = async (cloudId: string, instanceId: string, password: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/reset-password`, { password });
};

export const replaceCloudProviderEcsSystemDisk = async (
  cloudId: string,
  instanceId: string,
  payload: { imageId: string; password?: string; keyPairName?: string; systemDiskSize?: number },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/replace-system-disk`, payload);
};

export { fetchCloudProviderDisks, fetchCloudProviderSnapshots } from './api';
