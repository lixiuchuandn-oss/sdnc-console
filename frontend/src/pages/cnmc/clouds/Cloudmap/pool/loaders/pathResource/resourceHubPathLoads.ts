import { CLOUD_PROVIDER_NETWORKS_READ } from '../../../../../../../constants/cloudPermissions';
import { clearCache } from '../../../../../../../utils/requestManager';
import { loadDatacenterTopologyBundle } from '../../../../Harvester/hsm/lib/loadDatacenterTopologyBundle';
import { loadHarvesterAswSwitchesForTopology } from '../../../../Harvester/hsm/lib/loadHarvesterAswSwitchesForTopology';
import { fetchKubeOvnSubnets } from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';
import { tryLoadClusterTab } from './clusterPathLoads';

/** Cloudmap `resource_hub` · 机房 / 网络拓扑（`Harvester/hsm`） */
export async function tryLoadResourceHubTab(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    canReadNetworkScope,
    setResourceLoading,
    setDatacenterRacks,
    setDatacenterNodeMetricsMap,
    setHarvesterAswSwitches,
    setHarvesterNodes,
    setRawNodes,
    setHarvesterVlans,
    setHarvesterKubeOvnProviderNetworks,
    setKubeOvnSubnets,
    setRawSubnets,
    setHarvesterClusterNetworks,
  } = deps;

  switch (key) {
    case 'datacenter_topology': {
      const canSyncAsw = checkPerm('clouds.cluster-networks:write');
      setResourceLoading((prev) => ({ ...prev, datacenter_topology: true }));
      try {
        const bundle = await loadDatacenterTopologyBundle(cloudId, force, {
          skipSync,
          canSyncToInventory: canSyncAsw,
        });
        setDatacenterRacks(bundle.racks);
        setHarvesterNodes(bundle.nodes);
        setRawNodes({ data: { items: bundle.nodes } });
        setHarvesterAswSwitches(bundle.switches);
        setDatacenterNodeMetricsMap(bundle.nodeMetricsMap);
      } finally {
        setResourceLoading((prev) => ({ ...prev, datacenter_topology: false }));
      }
      return true;
    }
    case 'network_topology': {
      if (!canReadNetworkScope) return true;
      setResourceLoading((prev) => ({ ...prev, network_topology: true }));
      try {
        await Promise.all([
          tryLoadClusterTab('cluster_vlans', force, skipSync, deps),
          tryLoadClusterTab('clusterNetworks', force, skipSync, deps),
          tryLoadClusterTab('cluster_nodes', force, skipSync, deps),
          (async () => {
            const items = await loadHarvesterAswSwitchesForTopology(cloudId, {
              force,
              skipSync,
              canSyncToInventory: checkPerm('clouds.cluster-networks:write'),
            });
            setHarvesterAswSwitches(items);
          })(),
          (async () => {
            if (
              !checkPerm('clouds.networks:read') &&
              !checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
            ) {
              return;
            }
            try {
              if (force && cloudId) {
                clearCache(`/api/clouds/${cloudId}/resources/subnets`, 'GET');
              }
              const res = await fetchKubeOvnSubnets(cloudId, force, true);
              const list: unknown[] = Array.isArray((res as { data?: { items?: unknown } })?.data?.items)
                ? ((res as { data: { items: unknown[] } }).data.items)
                : [];
              setKubeOvnSubnets(Array.isArray(list) ? list : []);
            } catch {
              setKubeOvnSubnets([]);
            }
          })(),
        ]);
      } finally {
        setResourceLoading((prev) => ({ ...prev, network_topology: false }));
      }
      return true;
    }
    default:
      return false;
  }
}
