/**
 * 从虚拟机 domain 与 GPU 资源列表推导「编辑态」：模式 + 与旧表单一致的 `key` 列表（`name|node|bus`）。
 * 详情 Tab「GPU」列表使用 `deriveVmGpuDisplayEntries`，与此处同一套匹配规则（与 GPU 管理抽屉一致）。
 */
export type VmGpuManageMode = "none" | "passthrough" | "sriov" | "vgpu";

export type VmGpuEditorDerived = {
  gpuMode: VmGpuManageMode;
  keys: string[];
};

/** 详情 Tab 等与抽屉对齐的 GPU 行（仅包含能在 gpuResources 中匹配到的直通/vGPU 项；USB 宿主设备排除） */
export type VmGpuDetailRow = {
  kind: "hostDevices" | "gpus";
  deviceName?: string;
  name?: string;
  allocationNames: string[];
  /** 自内联 key `name|node|pci` 解析，便于详情只读展示 */
  gpuNodeName?: string;
  gpuPciAddress?: string;
};

const getGpuResourceName = (x: any) =>
  x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName;

const isUsbHostDevice = (x: any) => {
  const dn = String(x?.deviceName || "").toLowerCase();
  const n = String(x?.name || "").toLowerCase();
  return dn.includes("usb") || n.includes("usb");
};

type Collected = {
  gpuMode: VmGpuManageMode;
  keys: string[];
  entries: VmGpuDetailRow[];
};

function nodeAndPciFromGpuKey(k: string): { gpuNodeName: string; gpuPciAddress: string } {
  const parts = String(k).split("|");
  return {
    gpuNodeName: parts[1] != null && String(parts[1]).trim() !== "" ? String(parts[1]) : "—",
    gpuPciAddress: parts[2] != null && String(parts[2]).trim() !== "" ? String(parts[2]) : "—",
  };
}

function collectVmGpuKeyedAssignments(
  activeRecord: any,
  gpuResources: any[],
): Collected {
  const domain = activeRecord?.spec?.template?.spec?.domain;
  const hostDevices = domain?.devices?.hostDevices || [];
  const gpus = domain?.devices?.gpus || [];
  const hostDevicesNonUsb = (Array.isArray(hostDevices) ? hostDevices : []).filter(
    (d: any) => !isUsbHostDevice(d),
  );
  const gpuNames = (Array.isArray(gpus) ? gpus : []).map((x: any) => x?.deviceName).filter(Boolean);
  const hostNames = hostDevicesNonUsb.map((x: any) => x?.deviceName).filter(Boolean);
  const resList = Array.isArray(gpuResources) ? gpuResources : [];

  const deriveModeFromVm = (): VmGpuManageMode => {
    if (gpuNames.length > 0) return "vgpu";
    if (hostNames.length === 0) return "none";
    const wanted = new Set(hostNames.map((x: any) => String(x)));
    const matchedTypes = new Set<string>();
    resList.forEach((x: any) => {
      const rn = getGpuResourceName(x);
      if (!rn) return;
      if (!wanted.has(String(rn))) return;
      const t = String(x?.type || "").toLowerCase();
      if (t) matchedTypes.add(t);
    });
    if (matchedTypes.has("sriov")) return "sriov";
    if (matchedTypes.has("passthrough")) return "passthrough";
    return "passthrough";
  };

  const effectiveMode = deriveModeFromVm();
  if (effectiveMode === "none") {
    return { gpuMode: "none", keys: [], entries: [] };
  }

  const parseAllocation = () => {
    try {
      const raw = activeRecord?.metadata?.annotations?.["harvesterhci.io/deviceAllocationDetails"];
      if (!raw) return null;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  };
  const allocation = parseAllocation();
  const hostAlloc = allocation?.hostdevices || {};
  const runningNode =
    activeRecord?.vmi?.status?.nodeName || activeRecord?.vmiRaw?.status?.nodeName || undefined;

  const matchByAllocName = (allocName: string) => {
    const target = String(allocName || "");
    if (!target) return null;
    const found = resList.find((x: any) => String(x?.raw?.metadata?.name || x?.name || "") === target);
    if (!found) return null;
    if (String(found?.type) !== String(effectiveMode)) return null;
    const name = found?.raw?.metadata?.name || found?.name || target || "-";
    const node = found?.node || found?.nodeName || "-";
    const bus = found?.pciAddress || found?.address || found?.pci || "-";
    return `${name}|${node}|${bus}`;
  };

  const buildKeyFromResourceName = (rn: string, usedKeys: Set<string>) => {
    const candidates = resList
      .filter((x: any) => String(x?.type) === String(effectiveMode))
      .filter((x: any) => String(getGpuResourceName(x) || "") === String(rn || ""));
    const scored = candidates.slice().sort((a: any, b: any) => {
      const an = String(a?.node || a?.nodeName || "");
      const bn = String(b?.node || b?.nodeName || "");
      const as = runningNode && an === runningNode ? 1 : 0;
      const bs = runningNode && bn === runningNode ? 1 : 0;
      return bs - as;
    });
    const pick =
      scored.find((x: any) => {
        const name = x?.raw?.metadata?.name || x?.name || rn || "-";
        const node = x?.node || x?.nodeName || "-";
        const bus = x?.pciAddress || x?.address || x?.pci || "-";
        const key = `${name}|${node}|${bus}`;
        return !usedKeys.has(key);
      }) || scored[0];
    if (!pick) return null;
    const name = pick?.raw?.metadata?.name || pick?.name || rn || "-";
    const node = pick?.node || pick?.nodeName || "-";
    const bus = pick?.pciAddress || pick?.address || pick?.pci || "-";
    return `${name}|${node}|${bus}`;
  };

  const keys: string[] = [];
  const entries: VmGpuDetailRow[] = [];
  const usedKeys = new Set<string>();

  if (effectiveMode !== "vgpu") {
    const assigned = hostDevicesNonUsb;
    assigned.forEach((d: any) => {
      const rn = String(d?.deviceName || "");
      const allocNames = Array.isArray(hostAlloc?.[rn]) ? hostAlloc[rn] : [];
      let k: string | null = null;
      if (allocNames.length > 0) {
        k = matchByAllocName(String(allocNames[0] || ""));
      }
      if (!k) k = buildKeyFromResourceName(rn, usedKeys);
      if (k) {
        keys.push(k);
        usedKeys.add(k);
        entries.push({
          kind: "hostDevices",
          deviceName: d?.deviceName,
          name: d?.name,
          allocationNames: allocNames,
          ...nodeAndPciFromGpuKey(k),
        });
      }
    });
  } else {
    const assigned = Array.isArray(gpus) ? gpus : [];
    assigned.forEach((d: any) => {
      const rn = String(d?.deviceName || "");
      const allocNames = Array.isArray(hostAlloc?.[rn]) ? hostAlloc[rn] : [];
      const k = buildKeyFromResourceName(rn, usedKeys);
      if (k) {
        keys.push(k);
        usedKeys.add(k);
        entries.push({
          kind: "gpus",
          deviceName: d?.deviceName,
          name: d?.name,
          allocationNames: allocNames,
          ...nodeAndPciFromGpuKey(k),
        });
      }
    });
  }

  return { gpuMode: effectiveMode, keys, entries };
}

export function deriveVmGpuEditorState(activeRecord: any, gpuResources: any[]): VmGpuEditorDerived {
  const { gpuMode, keys } = collectVmGpuKeyedAssignments(activeRecord, gpuResources);
  return { gpuMode, keys };
}

/** 详情等只读列表：与 `deriveVmGpuEditorState` 识别为已绑定 GPU 的项一致 */
export function deriveVmGpuDisplayEntries(
  activeRecord: any,
  gpuResources: any[],
): VmGpuDetailRow[] {
  const { gpuMode, entries } = collectVmGpuKeyedAssignments(activeRecord, gpuResources);
  if (gpuMode === "none") return [];
  return entries;
}
