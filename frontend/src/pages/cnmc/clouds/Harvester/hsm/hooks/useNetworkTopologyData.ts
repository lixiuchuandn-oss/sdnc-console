import { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { fetchAswCtlSwitchesSummary, fetchHarvesterClusterNetworks } from 'services/harvester/cluster';
import { fetchHarvesterNodes } from 'services/harvester/clusterInventory';
import {
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
} from 'services/harvester/kubeOvnRead';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import { clearCache } from '../../../../../../utils/requestManager';
import { parseProviderNetworkOriginNics } from '../../kube-ovn/lib/providerNetworkOriginNics';
import { buildHsmLldpPhysicalLinks } from '../lib/buildHsmLldpPhysicalLinks';
import { clusterNetworkTopologyLabel } from '../lib/networkTopology/ClusterNetworkTopologyGraph';
import {
  buildClusterNetworkOptions,
  buildPnNicTopology,
  buildProviderNetworkOptions,
  buildSubnetsGroupedForProvider,
  deriveProviderNetworkMeta,
  filterVlansForProvider,
  kubeMetaName,
  networkTopoErrMessage,
  parseClusterNetworkItems,
  parseHarvesterNodesFromListResponse,
  pickClusterNetworkByName,
  providerNetworkHeaderTitle,
  providerNetworkReadyNodes,
  resolveEffectiveSelection,
  resolveUserSelectionAfterListChange,
  type KubeListItem,
} from '../lib/networkTopologySectionUtils';

/** 网络拓扑：Kube-OVN / 集群网络 / 物理 underlay 数据拉取与派生视图 */
export function useNetworkTopologyData(cloudId: string, canReadNetworkScope: boolean) {
  const [chartLayoutGate, setChartLayoutGate] = useState(false);

  const [providers, setProviders] = useState<KubeListItem[]>([]);
  const [userSelectedPn, setUserSelectedPn] = useState<string | undefined>();
  const [userSelectedClusterNetwork, setUserSelectedClusterNetwork] = useState<string | undefined>();
  const [vlanItems, setVlanItems] = useState<KubeListItem[]>([]);
  const [vlanLoading, setVlanLoading] = useState(false);
  const [subnetItems, setSubnetItems] = useState<KubeListItem[]>([]);
  const [subnetLoading, setSubnetLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [clusterNodes, setClusterNodes] = useState<KubeListItem[]>([]);
  const [aswSwitchItems, setAswSwitchItems] = useState<AswCtlSwitchProbeRecord[]>([]);
  const [physicalTopoLoading, setPhysicalTopoLoading] = useState(false);
  const [clusterNetworks, setClusterNetworks] = useState<KubeListItem[]>([]);
  const [clusterNetworksLoading, setClusterNetworksLoading] = useState(false);

  const loadVlans = useCallback(
    async (force = true) => {
      if (!cloudId || !canReadNetworkScope) return;
      setVlanLoading(true);
      try {
        const res = await fetchKubeOvnVlans(cloudId, force, false);
        const items = Array.isArray(res?.data?.items) ? res.data.items : [];
        setVlanItems(items as KubeListItem[]);
        if (force && cloudId) {
          clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
        }
      } catch (e: unknown) {
        message.error(networkTopoErrMessage(e, '加载 VLAN 列表失败'));
        setVlanItems([]);
      } finally {
        setVlanLoading(false);
      }
    },
    [cloudId, canReadNetworkScope],
  );

  const loadProviders = useCallback(async () => {
    if (!cloudId || !canReadNetworkScope) return;
    setProvidersLoading(true);
    try {
      const res = await fetchKubeOvnProviderNetworks(cloudId);
      setProviders((Array.isArray(res?.data?.items) ? res.data.items : []) as KubeListItem[]);
    } catch {
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }, [cloudId, canReadNetworkScope]);

  const loadSubnets = useCallback(async () => {
    if (!cloudId || !canReadNetworkScope) return;
    setSubnetLoading(true);
    try {
      const res = await fetchKubeOvnSubnets(cloudId, true, true);
      setSubnetItems((Array.isArray(res?.data?.items) ? res.data.items : []) as KubeListItem[]);
      clearCache(`/api/clouds/${cloudId}/resources/subnets`, 'GET');
    } catch {
      setSubnetItems([]);
    } finally {
      setSubnetLoading(false);
    }
  }, [cloudId, canReadNetworkScope]);

  const loadPhysicalUnderlay = useCallback(async () => {
    if (!cloudId || !canReadNetworkScope) return;
    setPhysicalTopoLoading(true);
    try {
      const [nodeJson, swJson] = await Promise.all([
        fetchHarvesterNodes(cloudId, false).catch(() => null),
        fetchAswCtlSwitchesSummary(cloudId).catch(() => null),
      ]);
      setClusterNodes(parseHarvesterNodesFromListResponse(nodeJson));
      setAswSwitchItems(Array.isArray(swJson?.items) ? swJson.items : []);
    } catch {
      setClusterNodes([]);
      setAswSwitchItems([]);
    } finally {
      setPhysicalTopoLoading(false);
    }
  }, [cloudId, canReadNetworkScope]);

  const loadClusterNetworks = useCallback(async () => {
    if (!cloudId || !canReadNetworkScope) return;
    setClusterNetworksLoading(true);
    try {
      const res = await fetchHarvesterClusterNetworks(cloudId, true);
      setClusterNetworks(parseClusterNetworkItems(res));
      if (cloudId) {
        clearCache(`/api/clouds/${cloudId}/resources/cluster-networks`, 'GET');
      }
    } catch {
      setClusterNetworks([]);
    } finally {
      setClusterNetworksLoading(false);
    }
  }, [cloudId, canReadNetworkScope]);

  const reloadAll = useCallback(() => {
    void loadVlans(true);
    void loadProviders();
    void loadSubnets();
    void loadPhysicalUnderlay();
    void loadClusterNetworks();
  }, [loadClusterNetworks, loadPhysicalUnderlay, loadProviders, loadSubnets, loadVlans]);

  useEffect(() => {
    setChartLayoutGate(false);
  }, [cloudId, canReadNetworkScope]);

  useEffect(() => {
    if (!cloudId || !canReadNetworkScope) {
      setChartLayoutGate(true);
    }
  }, [cloudId, canReadNetworkScope]);

  useEffect(() => {
    if (!cloudId || !canReadNetworkScope) return;
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all([
          loadVlans(true),
          loadProviders(),
          loadSubnets(),
          loadPhysicalUnderlay(),
          loadClusterNetworks(),
        ]);
      } finally {
        if (!cancelled) setChartLayoutGate(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    cloudId,
    canReadNetworkScope,
    loadClusterNetworks,
    loadPhysicalUnderlay,
    loadProviders,
    loadSubnets,
    loadVlans,
  ]);

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

  const bootstrapping = providersLoading && providers.length === 0;

  const anyLoading =
    providersLoading ||
    vlanLoading ||
    subnetLoading ||
    physicalTopoLoading ||
    clusterNetworksLoading;

  return {
    chartLayoutGate,
    providers,
    userSelectedPn,
    setUserSelectedPn,
    userSelectedClusterNetwork,
    setUserSelectedClusterNetwork,
    vlanLoading,
    subnetLoading,
    providersLoading,
    clusterNodes,
    physicalTopoLoading,
    clusterNetworks,
    clusterNetworksLoading,
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
