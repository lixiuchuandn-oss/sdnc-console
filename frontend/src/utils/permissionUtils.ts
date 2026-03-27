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
 * 资源控制台功能权限在角色配置中的展示顺序（与 backend/src/constants/permissions.ts
 * PERMISSION_GROUPS.CNMC['资源控制台'] 保持一致）
 */
export const RESOURCE_CONSOLE_FEATURE_ORDER: readonly string[] = [
  'clouds',
  'clouds.dashboard',
  'clouds.console',
  'clouds.cloudmap.ops-view',
  'clouds.ecs',
  'clouds.vm-create-wizard',
  // 网络能力（按业务分组顺序）
  'clouds.provider-networks',
  'clouds.vlans',
  'clouds.subnets',
  'clouds.subnets.public',
  'clouds.subnets.flat',
  'clouds.nads',
  'clouds.flat-nat',
  'clouds.traffic-mirroring',
  'clouds.security-groups',
  'clouds.vpcs',
  'clouds.subnets.vpc',
  'clouds.eips',
  'clouds.fips',
  'clouds.nat-gateways',
  'clouds.route-tables',
  'clouds.route-entries',
  // 其他网络与云资源能力
  'clouds.disks',
  'clouds.load-balancers',
  'clouds.images',
  'clouds.templates',
  'clouds.cloudinits',
  'clouds.sshkeys',
  'clouds.schedules',
  'clouds.restore-tasks',
  'clouds.vswitches',
  'clouds.enis',
  'clouds.network-acls',
  'clouds.snapshots',
  'clouds.backups',
  'clouds.recycle-bin',
  'clouds.migrations',
  'clouds.cluster-nodes',
  'clouds.cluster-services',
  'clouds.cluster-networks',
  'clouds.namespaces',
  'clouds.storage-classes',
  'clouds.gpus',
  'clouds.usb-devices',
  'clouds.pci-devices',
  'clouds.alerts',
  'clouds.alert-rules',
  'clouds.alert-policies',
  'clouds.alert-receivers',
  'clouds.alert-secrets',
  'clouds.log-targets',
  'clouds.log-receivers',
  'clouds.log-configs',
];

/** 聚合/父级权限：资源池总权限（覆盖所有 clouds.*） */
export const RESOURCE_CONSOLE_PARENT_PREFIXES = new Set<string>([
  // 资源池总权限也作为“平台入口能力”中的卡片展示
]);

function resourceConsoleOrderIndex(prefix: string): number {
  const i = RESOURCE_CONSOLE_FEATURE_ORDER.indexOf(prefix);
  return i === -1 ? 999 : i;
}

/**
 * 将资源控制台权限拆为父级与细分功能，并按后端分组顺序排序（避免按名称排序导致资源池等位置错乱）
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
    prefixes: ['clouds', 'clouds.dashboard', 'clouds.console', 'clouds.cloudmap.ops-view'],
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
    label: '基础网络',
    prefixes: [
      'clouds.provider-networks',
      'clouds.vlans',
      'clouds.subnets',
      'clouds.subnets.public',
      'clouds.subnets.flat',
      'clouds.nads',
      // 业务口径映射：flat-traffic -> clouds.traffic-mirroring; flat-sg -> clouds.security-groups
      'clouds.flat-nat',
      'clouds.traffic-mirroring',
      'clouds.security-groups',
    ],
  },
  {
    label: '扁平网络',
    prefixes: [
      'clouds.subnets.flat',
      'clouds.subnets.public',
      'clouds.flat-nat',
      'clouds.traffic-mirroring',
      'clouds.security-groups',
    ],
  },
  {
    label: 'VPC网络',
    prefixes: [
      'clouds.vpcs',
      'clouds.subnets.vpc',
      'clouds.eips',
      'clouds.fips',
      'clouds.nat-gateways',
      'clouds.route-tables',
      'clouds.route-entries',
    ],
  },
  {
    label: 'VPC 扩展（第三方云）',
    prefixes: [
      'clouds.load-balancers',
      'clouds.vswitches',
      'clouds.enis',
      'clouds.network-acls',
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
 * 将资源控制台子权限按资源类型分组，并按既定顺序排列
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
