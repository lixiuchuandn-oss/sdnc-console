import {
  FAILURE_DOMAIN_NODE_LABEL,
  FAILURE_DOMAIN_TYPE_LABELS,
  type FailureDomainRow,
} from 'services/harvester/failureDomains';

export { FAILURE_DOMAIN_NODE_LABEL };

export type VmFailureDomainSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/** 虚拟机可选故障域：须至少分配一个物理节点 */
export function isFailureDomainWithAssignedNodes(domain: FailureDomainRow): boolean {
  return (domain.nodeNames?.length ?? 0) > 0;
}

export function buildVmFailureDomainSelectOptions(
  domains: FailureDomainRow[],
  opts?: { extraIncludeNames?: string[] },
): VmFailureDomainSelectOption[] {
  const byName = new Map(domains.map((d) => [d.name, d]));
  const options: VmFailureDomainSelectOption[] = domains
    .filter(isFailureDomainWithAssignedNodes)
    .map((d) => {
      const typeLabel = FAILURE_DOMAIN_TYPE_LABELS[d.domainType] || d.domainType;
      const nodeCount = d.nodeNames?.length ?? 0;
      return {
        value: d.name,
        label: `${d.name}（${typeLabel} · ${nodeCount} 节点）`,
      };
    });

  const seen = new Set(options.map((o) => o.value));
  for (const raw of opts?.extraIncludeNames ?? []) {
    const name = String(raw || '').trim();
    if (!name || seen.has(name)) continue;
    const domain = byName.get(name);
    if (domain) {
      const typeLabel = FAILURE_DOMAIN_TYPE_LABELS[domain.domainType] || domain.domainType;
      options.push({
        value: name,
        label: `${name}（${typeLabel} · 无可用节点）`,
        disabled: true,
      });
    } else {
      options.push({
        value: name,
        label: `${name}（已不存在或无可用节点）`,
        disabled: true,
      });
    }
    seen.add(name);
  }

  return options;
}

export const VM_FAILURE_DOMAIN_SELECT_EMPTY_HINT =
  '暂无已分配节点的故障域，请先在集群「计算配置 > 故障域」中为故障域分配节点';
export type NodeSelectorPair = { key?: string; value?: string };

export function parseFailureDomainFromNodeSelector(
  nodeSelector: Record<string, unknown> | null | undefined,
): { failureDomainName?: string; otherPairs: Array<{ key: string; value: string }> } {
  const otherPairs: Array<{ key: string; value: string }> = [];
  let failureDomainName: string | undefined;

  if (!nodeSelector || typeof nodeSelector !== 'object') {
    return { otherPairs };
  }

  Object.entries(nodeSelector).forEach(([key, value]) => {
    if (key === 'kubernetes.io/hostname') return;
    const val = String(value ?? '').trim();
    if (!val) return;
    if (key === FAILURE_DOMAIN_NODE_LABEL) {
      failureDomainName = val;
      return;
    }
    otherPairs.push({ key, value: val });
  });

  return { failureDomainName, otherPairs };
}

export function buildNodeSelectorFromLabelForm(input: {
  failureDomainName?: string;
  nodeSelectorPairs?: NodeSelectorPair[];
}): Record<string, string> | undefined {
  const obj: Record<string, string> = {};
  const fd = String(input.failureDomainName || '').trim();
  if (fd) {
    obj[FAILURE_DOMAIN_NODE_LABEL] = fd;
  }

  const arr = Array.isArray(input.nodeSelectorPairs) ? input.nodeSelectorPairs : [];
  arr.forEach((p) => {
    const key = String(p?.key || '').trim();
    const value = String(p?.value || '').trim();
    if (!key || !value || key === FAILURE_DOMAIN_NODE_LABEL) return;
    obj[key] = value;
  });

  return Object.keys(obj).length > 0 ? obj : undefined;
}

export function hasLabelModeNodeSelector(input: {
  failureDomainName?: string;
  nodeSelectorPairs?: NodeSelectorPair[];
}): boolean {
  if (String(input.failureDomainName || '').trim()) return true;
  const arr = Array.isArray(input.nodeSelectorPairs) ? input.nodeSelectorPairs : [];
  return arr.some((p) => {
    const key = String(p?.key || '').trim();
    const value = String(p?.value || '').trim();
    return !!(key && value && key !== FAILURE_DOMAIN_NODE_LABEL);
  });
}

function readVmNodeSelectorForFailureDomain(vm: any): Record<string, unknown> | undefined {
  const sel =
    vm?.spec?.template?.spec?.nodeSelector ||
    vm?.rawData?.spec?.template?.spec?.nodeSelector ||
    vm?.spec?.nodeSelector;
  return sel && typeof sel === 'object' ? sel : undefined;
}

/** 查找 nodeSelector 仍引用指定故障域名称的虚拟机（含回收站中的实例） */
export function findVmsReferencingFailureDomain(
  domainName: string,
  vms: any[],
): Array<{ ns: string; name: string; label: string }> {
  const fd = String(domainName || '').trim();
  if (!fd || !Array.isArray(vms)) return [];

  const out: Array<{ ns: string; name: string; label: string }> = [];
  const seen = new Set<string>();

  for (const vm of vms) {
    const parsed = parseFailureDomainFromNodeSelector(readVmNodeSelectorForFailureDomain(vm));
    if (parsed.failureDomainName !== fd) continue;

    const ns = String(vm?.metadata?.namespace || vm?.namespace || '').trim();
    const name = String(vm?.metadata?.name || vm?.name || '').trim();
    if (!name) continue;

    const key = `${ns}/${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const alias = String(vm?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    out.push({ ns, name, label: alias || name });
  }

  return out;
}
