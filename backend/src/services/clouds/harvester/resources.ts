import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson } from './utils';

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
    metadata: { name: String(payload.name || ''), namespace: ns },
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
  const urlPath = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineimages`;
  const body = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'VirtualMachineImage',
    metadata: { generateName: 'image-', namespace },
    spec: {
      displayName: opts?.displayName || pvcName,
      sourceType: 'export',
      pvcName,
      ...(opts?.targetStorageClassName
        ? { targetStorageClassName: opts.targetStorageClassName }
        : {}),
    },
  } as any;
  const json = await requestJson('POST', urlPath, token, insecure, body);
  return json;
};

export const deleteHarvesterNamespace = async (
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

  const urlPath = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;

  const json = await requestJson('DELETE', urlPath, token, insecure);
  return json;
};

export const createVolumeSnapshot = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  pvcName: string,
  opts: { name?: string; snapshotClassName?: string },
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
  const body = {
    apiVersion: 'snapshot.storage.k8s.io/v1',
    kind: 'VolumeSnapshot',
    metadata: {
      ...(opts?.name ? { name: opts.name } : { generateName: `${pvcName}-snap-` }),
      namespace,
    },
    spec: {
      source: { persistentVolumeClaimName: pvcName },
      ...(opts?.snapshotClassName ? { volumeSnapshotClassName: opts.snapshotClassName } : {}),
    },
  } as any;
  const json = await requestJson('POST', urlPath, token, insecure, body);
  return json;
};

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

export const listHarvesterCloudInitsStandard = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  // Placeholder: Return empty for now as CloudInit discovery strategy is complex
  return [];
};

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

export const listHarvesterTemplatesStandard = listHarvesterTemplatesRaw;

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

