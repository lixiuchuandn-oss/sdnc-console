import { useCallback, useEffect, useState } from 'react';
import { fetchCloudById } from '../../../../../services/api';
import { fetchMaasDashboard, type MaasDashboardResponse } from '../../../../../services/maasApi';
import type { Cloud } from '../../../pools/lib/poolProviders';
import { MAAS_DASHBOARD_POLL_MS } from '../lib/maasDashboardUtils';

export function useMaasDashboard(poolId: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [data, setData] = useState<MaasDashboardResponse | null>(null);
  const [cloud, setCloud] = useState<Cloud | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!poolId) return;
      if (!opts?.silent) {
        setLoading(true);
        setError(null);
        setWarn(null);
      }
      try {
        const [dashRes, cloudRes] = await Promise.all([
          fetchMaasDashboard(poolId, { skipCache: true }),
          fetchCloudById(poolId, { skipCache: true }),
        ]);
        setData(dashRes);
        setCloud((cloudRes as Cloud) || null);
        if (!dashRes?.ok) {
          if (!opts?.silent) setError(dashRes?.message || '拉取概览失败');
          return;
        }
        if (!opts?.silent && dashRes.message) setWarn(dashRes.message);
      } catch (e: unknown) {
        if (!opts?.silent) {
          setError(e instanceof Error ? e.message : '加载概览失败');
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [poolId],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load({ silent: true }), MAAS_DASHBOARD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const connected = !!data?.region?.connected;

  return {
    loading,
    error,
    warn,
    data,
    cloud,
    connected,
    load,
    machines: data?.machines,
    regionCtrl: data?.controllers?.region ?? [],
    rackCtrl: data?.controllers?.rack ?? [],
  };
}
