/**
 * 权限定义中心 - 统一导出
 * 
 * 这是新的权限体系的核心入口，提供：
 * 1. 权限注册表（PermissionRegistry）
 * 2. 权限继承引擎（InheritanceEngine）
 * 3. 权限检查器（PermissionChecker）
 * 4. 权限定义和规则
 */

import { PermissionRegistry } from './registry';
import { InheritanceEngine } from './inheritance';
import { PermissionChecker } from './checker';
import { INHERITANCE_RULES } from './rules';
import { PERMISSION_DEFINITIONS } from './definitions';

// 创建权限注册表实例
export const permissionRegistry = new PermissionRegistry(PERMISSION_DEFINITIONS);

// 创建继承引擎实例
export const inheritanceEngine = new InheritanceEngine(INHERITANCE_RULES, permissionRegistry);

// 创建权限检查器实例
export const permissionChecker = new PermissionChecker(permissionRegistry, inheritanceEngine);

// 导出类型
export * from './types';

// 导出类（用于创建自定义实例）
export { PermissionRegistry } from './registry';
export { InheritanceEngine } from './inheritance';
export { PermissionChecker } from './checker';

// 导出数据和规则
export { PERMISSION_DEFINITIONS } from './definitions';
export { INHERITANCE_RULES } from './rules';

/**
 * 便捷函数：检查权限
 */
export function checkPermission(permissions: string[], required: string): boolean {
  return permissionChecker.check(permissions, required);
}

/**
 * 便捷函数：检查任一权限
 */
export function hasAnyPermission(permissions: string[], required: string[]): boolean {
  return permissionChecker.checkAny(permissions, required);
}

/**
 * 便捷函数：检查所有权限
 */
export function hasAllPermissions(permissions: string[], required: string[]): boolean {
  return permissionChecker.checkAll(permissions, required);
}

/**
 * 便捷函数：从 API 路径解析权限
 */
export function resolvePermissionFromApi(method: string, path: string): string | null {
  return permissionRegistry.resolveFromApi(method, path);
}

export {
  mapHarvesterContainerSubPathToPermissionBase,
  mapHarvesterContainerApiPathToPermissionBase,
  resolveHarvesterContainerProxyPermissionFromBody,
  resolveHarvesterContainerUrlPermission,
} from './registry';

// 导出中间件
export * from './middleware';
