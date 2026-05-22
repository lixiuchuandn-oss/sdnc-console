/** 网络拓扑 Section 纯函数（Cloudmap 资源总览 · network_topology） */

import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../utils/towerKubeOvnNames';
import { SUBNET_TYPE_ANNOTATION_KEY, TOWER_ALIAS_ANNOTATION } from '../../kube-ovn/lib/kubeOvnSubnetConstants';

export const NETWORK_TOPO_CHART_MIN_HEIGHT_PX = 280;

export const NETWORK_TOPO_FLOW_FIT_VIEW_OPTIONS = { padding: 0.18, maxZoom: 1.05 } as const;

export type KubeListItem = Record<string, unknown>;

export type ProviderNetworkOption = { label: string; value: string };

export type PnSubnetRow = {
  name: string;
  alias: string;
  vlan: string;
  vlanId: string | null;
  cidr: string;
  gateway: string;
  excludeIps: unknown[];
  type: string;
};

export type PnDerivedMeta = {
  displayName: string;
  metaName: string;
  ready: boolean;
};

export type PnNicTopology = {
  defaultIf: string;
  customList: Array<{ interface?: string; nodes?: unknown[] }>;
  nodesOnDefault: string[];
};

export function networkTopoErrMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message;
  }
  return fallback;
}

export function flowZoomButtonTitle(canvasMissing: boolean, verb: string): string {
  return canvasMissing ? '暂无拓扑画布' : verb;
}

export function kubeMetaName(item: KubeListItem | undefined): string {
  if (!item) return '';
  return String((item.metadata as { name?: string } | undefined)?.name || '').trim();
}

export function parseHarvesterNodesFromListResponse(nodeJson: unknown): KubeListItem[] {
  if (!nodeJson || typeof nodeJson !== 'object') return [];
  const o = nodeJson as { data?: { items?: unknown }; items?: unknown };
  const raw = o.data?.items ?? o.items ?? [];
  return Array.isArray(raw) ? (raw as KubeListItem[]) : [];
}

export function parseClusterNetworkItems(res: unknown): KubeListItem[] {
  if (!res || typeof res !== 'object') return [];
  const o = res as { items?: unknown; data?: { items?: unknown } };
  if (Array.isArray(o.items)) return o.items as KubeListItem[];
  const nestedItems = o.data?.items;
  if (Array.isArray(nestedItems)) return nestedItems as KubeListItem[];
  return [];
}

export function buildProviderNetworkOptions(providers: readonly KubeListItem[]): ProviderNetworkOption[] {
  const options: ProviderNetworkOption[] = [];
  for (const p of providers) {
    const meta = p.metadata as { name?: string; annotations?: Record<string, string> } | undefined;
    const name = String(meta?.name ?? '').trim();
    if (!name) continue;
    const ann = meta?.annotations || {};
    const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
    const display = alias || name;
    const label = alias && alias !== name ? `${alias} (${name})` : display;
    options.push({ label, value: name });
  }
  return options;
}

export function buildClusterNetworkOptions(
  clusterNetworks: readonly KubeListItem[],
  friendlyLabel: (name: string) => string,
): ProviderNetworkOption[] {
  const options: ProviderNetworkOption[] = [];
  for (const raw of clusterNetworks) {
    const name = kubeMetaName(raw);
    if (!name) continue;
    const friendly = friendlyLabel(name);
    const label = friendly && friendly !== name ? `${friendly} (${name})` : name;
    options.push({ label, value: name });
  }
  return options;
}

export function resolveEffectiveSelection(
  userSelected: string | undefined,
  items: readonly KubeListItem[],
): string {
  const first = kubeMetaName(items[0]);
  return String(userSelected || first || '').trim();
}

export function pickClusterNetworkByName(
  clusterNetworks: readonly KubeListItem[],
  name: string,
): KubeListItem[] {
  const want = String(name || '').trim();
  if (!want) return [];
  const found = clusterNetworks.find((cn) => kubeMetaName(cn) === want);
  return found ? [found] : [];
}

export function deriveProviderNetworkMeta(effectivePn: KubeListItem | undefined): PnDerivedMeta {
  const pn = effectivePn as
    | {
        metadata?: { name?: string; annotations?: Record<string, string> };
        status?: { ready?: boolean };
      }
    | undefined;
  if (!pn) return { displayName: '', metaName: '', ready: false };
  const ann = pn.metadata?.annotations || {};
  return {
    displayName: String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim(),
    metaName: String(pn.metadata?.name || '').trim(),
    ready: !!pn.status?.ready,
  };
}

export function providerNetworkReadyNodes(effectivePn: KubeListItem | undefined): string[] {
  const nodes = (effectivePn as { status?: { readyNodes?: string[] } } | undefined)?.status?.readyNodes;
  return Array.isArray(nodes) ? nodes : [];
}

export function providerNetworkHeaderTitle(pnDerived: PnDerivedMeta): string {
  if (pnDerived.metaName) return pnDerived.displayName || pnDerived.metaName;
  return '网络规划';
}

export function filterVlansForProvider(
  vlanItems: readonly KubeListItem[],
  providerName: string,
): KubeListItem[] {
  const want = String(providerName || '').trim();
  if (!want) return [];
  return vlanItems.filter(
    (v) => String((v.spec as { provider?: string } | undefined)?.provider || '').trim() === want,
  );
}

export function buildSubnetsGroupedForProvider(
  providerName: string,
  vlanItems: readonly KubeListItem[],
  subnetItems: readonly KubeListItem[],
): { publicSubnetsForPn: PnSubnetRow[]; flatSubnetsForPn: PnSubnetRow[] } {
  const provider = String(providerName || '').trim();
  const vlanByName = new Map<string, KubeListItem>();
  const vlanById = new Map<string, KubeListItem>();
  for (const v of vlanItems) {
    const vn = kubeMetaName(v);
    if (vn) vlanByName.set(vn, v);
    const vid = (v.spec as { id?: unknown } | undefined)?.id;
    if (vid !== undefined && vid !== null && String(vid).trim() !== '') {
      vlanById.set(String(vid).trim(), v);
    }
  }
  const related: PnSubnetRow[] = [];
  for (const sn of subnetItems) {
    const snMeta = sn.metadata as { name?: string } | undefined;
    if (String(snMeta?.name || '').trim() === 'external') continue;
    const snVlan = String((sn.spec as { vlan?: string } | undefined)?.vlan ?? '').trim();
    if (!snVlan) continue;
    const vlanItem = vlanByName.get(snVlan) || vlanById.get(snVlan);
    if (!vlanItem) continue;
    const vlanProvider = String((vlanItem.spec as { provider?: string } | undefined)?.provider || '').trim();
    if (!provider || vlanProvider !== provider) continue;

    const snAnn = (sn.metadata as { annotations?: Record<string, string> } | undefined)?.annotations || {};
    const vlanMetaName = kubeMetaName(vlanItem);
    const vlanId = (vlanItem.spec as { id?: unknown } | undefined)?.id;
    const snSpec = sn.spec as {
      cidrBlock?: string;
      cidr?: string;
      gateway?: string;
      excludeIps?: unknown[];
    } | undefined;
    const excludeIpsRaw = snSpec?.excludeIps;

    related.push({
      name: String(snMeta?.name || '-'),
      alias: String(snAnn[TOWER_ALIAS_ANNOTATION] || '').trim(),
      vlan: vlanMetaName || snVlan || '-',
      vlanId: vlanId !== undefined && vlanId !== null ? String(vlanId) : null,
      cidr: String(snSpec?.cidrBlock || snSpec?.cidr || '-'),
      gateway: String(snSpec?.gateway || '-'),
      excludeIps: Array.isArray(excludeIpsRaw) ? excludeIpsRaw : [],
      type: String(snAnn[SUBNET_TYPE_ANNOTATION_KEY] || '')
        .trim()
        .toLowerCase(),
    });
  }
  return {
    publicSubnetsForPn: related.filter((s) => s.type === 'public'),
    flatSubnetsForPn: related.filter((s) => s.type === 'flat'),
  };
}

export function buildPnNicTopology(
  effectivePn: KubeListItem | undefined,
  pnReadyNodes: readonly string[],
): PnNicTopology | null {
  if (!effectivePn) return null;
  const spec = (effectivePn.spec || {}) as {
    defaultInterface?: string;
    customInterfaces?: Array<{ interface?: string; nodes?: unknown[] }>;
  };
  const defaultIf = String(spec.defaultInterface || '').trim();
  const customList = Array.isArray(spec.customInterfaces) ? spec.customInterfaces : [];
  const nodesInCustom = new Set<string>();
  for (const c of customList) {
    for (const n of Array.isArray(c?.nodes) ? c.nodes : []) {
      const s = String(n ?? '').trim();
      if (s) nodesInCustom.add(s);
    }
  }
  const nodesOnDefault = pnReadyNodes.filter((n) => !nodesInCustom.has(String(n).trim()));
  return { defaultIf, customList, nodesOnDefault };
}

export function buildFlowStaleFingerprint(input: {
  topoView: 'underlay' | 'cluster';
  effectiveProviderName: string;
  vlanLoading: boolean;
  subnetLoading: boolean;
  physicalTopoLoading: boolean;
  effectiveClusterNetworkName: string;
  clusterNetworksLoading: boolean;
}): string {
  if (input.topoView === 'underlay') {
    return `underlay:${input.effectiveProviderName}:${input.vlanLoading}:${input.subnetLoading}:${input.physicalTopoLoading}`;
  }
  return `cluster:${input.effectiveClusterNetworkName}:${input.clusterNetworksLoading}:${input.physicalTopoLoading}`;
}

export function resolveUserSelectionAfterListChange(
  prev: string | undefined,
  items: readonly KubeListItem[],
): string | undefined {
  if (items.length === 0) return prev;
  if (prev && items.some((cn) => kubeMetaName(cn) === prev)) return prev;
  return kubeMetaName(items[0]) || undefined;
}
