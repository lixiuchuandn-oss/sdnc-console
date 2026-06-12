/** 与 backend/src/utils/internetworkRoutingDomain.ts 保持语义一致（前端筛选用） */

export type InternetworkRoutingRoleKind = 'internetwork_routing' | 'csm_mirror';

const tagValue = (tags: string | string[] | undefined | null, key: string): string => {
  const raw = Array.isArray(tags) ? tags.join(',') : String(tags || '');
  for (const token of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const eq = token.indexOf('=');
    if (eq > 0 && token.slice(0, eq) === key) return token.slice(eq + 1).trim();
  }
  return '';
};

export function inferRoleKindFromDomain(dom: {
  roleKind?: string;
  tags?: string | string[];
  category?: string;
  vrUuid?: string;
  vpcId?: string;
  cidr?: string;
  provider?: string;
}): InternetworkRoutingRoleKind {
  const explicit = String(dom.roleKind || '').trim() as InternetworkRoutingRoleKind;
  if (explicit === 'internetwork_routing' || explicit === 'csm_mirror') return explicit;
  const cat = String(dom.category || '').trim();
  if (cat === 'flat:CSM安全域') return 'csm_mirror';
  if (
    String(dom.provider || '').trim() === 'cloudmap.csm' &&
    !String(dom.vrUuid || '').trim()
  ) {
    return 'csm_mirror';
  }
  if (
    String(tagsOrEmpty(dom.tags))
      .split(',')
      .map((s) => s.trim())
      .includes('source=csm-repair')
  ) {
    return 'csm_mirror';
  }
  return 'internetwork_routing';
}

function tagsOrEmpty(tags?: string | string[]): string {
  return Array.isArray(tags) ? tags.join(',') : String(tags || '');
}

export function isOrchestratableInternetworkRoutingDomain(dom: {
  roleKind?: string;
  tags?: string | string[];
  category?: string;
  vrUuid?: string;
  vpcId?: string;
  cidr?: string;
  provider?: string;
}): boolean {
  if (inferRoleKindFromDomain(dom) === 'csm_mirror') return false;
  const hasNet = Boolean(String(dom.vpcId || '').trim() || String(dom.cidr || '').trim());
  return Boolean(String(dom.vrUuid || '').trim() && hasNet);
}

export function roleKindLabel(roleKind?: string, dom?: Parameters<typeof inferRoleKindFromDomain>[0]): string {
  const k = roleKind || (dom ? inferRoleKindFromDomain(dom) : 'internetwork_routing');
  return k === 'csm_mirror' ? 'CSM 镜像' : '可编排';
}
