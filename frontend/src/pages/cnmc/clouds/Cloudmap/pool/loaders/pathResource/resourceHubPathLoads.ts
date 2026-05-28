import { canAccessPoolPage } from '../../lib/poolPageReadAccess';
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
    loadResource,
    setHarvesterAswSwitches,
    setHarvesterNodes,
    setRawNodes,
    setKubeOvnSubnets,
    setDatacenterRacks,
    setDatacenterNodeMetricsMap,
  } = deps;

  switch (key) {
    case 'datacenter_topology':
      await loadResource(
        'datacenter_topology',
        () =>
          loadDatacenterTopologyBundle(cloudId, force, {
            skipSync: true,
            canSyncToInventory: false,
          }),
        (bundle) => {
          if (!bundle) return;
          setDatacenterRacks(bundle.racks);
          setHarvesterNodes(bundle.nodes);
          setRawNodes({ data: { items: bundle.nodes } });
          setHarvesterAswSwitches(bundle.switches);
          setDatacenterNodeMetricsMap(bundle.nodeMetricsMap);
        },
        force,
      );
      return true;
    case 'network_topology':
      if (!canAccessPoolPage(checkPerm, 'resource_hub/network_topology')) return true;
      await loadResource(
        'network_topology',
        async () => {
          await Promise.all([
            tryLoadClusterTab('cluster_vlans', force, skipSync, deps),
            tryLoadClusterTab('clusterNetworks', force, skipSync, deps),
            tryLoadClusterTab('cluster_nodes', force, skipSync, deps),
            (async () => {
              const items = await loadHarvesterAswSwitchesForTopology(cloudId, {
                force,
                skipSync: true,
                canSyncToInventory: false,
              });
              setHarvesterAswSwitches(items);
            })(),
            (async () => {
              try {
                if (force && cloudId) {
                  clearCache(`/api/clouds/${cloudId}/resources/subnets`, 'GET');
                }
                const res = await fetchKubeOvnSubnets(cloudId, force, true);
                const list: unknown[] = Array.isArray(
                  (res as { data?: { items?: unknown } })?.data?.items,
                )
                  ? (res as { data: { items: unknown[] } }).data.items
                  : [];
                setKubeOvnSubnets(Array.isArray(list) ? list : []);
              } catch {
                setKubeOvnSubnets([]);
              }
            })(),
          ]);
        },
        () => {},
        force,
      );
      return true;
    default:
      return false;
  }
}
