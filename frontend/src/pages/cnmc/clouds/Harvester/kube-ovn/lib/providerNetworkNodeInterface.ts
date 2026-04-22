export type PnNicTopologyShape = {
  defaultIf: string;
  customList: Array<{ interface?: string; name?: string; nodes?: unknown[] }>;
  nodesOnDefault: string[];
};

/** 某物理节点在该 ProviderNetwork 上应使用的逻辑口：先匹配 customInterfaces，否则用 defaultInterface */
export function resolveNodeInterface(
  node: string,
  topology: PnNicTopologyShape,
): { iface: string; fromCustom: boolean } {
  const n = String(node ?? '').trim();
  if (!n) return { iface: '—', fromCustom: false };
  for (const item of topology.customList) {
    const group = (Array.isArray(item?.nodes) ? item.nodes : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter(Boolean);
    if (!group.includes(n)) continue;
    const iface = String(item?.interface ?? item?.name ?? '').trim() || '—';
    return { iface, fromCustom: true };
  }
  const def = String(topology.defaultIf || '').trim();
  return { iface: def || '—', fromCustom: false };
}
