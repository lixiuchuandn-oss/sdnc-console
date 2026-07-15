import React from 'react';
import { CodeOutlined, SettingOutlined } from '@ant-design/icons';
import { GROUPS, PLATFORMS, PLATFORM_LABELS } from '../../../constants/navigation';
import { routeSpecs } from '../../../routes/RouteSpec';
import type { RouteSpec } from '../../../routes/RouteSpec';
import { iconOf } from '../../../utils/iconOf';
import type { AdminMenuItem, AdminSidebarCenter } from '../AdminSidebar';
import { buildGroupMenuChildren } from './adminLayoutNav';

function platformCenterKey(pf: string): string {
  if (pf === 'SDNCC') return '/admin/cen_sdn';
  return '/admin/cen_settings';
}

function sortSpecsByGroupAndOrder(specs: RouteSpec[]): RouteSpec[] {
  return [...specs].sort((a, b) => {
    const idxA = GROUPS.indexOf(String(a.group || '') as (typeof GROUPS)[number]);
    const idxB = GROUPS.indexOf(String(b.group || '') as (typeof GROUPS)[number]);
    const safeA = idxA === -1 ? 999 : idxA;
    const safeB = idxB === -1 ? 999 : idxB;
    if (safeA !== safeB) return safeA - safeB;
    return Number(a.order ?? 0) - Number(b.order ?? 0);
  });
}

function platformHeaderIcon(pf: string): React.ReactNode {
  if (pf === 'SETTINGS') return <SettingOutlined />;
  return <CodeOutlined />;
}

/** 由 RouteSpec 构建各平台侧栏菜单树（未做 RBAC 过滤；菜单项扁平，不按 group 再套一层 SubMenu） */
export function buildAdminPlatformCenters(): AdminSidebarCenter[] {
  const adminSpecs = routeSpecs.filter((s) => s.layout === 'admin' && !s.hidden);

  return PLATFORMS.filter((p) => p !== '全部').map((pf) => {
    const platformSpecs = adminSpecs.filter((s) => s.platform === pf);
    const topLevelSpecs = platformSpecs.filter((s) => !s.group);
    const groupedSpecs = platformSpecs.filter((s) => !!s.group);
    const topLevelItems: AdminMenuItem[] = topLevelSpecs
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .map((s) => ({
        key: s.path,
        label: s.title || s.breadcrumbLabel || s.id,
        icon: iconOf(s.icon),
      }));
    const flatGroupedItems = buildGroupMenuChildren(sortSpecsByGroupAndOrder(groupedSpecs));

    return {
      key: platformCenterKey(pf),
      label: PLATFORM_LABELS[pf as keyof typeof PLATFORM_LABELS] || pf,
      icon: platformHeaderIcon(pf),
      items: [...topLevelItems, ...flatGroupedItems],
    };
  });
}

function menuItemKey(item: AdminMenuItem): string {
  return String(item.key ?? '');
}

export type AdminMenuAccessContext = {
  canAccessPath: (path: string) => boolean;
};

/** RBAC 过滤平台菜单，供侧栏与全局搜索共用 */
export function filterVisibleAdminCenters(
  centers: AdminSidebarCenter[],
  ctx: AdminMenuAccessContext,
): AdminSidebarCenter[] {
  const { canAccessPath } = ctx;

  return centers
    .map((c) => ({
      ...c,
      items: (c.items || [])
        .map((p) => {
          if (!p.children) return p;
          return {
            ...p,
            children: (p.children || []).filter((it) => canAccessPath(menuItemKey(it))),
          };
        })
        .filter((p) => {
          if (p.children) return (p.children || []).length > 0;
          return canAccessPath(menuItemKey(p));
        }),
    }))
    .filter((c) => (c.items || []).length > 0);
}
