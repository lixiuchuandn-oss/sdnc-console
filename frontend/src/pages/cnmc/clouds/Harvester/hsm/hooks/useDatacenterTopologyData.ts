import { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { fetchAswCtlSwitchesSummary } from 'services/harvester/cluster';
import { fetchHarvesterNodes } from 'services/harvester/clusterInventory';
import { fetchHarvesterResourceByLink } from 'services/harvester/resource';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import {
  fetchDatacenterRacks,
  type DatacenterRack,
} from '../../../../../../services/datacenterTopologyApi';
import {
  buildHarvesterNodeSelectOptions,
  buildNodeMetricsMapFromK8sMetrics,
  buildSwitchSelectOptions,
  normalizeHarvesterNodesList,
  type HarvesterNodeRecord,
} from '../lib/datacenterTopologySectionUtils';
import type { NodeLiveMetrics } from '../lib/physicalNodeRackUtils';

/** 机房拓扑：机柜 / 节点 / 交换机 / 节点 metrics 拉取与选项构建 */
export function useDatacenterTopologyData(cloudId: string) {
  const [loading, setLoading] = useState(true);
  const [racks, setRacks] = useState<DatacenterRack[]>([]);
  const [nodes, setNodes] = useState<HarvesterNodeRecord[]>([]);
  const [switches, setSwitches] = useState<AswCtlSwitchProbeRecord[]>([]);
  const [nodeMetricsMap, setNodeMetricsMap] = useState<Record<string, NodeLiveMetrics>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rackJson, nodeJson, swCache] = await Promise.all([
        fetchDatacenterRacks(cloudId),
        fetchHarvesterNodes(cloudId, false).catch(() => null),
        fetchAswCtlSwitchesSummary(cloudId).catch(() => null),
      ]);
      setRacks(Array.isArray(rackJson?.racks) ? rackJson.racks : []);
      const nodeList = normalizeHarvesterNodesList(nodeJson);
      setNodes(nodeList);
      setNodeMetricsMap({});
      if (nodeList.length > 0) {
        try {
          const res = await fetchHarvesterResourceByLink(
            cloudId,
            '/apis/metrics.k8s.io/v1beta1/nodes',
          );
          const items =
            res && typeof res === 'object' && 'items' in res
              ? (res as { items?: unknown }).items
              : [];
          setNodeMetricsMap(buildNodeMetricsMapFromK8sMetrics(items));
        } catch {
          setNodeMetricsMap({});
        }
      }
      setSwitches(Array.isArray(swCache?.items) ? swCache.items : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '加载失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const nodeOptions = useMemo(() => buildHarvesterNodeSelectOptions(nodes), [nodes]);
  const switchOptions = useMemo(() => buildSwitchSelectOptions(switches), [switches]);

  return {
    loading,
    racks,
    nodes,
    switches,
    nodeMetricsMap,
    loadAll,
    nodeOptions,
    switchOptions,
  };
}
