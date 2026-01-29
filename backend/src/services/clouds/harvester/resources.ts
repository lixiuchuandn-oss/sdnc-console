import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson } from './utils';

export const listHarvesterVolumesStandard = async ({
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
  const url = `${origin}/v1/longhorn.io.volumes`;
  const json = await getJsonOnce(url, token, insecure);
  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];
  const basic = items.map((v: any) => {
    const name = v?.metadata?.name || v?.name || '';
    const size = v?.spec?.size || v?.size || 0;
    const state = v?.status?.state || v?.state || 'Unknown';
    const k8s = v?.status?.kubernetesStatus || {};
    const namespace = k8s?.namespace || v?.metadata?.namespace || '';
    const pvcName = k8s?.pvcName || '';
    const workloads =
      k8s?.workloadsStatus || v?.status?.workloadsStatus || v?.status?.workloadStatus || [];
    const rawNames: string[] = Array.isArray(workloads)
      ? workloads.map((w: any) => String(w?.workloadName || w?.podName || '')).filter(Boolean)
      : [];
    const attachedTo: string[] = Array.from(
      new Set(
        rawNames
          .map((n: string) => {
            let s = n.trim();
            if (/^virt-launcher-/.test(s)) {
              s = s.replace(/^virt-launcher-/, '');
            }
            if (/-/.test(s)) {
              const parts = s.split('-');
              if (parts.length > 1) {
                s = parts.slice(0, parts.length - 1).join('-');
              }
            }
            return s;
          })
          .filter((s: string) => !!s),
      ),
    );
    const attached =
      String(state).toLowerCase() === 'attached' ||
      (Array.isArray(workloads) && workloads.length > 0) ||
      (Array.isArray(rawNames) && rawNames.length > 0);
    return { name, size, state, attached, attachedTo, namespace, pvcName };
  });

  type NsPvc = { ns: string; pvc: string };
  const pairs: string[] = Array.from(
    new Set(
      (basic as any[])
        .map(
          (x: any): NsPvc => ({
            ns: String(x.namespace || '').trim(),
            pvc: String(x.pvcName || '').trim(),
          }),
        )
        .filter((p: NsPvc) => !!p.ns && !!p.pvc)
        .map((p: NsPvc) => `${p.ns}/${p.pvc}`),
    ),
  );
  const pvcMap: Record<string, any> = {};
  await Promise.all(
    pairs.map(async (key: string) => {
      const [ns, pvc] = key.split('/') as [string, string];
      const urls = [
        `${origin}/v1/harvester/persistentvolumeclaims/${encodeURIComponent(ns)}/${encodeURIComponent(pvc)}`,
        `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims/${encodeURIComponent(pvc)}`,
      ];
      for (const u of urls) {
        try {
          const cur = await getJsonOnce(u, token, insecure);
          pvcMap[key] = cur;
          break;
        } catch (_) {}
      }
    }),
  );

  return basic.map((x: any) => {
    const key = `${String(x.namespace || '').trim()}/${String(x.pvcName || '').trim()}`;
    const pvc = pvcMap[key];
    const spec = pvc?.spec || {};
    const storageClassName = spec?.storageClassName || '';
    const accessModes = Array.isArray(spec?.accessModes) ? spec.accessModes : [];
    const volumeMode = spec?.volumeMode || '';
    return { ...x, storageClassName, accessModes, volumeMode };
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
      if (json) break;
    } catch (e: any) {
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
      if (json) break;
    } catch (e: any) {
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
    .map((sc: any) => ({
      name: sc?.metadata?.name || sc?.name || '',
      provisioner: sc?.provisioner || sc?.driver || '',
    }))
    .filter((x: any) => !!x.name);
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
    `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages`,
    `${origin}/apis/harvesterhci.io/v1/virtualmachineimages`,
  ];
  let json: any = null;
  let lastErr: any = null;
  let hitUrl: string | null = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      hitUrl = url;
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (!json && lastErr) {
    console.error(`listHarvesterImagesStandard failed: ${lastErr?.message || lastErr}`);
    json = { items: [], data: [] };
  }
  const items = Array.isArray(json?.data)
    ? json?.data
    : Array.isArray(json?.items)
      ? json?.items
      : [];
  try {
    const topKeys = Object.keys(json || {});
    const dataKeys = Object.keys(json?.data || {});
    const itemsLen = Array.isArray(items) ? items.length : 0;
    console.info(
      `listHarvesterImagesStandard url=${hitUrl || candidates[candidates.length - 1]} insecure=${insecure} itemsLen=${itemsLen} topKeys=${topKeys.join(',')} dataKeys=${dataKeys.join(',')}`,
    );
    if (itemsLen === 0) {
      const msg = typeof json?.message === 'string' ? json.message : '';
      console.warn(
        `listHarvesterImagesStandard empty url=${hitUrl} insecure=${insecure} message=${msg}`,
      );
    }
  } catch {}
  return items.map((img: any) => ({
    name: img?.metadata?.name || img?.name || '',
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
      view: img?.links?.view || '',
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
    },
  };

  const json = await requestJson('POST', urlPath, token, insecure, body);
  return json;
};
