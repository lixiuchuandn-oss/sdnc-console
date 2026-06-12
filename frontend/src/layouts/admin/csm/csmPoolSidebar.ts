/**
 * CSM 安全资源池详情侧栏：与 `sdncc/csm/pools/CloudDetailCsm` Tabs 一致，URL 使用 `?tab=`。
 * 路径：`/admin/security/traffic/csm-pools/:cloudId` 时由 AdminLayout 注入。
 */
import { createElement, type ReactNode } from 'react';
import {
  ClusterOutlined,
  DeploymentUnitOutlined,
  DesktopOutlined,
  FileTextOutlined,
  LeftOutlined,
  NodeIndexOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import type { AdminSidebarCenter } from '../AdminSidebar';
import { type Cloud, isCsmCloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import type {
  PoolSidebarBuildArgs,
  PoolSidebarSelectArgs,
  PoolSidebarSpec,
} from '../poolSidebar/types';

export const CSM_POOL_SIDEBAR_CENTER_KEY = '/admin/csm_pool_context';

const CSM_POOL_PREFIX = '/admin/security/traffic/csm-pools';

export const CSM_POOL_TAB_KEYS = [
  'physical',
  'vrouters',
  'assets',
  'virtual',
  'groups',
  'serviceChains',
  'policies',
  'securityDomains',
  'tenants',
] as const;

export type CsmPoolTabKey = (typeof CSM_POOL_TAB_KEYS)[number];

const TAB_LABEL: Record<CsmPoolTabKey, string> = {
  physical: '物理主机',
  vrouters: 'VSW 集群',
  assets: '防护对象',
  virtual: '虚拟安全网元',
  groups: '安全网元组',
  serviceChains: '服务链',
  policies: '阻断策略',
  securityDomains: 'CSM 安全域',
  tenants: '租户',
};

const TAB_ICON: Record<CsmPoolTabKey, ReactNode> = {
  physical: createElement(NodeIndexOutlined),
  vrouters: createElement(DeploymentUnitOutlined),
  assets: createElement(DesktopOutlined),
  virtual: createElement(DeploymentUnitOutlined),
  groups: createElement(SafetyCertificateOutlined),
  serviceChains: createElement(UnorderedListOutlined),
  policies: createElement(FileTextOutlined),
  securityDomains: createElement(ClusterOutlined),
  tenants: createElement(TeamOutlined),
};

export function parseCsmPoolDetailId(pathname: string): string | null {
  if (!pathname.startsWith(`${CSM_POOL_PREFIX}/`)) return null;
  const rest = pathname.slice((CSM_POOL_PREFIX + '/').length).split('/').filter(Boolean);
  if (rest.length !== 1) return null;
  return decodeURIComponent(rest[0]);
}

export function csmPoolBasePath(cloudId: string): string {
  return `${CSM_POOL_PREFIX}/${encodeURIComponent(cloudId)}`;
}

export function csmPoolPathForTab(cloudId: string, tab: CsmPoolTabKey): string {
  return `${csmPoolBasePath(cloudId)}?tab=${encodeURIComponent(tab)}`;
}

export function normalizeCsmPoolTabParam(tab: string | null): CsmPoolTabKey {
  const t = String(tab || '').trim();
  if ((CSM_POOL_TAB_KEYS as readonly string[]).includes(t)) {
    return t as CsmPoolTabKey;
  }
  return 'physical';
}

function csmPoolMenuItems(cloudId: string): any[] {
  const backToList = {
    key: CSM_POOL_PREFIX,
    label: '返回安全资源池列表',
    icon: createElement(LeftOutlined),
  };
  const tabItems = (CSM_POOL_TAB_KEYS as readonly CsmPoolTabKey[]).map((k) => ({
    key: csmPoolPathForTab(cloudId, k),
    label: TAB_LABEL[k],
    icon: TAB_ICON[k],
  }));
  return [backToList, ...tabItems];
}

/**
 * 与侧栏 `items[].key` 一致：当前 `pathname` + 查询 `tab` 对应的整段 URL（含 `?`）。
 */
export function csmPoolSidebarSelectedKey(
  cloudId: string,
  pathname: string,
  search: string,
): string {
  const id = parseCsmPoolDetailId(pathname);
  if (!id || id !== cloudId) {
    return csmPoolPathForTab(cloudId, 'physical');
  }
  const tab = normalizeCsmPoolTabParam(new URLSearchParams(search).get('tab'));
  return csmPoolPathForTab(cloudId, tab);
}

export function buildCsmPoolSidebarCenter(cloud: Cloud, cloudId: string): AdminSidebarCenter | null {
  if (!cloudId || !cloud || !isCsmCloud(cloud)) return null;
  return {
    key: CSM_POOL_SIDEBAR_CENTER_KEY,
    label: cloud.name || 'CSM 资源池',
    items: csmPoolMenuItems(cloudId),
  };
}

/**
 * CSM 安全资源池上下文侧栏 spec（external-redirect / `?tab=`）。
 * 基路径位于 SDNCC：`/admin/security/traffic/csm-pools/:cloudId`，侧栏含「返回列表」项。
 */
export const csmPoolSidebarSpec: PoolSidebarSpec = {
  type: 'csm',
  presentation: 'context-sidebar',
  subNav: 'tab',
  tier: 'external-redirect',
  centerKey: CSM_POOL_SIDEBAR_CENTER_KEY,
  label: 'CSM 资源池',
  icon: createElement(SafetyCertificateOutlined),
  navKeys: CSM_POOL_TAB_KEYS,
  pathForTab: (cloudId: string, tab: string) => csmPoolPathForTab(cloudId, tab as CsmPoolTabKey),
  normalizeTabParam: (tab: string | null) => normalizeCsmPoolTabParam(tab),
  resolveContext: (pathname: string) => {
    const id = parseCsmPoolDetailId(pathname);
    return id ? { poolId: id } : null;
  },
  matchCloud: (cloud: Cloud) => isCsmCloud(cloud),
  buildSidebarCenter: ({ context, cloud, summaryCloudCount }: PoolSidebarBuildArgs) => {
    if (!cloud) return null;
    if (summaryCloudCount > 0 && !isCsmCloud(cloud)) return null;
    return buildCsmPoolSidebarCenter(cloud, context.poolId);
  },
  selectedKey: ({ context, pathname, search }: PoolSidebarSelectArgs) =>
    csmPoolSidebarSelectedKey(context.poolId, pathname, search),
  autoExpandByMenuKey: true,
  autoExpandSigPrefix: 'csm-pool',
};
