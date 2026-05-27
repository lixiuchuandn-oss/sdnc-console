import { isSystemNamespace } from 'utils/harvesterUtils';

export type SshKeyTableRow = {
  key: string;
  name: string;
  alias: string;
  namespace: string;
  fingerprint: string;
  creationTimestamp: string;
  raw: unknown;
};

export function mapSshKeysToTableRows(sshKeys: readonly unknown[]): SshKeyTableRow[] {
  return (sshKeys || []).map((k: unknown) => {
    const row = k as Record<string, unknown>;
    const raw = (row.rawData as Record<string, unknown> | undefined) || row;
    const meta = (raw.metadata as Record<string, unknown> | undefined) || {};
    const spec = (raw.spec as Record<string, unknown> | undefined) || {};
    const status = (raw.status as Record<string, unknown> | undefined) || {};
    const annotations = (meta.annotations as Record<string, string> | undefined) || {};
    return {
      key: String(meta.uid || row.id || ''),
      name: String(meta.name || row.name || ''),
      alias: annotations['tower.io/alias'] || '',
      namespace: String(meta.namespace || row.namespace || ''),
      fingerprint: String(
        spec.fingerprint || status.fingerprint || row.fingerprint || '-',
      ),
      creationTimestamp: String(meta.creationTimestamp || row.createdAt || ''),
      raw,
    };
  });
}

export function filterSshKeysBaseRows(
  rows: readonly SshKeyTableRow[],
  opts: { isTenant: boolean; isPublicNamespace: (ns: string) => boolean },
): SshKeyTableRow[] {
  return rows.filter((x) => {
    const ns = (x.namespace || '').toLowerCase();
    if (opts.isTenant) {
      return !isSystemNamespace(ns) && !opts.isPublicNamespace(ns);
    }
    if (isSystemNamespace(ns)) return false;
    return true;
  });
}

export function buildSshKeyNamespaceOptions(rows: readonly SshKeyTableRow[]): { label: string; value: string }[] {
  const nsSet = new Set<string>();
  for (const item of rows) {
    const ns = item.namespace;
    if (ns && !isSystemNamespace(ns)) nsSet.add(ns);
  }
  return Array.from(nsSet)
    .sort()
    .map((ns) => ({ label: ns, value: ns }));
}

export type SshKeysFilterState = {
  keyword: string;
  namespaceFilter: string;
};

export function filterSshKeysForTable(
  rows: readonly SshKeyTableRow[],
  f: SshKeysFilterState,
): SshKeyTableRow[] {
  let d = [...rows];
  if (f.namespaceFilter) {
    d = d.filter((x) => x.namespace === f.namespaceFilter);
  }
  const k = f.keyword.trim().toLowerCase();
  if (k) {
    d = d.filter(
      (x) =>
        x.name.toLowerCase().includes(k) ||
        x.namespace.toLowerCase().includes(k) ||
        (x.alias && x.alias.toLowerCase().includes(k)),
    );
  }
  d.sort((a, b) => {
    const ta = new Date(a.creationTimestamp || 0).getTime();
    const tb = new Date(b.creationTimestamp || 0).getTime();
    return tb - ta;
  });
  return d;
}

export function sshKeyRowViewLink(record: SshKeyTableRow): string | undefined {
  const raw = record.raw as { metadata?: { name?: string; namespace?: string }; links?: { view?: string } };
  const name = String(raw?.metadata?.name || record.name || '').trim();
  const ns = raw?.metadata?.namespace || record.namespace;
  const existing = raw?.links?.view;
  if (existing) return String(existing).trim();
  if (name && ns) {
    return `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/keypairs/${encodeURIComponent(name)}`;
  }
  return undefined;
}
