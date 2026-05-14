import { message, Modal } from "antd";
import { rebootCloudProviderEcs } from "../../../../../../../../services/api";
import { translateKnownApiErrorMessage } from "../../../../../../../../utils/k8sErrorMessages";
import { isVmStopped } from "../../../lib/vmInstanceStatus";
import { VM_RECONFIGURE_RESTART_CONFIRM_TITLE } from "../../../lib/vmMutation/vmReconfigureSubmitTypes";

/** 网卡变配保存成功后，运行中实例提示立即重启或手动重启（标题与其它变配项统一）。 */
export function showVmNicChangeRestartConfirm(opts: {
  cloudId: string;
  vmNs: string;
  vmName: string;
  vmData: any;
}): void {
  const { cloudId, vmNs, vmName, vmData } = opts;
  if (isVmStopped(vmData)) return;
  Modal.confirm({
    title: VM_RECONFIGURE_RESTART_CONFIRM_TITLE,
    okText: "立即重启",
    cancelText: "手动重启",
    onOk: async () => {
      try {
        await rebootCloudProviderEcs(cloudId, `${vmNs}/${vmName}`, false);
        message.success("重启指令已下发");
      } catch (e: any) {
        message.error(
          translateKnownApiErrorMessage(
            String(e?.message || e || "重启失败"),
          ),
        );
      }
    },
    onCancel: () => {},
  });
}
