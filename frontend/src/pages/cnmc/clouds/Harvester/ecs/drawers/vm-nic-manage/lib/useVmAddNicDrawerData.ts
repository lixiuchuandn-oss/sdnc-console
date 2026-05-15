/**
 * 添加网卡类抽屉：NAD / VPC / 子网数据加载与热扩容判断（各 VmAddNic*Drawer 共用）。
 */
import { useCallback, useMemo, useState } from "react";
import {
  fetchHarvesterNads,
  fetchKubeOvnSubnets,
  fetchKubeOvnVpcs,
} from "../../../../../../../../services/harvesterApi";

export interface VmAddNicDrawerBaseProps {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
}

export function useVmAddNicDrawerData(opts: { vmData: any; cloudId: string }) {
  const { vmData, cloudId } = opts;
  const [localNads, setLocalNads] = useState<any[]>([]);
  const [localVpcs, setLocalVpcs] = useState<any[]>([]);
  const [localSubnets, setLocalSubnets] = useState<any[]>([]);

  const isHotPlugInProgress = useMemo(() => {
    const conditions = vmData?.status?.conditions || [];
    return conditions.some(
      (c: any) =>
        (c.type === "HotVCPUChange" || c.type === "HotMemoryChange") &&
        c.status === "True",
    );
  }, [vmData]);

  const reloadNads = useCallback(async () => {
    try {
      const res = await fetchHarvesterNads(cloudId);
      const items = res?.data?.items || res?.items || [];
      setLocalNads(items);
      return items;
    } catch {
      return [];
    }
  }, [cloudId]);

  const reloadVpcs = useCallback(async () => {
    try {
      const res = await fetchKubeOvnVpcs(cloudId);
      const items = res?.data?.items || res?.items || [];
      setLocalVpcs(items);
      return items;
    } catch {
      return [];
    }
  }, [cloudId]);

  const reloadSubnets = useCallback(async () => {
    try {
      const res = await fetchKubeOvnSubnets(cloudId);
      const items = res?.data?.items || res?.items || [];
      setLocalSubnets(items);
      return items;
    } catch {
      return [];
    }
  }, [cloudId]);

  const ensureNadsLoaded = useCallback(async () => {
    if (Array.isArray(localNads) && localNads.length > 0) return localNads;
    return await reloadNads();
  }, [localNads, reloadNads]);

  return {
    cloudId,
    localNads,
    localVpcs,
    localSubnets,
    setLocalNads,
    setLocalVpcs,
    setLocalSubnets,
    reloadNads,
    reloadVpcs,
    reloadSubnets,
    ensureNadsLoaded,
    isHotPlugInProgress,
  };
}
