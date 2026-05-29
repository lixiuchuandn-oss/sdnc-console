/**
 * 拉取云主机实例列表，构建 Prometheus name → 云主机名称 映射（与 ECS 列表同源）。
 */
import { useEffect, useState } from 'react';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import {
  buildVmPrometheusNameToDisplayNameMap,
  buildVmSelectOptions,
  type VmSelectOption,
} from '../lib/vmDisplayNames';

export function useVmDisplayNameMap(cloudId: string, reloadToken: number) {
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [vmOptions, setVmOptions] = useState<VmSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!cloudId) {
      setNameMap({});
      setVmOptions([]);
      setLoading(false);
      setError(undefined);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    fetchCloudProviderEcs(cloudId, true)
      .then((res) => {
        if (cancelled) return;
        setNameMap(buildVmPrometheusNameToDisplayNameMap(res));
        setVmOptions(buildVmSelectOptions(res));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setNameMap({});
        setVmOptions([]);
        setError(e instanceof Error ? e.message : '云主机列表加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cloudId, reloadToken]);

  return { nameMap, vmOptions, loading, error };
}
