import { useEffect, useMemo, useState } from 'react';
import { fetchLocalRegistries } from '../../../../../../../../services/localRegistryApi';
import {
  buildMergedRegistryList,
  DeployedLocalRegistryInput,
  loadHarvesterRegistriesFromLocalStorage,
  MergedRegistryEntry,
} from '../registryCredentials';

export function useMergedRegistryList(
  cloudId: string,
  secretsWithCredentials: unknown[] | undefined,
): MergedRegistryEntry[] {
  const localStorageRegistries = useMemo(() => loadHarvesterRegistriesFromLocalStorage(), []);
  const [deployedRegistries, setDeployedRegistries] = useState<DeployedLocalRegistryInput[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchLocalRegistries(cloudId)
      .then((res) => {
        if (cancelled) return;
        setDeployedRegistries(Array.isArray(res?.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setDeployedRegistries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudId]);

  return useMemo(
    () => buildMergedRegistryList(localStorageRegistries, secretsWithCredentials, deployedRegistries),
    [localStorageRegistries, secretsWithCredentials, deployedRegistries],
  );
}
