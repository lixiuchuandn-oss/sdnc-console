import { HarvesterTestParams } from './types';
import { requestOnce, getJsonOnce, requestJson } from './utils';

export const testHarvesterConnection = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<{ ok: boolean; message?: string }> => {
  try {
    const base = (endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
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
  const url = `${origin}/v1/nodes`;
  let json: any = null;
  let lastErr: any = null;
  try {
    json = await getJsonOnce(url, token, insecure, true);
  } catch (e: any) {
    lastErr = e;
    console.warn(`[Harvester-API] 节点获取失败: 请求地址=${url} 错误=${e.message}`);
  }
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
  return items.map((n: any) => {
    // Harvester Host object wraps the Node name in spec.nodeName or metadata.name depending on context
    // The Host object itself is NOT the Node object, but it references it.
    // However, usually metadata.name of the Host CR IS the node name.
    const name = n?.metadata?.name || n?.name || '';
    
    // Harvester Host CR does NOT have status.addresses directly. 
    // It has status.networkIps (array of strings) usually.
    // But we need to maintain compatibility with our inventory entity.
    
    const roles = Object.keys(n?.metadata?.labels || {}).filter((k) =>
      /node-role\.kubernetes\.io/.test(k),
    );
    
    const conds = Array.isArray(n?.status?.conditions) ? n?.status?.conditions : [];
    const readyCond = conds.find((c: any) => c?.type === 'Ready');
    
    let internal = '';
    let external = '';
    
    // Try to find IPs from Harvester Host structure
    const networkIps = Array.isArray(n?.status?.networkIps) ? n?.status?.networkIps : [];
    if (networkIps.length > 0) {
        internal = networkIps[0]; // Assume first is internal
    }
    
    // Fallback to standard K8s structure if Harvester Host structure is missing (hybrid clusters?)
    if (!internal) {
        const addresses = Array.isArray(n?.status?.addresses) ? n?.status?.addresses : [];
        internal = addresses.find((a: any) => a?.type === 'InternalIP')?.address || '';
        external = addresses.find((a: any) => a?.type === 'ExternalIP')?.address || '';
    }
    
    const cpu = n?.status?.capacity?.cpu || n?.status?.allocatable?.cpu || '';
    const memory = n?.status?.capacity?.memory || n?.status?.allocatable?.memory || '';
    
    // Host CR might not have nodeInfo directly in status.
    const version =
      n?.status?.nodeInfo?.kubeletVersion || n?.status?.nodeInfo?.kubeProxyVersion || '';
    const architecture = n?.status?.nodeInfo?.architecture || 'amd64';
    
    // Ensure links.view exists for frontend data fetching (HarvesterResourceDrawer)
    // Use existing view link, or fallback to self link, or construct from API URL
    const selfLink = n?.links?.self || `${url}/${name}`;
    const viewLink = n?.links?.view || selfLink;

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
      links: { ...n.links, view: viewLink }
    };
  });
};

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

  // 1. Detect Architecture from Nodes
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

  // 2. Determine Recommended Machine Type
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

export const createHarvesterNamespace = async (
    { endpoint, token, insecure = false }: HarvesterTestParams,
    name: string,
    annotations?: Record<string, string>
): Promise<any> => {
    const base = (endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    const url = `${origin}/api/v1/namespaces`;
    const body = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
            name: name,
            annotations: annotations,
        }
    };
    return requestJson('POST', url, token, insecure, body);
};

export const deleteHarvesterNamespace = async (
    { endpoint, token, insecure = false }: HarvesterTestParams,
    name: string
): Promise<any> => {
    const base = (endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    const url = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;
    return requestJson('DELETE', url, token, insecure);
};

export const listHarvesterNamespacesRaw = async (
    { endpoint, token, insecure = false }: HarvesterTestParams
): Promise<any[]> => {
    const base = (endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    
    // Try Steve API first to get links
    const url = `${origin}/v1/namespaces`;
    try {
        const json = await getJsonOnce(url, token, insecure, true);
        const items = Array.isArray(json?.data) ? json?.data : (Array.isArray(json?.items) ? json?.items : []);
        return items;
    } catch (e) {
        // Fallback to K8s API
        console.warn('[listHarvesterNamespacesRaw] Steve API failed, falling back to K8s API:', e);
        const k8sUrl = `${origin}/api/v1/namespaces`;
        const json = await getJsonOnce(k8sUrl, token, insecure);
        const items = Array.isArray(json?.items) ? json.items : [];
        // Polyfill links if missing
        return items.map((item: any) => ({
            ...item,
            links: item.links || {
                view: `${origin}/api/v1/namespaces/${item.metadata?.name}`,
                self: `${origin}/api/v1/namespaces/${item.metadata?.name}`
            }
        }));
    }
};

export const getHarvesterNamespaceRaw = async (
    { endpoint, token, insecure = false }: HarvesterTestParams,
    name: string
): Promise<any> => {
    const base = (endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    const url = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;
    return getJsonOnce(url, token, insecure);
};
