import { isSystemNamespace } from 'utils/harvesterUtils';

export interface SnapshotListRow {
  key: string;
  name: string;
  namespace: string;
  sourcePvc: string;
  snapshotClassName: string;
  readyToUse?: boolean;
  restoreSize?: string;
  creationTimestamp?: string;
  alias: string;
  raw: unknown;
}

export function normalizeSnapshotList(snapshots: unknown[] | undefined): SnapshotListRow[] {
  return (snapshots || []).map((item: unknown) => {
    const s = item as Record<string, unknown> & {
      rawData?: Record<string, unknown>;
      id?: string;
      name?: string;
      namespace?: string;
      sourcePvc?: string;
      snapshotClassName?: string;
      restoreSize?: string;
      createdAt?: string;
    };
    const raw = (s.rawData || s) as Record<string, unknown> & {
      metadata?: {
        uid?: string;
        name?: string;
        namespace?: string;
        creationTimestamp?: string;
        annotations?: Record<string, string>;
      };
      spec?: {
        source?: { persistentVolumeClaimName?: string; name?: string };
        volumeSnapshotClassName?: string;
      };
      status?: { readyToUse?: boolean; restoreSize?: string };
    };
    return {
      key: raw.metadata?.uid || s.id || '',
      name: raw.metadata?.name || s.name || '',
      namespace: raw.metadata?.namespace || s.namespace || '',
      sourcePvc:
        raw.spec?.source?.persistentVolumeClaimName || raw.spec?.source?.name || s.sourcePvc || '-',
      snapshotClassName: raw.spec?.volumeSnapshotClassName || s.snapshotClassName || '-',
      readyToUse: raw.status?.readyToUse,
      restoreSize: raw.status?.restoreSize || s.restoreSize,
      creationTimestamp: raw.metadata?.creationTimestamp || s.createdAt,
      alias: raw.metadata?.annotations?.['tower.io/alias'] || '-',
      raw,
    };
  });
}

export type SnapshotFilterParams = {
  keyword: string;
  namespaceFilter: string;
  statusFilter: string;
  isTenant?: boolean;
  isPublicNamespace: (ns: string) => boolean;
};

export function filterSnapshotsForTable(
  dataSource: SnapshotListRow[],
  params: SnapshotFilterParams,
): SnapshotListRow[] {
  let d = dataSource.filter((r) => {
    const ns = r.namespace;
    if (params.isTenant) {
      if (isSystemNamespace(ns) || params.isPublicNamespace(ns)) return false;
    } else if (isSystemNamespace(ns)) {
      return false;
    }
    return true;
  });

  if (params.keyword) {
    const k = params.keyword.toLowerCase();
    d = d.filter(
      (x) =>
        x.name.toLowerCase().includes(k) ||
        x.namespace.toLowerCase().includes(k) ||
        (x.alias && x.alias.toLowerCase().includes(k)),
    );
  }
  if (!params.isTenant && params.namespaceFilter) {
    d = d.filter((x) => x.namespace === params.namespaceFilter);
  }
  if (params.statusFilter) {
    if (params.statusFilter === 'ready') {
      d = d.filter((x) => x.readyToUse);
    } else if (params.statusFilter === 'notReady') {
      d = d.filter((x) => !x.readyToUse);
    }
  }
  return d;
}

export function snapshotDisplayLabel(record: SnapshotListRow): string {
  return record.alias !== '-' ? record.alias : record.name;
}

export function snapshotDetailRawRecord(record: SnapshotListRow): Record<string, unknown> {
  const raw = (record.raw || record) as Record<string, unknown> & {
    kind?: string;
    metadata?: { namespace?: string; name?: string };
    links?: { view?: string };
  };
  if (!raw.kind) raw.kind = 'VolumeSnapshot';
  if (!raw.links) raw.links = {};
  if (!raw.links.view) {
    const ns = raw.metadata?.namespace || record.namespace;
    const name = raw.metadata?.name || record.name;
    if (ns && name) {
      raw.links.view = `/apis/snapshot.storage.k8s.io/v1/namespaces/${ns}/volumesnapshots/${name}`;
    }
  }
  return raw;
}

/** 命名空间下拉（value/label 均为 ns 名；可选过滤系统命名空间） */
export function buildSnapshotNamespaceOptions(
  namespaces: Array<{ name?: string; metadata?: { name?: string } }> | undefined,
  options?: { excludeSystem?: boolean },
): Array<{ label: string; value: string }> {
  return (namespaces || [])
    .map((ns) => {
      const name = ns?.name || ns?.metadata?.name;
      if (!name) return null;
      if (options?.excludeSystem && isSystemNamespace(name)) return null;
      return { label: name, value: name };
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));
}
