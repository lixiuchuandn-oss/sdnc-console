/**
 * 调整规格 · 热扩容上限与输入范围（与 `useVmSpecSubmitButtonText` / 提交侧一致）。
 */

/**
 * 热扩容已配置时，表单 InputNumber 的 max（须大于 maxSockets/maxGuest，否则无法输入超限冷扩值）。
 * 取「当前规格 ×4」与「热扩容上限 ×4」的较大值。
 */
export function vmSpecHotplugFormInputMaxCpu(
  currentCpu: number,
  maxSockets?: number,
): number {
  const fromCurrent = Math.max(1, Number(currentCpu || 1) * 4);
  const ceiling = Number(maxSockets || 0);
  if (ceiling > 0) {
    return Math.max(fromCurrent, ceiling * 4);
  }
  return fromCurrent;
}

export function vmSpecHotplugFormInputMaxMemoryGi(
  currentMemoryGi: number,
  maxGuestGi?: number,
): number {
  const fromCurrent = Math.max(1, Number(currentMemoryGi || 1) * 4);
  const ceiling = Number(maxGuestGi || 0);
  if (ceiling > 0) {
    return Math.max(fromCurrent, ceiling * 4);
  }
  return fromCurrent;
}

export function vmSpecExceedsHotplugCpu(params: {
  hotPlugConfigured: boolean;
  cpuChanged: boolean;
  newCpu: number;
  maxSockets?: number;
}): boolean {
  const { hotPlugConfigured, cpuChanged, newCpu, maxSockets } = params;
  return Boolean(
    hotPlugConfigured &&
      cpuChanged &&
      maxSockets != null &&
      maxSockets > 0 &&
      newCpu > maxSockets,
  );
}

export function vmSpecExceedsHotplugMemory(params: {
  hotPlugConfigured: boolean;
  memoryChanged: boolean;
  newMemGi: number;
  maxMemoryGi?: number;
}): boolean {
  const { hotPlugConfigured, memoryChanged, newMemGi, maxMemoryGi } = params;
  return Boolean(
    hotPlugConfigured &&
      memoryChanged &&
      maxMemoryGi != null &&
      maxMemoryGi > 0 &&
      newMemGi > maxMemoryGi + 0.01,
  );
}
