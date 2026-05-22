/**
 * 直通类设备（GPU / USB）提交时共用的：节点选择器与多设备冲突预检、必要时自动设节点或弹窗确认。
 * GPU / USB 各自只提供补丁构建回调，避免两份几乎相同的分支逻辑。
 */
import { message, Modal } from "antd";
import { updateHarvesterVmSpec } from "services/harvester/vm";
import { VmReconfigureSubmitSkipFinalize } from "../../../lib/vmMutation/vmReconfigureSubmitTypes";

export type PassthroughNodeAffinityDevice = "GPU" | "USB";

function isUsbHostDevice(d: any): boolean {
  const dn = String(d?.deviceName || "").toLowerCase();
  const n = String(d?.name || "").toLowerCase();
  return n.startsWith("usb") || dn.includes("usb");
}

function isGpuLikeHostDevice(d: any): boolean {
  if (isUsbHostDevice(d)) return false;
  const dn = String(d?.deviceName || "").toLowerCase();
  const n = String(d?.name || "").toLowerCase();
  return n.startsWith("gpu") || dn.startsWith("nvidia.com/");
}

function hasOtherPassthroughDevices(activeVm: any): boolean {
  const domain = activeVm?.spec?.template?.spec?.domain;
  const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
  const currentGpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
  return hostDevices.some((d: any) => isGpuLikeHostDevice(d) || isUsbHostDevice(d)) || currentGpus.length > 0;
}

/**
 * @returns `true` 表示已在本函数内完成更新并触发重启提示，调用方应结束提交流程；`false` 表示应继续走各自的常规 `updateHarvesterVmSpec`。
 */
export async function tryFinalizePassthroughNodeAffinity(args: {
  device: PassthroughNodeAffinityDevice;
  cloudId: string;
  namespace: string;
  vmName: string;
  activeVm: any;
  resourceNames: string[];
  resources: any[];
  getNodeFromResource: (r: any) => string;
  buildPatchWithPinnedNode: (targetNode: string) => Record<string, unknown>;
  openRestartConfirm: (namespace: string, vmName: string, hotplug: boolean) => void;
}): Promise<boolean> {
  const {
    device,
    cloudId,
    namespace,
    vmName,
    activeVm,
    resourceNames,
    resources,
    getNodeFromResource,
    buildPatchWithPinnedNode,
    openRestartConfirm,
  } = args;

  const names = Array.isArray(resourceNames) ? resourceNames : [];
  if (names.length === 0) return false;

  const currentNodeSelector = activeVm?.spec?.template?.spec?.nodeSelector || {};
  const currentNodeName = currentNodeSelector["kubernetes.io/hostname"];

  const list = Array.isArray(resources) ? resources : [];
  const targets = names.map((rn: string) => list.find((x: any) => String(x?.resourceName || "") === String(rn))).filter(Boolean);
  const targetNodes = targets.map((x: any) => String(getNodeFromResource(x) || "").trim()).filter(Boolean);
  const uniqueTargetNodes = Array.from(new Set(targetNodes));

  if (uniqueTargetNodes.length === 0) return false;

  const targetNode = uniqueTargetNodes[0];
  const hasOther = hasOtherPassthroughDevices(activeVm);

  const applyPinned = async () => {
    await updateHarvesterVmSpec(cloudId, namespace, vmName, buildPatchWithPinnedNode(targetNode));
  };

  if (!currentNodeName) {
    await applyPinned();
    message.success(
      device === "GPU"
        ? `GPU配置已更新，已自动设置节点选择器为 ${targetNode}`
        : `USB配置已更新，已自动设置节点选择器为 ${targetNode}`,
    );
    openRestartConfirm(namespace, vmName, false);
    return true;
  }

  if (!hasOther) {
    if (currentNodeName !== targetNode) {
      Modal.confirm({
        title: "节点选择器不一致",
        content:
          device === "GPU"
            ? `当前VM的节点选择器为 ${currentNodeName}，但GPU设备位于节点 ${targetNode}。是否将节点选择器变更为 ${targetNode}？`
            : `当前VM的节点选择器为 ${currentNodeName}，但USB设备位于节点 ${targetNode}。是否将节点选择器变更为 ${targetNode}？`,
        okText: "是，变更节点",
        cancelText: "取消",
        onOk: async () => {
          await applyPinned();
          message.success(device === "GPU" ? "GPU配置已更新，节点选择器已变更" : "USB配置已更新，节点选择器已变更");
          openRestartConfirm(namespace, vmName, false);
        },
      });
      throw new VmReconfigureSubmitSkipFinalize();
    }
  } else {
    if (currentNodeName !== targetNode) {
      message.error(
        device === "GPU"
          ? `无法挂载GPU：当前VM已挂载其他直通设备，节点选择器为 ${currentNodeName}，但GPU设备位于节点 ${targetNode}。请先移除其他直通设备或选择位于 ${currentNodeName} 节点的GPU设备。`
          : `无法挂载USB：当前VM已挂载其他直通设备，节点选择器为 ${currentNodeName}，但USB设备位于节点 ${targetNode}。请先移除其他直通设备或选择位于 ${currentNodeName} 节点的USB设备。`,
      );
      throw new VmReconfigureSubmitSkipFinalize();
    }
  }

  if (uniqueTargetNodes.length > 1) {
    message.error(
      device === "GPU"
        ? `无法挂载GPU：选择的GPU设备位于不同节点（${uniqueTargetNodes.join(", ")}），请选择位于同一节点的GPU设备。`
        : `无法挂载USB：选择的USB设备位于不同节点（${uniqueTargetNodes.join(", ")}），请选择位于同一节点的USB设备。`,
    );
    throw new VmReconfigureSubmitSkipFinalize();
  }

  return false;
}
