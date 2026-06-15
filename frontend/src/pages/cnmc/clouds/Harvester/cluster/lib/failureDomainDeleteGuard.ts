import { findVmsReferencingFailureDomain } from '../../ecs/lib/vmFailureDomainNodeSelector';

export function assessFailureDomainDeleteBlocked(
  domainName: string,
  vms: any[],
): string | null {
  const used = findVmsReferencingFailureDomain(domainName, vms);
  if (used.length === 0) return null;
  if (used.length === 1) {
    return `故障域仍被虚拟机「${used[0].label}」使用，无法删除`;
  }
  return `故障域仍被以下虚拟机使用，无法删除：${used.map((u) => u.label).join('、')}`;
}
