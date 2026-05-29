/**
 * 阿里云资源池侧栏：`/admin/clouds/vendor/aliyun/:cloudId` 时由 AdminLayout 注入。
 * 子页切换由左侧栏 `?tab=` 驱动（沿用 MAAS / Xinference 方式），不再使用顶部 Tabs。
 * Tab key 与历史 `CloudDetailAliyun` 完全一致，仅改导航载体。
 */
import { createElement, type ReactNode } from 'react';
import {
  ApiOutlined,
  BranchesOutlined,
  CameraOutlined,
  ClusterOutlined,
  CloudServerOutlined,
  ConsoleSqlOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  FileProtectOutlined,
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
import { type Cloud, isAliyunPoolCloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import type {
  PoolSidebarBuildArgs,
  PoolSidebarSelectArgs,
  PoolSidebarSpec,
} from '../poolSidebar/types';

export const ALIYUN_POOL_SIDEBAR_CENTER_KEY = '/admin/aliyun_pool_context';

const ALIYUN_POOL_PREFIX = '/admin/clouds/vendor/aliyun';

/** 与历史 `CloudDetailAliyun` 的 Tabs key 一致（顺序即侧栏顺序）。 */
export const ALIYUN_POOL_TAB_KEYS = [
  'overview',
  'ecs',
  'vpc',
  'vswitch',
  'secgroup',
  'eip',
  'disks',
  'snapshot',
  'images',
  'keypairs',
  'slb',
  'nat',
  'vpn',
  'routetable',
  'networkacl',
  'rds',
  'monitor',
] as const;

export type AliyunPoolTabKey = (typeof ALIYUN_POOL_TAB_KEYS)[number];

const TAB_LABEL: Record<AliyunPoolTabKey, string> = {
  overview: '资源总览',
  ecs: '云主机',
  vpc: 'VPC',
  vswitch: '交换机',
  secgroup: '安全组',
  eip: 'EIP',
  disks: '云硬盘',
  snapshot: '快照',
  images: '镜像',
  keypairs: 'SSH 密钥对',
  slb: '负载均衡',
  nat: 'NAT 网关',
  vpn: 'VPN 网关',
  routetable: '路由表',
  networkacl: '网络 ACL',
  rds: '云数据库',
  monitor: '监控告警',
};

const TAB_ICON: Record<AliyunPoolTabKey, ReactNode> = {
  overview: createElement(DashboardOutlined),
  ecs: createElement(CloudServerOutlined),
  vpc: createElement(ClusterOutlined),
  vswitch: createElement(NodeIndexOutlined),
  secgroup: createElement(SafetyCertificateOutlined),
  eip: createElement(GlobalOutlined),
  disks: createElement(HddOutlined),
  snapshot: createElement(CameraOutlined),
  images: createElement(PictureOutlined),
  keypairs: createElement(KeyOutlined),
  slb: createElement(DeploymentUnitOutlined),
  nat: createElement(SwapOutlined),
  vpn: createElement(ApiOutlined),
  routetable: createElement(BranchesOutlined),
  networkacl: createElement(FileProtectOutlined),
  rds: createElement(ConsoleSqlOutlined),
  monitor: createElement(LineChartOutlined),
};

export function parseAliyunPoolDetailId(pathname: string): string | null {
  if (!pathname.startsWith(`${ALIYUN_POOL_PREFIX}/`)) return null;
  const rest = pathname.slice((ALIYUN_POOL_PREFIX + '/').length).split('/').filter(Boolean);
  if (rest.length !== 1) return null;
  return decodeURIComponent(rest[0]);
}

export function aliyunPoolBasePath(cloudId: string): string {
  return `${ALIYUN_POOL_PREFIX}/${encodeURIComponent(cloudId)}`;
}

export function aliyunPoolPathForTab(cloudId: string, tab: AliyunPoolTabKey): string {
  return `${aliyunPoolBasePath(cloudId)}?tab=${encodeURIComponent(tab)}`;
}

export function normalizeAliyunPoolTabParam(tab: string | null): AliyunPoolTabKey {
  const t = String(tab || '').trim();
  if ((ALIYUN_POOL_TAB_KEYS as readonly string[]).includes(t)) {
    return t as AliyunPoolTabKey;
  }
  return 'overview';
}

function aliyunPoolMenuItems(cloudId: string): { key: string; label: string; icon: ReactNode }[] {
  return (ALIYUN_POOL_TAB_KEYS as readonly AliyunPoolTabKey[]).map((k) => ({
    key: aliyunPoolPathForTab(cloudId, k),
    label: TAB_LABEL[k],
    icon: TAB_ICON[k],
  }));
}

export function aliyunPoolSidebarSelectedKey(
  cloudId: string,
  pathname: string,
  search: string,
): string {
  const id = parseAliyunPoolDetailId(pathname);
  if (!id || id !== cloudId) {
    return aliyunPoolPathForTab(cloudId, 'overview');
  }
  const tab = normalizeAliyunPoolTabParam(new URLSearchParams(search).get('tab'));
  return aliyunPoolPathForTab(cloudId, tab);
}

export function buildAliyunPoolSidebarCenter(
  cloud: Cloud,
  cloudId: string,
): AdminSidebarCenter | null {
  if (!cloudId || !cloud || !isAliyunPoolCloud(cloud)) return null;
  return {
    key: ALIYUN_POOL_SIDEBAR_CENTER_KEY,
    label: cloud.name || '阿里云',
    items: aliyunPoolMenuItems(cloudId),
  };
}

/** 阿里云资源池上下文侧栏 spec（simple / `?tab=`）。路径：`/admin/clouds/vendor/aliyun/:cloudId`。 */
export const aliyunPoolSidebarSpec: PoolSidebarSpec = {
  type: 'aliyun',
  presentation: 'context-sidebar',
  subNav: 'tab',
  tier: 'simple',
  centerKey: ALIYUN_POOL_SIDEBAR_CENTER_KEY,
  label: '阿里云',
  icon: createElement(CloudServerOutlined),
  navKeys: ALIYUN_POOL_TAB_KEYS,
  pathForTab: (cloudId: string, tab: string) =>
    aliyunPoolPathForTab(cloudId, tab as AliyunPoolTabKey),
  normalizeTabParam: (tab: string | null) => normalizeAliyunPoolTabParam(tab),
  resolveContext: (pathname: string) => {
    const id = parseAliyunPoolDetailId(pathname);
    return id ? { poolId: id } : null;
  },
  matchCloud: (cloud: Cloud) => isAliyunPoolCloud(cloud),
  buildSidebarCenter: ({ context, cloud, summaryCloudCount }: PoolSidebarBuildArgs) => {
    if (!cloud) return null;
    if (summaryCloudCount > 0 && !isAliyunPoolCloud(cloud)) return null;
    return buildAliyunPoolSidebarCenter(cloud, context.poolId);
  },
  selectedKey: ({ context, pathname, search }: PoolSidebarSelectArgs) =>
    aliyunPoolSidebarSelectedKey(context.poolId, pathname, search),
};
