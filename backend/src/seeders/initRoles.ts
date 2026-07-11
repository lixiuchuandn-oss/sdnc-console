import { In } from 'typeorm';

import { AppDataSource } from '../config/database';

import { RBACRole } from '../entities/RBACRole';

import { RoleAssignment } from '../entities/RoleAssignment';

import { getEffectivePermissionCatalog } from '../constants/effectivePermissions';

import { getPlatformByPermission } from '../constants/permissions';

import { logger } from '../utils/logger';



const rolesLog = logger.child('RolesSeed');



const CURATED_PERMISSIONS = getEffectivePermissionCatalog();



const DEPRECATED_SUPER_RBAC_NAMES = ['超级管理员', 'Super Admin'] as const;



export async function initializeRoles() {

  try {

    const repo = AppDataSource.getRepository(RBACRole);

    const assignRepo = AppDataSource.getRepository(RoleAssignment);



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

        rolesLog.info(`已创建预置角色「${spec.name}」，权限 ${spec.permissions.length} 条`);

        return;

      }



      let prevCount = 0;

      try {

        const parsed = JSON.parse(String(existed.permissions || '[]'));

        prevCount = Array.isArray(parsed) ? parsed.length : 0;

      } catch {

        prevCount = 0;

      }

      const permsChanged = String(existed.permissions || '') !== nextPerms;



      existed.description = spec.description;

      existed.scope = spec.scope;

      existed.permissions = nextPerms;

      existed.status = spec.status;

      await repo.save(existed);



      if (permsChanged) {

        rolesLog.info(

          `已更新预置角色「${spec.name}」权限：${prevCount} → ${spec.permissions.length} 条`,

        );

      }

    };



    await ensureRole({

      name: '三权-审计管理员',

      description: '只能访问操作审计页面，用于安全审计与合规检查',

      scope: 'system',

      permissions: ['system.audit:read'],

      status: 'active',

    });



    const secadminPerms = [

      'system.actions:read',

      'system.actions:write',

      'system.roles:read',

      'system.roles:write',

      'system.roles.assignments:read',

      'system.roles.assignments:write',

      'system.rbac:read',

      ...CURATED_PERMISSIONS.filter((p) => getPlatformByPermission(p) === 'SDNCC'),

    ];

    await ensureRole({

      name: '三权-安全管理员',

      description: '拥有权限管控（角色管理等）与 IBR 管理全部能力',

      scope: 'system',

      permissions: secadminPerms,

      status: 'active',

    });



    await ensureRole({

      name: '三权-系统管理员',

      description: '拥有通用设置、离线升级、用户管理及高级集成权限',

      scope: 'system',

      permissions: [

        'system.settings:read',

        'system.settings:write',

        'system.upgrade:read',

        'system.upgrade:write',

        'system.integration:read',

        'system.integration:write',

        'users:read',

        'users:write',

      ],

      status: 'active',

    });

  } catch (error) {

    rolesLog.error('初始化角色失败:', error instanceof Error ? error.message : String(error));

    throw error;

  }

}

