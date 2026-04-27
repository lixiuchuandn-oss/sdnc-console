/**
 * 权限工具函数
 * 简化版本：直接使用后端权限定义，移除所有推断逻辑
 */

import type { PermissionDefinition } from '../hooks/usePermissionDefinitions';
import { hasPermissionForAction } from './accessMapping';

/**
 * 从权限定义中获取分组
 */
export function getGroupFromDefinition(
  permissionId: string,
  definitions: PermissionDefinition[]
): string {
  const def = definitions.find(d => d.id === permissionId);
  return def?.group || '';
}

/**
 * 从权限定义中获取功能名称
 */
export function getFeatureFromDefinition(
  permissionId: string,
  definitions: PermissionDefinition[]
): string {
  const def = definitions.find(d => d.id === permissionId);
  if (def) {
    return def.name;
  }
  // 如果找不到，使用权限ID的前缀部分
  const prefix = permissionId.split(':')[0];
  return prefix;
}

/**
 * 从权限定义中获取平台
 */
export function getPlatformFromDefinition(
  permissionId: string,
  definitions: PermissionDefinition[]
): string {
  const def = definitions.find(d => d.id === permissionId);
  return def?.platform || 'CNMC';
}

/**
 * 归一化功能名称，去掉"管理/查看"等后缀
 */
export function normalizeFeatureName(name: string): string {
  if (!name) return name;
  let n = name.trim();
  n = n.replace(/[-－](管理|查看)$/g, '');
  n = n.replace(/(管理|查看)$/g, '');
  return n || name;
}

/**
 * 资源池管理功能权限在角色配置中的展示顺序（本数组为设计源；整改后端时请让
 * backend/src/constants/permissions.ts 中 PERMISSION_GROUPS.CNMC['资源池管理'] 与
 * ALL_PERMISSIONS 中的 clouds.* 前缀与此处一致；权限分组「资源控制台」见 CLOUDMAP_FEATURE_ORDER）
 */
export const RESOURCE_CONSOLE_FEATURE_ORDER: readonly string[] = [
  'clouds',
  'clouds.dashboard',
  'clouds.resource-pools',
  // 云主机
  'clouds.ecs',
  'clouds.vm-create-wizard',
  'clouds.images',
  'clouds.templates',
  'clouds.cloudinits',
  'clouds.sshkeys',
  'clouds.recycle-bin',
  'clouds.migrations',
  // 容器服务（K8s 子域，与池内 Tab 一致）
  'clouds.containers',
  'clouds.containers.workloads',
  'clouds.containers.pods',
  'clouds.containers.jobs',
  'clouds.containers.services',
  'clouds.containers.ingresses',
  'clouds.containers.gateway',
  'clouds.containers.configs',
  'clouds.containers.registries',
  'clouds.containers.pdbs',
  'clouds.containers.networkpolicies',
  // 存储与备份
  'clouds.disks',
  'clouds.snapshots',
  'clouds.backups',
  'clouds.schedules',
  'clouds.restore-tasks',
  // 基础网络
  'clouds.provider-networks',
  'clouds.vlans',
  'clouds.nads',
  'clouds.subnets', // 子网（Kube-OVN · 汇总，与分域原子并列展示）
  'clouds.subnets.public',
  // 扁平网络
  'clouds.subnets.flat',
  'clouds.eips.flat',
  'clouds.fips.flat',
  'clouds.dnat.flat',
  'clouds.snat.flat',
  'clouds.traffic-mirroring.flat',
  'clouds.security-groups.flat',
  // VPC网络
  'clouds.vpcs',
  'clouds.subnets.vpc',
  'clouds.eips.vpc',
  'clouds.fips.vpc',
  'clouds.dnat.vpc',
  'clouds.snat.vpc',
  'clouds.traffic-mirroring.vpc',
  'clouds.security-groups.vpc',
  // VPC 扩展能力
  'clouds.load-balancers',
  'clouds.vswitches',
  'clouds.enis',
  'clouds.route-tables',
  'clouds.route-entries',
  'clouds.network-acls',
  // 集群与运维
  'clouds.cluster-nodes',
  'clouds.cluster-services',
  'clouds.cluster-networks',
  'clouds.namespaces',
  'clouds.storage-classes',
  'clouds.gpus',
  'clouds.usb-devices',
  'clouds.pci-devices',
  // 监控
  'clouds.alerts',
  'clouds.alert-rules',
  'clouds.alert-policies',
  'clouds.alert-receivers',
  'clouds.alert-secrets',
  // 日志
  'clouds.log-targets',
  'clouds.log-receivers',
  'clouds.log-configs',
];

/** 权限分组「资源控制台」内功能展示顺序（与 PERMISSION_GROUPS.CNMC['资源控制台'] 一致） */
export const CLOUDMAP_FEATURE_ORDER: readonly string[] = ['clouds.console', 'clouds.cloudmap.ops-view'];

function cloudmapFeatureOrderIndex(prefix: string): number {
  const i = CLOUDMAP_FEATURE_ORDER.indexOf(prefix);
  return i === -1 ? 999 : i;
}

export function sortCloudmapFeatures<T extends { resourcePrefix: string }>(features: T[]): T[] {
  return [...features].sort((a, b) => cloudmapFeatureOrderIndex(a.resourcePrefix) - cloudmapFeatureOrderIndex(b.resourcePrefix));
}

/** 聚合/父级权限：资源池总权限（覆盖所有 clouds.*） */
export const RESOURCE_CONSOLE_PARENT_PREFIXES = new Set<string>([
  // 资源池总权限也作为“平台入口能力”中的卡片展示
]);

function resourceConsoleOrderIndex(prefix: string): number {
  const i = RESOURCE_CONSOLE_FEATURE_ORDER.indexOf(prefix);
  return i === -1 ? 999 : i;
}

/**
 * 将资源池管理权限拆为父级与细分功能，并按后端分组顺序排序（避免按名称排序导致资源池等位置错乱）
 */
export function splitResourceConsoleFeatures<T extends { resourcePrefix: string }>(
  features: T[]
): { parents: T[]; children: T[] } {
  const parents = features.filter((f) => RESOURCE_CONSOLE_PARENT_PREFIXES.has(f.resourcePrefix));
  const children = features.filter((f) => !RESOURCE_CONSOLE_PARENT_PREFIXES.has(f.resourcePrefix));
  const byOrder = (a: T, b: T) =>
    resourceConsoleOrderIndex(a.resourcePrefix) - resourceConsoleOrderIndex(b.resourcePrefix);
  parents.sort(byOrder);
  children.sort(byOrder);
  return { parents, children };
}

type ResourceConsoleGroupRule = {
  label: string;
  prefixes: readonly string[];
};

/** 资源池角色抽屉：「平台入口能力」前缀（与下述分组规则首条一致，单点维护） */
export const RESOURCE_POOL_PLATFORM_ENTRY_PREFIXES: readonly string[] = [
  'clouds',
  'clouds.dashboard',
  'clouds.resource-pools',
];

export const RESOURCE_POOL_PLATFORM_ENTRY_PREFIX_SET = new Set<string>(RESOURCE_POOL_PLATFORM_ENTRY_PREFIXES);

/** 角色抽屉「平台入口能力」：入口三类 + 资源控制台原子合并后的展示顺序 */
export const PLATFORM_ENTRY_DRAWER_MERGED_ORDER: readonly string[] = [
  ...RESOURCE_POOL_PLATFORM_ENTRY_PREFIXES,
  ...CLOUDMAP_FEATURE_ORDER,
];

function platformEntryDrawerMergedOrderIndex(prefix: string): number {
  const i = PLATFORM_ENTRY_DRAWER_MERGED_ORDER.indexOf(prefix);
  return i === -1 ? 999 : i;
}

export function sortMergedPlatformEntryDrawerFeatures<T extends { resourcePrefix: string }>(
  features: T[],
): T[] {
  return [...features].sort(
    (a, b) =>
      platformEntryDrawerMergedOrderIndex(a.resourcePrefix) -
      platformEntryDrawerMergedOrderIndex(b.resourcePrefix),
  );
}

/**
 * 将后端分组「资源控制台」并入抽屉中的「平台入口能力」（仅影响角色授权 UI 结构）
 */
export function mergeResourceConsoleIntoPlatformEntryGroup<T extends { resourcePrefix: string }>(
  groups: { group: string; features: T[] }[],
): { group: string; features: T[] }[] {
  const cIdx = groups.findIndex((g) => g.group === '资源控制台');
  if (cIdx === -1) return groups;

  const consoleFeatures = groups[cIdx].features;
  const rest = groups.filter((_, i) => i !== cIdx);
  const eIdx = rest.findIndex((g) => g.group === '平台入口能力');
  const base = eIdx === -1 ? [] : rest[eIdx].features;
  const merged = sortMergedPlatformEntryDrawerFeatures([...base, ...consoleFeatures]);

  if (eIdx === -1) {
    return [{ group: '平台入口能力', features: merged }, ...rest];
  }
  const out = [...rest];
  out[eIdx] = { group: '平台入口能力', features: merged };
  return out;
}

/** 按 RESOURCE_CONSOLE_FEATURE_ORDER 排序（用于抽屉内分组卡片顺序） */
export function sortByResourceConsoleFeatureOrder<T extends { resourcePrefix: string }>(features: T[]): T[] {
  return [...features].sort(
    (a, b) => resourceConsoleOrderIndex(a.resourcePrefix) - resourceConsoleOrderIndex(b.resourcePrefix),
  );
}

const RESOURCE_CONSOLE_CHILD_GROUP_RULES: readonly ResourceConsoleGroupRule[] = [
  {
    label: '平台入口能力',
    prefixes: [...RESOURCE_POOL_PLATFORM_ENTRY_PREFIXES],
  },
  {
    label: '云主机',
    prefixes: [
      'clouds.ecs',
      'clouds.vm-create-wizard',
      'clouds.images',
      'clouds.templates',
      'clouds.cloudinits',
      'clouds.sshkeys',
      'clouds.recycle-bin',
      'clouds.migrations',
    ],
  },
  /** K8s 容器子域单独成组（与池内 Tab、Harvester API 子路径对齐） */
  {
    label: '容器服务',
    prefixes: [
      'clouds.containers',
      'clouds.containers.workloads',
      'clouds.containers.pods',
      'clouds.containers.jobs',
      'clouds.containers.services',
      'clouds.containers.ingresses',
      'clouds.containers.gateway',
      'clouds.containers.configs',
      'clouds.containers.registries',
      'clouds.containers.pdbs',
      'clouds.containers.networkpolicies',
    ],
  },
  {
    label: '存储与备份',
    prefixes: [
      'clouds.disks',
      'clouds.snapshots',
      'clouds.backups',
      'clouds.schedules',
      'clouds.restore-tasks',
    ],
  },
  {
    label: '基础网络',
    prefixes: [
      'clouds.provider-networks', // 物理网络
      'clouds.vlans', // VLAN网络
      'clouds.nads', // 网络附加定义（Multus NAD）
      'clouds.subnets', // 子网管理
      'clouds.subnets.public', // 公共子网
    ],
  },
  {
    label: '扁平网络',
    prefixes: [
      'clouds.subnets.flat',
      'clouds.eips.flat',
      'clouds.fips.flat',
      'clouds.dnat.flat',
      'clouds.snat.flat',
      'clouds.traffic-mirroring.flat',
      'clouds.security-groups.flat',
    ],
  },
  {
    label: 'VPC网络',
    prefixes: [
      'clouds.vpcs', // VPC网络
      'clouds.subnets.vpc',
      'clouds.eips.vpc',
      'clouds.fips.vpc',
      'clouds.dnat.vpc',
      'clouds.snat.vpc',
      'clouds.traffic-mirroring.vpc',
      'clouds.security-groups.vpc',
    ],
  },
  {
    label: 'VPC扩展',
    prefixes: [
      'clouds.load-balancers',
      'clouds.vswitches',
      'clouds.enis',
      'clouds.route-tables',
      'clouds.route-entries',
      'clouds.network-acls',
    ],
  },
  {
    label: '集群与运维',
    prefixes: [
      'clouds.cluster-nodes',
      'clouds.cluster-services',
      'clouds.cluster-networks',
      'clouds.namespaces',
      'clouds.storage-classes',
      'clouds.gpus',
      'clouds.usb-devices',
      'clouds.pci-devices',
    ],
  },
  {
    label: '监控',
    prefixes: [
      'clouds.alerts',
      'clouds.alert-rules',
      'clouds.alert-policies',
      'clouds.alert-receivers',
      'clouds.alert-secrets',
    ],
  },
  {
    label: '日志',
    prefixes: [
      'clouds.log-targets',
      'clouds.log-receivers',
      'clouds.log-configs',
    ],
  },
];

/**
 * 将资源池管理子权限按资源类型分组，并按既定顺序排列
 */
export function groupResourceConsoleChildFeatures<T extends { resourcePrefix: string }>(
  children: T[]
): Array<{ label: string; items: T[] }> {
  const byOrder = (a: T, b: T) =>
    resourceConsoleOrderIndex(a.resourcePrefix) - resourceConsoleOrderIndex(b.resourcePrefix);

  // 同一 resourcePrefix 只归入第一个命中的分组，避免重复出现在多个业务组
  const unassigned = [...children];
  const grouped = RESOURCE_CONSOLE_CHILD_GROUP_RULES.map((rule) => {
    const matched = unassigned.filter((item) => rule.prefixes.includes(item.resourcePrefix)).sort(byOrder);
    if (matched.length > 0) {
      const matchedSet = new Set(matched.map((item) => item.resourcePrefix));
      for (let i = unassigned.length - 1; i >= 0; i -= 1) {
        if (matchedSet.has(unassigned[i].resourcePrefix)) {
          unassigned.splice(i, 1);
        }
      }
    }
    return { label: rule.label, items: matched };
  }).filter((g) => g.items.length > 0);

  const others = unassigned.sort(byOrder);
  if (others.length > 0) {
    grouped.push({ label: '其他资源', items: others });
  }

  return grouped;
}

// =============================================================================
// 容器服务：池内 Tab / 控制台 ctr-* ↔ clouds.containers.* 原子（与后端 registry 对齐）
// =============================================================================

/** 池内 Tab / 控制台 innerActiveKey（service_topology 走 services） */
export type ContainerTabPermissionKey =
  | 'workloads'
  | 'pods'
  | 'jobs'
  | 'services'
  | 'ingresses'
  | 'gateway_api'
  | 'configs'
  | 'registries'
  | 'pdbs'
  | 'networkpolicies';

export const CLOUD_CONTAINER_TAB_READ: Record<ContainerTabPermissionKey, string> = {
  workloads: 'clouds.containers.workloads:read',
  pods: 'clouds.containers.pods:read',
  jobs: 'clouds.containers.jobs:read',
  services: 'clouds.containers.services:read',
  ingresses: 'clouds.containers.ingresses:read',
  gateway_api: 'clouds.containers.gateway:read',
  configs: 'clouds.containers.configs:read',
  registries: 'clouds.containers.registries:read',
  pdbs: 'clouds.containers.pdbs:read',
  networkpolicies: 'clouds.containers.networkpolicies:read',
};

export const CLOUD_CONTAINER_TAB_WRITE: Record<ContainerTabPermissionKey, string> = {
  workloads: 'clouds.containers.workloads:write',
  pods: 'clouds.containers.pods:write',
  jobs: 'clouds.containers.jobs:write',
  services: 'clouds.containers.services:write',
  ingresses: 'clouds.containers.ingresses:write',
  gateway_api: 'clouds.containers.gateway:write',
  configs: 'clouds.containers.configs:write',
  registries: 'clouds.containers.registries:write',
  pdbs: 'clouds.containers.pdbs:write',
  networkpolicies: 'clouds.containers.networkpolicies:write',
};

export const ALL_CLOUD_CONTAINER_SUB_READ: string[] = Object.values(CLOUD_CONTAINER_TAB_READ);

/** 租户控制台资源 key → 容器子域 */
export const CLOUD_CONSOLE_CONTAINER_RESOURCE_TO_TAB: Record<string, ContainerTabPermissionKey> = {
  'ctr-workloads': 'workloads',
  'ctr-pods': 'pods',
  'ctr-jobs': 'jobs',
  'ctr-services': 'services',
  'ctr-ingresses': 'ingresses',
  'ctr-gateway': 'gateway_api',
  'ctr-configs': 'configs',
  'ctr-registries': 'registries',
  'ctr-pdbs': 'pdbs',
  'ctr-netpol': 'networkpolicies',
};

export function isContainerTabPermissionKey(k: string): k is ContainerTabPermissionKey {
  return k in CLOUD_CONTAINER_TAB_READ;
}

export function canReadContainerTab(
  checkPerm: (act: string) => boolean,
  tab: string,
): boolean {
  if (tab === 'service_topology') {
    return canReadContainerTab(checkPerm, 'services');
  }
  if (!isContainerTabPermissionKey(tab)) {
    return checkPerm('clouds.containers:read') || checkPerm('clouds:read');
  }
  const atom = CLOUD_CONTAINER_TAB_READ[tab];
  return checkPerm(atom) || checkPerm('clouds.containers:read') || checkPerm('clouds:read');
}

export function canWriteContainerTab(
  checkPerm: (act: string) => boolean,
  tab: string,
): boolean {
  if (tab === 'service_topology') {
    return canWriteContainerTab(checkPerm, 'services');
  }
  if (!isContainerTabPermissionKey(tab)) {
    return checkPerm('clouds.containers:write') || checkPerm('clouds:write');
  }
  const atom = CLOUD_CONTAINER_TAB_WRITE[tab];
  return checkPerm(atom) || checkPerm('clouds.containers:write') || checkPerm('clouds:write');
}

export function canViewAnyContainerSubPage(checkPerm: (act: string) => boolean): boolean {
  if (checkPerm('clouds.containers:read') || checkPerm('clouds.containers:write')) return true;
  if (checkPerm('clouds:read') || checkPerm('clouds:write')) return true;
  return ALL_CLOUD_CONTAINER_SUB_READ.some((a) => checkPerm(a));
}

export function canViewAnyContainerSubPageFromPerms(
  permissions: string[] | undefined,
): boolean {
  const perms = permissions ?? [];
  return canViewAnyContainerSubPage((a) => hasPermissionForAction(perms, a));
}
