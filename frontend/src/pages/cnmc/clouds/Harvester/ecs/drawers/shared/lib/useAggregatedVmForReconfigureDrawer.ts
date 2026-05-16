import { useEffect, useState } from "react";
import {
  fetchHarvesterVMAggregated,
  fetchHarvesterVmDetail,
} from "../../../../../../../../services/harvesterApi";

/** 打开变配类抽屉时拉取聚合 VM（列表 `record` 往往偏旧；各抽屉可共用此 hook，避免重复请求）。 */
export function useAggregatedVmForReconfigureDrawer(
  open: boolean,
  cloudId: string,
  record: any | null,
) {
  const [latestVm, setLatestVm] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (!open || !cloudId || !record?.metadata?.name || !record?.metadata?.namespace) {
      if (!open) {
        setLatestVm(null);
        setFetchFailed(false);
        setLoading(false);
      }
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchFailed(false);
    setLatestVm(null);

    const applyVm = (updatedVm: any, related?: any) => {
      if (cancelled || !updatedVm) return;
      if (related) {
        updatedVm.related = related;
      }
      setLatestVm(updatedVm);
    };

    fetchHarvesterVMAggregated(cloudId, record.metadata.namespace, record.metadata.name)
      .then((res: any) => {
        const data = res?.data?.vm ? res.data : res;
        applyVm(data?.vm || data, data?.related);
      })
      .catch((err: any) => {
        console.error("Failed to fetch aggregated VM data:", err);
        return fetchHarvesterVmDetail(
          cloudId,
          record.metadata.namespace,
          record.metadata.name,
        )
          .then((res: any) => {
            applyVm(res?.data || res);
          })
          .catch((fallbackErr: any) => {
            console.error("回退获取也失败:", fallbackErr);
            if (!cancelled) setFetchFailed(true);
          });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    cloudId,
    record?.metadata?.namespace,
    record?.metadata?.name,
    record?.metadata?.resourceVersion,
  ]);

  return { latestVm, setLatestVm, loading, fetchFailed };
}
