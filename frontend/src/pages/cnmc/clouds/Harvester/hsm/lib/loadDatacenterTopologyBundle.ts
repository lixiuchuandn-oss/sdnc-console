import { fetchHarvesterNodes } from 'services/harvester/clusterInventory';
import { fetchHarvesterResourceByLink } from 'services/harvester/resource';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import {
  fetchDatacenterRacks,
  type DatacenterRack,
} from '../../../../../../services/datacenterTopologyApi';
import {
  buildNodeMetricsMapFromK8sMetrics,
  type NodeLiveMetrics,
} from './physicalNodeRackUtils';
import { clearCache } from '../../../../../../utils/requestManager';
import { normalizeHarvesterNodesList, type HarvesterNodeRecord } from './datacenterTopologySectionUtils';
import {
  loadHarvesterAswSwitchesForTopology,
  type LoadHarvesterAswSwitchesOpts,
} from './loadHarvesterAswSwitchesForTopology';

const datacenterRacksCachePath = (cloudId: string) =>
  `/api/clouds/${cloudId}/datacenter-topology/racks`;

const nodeMetricsProxyPath = '/apis/metrics.k8s.io/v1beta1/nodes';

export type DatacenterTopologyBundle = {
  racks: DatacenterRack[];
  nodes: HarvesterNodeRecord[];
  switches: AswCtlSwitchProbeRecord[];
  nodeMetricsMap: Record<string, NodeLiveMetrics>;
};

export type LoadDatacenterTopologyBundleOpts = LoadHarvesterAswSwitchesOpts;

/** 机房拓扑：机柜 / 节点 / 交换机 / 节点 metrics（池 path load 与 Section 刷新共用） */
export async function loadDatacenterTopologyBundle(
  cloudId: string,
  force = false,
  opts?: LoadDatacenterTopologyBundleOpts,
): Promise<DatacenterTopologyBundle> {
  if (force && cloudId) {
    clearCache(datacenterRacksCachePath(cloudId), 'GET');
  }

  const [rackJson, nodeJson, switches] = await Promise.all([
    fetchDatacenterRacks(cloudId, force),
    fetchHarvesterNodes(cloudId, force).catch(() => null),
    loadHarvesterAswSwitchesForTopology(cloudId, { ...opts, force }),
  ]);

  const racks = Array.isArray(rackJson?.racks) ? rackJson.racks : [];
  const nodes = normalizeHarvesterNodesList(nodeJson);
  let nodeMetricsMap: Record<string, NodeLiveMetrics> = {};
  if (nodes.length > 0) {
    try {
      const res = await fetchHarvesterResourceByLink(cloudId, nodeMetricsProxyPath, force);
      const items =
        res && typeof res === 'object' && 'items' in res
          ? (res as { items?: unknown }).items
          : [];
      nodeMetricsMap = buildNodeMetricsMapFromK8sMetrics(items);
    } catch {
      nodeMetricsMap = {};
    }
  }

  return { racks, nodes, switches, nodeMetricsMap };
}
