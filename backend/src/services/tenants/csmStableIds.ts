import { v5 as uuidv5 } from 'uuid';

/** 固定命名空间：同一 CSM orgId/domainId 多次恢复得到相同 Tower UUID */
const TOWER_CSM_REPAIR_NS = 'a3f2c8e1-6b4d-4e9f-9c2a-1d7e5f0b8a6c';

export function stableTenantIdFromCsmOrgId(csmOrgId: string): string {
  return uuidv5(`tower-csm-tenant:${String(csmOrgId || '').trim()}`, TOWER_CSM_REPAIR_NS);
}

export function stableRootOrganizationIdFromCsmOrgId(csmOrgId: string): string {
  return uuidv5(`tower-csm-org:${String(csmOrgId || '').trim()}`, TOWER_CSM_REPAIR_NS);
}

export function stableSecurityDomainIdFromCsmDomainId(csmDomainId: string): string {
  return uuidv5(`tower-csm-domain:${String(csmDomainId || '').trim()}`, TOWER_CSM_REPAIR_NS);
}

export function stableLeasedLineIdFromCsmDomainId(csmDomainId: string): string {
  return uuidv5(`tower-csm-leased:${String(csmDomainId || '').trim()}`, TOWER_CSM_REPAIR_NS);
}

export function csmOrgIdTag(csmOrgId: string): string {
  return `csmOrgId=${String(csmOrgId || '').trim()}`;
}

export function csmDomainIdTag(csmDomainId: string): string {
  return `csmDomainId=${String(csmDomainId || '').trim()}`;
}

export function mergeCsmTags(existing: string | undefined | null, parts: string[]): string {
  const map = new Map<string, string>();
  for (const token of String(existing || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const eq = token.indexOf('=');
    if (eq > 0) map.set(token.slice(0, eq), token);
    else map.set(token, token);
  }
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) map.set(p.slice(0, eq), p);
    else map.set(p, p);
  }
  return [...map.values()].join(',');
}
