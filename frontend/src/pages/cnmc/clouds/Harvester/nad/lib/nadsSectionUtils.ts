/** 工具栏「孤立 NAD」筛选的哨兵值（CNI kube-ovn 且当前子网列表中无配套 Subnet） */
export const OVN_NAD_ORPHAN_ONLY = '__tower_ovn_nad_orphan_only__';

export const ORPHAN_OVN_NAD_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: OVN_NAD_ORPHAN_ONLY, label: '孤立 NAD' },
];

export type ProcessedNadRecord = Record<string, unknown> & {
  _config: Record<string, unknown>;
  _name: string;
  _namespace: string;
  _alias: string;
  _clusterNetwork: string;
  _clusterNetworkDisplay: string;
  _vlan?: unknown;
  _ipamType?: string;
  _promisc?: unknown;
  _bridge?: string;
  _type: string;
  _cniVersion?: string;
  _creationTimestamp: string;
  metadata?: { uid?: string };
};

export type FilterNadsParams = {
  keyword: string;
  nsFilter: string;
  ipamFilter: string;
  orphanOvnNadFilter: string;
  ovnSubnetsLoading: boolean;
  subnetByNameLc: Map<string, unknown>;
};

/** 从 NAD 解析可能对应的 Kube-OVN Subnet 名称候选（同名 + provider 首段） */
export function collectKubeOvnSubnetNameCandidates(record: {
  _name?: string;
  _config?: Record<string, unknown>;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const x = String(s || '').trim().toLowerCase();
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  };
  push(String(record._name || ''));
  const cfg = record._config || {};
  const fromProvider = (p: string) => {
    const v = String(p || '').trim();
    if (!v.includes('.ovn')) return;
    const first = v.split('.')[0];
    if (first) push(first);
  };
  fromProvider(String(cfg.provider || ''));
  const plugins = Array.isArray(cfg.plugins) ? cfg.plugins : [];
  for (const pl of plugins) {
    const plugin = pl as { type?: string; provider?: string };
    if (String(plugin?.type || '').toLowerCase() === 'kube-ovn' && plugin?.provider) {
      fromProvider(String(plugin.provider));
    }
  }
  return out;
}

export function inferCniTypeFromConfig(config: unknown): string {
  if (!config || typeof config !== 'object') return '';
  const cfg = config as { type?: string; plugins?: Array<{ type?: string }> };
  const top = String(cfg.type ?? '').trim();
  if (top) return top;
  const plugins = Array.isArray(cfg.plugins) ? cfg.plugins : [];
  for (const p of plugins) {
    const t = String(p?.type ?? '').trim();
    if (t.toLowerCase() === 'kube-ovn') return 'kube-ovn';
  }
  if (plugins[0]?.type) return String(plugins[0].type).trim();
  return '';
}

export function isKubeOvnCniNad(record: { _type?: string; _config?: Record<string, unknown> }): boolean {
  const t = String(record?._type ?? inferCniTypeFromConfig(record?._config) ?? '')
    .trim()
    .toLowerCase();
  return t === 'kube-ovn';
}

export function findDependentSubnetsForNad(
  record: ProcessedNadRecord,
  subnets: unknown[],
): string[] {
  if (!Array.isArray(subnets) || subnets.length === 0) return [];
  if (isKubeOvnCniNad(record)) {
    const candidates = new Set(
      collectKubeOvnSubnetNameCandidates(record).map((s) => s.toLowerCase()).filter(Boolean),
    );
    if (candidates.size === 0) return [];
    return subnets
      .map((subnet) => subnet as { metadata?: { name?: string }; name?: string })
      .filter((subnet) => {
        const subnetName = String(subnet?.metadata?.name || subnet?.name || '').toLowerCase();
        return subnetName && candidates.has(subnetName);
      })
      .map((subnet) => subnet?.metadata?.name || subnet?.name)
      .filter(Boolean) as string[];
  }
  const nadName = String(record?._name ?? '').toLowerCase();
  if (!nadName) return [];
  return subnets
    .map((subnet) => subnet as { metadata?: { name?: string }; name?: string })
    .filter((subnet) => {
      const subnetName = String(subnet?.metadata?.name || subnet?.name || '').toLowerCase();
      return subnetName === nadName;
    })
    .map((subnet) => subnet?.metadata?.name || subnet?.name)
    .filter(Boolean) as string[];
}

export function subnetTypeToShortLabel(t: string): string {
  const s = String(t || '').trim().toLowerCase();
  if (s === 'vpc') return 'VPC 子网';
  if (s === 'flat') return '扁平子网';
  if (s === 'public') return '公共子网';
  if (s === 'external') return '外部子网';
  return s ? `类型:${s}` : '';
}

export function resolveLinkedKubeOvnSubnet(
  record: { _name?: string; _config?: Record<string, unknown>; _type?: string },
  subnetByNameLc: Map<string, unknown>,
): unknown | null {
  const tp = String(record._type ?? inferCniTypeFromConfig(record._config) ?? '')
    .trim()
    .toLowerCase();
  if (tp !== 'kube-ovn') return null;
  for (const cand of collectKubeOvnSubnetNameCandidates(record)) {
    const hit = subnetByNameLc.get(cand);
    if (hit) return hit;
  }
  return null;
}

export function hasLinkedKubeOvnSubnetInMap(
  record: ProcessedNadRecord,
  subnetByNameLc: Map<string, unknown>,
): boolean {
  return resolveLinkedKubeOvnSubnet(record, subnetByNameLc) != null;
}

export function collectVmDisplayNamesUsingNad(
  vms: unknown[],
  record: { _namespace?: string; _name?: string },
): string[] {
  const targetNs = String(record._namespace ?? '').toLowerCase();
  const targetName = String(record._name ?? '').toLowerCase();
  if (!targetName) return [];
  const targetRef = `${targetNs}/${targetName}`;
  return vms
    .filter((vm) => Array.isArray((vm as { networks?: string[] }).networks))
    .filter((vm) => {
      const v = vm as {
        namespace?: string;
        metadata?: { namespace?: string; name?: string; annotations?: Record<string, string> };
        networks?: string[];
        InstanceName?: string;
        name?: string;
      };
      const vmNs = (v.namespace || v.metadata?.namespace || '').toLowerCase();
      return (v.networks || []).some((n) => {
        if (!n) return false;
        const s = String(n).toLowerCase();
        const base = s.includes('@') ? s.split('@')[0] : s;
        if (base === 'pod' || base === 'default') return false;
        if (base === targetRef) return true;
        if (base.endsWith(`/${targetName}`)) return true;
        if (base === targetName && vmNs === targetNs) return true;
        return false;
      });
    })
    .map(
      (vm) => {
        const v = vm as {
          metadata?: { annotations?: Record<string, string>; name?: string };
          InstanceName?: string;
          name?: string;
        };
        return (
          v?.metadata?.annotations?.['tower.io/alias'] ||
          v.InstanceName ||
          v.name ||
          v.metadata?.name
        );
      },
    )
    .filter(Boolean) as string[];
}

export function parseNadConfig(item: Record<string, unknown>): Record<string, unknown> {
  let config: Record<string, unknown> = {};
  const rawConfig = item?.spec
    ? (item.spec as { config?: unknown }).config
    : item?.config;
  const name = String(
    (item?.metadata as { name?: string } | undefined)?.name || item?.name || '',
  );
  try {
    if (rawConfig) {
      if (typeof rawConfig === 'string') {
        config = JSON.parse(rawConfig) as Record<string, unknown>;
      } else if (typeof rawConfig === 'object') {
        config = rawConfig as Record<string, unknown>;
      }
    }
  } catch (e) {
    console.warn('Failed to parse NAD config for', name, e);
  }
  return config;
}

export function processNadList(
  nads: unknown[] | undefined,
  onlyBridge: boolean,
): ProcessedNadRecord[] {
  return (Array.isArray(nads) ? nads : [])
    .map((itemUnknown) => {
      const item = itemUnknown as Record<string, unknown>;
      const name = String(
        (item?.metadata as { name?: string } | undefined)?.name || item?.name || '',
      );
      const namespace = String(
        (item?.metadata as { namespace?: string } | undefined)?.namespace ||
          item?.namespace ||
          '',
      );
      const config = parseNadConfig(item);
      const ipam = config?.ipam as { type?: string; subnet?: string } | undefined;
      let ipamType = ipam?.type;
      if (!ipamType && typeof ipam?.subnet === 'string') {
        ipamType = 'host-local';
      }
      const metadata = item?.metadata as
        | {
            annotations?: Record<string, string>;
            labels?: Record<string, string>;
            creationTimestamp?: string;
          }
        | undefined;
      const alias = metadata?.annotations?.['tower.io/alias'] || '';
      const clusterNetwork =
        metadata?.labels?.['network.harvesterhci.io/clusternetwork'] ||
        metadata?.annotations?.['network.harvesterhci.io/route-cluster-network'] ||
        '';
      const clusterNetworkDisplay = clusterNetwork === 'mgmt' ? '管理网' : clusterNetwork;

      return {
        ...item,
        _config: config,
        _name: name,
        _namespace: namespace,
        _alias: alias,
        _clusterNetwork: clusterNetwork,
        _clusterNetworkDisplay: clusterNetworkDisplay,
        _vlan: config?.vlan,
        _ipamType: ipamType,
        _promisc: config?.promiscMode,
        _bridge: config?.bridge as string | undefined,
        _type: inferCniTypeFromConfig(config),
        _cniVersion: config?.cniVersion as string | undefined,
        _creationTimestamp:
          metadata?.creationTimestamp || (item?.createdAt as string | undefined) || '',
      } as ProcessedNadRecord;
    })
    .filter((x) => !onlyBridge || String(x?._type || '').toLowerCase().trim() === 'bridge')
    .filter((x, idx, arr) => {
      const key = getNadRowKey(x);
      const firstIdx = arr.findIndex((y) => getNadRowKey(y) === key);
      return firstIdx === idx;
    })
    .sort(
      (a, b) =>
        new Date(b._creationTimestamp || 0).getTime() -
        new Date(a._creationTimestamp || 0).getTime(),
    );
}

export function getNadRowKey(record: ProcessedNadRecord): string {
  return String(record?.metadata?.uid || `${record?._namespace || ''}/${record?._name || ''}`);
}

export function filterNadsForTable(
  rows: ProcessedNadRecord[],
  params: FilterNadsParams,
): ProcessedNadRecord[] {
  const kw = params.keyword.trim().toLowerCase();
  const ns = params.nsFilter.trim().toLowerCase();
  const ipt = params.ipamFilter.trim().toLowerCase();

  return rows
    .filter((item) => {
      const name = String(item._name || '').toLowerCase();
      const nspace = String(item._namespace || '').toLowerCase();
      const ipam = String(item._ipamType || '').toLowerCase();
      const alias = String(item._alias || '').toLowerCase();
      const matchesKeyword = !kw || name.includes(kw) || alias.includes(kw) || nspace.includes(kw);
      if (!matchesKeyword) return false;
      if (ns && nspace !== ns) return false;
      if (ipt && ipam !== ipt) return false;
      if (params.orphanOvnNadFilter === OVN_NAD_ORPHAN_ONLY && !params.ovnSubnetsLoading) {
        if (!isKubeOvnCniNad(item)) return false;
        if (resolveLinkedKubeOvnSubnet(item, params.subnetByNameLc)) return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b._creationTimestamp || 0).getTime() -
        new Date(a._creationTimestamp || 0).getTime(),
    );
}

export function buildNadNamespaceOptions(rows: ProcessedNadRecord[]): string[] {
  return Array.from(new Set(rows.map((r) => r._namespace).filter(Boolean))).sort();
}

export function buildNadIpamOptions(rows: ProcessedNadRecord[]): string[] {
  return Array.from(new Set(rows.map((r) => r._ipamType).filter(Boolean))).sort() as string[];
}

export function buildSubnetByNameMap(subnets: unknown[]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const s of subnets) {
    const subnet = s as { metadata?: { name?: string }; name?: string };
    const n = String(subnet?.metadata?.name || subnet?.name || '').toLowerCase();
    if (n) m.set(n, s);
  }
  return m;
}

/** 解析 `fetchKubeOvnSubnets` 响应为 Subnet 列表（与 Section 内自拉同源） */
export function parseKubeOvnSubnetsListResponse(res: unknown): unknown[] {
  const r = res as { data?: { items?: unknown[] }; items?: unknown[] };
  const items = r?.data?.items || r?.items || [];
  return Array.isArray(items) ? items : [];
}
