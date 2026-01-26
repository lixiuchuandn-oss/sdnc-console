import { API_BASE_URL, apiDelete, apiPatch } from './api';

// 直接调用阿里云 ECS API (透传)
export const callAliyunEcs = async (cloudId: string, action: string, params: any = {}) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/ecs/call?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify(params),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
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

export const fetchCloudProviderVpnGateways = async (cloudId: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/vpn-gateways`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
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

// 云资源池：创建云端 VPC（阿里云）
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
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const stopAliyunEcs = async (cloudId: string, instanceId: string, force: boolean = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify({ force }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const rebootAliyunEcs = async (cloudId: string, instanceId: string, force: boolean = false) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/reboot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
    body: JSON.stringify({ force }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteAliyunEcs = async (cloudId: string, instanceId: string) => {
  // Generic delete endpoint for ECS
  return await apiDelete(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}`);
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

export { fetchCloudProviderDisks, fetchCloudProviderSnapshots } from './api';
