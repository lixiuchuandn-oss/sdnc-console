/**
 * Rancher 集群上下文下，拉取工作负载数量用于侧栏徽标。
 * 从 AdminLayout 原样抽出为 hook；行为与原内联实现一致（rancherClusterCtx 变化时重新拉取，可取消）。
 */
import { useEffect, useState } from 'react';
import { apiRequest } from '../../../services/api';
import type { RancherClusterWorkloadsSubKey } from '../rancher/rancherClusterSidebar';

type RancherClusterCtx = { poolId: string; clusterId: string } | null;

export function useRancherSidebarCounts(rancherClusterCtx: RancherClusterCtx) {
  const [rancherWorkloadCounts, setRancherWorkloadCounts] = useState<
    Partial<Record<RancherClusterWorkloadsSubKey, number>>
  >({});

  useEffect(() => {
    if (!rancherClusterCtx) {
      setRancherWorkloadCounts({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const j = await apiRequest(
          `/api/clouds/${encodeURIComponent(rancherClusterCtx.poolId)}/rancher/clusters/${encodeURIComponent(rancherClusterCtx.clusterId)}/workloads/counts`,
          { skipCache: true },
        );
        const c = j?.data?.counts;
        if (cancelled || !c || typeof c !== 'object') return;
        setRancherWorkloadCounts(c as Partial<Record<RancherClusterWorkloadsSubKey, number>>);
      } catch {
        if (!cancelled) setRancherWorkloadCounts({});
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [rancherClusterCtx]);

  return rancherWorkloadCounts;
}
