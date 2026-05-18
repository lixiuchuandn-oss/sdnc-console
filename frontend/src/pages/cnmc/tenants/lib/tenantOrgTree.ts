import type { Organization } from '../../../../types/tenant';

/** 组织树根下节点总数（去重 id，含各级 children） */
export function countOrganizationsInTree(orgs: Organization[]): number {
  let c = 0;
  const visited = new Set<string>();
  const recur = (ls: Organization[]) => {
    for (const o of ls) {
      if (visited.has(o.id)) continue;
      visited.add(o.id);
      c += 1;
      if (o.children?.length) recur(o.children);
    }
  };
  recur(orgs);
  return c;
}
