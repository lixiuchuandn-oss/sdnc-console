/**
 * Cloudmap 池内叶子页读权限：与 `cloudmapPoolNavRows.poolPageAction` 对齐。
 * 规范见 deployment/docs/specs/cloudmap-pool-page-rbac.md
 */
import { CLOUDMAP_POOL_NAV_ROWS } from '../../../../../../routes/cloudmapPoolNavRows';
import type { CloudmapResourceSubKey } from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';

const PAGE_READ_BY_SUFFIX = new Map<string, string>(
  CLOUDMAP_POOL_NAV_ROWS.filter((r) => r.poolPageAction).map((r) => [
    r.pathSuffix,
    r.poolPageAction!,
  ]),
);

/** 资源总览子页访问顺序（路径同步 fallback） */
export const RESOURCE_HUB_SUB_ORDER: readonly CloudmapResourceSubKey[] = [
  'overview',
  'datacenter_topology',
  'network_topology',
  'ceph_storage_overview',
];

export function getPoolPageReadAction(pathSuffix: string): string | undefined {
  return PAGE_READ_BY_SUFFIX.get(pathSuffix);
}

/**
 * 池内主页面读权限（严格）：仅匹配 `poolPageAction` 对应原子、write→read、子网汇总/拆分；
 * **不**使用 `clouds.console:*` / `clouds:read` 兜底。租户 `/console` 与配置抽屉语义对齐。
 */
export function checkPoolPageReadPerm(permissions: string[], requiredRead: string): boolean {
  const perms = permissions ?? [];
  if (!requiredRead.endsWith(':read')) {
    return perms.includes('*') || perms.includes(requiredRead);
  }
  if (perms.includes('*')) return true;
  if (perms.includes(requiredRead)) return true;

  const base = requiredRead.slice(0, -':read'.length);
  if (perms.includes(`${base}:write`) || perms.includes(`${base}:*`)) return true;

  if (base === 'clouds.subnets') {
    const scoped = [
      'clouds.subnets.vpc:read',
      'clouds.subnets.flat:read',
      'clouds.subnets.public:read',
    ] as const;
    if (scoped.some((s) => checkPoolPageReadPerm(perms, s))) return true;
  }
  if (base.startsWith('clouds.subnets.') && base !== 'clouds.subnets') {
    if (perms.includes('clouds.subnets:read') || perms.includes('clouds.subnets:write')) return true;
  }

  return false;
}

export function canAccessPoolPage(
  checkPerm: (action: string) => boolean,
  pathSuffix: string,
): boolean {
  const act = getPoolPageReadAction(pathSuffix);
  if (!act) return true;
  return checkPerm(act);
}

export function getResourceHubSubReadAction(sub: CloudmapResourceSubKey): string | undefined {
  return getPoolPageReadAction(`resource_hub/${sub}`);
}

export function canAccessResourceHubSub(
  checkPerm: (action: string) => boolean,
  sub: CloudmapResourceSubKey,
): boolean {
  const act = getResourceHubSubReadAction(sub);
  if (!act) return false;
  return checkPerm(act);
}

/** 同组内第一个可访问的资源总览子页 */
export function firstAccessibleResourceHubSub(
  checkPerm: (action: string) => boolean,
): CloudmapResourceSubKey | null {
  for (const sub of RESOURCE_HUB_SUB_ORDER) {
    if (canAccessResourceHubSub(checkPerm, sub)) return sub;
  }
  return null;
}
