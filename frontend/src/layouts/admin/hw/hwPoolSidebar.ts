/**
 * 华为云资源池侧栏：`/admin/clouds/vendor/huawei/:cloudId` 时由 AdminLayout 注入。
 * 子页切换由左侧栏 `?tab=` 驱动（沿用 MAAS / Xinference 方式），不再使用顶部 Tabs。
 * Tab key 与历史 `CloudDetailHw` 完全一致，仅改导航载体。
 */
import { createElement, type ReactNode } from 'react';
import {
  BranchesOutlined,
  ClusterOutlined,
  CloudServerOutlined,
  ConsoleSqlOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  GlobalOutlined,
  HddOutlined,
  KeyOutlined,
  LineChartOutlined,
  NodeIndexOutlined,
  PictureOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import type { AdminSidebarCenter } from '../AdminSidebar';
import { type Cloud, isHuaweiPoolCloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import type {
  PoolSidebarBuildArgs,
  PoolSidebarSelectArgs,
  PoolSidebarSpec,
} from '../poolSidebar/types';

export const HW_POOL_SIDEBAR_CENTER_KEY = '/admin/hw_pool_context';

const HW_POOL_PREFIX = '/admin/clouds/vendor/huawei';

/** 与历史 `CloudDetailHw` 的 Tabs key 一致（顺序即侧栏顺序）。 */
export const HW_POOL_TAB_KEYS = [
  'overview',
  'ecs',
  'vpc',
  'subnets',
  'securityGroups',
  'eips',
  'loadBalancers',
  'natGateways',
  'routeTables',
  'disks',
  'images',
  'keypairs',
  'rds',
  'monitor',
] as const;

export type HwPoolTabKey = (typeof HW_POOL_TAB_KEYS)[number];

const TAB_LABEL: Record<HwPoolTabKey, string> = {
  overview: '资源总览',
  ecs: '云主机',
  vpc: 'VPC',
  subnets: '子网',
  securityGroups: '安全组',
  eips: 'EIP',
  loadBalancers: '负载均衡',
  natGateways: 'NAT 网关',
  routeTables: '路由表',
  disks: '云盘',
  images: '镜像',
  keypairs: 'SSH 密钥对',
  rds: '云数据库',
  monitor: '监控告警',
};

const TAB_ICON: Record<HwPoolTabKey, ReactNode> = {
  overview: createElement(DashboardOutlined),
  ecs: createElement(CloudServerOutlined),
  vpc: createElement(ClusterOutlined),
  subnets: createElement(NodeIndexOutlined),
  securityGroups: createElement(SafetyCertificateOutlined),
  eips: createElement(GlobalOutlined),
  loadBalancers: createElement(DeploymentUnitOutlined),
  natGateways: createElement(SwapOutlined),
  routeTables: createElement(BranchesOutlined),
  disks: createElement(HddOutlined),
  images: createElement(PictureOutlined),
  keypairs: createElement(KeyOutlined),
  rds: createElement(ConsoleSqlOutlined),
  monitor: createElement(LineChartOutlined),
};

export function parseHwPoolDetailId(pathname: string): string | null {
  if (!pathname.startsWith(`${HW_POOL_PREFIX}/`)) return null;
  const rest = pathname.slice((HW_POOL_PREFIX + '/').length).split('/').filter(Boolean);
  if (rest.length !== 1) return null;
  return decodeURIComponent(rest[0]);
}

export function hwPoolBasePath(cloudId: string): string {
  return `${HW_POOL_PREFIX}/${encodeURIComponent(cloudId)}`;
}

export function hwPoolPathForTab(cloudId: string, tab: HwPoolTabKey): string {
  return `${hwPoolBasePath(cloudId)}?tab=${encodeURIComponent(tab)}`;
}

export function normalizeHwPoolTabParam(tab: string | null): HwPoolTabKey {
  const t = String(tab || '').trim();
  if ((HW_POOL_TAB_KEYS as readonly string[]).includes(t)) {
    return t as HwPoolTabKey;
  }
  return 'overview';
}

function hwPoolMenuItems(cloudId: string): { key: string; label: string; icon: ReactNode }[] {
  return (HW_POOL_TAB_KEYS as readonly HwPoolTabKey[]).map((k) => ({
    key: hwPoolPathForTab(cloudId, k),
    label: TAB_LABEL[k],
    icon: TAB_ICON[k],
  }));
}

export function hwPoolSidebarSelectedKey(
  cloudId: string,
  pathname: string,
  search: string,
): string {
  const id = parseHwPoolDetailId(pathname);
  if (!id || id !== cloudId) {
    return hwPoolPathForTab(cloudId, 'overview');
  }
  const tab = normalizeHwPoolTabParam(new URLSearchParams(search).get('tab'));
  return hwPoolPathForTab(cloudId, tab);
}

export function buildHwPoolSidebarCenter(cloud: Cloud, cloudId: string): AdminSidebarCenter | null {
  if (!cloudId || !cloud || !isHuaweiPoolCloud(cloud)) return null;
  return {
    key: HW_POOL_SIDEBAR_CENTER_KEY,
    label: cloud.name || '华为云',
    items: hwPoolMenuItems(cloudId),
  };
}

/** 华为云资源池上下文侧栏 spec（simple / `?tab=`）。路径：`/admin/clouds/vendor/huawei/:cloudId`。 */
export const hwPoolSidebarSpec: PoolSidebarSpec = {
  type: 'huawei',
  presentation: 'context-sidebar',
  subNav: 'tab',
  tier: 'simple',
  centerKey: HW_POOL_SIDEBAR_CENTER_KEY,
  label: '华为云',
  icon: createElement(CloudServerOutlined),
  navKeys: HW_POOL_TAB_KEYS,
  pathForTab: (cloudId: string, tab: string) => hwPoolPathForTab(cloudId, tab as HwPoolTabKey),
  normalizeTabParam: (tab: string | null) => normalizeHwPoolTabParam(tab),
  resolveContext: (pathname: string) => {
    const id = parseHwPoolDetailId(pathname);
    return id ? { poolId: id } : null;
  },
  matchCloud: (cloud: Cloud) => isHuaweiPoolCloud(cloud),
  buildSidebarCenter: ({ context, cloud, summaryCloudCount }: PoolSidebarBuildArgs) => {
    if (!cloud) return null;
    if (summaryCloudCount > 0 && !isHuaweiPoolCloud(cloud)) return null;
    return buildHwPoolSidebarCenter(cloud, context.poolId);
  },
  selectedKey: ({ context, pathname, search }: PoolSidebarSelectArgs) =>
    hwPoolSidebarSelectedKey(context.poolId, pathname, search),
};
