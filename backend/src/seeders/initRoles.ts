import { AppDataSource } from '../config/database';
import { RBACRole } from '../entities/RBACRole';
import { ALL_PERMISSIONS } from '../constants/permissions';

// 使用统一的权限原子定义
const CURATED_PERMISSIONS = [...ALL_PERMISSIONS];

export async function initializeRoles() {
  try {
    const repo = AppDataSource.getRepository(RBACRole);

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

    // 1. Super Admin
    await ensureRole({
      name: 'Super Admin',
      description: '拥有系统所有权限的超级管理员',
      scope: 'system',
      permissions: ['*'],
      status: 'active',
    });

    // 2. 云租户根用户（拥有资源控制台分组下除资源总览、资源池管理外的所有权限）
    await ensureRole({
      name: '云租户根用户',
      description: '租户管理员，拥有资源控制台分组下除资源总览、资源池管理外的所有权限',
      scope: 'tenant',
      permissions: [
        // 资源控制台分组：所有权限（排除资源总览 clouds.dashboard 和资源池管理 clouds）
        ...CURATED_PERMISSIONS.filter((p) => 
          p.startsWith('clouds.') && 
          !p.startsWith('clouds.dashboard:') && 
          p !== 'clouds:read' && 
          p !== 'clouds:write'
        ),
        // 网络相关权限（VPC等）
        'networks.vpcs:read',
        'networks.vpcs:write',
      ],
      status: 'active',
    });

    // =========================================================================
    // 三权分立默认角色
    // =========================================================================

    // 4. 三权-审计管理员
    // 只能访问操作审计页面
    const auditorRoleName = '三权-审计管理员';
    await ensureRole({
      name: auditorRoleName,
      description: '只能访问操作审计页面，用于安全审计与合规检查',
      scope: 'system',
      permissions: ['system.audit:read'],
      status: 'active',
    });

    // 5. 三权-安全管理员
    // 权限范围：
    // 1. 权限管控分组：保留功能权限、角色管理
    // 2. 多云平台的资源控制台分组、租户管理分组的所有功能权限（不包括系统用户管理）
    const secadminRoleName = '三权-安全管理员';
    const secadminPerms = [
      // 权限管控分组：功能权限、角色管理
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
      description: '拥有权限管控分组（功能权限、角色管理）、资源控制台分组和租户管理分组的所有权限（不包括系统用户管理）',
      scope: 'system',
      permissions: secadminPerms,
      status: 'active',
    });

    // 6. 三权-系统管理员
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
