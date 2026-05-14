/**
 * 性能设置抽屉：判断是否「仅有 QoS（CPU request/limit、内存 request/limit）相对初始态发生变化」。
 * 若仅此部分变化，Harvest/KubeVirt 侧通常可无需重启虚拟机；其余 CPU 型号、独占、隔离、拓扑仍会走重启确认。
 */

/** 与 `submitCpuAdvanced` 中非 QoS、`updateHarvesterVmSpec` 强相关的表单键 */
const RESTART_COMPARE_KEYS = [
  "cpuSockets",
  "cpuCores",
  "cpuThreads",
  "cpuModel",
  "cpuModelCustom",
  "dedicatedCPUPlacement",
  "isolateEmulatorThread",
] as const;

/** 可走「无重启确认」路径的 QoS 键（与表单 / submit 载荷一致） */
const QOS_KEYS = ["cpuRequest", "cpuLimit", "memoryRequestGi", "memoryLimitGi"] as const;

function normNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normBool(v: unknown): boolean {
  return !!v;
}

function normStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function restartFieldEqual(key: (typeof RESTART_COMPARE_KEYS)[number], a: unknown, b: unknown): boolean {
  switch (key) {
    case "cpuSockets":
    case "cpuCores":
    case "cpuThreads":
      return normNum(a) === normNum(b);
    case "dedicatedCPUPlacement":
    case "isolateEmulatorThread":
      return normBool(a) === normBool(b);
    case "cpuModel":
      return normStr(a || "host-passthrough") === normStr(b || "host-passthrough");
    case "cpuModelCustom":
      return normStr(a) === normStr(b);
    default:
      return a === b;
  }
}

function qosFieldEqual(a: unknown, b: unknown): boolean {
  return normNum(a) === normNum(b);
}

/** 任一非 QoS 项相对 baseline 有变化则不视为 QoS-only。 */
export function hasNonQosCpuAdvancedChange(baseline: Record<string, unknown>, values: Record<string, unknown>): boolean {
  for (const k of RESTART_COMPARE_KEYS) {
    if (!restartFieldEqual(k, values[k], baseline[k])) return true;
  }
  return false;
}

/** 相对 baseline，至少有一项 QoS 发生变化。 */
export function hasQoSChange(baseline: Record<string, unknown>, values: Record<string, unknown>): boolean {
  for (const k of QOS_KEYS) {
    if (!qosFieldEqual(values[k], baseline[k])) return true;
  }
  return false;
}

/**
 * `true` 表示可以跳过重启确认：**非 QoS 均未变**，且 **QoS 至少有一处变化**。
 * baseline 为空时返回 `false`。
 */
export function isCpuAdvancedQosOnlySubmit(
  baseline: Record<string, unknown> | null | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!baseline || typeof values !== "object") return false;
  if (hasNonQosCpuAdvancedChange(baseline, values)) return false;
  return hasQoSChange(baseline, values);
}
