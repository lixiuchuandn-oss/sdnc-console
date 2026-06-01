import type { Key } from 'react';

export interface LoadBalancerListRow {
  key: string;
  name: string;
  namespace: string;
  address: string;
  ipam: string;
  listeners: string;
  creationTimestamp?: string;
  raw: unknown;
}

export type FilterLoadBalancersParams = {
  keyword: string;
  nsFilter: string;
  ipamFilter: string;
};

export function normalizeLoadBalancerList(
  loadBalancers: unknown[] | undefined,
): LoadBalancerListRow[] {
  return (loadBalancers || []).map((rawUnknown) => {
    const raw = rawUnknown as Record<string, unknown> & {
      metadata?: { uid?: string; name?: string; namespace?: string; creationTimestamp?: string };
      spec?: { listeners?: Array<{ port?: number; backendPort?: number; protocol?: string }>; ipam?: string };
      status?: { address?: string };
    };
    const listeners = (raw.spec?.listeners || [])
      .map((l) => `${l.port}:${l.backendPort}/${l.protocol}`)
      .join(', ');

    return {
      key: String(raw.metadata?.uid || ''),
      name: String(raw.metadata?.name || ''),
      namespace: String(raw.metadata?.namespace || ''),
      address: String(raw.status?.address || '-'),
      ipam: String(raw.spec?.ipam || '-'),
      listeners: listeners || '-',
      creationTimestamp: raw.metadata?.creationTimestamp,
      raw,
    };
  });
}

export function filterLoadBalancersForTable(
  rows: LoadBalancerListRow[],
  params: FilterLoadBalancersParams,
): LoadBalancerListRow[] {
  const kw = params.keyword.trim().toLowerCase();
  const ns = params.nsFilter.trim().toLowerCase();
  const ipam = params.ipamFilter.trim().toLowerCase();

  return rows.filter((x) => {
    if (kw) {
      const name = String(x.name || '').toLowerCase();
      const namespace = String(x.namespace || '').toLowerCase();
      if (!name.includes(kw) && !namespace.includes(kw)) return false;
    }
    if (ns && String(x.namespace || '').toLowerCase() !== ns) return false;
    if (ipam && String(x.ipam || '').toLowerCase() !== ipam) return false;
    return true;
  });
}

export function buildLoadBalancerNamespaceOptions(
  rows: LoadBalancerListRow[],
): { label: string; value: string }[] {
  const nsSet = new Set<string>();
  rows.forEach((item) => {
    if (item.namespace) nsSet.add(item.namespace);
  });
  return Array.from(nsSet)
    .sort()
    .map((ns) => ({ label: ns, value: ns }));
}

export function buildLoadBalancerIpamOptions(
  rows: LoadBalancerListRow[],
): { label: string; value: string }[] {
  const ipamSet = new Set<string>();
  rows.forEach((item) => {
    if (item.ipam && item.ipam !== '-') ipamSet.add(item.ipam);
  });
  return Array.from(ipamSet)
    .sort()
    .map((ipam) => ({ label: ipam, value: ipam }));
}

export function pickLoadBalancersByKeys(
  rows: LoadBalancerListRow[],
  selectedRowKeys: Key[],
): LoadBalancerListRow[] {
  return selectedRowKeys
    .map((key) => rows.find((d) => d.key === key))
    .filter(Boolean) as LoadBalancerListRow[];
}

export type BatchDeleteSplitResult<T> = {
  deletableTargets: T[];
  systemTargets: T[];
  publicTargets: T[];
};

export function splitLoadBalancersForBatchDelete<T extends { namespace: string }>(
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
