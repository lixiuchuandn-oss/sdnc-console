/**
 * 虚拟机 podAffinity / podAntiAffinity 诊断（结构校验，不模拟完整调度器）。
 */
export type PodSchedulingAffinityDiag = {
  configured: boolean;
  valid: boolean;
  affinityRequiredCount: number;
  affinityPreferredCount: number;
  antiAffinityRequiredCount: number;
  antiAffinityPreferredCount: number;
  message: string;
  summary: string;
};

function countRules(block: any): { required: number; preferred: number } {
  if (!block || typeof block !== 'object') return { required: 0, preferred: 0 };
  const required = Array.isArray(block.requiredDuringSchedulingIgnoredDuringExecution)
    ? block.requiredDuringSchedulingIgnoredDuringExecution.length
    : 0;
  const preferred = Array.isArray(block.preferredDuringSchedulingIgnoredDuringExecution)
    ? block.preferredDuringSchedulingIgnoredDuringExecution.length
    : 0;
  return { required, preferred };
}

function termStructurallyValid(term: any): boolean {
  if (!term || typeof term !== 'object') return false;
  const topologyKey = String(term.topologyKey || '').trim();
  if (!topologyKey) return false;
  const ls = term.labelSelector;
  if (!ls || typeof ls !== 'object') return false;
  const hasLabels =
    ls.matchLabels && typeof ls.matchLabels === 'object' && Object.keys(ls.matchLabels).length > 0;
  const hasExprs =
    Array.isArray(ls.matchExpressions) &&
    ls.matchExpressions.some((e: any) => e?.key && String(e.key).trim());
  return hasLabels || hasExprs;
}

function blockStructurallyValid(block: any): boolean {
  const { required, preferred } = countRules(block);
  if (required === 0 && preferred === 0) return false;

  const requiredTerms = block?.requiredDuringSchedulingIgnoredDuringExecution || [];
  for (const term of requiredTerms) {
    if (!termStructurallyValid(term)) return false;
  }

  const preferredTerms = block?.preferredDuringSchedulingIgnoredDuringExecution || [];
  for (const pref of preferredTerms) {
    if (!termStructurallyValid(pref?.podAffinityTerm)) return false;
  }

  return true;
}

export function analyzePodSchedulingAffinity(vm: any): PodSchedulingAffinityDiag {
  const affinity = vm?.spec?.template?.spec?.affinity;
  const podAffinity = affinity?.podAffinity;
  const podAntiAffinity = affinity?.podAntiAffinity;

  const affCounts = countRules(podAffinity);
  const antiCounts = countRules(podAntiAffinity);
  const totalRules =
    affCounts.required +
    affCounts.preferred +
    antiCounts.required +
    antiCounts.preferred;

  if (totalRules === 0) {
    return {
      configured: false,
      valid: true,
      affinityRequiredCount: 0,
      affinityPreferredCount: 0,
      antiAffinityRequiredCount: 0,
      antiAffinityPreferredCount: 0,
      message: '未配置虚拟机间亲和/反亲和',
      summary: '未配置',
    };
  }

  const affOk = affCounts.required + affCounts.preferred === 0 || blockStructurallyValid(podAffinity);
  const antiOk =
    antiCounts.required + antiCounts.preferred === 0 || blockStructurallyValid(podAntiAffinity);
  const valid = affOk && antiOk;

  const parts: string[] = [];
  if (affCounts.required + affCounts.preferred > 0) {
    parts.push(`亲和 ${affCounts.required} 必须 / ${affCounts.preferred} 优先`);
  }
  if (antiCounts.required + antiCounts.preferred > 0) {
    parts.push(`反亲和 ${antiCounts.required} 必须 / ${antiCounts.preferred} 优先`);
  }

  return {
    configured: true,
    valid,
    affinityRequiredCount: affCounts.required,
    affinityPreferredCount: affCounts.preferred,
    antiAffinityRequiredCount: antiCounts.required,
    antiAffinityPreferredCount: antiCounts.preferred,
    message: valid
      ? `已配置虚拟机间调度规则（${parts.join('；')}）`
      : '虚拟机间亲和/反亲和规则不完整（需标签选择器与 topologyKey）',
    summary: parts.join('；'),
  };
}
