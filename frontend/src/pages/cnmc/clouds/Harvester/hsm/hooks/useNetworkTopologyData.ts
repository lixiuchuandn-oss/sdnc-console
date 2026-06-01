import { useEffect, useMemo, useState } from 'react';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import { parseProviderNetworkOriginNics } from '../../kube-ovn/lib/providerNetworkOriginNics';
import { buildHsmLldpPhysicalLinks } from '../lib/buildHsmLldpPhysicalLinks';
import { clusterNetworkTopologyLabel } from '../lib/networkTopology/clusterNetworkTopologyGraphUtils';
import {
  buildClusterNetworkOptions,
  buildPnNicTopology,
  buildProviderNetworkOptions,
  buildSubnetsGroupedForProvider,
  deriveProviderNetworkMeta,
  filterVlansForProvider,
  kubeMetaName,
  parseClusterNetworkItems,
  parseHarvesterNodesFromListResponse,
  pickClusterNetworkByName,
  providerNetworkHeaderTitle,
  providerNetworkReadyNodes,
  resolveEffectiveSelection,
  resolveUserSelectionAfterListChange,
  type KubeListItem,
} from '../lib/networkTopologySectionUtils';
import {
  createHarvesterToolbarRefresh,
  type HarvesterSectionOnRefresh,
} from '../../shared/lib/harvesterSectionRefresh';

export type NetworkTopologyPoolSnapshot = {
  providers: KubeListItem[];
  vlanItems: KubeListItem[];
  subnetItems: KubeListItem[];
  clusterNodes: KubeListItem[];
  aswSwitchItems: AswCtlSwitchProbeRecord[];
  clusterNetworks: KubeListItem[];
  anyLoading: boolean;
};

/** 网络拓扑：池数据派生视图 + 本地选网状态；拉数由池 `loadTabResource('network_topology')` */
export function useNetworkTopologyData(
  cloudId: string,
  canViewNetworkTopology: boolean,
  snapshot: NetworkTopologyPoolSnapshot,
  onRefresh?: HarvesterSectionOnRefresh,
) {
  const [chartLayoutGate, setChartLayoutGate] = useState(false);
  const [userSelectedPn, setUserSelectedPn] = useState<string | undefined>();
  const [userSelectedClusterNetwork, setUserSelectedClusterNetwork] = useState<string | undefined>();

  const {
    providers,
    vlanItems,
    subnetItems,
    clusterNodes,
    aswSwitchItems,
    clusterNetworks,
    anyLoading,
  } = snapshot;

  const reloadAll = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  useEffect(() => {
    setChartLayoutGate(false);
  }, [cloudId, canViewNetworkTopology]);

  useEffect(() => {
    if (!cloudId || !canViewNetworkTopology) {
      setChartLayoutGate(true);
      return;
    }
    if (!anyLoading) {
      setChartLayoutGate(true);
    }
  }, [cloudId, canViewNetworkTopology, anyLoading]);

  useEffect(() => {
    if (providers.length === 0) return;
    setUserSelectedPn((prev) => prev ?? (kubeMetaName(providers[0]) || undefined));
  }, [providers]);

  useEffect(() => {
    if (clusterNetworks.length === 0) return;
    setUserSelectedClusterNetwork((prev) =>
      resolveUserSelectionAfterListChange(prev, clusterNetworks),
    );
  }, [clusterNetworks]);

  const physicalLldpLinks = useMemo(
    () => buildHsmLldpPhysicalLinks(clusterNodes, aswSwitchItems),
    [clusterNodes, aswSwitchItems],
  );

  const providerOptions = useMemo(() => buildProviderNetworkOptions(providers), [providers]);

  const clusterNetworkOptions = useMemo(
    () => buildClusterNetworkOptions(clusterNetworks, clusterNetworkTopologyLabel),
    [clusterNetworks],
  );

  const effectiveProviderName = useMemo(
    () => resolveEffectiveSelection(userSelectedPn, providers),
    [userSelectedPn, providers],
  );

  const effectiveClusterNetworkName = useMemo(
    () => resolveEffectiveSelection(userSelectedClusterNetwork, clusterNetworks),
    [userSelectedClusterNetwork, clusterNetworks],
  );

  const displayedClusterNetworks = useMemo(
    () => pickClusterNetworkByName(clusterNetworks, effectiveClusterNetworkName),
    [clusterNetworks, effectiveClusterNetworkName],
  );

  const effectivePn = useMemo(
    () => providers.find((p) => kubeMetaName(p) === effectiveProviderName),
    [providers, effectiveProviderName],
  );

  const pnDerived = useMemo(() => deriveProviderNetworkMeta(effectivePn), [effectivePn]);
  const pnReadyNodes = useMemo(() => providerNetworkReadyNodes(effectivePn), [effectivePn]);

  const pnOriginNics = useMemo(() => {
    const ann = (effectivePn as { metadata?: { annotations?: Record<string, string> } } | undefined)
      ?.metadata?.annotations;
    return parseProviderNetworkOriginNics(ann);
  }, [effectivePn]);

  const headerTitle = useMemo(() => providerNetworkHeaderTitle(pnDerived), [pnDerived]);

  const displayedVlans = useMemo(
    () => filterVlansForProvider(vlanItems, effectiveProviderName),
    [vlanItems, effectiveProviderName],
  );

  const { publicSubnetsForPn, flatSubnetsForPn } = useMemo(
    () => buildSubnetsGroupedForProvider(effectiveProviderName, vlanItems, subnetItems),
    [effectiveProviderName, subnetItems, vlanItems],
  );

  const pnNicTopology = useMemo(
    () => buildPnNicTopology(effectivePn, pnReadyNodes),
    [effectivePn, pnReadyNodes],
  );

  const bootstrapping = anyLoading && providers.length === 0;

  return {
    chartLayoutGate,
    userSelectedPn,
    setUserSelectedPn,
    userSelectedClusterNetwork,
    setUserSelectedClusterNetwork,
    vlanLoading: anyLoading,
    subnetLoading: anyLoading,
    providersLoading: anyLoading,
    clusterNodes,
    physicalTopoLoading: anyLoading,
    clusterNetworks,
    clusterNetworksLoading: anyLoading,
    physicalLldpLinks,
    reloadAll,
    providerOptions,
    clusterNetworkOptions,
    effectiveProviderName,
    effectiveClusterNetworkName,
    displayedClusterNetworks,
    effectivePn,
    pnDerived,
    pnReadyNodes,
    pnOriginNics,
    headerTitle,
    displayedVlans,
    publicSubnetsForPn,
    flatSubnetsForPn,
    pnNicTopology,
    bootstrapping,
    anyLoading,
  };
}

/** 将池节点列表转为拓扑图用的 KubeListItem[] */
export function networkTopologyClusterNodesFromPool(
  harvesterNodes: unknown[],
  rawNodes: unknown,
): KubeListItem[] {
  if (Array.isArray(harvesterNodes) && harvesterNodes.length > 0) {
    return harvesterNodes as KubeListItem[];
  }
  return parseHarvesterNodesFromListResponse(rawNodes);
}

/** 池侧 clusterNetworks 可能为裸 items 或带 data 包裹 */
export function networkTopologyClusterNetworksFromPool(clusterNetworks: unknown[]): KubeListItem[] {
  return parseClusterNetworkItems(
    Array.isArray(clusterNetworks) && clusterNetworks.length > 0
      ? { items: clusterNetworks }
      : { items: [] },
  );
}
