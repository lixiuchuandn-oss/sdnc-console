import React from 'react';
import { CodeOutlined, SettingOutlined } from '@ant-design/icons';
import { GROUPS, PLATFORMS, PLATFORM_LABELS } from '../../../constants/navigation';
import { routeSpecs } from '../../../routes/RouteSpec';
import { iconOf } from '../../../utils/iconOf';
import type { AdminMenuItem, AdminSidebarCenter } from '../AdminSidebar';
import { buildGroupMenuChildren } from './adminLayoutNav';

function platformCenterKey(pf: string): string {
  if (pf === 'SDNCC') return '/admin/cen_sdn';
  return '/admin/cen_settings';
}

function groupIconOf(pf: string, grp: string): React.ReactNode {
  const visible = routeSpecs
    .filter((s) => s.layout === 'admin' && s.platform === pf && s.group === grp && !s.hidden)
    .sort((a, b) => Number(a.order ?? 9999) - Number(b.order ?? 9999));
  const all = routeSpecs
    .filter((s) => s.layout === 'admin' && s.platform === pf && s.group === grp)
    .sort((a, b) => Number(a.order ?? 9999) - Number(b.order ?? 9999));
  const list = visible.length > 0 ? visible : all;
  const firstWithIcon = list.find((s) => !!s.icon) || list[0];
  return iconOf(firstWithIcon?.icon);
}

function platformHeaderIcon(pf: string): React.ReactNode {
  if (pf === 'SETTINGS') return <SettingOutlined />;
  return <CodeOutlined />;
}

/** 由 RouteSpec 构建各平台侧栏菜单树（未做 RBAC 过滤） */
export function buildAdminPlatformCenters(): AdminSidebarCenter[] {
  const adminSpecs = routeSpecs.filter((s) => s.layout === 'admin' && !s.hidden);

  return PLATFORMS.filter((p) => p !== '全部').map((pf) => {
    const platformSpecs = adminSpecs.filter((s) => s.platform === pf);
    const topLevelSpecs = platformSpecs.filter((s) => !s.group);
    const groupedSpecs = platformSpecs.filter((s) => !!s.group);
    const topLevelItems = topLevelSpecs
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .map((s) => ({
        key: s.path,
        label: s.title || s.breadcrumbLabel || s.id,
        icon: iconOf(s.icon),
      }));
    const groupItems = Array.from(new Set(groupedSpecs.map((s) => String(s.group || ''))))
      .sort((a, b) => {
        const idxA = GROUPS.indexOf(a as (typeof GROUPS)[number]);
        const idxB = GROUPS.indexOf(b as (typeof GROUPS)[number]);
        const safeA = idxA === -1 ? 999 : idxA;
        const safeB = idxB === -1 ? 999 : idxB;
        return safeA - safeB;
      })
      .map((grp) => ({
        key: `${pf}_${grp}`,
        label: grp,
        icon: groupIconOf(pf, grp),
        children: buildGroupMenuChildren(groupedSpecs.filter((s) => s.group === grp)),
      }));

    return {
      key: platformCenterKey(pf),
      label: PLATFORM_LABELS[pf as keyof typeof PLATFORM_LABELS] || pf,
      icon: platformHeaderIcon(pf),
      items: [...topLevelItems, ...groupItems],
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
