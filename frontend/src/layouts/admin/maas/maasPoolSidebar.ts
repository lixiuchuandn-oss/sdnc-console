/**
 * MAAS 裸金属资源池侧栏：`/admin/clouds/vendor/maas/:cloudId` 时由 AdminLayout 注入。
 */
import { createElement, type ReactNode } from 'react';
import {
  DashboardOutlined,
  HddOutlined,
  GlobalOutlined,
  PictureOutlined,
  RadarChartOutlined,
} from '@ant-design/icons';
import type { AdminSidebarCenter } from '../AdminSidebar';
import { type Cloud, isMaasPoolCloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import type {
  PoolSidebarBuildArgs,
  PoolSidebarSelectArgs,
  PoolSidebarSpec,
} from '../poolSidebar/types';
import {
  MAAS_POOL_TAB_KEYS,
  MAAS_POOL_TAB_LEGACY_ALIASES,
  type MaasPoolTabKey,
} from '../../../pages/cnmc/clouds/maas/lib/maasPoolTabs';

export { MAAS_POOL_TAB_KEYS };
export type { MaasPoolTabKey };

export const MAAS_POOL_SIDEBAR_CENTER_KEY = '/admin/maas_pool_context';

const MAAS_POOL_PREFIX = '/admin/clouds/vendor/maas';

const TAB_LABEL: Record<MaasPoolTabKey, string> = {
  dashboard: '概览',
  machines: '裸金属机器',
  discoveries: '网络发现',
  images: '操作系统镜像',
  network: '子网 / VLAN',
};

const TAB_ICON: Record<MaasPoolTabKey, ReactNode> = {
  dashboard: createElement(DashboardOutlined),
  machines: createElement(HddOutlined),
  discoveries: createElement(RadarChartOutlined),
  images: createElement(PictureOutlined),
  network: createElement(GlobalOutlined),
};

export function parseMaasPoolDetailId(pathname: string): string | null {
  if (!pathname.startsWith(`${MAAS_POOL_PREFIX}/`)) return null;
  const rest = pathname.slice((MAAS_POOL_PREFIX + '/').length).split('/').filter(Boolean);
  if (rest.length !== 1) return null;
  return decodeURIComponent(rest[0]);
}

export function maasPoolBasePath(cloudId: string): string {
  return `${MAAS_POOL_PREFIX}/${encodeURIComponent(cloudId)}`;
}

export function maasPoolPathForTab(cloudId: string, tab: MaasPoolTabKey): string {
  return `${maasPoolBasePath(cloudId)}?tab=${encodeURIComponent(tab)}`;
}

export function normalizeMaasPoolTabParam(tab: string | null): MaasPoolTabKey {
  const t = String(tab || '').trim();
  if ((MAAS_POOL_TAB_KEYS as readonly string[]).includes(t)) {
    return t as MaasPoolTabKey;
  }
  const legacy = MAAS_POOL_TAB_LEGACY_ALIASES[t];
  if (legacy) return legacy;
  return 'dashboard';
}

function maasPoolMenuItems(cloudId: string): { key: string; label: string; icon: ReactNode }[] {
  return (MAAS_POOL_TAB_KEYS as readonly MaasPoolTabKey[]).map((k) => ({
    key: maasPoolPathForTab(cloudId, k),
    label: TAB_LABEL[k],
    icon: TAB_ICON[k],
  }));
}

export function maasPoolSidebarSelectedKey(
  cloudId: string,
  pathname: string,
  search: string,
): string {
  const id = parseMaasPoolDetailId(pathname);
  if (!id || id !== cloudId) {
    return maasPoolPathForTab(cloudId, 'dashboard');
  }
  const tab = normalizeMaasPoolTabParam(new URLSearchParams(search).get('tab'));
  return maasPoolPathForTab(cloudId, tab);
}

export function buildMaasPoolSidebarCenter(
  cloud: Cloud,
  cloudId: string,
): AdminSidebarCenter | null {
  if (!cloudId || !cloud || !isMaasPoolCloud(cloud)) return null;
  return {
    key: MAAS_POOL_SIDEBAR_CENTER_KEY,
    label: cloud.name || '裸金属',
    items: maasPoolMenuItems(cloudId),
  };
}

/** MAAS 裸金属资源池上下文侧栏 spec（simple / `?tab=`）。路径：`/admin/clouds/vendor/maas/:cloudId`。 */
export const maasPoolSidebarSpec: PoolSidebarSpec = {
  type: 'maas',
  presentation: 'context-sidebar',
  subNav: 'tab',
  tier: 'simple',
  centerKey: MAAS_POOL_SIDEBAR_CENTER_KEY,
  label: '裸金属',
  icon: createElement(HddOutlined),
  navKeys: MAAS_POOL_TAB_KEYS,
  pathForTab: (cloudId: string, tab: string) => maasPoolPathForTab(cloudId, tab as MaasPoolTabKey),
  normalizeTabParam: (tab: string | null) => normalizeMaasPoolTabParam(tab),
  resolveContext: (pathname: string) => {
    const id = parseMaasPoolDetailId(pathname);
    return id ? { poolId: id } : null;
  },
  matchCloud: (cloud: Cloud) => isMaasPoolCloud(cloud),
  buildSidebarCenter: ({ context, cloud, summaryCloudCount }: PoolSidebarBuildArgs) => {
    if (!cloud) return null;
    if (summaryCloudCount > 0 && !isMaasPoolCloud(cloud)) return null;
    return buildMaasPoolSidebarCenter(cloud, context.poolId);
  },
  selectedKey: ({ context, pathname, search }: PoolSidebarSelectArgs) =>
    maasPoolSidebarSelectedKey(context.poolId, pathname, search),
};
