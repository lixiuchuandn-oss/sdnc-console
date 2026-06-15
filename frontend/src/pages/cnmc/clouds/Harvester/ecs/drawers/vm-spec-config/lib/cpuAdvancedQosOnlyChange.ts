/**
 * 性能设置抽屉：判断是否「仅有 QoS（CPU request/limit、内存 request/limit）相对初始态发生变化」。
 * 若仅此部分变化，Harvest/KubeVirt 侧通常可无需重启虚拟机；其余 CPU 型号、独占、隔离、拓扑仍会走重启确认。
 *
 * 注意：性能抽屉未对拓扑字段挂 Form.Item，`validateFields` 可能缺少部分键；比较时对缺键回退 baseline，避免误判。
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
  "hugepagesEnabled",
  "hugepagesPageSize",
  "numaMode",
  "numaManualNodeCount",
] as const;

/** 可走「无重启确认」路径的 QoS 键（与表单 / submit 载荷一致） */
const QOS_KEYS = ["cpuRequest", "cpuLimit", "memoryRequestGi", "memoryLimitGi"] as const;

function normNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
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
    case "hugepagesEnabled":
    case "numaMode":
      return normStr(a || "off") === normStr(b || "off");
    case "numaManualNodeCount":
      return normNum(a) === normNum(b);
    case "hugepagesPageSize":
      return normStr(a || "2Mi") === normStr(b || "2Mi");
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

/**
 * 性能设置抽屉未对拓扑等字段挂 Form.Item，`validateFields` 可能不含这些键；
 * 缺键时应视为「仍等于 baseline」，避免误判为非 QoS 变更而弹重启。
 */
function valueForKey(
  key: string,
  baseline: Record<string, unknown>,
  values: Record<string, unknown>,
): unknown {
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  return baseline[key];
}

/** 任一非 QoS 项相对 baseline 有变化则不视为 QoS-only。 */
export function hasNonQosCpuAdvancedChange(baseline: Record<string, unknown>, values: Record<string, unknown>): boolean {
  for (const k of RESTART_COMPARE_KEYS) {
    const v = valueForKey(k, baseline, values);
    if (!restartFieldEqual(k, v, baseline[k])) return true;
  }
  return false;
}

/** 相对 baseline，至少有一项 QoS 发生变化。 */
export function hasQoSChange(baseline: Record<string, unknown>, values: Record<string, unknown>): boolean {
  for (const k of QOS_KEYS) {
    const v = valueForKey(k, baseline, values);
    if (!qosFieldEqual(v, baseline[k])) return true;
  }
  return false;
}

/** 任一性能表单相关项相对 baseline 有变化（含 QoS 与非 QoS）。 */
export function hasCpuAdvancedAnyChange(
  baseline: Record<string, unknown>,
  values: Record<string, unknown>,
): boolean {
  return hasNonQosCpuAdvancedChange(baseline, values) || hasQoSChange(baseline, values);
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

/**
 * 提交后是否跳过「需重启实例」确认：仅 QoS 变更，或表单相对 baseline 无任何有效变更。
 */
export function shouldSkipCpuAdvancedRestartConfirm(
  baseline: Record<string, unknown> | null | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!baseline || typeof values !== "object") return false;
  if (!hasCpuAdvancedAnyChange(baseline, values)) return true;
  return isCpuAdvancedQosOnlySubmit(baseline, values);
}
