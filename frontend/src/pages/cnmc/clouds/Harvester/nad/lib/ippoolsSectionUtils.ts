import type { Key } from 'react';

export interface IPPoolListRow {
  key: string;
  name: string;
  namespace: string;
  ranges: string;
  network: string;
  selector: string;
  creationTimestamp?: string;
  raw: unknown;
}

export type FilterIPPoolsParams = {
  keyword: string;
  nsFilter: string;
};

export const IP_POOL_DELETE_BLOCKED_ERR =
  "can't delete pool before releasing all the allocated IP";

export function isIpPoolDeleteBlockedError(errMsg: string): boolean {
  return errMsg.includes(IP_POOL_DELETE_BLOCKED_ERR);
}

export function normalizeIpPoolList(ippools: unknown[] | undefined): IPPoolListRow[] {
  return (ippools || []).map((poolUnknown) => {
    const pool = poolUnknown as Record<string, unknown> & {
      rawData?: Record<string, unknown>;
      id?: string;
      name?: string;
      namespace?: string;
      createdAt?: string;
    };
    const raw = (pool.rawData || pool) as Record<string, unknown> & {
      metadata?: { uid?: string; name?: string; namespace?: string; creationTimestamp?: string };
      spec?: {
        ranges?: Array<{
          subnet?: string;
          rangeStart?: string;
          rangeEnd?: string;
          start?: string;
          end?: string;
        }>;
        cidrs?: string[];
        selector?: { scope?: Array<{ namespace?: string }>; network?: string };
      };
    };

    let namespace = '-';
    if (raw.metadata?.namespace || pool.namespace) {
      namespace = String(raw.metadata?.namespace || pool.namespace);
    } else if (raw.spec?.selector?.scope && Array.isArray(raw.spec.selector.scope)) {
      const scopeWithNamespace = raw.spec.selector.scope.find((s) => s?.namespace);
      if (scopeWithNamespace?.namespace) {
        namespace = scopeWithNamespace.namespace;
      }
    }

    let rangesText = '-';
    if (raw.spec?.ranges && Array.isArray(raw.spec.ranges)) {
      const rangeTexts = raw.spec.ranges
        .map((r) => {
          if (r.subnet) return r.subnet;
          if (r.rangeStart && r.rangeEnd) return `${r.rangeStart}-${r.rangeEnd}`;
          if (r.start && r.end) return `${r.start}-${r.end}`;
          return '';
        })
        .filter(Boolean);
      rangesText = rangeTexts.join(', ') || '-';
    } else if (raw.spec?.cidrs && Array.isArray(raw.spec.cidrs)) {
      rangesText = raw.spec.cidrs.join(', ') || '-';
    }

    const network = raw.spec?.selector?.network || '-';

    return {
      key: String(raw.metadata?.uid || pool.id || ''),
      name: String(raw.metadata?.name || pool.name || ''),
      namespace,
      ranges: rangesText,
      network: String(network),
      selector: raw.spec?.selector ? JSON.stringify(raw.spec.selector) : '-',
      creationTimestamp: raw.metadata?.creationTimestamp || pool.createdAt,
      raw,
    };
  });
}

export function filterIpPoolsForTable(
  rows: IPPoolListRow[],
  params: FilterIPPoolsParams,
): IPPoolListRow[] {
  const kw = params.keyword.trim().toLowerCase();
  const ns = params.nsFilter.trim().toLowerCase();

  return rows.filter((x) => {
    if (kw) {
      const name = String(x.name || '').toLowerCase();
      const namespace = String(x.namespace || '').toLowerCase();
      if (!name.includes(kw) && !namespace.includes(kw)) return false;
    }
    if (ns && String(x.namespace || '').toLowerCase() !== ns) return false;
    return true;
  });
}

export function buildIpPoolNamespaceOptions(
  rows: IPPoolListRow[],
  isSystemNamespace: (ns: string) => boolean,
): { label: string; value: string }[] {
  const nsSet = new Set<string>();
  rows.forEach((item) => {
    const ns = item.namespace;
    if (ns && ns !== '-' && !isSystemNamespace(ns)) {
      nsSet.add(ns);
    }
  });
  return Array.from(nsSet)
    .sort()
    .map((ns) => ({ label: ns, value: ns }));
}

export function pickIpPoolsByKeys(rows: IPPoolListRow[], selectedRowKeys: Key[]): IPPoolListRow[] {
  return selectedRowKeys
    .map((key) => rows.find((d) => d.key === key))
    .filter(Boolean) as IPPoolListRow[];
}

export type BatchDeleteSplitResult<T> = {
  deletableTargets: T[];
  systemTargets: T[];
  publicTargets: T[];
};

export function splitIpPoolsForBatchDelete<T extends { namespace: string }>(
  targets: T[],
  opts: {
    isTenant?: boolean;
    isPublicNamespace: (ns: string) => boolean;
    isSystemNamespace: (ns: string) => boolean;
  },
): BatchDeleteSplitResult<T> {
  const deletableTargets = targets.filter((item) => {
    if (opts.isSystemNamespace(item.namespace)) return false;
    if (opts.isTenant && opts.isPublicNamespace(item.namespace)) return false;
    return true;
  });
  const systemTargets = targets.filter((item) => opts.isSystemNamespace(item.namespace));
  const publicTargets = opts.isTenant
    ? targets.filter((item) => opts.isPublicNamespace(item.namespace))
    : [];
  return { deletableTargets, systemTargets, publicTargets };
}
