/**
 * Xinference 边缘推理资源池侧栏：`/admin/clouds/vendor/xinference/:cloudId` 时由 AdminLayout 注入。
 */
import { createElement, type ReactNode } from 'react';
import { DashboardOutlined, PlayCircleOutlined, ShopOutlined } from '@ant-design/icons';
import type { AdminSidebarCenter } from '../AdminSidebar';
import { type Cloud, isXinferencePoolCloud } from '../../../pages/cnmc/pools/lib/poolProviders';

export const XINFERENCE_POOL_SIDEBAR_CENTER_KEY = '/admin/xinference_pool_context';

const XINFERENCE_POOL_PREFIX = '/admin/clouds/vendor/xinference';

export const XINFERENCE_POOL_TAB_KEYS = ['dashboard', 'model_gallery', 'running_models'] as const;

export type XinferencePoolTabKey = (typeof XINFERENCE_POOL_TAB_KEYS)[number];

const TAB_LABEL: Record<XinferencePoolTabKey, string> = {
  dashboard: '仪表板',
  model_gallery: '模型广场',
  running_models: '运行模型',
};

const TAB_ICON: Record<XinferencePoolTabKey, ReactNode> = {
  dashboard: createElement(DashboardOutlined),
  model_gallery: createElement(ShopOutlined),
  running_models: createElement(PlayCircleOutlined),
};

export function parseXinferencePoolDetailId(pathname: string): string | null {
  if (!pathname.startsWith(`${XINFERENCE_POOL_PREFIX}/`)) return null;
  const rest = pathname.slice((XINFERENCE_POOL_PREFIX + '/').length).split('/').filter(Boolean);
  if (rest.length !== 1) return null;
  return decodeURIComponent(rest[0]);
}

export function xinferencePoolBasePath(cloudId: string): string {
  return `${XINFERENCE_POOL_PREFIX}/${encodeURIComponent(cloudId)}`;
}

export function xinferencePoolPathForTab(cloudId: string, tab: XinferencePoolTabKey): string {
  return `${xinferencePoolBasePath(cloudId)}?tab=${encodeURIComponent(tab)}`;
}

export function normalizeXinferencePoolTabParam(tab: string | null): XinferencePoolTabKey {
  const t = String(tab || '').trim();
  if (t === 'launch_models') return 'model_gallery';
  if ((XINFERENCE_POOL_TAB_KEYS as readonly string[]).includes(t)) {
    return t as XinferencePoolTabKey;
  }
  return 'dashboard';
}

function xinferencePoolMenuItems(cloudId: string): any[] {
  return (XINFERENCE_POOL_TAB_KEYS as readonly XinferencePoolTabKey[]).map((k) => ({
    key: xinferencePoolPathForTab(cloudId, k),
    label: TAB_LABEL[k],
    icon: TAB_ICON[k],
  }));
}

export function xinferencePoolSidebarSelectedKey(
  cloudId: string,
  pathname: string,
  search: string,
): string {
  const id = parseXinferencePoolDetailId(pathname);
  if (!id || id !== cloudId) {
    return xinferencePoolPathForTab(cloudId, 'dashboard');
  }
  const tab = normalizeXinferencePoolTabParam(new URLSearchParams(search).get('tab'));
  return xinferencePoolPathForTab(cloudId, tab);
}

export function buildXinferencePoolSidebarCenter(
  cloud: Cloud,
  cloudId: string,
): AdminSidebarCenter | null {
  if (!cloudId || !cloud || !isXinferencePoolCloud(cloud)) return null;
  return {
    key: XINFERENCE_POOL_SIDEBAR_CENTER_KEY,
    label: cloud.name || 'Xinference 资源池',
    items: xinferencePoolMenuItems(cloudId),
  };
}
