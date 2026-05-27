import type { Organization } from '../../../types/tenant';

/** 在树（含 children）中按 id 查找组织 */
export function findOrganizationById(orgs: Organization[], id: string): Organization | null {
  for (const org of orgs) {
    if (org.id === id) return org;
    if (org.children?.length) {
      const found = findOrganizationById(org.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** 组织树本地过滤：子节点命中时保留父节点；visited 防止重复处理 */
export function filterOrganizationsByKeyword(orgs: Organization[], keyword: string): Organization[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return orgs;
  const visited = new Set<string>();
  const recur = (list: Organization[]): Organization[] => {
    const out: Organization[] = [];
    for (const org of list) {
      if (visited.has(org.id)) continue;
      visited.add(org.id);
      const children = org.children ? recur(org.children) : [];
      const selfMatch = org.name.toLowerCase().includes(kw);
      if (selfMatch || children.length) {
        out.push({ ...org, children });
      }
    }
    return out;
  };
  return recur(orgs);
}
