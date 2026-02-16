import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson } from './utils';

/**
 * 获取 Harvester 原始 PVC (PersistentVolumeClaim) 列表
 * @param params 连接参数
 * @returns 原始 PVC 对象数组
 */
export const listHarvesterPVCRaw = async ({
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
  // Harvester uses standard K8s PVCs, but also exposes them via Harvester API
  const candidates = [
    `${origin}/api/v1/persistentvolumeclaims`, // Cluster-wide list
    `${origin}/v1/harvester/core.v1.persistentvolumeclaims`,
  ];
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
      console.warn(`[Harvester-API] 存储卷从 ${url} 获取失败: ${e.message}`);
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    throw lastErr;
  }
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 获取 Harvester 标准化卷列表（基于 PVC），包含视图链接
 * @param params 连接参数
 * @returns 标准化卷对象数组
 */
export const listHarvesterVolumesStandard = async (
  params: HarvesterTestParams
): Promise<any[]> => {
  const items = await listHarvesterPVCRaw(params);
  const base = (params.endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  return items.map((v: any) => {
    const name = v?.metadata?.name || v?.name || '';
    const ns = v?.metadata?.namespace || v?.namespace || '';
    const viewUrl = `${origin}/api/v1/namespaces/${ns}/persistentvolumeclaims/${name}`;
    
    return {
        ...v,
        links: {
            ...(v.links || {}),
            view: viewUrl
        }
    };
  });
};

/**
 * 获取 Harvester 可用卷列表（Longhorn 卷），用于挂载到虚拟机
 * @param params 连接参数
 * @param opts 过滤选项（如命名空间）
 * @returns 可用卷对象数组
 */
export const listHarvesterAvailableVolumesStandard = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  opts: { namespace?: string } = {},
): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const candidates = [
    `${origin}/v1/longhorn.io.volumes`,
    `${origin}/v1/harvester/longhorn.io.volumes`,
    `${origin}/apis/longhorn.io/v1beta1/volumes`,
  ];
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
      console.warn(`[Harvester可用卷] 获取失败: 请求地址=${url} 错误=${e.message}`);
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    throw lastErr;
  }
  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];
  const nsFilter = String(opts?.namespace || '').trim();
  return items
    .map((v: any) => {
      const name =
        v?.status?.kubernetesStatus?.volumeName || v?.name || v?.id || v?.metadata?.name || '';
      const ns =
        v?.status?.kubernetesStatus?.namespace || v?.metadata?.namespace || v?.namespace || '';
      const size = v?.spec?.size || v?.size || 0;
      const state = String(v?.status?.state || v?.state || '').toLowerCase();
      const workloads = v?.status?.workloadsStatus || v?.status?.workloadStatus || [];
      const inUse =
        Array.isArray(workloads) &&
        workloads.some(
          (w: any) => String(w?.state || w?.podStatus || '').toLowerCase() === 'running',
        );
      const attached = state === 'attached' || inUse;
      const pvcName = v?.status?.kubernetesStatus?.pvcName || '';
      return { name, pvcName, namespace: ns, size, state, attached };
    })
    .filter((x: any) => !x.attached)
    .filter((x: any) => !nsFilter || x.namespace === nsFilter);
};

/**
 * 获取 Harvester 存储类列表
 * @param params 连接参数
 * @returns 存储类对象数组
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
  const candidates = [
    `${origin}/v1/storage.k8s.io.storageclasses`,
    `${origin}/v1/harvester/storage.k8s.io.storageclasses`,
    `${origin}/apis/storage.k8s.io/v1/storageclasses`,
  ];
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
      console.warn(`[Harvester-API] 存储类获取失败: 请求地址=${url} 错误=${e.message}`);
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    throw lastErr;
  }
  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];
  return items
    .map((sc: any) => {
        const name = sc?.metadata?.name || sc?.name || '';
        return {
            name,
            provisioner: sc?.provisioner || sc?.driver || '',
            links: {
                view: `${origin}/apis/storage.k8s.io/v1/storageclasses/${name}`
            }
        };
    })
    .filter((x: any) => !!x.name);
};

/**
 * 获取 Harvester 镜像原始列表（支持指定命名空间）
 * @param params 连接参数及命名空间
 * @returns 原始镜像对象数组
 */
export const listHarvesterImagesRaw = async ({
  endpoint,
  token,
  insecure = false,
  namespace = '',
}: HarvesterTestParams & { namespace?: string }): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  let candidates: string[] = [];
  if (namespace) {
      candidates = [
          `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${namespace}/virtualmachineimages`,
          `${origin}/apis/harvesterhci.io/v1/namespaces/${namespace}/virtualmachineimages`,
      ];
  } else {
      candidates = [
          `${origin}/apis/harvesterhci.io/v1beta1/virtualmachineimages`,
          `${origin}/apis/harvesterhci.io/v1/virtualmachineimages`,
      ];
  }

  let json: any = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) {
        break;
      }
    } catch (e: any) {
      console.warn(`[Harvester-API] 镜像从 ${url} 获取失败: ${e.message}`);
      lastErr = e;
    }
  }

  if (!json && lastErr) {
    console.error(`[Harvester镜像] listHarvesterImagesRaw 执行失败: ${lastErr?.message || lastErr}`);
    return [];
  }

  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];
      
  return items;
};

/**
 * 获取 Harvester 标准化镜像列表，包含详细元数据和链接
 * @param params 连接参数
 * @returns 标准化镜像对象数组
 */
export const listHarvesterImagesStandard = async ({
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
    `${origin}/apis/harvesterhci.io/v1beta1/virtualmachineimages`,
    `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages`,
    `${origin}/apis/harvesterhci.io/v1/virtualmachineimages`,
  ];
  let json: any = null;
  let lastErr: any = null;
  let hitUrl: string | null = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure, true);
      hitUrl = url;
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    console.error(`[Harvester-API] listHarvesterImagesStandard 执行失败: ${lastErr?.message || lastErr}`);
    json = { items: [], data: [] };
  }
  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];

  return items.map((img: any) => ({
    name: img?.metadata?.name || img?.name || '',
    namespace: img?.metadata?.namespace || img?.namespace || '',
    metadata: img?.metadata, // Ensure metadata is passed for consumers expecting raw-like structure
    displayName: img?.spec?.displayName || img?.spec?.name || '',
    status: img?.status?.conditions?.[0]?.type || img?.status?.phase || 'Unknown',
    size: img?.status?.size || img?.spec?.size || img?.status?.downloadedBytes || 0,
    virtualSize: img?.status?.virtualSize || img?.status?.virtualsize || 0,
    storageClassName:
      img?.spec?.storageClassName ||
      img?.status?.storageClassName ||
      img?.spec?.pvcStorageClassName ||
      '',
    links: {
      download: img?.links?.download || '',
      view: img?.links?.view || `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${img?.metadata?.namespace || 'default'}/virtualmachineimages/${img?.metadata?.name || img?.name}`,
      remove: img?.links?.remove || '',
      self: img?.links?.self || '',
      update: img?.links?.update || '',
    },
  }));
};

/**
 * 删除 Harvester Longhorn 卷（底层卷）
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 卷名称
 * @returns 操作结果
 */
export const deleteHarvesterLonghornVolume = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
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
  const paths = [
    `${origin}/apis/longhorn.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/volumes/${encodeURIComponent(name)}`,
    `${origin}/v1/harvester/longhorn.io.volumes/${encodeURIComponent(name)}`,
    `${origin}/v1/longhorn.io.volumes/${encodeURIComponent(name)}`,
  ];
  let lastErr: any = null;
  for (const p of paths) {
    try {
      const json = await requestJson('DELETE', p, token, insecure);
      return json;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return {};
};

/**
 * 创建 Harvester 数据卷 (PVC)，支持设置大小、模式、存储类及注解
 * @param params 连接参数
 * @param payload 创建参数（包含注解 annotations）
 * @returns 创建结果
 */
export const createHarvesterPVCVolume = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  payload: {
    namespace: string;
    name: string;
    sizeGi?: number;
    size?: string;
    accessModes?: string[];
    volumeMode?: string;
    storageClassName?: string;
    annotations?: Record<string, string>;
  },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const ns = String(payload.namespace || 'default');
  const sizeStr = (function () {
    const raw =
      typeof (payload as any)?.size === 'number'
        ? String((payload as any).size)
        : String((payload as any)?.size || '').trim();
    if (raw) {
      const hasUnit = /[a-zA-Z]/.test(raw);
      if (hasUnit) return raw;
      const n = Number(raw);
      if (!isNaN(n) && n > 0) return `${Math.round(n)}Gi`;
    }
    const g = Number((payload as any)?.sizeGi || 0);
    return g > 0 ? `${g}Gi` : '10Gi';
  })();
  const body = {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: String(payload.name || ''),
      namespace: ns,
      annotations: payload.annotations,
    },
    spec: {
      accessModes:
        Array.isArray(payload.accessModes) && payload.accessModes.length > 0
          ? payload.accessModes
          : ['ReadWriteOnce'],
      resources: { requests: { storage: sizeStr } },
      ...(payload.volumeMode ? { volumeMode: String(payload.volumeMode) } : {}),
      ...(payload.storageClassName ? { storageClassName: String(payload.storageClassName) } : {}),
    },
  } as any;
  const candidates = [
    `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims`,
    `${origin}/v1/harvester/core.v1.persistentvolumeclaims`,
    `${origin}/k8s/clusters/local/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      const json = await requestJson('POST', url, token, insecure, body);
      return json;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return {};
};

/**
 * 从 PVC 导出为 Harvester 虚拟机镜像
 * @param params 连接参数
 * @param namespace 命名空间
 * @param pvcName PVC 名称
 * @param opts 导出选项（显示名称、目标存储类）
 * @returns 操作结果
 */
export const exportImageFromPVC = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  pvcName: string,
  opts: { displayName?: string; targetStorageClassName?: string },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const body = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'VirtualMachineImage',
    metadata: { generateName: 'image-', namespace },
    spec: {
      displayName: opts?.displayName || pvcName,
      sourceType: 'export-from-volume',
      pvcName,
      pvcNamespace: namespace,
      ...(opts?.targetStorageClassName
        ? { targetStorageClassName: opts.targetStorageClassName }
        : {}),
    },
  } as any;
  const ns = encodeURIComponent(namespace);
  const candidates = [
    `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachineimages`,
    `${origin}/k8s/clusters/local/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachineimages`,
    `${origin}/apis/harvesterhci.io/v1/namespaces/${ns}/virtualmachineimages`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      const json = await requestJson('POST', url, token, insecure, body);
      return json;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return {};
};

/**
 * 创建卷快照 (VolumeSnapshot)
 * @param params 连接参数
 * @param namespace 命名空间
 * @param pvcName 源 PVC 名称
 * @param opts 快照选项（名称、快照类）
 * @returns 创建结果
 */
export const createVolumeSnapshot = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  pvcName: string,
  opts: { name?: string; snapshotClassName?: string; alias?: string },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const urlPath = `${origin}/apis/snapshot.storage.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/volumesnapshots`;
  
  const metadata: any = {
    ...(opts?.name ? { name: opts.name } : { generateName: `${pvcName}-snap-` }),
    namespace,
  };
  
  if (opts?.alias) {
      metadata.annotations = {
          'tower.io/alias': opts.alias
      };
  }

  const body = {
    apiVersion: 'snapshot.storage.k8s.io/v1',
    kind: 'VolumeSnapshot',
    metadata,
    spec: {
      source: { persistentVolumeClaimName: pvcName },
      ...(opts?.snapshotClassName ? { volumeSnapshotClassName: opts.snapshotClassName } : {}),
    },
  } as any;
  const json = await requestJson('POST', urlPath, token, insecure, body);
  return json;
};

/**
 * 更新 PVC 规格，如扩容、修改注解或标签
 * @param params 连接参数
 * @param namespace 命名空间
 * @param pvcName PVC 名称
 * @param payload 更新内容
 * @returns 更新结果
 */
export const updatePVCSpec = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  pvcName: string,
  payload: {
    sizeGi?: number;
    size?: string;
    accessModes?: string[];
    volumeMode?: string;
    storageClassName?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const getUrl = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`;
  const cur = await getJsonOnce(getUrl, token, insecure);
  const sizeStr = (function () {
    const raw =
      typeof (payload as any)?.size === 'number'
        ? String((payload as any).size)
        : String((payload as any)?.size || '').trim();
    if (raw) {
      const hasUnit = /[a-zA-Z]/.test(raw);
      if (hasUnit) return raw;
      const n = Number(raw);
      if (!isNaN(n) && n > 0) return `${Math.round(n)}Gi`;
    }
    const g = Number((payload as any)?.sizeGi || 0);
    return g > 0 ? `${g}Gi` : undefined;
  })();
  const next = {
    apiVersion: cur?.apiVersion || 'v1',
    kind: cur?.kind || 'PersistentVolumeClaim',
    metadata: {
      ...(cur?.metadata || {}),
      name: pvcName,
      namespace,
      ...(payload.annotations
        ? { annotations: { ...(cur?.metadata?.annotations || {}), ...(payload.annotations || {}) } }
        : {}),
      ...(payload.labels
        ? { labels: { ...(cur?.metadata?.labels || {}), ...(payload.labels || {}) } }
        : {}),
    },
    spec: {
      ...(cur?.spec || {}),
      ...(Array.isArray(payload.accessModes) && payload.accessModes.length > 0
        ? { accessModes: payload.accessModes }
        : {}),
      ...(payload.volumeMode ? { volumeMode: payload.volumeMode } : {}),
      ...(payload.storageClassName ? { storageClassName: payload.storageClassName } : {}),
      ...(sizeStr ? { resources: { requests: { storage: sizeStr } } } : {}),
    },
  } as any;
  const putUrl = getUrl;
  const json = await requestJson('PUT', putUrl, token, insecure, next);
  return json;
};

/**
 * 克隆 PVC（支持从快照或现有 PVC 克隆）
 * @param params 连接参数
 * @param namespace 源命名空间
 * @param pvcName 源 PVC 名称
 * @param opts 克隆选项
 * @returns 创建的新 PVC 对象
 */
export const clonePVC = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  pvcName: string,
  opts: {
    targetNamespace?: string;
    newName: string;
    sizeGi?: number;
    size?: string;
    storageClassName?: string;
    fromSnapshotName?: string;
    accessModes?: string[];
    volumeMode?: string;
  },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const ns = String(opts?.targetNamespace || namespace);
  const sizeStr = (function () {
    const raw =
      typeof (opts as any)?.size === 'number'
        ? String((opts as any).size)
        : String((opts as any)?.size || '').trim();
    if (raw) {
      const hasUnit = /[a-zA-Z]/.test(raw);
      if (hasUnit) return raw;
      const n = Number(raw);
      if (!isNaN(n) && n > 0) return `${Math.round(n)}Gi`;
    }
    const g = Number((opts as any)?.sizeGi || 0);
    return g > 0 ? `${g}Gi` : undefined;
  })();
  const body: any = {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name: String(opts?.newName || ''), namespace: ns },
    spec: {
      accessModes:
        Array.isArray(opts?.accessModes) && opts?.accessModes?.length > 0
          ? opts?.accessModes
          : ['ReadWriteOnce'],
      ...(opts?.volumeMode ? { volumeMode: opts?.volumeMode } : {}),
      resources: { requests: { ...(sizeStr ? { storage: sizeStr } : {}) } },
      ...(opts?.storageClassName ? { storageClassName: opts.storageClassName } : {}),
      dataSource: opts?.fromSnapshotName
        ? {
            name: opts.fromSnapshotName,
            kind: 'VolumeSnapshot',
            apiGroup: 'snapshot.storage.k8s.io',
          }
        : { name: pvcName, kind: 'PersistentVolumeClaim' },
    },
  };
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims`;
  const json = await requestJson('POST', url, token, insecure, body);
  return json;
};

/**
 * 从快照恢复卷（创建新的 PVC）
 * @param params 连接参数
 * @param namespace 命名空间
 * @param snapshotName 快照名称
 * @param opts 恢复选项（新名称、规格等）
 * @returns 创建的新 PVC 对象
 */
export const restoreVolumeSnapshot = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  snapshotName: string,
  opts: {
    newName: string;
    storageClassName?: string;
    accessModes?: string[];
    volumeMode?: string;
    size?: string;
  },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const body: any = {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: String(opts.newName),
      namespace,
    },
    spec: {
      accessModes:
        Array.isArray(opts.accessModes) && opts.accessModes.length > 0
          ? opts.accessModes
          : ['ReadWriteOnce'],
      ...(opts.volumeMode ? { volumeMode: opts.volumeMode } : {}),
      ...(opts.storageClassName ? { storageClassName: opts.storageClassName } : {}),
      dataSource: {
        name: snapshotName,
        kind: 'VolumeSnapshot',
        apiGroup: 'snapshot.storage.k8s.io',
      },
    },
  };

  if (opts.size) {
    body.spec.resources = { requests: { storage: opts.size } };
  } else {
    // If size is not provided, we try to fetch the snapshot to get the restoreSize
    try {
      const snapUrl = `${origin}/apis/snapshot.storage.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/volumesnapshots/${encodeURIComponent(snapshotName)}`;
      const snap = await getJsonOnce(snapUrl, token, insecure);
      const restoreSize = snap?.status?.restoreSize;
      if (restoreSize) {
        body.spec.resources = { requests: { storage: restoreSize } };
      }
    } catch (e) {
      console.warn('Failed to fetch snapshot size for restoration, submitting without size.', e);
    }
  }

  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`;
  const json = await requestJson('POST', url, token, insecure, body);
  return json;
};

/**
 * 创建新的 Harvester 命名空间
 * @param params 连接参数
 * @param name 命名空间名称
 * @param annotations 注解
 * @returns 创建结果
 */
export const createHarvesterNamespace = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
  annotations?: Record<string, string>,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const urlPath = `${origin}/api/v1/namespaces`;

  const body = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: name,
      labels: {
        'kubernetes.io/metadata.name': name,
      },
      annotations: annotations,
    },
  };

  const json = await requestJson('POST', urlPath, token, insecure, body);
  return json;
};

/**
 * 获取单个 Harvester 命名空间的原始信息
 * @param params 连接参数
 * @param name 命名空间名称
 * @returns 命名空间对象
 */
export const getHarvesterNamespaceRaw = async (
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

  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;
  const json = await getJsonOnce(url, token, insecure);
  return json;
};

/**
 * 获取 Harvester 所有命名空间的原始列表
 * @param params 连接参数
 * @returns 命名空间对象数组
 */
export const listHarvesterNamespacesRaw = async ({
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
    `${origin}/api/v1/namespaces`,
    `${origin}/v1/core.v1.namespaces`,
    `${origin}/v1/harvester/core.v1.namespaces`,
    `${origin}/k8s/clusters/local/api/v1/namespaces`,
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
    throw lastErr;
  }
  const items = Array.isArray(json?.items) ? json.items : (Array.isArray(json?.data) ? json.data : []);
  
  return items.map((item: any) => {
    const name = item.metadata?.name || item.name;
    if (name) {
       item.links = item.links || {};
       item.links.view = `${origin}/api/v1/namespaces/${name}`;
    }
    return item;
  });
};

/**
 * 创建虚拟机备份或快照
 * @param params 连接参数
 * @param namespace 命名空间
 * @param payload 创建参数（包含别名）
 * @returns 创建结果
 */
export const createHarvesterVirtualMachineBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: {
    name: string;
    vmName: string;
    type: 'backup' | 'snapshot';
    alias?: string;
  }
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachinebackups`;

  const prefix = payload.type === 'snapshot' ? 'id-vms-' : 'id-vmb-';
  const resourceName = `${prefix}${Math.random().toString(36).substring(2, 18)}`;

  const body = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'VirtualMachineBackup',
    metadata: {
      name: resourceName,
      namespace: namespace,
      annotations: {
        'tower.io/alias': payload.name
      },
    },
    spec: {
      type: payload.type,
      source: {
        apiGroup: 'kubevirt.io',
        kind: 'VirtualMachine',
        name: payload.vmName,
      },
    }
  };

  return requestJson('POST', url, token, insecure, body);
};

/**
 * 创建虚拟机恢复任务（从备份恢复）
 * @param params 连接参数
 * @param namespace 命名空间
 * @param payload 恢复参数
 * @returns 创建结果
 */
export const createHarvesterVirtualMachineRestore = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: any
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  // Determine API Group from payload or default to harvesterhci.io
  let apiVersion = 'harvesterhci.io/v1beta1';
  if (payload?.apiVersion) {
    apiVersion = payload.apiVersion;
  }

  const url = `${origin}/apis/${apiVersion}/namespaces/${encodeURIComponent(namespace)}/virtualmachinerestores`;

  return requestJson('POST', url, token, insecure, payload);
};

/**
 * 删除虚拟机备份
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 备份名称
 * @returns 操作结果
 */
export const deleteHarvesterVirtualMachineBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
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
  
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachinebackups/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

/**
 * 删除虚拟机快照
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 快照名称
 * @returns 操作结果
 */
export const deleteHarvesterVirtualMachineSnapshot = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
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
  
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachinesnapshots/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

/**
 * 删除 Harvester 数据卷 (PVC)
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name PVC 名称
 * @returns 操作结果
 */
export const deleteHarvesterPVC = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
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
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

/**
 * 获取卷快照类 (VolumeSnapshotClass) 列表
 * @param params 连接参数
 * @returns 快照类对象数组
 */
export const listHarvesterSnapshotClassesRaw = async ({
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
  const url = `${origin}/apis/snapshot.storage.k8s.io/v1/volumesnapshotclasses`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 获取 Harvester 标准化虚拟机快照列表
 * @param params 连接参数
 * @returns 快照对象数组
 */
export const listHarvesterSnapshotsStandard = async ({
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
  
  // Try v1beta1 first, then fallback to v1alpha1
  const candidates = [
    `${origin}/apis/harvesterhci.io/v1beta1/virtualmachinesnapshots`,
    `${origin}/apis/harvesterhci.io/v1alpha1/virtualmachinesnapshots`,
    `${origin}/v1/harvester/harvesterhci.io.virtualmachinesnapshots`
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      if (json && (Array.isArray(json.items) || Array.isArray(json.data))) {
        return json.items || json.data || [];
      }
    } catch (e: any) {
      // 404 means this version is not supported, continue to next
      if (Number(e?.status) !== 404 && !String(e?.message).includes('404')) {
         // Log non-404 errors as warnings but don't crash
         console.warn(`[Harvester] Snapshot list warning for ${url}: ${e.message}`);
      }
    }
  }

  return [];
};

/**
 * 获取 Harvester 虚拟机备份列表
 * @param params 连接参数
 * @returns 备份对象数组
 */
export const listHarvesterBackupsStandard = async ({
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
  const url = `${origin}/apis/harvesterhci.io/v1beta1/virtualmachinebackups`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 获取 Harvester SSH 密钥对列表
 * @param params 连接参数
 * @returns 密钥对对象数组
 */
export const listHarvesterSshKeysStandard = async ({
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
  const url = `${origin}/apis/harvesterhci.io/v1beta1/keypairs`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 获取 Harvester CloudInit 模板列表（当前返回空）
 * @param params 连接参数
 * @returns 空数组
 */
export const listHarvesterCloudInitsStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  // Placeholder: Return empty for now as CloudInit discovery strategy is complex
  return [];
};

/**
 * 获取 Harvester 虚拟机模板原始列表
 * @param params 连接参数
 * @returns 原始模板对象数组
 */
export const listHarvesterTemplatesRaw = async ({
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
  const url = `${origin}/apis/harvesterhci.io/v1beta1/virtualmachinetemplates`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 获取 Harvester 虚拟机模板标准化列表（别名）
 */
export const listHarvesterTemplatesStandard = listHarvesterTemplatesRaw;

/**
 * 获取 Harvester 定时备份计划列表
 * @param params 连接参数
 * @returns 定时备份计划对象数组
 */
export const listHarvesterScheduleVmBackupsStandard = async ({
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
  const url = `${origin}/apis/harvesterhci.io/v1beta1/schedulevmbackups`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 创建 Harvester 定时备份计划
 * @param params 连接参数
 * @param namespace 命名空间
 * @param payload 创建参数
 * @returns 创建结果
 */
export const createHarvesterScheduleVmBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  payload: {
    name: string; // This is the ALIAS
    vmName: string;
    cron: string;
    retain: number;
    maxFailure: number;
    suspend: boolean;
    type?: 'backup' | 'snapshot';
  }
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const resourceName = `id-svmb-${Math.random().toString(36).substring(2, 18)}`;
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/schedulevmbackups`;

  const body = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'ScheduleVMBackup',
    metadata: {
      name: resourceName,
      namespace: namespace,
      annotations: {
        'tower.io/alias': payload.name
      }
    },
    spec: {
      cron: payload.cron,
      maxFailure: payload.maxFailure,
      retain: payload.retain,
      suspend: payload.suspend,
      vmbackup: {
        source: {
          apiGroup: 'kubevirt.io',
          kind: 'VirtualMachine',
          name: payload.vmName
        },
        type: payload.type || 'backup'
      }
    }
  };

  return requestJson('POST', url, token, insecure, body);
};

/**
 * 更新 Harvester 定时备份计划
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 计划名称
 * @param payload 更新内容
 * @returns 更新结果
 */
export const updateHarvesterScheduleVmBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  payload: any
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/schedulevmbackups/${encodeURIComponent(name)}`;
  
  // 1. Get existing resource
  const existing = await getJsonOnce(url, token, insecure);
  if (!existing) throw new Error('ScheduleVmBackup not found');

  // 2. Merge changes
  const updated = { ...existing };
  if (!updated.spec) updated.spec = {};
  
  if (payload.cron !== undefined) updated.spec.cron = payload.cron;
  if (payload.retain !== undefined) updated.spec.retain = payload.retain;
  if (payload.maxFailure !== undefined) updated.spec.maxFailure = payload.maxFailure;
  if (payload.suspend !== undefined) updated.spec.suspend = payload.suspend;
  
  if (payload.annotations) {
    updated.metadata.annotations = {
      ...(updated.metadata.annotations || {}),
      ...payload.annotations
    };
  }

  // 3. PUT update
  return requestJson('PUT', url, token, insecure, updated);
};

/**
 * 删除 Harvester 定时备份计划
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 计划名称
 * @returns 操作结果
 */
export const deleteHarvesterScheduleVmBackup = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
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
  const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/schedulevmbackups/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

/**
 * 获取 Harvester 虚拟机快照列表（别名）
 */
export const listHarvesterVirtualMachineSnapshots = listHarvesterSnapshotsStandard;

/**
 * 获取 Harvester 卷快照列表
 * @param params 连接参数
 * @returns 卷快照对象数组
 */
export const listHarvesterVolumeSnapshots = async ({
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
  const url = `${origin}/apis/snapshot.storage.k8s.io/v1/volumesnapshots`;
  const json = await getJsonOnce(url, token, insecure);
  return Array.isArray(json?.items) ? json.items : [];
};

/**
 * 删除 Harvester 卷快照
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name 快照名称
 * @returns 操作结果
 */
export const deleteHarvesterVolumeSnapshot = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
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
  const url = `${origin}/apis/snapshot.storage.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/volumesnapshots/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

/**
 * 创建 Harvester Secret（加密字典）
 * @param params 连接参数
 * @param namespace 命名空间
 * @param payload Secret 内容
 * @returns 创建结果
 */
export const createHarvesterSecret = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
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
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`;
  return await requestJson('POST', url, token, insecure, payload);
};

/**
 * 删除 Harvester Secret
 * @param params 连接参数
 * @param namespace 命名空间
 * @param name Secret 名称
 * @returns 操作结果
 */
export const deleteHarvesterSecret = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
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
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`;
  return await requestJson('DELETE', url, token, insecure);
};
