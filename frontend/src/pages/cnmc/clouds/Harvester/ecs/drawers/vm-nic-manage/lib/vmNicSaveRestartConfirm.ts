import { message } from "antd";
import { rebootCloudProviderEcs } from "../../../../../../../../services/api";
import { translateKnownApiErrorMessage } from "../../../../../../../../utils/k8sErrorMessages";
import { isVmStopped } from "../../../lib/vmInstanceStatus";
import { VM_RECONFIGURE_RESTART_CONFIRM_TITLE } from "../../../lib/vmMutation/vmReconfigureSubmitTypes";
import { confirmHighRiskOperation } from "../../../../shared/lib/highRiskConfirm";
import { VM_RESTART_RISK_ITEMS } from "../../../../shared/lib/highRiskOperationPresets";

/** 网卡变配保存成功后，运行中实例提示立即重启或手动重启（标题与其它变配项统一）。 */
export function showVmNicChangeRestartConfirm(opts: {
  cloudId: string;
  vmNs: string;
  vmName: string;
  vmData: any;
}): void {
  const { cloudId, vmNs, vmName, vmData } = opts;
  if (isVmStopped(vmData)) return;
  void confirmHighRiskOperation({
    title: VM_RECONFIGURE_RESTART_CONFIRM_TITLE,
    riskItems: VM_RESTART_RISK_ITEMS,
    requireTypeConfirm: false,
    operationSummary: `重启虚拟机「${vmName}」以应用网卡配置`,
    confirmText: "立即重启",
    cancelText: "手动重启",
    onConfirm: async () => {
      try {
        await rebootCloudProviderEcs(cloudId, `${vmNs}/${vmName}`, false);
        message.success("重启指令已下发");
      } catch (e: any) {
        message.error(
          translateKnownApiErrorMessage(
            String(e?.message || e || "重启失败"),
          ),
        );
        throw e;
      }
    },
  }).catch(() => {});
}
