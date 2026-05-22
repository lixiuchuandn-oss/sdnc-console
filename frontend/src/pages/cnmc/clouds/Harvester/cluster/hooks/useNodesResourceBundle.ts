import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseCpuToCores,
  parseMemoryToBytes,
  type NodeDetailAlloc,
  type NodeMetricUsage,
  type NodeRequests,
} from '../lib/nodesSectionUtils';

/**
 * 并行拉取节点 metrics、全集群 Pod requests 聚合、节点 allocatable/capacity；
 * 含周期刷新、列表就绪对齐与显式 reload（force 时跳过前端 GET 缓存并带 proxy force）。
 */
export function useNodesResourceBundle(params: {
  cloudId?: string;
  nodesLoading: boolean;
  nodesLength: number;
}) {
  const { cloudId, nodesLoading, nodesLength } = params;

  const [metricsMap, setMetricsMap] = useState<Record<string, NodeMetricUsage>>({});
  const [requestsMap, setRequestsMap] = useState<Record<string, NodeRequests>>({});
  const [nodesDetailMap, setNodesDetailMap] = useState<Record<string, NodeDetailAlloc>>({});
  const [resourceLoading, setResourceLoading] = useState(true);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const forceNextLoadRef = useRef(false);

  const reload = useCallback((force = false) => {
    if (force) forceNextLoadRef.current = true;
    setResourceLoading(true);
    setRefreshCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const clearStores = () => {
      setMetricsMap({});
      setRequestsMap({});
      setNodesDetailMap({});
    };

    const load = async () => {
      if (!cloudId) {
        if (!cancelled) {
          clearStores();
          setResourceLoading(false);
        }
        return;
      }

      const force = forceNextLoadRef.current;
      forceNextLoadRef.current = false;

      try {
        const { fetchHarvesterResourceByLink } = await import('services/harvester/resource');

        const [metricsRes, podsRes, nodesRes] = await Promise.all([
          fetchHarvesterResourceByLink(cloudId, '/apis/metrics.k8s.io/v1beta1/nodes', force),
          fetchHarvesterResourceByLink(cloudId, '/api/v1/pods?allNamespaces=true', force),
          fetchHarvesterResourceByLink(cloudId, '/api/v1/nodes', force),
        ]);

        const metricsItems: unknown[] = Array.isArray((metricsRes as { items?: unknown })?.items)
          ? (metricsRes as { items: unknown[] }).items
          : [];
        const nextMetrics: Record<string, NodeMetricUsage> = {};
        for (const it of metricsItems) {
          const row = it as {
            metadata?: { name?: string };
            usage?: { cpu?: string; memory?: string };
          };
          const name = row?.metadata?.name || '';
          if (!name) continue;
          nextMetrics[name] = {
            cpuUsedCores: parseCpuToCores(row?.usage?.cpu),
            memUsedBytes: parseMemoryToBytes(row?.usage?.memory),
          };
        }

        const nodesItems: unknown[] = Array.isArray((nodesRes as { items?: unknown })?.items)
          ? (nodesRes as { items: unknown[] }).items
          : [];
        const nextDetail: Record<string, NodeDetailAlloc> = {};
        for (const node of nodesItems) {
          const n = node as {
            metadata?: { name?: string };
            status?: {
              allocatable?: { cpu?: string; memory?: string };
              capacity?: { cpu?: string; memory?: string };
            };
          };
          const name = n?.metadata?.name || '';
          if (!name) continue;
          nextDetail[name] = {
            allocatableCpu: n?.status?.allocatable?.cpu,
            allocatableMemory: n?.status?.allocatable?.memory,
            capacityCpu: n?.status?.capacity?.cpu,
            capacityMemory: n?.status?.capacity?.memory,
          };
        }

        type ContainerRes = {
          resources?: {
            requests?: { cpu?: string; memory?: string };
            limits?: { cpu?: string; memory?: string };
          };
        };
        const podsItems: unknown[] = Array.isArray((podsRes as { items?: unknown })?.items)
          ? (podsRes as { items: unknown[] }).items
          : [];
        const nextRequests: Record<string, NodeRequests> = {};
        for (const pod of podsItems) {
          const p = pod as {
            spec?: {
              nodeName?: string;
              containers?: ContainerRes[];
              initContainers?: ContainerRes[];
            };
          };
          const nodeName = p?.spec?.nodeName || '';
          if (!nodeName) continue;

          if (!nextRequests[nodeName]) {
            nextRequests[nodeName] = { cpuRequestCores: 0, memRequestBytes: 0 };
          }

          const containers = Array.isArray(p?.spec?.containers) ? p.spec!.containers : [];
          const initContainers = Array.isArray(p?.spec?.initContainers) ? p.spec!.initContainers : [];

          for (const c of [...containers, ...initContainers]) {
            const requests = c?.resources?.requests || {};
            const limits = c?.resources?.limits || {};
            const cpuReq = requests?.cpu || limits?.cpu;
            const memReq = requests?.memory || limits?.memory;

            nextRequests[nodeName].cpuRequestCores =
              (nextRequests[nodeName].cpuRequestCores || 0) + parseCpuToCores(cpuReq);
            nextRequests[nodeName].memRequestBytes =
              (nextRequests[nodeName].memRequestBytes || 0) + parseMemoryToBytes(memReq);
          }
        }

        if (!cancelled) {
          setMetricsMap(nextMetrics);
          setRequestsMap(nextRequests);
          setNodesDetailMap(nextDetail);
          setResourceLoading(false);
        }
      } catch {
        if (!cancelled) {
          clearStores();
          setResourceLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [cloudId, refreshCounter]);

  useEffect(() => {
    const interval = setInterval(() => {
      reload(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [reload]);

  useEffect(() => {
    if (!nodesLoading && nodesLength > 0) {
      const timer = setTimeout(() => {
        reload(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [nodesLoading, nodesLength, reload]);

  return { metricsMap, requestsMap, nodesDetailMap, resourceLoading, reload };
}
