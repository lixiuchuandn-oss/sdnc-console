import { useEffect, useMemo, useState } from 'react';
import { getHarborRegistries } from '../../../../../../../../services/harvesterApi';
import { fetchLocalRegistries } from '../../../../../../../../services/localRegistryApi';
import {
  buildMergedRegistryList,
  DeployedLocalRegistryInput,
  HarborRegistryInput,
  loadHarvesterRegistriesFromLocalStorage,
  MergedRegistryEntry,
} from '../registryCredentials';

export function useMergedRegistryList(cloudId: string): MergedRegistryEntry[] {
  const localStorageRegistries = useMemo(
    () => loadHarvesterRegistriesFromLocalStorage(cloudId),
    [cloudId],
  );
  const [deployedRegistries, setDeployedRegistries] = useState<DeployedLocalRegistryInput[]>([]);
  const [harborRegistries, setHarborRegistries] = useState<HarborRegistryInput[]>([]);

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

  useEffect(() => {
    let cancelled = false;
    void getHarborRegistries(cloudId)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        setHarborRegistries(list);
      })
      .catch(() => {
        if (!cancelled) setHarborRegistries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudId]);

  return useMemo(
    () =>
      buildMergedRegistryList(localStorageRegistries, deployedRegistries, harborRegistries),
    [localStorageRegistries, deployedRegistries, harborRegistries],
  );
}
