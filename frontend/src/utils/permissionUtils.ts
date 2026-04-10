/**
 * 权限工具函数
 * 简化版本：直接使用后端权限定义，移除所有推断逻辑
 */

import type { PermissionDefinition } from '../hooks/usePermissionDefinitions';

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

const RESOURCE_CONSOLE_CHILD_GROUP_RULES: readonly ResourceConsoleGroupRule[] = [
  {
    label: '平台入口能力',
    prefixes: [
      'clouds',
      'clouds.dashboard',
      'clouds.resource-pools',
    ],
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
