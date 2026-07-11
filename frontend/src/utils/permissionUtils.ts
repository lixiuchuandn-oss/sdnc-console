/**
 * 角色权限抽屉：从后端权限定义解析平台 / 分组 / 功能名。
 */

import type { PermissionDefinition } from '../hooks/usePermissionDefinitions';

export function getGroupFromDefinition(
  permissionId: string,
  definitions: PermissionDefinition[],
): string {
  const def = definitions.find((d) => d.id === permissionId);
  return def?.group || '';
}

export function getFeatureFromDefinition(
  permissionId: string,
  definitions: PermissionDefinition[],
): string {
  const def = definitions.find((d) => d.id === permissionId);
  if (def) {
    return def.name.replace(/[-－](管理|查看)$/, '') || def.name;
  }
  return permissionId.split(':')[0];
}

export function getPlatformFromDefinition(
  permissionId: string,
  definitions: PermissionDefinition[],
): string {
  const def = definitions.find((d) => d.id === permissionId);
  return def?.platform || 'SETTINGS';
}

export function permissionFeatureMatchesKeyword(
  feature: {
    feature?: string;
    resourcePrefix?: string;
    read?: string;
    write?: string;
    pathSuffix?: string;
    poolNavGroup?: string;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (String(feature.feature || '').toLowerCase().includes(q)) return true;
  if (String(feature.resourcePrefix || '').toLowerCase().includes(q)) return true;
  if (feature.read && String(feature.read).toLowerCase().includes(q)) return true;
  if (feature.write && String(feature.write).toLowerCase().includes(q)) return true;
  if (feature.pathSuffix && String(feature.pathSuffix).toLowerCase().includes(q)) return true;
  if (feature.poolNavGroup && String(feature.poolNavGroup).toLowerCase().includes(q)) return true;
  return false;
}
