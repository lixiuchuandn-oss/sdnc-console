import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { RBACRole } from '../entities/RBACRole';
import { RoleAssignment } from '../entities/RoleAssignment';
import { ALL_PERMISSIONS } from '../constants/permissions';
// 新增/改名预置角色时须同步 constants/rbacBuiltInRoles.ts 中的 BUILT_IN_RBAC_ROLE_NAMES

// 使用统一的权限原子定义
const CURATED_PERMISSIONS = [...ALL_PERMISSIONS];

/** 已废弃：平台超级权限仅由 User.super_admin 表达，不再使用同名 RBAC 角色 */
const DEPRECATED_SUPER_RBAC_NAMES = ['超级管理员', 'Super Admin'] as const;

export async function initializeRoles() {
  try {
    const repo = AppDataSource.getRepository(RBACRole);
    const assignRepo = AppDataSource.getRepository(RoleAssignment);

    // 移除历史种子中的「超级管理员」RBAC 角色及其分配（与 super_admin 账户模型对齐）
    const deprecated = await repo.find({
      where: { name: In([...DEPRECATED_SUPER_RBAC_NAMES]) },
    });
    for (const r of deprecated) {
      await assignRepo.delete({ roleId: r.id });
      await repo.remove(r);
    }

    const ensureRole = async (spec: {
      name: string;
      description: string;
      scope: 'system' | 'tenant';
      permissions: string[];
      status: 'active' | 'inactive';
    }) => {
      const existed = await repo.findOne({ where: { name: spec.name } });
      const nextPerms = JSON.stringify(spec.permissions);
      if (!existed) {
        await repo.save(
          repo.create({
            name: spec.name,
            description: spec.description,
            scope: spec.scope,
            permissions: nextPerms,
            status: spec.status,
          }),
        );
        return;
      }

      // 已存在则更新（确保权限配置跟随代码版本演进）
      existed.description = spec.description;
      existed.scope = spec.scope;
      existed.permissions = nextPerms;
      existed.status = spec.status;
      await repo.save(existed);
    };

    // 1. 云租户根用户
    // 权限设计（与 PermissionChecker / accessMapping 一致）：
    // - 资源总览、资源池管理：不包含（与原逻辑一致）
    // - 云主机控制台：clouds.console:read + clouds.console:write（VNC/SSH、租户侧 ECS 接口等对权限数组做字面 includes 校验）
    // - 镜像：仅 clouds.images:read，不包含 clouds.images:write（租户侧镜像仅查看，不上传/删除）
    // - 其余 clouds.* 细分资源：保留显式 read/write（如 clouds.ecs:write），与「其他云资源读写」一致
    await ensureRole({
      name: '云租户根用户',
      description:
        '租户管理员：资源控制台（除资源总览、资源池外）；云主机控制台可访问与操作；镜像仅查看；其余云资源按各细分权限读写。',
      scope: 'tenant',
      permissions: [
        ...CURATED_PERMISSIONS.filter(
          (p) =>
            p.startsWith('clouds.') &&
            !p.startsWith('clouds.dashboard:') &&
            p !== 'clouds:read' &&
            p !== 'clouds:write' &&
            p !== 'clouds.images:write',
        ),
        'networks.vpcs:read',
        'networks.vpcs:write',
      ],
      status: 'active',
    });

    // =========================================================================
    // 三权分立默认角色
    // =========================================================================

    // 2. 三权-审计管理员
    // 只能访问操作审计页面
    const auditorRoleName = '三权-审计管理员';
    await ensureRole({
      name: auditorRoleName,
      description: '只能访问操作审计页面，用于安全审计与合规检查',
      scope: 'system',
      permissions: ['system.audit:read'],
      status: 'active',
    });

    // 3. 三权-安全管理员
    // 权限范围：
    // 1. 权限管控分组：角色管理等
    // 2. 多云平台的资源控制台分组、租户管理分组的所有功能权限（不包括系统用户管理）
    const secadminRoleName = '三权-安全管理员';
    const secadminPerms = [
      // 权限管控分组：角色管理等
      'system.actions:read',
      'system.actions:write',
      'system.roles:read',
      'system.roles:write',
      'system.roles.assignments:read',
      'system.roles.assignments:write',
      'system.rbac:read',
      // 资源控制台分组：资源池管理权限
      'clouds:read',
      'clouds:write',
      // 资源控制台分组：所有其他权限
      ...CURATED_PERMISSIONS.filter((p) => p.startsWith('clouds.')),
      // 租户管理分组：所有权限（不包括系统用户管理 users）
      ...CURATED_PERMISSIONS.filter((p) => 
        p.startsWith('tenants') || 
        p.startsWith('organizations') || 
        p.startsWith('tenant-users') || 
        p.startsWith('user-spaces')
      ),
    ];
    await ensureRole({
      name: secadminRoleName,
        description: '拥有权限管控分组（角色管理等）、资源控制台分组和租户管理分组的所有权限（不包括系统用户管理）',
      scope: 'system',
      permissions: secadminPerms,
      status: 'active',
    });

    // 4. 三权-系统管理员
    // 权限范围：
    // 1. 通用设置分组：界面设置、授权管理
    // 2. 权限管控分组：保留用户管理
    // 3. 高级集成分组：所有（使用system.settings权限）
    const sysadminRoleName = '三权-系统管理员';
    const sysadminPerms = [
      // 通用设置分组：界面设置
      'system.settings:read',
      'system.settings:write',
      // 通用设置分组：授权管理
      'system.license:read',
      'system.license:write',
      // 权限管控分组：只保留用户管理
      'users:read',
      'users:write',
    ];
    await ensureRole({
      name: sysadminRoleName,
      description: '拥有通用设置分组（界面设置、授权管理）所有权限、权限管控分组的用户管理权限、以及高级集成分组所有权限',
      scope: 'system',
      permissions: sysadminPerms,
      status: 'active',
    });

  } catch (error) {
    console.error('初始化角色失败:', error);
  }
}
