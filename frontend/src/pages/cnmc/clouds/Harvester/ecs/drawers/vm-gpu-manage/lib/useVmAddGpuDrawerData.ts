/**
 * 添加 GPU 子抽屉：GPU 列表加载与热扩容提示（对齐 `useVmAddNicDrawerData` 职责）。
 */
import { useCallback, useMemo, useState } from "react";
import { fetchHarvesterGpuResources } from "../../../../../../../../services/harvesterApi";

export interface VmAddGpuDrawerBaseProps {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
}

export function useVmAddGpuDrawerData(opts: { vmData: any; cloudId: string }) {
  const { vmData, cloudId } = opts;
  const [localGpus, setLocalGpus] = useState<any[]>([]);

  const isHotPlugInProgress = useMemo(() => {
    const conditions = vmData?.status?.conditions || [];
    return conditions.some(
      (c: any) =>
        (c.type === "HotVCPUChange" || c.type === "HotMemoryChange") && c.status === "True",
    );
  }, [vmData]);

  const reloadGpuResources = useCallback(async () => {
    try {
      const res = await fetchHarvesterGpuResources(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : Array.isArray(res?.items) ? res.items : [];
      setLocalGpus(items);
      return items;
    } catch {
      return [];
    }
  }, [cloudId]);

  const ensureGpusLoaded = useCallback(async () => {
    if (Array.isArray(localGpus) && localGpus.length > 0) return localGpus;
    return await reloadGpuResources();
  }, [localGpus, reloadGpuResources]);

  return {
    localGpus,
    setLocalGpus,
    reloadGpuResources,
    ensureGpusLoaded,
    isHotPlugInProgress,
  };
}
