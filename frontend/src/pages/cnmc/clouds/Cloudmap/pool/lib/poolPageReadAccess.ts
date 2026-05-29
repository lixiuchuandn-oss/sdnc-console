/**
 * Cloudmap 池内页 RBAC（唯一落点）
 *
 * - 侧栏/路由/抽屉：`cloudmapPoolNavRows` → poolPageAction / poolPageDisplayOnly
 * - 租户控制台严格读：`checkPoolPageReadPerm`（不用 clouds:read 兜底）
 * - 管理端池内：`canAccessPoolPage` / `canWritePoolPage`（经 hasPermissionForAction，含页级隐式读）
 * - 角色勾选：`expandRoleGrantOnCheck`（仅 write→read）
 *
 * 页级隐式读（机房/网络拓扑拉数）与 backend checker 对齐，见 POOL_PAGE_IMPLIED_READ_BASES。
 * 设计原则见 docs/cloudmap-pool-rbac.md。
 */
import { CLOUDMAP_POOL_NAV_ROWS } from '../../../../../../routes/cloudmapPoolNavRows';
import type { CloudmapResourceSubKey } from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { isCloudsContainersResourceBase } from '../../../../../../utils/permissionUtils';

export type PoolPageRowMeta = {
  pathSuffix: string;
  readAction: string;
  writeAction: string | null;
  displayOnly: boolean;
};

const PAGE_META_BY_SUFFIX = new Map<string, PoolPageRowMeta>(
  CLOUDMAP_POOL_NAV_ROWS.filter((r) => r.poolPageAction).map((r) => {
    const readAction = r.poolPageAction!;
    const displayOnly = !!r.poolPageDisplayOnly;
    return [
      r.pathSuffix,
      {
        pathSuffix: r.pathSuffix,
        readAction,
        writeAction: displayOnly ? null : poolPageWriteAction(readAction),
        displayOnly,
      },
    ];
  }),
);

/** 页 token（prefix）→ 运行时隐式满足的其它读 prefix（仅 read，不含写） */
export const POOL_PAGE_IMPLIED_READ_BASES: Readonly<Record<string, readonly string[]>> = {};

/** 资源总览子页访问顺序（路径同步 fallback） */
export const RESOURCE_HUB_SUB_ORDER: readonly CloudmapResourceSubKey[] = [
  'overview',
  'datacenter_topology',
  'network_topology',
];

export function poolPageWriteAction(readAction: string): string {
  if (readAction === 'clouds.console:read') return 'clouds.console:write';
  if (readAction.endsWith(':read')) return `${readAction.slice(0, -':read'.length)}:write`;
  return 'clouds.console:write';
}

export function getPoolPageMeta(pathSuffix: string): PoolPageRowMeta | undefined {
  return PAGE_META_BY_SUFFIX.get(pathSuffix);
}

export function getPoolPageReadAction(pathSuffix: string): string | undefined {
  return PAGE_META_BY_SUFFIX.get(pathSuffix)?.readAction;
}

export function isPoolPageDisplayOnly(pathSuffix: string): boolean {
  return PAGE_META_BY_SUFFIX.get(pathSuffix)?.displayOnly ?? false;
}

/**
 * 池内主页面读权限（严格）：租户控制台用；不用 clouds.console / clouds:read 兜底。
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

/** 管理端 / 池内：能否进入某叶子页（checkPerm 通常为 hasPermissionForAction） */
export function canAccessPoolPage(
  checkPerm: (action: string) => boolean,
  pathSuffix: string,
): boolean {
  const act = getPoolPageReadAction(pathSuffix);
  if (!act) return true;
  return checkPerm(act);
}

/** 池内页写操作（如机房拓扑机柜/插板）；纯展示页恒 false */
export function canWritePoolPage(
  checkPerm: (action: string) => boolean,
  pathSuffix: string,
): boolean {
  const meta = getPoolPageMeta(pathSuffix);
  if (!meta?.writeAction) return false;
  const base = meta.writeAction.split(':')[0];
  if (isCloudsContainersResourceBase(base)) {
    return checkPerm(meta.writeAction);
  }
  return checkPerm(meta.writeAction) || checkPerm('clouds:write');
}

export function getResourceHubSubReadAction(sub: CloudmapResourceSubKey): string | undefined {
  return getPoolPageReadAction(`resource_hub/${sub}`);
}

export function canAccessResourceHubSub(
  checkPerm: (action: string) => boolean,
  sub: CloudmapResourceSubKey,
): boolean {
  return canAccessPoolPage(checkPerm, `resource_hub/${sub}`);
}

export function firstAccessibleResourceHubSub(
  checkPerm: (action: string) => boolean,
): CloudmapResourceSubKey | null {
  for (const sub of RESOURCE_HUB_SUB_ORDER) {
    if (canAccessResourceHubSub(checkPerm, sub)) return sub;
  }
  return null;
}

/** 角色配置抽屉：勾选 write 时自动带上同资源 read（实现见 utils/roleGrantExpand.ts） */
export { expandRoleGrantOnCheck } from '../../../../../../utils/roleGrantExpand';
