/**
 * vm-spec-config 域 · lib（跨抽屉复用）
 *
 * 【用途】变配类抽屉共用的「提交后」能力：拉聚合 VM、冷生效场景下弹重启确认、错误文案归一。
 * 【使用方】本域 `VmSpecConfigDrawer.tsx`、`VmSpecPerformanceDrawer.tsx`；另被
 * `vm-node-scheduling/VmNodeAffinityDrawer.tsx`、`VmNodeSchedulingDrawer.tsx`、`vm-vm-policy/VmVmPolicyDrawer.tsx` 引用（与规格域抽成同一套 post-submit 语义）。
 */

import { useCallback } from "react";
import { message } from "antd";
import { fetchHarvesterVMAggregated } from 'services/harvester/vm';
import { rebootCloudProviderEcs } from "../../../../../../../../services/api";
import { translateKnownApiErrorMessage } from "../../../../../../../../utils/k8sErrorMessages";
import { isVmStopped } from "../../../lib/vmInstanceStatus";
import {
  VM_RECONFIGURE_HOTPLUG_EXCEED_RESTART_HINT,
  VM_RECONFIGURE_RESTART_CONFIRM_TITLE,
  type VmReconfigureRestartConfirmOptions,
} from "../../../lib/vmMutation/vmReconfigureSubmitTypes";
import { confirmHighRiskOperation } from "../../../../shared/lib/highRiskConfirm";
import { VM_RESTART_RISK_ITEMS } from "../../../../shared/lib/highRiskOperationPresets";

/**
 * 规格（CPU/内存）提交成功后的辅助能力：拉聚合 VM、在需冷生效时弹重启确认。
 */
export function useVmSpecPostSubmit(p: {
  cloudId: string;
  record: any;
  latestVm: any;
  setLatestVm: (v: any) => void;
}) {
  const { cloudId, record, latestVm, setLatestVm } = p;

  const openRestartConfirm = useCallback(
    (
      namespace: string,
      vmName: string,
      force: boolean = false,
      options?: VmReconfigureRestartConfirmOptions,
    ) => {
      const activeVm = latestVm || record;
      if (isVmStopped(activeVm)) {
        message.success("设置已保存，下次启动时将自动应用新配置");
        return;
      }

      void confirmHighRiskOperation({
        title: VM_RECONFIGURE_RESTART_CONFIRM_TITLE,
        description: options?.exceedsHotplugRange
          ? VM_RECONFIGURE_HOTPLUG_EXCEED_RESTART_HINT
          : undefined,
        riskItems: VM_RESTART_RISK_ITEMS,
        requireTypeConfirm: false,
        operationSummary: `重启虚拟机「${vmName}」以应用新配置`,
        confirmText: "立即重启",
        cancelText: "手动重启",
        onConfirm: async () => {
          try {
            await rebootCloudProviderEcs(
              cloudId,
              `${namespace}/${vmName}`,
              force,
            );
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
    },
    [cloudId, latestVm, record],
  );

  const fetchAggregatedVm = useCallback(
    async (namespace: string, vmName: string) => {
      const res: any = await fetchHarvesterVMAggregated(
        cloudId,
        namespace,
        vmName,
      );
      const data = res?.data?.vm ? res.data : res;
      const updatedVm = data?.vm || data;
      if (updatedVm && data?.related) {
        updatedVm.related = data.related;
      }
      setLatestVm(updatedVm);
      return updatedVm;
    },
    [cloudId, setLatestVm],
  );

  return { openRestartConfirm, fetchAggregatedVm };
}
