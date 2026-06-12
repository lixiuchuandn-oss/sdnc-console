/** 读取 VM status.conditions 是否包含 `RestartRequired=True`。 */
export function isRestartRequiredFromVm(vm: any): boolean {
  const conditions = vm?.status?.conditions || [];
  return conditions.some(
    (c: any) => c.type === "RestartRequired" && c.status === "True",
  );
}

const VM_STOPPED_STATUS_TOKENS = new Set([
  "stopped",
  "shutoff",
  "down",
  "offline",
]);

function vmStoppedStatusToken(vm: any): string {
  if (!vm) return "";
  if (typeof vm.status === "string") return vm.status.trim().toLowerCase();
  const fromStatus =
    vm.status?.printableStatus ||
    vm.status?.phase ||
    vm.Status ||
    vm.vmi?.status?.phase ||
    vm.vmiRaw?.status?.phase ||
    "";
  return String(fromStatus).trim().toLowerCase();
}

/** 判断虚拟机是否处于停止状态（用于跳过重启提示、云盘导出镜像等）。 */
export function isVmStopped(vm: any): boolean {
  if (!vm) return false;
  if (vm.spec?.running === false) return true;
  if (String(vm.spec?.runStrategy || "").trim() === "Halted") return true;

  const statusLower = vmStoppedStatusToken(vm);
  if (VM_STOPPED_STATUS_TOKENS.has(statusLower)) return true;

  const vmiPhase = String(
    vm?.vmi?.status?.phase || vm?.vmiRaw?.status?.phase || "",
  )
    .trim()
    .toLowerCase();
  if (vmiPhase === "running") return false;

  return false;
}
