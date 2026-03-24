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
  'clouds.dashboard',
  'clouds',
  'clouds.ecs',
  'clouds.vpcs',
  'clouds.eips',
  'clouds.disks',
  'clouds.security-groups',
  'clouds.load-balancers',
  'clouds.images',
  'clouds.sshkeys',
  'clouds.nads',
  'clouds.schedules',
  'clouds.namespaces',
  'clouds.vswitches',
  'clouds.enis',
  'clouds.network-acls',
  'clouds.snapshots',
  'clouds.backups',
  'clouds.route-tables',
  'clouds.route-entries',
  'clouds.nat-gateways',
  'clouds.vlans',
  'clouds.ippools',
  'clouds.console',
];

/** 聚合/父级权限：资源总览、资源池管理、云主机控制台（与细分 clouds.* 功能区分） */
export const RESOURCE_CONSOLE_PARENT_PREFIXES = new Set<string>([
  'clouds.dashboard',
  'clouds',
  'clouds.console',
]);

/**
 * 角色配置界面中父权限的适用范围说明（与 accessMapping / 后端 checker 特殊规则一致）
 */
export const RESOURCE_CONSOLE_PARENT_SCOPE_HINTS: Record<string, string> = {
  'clouds.dashboard':
    '仅作用于「资源总览」；与下方各细分 clouds.* 权限独立，且不被「云主机控制台」只读继承。',
  clouds:
    '作用于「资源池」列表与接入管理；读权限可继承各 clouds.* 功能只读（不含资源总览）。',
  'clouds.console':
    '作用于「云主机控制台」；读权限可继承各 clouds.* 功能只读（不含资源总览）。',
};

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
    label: '计算资源',
    prefixes: ['clouds.ecs', 'clouds.images', 'clouds.sshkeys', 'clouds.namespaces'],
  },
  {
    label: '网络资源',
    prefixes: [
      'clouds.vpcs',
      'clouds.eips',
      'clouds.security-groups',
      'clouds.load-balancers',
      'clouds.nads',
      'clouds.vswitches',
      'clouds.enis',
      'clouds.network-acls',
      'clouds.route-tables',
      'clouds.route-entries',
      'clouds.nat-gateways',
      'clouds.vlans',
      'clouds.ippools',
    ],
  },
  {
    label: '存储与备份',
    prefixes: ['clouds.disks', 'clouds.snapshots', 'clouds.backups', 'clouds.schedules'],
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

  const grouped = RESOURCE_CONSOLE_CHILD_GROUP_RULES.map((rule) => {
    const items = children.filter((item) => rule.prefixes.includes(item.resourcePrefix)).sort(byOrder);
    return { label: rule.label, items };
  }).filter((g) => g.items.length > 0);

  const coveredPrefixes = new Set(grouped.flatMap((g) => g.items.map((item) => item.resourcePrefix)));
  const others = children.filter((item) => !coveredPrefixes.has(item.resourcePrefix)).sort(byOrder);
  if (others.length > 0) {
    grouped.push({ label: '其他资源', items: others });
  }

  return grouped;
}
