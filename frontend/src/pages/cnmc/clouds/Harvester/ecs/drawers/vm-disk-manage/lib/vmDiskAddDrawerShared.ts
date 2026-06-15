/**
 * 添加/挂载磁盘类抽屉的共用逻辑（数据加载、表单初值）。
 * 业务入口按功能拆分见：VmAddNewDiskDrawer / VmAttachExistingDiskDrawer / VmAttachCdromDrawer。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormInstance } from "antd/es/form";
import {
  fetchHarvesterAvailableVolumes,
  fetchHarvesterImages,
  fetchHarvesterNads,
  fetchHarvesterStorageClasses,
  fetchHarvesterVolume,
  getHarvesterImagesListItems,
} from "../../../../../../../../services/harvesterApi";
import { pickDefaultStorageClassName } from "../../../../../../../../utils/harvesterUtils";
import { buildStorageClassSelectOptions } from "../../../../ebs/lib/volumesStorageClassUtils";

export interface VmDiskAddDrawerBaseProps {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
}

/** 与 useVmAddDataDiskDrawerData 配套，区分三种入口 */
export type VmDiskAddDrawerPreset =
  | "new_disk"
  | "attach_existing"
  | "attach_cdrom";

function initAddDataDiskFormByPreset(
  form: FormInstance,
  preset: VmDiskAddDrawerPreset,
): void {
  if (preset === "attach_cdrom") {
    form.setFieldsValue({
      newCdromCreated: false,
      newCdromSize: 10,
      newCdromAccessMode: "ReadWriteMany",
      newCdromImage: undefined,
      newCdromName: undefined,
      newCdromClaimName: undefined,
      newCdromSc: undefined,
      newCdromBootFromCdrom: false,
    });
    return;
  }
  form.setFieldsValue({
    newDiskSource: preset === "attach_existing" ? "existing" : "create",
    newDiskCreated: false,
    newDiskMode: "spec",
    newDiskAccessMode: "ReadWriteMany",
    newDiskIsoImage: undefined,
    existingPvcName: undefined,
    newDiskBootFromCdrom: false,
    newDiskPvcClaimName: undefined,
  });
}

export function useVmAddDataDiskDrawerData(opts: {
  open: boolean;
  vmData: any;
  cloudId: string;
  preset: VmDiskAddDrawerPreset;
  form: FormInstance;
}) {
  const { open, vmData, cloudId, preset, form } = opts;
  const [latestVm, setLatestVm] = useState<any>(null);
  const [scs, setScs] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [nads, setNads] = useState<any[]>([]);
  const [availableDiskPvcs, setAvailableDiskPvcs] = useState<any[]>([]);
  const initOnceRef = useRef(false);

  const isHotPlugInProgress = useMemo(() => {
    const conditions = vmData?.status?.conditions || [];
    return conditions.some(
      (c: any) =>
        (c.type === "HotVCPUChange" || c.type === "HotMemoryChange") &&
        c.status === "True",
    );
  }, [vmData]);

  const reloadScs = useCallback(async () => {
    try {
      const res = await fetchHarvesterStorageClasses(cloudId);
      const items = Array.isArray(res?.data?.items)
        ? res.data.items
        : Array.isArray(res?.items)
          ? res.items
          : [];
      setScs(items);
    } catch {
      /* ignore */
    }
  }, [cloudId]);

  const reloadImages = useCallback(async () => {
    try {
      const res = await fetchHarvesterImages(cloudId);
      setImages(getHarvesterImagesListItems(res));
    } catch {
      /* ignore */
    }
  }, [cloudId]);

  const ensureNadsLoaded = useCallback(async () => {
    if (Array.isArray(nads) && nads.length > 0) return nads;
    try {
      const res = await fetchHarvesterNads(cloudId);
      const items = res?.data?.items || res?.items || [];
      setNads(items);
      return items;
    } catch {
      return [];
    }
  }, [cloudId, nads]);

  const loadAvailablePvcs = useCallback(async () => {
    const ns = String(vmData?.metadata?.namespace || "").trim();
    if (!cloudId || !ns) return;
    try {
      const res = await fetchHarvesterAvailableVolumes(cloudId, ns || undefined);
      const items =
        (res as any)?.data?.items || (res as any)?.items || [];
      const normalized = (Array.isArray(items) ? items : []).map(
        (x: any) => {
          const meta = x?.metadata || {};
          const ann = meta?.annotations || x?.annotations || {};
          const name = x?.pvcName || meta?.name || x?.name || "";
          const namespace =
            meta?.namespace || x?.namespace || x?.ns || ns || "";
          const alias = ann?.["tower.io/alias"] || x?.Alias || x?.alias || "";
          return { ...x, pvcName: name, namespace, alias };
        },
      );
      const enriched = await Promise.all(
        normalized.map(async (x: any) => {
          if (!x.namespace || !x.pvcName) return x;
          const raw = x?.rawData || x;
          const hasSpecSc = !!(
            raw?.spec?.storageClassName || x?.storageClassName
          );
          const modes = raw?.spec?.accessModes;
          const hasSpecModes = Array.isArray(modes) && modes.length > 0;
          if (hasSpecSc && hasSpecModes) return x;
          try {
            const detail: any = await fetchHarvesterVolume(
              cloudId,
              x.namespace,
              x.pvcName,
            );
            const pvc = detail?.data || detail;
            if (!pvc || typeof pvc !== "object" || !pvc.metadata) return x;
            const ann = pvc?.metadata?.annotations || {};
            const aliasFromPvc = ann?.["tower.io/alias"];
            return {
              ...x,
              alias: x.alias || aliasFromPvc || undefined,
              rawData: pvc,
            };
          } catch {
            return x;
          }
        }),
      );
      setAvailableDiskPvcs(enriched);
    } catch {
      setAvailableDiskPvcs([]);
    }
  }, [cloudId, vmData?.metadata?.namespace]);

  useEffect(() => {
    if (!open) {
      initOnceRef.current = false;
      return;
    }
    if (initOnceRef.current) return;
    if (!vmData || !cloudId) return;
    initOnceRef.current = true;
    setLatestVm(vmData);
    form.resetFields();
    initAddDataDiskFormByPreset(form, preset);
    void reloadScs();
    void reloadImages();
    void loadAvailablePvcs();
  }, [
    open,
    vmData,
    cloudId,
    preset,
    form,
    reloadScs,
    reloadImages,
    loadAvailablePvcs,
  ]);

  const defaultStorageClassName = useMemo(
    () => pickDefaultStorageClassName(scs),
    [scs],
  );

  const scOptions = useMemo(
    () => buildStorageClassSelectOptions(scs || []),
    [scs],
  );

  return {
    latestVm,
    setLatestVm,
    images,
    availableDiskPvcs,
    loadAvailablePvcs,
    reloadScs,
    reloadImages,
    ensureNadsLoaded,
    scOptions,
    defaultStorageClassName,
    isHotPlugInProgress,
  };
}
