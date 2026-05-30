/**
 * 租户控制台侧栏导航树：一级产品域 + 类目分组 + 资源叶节点。
 * Content 区原 Tabs/Dropdown 二级导航下沉至此。
 */
import React from 'react';
import type { MenuProps } from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import type { TenantConsoleLeftNavKey } from './tenantConsolePageAccess';

export type NavResource = { key: string; label: string };

export type NavCategory = {
  key: string;
  label: string;
  resources: NavResource[];
};

export const MAIN_NAV_CATEGORIES_BASE: NavCategory[] = [
  {
    key: 'compute',
    label: '云主机',
    resources: [
      { key: 'vm', label: '实例' },
      { key: 'recycle-bin', label: '回收站' },
      { key: 'template', label: '模板' },
      { key: 'image', label: '镜像' },
      { key: 'ssh', label: 'SSH密钥' },
      { key: 'cloudinit', label: 'CloudInit 配置' },
    ],
  },
  {
    key: 'storage',
    label: '云盘',
    resources: [
      { key: 'volume', label: '实例' },
      { key: 'volume-snapshot', label: '快照' },
    ],
  },
  {
    key: 'backup',
    label: '整机',
    resources: [
      { key: 'snapshot', label: '快照' },
      { key: 'backup', label: '备份' },
      { key: 'schedule', label: '定时策略' },
    ],
  },
  {
    key: 'flatnet',
    label: '扁平',
    resources: [{ key: 'flat-subnet', label: '子网' }],
  },
];

export const MAIN_NAV_VPC_CATEGORIES: NavCategory[] = [
  {
    key: 'vpc-net',
    label: 'VPC',
    resources: [{ key: 'vpc-subnet', label: '网络' }],
  },
  {
    key: 'vpc-nat',
    label: 'NAT',
    resources: [
      { key: 'eip', label: 'EIP' },
      { key: 'snat', label: 'SNAT' },
      { key: 'dnat', label: 'DNAT' },
    ],
  },
];

export const CONTAINER_NAV_CATEGORIES: NavCategory[] = [
  {
    key: 'ctr-run',
    label: '运行',
    resources: [
      { key: 'ctr-workloads', label: '工作负载' },
      { key: 'ctr-pods', label: 'Pod' },
      { key: 'ctr-jobs', label: '任务' },
    ],
  },
  {
    key: 'ctr-svc',
    label: '网络',
    resources: [
      { key: 'ctr-services', label: 'Service' },
      { key: 'ctr-ingresses', label: 'Ingress' },
      { key: 'ctr-gateway', label: '网关路由' },
    ],
  },
  {
    key: 'ctr-cfg',
    label: '配置',
    resources: [
      { key: 'ctr-configs', label: '配置与密钥' },
      { key: 'ctr-registries', label: '镜像仓库' },
      { key: 'ctr-pdbs', label: 'Pod中断保护' },
      { key: 'ctr-netpol', label: '网络策略' },
    ],
  },
];

export const DATABASE_NAV_CATEGORIES: NavCategory[] = [
  {
    key: 'rds',
    label: 'RDS',
    resources: [
      { key: 'mysql', label: 'MySQL' },
      { key: 'postgresql', label: 'PostgreSQL' },
    ],
  },
  {
    key: 'nosql',
    label: 'NoSQL',
    resources: [{ key: 'mongodb', label: 'MongoDB' }],
  },
  {
    key: 'mq',
    label: '消息队列',
    resources: [
      { key: 'rocketmq', label: 'RocketMQ' },
      { key: 'kafka', label: 'Kafka' },
    ],
  },
];

const LEFT_NAV_META: Record<
  TenantConsoleLeftNavKey,
  { label: string; icon: React.ReactNode }
> = {
  host: { label: '云主机', icon: React.createElement(CloudServerOutlined) },
  container: { label: '容器服务', icon: React.createElement(AppstoreOutlined) },
  flat: { label: '扁平网络', icon: React.createElement(NodeIndexOutlined) },
  vpc: { label: 'VPC网络', icon: React.createElement(ApartmentOutlined) },
  rds: { label: '云数据库', icon: React.createElement(DatabaseOutlined) },
};

export function buildMainNavCategories(ovnVpcEnabled: boolean): NavCategory[] {
  const base = [...MAIN_NAV_CATEGORIES_BASE];
  if (ovnVpcEnabled) {
    base.push(...MAIN_NAV_VPC_CATEGORIES);
  }
  return base;
}

function categoriesForLeftNav(
  leftNavKey: TenantConsoleLeftNavKey,
  ovnVpcEnabled: boolean,
): NavCategory[] {
  const full = buildMainNavCategories(ovnVpcEnabled);
  if (leftNavKey === 'host') {
    return full.filter((c) => ['compute', 'storage', 'backup'].includes(c.key));
  }
  if (leftNavKey === 'flat') {
    return full.filter((c) => c.key === 'flatnet');
  }
  if (leftNavKey === 'vpc') {
    return full.filter((c) => c.key === 'vpc-net' || c.key === 'vpc-nat');
  }
  if (leftNavKey === 'container') return CONTAINER_NAV_CATEGORIES;
  if (leftNavKey === 'rds') return DATABASE_NAV_CATEGORIES;
  return [];
}

function filterMainCategories(
  categories: NavCategory[],
  canAccessMainResource: (key: string) => boolean,
): NavCategory[] {
  return categories
    .map((cat) => ({
      ...cat,
      resources: cat.resources.filter((r) => canAccessMainResource(r.key)),
    }))
    .filter((cat) => cat.resources.length > 0);
}

function filterContainerCategories(
  canAccessContainerResource: (key: string) => boolean,
): NavCategory[] {
  return CONTAINER_NAV_CATEGORIES.map((cat) => ({
    ...cat,
    resources: cat.resources.filter((r) => canAccessContainerResource(r.key)),
  })).filter((cat) => cat.resources.length > 0);
}

function buildGroupedChildren(categories: NavCategory[]): MenuProps['items'] {
  return categories.flatMap((cat) => {
    if (cat.resources.length === 0) return [];
    return [
      {
        type: 'group' as const,
        label: cat.label,
        children: cat.resources.map((res) => ({
          key: res.key,
          label: res.label,
        })),
      },
    ];
  });
}

export type BuildTenantConsoleSiderItemsOptions = {
  canAccessLeftNav: (navKey: TenantConsoleLeftNavKey) => boolean;
  canAccessMainResource: (key: string) => boolean;
  canAccessContainerResource: (key: string) => boolean;
  canAccessDatabase: boolean;
  ovnVpcEnabled: boolean;
};

export function buildTenantConsoleSiderItems(
  opts: BuildTenantConsoleSiderItemsOptions,
): MenuProps['items'] {
  const items: MenuProps['items'] = [];
  const leftNavOrder: TenantConsoleLeftNavKey[] = ['host', 'container', 'flat', 'vpc', 'rds'];

  for (const navKey of leftNavOrder) {
    if (!opts.canAccessLeftNav(navKey)) continue;
    if (navKey === 'rds' && !opts.canAccessDatabase) continue;

    let categories: NavCategory[] = [];
    if (navKey === 'container') {
      categories = filterContainerCategories(opts.canAccessContainerResource);
    } else if (navKey === 'rds') {
      categories = DATABASE_NAV_CATEGORIES;
    } else {
      categories = filterMainCategories(
        categoriesForLeftNav(navKey, opts.ovnVpcEnabled),
        opts.canAccessMainResource,
      );
    }

    if (categories.length === 0) continue;

    const meta = LEFT_NAV_META[navKey];
    items.push({
      key: navKey,
      icon: meta.icon,
      label: meta.label,
      children: buildGroupedChildren(categories),
    });
  }

  return items;
}

export function findCategoryForMainResource(resourceKey: string): string {
  if (resourceKey === 'flat-subnet') return 'flatnet';
  if (['vpc-subnet', 'eip', 'snat', 'dnat'].includes(resourceKey)) {
    return resourceKey === 'vpc-subnet' ? 'vpc-net' : 'vpc-nat';
  }
  if (['volume', 'volume-snapshot'].includes(resourceKey)) return 'storage';
  if (['snapshot', 'backup', 'schedule'].includes(resourceKey)) return 'backup';
  return 'compute';
}

export function findCategoryForContainerResource(resourceKey: string): string {
  for (const cat of CONTAINER_NAV_CATEGORIES) {
    if (cat.resources.some((r) => r.key === resourceKey)) return cat.key;
  }
  return 'ctr-run';
}

export function findCategoryForDatabaseResource(resourceKey: string): string {
  for (const cat of DATABASE_NAV_CATEGORIES) {
    if (cat.resources.some((r) => r.key === resourceKey)) return cat.key;
  }
  return 'rds';
}

export function resolveLeftNavFromMainResource(
  resourceKey: string,
): TenantConsoleLeftNavKey {
  if (resourceKey === 'flat-subnet') return 'flat';
  if (['vpc-subnet', 'eip', 'snat', 'dnat'].includes(resourceKey)) return 'vpc';
  return 'host';
}

export function resolveTenantConsoleSiderLeaf(
  leafKey: string,
): {
  leftNavKey: TenantConsoleLeftNavKey;
  category: string;
  resource: string;
} | null {
  if (leafKey.startsWith('ctr-')) {
    return {
      leftNavKey: 'container',
      category: findCategoryForContainerResource(leafKey),
      resource: leafKey,
    };
  }
  if (['mysql', 'postgresql', 'mongodb', 'rocketmq', 'kafka'].includes(leafKey)) {
    return {
      leftNavKey: 'rds',
      category: findCategoryForDatabaseResource(leafKey),
      resource: leafKey,
    };
  }
  const leftNavKey = resolveLeftNavFromMainResource(leafKey);
  return {
    leftNavKey,
    category: findCategoryForMainResource(leafKey),
    resource: leafKey,
  };
}

export function getTenantConsoleSelectedLeafKey(params: {
  leftNavKey: TenantConsoleLeftNavKey;
  harvesterResource: string;
  containerResource: string;
  databaseResource: string;
}): string {
  if (params.leftNavKey === 'container') return params.containerResource;
  if (params.leftNavKey === 'rds') return params.databaseResource;
  return params.harvesterResource;
}

export function getTenantConsoleOpenKeysForSelection(leftNavKey: TenantConsoleLeftNavKey): string[] {
  return [leftNavKey];
}
