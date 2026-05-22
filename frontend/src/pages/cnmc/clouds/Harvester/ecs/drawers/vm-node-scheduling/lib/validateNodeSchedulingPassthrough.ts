/**
 * 节点调度变配：校验目标节点与 VM 已绑定的 PCI 直通 / SR-IOV 网卡（及 GPU）所在节点一致。
 * 逻辑对齐 VmCreateWizardModal 提交前 PCI 节点亲和校验。
 */
import { message } from "antd";
import {
  collectVmPciPassthroughNicNodeNames,
  listVmPciNicHostBindings,
} from "../../../lib/passthroughNicSelectOptions";
import { deriveVmGpuDisplayEntries } from "../../vm-gpu-manage/lib/deriveVmGpuEditorState";
import { VmReconfigureSubmitSkipFinalize } from "../../../lib/vmMutation/vmReconfigureSubmitTypes";

export type NodeSchedulingMode = "auto" | "fixed" | "label";

function reject(msg: string): never {
  message.error(msg);
  throw new VmReconfigureSubmitSkipFinalize();
}

function hostnameFromLabelPairs(
  pairs: Array<{ key?: string; value?: string }> | undefined,
): string {
  const list = Array.isArray(pairs) ? pairs : [];
  const hit = list.find(
    (p) => String(p?.key || "").trim() === "kubernetes.io/hostname",
  );
  return hit ? String(hit.value || "").trim() : "";
}

/**
 * @param pciDevices PCI 库存（与创建向导一致，用于解析 hostDevices 所在节点）
 * @throws VmReconfigureSubmitSkipFinalize 校验不通过时
 */
export function validateNodeSchedulingPassthroughAffinity(args: {
  vm: any;
  mode: NodeSchedulingMode;
  fixedNode?: string;
  nodeSelectorPairs?: Array<{ key?: string; value?: string }>;
  pciDevices?: any[];
  gpuResources?: any[];
}): void {
  const {
    vm,
    mode,
    fixedNode,
    nodeSelectorPairs,
    pciDevices,
    gpuResources,
  } = args;

  const bindings = listVmPciNicHostBindings(vm);
  const pciNodes = collectVmPciPassthroughNicNodeNames(vm, pciDevices);

  if (bindings.length > 0 && pciNodes.length === 0) {
    reject(
      "无法校验直通网卡所在节点：请刷新节点调度页或稍后重试（需加载 PCI 设备列表）。",
    );
  }

  if (pciNodes.length > 1) {
    reject(
      "虚拟机绑定了多块位于不同节点的 PCI 直通/SR-IOV 网卡，无法变更节点调度。",
    );
  }

  const requiredPciNode = pciNodes.length === 1 ? pciNodes[0] : "";

  let targetHost = "";
  if (mode === "fixed") {
    targetHost = String(fixedNode || "").trim();
  } else if (mode === "label") {
    targetHost = hostnameFromLabelPairs(nodeSelectorPairs);
  }

  if (requiredPciNode && mode === "fixed" && targetHost && targetHost !== requiredPciNode) {
    reject(
      `所选主机与 PCI 直通/SR-IOV 网卡所在节点不一致（网卡位于节点 ${requiredPciNode}）。请将调度改为「自动」或选择与网卡相同的节点。`,
    );
  }

  if (requiredPciNode && mode === "label" && targetHost && targetHost !== requiredPciNode) {
    reject(
      `节点标签指定的主机与 PCI 直通/SR-IOV 网卡所在节点不一致（网卡位于节点 ${requiredPciNode}）。请修改 kubernetes.io/hostname 或移除直通网卡后再试。`,
    );
  }

  const gpuList = Array.isArray(gpuResources) ? gpuResources : [];
  if (gpuList.length > 0 && (mode === "fixed" || mode === "label")) {
    const gpuEntries = deriveVmGpuDisplayEntries(vm, gpuList);
    const gpuNodes = new Set<string>();
    for (const e of gpuEntries) {
      const n = String(e.gpuNodeName || "").trim();
      if (n && n !== "—") gpuNodes.add(n);
    }
    if (gpuNodes.size > 1) {
      reject("虚拟机绑定了多块位于不同节点的 GPU，无法变更到与 GPU 不一致的主机。");
    }
    if (gpuNodes.size === 1 && requiredPciNode) {
      const gn = [...gpuNodes][0];
      if (gn !== requiredPciNode) {
        reject(
          "GPU 与 PCI 直通网卡不在同一节点，无法将虚拟机调度到其他物理主机。",
        );
      }
    }
    if (gpuNodes.size === 1 && targetHost && targetHost !== [...gpuNodes][0]) {
      reject(
        `所选主机与 GPU 所在节点不一致（GPU 位于节点 ${[...gpuNodes][0]}）。请选择与 GPU 相同的节点。`,
      );
    }
  }
}
