/**
 * 权限检查器（Permission Checker）
 * 
 * 核心功能：
 * 1. 统一的权限检查逻辑
 * 2. 支持精确匹配、继承匹配、反向继承匹配
 * 3. 支持通配符权限（如 '*' 表示所有权限）
 */

import { PermissionRegistry } from './registry';
import { InheritanceEngine } from './inheritance';

export class PermissionChecker {
  private registry: PermissionRegistry;
  private inheritanceEngine: InheritanceEngine;

  constructor(registry: PermissionRegistry, inheritanceEngine: InheritanceEngine) {
    this.registry = registry;
    this.inheritanceEngine = inheritanceEngine;
  }

  /**
   * 检查用户是否拥有指定权限
   * @param permissions 用户拥有的权限列表
   * @param required 需要检查的权限ID
   * @returns 是否有权限
   */
  check(permissions: string[], required: string): boolean {
    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return false;
    }

    // 1. 超级管理员权限
    if (permissions.includes('*')) {
      return true;
    }

    // 2. 精确匹配
    if (permissions.includes(required)) {
      return true;
    }

    // 3. 通配符匹配（如 'clouds:*' 包含所有 clouds 相关权限）
    const [base, verb] = required.split(':');
    if (base && verb) {
      // 子网汇总权限：clouds.subnets:{read|write} 可由任一子类型权限满足（与 API 中间件一致）
      if (base === 'clouds.subnets' && (verb === 'read' || verb === 'write')) {
        const scoped = [
          `clouds.subnets.vpc:${verb}`,
          `clouds.subnets.flat:${verb}`,
          `clouds.subnets.public:${verb}`,
        ];
        if (scoped.some((s) => this.check(permissions, s))) {
          return true;
        }
      }
      // 检查 domain:* 或 domain.feature:*
      const segments = base.split('.');
      
      // clouds.ecs:read -> 检查 clouds:* 或 clouds.ecs:*
      if (segments.length >= 1) {
        const domain = segments[0];
        if (permissions.includes(`${domain}:*`)) {
          return true;
        }
      }
      
      if (segments.length >= 2) {
        const domainFeature = `${segments[0]}.${segments[1]}`;
        if (permissions.includes(`${domainFeature}:*`)) {
          return true;
        }
      }
    }

    // 4. 特殊规则：clouds.console:read 权限包含所有 clouds.*:read 权限（资源控制台下的所有功能）
    if (base && base.startsWith('clouds.') && verb === 'read' && base !== 'clouds') {
      if (permissions.includes('clouds.console:read') || permissions.includes('clouds.console:write')) {
        return true;
      }
    }

    // 4b. 特殊规则：clouds.console:write 包含所有 clouds.*:write（与 4 对称）
    if (base && base.startsWith('clouds.') && verb === 'write') {
      if (permissions.includes('clouds.console:write')) {
        return true;
      }
    }

    // 4c. VM 创建/变配依赖资源读权限：允许 clouds.ecs 兜底
    // 用于保证只有 ECS 权限的角色仍可读取创建/变配所需资源（节点、存储类、命名空间、镜像、NAD、GPU/USB/PCI）
    if (verb === 'read' && base) {
      const vmDependencyReadBases = new Set([
        'clouds.cluster-nodes',
        'clouds.storage-classes',
        'clouds.namespaces',
        'clouds.images',
        'clouds.nads',
        'clouds.gpus',
        'clouds.usb-devices',
        'clouds.pci-devices',
      ]);
      if (vmDependencyReadBases.has(base)) {
        if (
          permissions.includes('clouds.ecs:read') ||
          permissions.includes('clouds.ecs:write') ||
          permissions.includes('clouds.ecs:*')
        ) {
          return true;
        }
      }
    }

    // 5. 继承检查：检查用户权限是否包含所需权限的父权限
    const inherited = this.inheritanceEngine.getInheritedPermissions(required);
    if (inherited.some(perm => permissions.includes(perm))) {
      return true;
    }

    // 6. 反向继承检查：检查用户权限是否包含所需权限的子权限
    // 例如：用户有 clouds:read，则自动拥有 clouds.ecs:read
    const implied = this.inheritanceEngine.getImpliedPermissions(permissions);
    if (implied.includes(required)) {
      return true;
    }

    // 7. 动词继承：write 权限包含 read 权限
    // 如果所需权限是 read，检查用户是否有对应的 write 权限
    if (verb === 'read' && base) {
      const writePerm = `${base}:write`;
      if (this.check(permissions, writePerm)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查用户是否拥有任一指定权限
   * @param permissions 用户拥有的权限列表
   * @param required 需要检查的权限ID列表
   * @returns 是否拥有任一权限
   */
  checkAny(permissions: string[], required: string[]): boolean {
    return required.some(perm => this.check(permissions, perm));
  }

  /**
   * 检查用户是否拥有所有指定权限
   * @param permissions 用户拥有的权限列表
   * @param required 需要检查的权限ID列表
   * @returns 是否拥有所有权限
   */
  checkAll(permissions: string[], required: string[]): boolean {
    return required.every(perm => this.check(permissions, perm));
  }

  /**
   * 获取用户缺少的权限
   * @param permissions 用户拥有的权限列表
   * @param required 需要检查的权限ID列表
   * @returns 缺少的权限ID列表
   */
  getMissingPermissions(permissions: string[], required: string[]): string[] {
    return required.filter(perm => !this.check(permissions, perm));
  }
}
