/**
 * 监控告警命名空间过滤：排除系统命名空间，保留监控相关系统命名空间供管理员选择
 */

const SYSTEM_NS_SET = new Set(['kube-system', 'kube-public', 'kube-node-lease', 'fleet-default']);
const SYSTEM_NS_PREFIXES = ['c-', 'p-', 'user-', 'local-', 'cattle-'];
/** 监控相关系统命名空间，管理员需在告警通知策略等页面中可选 */
export const MONITORING_NS_ALLOWLIST = new Set(['cattle-monitoring-system']);

export function filterNonSystemNamespaces(names: string[]): string[] {
  return names.filter((name) => {
    if (!name || typeof name !== 'string') return false;
    if (MONITORING_NS_ALLOWLIST.has(name)) return true;
    if (SYSTEM_NS_SET.has(name)) return false;
    if (name.endsWith('-system')) return false;
    if (SYSTEM_NS_PREFIXES.some((p) => name.startsWith(p))) return false;
    return true;
  });
}
