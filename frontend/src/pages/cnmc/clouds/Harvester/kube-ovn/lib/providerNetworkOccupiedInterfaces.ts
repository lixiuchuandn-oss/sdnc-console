import {
  resolveNodeInterface,
  type PnNicTopologyShape,
} from './providerNetworkNodeInterface';

export function providerNetworkRecordToTopology(record: unknown): PnNicTopologyShape {
  const row = record as Record<string, unknown>;
  const raw = (row?.raw ?? row?.rawData ?? row) as Record<string, unknown>;
  const spec = (raw?.spec ?? row?.spec ?? {}) as Record<string, unknown>;
  const defaultIf = String(spec.defaultInterface ?? row?.defaultInterface ?? '').trim();
  const customRaw = spec.customInterfaces ?? row?.customInterfaces;
  const customList = Array.isArray(customRaw) ? customRaw : [];
  return { defaultIf, customList, nodesOnDefault: [] };
}

export function getProviderNetworkRecordName(record: unknown): string {
  const row = record as Record<string, unknown>;
  const raw = (row?.raw ?? row?.rawData ?? row) as Record<string, unknown>;
  const meta = (raw?.metadata ?? row?.metadata ?? {}) as Record<string, unknown>;
  return String(meta?.name ?? row?.name ?? '').trim();
}

/** 节点上该网卡是否已被某条 ProviderNetwork 占用（编辑时可 exclude 自身） */
export function isNodeInterfaceOccupiedByProviderNetwork(
  nodeName: string,
  iface: string,
  providerNetworks: unknown[],
  options?: { excludeProviderNetworkName?: string },
): boolean {
  const node = String(nodeName ?? '').trim();
  const device = String(iface ?? '').trim();
  if (!node || !device) return false;
  const exclude = String(options?.excludeProviderNetworkName ?? '').trim();
  for (const pn of providerNetworks) {
    const name = getProviderNetworkRecordName(pn);
    if (exclude && name === exclude) continue;
    const topology = providerNetworkRecordToTopology(pn);
    const { iface: used } = resolveNodeInterface(node, topology);
    if (used === device) return true;
  }
  return false;
}

export function filterNodeInterfacesForProviderNetworkCreate(
  nodeName: string,
  interfaces: string[],
  providerNetworks: unknown[],
  options?: { excludeProviderNetworkName?: string },
): string[] {
  return interfaces.filter(
    (iface) =>
      !isNodeInterfaceOccupiedByProviderNetwork(nodeName, iface, providerNetworks, options),
  );
}
