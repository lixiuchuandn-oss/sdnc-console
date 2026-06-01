import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchKubeOvnSubnets } from '../../../../../../services/harvesterApi';
import { buildSubnetByNameMap, parseKubeOvnSubnetsListResponse } from '../lib/nadsSectionUtils';

export function useNadsOvnSubnets(cloudId?: string) {
  const [ovnSubnets, setOvnSubnets] = useState<unknown[]>([]);
  const [ovnSubnetsLoading, setOvnSubnetsLoading] = useState(false);

  const loadOvnSubnets = useCallback(
    async (force = false): Promise<unknown[]> => {
      if (!cloudId) {
        setOvnSubnets([]);
        return [];
      }
      setOvnSubnetsLoading(true);
      try {
        const res = await fetchKubeOvnSubnets(cloudId, force);
        const list = parseKubeOvnSubnetsListResponse(res);
        setOvnSubnets(list);
        return list;
      } catch {
        setOvnSubnets([]);
        return [];
      } finally {
        setOvnSubnetsLoading(false);
      }
    },
    [cloudId],
  );

  useEffect(() => {
    void loadOvnSubnets(false);
  }, [loadOvnSubnets]);

  const subnetByNameLc = useMemo(() => buildSubnetByNameMap(ovnSubnets), [ovnSubnets]);

  return { ovnSubnets, ovnSubnetsLoading, loadOvnSubnets, subnetByNameLc };
}
