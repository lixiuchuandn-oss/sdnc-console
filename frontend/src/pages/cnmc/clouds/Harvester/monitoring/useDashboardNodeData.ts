/**
 * 概览 - 节点/指标/存储 统一请求与轮询（10s）
 * 依赖 cloudId，请求 /api/clouds/:id/monitoring/*
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  fetchNodeResources,
  fetchNodeMetrics,
  fetchStorageNodes,
} from '../../../../../services/monitoringApi';
import type { NodeResourcesData, NodeMetricsData } from './utils/nodeResourceMetrics';

const POLL_INTERVAL_SUCCESS_SEC = 10;
const POLL_INTERVAL_ERROR_SEC = 15;

export interface DashboardNodeDataState {
  nodeResources: NodeResourcesData | null;
  nodeMetrics: NodeMetricsData | null;
  storageNodes: unknown;
  loading: boolean;
  error: string | null;
}

export function useDashboardNodeData(cloudId: string | undefined): DashboardNodeDataState {
  const [state, setState] = useState<DashboardNodeDataState>({
    nodeResources: null,
    nodeMetrics: null,
    storageNodes: null,
    loading: !!cloudId,
    error: null,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const isFetchingRef = useRef(false);

  const runFetch = useCallback(
    (isBackground: boolean) => {
      if (!cloudId) {
        setState((s) => ({ ...s, loading: false, error: '缺少 cloudId' }));
        return;
      }
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      if (!isBackground) {
        setState((s) => ({ ...s, loading: true, error: null }));
      }
      const ctrl = new AbortController();
      const signal = ctrl.signal;
      const opts = { signal };

      // 使用 Promise.allSettled 确保单个请求失败不会阻塞其他请求
      Promise.allSettled([
        fetchNodeResources(cloudId, opts),
        fetchNodeMetrics(cloudId, opts),
        fetchStorageNodes(cloudId, opts),
      ])
        .then(([resourcesResult, metricsResult, storageResult]) => {
          if (!mountedRef.current || signal.aborted) return;
          
          // 处理每个请求的结果，单个失败不影响其他
          const resourcesRes = resourcesResult.status === 'fulfilled' ? resourcesResult.value : { ok: false, error: resourcesResult.reason?.message || '请求失败', data: null };
          const metricsRes = metricsResult.status === 'fulfilled' ? metricsResult.value : { ok: false, error: metricsResult.reason?.message || '请求失败', data: null };
          const storageRes = storageResult.status === 'fulfilled' ? storageResult.value : { ok: false, error: storageResult.reason?.message || '请求失败', data: null };
          
          const errMsg = !resourcesRes.ok
            ? resourcesRes.error
            : !metricsRes.ok
              ? metricsRes.error
              : !storageRes.ok
                ? storageRes.error
                : null;
          setState({
            nodeResources: resourcesRes.ok ? (resourcesRes.data as NodeResourcesData) : null,
            nodeMetrics: metricsRes.ok ? (metricsRes.data as NodeMetricsData) : null,
            storageNodes: storageRes.ok ? storageRes.data : null,
            loading: false,
            error: errMsg ?? null,
          });
          const delayMs = errMsg ? POLL_INTERVAL_ERROR_SEC * 1000 : POLL_INTERVAL_SUCCESS_SEC * 1000;
          timerRef.current = setTimeout(() => runFetch(true), delayMs);
        })
        .catch((err) => {
          if (!mountedRef.current || signal.aborted) return;
          setState((s) => ({
            ...s,
            loading: false,
            error: err?.message ?? '请求失败',
          }));
          timerRef.current = setTimeout(() => runFetch(true), POLL_INTERVAL_ERROR_SEC * 1000);
        })
        .finally(() => {
          isFetchingRef.current = false;
        });

      return () => ctrl.abort();
    },
    [cloudId]
  );

  useEffect(() => {
    mountedRef.current = true;
    runFetch(false);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [runFetch]);

  return state;
}
