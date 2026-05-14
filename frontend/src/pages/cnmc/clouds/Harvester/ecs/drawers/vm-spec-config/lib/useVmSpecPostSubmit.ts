/**
 * vm-spec-config 域 · lib（跨抽屉复用）
 *
 * 【用途】变配类抽屉共用的「提交后」能力：拉聚合 VM、冷生效场景下弹重启确认、错误文案归一。
 * 【使用方】本域 `VmSpecConfigDrawer.tsx`、`VmSpecPerformanceDrawer.tsx`；另被
 * `vm-node-scheduling/VmNodeAffinityDrawer.tsx`、`VmNodeSchedulingDrawer.tsx`、`vm-vm-policy/VmVmPolicyDrawer.tsx` 引用（与规格域抽成同一套 post-submit 语义）。
 */

import { useCallback } from "react";
import { message, Modal } from "antd";
import { fetchHarvesterVMAggregated } from "../../../../../../../../services/harvesterApi";
import { rebootCloudProviderEcs } from "../../../../../../../../services/api";
import { translateKnownApiErrorMessage } from "../../../../../../../../utils/k8sErrorMessages";
import { isVmStopped } from "../../../lib/vmInstanceStatus";

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
    (namespace: string, vmName: string, force: boolean = false) => {
      const activeVm = latestVm || record;
      if (isVmStopped(activeVm)) {
        message.success("设置已保存，下次启动时将自动应用新配置");
        return;
      }

      Modal.confirm({
        title: "规格变更已提交，需要重启实例生效，是否重启实例",
        okText: "立即重启",
        cancelText: "手动重启",
        onOk: async () => {
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
          }
        },
        onCancel: () => {},
      });
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
