/** VR 配置 JSON 键排序 profile（展示/对比/落库一致） */
export type VrConfigJsonSortProfile = 'ce' | 'pe' | 'ipsec';

const PROFILE_ROLE_KEYS: Record<VrConfigJsonSortProfile, readonly string[]> = {
  ce: ['ce'],
  pe: ['pe', 'segment_routing_srv6', 'vrf'],
  ipsec: ['ipsec_preset', 'ce', 'pe'],
};

function keyPriority(key: string, profile: VrConfigJsonSortProfile): number {
  if (key === 'uuid') return -1;
  if (key === 'role') return 0;
  const roleKeys = PROFILE_ROLE_KEYS[profile];
  const roleIdx = roleKeys.indexOf(key);
  if (roleIdx >= 0) return 1 + roleIdx;
  if (key.startsWith('interfaces_')) return 10;
  if (key.startsWith('subinterfaces_')) return 11;
  if (key.startsWith('ipv4_')) return 15;
  if (key.startsWith('ipv6_')) return 16;
  if (key === 'bgp') return 20;
  return 50;
}

/** 递归排序 VR 配置 JSON 键，便于预览 diff 与平台落库 */
export function sortVrConfigJsonKeys(
  obj: Record<string, unknown>,
  profile: VrConfigJsonSortProfile = 'ipsec',
): Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};

  const copy = { ...(obj as Record<string, unknown>) };
  Object.keys(copy).forEach((k) => {
    const child = copy[k];
    copy[k] =
      child && typeof child === 'object' && !Array.isArray(child)
        ? sortVrConfigJsonKeys(child as Record<string, unknown>, profile)
        : child;
  });

  const keys = Object.keys(copy).sort((a, b) => {
    const pa = keyPriority(a, profile);
    const pb = keyPriority(b, profile);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });

  const sorted: Record<string, unknown> = {};
  keys.forEach((k) => {
    sorted[k] = copy[k];
  });
  return sorted;
}
