/**
 * 拉取云主机实例列表，构建 Prometheus name → 云主机名称 映射（与 ECS 列表同源）。
 */
import { useEffect, useRef, useState } from 'react';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import {
  buildVmPrometheusNameToDisplayNameMap,
  buildVmSelectOptions,
  type VmSelectOption,
} from '../lib/vmDisplayNames';

export function useVmDisplayNameMap(cloudId: string, reloadToken: number) {
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [vmOptions, setVmOptions] = useState<VmSelectOption[]>([]);
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!cloudId) {
      setNameMap({});
      setVmOptions([]);
      setInitialLoading(false);
      setRefreshing(false);
      setError(undefined);
      hasLoadedRef.current = false;
      return;
    }

    let cancelled = false;
    const isRefresh = hasLoadedRef.current;
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setInitialLoading(true);
    }
    setError(undefined);

    fetchCloudProviderEcs(cloudId, true)
      .then((res) => {
        if (cancelled) return;
        setNameMap(buildVmPrometheusNameToDisplayNameMap(res));
        setVmOptions(buildVmSelectOptions(res));
        hasLoadedRef.current = true;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (!isRefresh) {
          setNameMap({});
          setVmOptions([]);
        }
        setError(e instanceof Error ? e.message : '云主机列表加载失败');
      })
      .finally(() => {
        if (!cancelled) {
          setInitialLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cloudId, reloadToken]);

  useEffect(() => {
    hasLoadedRef.current = false;
  }, [cloudId]);

  return {
    nameMap,
    vmOptions,
    loading: initialLoading,
    initialLoading,
    refreshing,
    error,
  };
}
