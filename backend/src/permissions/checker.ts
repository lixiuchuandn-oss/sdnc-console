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
import { poolPageTokenGrantsImpliedRead } from '../constants/poolPageImpliedReads';
import {
  hasLegacyOrUmbrellaUnifiedStorageGrant,
  isUnifiedStorageReadBase,
} from '../constants/unifiedStoragePermissionBases';
import {
  CBR_VM_BACKUPS_BASE,
  CBR_VM_SNAPSHOTS_BASE,
} from '../constants/cbrPermissionBases';
import {
  cbrBackupScheduleAliasSatisfied,
  isCbrBackupScheduleResourceBase,
} from '../constants/cbrSchedulePermissionLegacy';

/** `clouds.console:*` / `clouds:read` 的宽松继承不包含容器子域（须显式子域 atoms；历史 `clouds.containers:*` 仍兼容） */
function isCloudsContainersResourceBase(resourceBase: string): boolean {
  return resourceBase === 'clouds.containers' || resourceBase.startsWith('clouds.containers.');
}

function isCloudsDashboardOrPoolsResourceBase(resourceBase: string): boolean {
  return resourceBase === 'clouds.dashboard' || resourceBase === 'clouds.resource-pools';
}

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
      // 云备份：历史 clouds.backups 总权仅覆盖快照子域（定时策略须显式 clouds.schedules）
      if (base === CBR_VM_SNAPSHOTS_BASE && (verb === 'read' || verb === 'write')) {
        if (permissions.includes(`${CBR_VM_BACKUPS_BASE}:${verb}`)) {
          return true;
        }
      }
      if (
        isCbrBackupScheduleResourceBase(base) &&
        (verb === 'read' || verb === 'write') &&
        cbrBackupScheduleAliasSatisfied(permissions, base, verb)
      ) {
        return true;
      }
      if (
        base.startsWith('clouds.containers.') &&
        base !== 'clouds.containers' &&
        (verb === 'read' || verb === 'write')
      ) {
        if (verb === 'read') {
          if (
            permissions.includes('clouds.containers:read') ||
            permissions.includes('clouds.containers:write')
          ) {
            return true;
          }
        } else if (permissions.includes('clouds.containers:write')) {
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

    // 4. 特殊规则：clouds.console:read 权限包含 clouds.*:read（不含容器子域，且不含 dashboard/resource-pools）
    if (
      base &&
      base.startsWith('clouds.') &&
      verb === 'read' &&
      base !== 'clouds' &&
      !isCloudsContainersResourceBase(base) &&
      !isCloudsDashboardOrPoolsResourceBase(base)
    ) {
      if (permissions.includes('clouds.console:read') || permissions.includes('clouds.console:write')) {
        return true;
      }
    }

    // 4b. 特殊规则：clouds.console:write 包含 clouds.*:write（不含容器子域，且不含 dashboard/resource-pools）
    if (
      base &&
      base.startsWith('clouds.') &&
      verb === 'write' &&
      !isCloudsContainersResourceBase(base) &&
      !isCloudsDashboardOrPoolsResourceBase(base)
    ) {
      if (permissions.includes('clouds.console:write')) {
        return true;
      }
    }

    // 4b2. 统一存储：umbrella / 历史 clouds.ceph 覆盖各子域 read；write 同理
    if (base && verb) {
      if (verb === 'read' && isUnifiedStorageReadBase(base)) {
        if (hasLegacyOrUmbrellaUnifiedStorageGrant(permissions, 'read')) {
          return true;
        }
      }
      if (verb === 'write' && isUnifiedStorageReadBase(base)) {
        if (hasLegacyOrUmbrellaUnifiedStorageGrant(permissions, 'write')) {
          return true;
        }
      }
    }

    // 4c. VM 创建/变配依赖资源读权限：允许 clouds.ecs 兜底
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

      // 4d/4e. 池内页 token 隐式读（机房/网络拓扑等，见 poolPageImpliedReads）
      if (poolPageTokenGrantsImpliedRead(permissions, base)) {
        return true;
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

    // 8. 容器子域 ↔ 已移除的 clouds.containers 总权（双向兼容）
    const containerSubReadBases = [
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
    ] as const;
    if (base === 'clouds.containers') {
      if (verb === 'read') {
        if (
          containerSubReadBases.some(
            (b) =>
              permissions.includes(`${b}:read`) || permissions.includes(`${b}:write`),
          )
        ) {
          return true;
        }
      }
      if (
        verb === 'write' &&
        containerSubReadBases.some((b) => permissions.includes(`${b}:write`))
      ) {
        return true;
      }
    }

    // 9. 历史 atom：clouds.cluster-services 已并入 clouds.containers.services
    if (base === 'clouds.containers.services') {
      if (
        verb === 'read' &&
        (permissions.includes('clouds.cluster-services:read') ||
          permissions.includes('clouds.cluster-services:write'))
      ) {
        return true;
      }
      if (verb === 'write' && permissions.includes('clouds.cluster-services:write')) {
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
