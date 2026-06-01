/**
 * Cloudmap 资源总览 · 机房 / 网络拓扑（`Harvester/hsm`）池层装配。
 */
import React, { useEffect, useMemo } from 'react';
import DatacenterTopologySection from '../../../../Harvester/hsm/sections/DatacenterTopologySection';
import NetworkTopologySection from '../../../../Harvester/hsm/sections/NetworkTopologySection';
import { createResourceHubTabOnRefresh } from '../../loaders/resourceHubRefresh';
import {
  networkTopologyClusterNetworksFromPool,
  networkTopologyClusterNodesFromPool,
} from '../../../../Harvester/hsm/hooks/useNetworkTopologyData';
import type { HarvesterSectionOnRefresh } from '../../../../Harvester/shared/lib/harvesterSectionRefresh';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import type { DatacenterRack } from '../../../../../../../services/datacenterTopologyApi';
import type { NodeLiveMetrics } from '../../../../Harvester/hsm/lib/physicalNodeRackUtils';
import type { KubeListItem } from '../../../../Harvester/hsm/lib/networkTopologySectionUtils';

export type CloudmapResourceHubTopologyPanelProps = {
  cloudId: string;
  resourceHubSub: 'datacenter_topology' | 'network_topology';
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  checkPerm: (act: string) => boolean;
  canViewNetworkTopology?: boolean;
  resourceLoading: Record<string, boolean>;
  datacenterRacks: DatacenterRack[];
  datacenterNodeMetricsMap: Record<string, NodeLiveMetrics>;
  harvesterAswSwitches: AswCtlSwitchProbeRecord[];
  harvesterNodes: unknown[];
  rawNodes: unknown;
  harvesterKubeOvnProviderNetworks: unknown[];
  harvesterVlans: unknown[];
  kubeOvnSubnets: unknown[];
  harvesterClusterNetworks: unknown[];
};

export function useResourceHubTabOnRefresh(loadTabResource: CloudmapResourceHubTopologyPanelProps['loadTabResource']) {
  return useMemo(
    () => ({
      datacenter_topology: createResourceHubTabOnRefresh('datacenter_topology', { loadTabResource }),
      network_topology: createResourceHubTabOnRefresh('network_topology', { loadTabResource }),
    }),
    [loadTabResource],
  );
}

export const CloudmapDatacenterTopologyPanel: React.FC<CloudmapResourceHubTopologyPanelProps> = ({
  cloudId,
  resourceHubSub,
  loadTabResource,
  checkPerm,
  datacenterRacks,
  datacenterNodeMetricsMap,
  harvesterAswSwitches,
  harvesterNodes,
  resourceLoading,
}) => {
  const resourceHubTabOnRefresh = useResourceHubTabOnRefresh(loadTabResource);

  useEffect(() => {
    if (resourceHubSub !== 'datacenter_topology') return;
    void loadTabResource('datacenter_topology', false);
  }, [resourceHubSub, cloudId, loadTabResource]);

  const onRefresh: HarvesterSectionOnRefresh = resourceHubTabOnRefresh.datacenter_topology;
  const loading = !!resourceLoading.datacenter_topology;

  return (
    <DatacenterTopologySection
      cloudId={cloudId}
      checkPerm={checkPerm}
      racks={datacenterRacks}
      nodes={harvesterNodes as Record<string, unknown>[]}
      switches={harvesterAswSwitches}
      nodeMetricsMap={datacenterNodeMetricsMap}
      loading={loading}
      onRefresh={onRefresh}
    />
  );
};

export const CloudmapNetworkTopologyPanel: React.FC<CloudmapResourceHubTopologyPanelProps> = ({
  cloudId,
  resourceHubSub,
  loadTabResource,
  canViewNetworkTopology,
  resourceLoading,
  harvesterAswSwitches,
  harvesterNodes,
  rawNodes,
  harvesterKubeOvnProviderNetworks,
  harvesterVlans,
  kubeOvnSubnets,
  harvesterClusterNetworks,
}) => {
  const resourceHubTabOnRefresh = useResourceHubTabOnRefresh(loadTabResource);

  useEffect(() => {
    if (resourceHubSub !== 'network_topology') return;
    void loadTabResource('network_topology', false);
  }, [resourceHubSub, cloudId, loadTabResource, canViewNetworkTopology]);

  const onRefresh: HarvesterSectionOnRefresh = resourceHubTabOnRefresh.network_topology;

  const snapshot = useMemo(() => {
    const providers = (harvesterKubeOvnProviderNetworks || []) as KubeListItem[];
    const vlanItems = (harvesterVlans || []) as KubeListItem[];
    const subnetItems = (kubeOvnSubnets || []) as KubeListItem[];
    const clusterNodes = networkTopologyClusterNodesFromPool(harvesterNodes, rawNodes);
    const clusterNetworks = networkTopologyClusterNetworksFromPool(
      harvesterClusterNetworks as unknown[],
    );
    const anyLoading = !!resourceLoading.network_topology;
    return {
      providers,
      vlanItems,
      subnetItems,
      clusterNodes,
      aswSwitchItems: harvesterAswSwitches,
      clusterNetworks,
      anyLoading,
    };
  }, [
    harvesterKubeOvnProviderNetworks,
    harvesterVlans,
    kubeOvnSubnets,
    harvesterNodes,
    rawNodes,
    harvesterAswSwitches,
    harvesterClusterNetworks,
    resourceLoading.network_topology,
  ]);

  return (
    <NetworkTopologySection
      cloudId={cloudId}
      canViewNetworkTopology={!!canViewNetworkTopology}
      snapshot={snapshot}
      onRefresh={onRefresh}
    />
  );
};
