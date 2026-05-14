/**
 * 将 UI `key` 列表转为 `submitVmGpuDevice` 所需表单值结构。
 */
import type { VmGpuManageMode } from "./deriveVmGpuEditorState";

const getGpuResourceName = (x: any) =>
  x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName;

export function gpuKeysToSubmitValues(
  mode: VmGpuManageMode,
  keys: string[],
  gpuResources: any[],
): {
  gpuMode: string;
  gpuResourceNames: string[];
  gpuDeviceNames: string[];
  gpuNodeName: string | null;
} {
  const locked = (Array.isArray(keys) ? keys : []).map((k) => String(k || "").trim()).filter(Boolean);
  if (mode === "none" || locked.length === 0) {
    return { gpuMode: "none", gpuResourceNames: [], gpuDeviceNames: [], gpuNodeName: null };
  }

  const list = gpuResources.filter((x: any) => String(x?.type) === String(mode));
  const data = list.map((x: any) => ({
    key: `${(x?.raw?.metadata?.name || x?.name || x?.resourceName) || "-"}|${x?.node || x?.nodeName}|${x?.pciAddress || x?.address || x?.pci}`,
    resourceName: String(getGpuResourceName(x) || ""),
  }));
  const keyToResName = new Map<string, string>();
  data.forEach((r: any) => {
    if (r.key) keyToResName.set(String(r.key), String(r.resourceName || ""));
  });

  const gpuResourceNames = locked.map((k) => keyToResName.get(String(k)) || "").filter(Boolean);
  const gpuDeviceNames = locked.map((k) => String(k).split("|")[0] || "").filter(Boolean);

  const first = locked[0];
  const parts = String(first || "").split("|");
  const node = parts.length >= 2 ? String(parts[1] || "") : "";
  const gpuNodeName = node && node !== "-" ? node : null;

  return {
    gpuMode: String(mode),
    gpuResourceNames,
    gpuDeviceNames,
    gpuNodeName,
  };
}
