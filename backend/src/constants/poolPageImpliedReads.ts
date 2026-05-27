/**
 * 池内页 token 隐式读 prefix 清单。
 * 须与 frontend `pool/lib/poolPageReadAccess.ts` → POOL_PAGE_IMPLIED_READ_BASES 保持一致。
 * 设计原则见 docs/cloudmap-pool-page-rbac.md。
 */
export const POOL_PAGE_IMPLIED_READ_BASES: Readonly<
  Record<string, readonly string[]>
> = {
  'clouds.dc-topology': ['clouds.cluster-nodes', 'clouds.cluster-networks'],
  'clouds.net-topology': [
    'clouds.provider-networks',
    'clouds.cluster-networks',
    'clouds.vlans',
    'clouds.cluster-nodes',
    'clouds.subnets.public',
    'clouds.nads',
  ],
};

/** 页 token 是否隐式满足对某 resource base 的 read */
export function poolPageTokenGrantsImpliedRead(
  permissions: string[],
  resourceBase: string,
): boolean {
  for (const [pagePrefix, impliedBases] of Object.entries(POOL_PAGE_IMPLIED_READ_BASES)) {
    if (!impliedBases.includes(resourceBase)) continue;
    if (
      permissions.includes(`${pagePrefix}:read`) ||
      permissions.includes(`${pagePrefix}:write`) ||
      permissions.includes(`${pagePrefix}:*`)
    ) {
      return true;
    }
  }
  return false;
}
