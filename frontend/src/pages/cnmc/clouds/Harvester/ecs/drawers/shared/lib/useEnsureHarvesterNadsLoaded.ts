import { useCallback, useState } from "react";
import { fetchHarvesterNads } from "../../../../../../../../services/harvesterApi";

/** 按 cloudId 缓存 NAD 列表；变配提交前网卡预检等可复用，避免重复拉取。 */
export function useEnsureHarvesterNadsLoaded(cloudId: string) {
  const [nads, setNads] = useState<any[]>([]);

  const reloadNads = useCallback(async () => {
    try {
      const res = await fetchHarvesterNads(cloudId);
      const items = res?.data?.items || res?.items || [];
      setNads(items);
      return items;
    } catch (e) {
      console.error(e);
      return [];
    }
  }, [cloudId]);

  const ensureNadsLoaded = useCallback(async () => {
    if (Array.isArray(nads) && nads.length > 0) return nads;
    return await reloadNads();
  }, [nads, reloadNads]);

  return { ensureNadsLoaded, nads, reloadNads };
}
