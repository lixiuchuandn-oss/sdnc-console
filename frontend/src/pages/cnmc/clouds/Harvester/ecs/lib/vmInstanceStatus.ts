/** 读取 VM status.conditions 是否包含 `RestartRequired=True`。 */
export function isRestartRequiredFromVm(vm: any): boolean {
  const conditions = vm?.status?.conditions || [];
  return conditions.some(
    (c: any) => c.type === "RestartRequired" && c.status === "True",
  );
}

/** 判断虚拟机是否处于停止状态（用于跳过重启提示）。 */
export function isVmStopped(vm: any): boolean {
  if (!vm) return false;
  if (vm.spec?.running === false) return true;
  const status = vm.status?.printableStatus || vm.status?.phase || "";
  const statusLower = String(status).toLowerCase();
  return ["stopped", "shutoff", "down", "offline"].includes(statusLower);
}
