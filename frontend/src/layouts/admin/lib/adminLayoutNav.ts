/**
 * AdminLayout 导航相关纯函数与静态常量（从 AdminLayout.tsx 抽出，便于复用与单测）。
 * 仅放「无 React 状态依赖」的计算/常量；有状态的逻辑见 admin/hooks/。
 */
import React from 'react';
import type { RouteSpec } from '../../../routes/RouteSpec';
import { routeSpecs } from '../../../routes/RouteSpec';
import { iconOf } from '../../../utils/iconOf';

/** 顶栏高度（与 sticky、抽屉 top、侧栏 top 对齐） */
export const ADMIN_HEADER_HEIGHT_PX = 64;

export function firstMenuPathInCenter(center: { items?: unknown[] }): string | null {
  const first = (center.items || [])[0] as { key?: string; children?: { key?: string }[] } | undefined;
  const page = first?.children?.length ? first.children[0] : first;
  const key = page && 'key' in page ? page.key : undefined;
  return typeof key === 'string' && key.startsWith('/') ? key : null;
}

/** 组内菜单：含 `parentId` 的项挂到父 RouteSpec 下为子菜单 */
export function buildGroupMenuChildren(specs: RouteSpec[]) {
  const sorted = [...specs].sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0));
  return sorted
    .filter((s) => !s.parentId)
    .map((root) => {
      const subs = sorted
        .filter((s) => s.parentId === root.id)
        .sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0));
      if (subs.length === 0) {
        return {
          key: root.path,
          label: root.title || root.breadcrumbLabel || root.id,
          icon: iconOf(root.icon),
        };
      }
      return {
        key: `__sub__${root.id}`,
        label: root.title || root.breadcrumbLabel || root.id,
        icon: iconOf(root.icon),
        children: [
          {
            key: root.path,
            label: root.title || root.breadcrumbLabel || root.id,
          },
          ...subs.map((s) => ({
            key: s.path,
            label: s.title || s.breadcrumbLabel || s.id,
          })),
        ],
      };
    });
}

/** 当前路径在侧栏 `items` 树中对应的各级 SubMenu 的 `openKeys`（无嵌套时为空数组，仅展开分组） */
export function findMenuOpenKeyChainForPath(
  items: unknown[] | undefined,
  currentPath: string,
  ancestors: string[] = [],
): string[] | null {
  if (!items?.length) return null;
  for (const raw of items) {
    const item = raw as { key?: string; children?: unknown[] };
    const k = String(item.key ?? '');
    const keyPath = k.split('?')[0];
    if (k.startsWith('/') && keyPath === currentPath) {
      return ancestors;
    }
    if (item.children?.length) {
      const nextAnc = k && !k.startsWith('/') ? [...ancestors, k] : ancestors;
      const hit = findMenuOpenKeyChainForPath(item.children, currentPath, nextAnc);
      if (hit) return hit;
    }
  }
  return null;
}

/** 由当前路径解析应高亮的平台侧栏 key */
export function sidebarForPath(p: string): string {
  const matchesPath = (targetPath: string, patternPath: string): boolean => {
    const targetSegments = targetPath.split('/').filter(Boolean);
    const patternSegments = patternPath.split('/').filter(Boolean);
    if (targetSegments.length < patternSegments.length) return false;
    for (let i = 0; i < patternSegments.length; i += 1) {
      const patternSeg = patternSegments[i];
      const targetSeg = targetSegments[i];
      if (!patternSeg.startsWith(':') && patternSeg !== targetSeg) {
        return false;
      }
    }
    return true;
  };
  const orderedSpecs = [...routeSpecs].sort((a, b) => b.path.length - a.path.length);
  const found = orderedSpecs.find((r) => matchesPath(p, r.path));

  if (found?.platform) {
    if (found.platform === 'SDNCC') return '/admin/cen_sdn';
    if (found.platform === 'SETTINGS') return '/admin/cen_settings';
  }

  const s = p.toLowerCase();
  if (s.includes('/interconnect')) {
    return '/admin/cen_sdn';
  }
  if (s.includes('/settings') || s.includes('/access/')) {
    return '/admin/cen_settings';
  }
  return '/admin/cen_sdn';
}

export type PageSearchEntry = {
  path: string;
  title: string;
  icon: React.ReactNode;
  label: string;
  group: string;
};
