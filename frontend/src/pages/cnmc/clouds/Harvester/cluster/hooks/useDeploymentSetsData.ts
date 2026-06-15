import { useCallback, useEffect, useState } from 'react';
import {
  fetchDeploymentSetOverview,
  type DeploymentSetOverview,
} from 'services/harvester/deploymentSets';

export function useDeploymentSetsData(cloudId: string, enabled: boolean) {
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<DeploymentSetOverview | null>(null);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(
    async (force?: boolean) => {
      if (!cloudId || !enabled) return;
      setLoading(true);
      setError(undefined);
      try {
        const json = await fetchDeploymentSetOverview(cloudId, !!force);
        const data = (json as { data?: DeploymentSetOverview })?.data ?? null;
        setOverview(data);
      } catch (e: unknown) {
        const err = e as { message?: string };
        setError(err?.message || '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [cloudId, enabled],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return { loading, overview, error, reload: load };
}
