import type { FailureDomainRow } from 'services/harvester/failureDomains';

/** 故障域分配节点时可选项：未分配节点 + 当前故障域已分配节点 */
export function buildFailureDomainAssignableNodeNames(input: {
  unassignedNodeNames?: string[];
  domain: FailureDomainRow | null;
}): string[] {
  const unassigned = Array.isArray(input.unassignedNodeNames) ? input.unassignedNodeNames : [];
  const current = input.domain?.nodeNames ?? [];
  return Array.from(new Set([...unassigned, ...current])).sort();
}
