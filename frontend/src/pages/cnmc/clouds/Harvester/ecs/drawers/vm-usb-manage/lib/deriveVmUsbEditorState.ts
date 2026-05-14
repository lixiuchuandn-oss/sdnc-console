/**
 * 从 VM domain.hostDevices 派生当前已绑定的 USB（与旧 initChangeUsbMenu 筛选规则一致）。
 */
export type VmUsbEditorDerivedState = {
  /** 顺序与 hostDevices 中 USB 条目一致（通常即 deviceName 列表）。 */
  resourceNames: string[];
};

export function deriveVmUsbEditorState(activeRecord: any): VmUsbEditorDerivedState {
  const domain = activeRecord?.spec?.template?.spec?.domain;
  const hostDevices = domain?.devices?.hostDevices || [];
  const usb = (Array.isArray(hostDevices) ? hostDevices : []).filter((d: any) => {
    const n = String(d?.name || "").toLowerCase();
    const dn = String(d?.deviceName || "").toLowerCase();
    return n.startsWith("usb") || dn.includes("usb");
  });
  const resourceNames = usb
    .map((x: any) => String(x?.deviceName || "").trim())
    .filter(Boolean);
  return { resourceNames };
}
