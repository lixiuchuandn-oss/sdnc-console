import type { SecurityDomain } from '../entities/SecurityDomain';

export type InternetworkRoutingRoleKind = 'internetwork_routing' | 'csm_mirror';

export type DiscoveryMode = 'cloud_api' | 'vr_scan' | 'hybrid';

const tagValue = (tags: string | undefined | null, key: string): string => {
  for (const token of String(tags || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const eq = token.indexOf('=');
    if (eq > 0 && token.slice(0, eq) === key) return token.slice(eq + 1).trim();
  }
  return '';
};

export function parseCsmOrgIdFromTags(tags?: string | null): string | undefined {
  const v = tagValue(tags, 'csmOrgId');
  return v || undefined;
}

export function parseCsmDomainIdFromTags(tags?: string | null): string | undefined {
  const v = tagValue(tags, 'csmDomainId');
  return v || undefined;
}

export function isCsmRepairSource(tags?: string | null): boolean {
  return String(tags || '')
    .split(',')
    .map((s) => s.trim())
    .includes('source=csm-repair');
}

export function hasProtectTargetNetwork(dom: Pick<SecurityDomain, 'vpcId' | 'cidr'>): boolean {
  return Boolean(String(dom.vpcId || '').trim() || String(dom.cidr || '').trim());
}

/** 从存量行推断 roleKind（DB 未写 roleKind 时） */
export function inferRoleKindFromDomain(
  dom: Pick<
    SecurityDomain,
    'roleKind' | 'tags' | 'category' | 'vrUuid' | 'vpcId' | 'cidr' | 'provider'
  >,
): InternetworkRoutingRoleKind {
  const explicit = String(dom.roleKind || '').trim() as InternetworkRoutingRoleKind;
  if (explicit === 'internetwork_routing' || explicit === 'csm_mirror') return explicit;

  const cat = String(dom.category || '').trim();
  if (cat === 'flat:CSM安全域' || isCsmRepairSource(dom.tags)) return 'csm_mirror';
  if (String(dom.provider || '').trim() === 'cloudmap.csm' && !String(dom.vrUuid || '').trim()) {
    return 'csm_mirror';
  }
  return 'internetwork_routing';
}

export function isCsmMirrorDomain(
  dom: Pick<
    SecurityDomain,
    'roleKind' | 'tags' | 'category' | 'vrUuid' | 'vpcId' | 'cidr' | 'provider'
  >,
): boolean {
  return inferRoleKindFromDomain(dom) === 'csm_mirror';
}

/** 可参与邻居挂载 / VR 引流编排 */
export function isOrchestratableInternetworkRoutingDomain(
  dom: Pick<
    SecurityDomain,
    'roleKind' | 'tags' | 'category' | 'vrUuid' | 'vpcId' | 'cidr' | 'provider'
  >,
): boolean {
  if (isCsmMirrorDomain(dom)) return false;
  return Boolean(String(dom.vrUuid || '').trim() && hasProtectTargetNetwork(dom));
}

export function enrichSecurityDomainDto<T extends Record<string, unknown>>(row: T): T & {
  roleKind: InternetworkRoutingRoleKind;
  orchestratable: boolean;
} {
  const roleKind = inferRoleKindFromDomain(row as any);
  const orchestratable = isOrchestratableInternetworkRoutingDomain({
    ...(row as any),
    roleKind,
  });
  return { ...row, roleKind, orchestratable };
}

export function normalizeLinkedCsmSecurityDomainId(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim();
  return s || undefined;
}
