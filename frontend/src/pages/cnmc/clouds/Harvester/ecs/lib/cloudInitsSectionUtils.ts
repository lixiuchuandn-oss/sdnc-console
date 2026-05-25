import { isSystemNamespace } from 'utils/harvesterUtils';

export type CloudInitTableRow = {
  key: string;
  name: string;
  namespace: string;
  description: string;
  creationTimestamp: string;
  raw: unknown;
};

export function mapCloudInitsToTableRows(cloudInits: readonly unknown[]): CloudInitTableRow[] {
  return (cloudInits || []).map((c: unknown) => {
    const row = c as Record<string, unknown>;
    const raw = (row.rawData as Record<string, unknown> | undefined) || row;
    const meta = (raw.metadata as Record<string, unknown> | undefined) || {};
    const annotations = (meta.annotations as Record<string, string> | undefined) || {};
    return {
      key: String(meta.uid || row.id || ''),
      name: String(meta.name || row.name || ''),
      namespace: String(meta.namespace || row.namespace || ''),
      description:
        annotations['harvesterhci.io/cloud-init-template-description'] ||
        String(row.description || '-') ||
        '-',
      creationTimestamp: String(meta.creationTimestamp || row.createdAt || ''),
      raw,
    };
  });
}

export function filterCloudInitsBaseRows(
  rows: readonly CloudInitTableRow[],
  opts: { isTenant: boolean; isPublicNamespace: (ns: string) => boolean },
): CloudInitTableRow[] {
  return rows.filter((x) => {
    const ns = (x.namespace || '').toLowerCase();
    if (opts.isTenant) {
      return !isSystemNamespace(ns) && !opts.isPublicNamespace(ns);
    }
    return !isSystemNamespace(ns);
  });
}

export function buildCloudInitNamespaceOptions(
  rows: readonly CloudInitTableRow[],
): { value: string; label: string }[] {
  const nsSet = new Set<string>();
  for (const item of rows) {
    const ns = item.namespace;
    if (ns && !isSystemNamespace(ns)) nsSet.add(ns);
  }
  return Array.from(nsSet)
    .sort()
    .map((ns) => ({ value: ns, label: ns }));
}

export type CloudInitsFilterState = {
  keyword: string;
  namespaceFilter: string;
};

export function filterCloudInitsForTable(
  rows: readonly CloudInitTableRow[],
  f: CloudInitsFilterState,
): CloudInitTableRow[] {
  let d = [...rows];
  if (f.namespaceFilter) {
    d = d.filter((x) => x.namespace === f.namespaceFilter);
  }
  const k = f.keyword.trim().toLowerCase();
  if (k) {
    d = d.filter(
      (x) =>
        x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k),
    );
  }
  return d;
}
