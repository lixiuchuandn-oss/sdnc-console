import { isSystemNamespace } from 'utils/harvesterUtils';
import { parseQuantity } from './volumeQuantityUtils';
import type { VolumeView } from './volumesSectionTypes';

export type { VolumeView };

export type VolumeFilterParams = {
  keyword: string;
  statusFilter: string;
  nsFilter: string;
  scFilter: string;
  isTenant?: boolean;
  isPublicNamespace: (ns: string) => boolean;
};

/** 将上游 volumes 归一化为 VolumeView，按 namespace/name 去重 */
export function normalizeVolumeList(volumes: unknown[] | undefined): VolumeView[] {
  const rawList = Array.isArray(volumes) ? volumes : [];

  const mapped = rawList
    .map((item: unknown) => {
      const r = item as Record<string, unknown> & {
        rawData?: Record<string, unknown>;
        name?: string;
        namespace?: string;
        volumeName?: string;
        pvcName?: string;
        storageClassName?: string;
        accessModes?: string[];
        volumeMode?: string;
        phase?: string;
        state?: string;
        size?: string;
        capacity?: string;
        created?: string;
        attachedTo?: string[];
        links?: { view?: string };
      };
      const source = (r?.rawData || r || {}) as Record<string, unknown> & {
        metadata?: {
          name?: string;
          namespace?: string;
          uid?: string;
          creationTimestamp?: string;
          annotations?: Record<string, string>;
        };
        spec?: {
          volumeName?: string;
          storageClassName?: string;
          accessModes?: string[];
          volumeMode?: string;
          resources?: { requests?: { storage?: string } };
        };
        status?: {
          phase?: string;
          state?: string;
          capacity?: { storage?: string };
          conditions?: Array<{ type?: string; status?: string }>;
          accessModes?: string[];
        };
      };

      const name = source?.metadata?.name || r?.name || '';
      const namespace = source?.metadata?.namespace || r?.namespace || '';
      const alias = source?.metadata?.annotations?.['tower.io/alias'] || '';

      const pvName = source?.spec?.volumeName || r?.volumeName || r?.pvcName || '';
      const storageClass = source?.spec?.storageClassName || r?.storageClassName || '';
      const accessModes =
        source?.spec?.accessModes || source?.status?.accessModes || r?.accessModes || [];
      const volumeMode = source?.spec?.volumeMode || r?.volumeMode || 'Block';

      let phase = source?.status?.phase || r?.phase || source?.status?.state || r?.state || 'Unknown';

      const conditions = source?.status?.conditions || (r?.status as { conditions?: unknown[] })?.conditions;
      if (Array.isArray(conditions)) {
        const isResizing = conditions.some((c) => c.type === 'Resizing' && c.status === 'True');
        const isFsPending = conditions.some(
          (c) => c.type === 'FileSystemResizePending' && c.status === 'True',
        );
        if (isFsPending) {
          phase = 'FileSystemResizePending';
        } else if (isResizing) {
          phase = 'Resizing';
        }
      }

      const capacityRaw =
        source?.status?.capacity?.storage ||
        source?.spec?.resources?.requests?.storage ||
        r?.size ||
        r?.capacity ||
        '';
      const attachedTo = Array.isArray(r?.attachedTo) ? r.attachedTo : [];

      return {
        key: source?.metadata?.uid || (r?.id as string) || `${namespace}/${name}`,
        name,
        alias: alias || undefined,
        namespace,
        pvName,
        phase,
        capacityRaw: String(capacityRaw),
        capacityBytes: parseQuantity(capacityRaw),
        storageClass,
        accessModes: Array.isArray(accessModes) ? accessModes : [String(accessModes)],
        volumeMode,
        creationTimestamp: source?.metadata?.creationTimestamp || (r?.created as string) || '',
        attachedTo,
        links: r?.links,
        raw: item,
      };
    })
    .filter((v) => !!v.name);

  const uniqueMap = new Map<string, VolumeView>();
  mapped.forEach((v) => {
    const uniqKey = `${v.namespace}/${v.name}`;
    if (!uniqueMap.has(uniqKey)) {
      uniqueMap.set(uniqKey, v);
    }
  });

  return Array.from(uniqueMap.values());
}

export function filterVolumesForTable(
  dataSource: VolumeView[],
  params: VolumeFilterParams,
): VolumeView[] {
  const kw = params.keyword.trim().toLowerCase();
  const st = params.statusFilter.trim().toLowerCase();

  return dataSource.filter((item) => {
    if (kw) {
      const alias = String(item.alias || '').toLowerCase();
      const name = String(item.name || '').toLowerCase();
      const pvName = String(item.pvName || '').toLowerCase();
      if (!alias.includes(kw) && !name.includes(kw) && !pvName.includes(kw)) return false;
    }
    if (st && item.phase.toLowerCase() !== st) return false;

    if (params.isTenant) {
      if (isSystemNamespace(item.namespace) || params.isPublicNamespace(item.namespace)) return false;
    } else if (isSystemNamespace(item.namespace)) {
      return false;
    }

    if (!params.isTenant && params.nsFilter && item.namespace !== params.nsFilter) return false;
    if (params.scFilter && item.storageClass !== params.scFilter) return false;

    return true;
  });
}

export type NamespaceOption = { value: string; label: string };

export function buildVolumeNamespaceOptions(params: {
  dataSource: VolumeView[];
  vms?: unknown[];
  namespacesOptions?: string[];
  fetchedNsOptions?: string[];
  isTenant?: boolean;
  isPublicNamespace: (ns: string) => boolean;
}): NamespaceOption[] {
  const set = new Set<string>();
  if (Array.isArray(params.namespacesOptions)) {
    params.namespacesOptions.forEach((ns) => ns && set.add(ns));
  }
  (params.fetchedNsOptions || []).forEach((ns) => ns && set.add(ns));
  if (set.size === 0) {
    params.dataSource.forEach((v) => v.namespace && set.add(v.namespace));
    (params.vms || []).forEach((vm: unknown) => {
      const v = vm as Record<string, unknown> & {
        extra?: { namespace?: string };
        namespace?: string;
        Extra?: { Namespace?: string };
      };
      const ns = v?.extra?.namespace || v?.namespace || v?.Extra?.Namespace;
      if (ns) set.add(String(ns));
    });
    if (!params.isTenant && !set.has('default')) set.add('default');
  }
  let list = Array.from(set);
  if (params.isTenant) {
    list = list.filter((ns) => !isSystemNamespace(ns) && !params.isPublicNamespace(ns));
  } else {
    list = list.filter((ns) => !isSystemNamespace(ns));
  }
  return list.sort().map((s) => ({ value: s, label: s }));
}

export function volumeDetailRawRecord(record: VolumeView): Record<string, unknown> {
  const raw = (record.raw || {}) as Record<string, unknown>;
  if (!raw.kind) raw.kind = 'PersistentVolumeClaim';
  if (!raw.metadata) {
    raw.metadata = {
      name: record.name,
      namespace: record.namespace,
      uid: record.key,
      creationTimestamp: record.creationTimestamp,
    };
  }
  return raw;
}
