/**
 * vm-spec-config 域 · lib
 *
 * 【用途】根据当前热扩展开闭与 CPU/内存上限计算主提交按钮文案（热扩/冷扩提示）。
 * 【使用方】`VmSpecConfigDrawer.tsx`。
 */

import { useMemo } from "react";

type Args = {
  hotPlugReady: boolean;
  maxSockets?: number;
  currentCpu: number;
  maxMemory?: number;
  currentMemory: number;
  cpuWatch: unknown;
  memoryWatch: unknown;
};

export function useVmSpecSubmitButtonText({
  hotPlugReady,
  maxSockets,
  currentCpu,
  maxMemory,
  currentMemory,
  cpuWatch,
  memoryWatch,
}: Args): string {
  return useMemo(() => {
    if (!hotPlugReady) return "提交（冷扩容）";
    const limitCpu = maxSockets || currentCpu * 4;
    const limitMem = maxMemory || currentMemory * 4;
    const cpu = cpuWatch as number | undefined;
    const memory = memoryWatch as number | undefined;
    const isOverLimit =
      (cpu !== undefined && cpu > limitCpu) ||
      (memory !== undefined && memory > limitMem);
    const isInvalid =
      (cpu !== undefined && cpu < currentCpu) ||
      (memory !== undefined && memory < currentMemory);
    if (isOverLimit || isInvalid) return "提交（冷扩容）";
    return "提交（热扩容）";
  }, [
    hotPlugReady,
    maxSockets,
    currentCpu,
    maxMemory,
    currentMemory,
    cpuWatch,
    memoryWatch,
  ]);
}
