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

  useEffect(() => {
    if (!open || !cloudId || !record?.metadata?.name || !record?.metadata?.namespace) {
      if (!open) setLatestVm(null);
      return;
    }
    fetchHarvesterVMAggregated(cloudId, record.metadata.namespace, record.metadata.name)
      .then((res: any) => {
        const data = res?.data?.vm ? res.data : res;
        const updatedVm = data?.vm || data;
        if (updatedVm && data?.related) {
          updatedVm.related = data.related;
        }
        setLatestVm(updatedVm);
      })
      .catch((err: any) => {
        console.error("Failed to fetch aggregated VM data:", err);
        fetchHarvesterVmDetail(cloudId, record.metadata.namespace, record.metadata.name)
          .then((res: any) => {
            setLatestVm(res?.data || res);
          })
          .catch((fallbackErr: any) => {
            console.error("回退获取也失败:", fallbackErr);
          });
      });
  }, [open, cloudId, record?.metadata?.namespace, record?.metadata?.name]);

  return { latestVm, setLatestVm };
}
