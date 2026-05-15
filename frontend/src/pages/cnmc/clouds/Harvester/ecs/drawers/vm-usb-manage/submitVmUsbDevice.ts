/**
 * 「变更 USB」：解析表单并调用 `updateHarvesterVmSpec`（与 `VmUsbManageDrawer` 同域）。
 */
import { message } from "antd";
import { updateHarvesterVmSpec } from "../../../../../../../services/harvesterApi";
import type { VmReconfigureSubmitCtx } from "../../lib/vmMutation/vmReconfigureSubmitContext";
import { tryFinalizePassthroughNodeAffinity } from "../shared/lib/passthroughNodeAffinity";

export async function submitVmUsbDevice(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, record, latestVm, usbResources, openRestartConfirm } = ctx;
  const names = Array.isArray(values.usbResourceNames) ? values.usbResourceNames : [];

  if (names.length > 0) {
    const activeVm = latestVm || record;
    const done = await tryFinalizePassthroughNodeAffinity({
      device: "USB",
      cloudId,
      namespace,
      vmName,
      activeVm,
      resourceNames: names,
      resources: usbResources,
      getNodeFromResource: (u: any) => String(u?.nodeName || u?.node || "").trim(),
      buildPatchWithPinnedNode: (targetNode: string) => ({
        usbResourceNames: names,
        nodeSelector: { "kubernetes.io/hostname": targetNode },
      }),
      openRestartConfirm,
    });
    if (done) return;
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, { usbResourceNames: names });
  message.success("USB配置已更新");
  openRestartConfirm(namespace, vmName, false);
}
