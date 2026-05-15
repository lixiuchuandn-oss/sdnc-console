/**
 * vm-spec-config 域 · lib
 *
 * 【用途】从 VM 记录派生热扩展开关、进行中、需重启等 UI 衍生状态，供提示与按钮文案联动。
 * 【使用方】`VmSpecConfigDrawer.tsx`。
 */

import { useMemo } from "react";

/** 从 VM 记录解析热扩容相关 UI 状态（与抽屉/提交侧语义保持一致）。 */
export function useVmHotPlugUiState(activeRecord: any) {
  return useMemo(() => {
    const annotations = activeRecord?.metadata?.annotations || {};
    const configured =
      String(
        annotations["harvesterhci.io/enableCPUAndMemoryHotplug"] || "",
      ).toLowerCase() === "true";
    const conditions = activeRecord?.status?.conditions || [];
    const inProgress = conditions.some(
      (c: any) =>
        (c.type === "HotVCPUChange" || c.type === "HotMemoryChange") &&
        c.status === "True",
    );
    const restartRequired = conditions.some(
      (c: any) => c.type === "RestartRequired" && c.status === "True",
    );
    const readyForHotScale =
      configured && !restartRequired && !inProgress;
    return { configured, inProgress, restartRequired, readyForHotScale };
  }, [activeRecord]);
}
