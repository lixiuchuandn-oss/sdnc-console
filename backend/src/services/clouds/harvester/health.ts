import { HarvesterTestParams } from './types';
import { requestOnce, getJsonOnce } from './utils';

export const testHarvesterConnection = async ({ endpoint, token, insecure = false }: HarvesterTestParams): Promise<{ ok: boolean; message?: string }> => {
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

export const listHarvesterNodesStandard = async ({ endpoint, token, insecure = false }: HarvesterTestParams): Promise<any[]> => {
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
      const json = await getJsonOnce(url, token, insecure);
      const items = Array.isArray(json?.data) ? json?.data : Array.isArray(json?.items) ? json?.items : [];
      const local = items.find((c:any)=> String(c?.id||c?.Id||'').toLowerCase()==='local');
      const any = items[0];
      return String((local?.id||local?.Id||any?.id||any?.Id||''))?.trim() || null;
    } catch { return null; }
  })();
  const candidates = [
    ...(clusterId ? [`${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/nodes`] : []),
    `${origin}/v1/core.v1.nodes`,
    `${origin}/v1/k8s.io.nodes`,
    `${origin}/api/v1/nodes`,
    `${origin}/v1/harvester/core.v1.nodes`,
    `${origin}/v1/harvester/api/v1/nodes`
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
  const items = Array.isArray(json?.data) ? json?.data : Array.isArray(json?.items) ? json?.items : [];
  return items.map((n: any) => {
    const name = n?.metadata?.name || n?.name || '';
    const roles = Object.keys(n?.metadata?.labels || {}).filter(k => /node-role\.kubernetes\.io/.test(k));
    const conds = Array.isArray(n?.status?.conditions) ? n?.status?.conditions : [];
    const readyCond = conds.find((c:any)=> c?.type === 'Ready');
    const addresses = Array.isArray(n?.status?.addresses) ? n?.status?.addresses : [];
    const internal = addresses.find((a:any)=> a?.type === 'InternalIP')?.address;
    const external = addresses.find((a:any)=> a?.type === 'ExternalIP')?.address;
    const cpu = n?.status?.capacity?.cpu || n?.status?.allocatable?.cpu || '';
    const memory = n?.status?.capacity?.memory || n?.status?.allocatable?.memory || '';
    const version = n?.status?.nodeInfo?.kubeletVersion || n?.status?.nodeInfo?.kubeProxyVersion || '';
    return {
      name,
      roles,
      internalIP: internal,
      externalIP: external,
      ready: readyCond?.status === 'True',
      cpu,
      memory,
      version
    };
  });
};

export const listHarvesterSystemPodsStandard = async ({ endpoint, token, insecure = false }: HarvesterTestParams): Promise<any[]> => {
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
      const json = await getJsonOnce(url, token, insecure);
      const items = Array.isArray(json?.data) ? json?.data : Array.isArray(json?.items) ? json?.items : [];
      const local = items.find((c:any)=> String(c?.id||c?.Id||'').toLowerCase()==='local');
      const any = items[0];
      return String((local?.id||local?.Id||any?.id||any?.Id||''))?.trim() || null;
    } catch { return null; }
  })();
  const candidates = [
    `${origin}/v1/core.v1.pods`,
    ...(clusterId ? [`${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/pods`] : [])
  ];
  let json: any = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try { json = await getJsonOnce(url, token, insecure); if (json) break; } catch (e:any) { lastErr = e; }
  }
  if (!json && lastErr) {
    const status = Number((lastErr as any)?.status || 0);
    const body = String((lastErr as any)?.body || '').toLowerCase();
    const msg = String((lastErr as any)?.message || '').toLowerCase();
    if (status === 401 || msg.includes('unauthorized') || body.includes('unauthorized')) { return []; }
    if (status === 404 || msg.includes('not found') || body.includes('not found')) { return []; }
    throw lastErr;
  }
  const items = Array.isArray(json?.data) ? json?.data : Array.isArray(json?.items) ? json?.items : [];
  const sysNs = new Set<string>(['kube-system','harvester-system','longhorn-system','cattle-system','cattle-monitoring-system','ingress-nginx','monitoring','rancher-logging']);
  const list = items.filter((p:any)=> sysNs.has(String(p?.metadata?.namespace || p?.namespace || '')));
  return list.map((p:any)=>{
    const name = p?.metadata?.name || p?.name || '';
    const phase = p?.status?.phase || '';
    const cs = Array.isArray(p?.status?.containerStatuses) ? p?.status?.containerStatuses : [];
    const total = cs.length;
    const ready = cs.filter((c:any)=> !!c?.ready).length;
    return { name, phase, ready, total };
  });
};

export const harvesterHealthCheck = async ({ endpoint, token, insecure = false }: HarvesterTestParams): Promise<{ items: Array<{ key: string; label: string; url: string; ok: boolean; status?: number; error?: string; group?: string; purpose?: string }> }> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try { const u = new URL(base); origin = `${u.protocol}//${u.host}`; } catch { origin = base.replace(/\/v[0-9].*$/, ''); }
  const clusterId = await (async () => {
    try {
      const url = `${origin}/v3/clusters`;
      const json = await getJsonOnce(url, token, insecure);
      const items = Array.isArray(json?.data) ? json?.data : Array.isArray(json?.items) ? json?.items : [];
      const local = items.find((c:any)=> String(c?.id||c?.Id||'').toLowerCase()==='local');
      const any = items[0];
      return String((local?.id||local?.Id||any?.id||any?.Id||''))?.trim() || null;
    } catch { return null; }
  })();
  const tests: Array<{ key: string; label: string; group: string; purpose: string; candidates: string[] }> = [
    { key: 'nodes', label: '节点', group: '基础连通性', purpose: '读取节点列表用于节点页签与分组', candidates: [ `${origin}/v1/core.v1.nodes`, `${origin}/v1/k8s.io.nodes`, `${origin}/api/v1/nodes` ] },
    { key: 'pods', label: '系统组件（Pods）', group: '基础连通性', purpose: '读取系统组件与Pod列表用于体检', candidates: [ `${origin}/v1/core.v1.pods`, `${origin}/api/v1/pods` ] },
    { key: 'vms', label: '虚拟机（VM）', group: '虚拟化', purpose: '读取虚拟机对象列表用于云主机页', candidates: [ `${origin}/v1/harvester/kubevirt.io.virtualmachines` ] },
    { key: 'vmis', label: '虚拟机实例（VMI）', group: '虚拟化', purpose: '读取虚拟机实例状态用于运行态关联', candidates: [ `${origin}/v1/harvester/kubevirt.io.virtualmachineinstances` ] },
    { key: 'images', label: '镜像', group: '虚拟化', purpose: '读取虚拟机镜像用于创建向导', candidates: [ `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages`, `${origin}/v1/harvester/harvesterhci.io.images` ] },
    { key: 'storageClasses', label: '存储类（StorageClass）', group: '存储', purpose: '读取存储类用于磁盘/卷选择', candidates: [ `${origin}/v1/storage.k8s.io.storageclasses`, `${origin}/v1/harvester/storage.k8s.io.storageclasses`, `${origin}/apis/storage.k8s.io/v1/storageclasses` ] },
    { key: 'volumes', label: '卷（Longhorn）', group: '存储', purpose: '读取 Longhorn 卷用于卷列表', candidates: [ `${origin}/v1/longhorn.io.volumes`, `${origin}/apis/longhorn.io/v1beta1/volumes` ] },
    { key: 'nads', label: '网络（NAD）', group: '网络', purpose: '读取 Multus NAD 用于网络配置', candidates: [ `${origin}/v1/k8s.cni.cncf.io.networkattachmentdefinitions`, `${origin}/v1/cni.cncf.io.networkattachmentdefinitions`, `${origin}/v1/k8s.cni.cncf.io.network-attachment-definitions`, `${origin}/apis/k8s.cni.cncf.io/v1/network-attachment-definitions` ] },
    { key: 'kubeovn-vpcs', label: 'VPC（Kube-OVN）', group: '网络', purpose: '读取 Kube-OVN VPC 网络', candidates: [ `${origin}/apis/kubeovn.io/v1/vpcs` ] },
    { key: 'kubeovn-subnets', label: '子网（Kube-OVN）', group: '网络', purpose: '读取 Kube-OVN 子网', candidates: [ `${origin}/apis/kubeovn.io/v1/subnets` ] },
    { key: 'metrics-pods', label: '监控（Pod 指标）', group: '监控', purpose: '读取 Pod 指标用于性能画像', candidates: [ `${origin}/apis/metrics.k8s.io/v1beta1/pods` ] }
  ];
  if (clusterId) {
    tests.unshift({ key: 'nodes', label: '节点', group: '基础连通性', purpose: '读取节点列表用于节点页签与分组', candidates: [ `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/nodes` ] });
    tests.push({ key: 'pods', label: '系统组件（Pods）', group: '基础连通性', purpose: '读取系统组件与Pod列表用于体检', candidates: [ `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/pods` ] });
    tests.push({ key: 'kubeovn-vpcs', label: 'VPC（Kube-OVN）', group: '网络', purpose: '读取 Kube-OVN VPC 网络', candidates: [ `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubeovn.io/v1/vpcs` ] });
    tests.push({ key: 'kubeovn-subnets', label: '子网（Kube-OVN）', group: '网络', purpose: '读取 Kube-OVN 子网', candidates: [ `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubeovn.io/v1/subnets` ] });
    tests.push({ key: 'nads', label: '网络（NAD）', group: '网络', purpose: '读取 Multus NAD 用于网络配置', candidates: [ `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/k8s.cni.cncf.io/v1/network-attachment-definitions` ] });
  }
  const items: Array<{ key: string; label: string; url: string; ok: boolean; status?: number; error?: string; group?: string; purpose?: string }> = [];
  for (const t of tests) {
    let ok = false;
    let usedUrl = '';
    let status: number | undefined = undefined;
    let lastStatus: number | undefined = undefined;
    let lastError: string | undefined = undefined;
    for (const u of t.candidates) {
      const r = await requestOnce(u, token, insecure);
      if (!usedUrl) usedUrl = u;
      if (r?.ok) { ok = true; usedUrl = u; status = r?.status; break; }
      lastStatus = r?.status; lastError = r?.error;
    }
    items.push({ key: t.key, label: t.label, url: usedUrl, ok, status: status ?? lastStatus, error: ok ? undefined : lastError, group: t.group, purpose: t.purpose });
  }
  return { items };
};
