import { useEffect, useState } from 'react';
import { fetchHarvesterResourceByLink } from 'services/harvester/resource';
import {
  parseCpuToCores,
  parseMemoryToBytes,
} from './harvesterNodeResourceUtils';

export type HarvesterNodeMetricsMap = Record<
  string,
  { cpuUsedCores?: number; memUsedBytes?: number }
>;

export type HarvesterNodeRequestsMap = Record<
  string,
  { cpuRequestCores?: number; memRequestBytes?: number }
>;

export type HarvesterNodesDetailMap = Record<
  string,
  {
    allocatableCpu?: string;
    allocatableMemory?: string;
    capacityCpu?: string;
    capacityMemory?: string;
  }
>;

/** 拉取节点 metrics / Pod requests / 节点 capacity，供主机选择表展示资源占用。 */
export function useHarvesterNodeResourceMaps(cloudId?: string) {
  const [metricsMap, setMetricsMap] = useState<HarvesterNodeMetricsMap>({});
  const [requestsMap, setRequestsMap] = useState<HarvesterNodeRequestsMap>({});
  const [nodesDetailMap, setNodesDetailMap] = useState<HarvesterNodesDetailMap>({});
  const [resourceLoading, setResourceLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!cloudId || cloudId === 'all') {
      setMetricsMap({});
      setRequestsMap({});
      setNodesDetailMap({});
      setResourceLoading(false);
      return;
    }

    const load = async () => {
      setResourceLoading(true);
      try {
        const [metricsRes, podsRes, nodesRes] = await Promise.all([
          fetchHarvesterResourceByLink(
            cloudId,
            '/apis/metrics.k8s.io/v1beta1/nodes',
          ),
          fetchHarvesterResourceByLink(
            cloudId,
            '/api/v1/pods?allNamespaces=true',
          ),
          fetchHarvesterResourceByLink(cloudId, '/api/v1/nodes'),
        ]);

        const metricsItems: any[] = Array.isArray((metricsRes as any)?.items)
          ? (metricsRes as any).items
          : [];
        const newMetricsMap: HarvesterNodeMetricsMap = {};
        for (const it of metricsItems) {
          const name = it?.metadata?.name || '';
          if (!name) continue;
          newMetricsMap[name] = {
            cpuUsedCores: parseCpuToCores(it?.usage?.cpu),
            memUsedBytes: parseMemoryToBytes(it?.usage?.memory),
          };
        }

        const podsItems: any[] = Array.isArray((podsRes as any)?.items)
          ? (podsRes as any).items
          : [];
        const newRequestsMap: HarvesterNodeRequestsMap = {};
        for (const pod of podsItems) {
          const nodeName = pod?.spec?.nodeName || '';
          if (!nodeName) continue;
          if (!newRequestsMap[nodeName]) {
            newRequestsMap[nodeName] = { cpuRequestCores: 0, memRequestBytes: 0 };
          }
          const containers = Array.isArray(pod?.spec?.containers)
            ? pod.spec.containers
            : [];
          const initContainers = Array.isArray(pod?.spec?.initContainers)
            ? pod.spec.initContainers
            : [];
          for (const container of [...containers, ...initContainers]) {
            const requests = container?.resources?.requests || {};
            const limits = container?.resources?.limits || {};
            newRequestsMap[nodeName].cpuRequestCores =
              (newRequestsMap[nodeName].cpuRequestCores || 0) +
              parseCpuToCores(requests?.cpu || limits?.cpu);
            newRequestsMap[nodeName].memRequestBytes =
              (newRequestsMap[nodeName].memRequestBytes || 0) +
              parseMemoryToBytes(requests?.memory || limits?.memory);
          }
        }

        const nodesItems: any[] = Array.isArray((nodesRes as any)?.items)
          ? (nodesRes as any).items
          : [];
        const newNodesDetailMap: HarvesterNodesDetailMap = {};
        for (const nodeItem of nodesItems) {
          const name = nodeItem?.metadata?.name || '';
          if (!name) continue;
          newNodesDetailMap[name] = {
            allocatableCpu: nodeItem?.status?.allocatable?.cpu,
            allocatableMemory: nodeItem?.status?.allocatable?.memory,
            capacityCpu: nodeItem?.status?.capacity?.cpu,
            capacityMemory: nodeItem?.status?.capacity?.memory,
          };
        }

        if (!cancelled) {
          setMetricsMap(newMetricsMap);
          setRequestsMap(newRequestsMap);
          setNodesDetailMap(newNodesDetailMap);
        }
      } catch {
        if (!cancelled) {
          setMetricsMap({});
          setRequestsMap({});
          setNodesDetailMap({});
        }
      } finally {
        if (!cancelled) setResourceLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [cloudId]);

  return { metricsMap, requestsMap, nodesDetailMap, resourceLoading };
}
