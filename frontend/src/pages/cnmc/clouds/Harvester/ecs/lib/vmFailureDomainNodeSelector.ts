import { FAILURE_DOMAIN_NODE_LABEL } from 'services/harvester/failureDomains';

export { FAILURE_DOMAIN_NODE_LABEL };

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
