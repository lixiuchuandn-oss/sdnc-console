/**
 * AdminLayout 导航相关纯函数与静态常量（从 AdminLayout.tsx 抽出，便于复用与单测）。
 * 仅放「无 React 状态依赖」的计算/常量；有状态的逻辑见 admin/hooks/。
 */
import React from 'react';
import type { RouteSpec } from '../../../routes/RouteSpec';
import { routeSpecs } from '../../../routes/RouteSpec';
import { iconOf } from '../../../utils/iconOf';
import { type Cloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import { buildPoolEntryPath, inferPoolRouteKind } from '../../../pages/cnmc/pools/lib/poolDetailNav';

/** 顶栏高度（与 sticky、抽屉 top、侧栏 top 对齐） */
export const ADMIN_HEADER_HEIGHT_PX = 64;

/** 顶栏资源池条：外框（与业务逻辑无关的静态样式集中） */
export const HEADER_POOL_STRIP_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  fontSize: 14,
  color: 'rgba(255,255,255,0.92)',
  border: '1px solid rgba(255,255,255,0.38)',
  borderRadius: 8,
  padding: 4,
  background: 'rgba(255,255,255,0.06)',
  boxSizing: 'border-box',
};

/** 顶栏切换池 /「访问」：厂商池（Xinference、MAAS、Rancher 等）走 `buildPoolEntryPath`；Cloudmap 仍进资源总览。 */
export function poolOverviewPath(cloudId: string, clouds: Cloud[]): string {
  const c = clouds.find((x) => String(x.id) === String(cloudId));
  if (!c) {
    return `/admin/clouds/${encodeURIComponent(cloudId)}/resource_hub/overview`;
  }
  const kind = inferPoolRouteKind(c);
  if (kind.kind === 'vendor' || kind.kind === 'cloudmap-csm') {
    return buildPoolEntryPath(c);
  }
  return `/admin/clouds/${encodeURIComponent(cloudId)}/resource_hub/overview`;
}

export function byCloudCreatedAtAsc(a: Cloud, b: Cloud): number {
  const ta = Date.parse(String(a.createdAt || '')) || 0;
  const tb = Date.parse(String(b.createdAt || '')) || 0;
  return ta - tb;
}

/**
 * 默认资源池：显式 config.isDefault；否则按创建时间取「第一个添加的」池。
 */
export function pickDefaultPoolId(clouds: Cloud[]): string | undefined {
  if (!clouds.length) return undefined;
  const cfg = (c: Cloud) => Boolean((c.config as Record<string, unknown> | undefined)?.isDefault);
  const flagged = clouds.find(cfg);
  if (flagged) return flagged.id;
  const sorted = [...clouds].sort(byCloudCreatedAtAsc);
  return sorted[0]?.id;
}

export function resolveDefaultPool(clouds: Cloud[]): Cloud | undefined {
  const id = pickDefaultPoolId(clouds);
  return id ? clouds.find((c) => c.id === id) : undefined;
}

export function firstMenuPathInCenter(center: { items?: unknown[] }): string | null {
  const first = (center.items || [])[0] as { key?: string; children?: { key?: string }[] } | undefined;
  const page = first?.children?.length ? first.children[0] : first;
  const key = page && 'key' in page ? page.key : undefined;
  return typeof key === 'string' && key.startsWith('/') ? key : null;
}

/** 组内菜单：含 `parentId` 的项挂到父 `RouteSpec` 下为子菜单（如 安全资源池 → 资源池列表 + 防护对象管理） */
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
          requiredFeature: root.requiredFeature,
        };
      }
      return {
        key: `__sub__${root.id}`,
        label: root.title || root.breadcrumbLabel || root.id,
        icon: iconOf(root.icon),
        requiredFeature: root.requiredFeature,
        children: [
          { key: root.path, label: '资源池列表', requiredFeature: root.requiredFeature },
          ...subs.map((s) => ({
            key: s.path,
            label: s.title || s.breadcrumbLabel || s.id,
            requiredFeature: s.requiredFeature,
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
    if (found.platform === 'CNMC') return '/admin/cen_compute';
    if (found.platform === 'TENANTS') return '/admin/cen_tenants';
    if (found.platform === 'SDNCC') return '/admin/cen_sdn';
    if (found.platform === 'CNSOC') return '/admin/cen_secops';
    if (found.platform === 'SETTINGS') return '/admin/cen_settings';
  }

  const s = p.toLowerCase();
  if (s.includes('/interconnect') || s.includes('/sec-mgr-plane') || s.includes('/security/traffic')) {
    return '/admin/cen_sdn';
  }
  if (s.includes('/alarms') || s.includes('/soc') || s.includes('/aisoc')) {
    return '/admin/cen_secops';
  }
  if (s.includes('/settings')) {
    return '/admin/cen_settings';
  }
  return '/admin/cen_compute';
}

export type PageSearchEntry = {
  path: string;
  title: string;
  icon: React.ReactNode;
  label: string;
  group: string;
};
