/**
 * 权限继承引擎（Inheritance Engine）
 * 
 * 核心功能：
 * 1. 计算权限的继承关系
 * 2. 支持层级继承、动词继承、自定义继承
 * 3. 缓存继承结果，提高性能
 */

import { PermissionRegistry } from './registry';
import { InheritanceRule, PermissionDefinition } from './types';

export class InheritanceEngine {
  private rules: InheritanceRule[];
  private registry: PermissionRegistry;
  private cache: Map<string, string[]> = new Map();

  constructor(rules: InheritanceRule[], registry: PermissionRegistry) {
    this.rules = rules;
    this.registry = registry;
  }

  /**
   * 获取权限继承的所有父权限
   * @param permissionId 权限ID
   * @returns 继承的权限ID列表
   */
  getInheritedPermissions(permissionId: string): string[] {
    const cacheKey = `inherited:${permissionId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const def = this.registry.get(permissionId);
    if (!def) {
      return [];
    }

    const inherited: string[] = [];

    // 1. 显式继承（从定义中读取）
    if (def.inherits) {
      inherited.push(...def.inherits);
    }

    // 2. 层级继承（如 clouds.ecs:read -> clouds:read）
    const hierarchical = this.applyHierarchicalRules(permissionId);
    inherited.push(...hierarchical);

    // 3. 动词继承（如 write -> read）
    const verb = this.applyVerbRules(permissionId);
    inherited.push(...verb);

    // 4. 自定义继承规则
    const custom = this.applyCustomRules(permissionId);
    inherited.push(...custom);

    // 递归获取父权限的继承权限
    const allInherited = new Set(inherited);
    inherited.forEach(parentId => {
      if (this.registry.has(parentId)) {
        const parentInherited = this.getInheritedPermissions(parentId);
        parentInherited.forEach(p => allInherited.add(p));
      }
    });

    const result = Array.from(allInherited);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * 获取权限所包含的所有子权限（反向继承）
   * 例如：如果用户有 clouds:read，则自动拥有 clouds.ecs:read
   * @param permissionIds 用户拥有的权限ID列表
   * @returns 被包含的权限ID列表
   */
  getImpliedPermissions(permissionIds: string[]): string[] {
    const implied: string[] = [];
    const permSet = new Set(permissionIds);

    // 遍历所有权限定义，检查其继承的权限是否在用户权限列表中
    this.registry.getAll().forEach(def => {
      const inherited = this.getInheritedPermissions(def.id);
      // 如果用户拥有的权限中，有任何一个是被检查权限的父权限，则用户拥有该权限
      if (inherited.some(perm => permSet.has(perm))) {
        implied.push(def.id);
      }
    });

    return implied;
  }

  /**
   * 应用层级继承规则
   * 例如：clouds.ecs:read -> clouds:read
   */
  private applyHierarchicalRules(permissionId: string): string[] {
    const [base, verb] = permissionId.split(':');
    if (!base || !verb) {
      return [];
    }

    const segments = base.split('.');
    const inherited: string[] = [];

    // 层级继承规则
    this.rules
      .filter(rule => rule.type === 'hierarchical' && rule.hierarchical)
      .forEach(rule => {
        const { pattern, parent } = rule.hierarchical!;
        
        // 检查是否匹配模式（容器子域不与 clouds:read 层级挂钩）
        if (this.matchPattern(pattern, base)) {
          if (parent === 'clouds' && base.startsWith('clouds.containers')) {
            return;
          }
          const parentPerm = `${parent}:${verb}`;
          if (this.registry.has(parentPerm)) {
            inherited.push(parentPerm);
          }
        }
      });

    // 默认层级继承：clouds.ecs:read -> clouds:read（容器子域不与 clouds:read 层级挂钩）
    // clouds.ecs.vms:read -> clouds.ecs:read
    if (segments.length >= 2) {
      const parent = `${segments[0]}:${verb}`;
      const skipCloudsDomainForContainers =
        segments[0] === 'clouds' && segments[1] === 'containers';
      if (
        !skipCloudsDomainForContainers &&
        this.registry.has(parent) &&
        !inherited.includes(parent)
      ) {
        inherited.push(parent);
      }
    }

    if (segments.length >= 3) {
      const parent = `${segments[0]}.${segments[1]}:${verb}`;
      if (this.registry.has(parent) && !inherited.includes(parent)) {
        inherited.push(parent);
      }
    }

    return inherited;
  }

  /**
   * 应用动词继承规则
   * 例如：write 权限包含 read 权限
   */
  private applyVerbRules(permissionId: string): string[] {
    const [base, verb] = permissionId.split(':');
    if (!base || !verb) {
      return [];
    }

    const inherited: string[] = [];

    // 动词继承规则
    this.rules
      .filter(rule => rule.type === 'verb' && rule.verb)
      .forEach(rule => {
        const { from, to } = rule.verb!;
        if (verb === to) {
          const fromPerm = `${base}:${from}`;
          // 注意：这里不直接返回，而是在检查时判断用户是否有 from 权限
          // 因为这是反向继承（write 包含 read），需要在检查时特殊处理
        }
      });

    // 默认规则：write 权限包含 read 权限（在检查时处理，这里不返回）
    // 因为这是反向的：如果用户有 write，则自动有 read
    // 所以这里不需要返回，而是在 PermissionChecker 中处理

    return inherited;
  }

  /**
   * 应用自定义继承规则
   */
  private applyCustomRules(permissionId: string): string[] {
    const inherited: string[] = [];

    this.rules
      .filter(rule => rule.type === 'custom' && rule.custom)
      .forEach(rule => {
        const { from, to, condition } = rule.custom!;
        if (to === permissionId) {
          // 检查条件（如果有）
          if (!condition || condition({ permissionId })) {
            inherited.push(from);
          }
        }
      });

    return inherited;
  }

  /**
   * 匹配模式
   */
  private matchPattern(pattern: string, target: string): boolean {
    // 将通配符模式转换为正则表达式
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\./g, '\\.');
    
    try {
      const regex = new RegExp('^' + regexPattern + '$');
      return regex.test(target);
    } catch {
      return pattern === target;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}
