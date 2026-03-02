import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson } from './utils';

/**
 * 更新 Harvester/Kube-OVN 子网
 * 采用 "Get -> Merge -> Update" 的模式，确保不覆盖其他字段
 */
export const updateHarvesterSubnet = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // 1. 获取当前子网数据 (为了拿到 resourceVersion)
  const getUrl = `${origin}/apis/kubeovn.io/v1/subnets/${encodeURIComponent(name)}`;
  const current = await getJsonOnce(getUrl, token, insecure);
  if (!current) {
    throw new Error(`Subnet ${name} not found`);
  }

  // 2. 合并 Payload
  // 支持更新 spec 字段，以及 metadata.annotations
  const { annotations, ...specPayload } = payload;

  const updated = {
    ...current,
    metadata: {
      ...current.metadata,
      annotations: {
        ...(current.metadata?.annotations || {}),
        ...(annotations || {}),
      }
    },
    spec: {
      ...current.spec,
      ...specPayload,
    },
  };

  // 3. 执行更新 (PUT)
  const putUrl = `${origin}/apis/kubeovn.io/v1/subnets/${encodeURIComponent(name)}`;
  return await requestJson('PUT', putUrl, token, insecure, updated);
};

/**
 * 获取网络附件定义 (NADs)
 * 兼容不同的 API 路径，并处理权限不足时的降级策略 (遍历 Namespace)
 */
export const listHarvesterNADsStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  // 尝试不同的 API 路径 (兼容不同 Harvester 版本)
  const candidates = [
    `${origin}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions`,
    `${origin}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`,
    `${origin}/apis/k8s.cni.cncf.io/v1/network-attachment-definitions`,
    `${origin}/apis/k8s.cni.cncf.io/v1/networkattachmentdefinitions`,
  ];
  let json: any = null;
  let lastErr: any = null;

  // 策略 A: 尝试列出所有 (Cluster 级别)
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure, true);
      if (json) {
        const count = Array.isArray(json?.items) ? json.items.length : (Array.isArray(json?.data) ? json.data.length : 0);
        break;
      }
    } catch (e: any) {
      // 仅在 debug 模式或所有尝试都失败后才作为警告/错误输出，此处仅记录过程
      // console.debug(`[Harvester网络] 尝试路径失败 (将重试下一个): 请求地址=${url} 错误=${e.message}`);
      lastErr = e;
    }
  }

  // 策略 B: 如果 Cluster 级别失败 (通常是 403 Forbidden)，则尝试在特定 Namespace 下查找
  if (!json) {
    const nsCandidates = ['default', 'kube-system'];
    for (const ns of nsCandidates) {
      for (const baseUrl of candidates) {
        // 构造带 namespace 参数的 URL
        const u = /\?/.test(baseUrl)
          ? `${baseUrl}&namespace=${encodeURIComponent(ns)}`
          : `${baseUrl}?namespace=${encodeURIComponent(ns)}`;
        try {
          json = await getJsonOnce(u, token, insecure, true);
          if (json) {
             const count = Array.isArray(json?.items) ? json.items.length : (Array.isArray(json?.data) ? json.data.length : 0);
             break;
          }
        } catch (e: any) {
          lastErr = e;
        }
      }
      if (json) break;
    }
  }

  // 错误处理：如果是 401/404 则返回空数组，否则抛出异常
  if (!json && lastErr) {
    const s = Number((lastErr as any)?.status || 0);
    const m = String((lastErr as any)?.message || '').toLowerCase();
    const b = String((lastErr as any)?.body || '').toLowerCase();
    
    // 只有在最终完全失败时，才打印警告日志
    console.warn(`[Harvester-API] NAD列表所有路径均获取失败: 最终错误=${m} 状态码=${s}`);

    if (s === 401 || m.includes('unauthorized') || b.includes('unauthorized')) return [];
    if (s === 404 || m.includes('not found') || b.includes('not found')) return [];
    throw lastErr;
  }

  // 标准化返回数据结构
  const arr = (function () {
    const top = Array.isArray(json?.data)
      ? json?.data
      : Array.isArray(json?.items)
        ? json?.items
        : [];
    if (Array.isArray(top) && top.length > 0) return top;
    // 处理嵌套数据结构的情况
    const nested = Array.isArray(json?.data?.data) ? json?.data?.data : [];
    return nested;
  })();

  return arr.map((nad: any) => ({
    ...nad, // 保留原始数据
    links: {
      view: `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nad?.metadata?.namespace || nad?.namespace || ''}/network-attachment-definitions/${nad?.metadata?.name || nad?.name || ''}`
    }
  }));
};

/**
 * 获取集群网络 (ClusterNetworks)
 * API: /apis/network.harvesterhci.io/v1beta1/clusternetworks
 */
export const listHarvesterClusterNetworks = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // 尝试不同的 API 路径
  const candidates = [
    `${origin}/apis/network.harvesterhci.io/v1beta1/clusternetworks`,
  ];
  let json: any = null;
  let lastErr: any = null;

  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure, true);
      if (json) {
        break;
      }
    } catch (e: any) {
      lastErr = e;
    }
  }

  if (!json && lastErr) {
    const s = Number((lastErr as any)?.status || 0);
    const m = String((lastErr as any)?.message || '').toLowerCase();
    const b = String((lastErr as any)?.body || '').toLowerCase();
    
    console.warn(`[Harvester-API] ClusterNetwork列表获取失败: 最终错误=${m} 状态码=${s}`);

    if (s === 401 || m.includes('unauthorized') || b.includes('unauthorized')) return [];
    if (s === 404 || m.includes('not found') || b.includes('not found')) return [];
    throw lastErr;
  }

  const items = Array.isArray(json?.items)
    ? json?.items
    : Array.isArray(json?.data)
      ? json?.data
      : [];

  return items.map((cn: any) => ({
    ...cn,
    links: {
      view: `${origin}/apis/network.harvesterhci.io/v1beta1/clusternetworks/${cn?.metadata?.name || cn?.name || ''}`
    }
  }));
};

/**
 * 获取集群网络配置 (VlanConfigs - 用于配置 Uplink)
 * API: /apis/network.harvesterhci.io/v1beta1/vlanconfigs
 */
export const listHarvesterClusterNetworkConfigs = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/apis/network.harvesterhci.io/v1beta1/vlanconfigs`;
  let json: any = null;
  let lastErr: any = null;

  try {
    json = await getJsonOnce(url, token, insecure, true);
  } catch (e: any) {
    lastErr = e;
  }

  if (!json && lastErr) {
    const s = Number((lastErr as any)?.status || 0);
    // Ignore 404/403 (VlanConfigs might not exist in some versions or permissions)
    if (s === 404 || s === 403) return [];
    console.warn(`[Harvester-API] VlanConfigs列表获取失败: 状态码=${s}`);
    return [];
  }

  const items = Array.isArray(json?.items) ? json?.items : (Array.isArray(json?.data) ? json?.data : []);
  return items;
};

/**
 * 获取 Kube-OVN 子网列表
 */
export const listKubeOvnSubnets = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const candidates = [`${origin}/apis/kubeovn.io/v1/subnets`];
  let json: any = null;
  let lastErr: any = null;
  
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) {
        const count = Array.isArray(json?.items) ? json.items.length : (Array.isArray(json?.data) ? json.data.length : 0);
        break;
      }
    } catch (e: any) {
      console.warn(`[Harvester-API] 子网列表获取失败: 请求地址=${url} 错误=${e.message}`);
      lastErr = e;
    }
  }
  
  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    const m = String(lastErr?.message || '').toLowerCase();
    const b = String(lastErr?.body || '').toLowerCase();
    if (s === 401 || m.includes('unauthorized') || b.includes('unauthorized')) return [];
    if (s === 404 || m.includes('not found') || b.includes('not found')) return [];
    throw lastErr;
  }
  
  const items = Array.isArray(json?.items)
    ? json?.items
    : Array.isArray(json?.data)
      ? json?.data
      : [];
      
  return items.map((s: any) => ({
    ...s, // 保留原始数据
    name: s?.metadata?.name || s?.name || '',
    uid: s?.metadata?.uid || '',
    createdAt: s?.metadata?.creationTimestamp || '',
    vpc: s?.spec?.vpc || 'ovn-cluster',
    cidr: s?.spec?.cidrBlock || s?.spec?.cidr || '',
    gateway: s?.spec?.gateway || s?.spec?.gateway || '',
    protocol: s?.spec?.protocol || 'IPV4',
    nat: !!(s?.spec?.natOutgoing || s?.spec?.nat),
    allowDhcp: !!(s?.spec?.enableDhcp || s?.spec?.allowDhcp),
    private: !!s?.spec?.private,
    namespaces: Array.isArray(s?.spec?.namespaces) ? s.spec.namespaces : [],
    provider: s?.spec?.provider || '',
    vlan: s?.spec?.vlanID || s?.spec?.vlan || '',
    excludeIps: s?.spec?.excludeIps || [],
    links: {
      view: `${origin}/apis/kubeovn.io/v1/subnets/${s?.metadata?.name || s?.name || ''}`
    }
  }));
};

/**
 * 获取 Kube-OVN VPC 列表
 * 注意：会同时获取 Subnets 以便将 CIDR 映射回 VPC (因为 VPC 对象本身可能不包含完整的 CIDR 信息)
 */
export const listKubeOvnVpcs = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const candidates = [`${origin}/apis/kubeovn.io/v1/vpcs`];
  let json: any = null;
  let lastErr: any = null;
  
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) {
        const count = Array.isArray(json?.items) ? json.items.length : (Array.isArray(json?.data) ? json.data.length : 0);
        break;
      }
    } catch (e: any) {
      console.warn(`[Harvester-API] VPC列表获取失败: 请求地址=${url} 错误=${e.message}`);
      lastErr = e;
    }
  }
  
  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    const m = String(lastErr?.message || '').toLowerCase();
    const b = String(lastErr?.body || '').toLowerCase();
    if (s === 401 || m.includes('unauthorized') || b.includes('unauthorized')) return [];
    if (s === 404 || m.includes('not found') || b.includes('not found')) return [];
    throw lastErr;
  }
  
  const items = Array.isArray(json?.items)
    ? json?.items
    : Array.isArray(json?.data)
      ? json?.data
      : [];

  // 获取子网以映射 CIDR 到 VPC
  let subnets: any[] = [];
  try {
    subnets = await listKubeOvnSubnets({ endpoint, token, insecure });
  } catch (e) {
    console.warn('[listKubeOvnVpcs] Failed to fetch subnets for CIDR mapping:', e);
  }
  
  // 构建 VPC -> CIDR[] 映射表
  const vpcCidrs = new Map<string, string[]>();
  for (const s of subnets) {
    const v = String(s.vpc || '').trim();
    if (v && s.cidr) {
      if (!vpcCidrs.has(v)) vpcCidrs.set(v, []);
      vpcCidrs.get(v)?.push(s.cidr);
    }
  }

  return items.map((v: any) => {
    const name = v?.metadata?.name || v?.name || '';
    const cidrs = vpcCidrs.get(name) || [];
    return {
      ...v, // 保留原始数据
      name,
      uid: v?.metadata?.uid || '',
      cidr: cidrs.join(', '),
      namespaces: Array.isArray(v?.spec?.namespaces) ? v.spec.namespaces : [],
      standalone: !!v?.spec?.standalone,
      staticRoutes: Array.isArray(v?.spec?.staticRoutes) ? v.spec.staticRoutes.length : 0,
      createdAt: v?.metadata?.creationTimestamp || '',
      links: {
        view: `${origin}/apis/kubeovn.io/v1/vpcs/${v?.metadata?.name || v?.name || ''}`
      }
    };
  });
};

/**
 * 获取 Harvester 负载均衡器 (Load Balancers)
 */
export const listHarvesterLoadBalancers = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  // 兼容不同的 LoadBalancer API 组/版本
  const candidates = [
    `${origin}/v1/harvester/loadbalancer.harvesterhci.io.loadbalancers`,
    `${origin}/apis/loadbalancer.harvesterhci.io/v1beta1/loadbalancers`,
  ];
  let json: any = null;
  let lastErr: any = null;
  
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      console.warn(`[Harvester-API] 负载均衡器获取失败: 请求地址=${url} 错误=${e.message}`);
      lastErr = e;
    }
  }
  
  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    const m = String(lastErr?.message || '').toLowerCase();
    if (s === 404 || m.includes('not found')) return [];
    throw lastErr;
  }
  
  const items = Array.isArray(json?.items)
    ? json?.items
    : Array.isArray(json?.data)
      ? json?.data
      : [];
  return items;
};

/**
 * 获取 Kube-OVN Provider Networks 列表
 */
export const listKubeOvnProviderNetworks = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [`${origin}/apis/kubeovn.io/v1/provider-networks`];
  let json: any = null;
  let lastErr: any = null;

  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }

  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    if (s !== 404 && s !== 401) throw lastErr;
    return [];
  }

  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 创建 Kube-OVN Provider Network
 */
export const createKubeOvnProviderNetwork = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/apis/kubeovn.io/v1/provider-networks`;
  
  const body = {
    apiVersion: 'kubeovn.io/v1',
    kind: 'ProviderNetwork',
    metadata: {
      name: payload.name,
    },
    spec: payload.spec || {
      defaultInterface: payload.defaultInterface,
      customInterfaces: payload.customInterfaces || [],
      exchangeLinkName: payload.exchangeLinkName || false,
    }
  };

  return await requestJson('POST', url, token, insecure, body);
};

/**
 * 获取 Kube-OVN Vlan 列表
 */
export const listKubeOvnVlans = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const candidates = [`${origin}/apis/kubeovn.io/v1/vlans`];
  let json: any = null;
  let lastErr: any = null;

  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }

  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    if (s !== 404 && s !== 401) throw lastErr;
    return [];
  }

  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 创建 Kube-OVN Vlan
 */
export const createKubeOvnVlan = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/apis/kubeovn.io/v1/vlans`;
  
  const body = {
    apiVersion: 'kubeovn.io/v1',
    kind: 'Vlan',
    metadata: {
      name: payload.name,
    },
    spec: payload.spec || {
      id: payload.id || 0,
      provider: payload.provider,
    }
  };

  return await requestJson('POST', url, token, insecure, body);
};

/**
 * 创建 Kube-OVN Subnet
 */
export const createKubeOvnSubnet = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/apis/kubeovn.io/v1/subnets`;
  
  const body = {
    apiVersion: 'kubeovn.io/v1',
    kind: 'Subnet',
    metadata: {
      name: payload.name,
      annotations: payload.annotations,
    },
    spec: payload.spec || {
      cidrBlock: payload.cidrBlock,
      gateway: payload.gateway,
      excludeIps: payload.excludeIps || [],
      provider: payload.provider || 'ovn',
      gatewayType: payload.gatewayType || 'distributed',
      natOutgoing: payload.natOutgoing !== undefined ? payload.natOutgoing : false,
      vlan: payload.vlan || '',
      protocol: payload.protocol || 'IPv4',
      namespaces: payload.namespaces || [],
    }
  };

  return await requestJson('POST', url, token, insecure, body);
};

/**
 * 创建 Kube-OVN EIP
 */
export const createKubeOvnEip = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/apis/kubeovn.io/v1/ovn-eips`;
  
  const body = {
    apiVersion: 'kubeovn.io/v1',
    kind: 'OvnEip',
    metadata: {
      name: payload.name,
    },
    spec: payload.spec || {
      externalSubnet: payload.externalSubnet,
      v4Ip: payload.v4Ip,
      v6Ip: payload.v6Ip,
    }
  };

  return await requestJson('POST', url, token, insecure, body);
};

/**
 * 创建 Kube-OVN VPC
 */
export const createKubeOvnVpc = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/apis/kubeovn.io/v1/vpcs`;
  
  const body = {
    apiVersion: 'kubeovn.io/v1',
    kind: 'Vpc',
    metadata: {
      name: payload.name,
      annotations: payload.annotations,
    },
    spec: {
      namespaces: payload.namespaces || [],
      staticRoutes: payload.staticRoutes || [],
    }
  };

  return await requestJson('POST', url, token, insecure, body);
};

/**
 * 删除 Kube-OVN VPC
 */
export const deleteKubeOvnVpc = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(name)}`;
  return await requestJson('DELETE', url, token, insecure);
};

/**
 * 更新 Kube-OVN VPC
 * 采用 "Get -> Merge -> Update" 模式
 */
export const updateKubeOvnVpc = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // 1. Get current VPC
  const getUrl = `${origin}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(name)}`;
  const current = await getJsonOnce(getUrl, token, insecure);
  if (!current) {
    throw new Error(`VPC ${name} not found`);
  }

  // 2. Merge Payload
  const { annotations, ...specPayload } = payload;
  
  const updated = {
    ...current,
    metadata: {
      ...current.metadata,
      annotations: {
        ...(current.metadata?.annotations || {}),
        ...(annotations || {}),
      }
    },
    spec: {
      ...current.spec,
      ...specPayload,
    }
  };

  // 3. Execute Update (PUT)
  const putUrl = `${origin}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(name)}`;
  return await requestJson('PUT', putUrl, token, insecure, updated);
};

/**
 * 创建 Harvester 负载均衡器
 */
export const createHarvesterLoadBalancer = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  payload: any,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const ns = payload.namespace || 'default';
  // 优先使用 v1beta1 API
  const url = `${origin}/apis/loadbalancer.harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/loadbalancers`;
  
  // 构造标准 K8s CRD Payload
  const body = {
    apiVersion: 'loadbalancer.harvesterhci.io/v1beta1',
    kind: 'LoadBalancer',
    metadata: {
      name: payload.name,
      namespace: ns,
      annotations: payload.annotations,
      labels: payload.labels,
    },
    spec: payload.spec || {
        description: payload.description,
        ipam: payload.ipam || 'pool', // default to pool
        listeners: payload.listeners || [],
                workloadType: payload.workloadType || 'vm',
                backendServerSelector: payload.backendServerSelector || {},
                healthCheck: payload.healthCheck, // optional
            }
  };

  return await requestJson('POST', url, token, insecure, body);
};

/**
 * 获取 Kube-OVN EIP 列表
 */
export const listKubeOvnEips = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const candidates = [`${origin}/apis/kubeovn.io/v1/ovn-eips`];
  let json: any = null;
  let lastErr: any = null;
  
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  
  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    if (s !== 404 && s !== 401) throw lastErr;
    return [];
  }
  
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 获取 Kube-OVN FIP 列表
 */
export const listKubeOvnFips = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const candidates = [`${origin}/apis/kubeovn.io/v1/ovn-fips`];
  let json: any = null;
  let lastErr: any = null;
  
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  
  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    if (s !== 404 && s !== 401) throw lastErr;
    return [];
  }
  
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 获取 Kube-OVN SNAT 规则列表
 */
export const listKubeOvnSnatRules = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const candidates = [`${origin}/apis/kubeovn.io/v1/ovn-snat-rules`];
  let json: any = null;
  let lastErr: any = null;
  
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  
  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    if (s !== 404 && s !== 401) throw lastErr;
    return [];
  }
  
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 获取 Kube-OVN DNAT 规则列表
 */
export const listKubeOvnDnatRules = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const candidates = [`${origin}/apis/kubeovn.io/v1/ovn-dnat-rules`];
  let json: any = null;
  let lastErr: any = null;
  
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  
  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    if (s !== 404 && s !== 401) throw lastErr;
    return [];
  }
  
  return Array.isArray(json?.items) ? json.items : [];
};



/**
 * 获取 Harvester 负载均衡 IP 池 (Load Balancer IP Pools)
 */
export const listHarvesterLoadBalancerIPPools = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const candidates = [
    `${origin}/v1/harvester/loadbalancer.harvesterhci.io.ippools`,
    `${origin}/apis/loadbalancer.harvesterhci.io/v1beta1/ippools`,
  ];
  let json: any = null;
  let lastErr: any = null;
  
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  
  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    const m = String(lastErr?.message || '').toLowerCase();
    if (s === 404 || m.includes('not found')) return [];
    // Allow partial failure
    return [];
  }
  
  const items = Array.isArray(json?.items)
    ? json?.items
    : Array.isArray(json?.data)
      ? json?.data
      : [];
  return items;
};

/**
 * 获取 K8s Ingress 列表
 */
export const listHarvesterIngressesStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const candidates = [
    `${origin}/apis/networking.k8s.io/v1/ingresses`,
    `${origin}/v1/harvester/networking.k8s.io.ingresses`,
  ];
  let json: any = null;
  let lastErr: any = null;
  
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  
  if (!json && lastErr) {
    const s = Number(lastErr?.status || 0);
    if (s !== 404 && s !== 401) throw lastErr;
  }
  
  const items = Array.isArray(json?.items)
    ? json?.items
    : Array.isArray(json?.data)
      ? json?.data
      : [];
  return items;
};

