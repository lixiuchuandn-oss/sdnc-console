/**
 * 「变更 GPU」：NAD 预检后提交 GPU 补丁（与 USB 抽屉无编排耦合）。
 */
import { message } from "antd";
import { getMissingNadsFromNetworks } from "../../lib/harvesterVmNetwork";
import { buildVmReconfigureSubmitCtx } from "../../lib/vmMutation/vmReconfigureSubmitContext";
import type { VmReconfigureSubmitDeps } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { submitVmGpuDevice } from "./submitVmGpuDevice";

export type VmGpuManageSubmitDeps = Omit<VmReconfigureSubmitDeps, "selectedKey">;

/** 校验 NAD 后写入 GPU 配置。成功返回 `true`；NAD 缺失等未发起 PATCH 时返回 `false`（已 message）。 */
export async function submitVmGpuValuesWithNadGuard(
  d: VmGpuManageSubmitDeps,
  values: Record<string, unknown>,
): Promise<boolean> {
  const ctx = buildVmReconfigureSubmitCtx({ ...d, selectedKey: "change_gpu" });
  const { record, activeRecord, ensureNadsLoaded } = d;
  const vmName = record?.metadata?.name;
  const namespace = record?.metadata?.namespace;

  const currentNetworks =
    activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
  const nadList = await ensureNadsLoaded();
  const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || "default"), nadList);
  if (missing.length > 0) {
    message.error(
      `更新失败：虚拟机网卡引用的 NAD 不存在：${missing.join(", ")}。请先在【变更网卡】中修复后再进行该操作。`,
    );
    return false;
  }

  await submitVmGpuDevice(ctx, values, vmName, namespace);
  return true;
}

export async function runVmGpuManageSubmit(d: VmGpuManageSubmitDeps): Promise<void> {
  const { form, onOk, onClose } = d;

  try {
    const values = await form.validateFields();
    const ok = await submitVmGpuValuesWithNadGuard(d, values);
    if (!ok) return;
    onOk?.();
    onClose?.();
  } catch (e: any) {
    if (e instanceof VmReconfigureSubmitSkipFinalize || e?.name === "VmReconfigureSubmitSkipFinalize") {
      return;
    }
    console.error(e);
    if (!e?.errorFields) {
      let errorMsg = e?.message || "操作失败";

      if (typeof errorMsg === "string") {
        if (errorMsg.includes("Guest memory is greater than the configured maxGuest memory")) {
          errorMsg = "调整后的内存超过了配置的最大限制（热扩容上限），请求被拒绝。";
        }
        const nadNotFound = errorMsg.match(
          /network-attachment-definitions\.k8s\.cni\.cncf\.io\s+"([^"]+)"\s+not\s+found/i,
        );
        if (nadNotFound?.[1]) {
          errorMsg = `更新失败：引用的网络附件（NAD）不存在：${nadNotFound[1]}。请在虚拟机网卡配置中更换为存在的网络，或在对应命名空间创建该 NAD。`;
        }
      }

      message.error(errorMsg);
    }
  }
}
