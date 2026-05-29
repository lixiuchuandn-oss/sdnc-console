import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  NodeDetailAlloc,
  NodeMetricUsage,
  NodeRequests,
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
        // 服务端聚合：仅回按节点名的小结果，避免把全集群 Pod 列表传回浏览器
        const { fetchHarvesterNodeResourceUsage } = await import('services/harvester/resource');
        const res = (await fetchHarvesterNodeResourceUsage(cloudId, force)) as {
          metrics?: Record<string, NodeMetricUsage>;
          requests?: Record<string, NodeRequests>;
          detail?: Record<string, NodeDetailAlloc>;
        } | null;

        if (!cancelled) {
          setMetricsMap(res?.metrics && typeof res.metrics === 'object' ? res.metrics : {});
          setRequestsMap(res?.requests && typeof res.requests === 'object' ? res.requests : {});
          setNodesDetailMap(res?.detail && typeof res.detail === 'object' ? res.detail : {});
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
