import { HarvesterTestParams } from './types';
import { requestOnce, getJsonOnce, requestJson } from './utils';

// ====================================================================================================
// 文件路径: backend/src/services/clouds/harvester/cluster.ts
// 模块名称: Harvester Cluster & Node Service (Harvester 集群与节点服务)
// 功能描述: 提供 Harvester 集群级别的核心操作，包括连接性测试、节点信息标准化、健康检查聚合及全局设置管理。
// 
// [核心逻辑]
// 1. 连接测试: 多路径探测 (/v1, /v3) 以适应不同版本的 Harvester API 网关。
// 2. 节点标准化: 将 K8s Node 与 Harvester Host CRD 数据合并，并集成 LinkMonitor 获取物理网卡信息。
// 3. 健康检查: 聚合计算、存储、网络等关键组件的 API 可达性状态。
// 4. 全局设置: 读写 Harvester Settings (如 http-proxy, overcommit-config 等)。
// 
// [API 引用]
// - GET /v1/nodes (Harvester Host CR)
// - GET /apis/network.harvesterhci.io/v1beta1/linkmonitors (物理网卡监控)
// - GET /v1/harvester/harvesterhci.io.settings (全局设置)
// ====================================================================================================

/**
 * 测试 Harvester 控制面是否可达以及 Token 是否有效
 * [功能描述]
 * 尝试访问 Harvester 的多个入口路径，验证 API 连通性和认证状态。
 * 
 * [核心逻辑]
 * 1. [路径规范化] 处理用户输入的 Endpoint，移除尾部斜杠，提取 Origin。
 * 2. [多路径探测] 依次尝试 Base URL, /v1, /v3，只要有一个返回 2xx 即视为成功。
 * 3. [错误处理] 区分网络错误、认证错误 (401) 和其他 HTTP 错误。
 */
export const testHarvesterConnection = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<{ ok: boolean; message?: string }> => {
  try {
    // [路径规范化]
    const base = (endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    
    // [多路径探测] 兼容不同版本的 API 路由策略
    const candidates: string[] = [];
    candidates.push(base);
    candidates.push(`${origin}/v1`);
    candidates.push(`${origin}/v3`);

    let lastStatus: number | undefined;
    for (const url of candidates) {
      const res = await requestOnce(url, token, insecure);
      if (res.ok) {
        return { ok: true, message: 'Harvester 接口连通' };
      }
      lastStatus = res.status;
      if (!res.status && (res.code || res.error)) {
        const code = res.code ? ` (${res.code})` : '';
        return { ok: false, message: `Harvester 连接失败：${res.error || '未知错误'}${code}` };
      }
    }
    return { ok: false, message: `Harvester 接口返回异常：HTTP ${lastStatus ?? '未知'}` };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Harvester 接口测试失败' };
  }
};

/**
 * 获取 Harvester 节点（Host）标准化列表
 * [功能描述]
 * 获取集群节点列表，并补充物理网络、IP 地址和状态信息。
 * 
 * [核心逻辑]
 * 1. [节点获取] 调用 /v1/nodes 获取 Harvester Host CR 列表。
 * 2. [LinkMonitor聚合] 并发获取 LinkMonitor 数据，用于提取真实的物理网卡 (Physical Interface) 名称。
 * 3. [网卡状态提取] 从 LinkMonitor 数据中提取网卡状态信息 (operState/state)，用于前端过滤 down 状态的网卡。
 * 4. [数据标准化] 
 *    - 优先使用 Harvester Host CR 的 networkIps。
 *    - 回退使用 K8s Node Status addresses。
 *    - 过滤 device 类型的物理网卡，排除 veth/ovn 等虚拟接口。
 *    - 返回网卡状态映射 (interfaceStatusMap)，供前端过滤使用。
 */
export const listHarvesterNodesStandard = async ({
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
  
  // [集群ID获取] 尝试获取 Cluster ID (部分 API 路径需要)
  const clusterId = await (async () => {
    try {
      const url = `${origin}/v3/clusters`;
      const json = await getJsonOnce(url, token, insecure, true);
      const items = Array.isArray(json?.data)
        ? json?.data
        : Array.isArray(json?.items)
          ? json?.items
          : [];
      const local = items.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
      const any = items[0];
      return String(local?.id || local?.Id || any?.id || any?.Id || '')?.trim() || null;
    } catch {
      return null;
    }
  })();

  // [节点列表获取]
  const url = `${origin}/v1/nodes`;
  let json: any = null;
  let lastErr: any = null;
  try {
    json = await getJsonOnce(url, token, insecure, true);
  } catch (e: any) {
    lastErr = e;
    console.warn(`[Harvester-API] 节点获取失败: 请求地址=${url} 错误=${e.message}`);
  }

  // [LinkMonitor聚合] 尝试获取 LinkMonitor 以补充物理网卡信息
  // 这是识别节点物理网卡的关键步骤，用于 Provider Network 配置
  let linkMonitors: any[] = [];
  try {
    const lmUrl = `${origin}/apis/network.harvesterhci.io/v1beta1/linkmonitors`;
    const lmJson = await getJsonOnce(lmUrl, token, insecure);
    linkMonitors = Array.isArray(lmJson?.items) ? lmJson.items : [];
  } catch (e) {
    // 忽略 LinkMonitor 获取失败，可能是权限或版本问题
    console.warn('[Harvester-API] LinkMonitor 获取失败 (忽略):', e);
  }

  // [错误处理] 
  if (!json && lastErr) {
    const status = Number((lastErr as any)?.status || 0);
    const body = String((lastErr as any)?.body || '').toLowerCase();
    const msg = String((lastErr as any)?.message || '').toLowerCase();
    if (status === 401 || msg.includes('unauthorized') || body.includes('unauthorized')) {
      return [];
    }
    if (status === 404 || msg.includes('not found') || body.includes('not found')) {
      return [];
    }
    throw lastErr;
  }
  
  const items = Array.isArray(json?.data) ? json?.data : (Array.isArray(json?.items) ? json?.items : []);
  
  // [数据映射] 遍历节点进行标准化处理
  return items.map((n: any) => {
    // Harvester Host object wraps the Node name in spec.nodeName or metadata.name depending on context
    const name = n?.metadata?.name || n?.name || '';
    
    // [IP地址解析] 优先使用 networkIps，回退到 K8s addresses
    let internal = '';
    let external = '';
    
    const networkIps = Array.isArray(n?.status?.networkIps) ? n?.status?.networkIps : [];
    if (networkIps.length > 0) {
        internal = networkIps[0]; // Assume first is internal
    }
    
    if (!internal) {
        const addresses = Array.isArray(n?.status?.addresses) ? n?.status?.addresses : [];
        internal = addresses.find((a: any) => a?.type === 'InternalIP')?.address || '';
        external = addresses.find((a: any) => a?.type === 'ExternalIP')?.address || '';
    }
    
    const roles = Object.keys(n?.metadata?.labels || {}).filter((k) =>
      /node-role\.kubernetes\.io/.test(k),
    );
    
    const conds = Array.isArray(n?.status?.conditions) ? n?.status?.conditions : [];
    const readyCond = conds.find((c: any) => c?.type === 'Ready');
    
    const cpu = n?.status?.capacity?.cpu || n?.status?.allocatable?.cpu || '';
    const memory = n?.status?.capacity?.memory || n?.status?.allocatable?.memory || '';
    const version = n?.status?.nodeInfo?.kubeletVersion || n?.status?.nodeInfo?.kubeProxyVersion || '';
    const architecture = n?.status?.nodeInfo?.architecture || 'amd64';
    
    const selfLink = n?.links?.self || `${url}/${name}`;
    const viewLink = n?.links?.view || selfLink;

    // [物理网卡提取] 从 LinkMonitor 中匹配物理网卡信息
    let physicalInterfaces: string[] = [];
    const interfaceSet = new Set<string>();
    // [网卡状态映射] 存储网卡名称到状态的映射，用于前端过滤 down 状态的网卡
    const interfaceStatusMap: Record<string, string> = {};
    
    // 遍历所有 LinkMonitor (如 mgmt, nic)，查找包含当前节点信息的条目
    // LinkMonitor Status 结构: { "node-name": [ { type: "device", name: "eth0", operState: "up"/"down", ... }, ... ] }
    linkMonitors.forEach((lm: any) => {
        if (lm?.status?.linkStatus && lm.status.linkStatus[name]) {
            const ifaces = lm.status.linkStatus[name];
            if (Array.isArray(ifaces)) {
                ifaces.forEach((i: any) => {
                    // [过滤逻辑] 仅收集物理设备 (type=device)
                    if (i.type === 'device') {
                        interfaceSet.add(i.name);
                        // [状态提取] 尝试提取网卡状态（operState 或 state 字段）
                        // 常见字段名：operState, state, linkState, status
                        const state = i.operState || i.state || i.linkState || i.status || '';
                        if (state) {
                            interfaceStatusMap[i.name] = String(state).toLowerCase();
                        }
                    }
                });
            }
        }
    });
    
    physicalInterfaces = Array.from(interfaceSet).sort();

    // [回退逻辑] 如果 LinkMonitor 没有数据，回退到 NodeInfo (旧逻辑)
    if (physicalInterfaces.length === 0 && n?.status?.nodeInfo?.networkInfo?.links) {
      physicalInterfaces = n.status.nodeInfo.networkInfo.links.map((l: any) => l.name);
      // 尝试从 NodeInfo 中提取状态信息
      n.status.nodeInfo.networkInfo.links.forEach((l: any) => {
        if (l.operState || l.state) {
          interfaceStatusMap[l.name] = String(l.operState || l.state).toLowerCase();
        }
      });
    }

    return {
      ...n,
      name,
      roles,
      internalIP: internal,
      externalIP: external,
      ready: readyCond?.status === 'True',
      cpu,
      memory,
      version,
      architecture,
      physicalInterfaces, // 新增物理网卡字段，供 Provider Network 配置使用
      interfaceStatusMap, // 新增网卡状态映射，用于前端过滤 down 状态的网卡
      links: { ...n.links, view: viewLink }
    };
  });
};

/**
 * Harvester 健康检查
 * [功能描述]
 * 聚合多条关键探针（计算、存储、网络）的状态，用于 UI 上的“健康检查”页签展示。
 * 
 * [核心逻辑]
 * 1. [探针定义] 定义一组关键 API 路径 (Nodes, VMs, Images, StorageClasses, Volumes, NADs, VPCs)。
 * 2. [集群ID适配] 如果存在 Cluster ID，追加 Rancher 代理路径的探测。
 * 3. [状态探测] 对每个探针执行 requestOnce，记录 HTTP 状态码和错误信息。
 */
export const harvesterHealthCheck = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<{
  items: Array<{
    key: string;
    label: string;
    url: string;
    ok: boolean;
    status?: number;
    error?: string;
    group?: string;
    purpose?: string;
  }>;
}> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const clusterId = await (async () => {
    try {
      return null;
    } catch {
      return null;
    }
  })();
  
  // [探针定义]
  const tests: Array<{
    key: string;
    label: string;
    group: string;
    purpose: string;
    candidates: string[];
  }> = [
    {
      key: 'nodes',
      label: '节点',
      group: '基础连通性',
      purpose: '读取节点列表用于节点页签与分组',
      candidates: [
        `${origin}/v1/harvester/harvesterhci.io.host`,
      ],
    },
    {
      key: 'vms',
      label: '虚拟机（VM）',
      group: '虚拟化',
      purpose: '读取虚拟机对象列表用于云主机页',
      candidates: [`${origin}/v1/harvester/kubevirt.io.virtualmachines`],
    },
    {
      key: 'vmis',
      label: '虚拟机实例（VMI）',
      group: '虚拟化',
      purpose: '读取虚拟机实例状态用于运行态关联',
      candidates: [`${origin}/v1/harvester/kubevirt.io.virtualmachineinstances`],
    },
    {
      key: 'images',
      label: '镜像',
      group: '虚拟化',
      purpose: '读取虚拟机镜像用于创建向导',
      candidates: [
        `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages`,
        `${origin}/v1/harvester/harvesterhci.io.images`,
      ],
    },
    {
      key: 'storageClasses',
      label: '存储类（StorageClass）',
      group: '存储',
      purpose: '读取存储类用于磁盘/卷选择',
      candidates: [
        `${origin}/v1/storage.k8s.io.storageclasses`,
        `${origin}/v1/harvester/storage.k8s.io.storageclasses`,
        `${origin}/apis/storage.k8s.io/v1/storageclasses`,
      ],
    },
    {
      key: 'volumes',
      label: '卷（Longhorn）',
      group: '存储',
      purpose: '读取 Longhorn 卷用于卷列表',
      candidates: [
        `${origin}/v1/longhorn.io.volumes`,
        `${origin}/apis/longhorn.io/v1beta1/volumes`,
      ],
    },
    {
      key: 'nads',
      label: '网络（NAD）',
      group: '网络',
      purpose: '读取 Multus NAD 用于网络配置',
      candidates: [
        `${origin}/v1/k8s.cni.cncf.io.networkattachmentdefinitions`,
        `${origin}/v1/cni.cncf.io.networkattachmentdefinitions`,
        `${origin}/v1/k8s.cni.cncf.io.network-attachment-definitions`,
        `${origin}/apis/k8s.cni.cncf.io/v1/network-attachment-definitions`,
      ],
    },
    {
      key: 'kubeovn-vpcs',
      label: 'VPC（Kube-OVN）',
      group: '网络',
      purpose: '读取 Kube-OVN VPC 网络',
      candidates: [`${origin}/apis/kubeovn.io/v1/vpcs`],
    },
    {
      key: 'kubeovn-subnets',
      label: '子网（Kube-OVN）',
      group: '网络',
      purpose: '读取 Kube-OVN 子网',
      candidates: [`${origin}/apis/kubeovn.io/v1/subnets`],
    },
  ];

  if (clusterId) {
    tests.unshift({
      key: 'nodes',
      label: '节点',
      group: '基础连通性',
      purpose: '读取节点列表用于节点页签与分组',
      candidates: [`${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/nodes`],
    });
    tests.push({
      key: 'kubeovn-vpcs',
      label: 'VPC（Kube-OVN）',
      group: '网络',
      purpose: '读取 Kube-OVN VPC 网络',
      candidates: [
        `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubeovn.io/v1/vpcs`,
      ],
    });
    tests.push({
      key: 'kubeovn-subnets',
      label: '子网（Kube-OVN）',
      group: '网络',
      purpose: '读取 Kube-OVN 子网',
      candidates: [
        `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubeovn.io/v1/subnets`,
      ],
    });
    tests.push({
      key: 'nads',
      label: '网络（NAD）',
      group: '网络',
      purpose: '读取 Multus NAD 用于网络配置',
      candidates: [
        `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/k8s.cni.cncf.io/v1/network-attachment-definitions`,
      ],
    });
  }
  const items: Array<{
    key: string;
    label: string;
    url: string;
    ok: boolean;
    status?: number;
    error?: string;
    group?: string;
    purpose?: string;
  }> = [];
  
  // [状态探测] 串行执行探测
  for (const t of tests) {
    let ok = false;
    let usedUrl = '';
    let status: number | undefined = undefined;
    let lastStatus: number | undefined = undefined;
    let lastError: string | undefined = undefined;
    for (const u of t.candidates) {
      const r = await requestOnce(u, token, insecure);
      if (!usedUrl) usedUrl = u;
      if (r?.ok) {
        ok = true;
        usedUrl = u;
        status = r?.status;
        break;
      }
      lastStatus = r?.status;
      lastError = r?.error;
    }
    items.push({
      key: t.key,
      label: t.label,
      url: usedUrl,
      ok,
      status: status ?? lastStatus,
      error: ok ? undefined : lastError,
      group: t.group,
      purpose: t.purpose,
    });
  }
  return { items };
};

/**
 * 获取 Harvester 集群能力与配置
 * [功能描述]
 * 推断集群架构（x86/ARM）并推荐合适的虚拟机机型配置。
 * 
 * [核心逻辑]
 * 1. [架构检测] 通过节点列表的 architecture 字段判断 (amd64 vs arm64)。
 * 2. [机型推荐] x86 推荐 q35, ARM 推荐 virt。
 */
export const getHarvesterCapabilities = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<{
  architecture: string;
  recommendedMachineType: string;
  version?: string;
}> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  // [架构检测] Detect Architecture from Nodes
  let architecture = 'amd64'; // default
  try {
    const nodes = await listHarvesterNodesStandard({ endpoint, token, insecure });
    if (nodes.length > 0) {
      const arch = nodes[0]?.architecture;
      if (arch) architecture = arch;
    }
  } catch (e) {
    console.warn('Failed to detect Harvester architecture:', e);
  }

  // [机型推荐] Determine Recommended Machine Type
  let recommendedMachineType = 'q35';
  if (architecture === 'arm64' || architecture === 'aarch64') {
    recommendedMachineType = 'virt';
  } else {
    // x86_64 / amd64
    // Harvester default is usually q35
    recommendedMachineType = 'q35'; 
  }

  return {
    architecture,
    recommendedMachineType,
  };
};

/**
 * 获取 Harvester Service 列表
 * [功能描述]
 * 获取集群内的 Service 资源，优先使用 Steve API 以获得更丰富的元数据。
 */
export const listHarvesterServices = async ({
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
  // Use Steve API to get full metadata including links
  const url = `${origin}/v1/services`;
  
  try {
    const json = await getJsonOnce(url, token, insecure, true);
    const items = Array.isArray(json?.data) ? json?.data : (Array.isArray(json?.items) ? json?.items : []);
    
    return items.map((s: any) => {
      // Ensure we don't discard any data from the backend
      // Return the original object enriched with our specific fields if needed
      // But Steve API objects already have metadata, spec, status, links
      return s;
    });
  } catch (e) {
    // Fallback to K8s API if Steve API fails
    console.warn('[listHarvesterServices] Steve API failed, falling back to K8s API:', e);
    const k8sUrl = `${origin}/api/v1/services`;
    const json = await getJsonOnce(k8sUrl, token, insecure);
    const items = Array.isArray(json?.items) ? json?.items : [];
    
    return items.map((s: any) => {
        // Even in fallback, preserve the original object
        return {
            ...s,
            // Polyfill links for UI compatibility if missing
            links: s.links || {
                view: `${origin}/api/v1/namespaces/${s.metadata?.namespace}/services/${s.metadata?.name}`
            }
        };
    });
  }
};

/**
 * 获取 Harvester StorageClass 列表
 * [功能描述]
 * 获取存储类列表，并手动构造前端所需的 view/self 链接。
 */
export const listHarvesterStorageClassesStandard = async ({
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
  const url = `${origin}/apis/storage.k8s.io/v1/storageclasses`;
  const json = await getJsonOnce(url, token, insecure);
  const items = Array.isArray(json?.items) ? json.items : [];
  
  return items.map((sc: any) => {
    // K8s native API does not return links, so we manually construct them
    // Steve API path: /v1/harvester/storage.k8s.io.storageclasses/{name}
    // But for view link, we usually point to the K8s API self link or similar
    const name = sc?.metadata?.name || '';
    const selfLink = sc?.metadata?.selfLink || `${url}/${name}`;
    
    // Construct a view link compatible with our frontend expectations
    // Ideally this should point to a resource URL that can be fetched
    const viewLink = `${origin}/apis/storage.k8s.io/v1/storageclasses/${name}`;

    return {
      ...sc,
      links: sc.links || {
        self: selfLink,
        view: viewLink
      }
    };
  });
};

/**
 * 获取所有 Harvester Settings (Raw)
 * [功能描述]
 * 获取 harvesterhci.io.settings CRD 的原始列表，包含所有系统设置。
 */
export const listHarvesterSettingsRaw = async ({
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
  const url = `${origin}/v1/harvester/harvesterhci.io.settings`;
  const json = await getJsonOnce(url, token, insecure, true);
  const items = Array.isArray(json?.data) ? json?.data : (Array.isArray(json?.items) ? json?.items : []);
  return items;
};

/**
 * 获取单个 Harvester Setting (Raw)
 * [功能描述]
 * 根据名称获取特定设置的详细 CRD 对象。
 */
export const getHarvesterSettingRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams, name: string): Promise<any | null> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/v1/harvester/harvesterhci.io.settings/${encodeURIComponent(name)}`;
  try {
    const json = await getJsonOnce(url, token, insecure, true);
    return json;
  } catch {
    return null;
  }
};

/**
 * 获取单个 Harvester Setting 的值
 * [功能描述]
 * 获取特定设置的值（value 或 spec.value），并统一转为字符串。
 */
export const getHarvesterSettingValue = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams, name: string): Promise<string | null> => {
  const s = await getHarvesterSettingRaw({ endpoint, token, insecure }, name);
  const val = (s as any)?.value ?? (s as any)?.spec?.value ?? null;
  return typeof val === 'string' ? val : (val != null ? String(val) : null);
};

/**
 * 更新 Harvester Setting 的值
 * [功能描述]
 * 更新系统设置。如果未提供 resourceVersion，会先获取当前版本以避免冲突。
 * 
 * [核心逻辑]
 * 1. [版本并发控制] 检查 resourceVersion，若缺失则自动 fetch latest。
 * 2. [原子更新] 发送 PUT 请求更新 settings CRD。
 */
export const updateHarvesterSettingValue = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams, name: string, value: string, resourceVersion?: string): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  let rv = resourceVersion;
  if (!rv) {
    const current = await getHarvesterSettingRaw({ endpoint, token, insecure }, name);
    rv = (current as any)?.metadata?.resourceVersion || (current as any)?.resourceVersion || undefined;
  }
  const url = `${origin}/v1/harvester/harvesterhci.io.settings/${encodeURIComponent(name)}`;
  const body = {
    metadata: {
      name,
      resourceVersion: rv,
    },
    value,
  };
  return await requestJson('PUT', url, token, insecure, body, { 'Content-Type': 'application/json' });
};
