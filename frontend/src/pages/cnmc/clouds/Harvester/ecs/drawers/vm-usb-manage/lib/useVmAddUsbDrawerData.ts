/**
 * 添加 USB 子抽屉：USB 列表加载与热扩容提示（对齐 useVmAddGpuDrawerData）。
 */
import { useCallback, useMemo, useState } from "react";
import { fetchHarvesterUsbResources } from "../../../../../../../../services/harvesterApi";

export function useVmAddUsbDrawerData(opts: { vmData: any; cloudId: string }) {
  const { vmData, cloudId } = opts;
  const [localUsbs, setLocalUsbs] = useState<any[]>([]);

  const isHotPlugInProgress = useMemo(() => {
    const conditions = vmData?.status?.conditions || [];
    return conditions.some(
      (c: any) =>
        (c.type === "HotVCPUChange" || c.type === "HotMemoryChange") && c.status === "True",
    );
  }, [vmData]);

  const reloadUsbResources = useCallback(async () => {
    try {
      const res = await fetchHarvesterUsbResources(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : Array.isArray(res?.items) ? res.items : [];
      setLocalUsbs(items);
      return items;
    } catch {
      return [];
    }
  }, [cloudId]);

  const ensureUsbsLoaded = useCallback(async () => {
    if (Array.isArray(localUsbs) && localUsbs.length > 0) return localUsbs;
    return await reloadUsbResources();
  }, [localUsbs, reloadUsbResources]);

  return {
    localUsbs,
    setLocalUsbs,
    reloadUsbResources,
    ensureUsbsLoaded,
    isHotPlugInProgress,
  };
}
