/**
 * 「变更 GPU」：解析表单并调用 `updateHarvesterVmSpec`（与 `VmGpuManageDrawer` 同域）。
 */
import { message } from "antd";
import { updateHarvesterVmSpec } from "../../../../../../../services/harvesterApi";
import type { VmReconfigureSubmitCtx } from "../../lib/vmMutation/vmReconfigureSubmitContext";
import { tryFinalizePassthroughNodeAffinity } from "../shared/lib/passthroughNodeAffinity";
import { getGpuNodeName } from "../../lib/gpuResourceResolve";

export async function submitVmGpuDevice(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, record, latestVm, gpuResources, openRestartConfirm } = ctx;
  const mode = values.gpuMode || "none";
  const names = Array.isArray(values.gpuResourceNames) ? values.gpuResourceNames : [];
  const deviceNames = Array.isArray(values.gpuDeviceNames) ? values.gpuDeviceNames : [];
  const gpuNodeName = values.gpuNodeName !== undefined ? values.gpuNodeName : undefined;

  if (mode !== "none" && mode !== "vgpu" && names.length > 0) {
    const activeVm = latestVm || record;
    const done = await tryFinalizePassthroughNodeAffinity({
      device: "GPU",
      cloudId,
      namespace,
      vmName,
      activeVm,
      resourceNames: names,
      deviceCrNames: deviceNames,
      targetNodeHint: gpuNodeName,
      resources: gpuResources,
      getNodeFromResource: (g: any) => getGpuNodeName(g),
      buildPatchWithPinnedNode: (targetNode: string) => ({
        gpuMode: mode,
        gpuResourceNames: names,
        gpuDeviceNames: deviceNames,
        gpuNodeName: targetNode,
      }),
      openRestartConfirm,
    });
    if (done) return;
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, {
    gpuMode: mode,
    gpuResourceNames: mode === "none" ? [] : names,
    gpuDeviceNames: mode === "none" ? [] : deviceNames,
    gpuNodeName: mode === "none" ? null : gpuNodeName,
  });
  message.success("GPU配置已更新");
  openRestartConfirm(namespace, vmName, false);
}
