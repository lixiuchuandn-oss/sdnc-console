/**
 * 边缘推理资源池侧栏：`/admin/clouds/vendor/xinference/:cloudId` 时由 AdminLayout 注入。
 * Xinference + 同机 Dify 菜单平铺。
 */
import { createElement, type ReactNode } from 'react';
import {
  ApiOutlined,
  AppstoreOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FormOutlined,
  LineChartOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  ShopOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { AdminSidebarCenter } from '../AdminSidebar';
import { type Cloud, isXinferencePoolCloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import type {
  PoolSidebarBuildArgs,
  PoolSidebarSelectArgs,
  PoolSidebarSpec,
} from '../poolSidebar/types';
import {
  DIFY_CONSOLE_NAV_ENTRIES,
  XINFERENCE_INFERENCE_TAB_KEYS,
  XINFERENCE_POOL_TAB_KEYS,
  type XinferenceDifyTabKey,
  type XinferenceInferenceTabKey,
  type XinferencePoolTabKey,
} from '../../../pages/cnmc/clouds/Xinference/lib/difyConsoleNav';

export { XINFERENCE_POOL_TAB_KEYS };
export type { XinferencePoolTabKey };

export const XINFERENCE_POOL_SIDEBAR_CENTER_KEY = '/admin/xinference_pool_context';

const XINFERENCE_POOL_PREFIX = '/admin/clouds/vendor/xinference';

const INFERENCE_TAB_LABEL: Record<XinferenceInferenceTabKey, string> = {
  dashboard: '仪表板',
  monitoring: '监控中心',
  model_gallery: '模型广场',
  model_register: '注册模型',
  running_models: '运行模型',
};

const INFERENCE_TAB_ICON: Record<XinferenceInferenceTabKey, ReactNode> = {
  dashboard: createElement(DashboardOutlined),
  monitoring: createElement(LineChartOutlined),
  model_gallery: createElement(ShopOutlined),
  model_register: createElement(FormOutlined),
  running_models: createElement(PlayCircleOutlined),
};

const DIFY_TAB_ICON: Record<XinferenceDifyTabKey, ReactNode> = {
  dify_apps: createElement(AppstoreOutlined),
  dify_datasets: createElement(DatabaseOutlined),
  dify_tools: createElement(ToolOutlined),
  dify_plugins: createElement(ApiOutlined),
  dify_settings: createElement(SettingOutlined),
  dify_data_source: createElement(CloudServerOutlined),
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
  if (t === 'model_downloads') return 'running_models';
  if (t === 'dify_explore') return 'dify_apps';
  if (t === 'dify_model_settings') return 'dify_settings';
  if ((XINFERENCE_POOL_TAB_KEYS as readonly string[]).includes(t)) {
    return t as XinferencePoolTabKey;
  }
  return 'dashboard';
}

function xinferencePoolMenuItems(cloudId: string): { key: string; label: string; icon: ReactNode }[] {
  const inference = (XINFERENCE_INFERENCE_TAB_KEYS as readonly XinferenceInferenceTabKey[]).map((k) => ({
    key: xinferencePoolPathForTab(cloudId, k),
    label: INFERENCE_TAB_LABEL[k],
    icon: INFERENCE_TAB_ICON[k],
  }));
  const dify = DIFY_CONSOLE_NAV_ENTRIES.map((e) => ({
    key: xinferencePoolPathForTab(cloudId, e.tab),
    label: e.label,
    icon: DIFY_TAB_ICON[e.tab],
  }));
  return [...inference, ...dify];
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
    label: cloud.name || '边缘推理池',
    items: xinferencePoolMenuItems(cloudId),
  };
}

/** 边缘推理资源池上下文侧栏 spec（simple / `?tab=`）。路径：`/admin/clouds/vendor/xinference/:cloudId`。 */
export const xinferencePoolSidebarSpec: PoolSidebarSpec = {
  type: 'xinference',
  presentation: 'context-sidebar',
  subNav: 'tab',
  tier: 'simple',
  centerKey: XINFERENCE_POOL_SIDEBAR_CENTER_KEY,
  label: '边缘推理池',
  icon: createElement(DashboardOutlined),
  navKeys: XINFERENCE_POOL_TAB_KEYS,
  pathForTab: (cloudId: string, tab: string) =>
    xinferencePoolPathForTab(cloudId, tab as XinferencePoolTabKey),
  normalizeTabParam: (tab: string | null) => normalizeXinferencePoolTabParam(tab),
  resolveContext: (pathname: string) => {
    const id = parseXinferencePoolDetailId(pathname);
    return id ? { poolId: id } : null;
  },
  matchCloud: (cloud: Cloud) => isXinferencePoolCloud(cloud),
  buildSidebarCenter: ({ context, cloud }: PoolSidebarBuildArgs) => {
    if (!cloud) return null;
    return buildXinferencePoolSidebarCenter(cloud, context.poolId);
  },
  selectedKey: ({ context, pathname, search }: PoolSidebarSelectArgs) =>
    xinferencePoolSidebarSelectedKey(context.poolId, pathname, search),
};
