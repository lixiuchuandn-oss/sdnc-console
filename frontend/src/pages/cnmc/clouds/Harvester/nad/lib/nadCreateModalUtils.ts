export type NadCreateFormValues = {
  name?: string;
  namespace: string;
  vlanId?: number;
  clusterNetwork?: string;
};

export function extractHarvesterNamespaceItems(res: unknown): unknown[] {
  const r = res as { data?: unknown[] | { items?: unknown[] }; items?: unknown[] };
  if (Array.isArray(r?.data)) return r.data;
  const dataItems = r?.data && typeof r.data === 'object' && 'items' in r.data
    ? (r.data as { items?: unknown[] }).items
    : undefined;
  if (Array.isArray(dataItems)) return dataItems;
  if (Array.isArray(r?.items)) return r.items;
  return [];
}

export function extractHarvesterClusterNetworkItems(res: unknown): unknown[] {
  const r = res as { items?: unknown[]; data?: { items?: unknown[] } };
  return r?.items || r?.data?.items || [];
}

export function buildBridgeNameForClusterNetwork(cnName: string): string {
  return cnName === 'mgmt' ? 'mgmt-br' : `${cnName}-br`;
}

export function buildNadCniConfig(
  nadId: string,
  bridgeName: string,
  vlanId?: number,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    cniVersion: '0.3.1',
    name: nadId,
    type: 'bridge',
    promiscMode: true,
    bridge: bridgeName,
    ipam: {},
  };
  if (vlanId) config.vlan = Number(vlanId);
  return config;
}

export function buildNadCreatePayload(values: NadCreateFormValues, nadId: string) {
  const cnName = values.clusterNetwork || 'mgmt';
  const bridgeName = buildBridgeNameForClusterNetwork(cnName);
  const config = buildNadCniConfig(nadId, bridgeName, values.vlanId);
  const annotations: Record<string, string> = {
    'network.harvesterhci.io/route-cluster-network': cnName,
  };
  if (values.name?.trim()) {
    annotations['tower.io/alias'] = values.name.trim();
  }
  return {
    type: 'k8s.cni.cncf.io.networkattachmentdefinition',
    metadata: {
      name: nadId,
      namespace: values.namespace,
      labels: {
        'network.harvesterhci.io/cluster-network': cnName,
      },
      annotations,
    },
    spec: {
      config: JSON.stringify(config),
    },
  };
}

export function clusterNetworkDisplayName(cnName: string): string {
  return cnName === 'mgmt' ? '管理网' : cnName;
}

export function pickClusterNetworkDefault(items: unknown[], current?: string): string {
  if (!items.length) return current || 'mgmt';
  const names = items
    .map((i) => (i as { metadata?: { name?: string } }).metadata?.name)
    .filter(Boolean) as string[];
  if (current && names.includes(current)) return current;
  return names[0] || 'mgmt';
}

export function extractNamespaceNameList(res: unknown): string[] {
  return extractHarvesterNamespaceItems(res)
    .map((i) => {
      const item = i as { metadata?: { name?: string }; name?: string };
      return item.metadata?.name || item.name || '';
    })
    .filter(Boolean);
}
