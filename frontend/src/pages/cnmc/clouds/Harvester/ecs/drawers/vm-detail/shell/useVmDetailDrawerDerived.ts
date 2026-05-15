import { useMemo } from "react";
import type { VmDetailDrawerSafeRead } from "../../../lib/vmSafeRead";
import { deriveVmGpuDisplayEntries } from "../../vm-gpu-manage/lib/deriveVmGpuEditorState";
import { rowDisplayForUsbResourceName } from "../../vm-usb-manage/lib/normalizeUsbResources";

/**
 * 详情抽屉派生展示状态：运行态/热扩容/设备列表等（vmData + SafeRead；GPU/USB 辅助信息依赖对应资源列表）。
 */
export function useVmDetailDrawerDerived(
  vmData: any,
  SafeRead: VmDetailDrawerSafeRead,
  gpuResources: any[] | undefined,
  usbResources: any[] | undefined,
  pciDevices: any[] | undefined,
) {
  const status = String(SafeRead.status(vmData)).toLowerCase();

  const vmGeneration = vmData?.metadata?.generation;
  const observedGeneration =
    vmData?.status?.observedGeneration ??
    vmData?.status?.desiredGeneration ??
    vmData?.status?.lastObservedGeneration;

  const hasGenerationInfo =
    typeof vmGeneration === "number" && typeof observedGeneration === "number";

  const isConfigOutOfSync =
    hasGenerationInfo && vmGeneration > observedGeneration;

  const annotations = vmData?.metadata?.annotations || {};
  const conditions = vmData?.status?.conditions || [];

  const isHotPlugConfigured =
    annotations["harvesterhci.io/enableCPUAndMemoryHotplug"]?.toLowerCase() ===
    "true";

  const hasRestartRequired = conditions.some(
    (c: any) => c.type === "RestartRequired" && c.status === "True",
  );

  const hasHotPlugChangeInProgress = conditions.some(
    (c: any) =>
      (c.type === "HotVCPUChange" || c.type === "HotMemoryChange") &&
      c.status === "True",
  );

  const vmi = vmData?.vmi || vmData?.vmiRaw;
  const vmiConditions = vmi?.status?.conditions || [];
  const isMigratable = vmiConditions.some(
    (c: any) =>
      (c.type === "LiveMigratable" ||
        c.type === "VirtualMachineInstanceIsMigratable") &&
      c.status === "True",
  );

  const isHotPlugEffective =
    isHotPlugConfigured &&
    !hasRestartRequired &&
    !hasHotPlugChangeInProgress &&
    isMigratable;

  const isHotPlugPendingRestart =
    isHotPlugConfigured && hasRestartRequired && !hasHotPlugChangeInProgress;

  const isHotPlugInProgress = isHotPlugConfigured && hasHotPlugChangeInProgress;
  const isStopped = ["stopped", "shutoff", "down", "offline"].includes(status);
  const isRunning = ["running"].includes(status);
  const isPaused = ["paused"].includes(status);
  const isMigrating =
    status === "Migrating" || status.toLowerCase() === "migrating";

  const hotPlugCpuError = conditions.find(
    (c: any) =>
      c.type === "Failure" &&
      c.reason === "HotPlugCPUError" &&
      c.status === "True",
  );

  const vmDisks = SafeRead.volumeDetails(vmData);
  const vmNics = SafeRead.interfaces(vmData);

  const vmPassthroughNics = useMemo(
    () => SafeRead.passthroughNics(vmData, pciDevices ?? []),
    [vmData, SafeRead, pciDevices],
  );

  const vmDeviceAlloc = useMemo(() => {
    const domain = vmData?.spec?.template?.spec?.domain;
    const devices = domain?.devices || {};

    let allocation: any = null;
    try {
      const raw =
        vmData?.metadata?.annotations?.[
          "harvesterhci.io/deviceAllocationDetails"
        ];
      if (raw) allocation = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      allocation = null;
    }
    const hostAlloc = allocation?.hostdevices || {};
    return { hostAlloc, devices };
  }, [vmData]);

  const vmGpus = useMemo(() => {
    if (!Array.isArray(gpuResources)) return [];
    return deriveVmGpuDisplayEntries(vmData, gpuResources);
  }, [vmData, gpuResources]);

  const vmUsb = useMemo(() => {
    const isUsb = (x: any) => {
      const dn = String(x?.deviceName || "").toLowerCase();
      const n = String(x?.name || "").toLowerCase();
      return dn.includes("usb") || n.includes("usb");
    };
    const hostDevices = Array.isArray(vmDeviceAlloc?.devices?.hostDevices)
      ? vmDeviceAlloc.devices.hostDevices
      : [];
    const base = hostDevices
      .filter((d: any) => isUsb(d))
      .map((d: any) => ({
        kind: "hostDevices",
        deviceName: d?.deviceName,
        name: d?.name,
      }))
      .filter((x: any) => x?.deviceName || x?.name)
      .map((x: any) => {
        const allocNames = Array.isArray(
          vmDeviceAlloc?.hostAlloc?.[x.deviceName],
        )
          ? vmDeviceAlloc.hostAlloc[x.deviceName]
          : [];
        return { ...x, allocationNames: allocNames };
      });
    if (!Array.isArray(usbResources)) {
      return base.map((x: any) => ({
        ...x,
        usbNodeName: "—",
        usbPciAddress: "—",
      }));
    }
    return base.map((x: any) => {
      const rn = String(x.deviceName || "").trim();
      const ui = rowDisplayForUsbResourceName(rn, usbResources);
      const node = ui.node !== "-" && String(ui.node).trim() ? ui.node : "—";
      const pci = ui.pci !== "-" && String(ui.pci).trim() ? ui.pci : "—";
      return { ...x, usbNodeName: node, usbPciAddress: pci };
    });
  }, [vmDeviceAlloc, usbResources]);

  const rawDisks = vmData?.spec?.template?.spec?.domain?.devices?.disks || [];
  const isCdromBoot = rawDisks.length > 0 && !!rawDisks[0].cdrom;

  return {
    status,
    vmGeneration,
    observedGeneration,
    hasGenerationInfo,
    isConfigOutOfSync,
    isHotPlugConfigured,
    isHotPlugEffective,
    isHotPlugPendingRestart,
    isHotPlugInProgress,
    isMigratable,
    isStopped,
    isRunning,
    isPaused,
    isMigrating,
    hotPlugCpuError,
    vmDisks,
    vmNics,
    vmPassthroughNics,
    vmGpus,
    vmUsb,
    isCdromBoot,
  };
}
