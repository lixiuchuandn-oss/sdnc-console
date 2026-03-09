import { AppDataSource } from '../config/database';
import { RBACRole } from '../entities/RBACRole';

const CURATED_PERMISSIONS = [
    // 运维平台/系统与用户
    'ops.dashboard:read',
    'ops.dashboard:write',
    'users:read',
    'users:write',
    'user-spaces:read',
    'user-spaces:write',
    // 租户与租户资源
    'tenants:read',
    'tenants:write',
    // 云与资源（统一命名：domain.feature:verb）
    'clouds:read',
    'clouds:write',
    'clouds.instances:read',
    'clouds.instances:write',
    'clouds.vpcs:read',
    'clouds.vpcs:write',
    'clouds.eips:read',
    'clouds.eips:write',
    'clouds.disks:read',
    'clouds.disks:write',
    'clouds.security-groups:read',
    'clouds.security-groups:write',
    'clouds.load-balancers:read',
    'clouds.load-balancers:write',
    'clouds.images:read',
    'clouds.images:write',
    'clouds.vswitches:read',
    'clouds.vswitches:write',
    'clouds.enis:read',
    'clouds.enis:write',
    'clouds.network-acls:read',
    'clouds.network-acls:write',
    'clouds.snapshots:read',
    'clouds.snapshots:write',
    'clouds.route-entries:read',
    'clouds.route-entries:write',
    'clouds.nat-gateways:read',
    'clouds.nat-gateways:write',
    // 云主机控制台
    'clouds.console:read',
    'clouds.console:write',
    // 网络：跨地域互联与安全面
    'networks.vpcs:read',
    'networks.vpcs:write',
    'networks.cen:read',
    'networks.cen:write',
    'networks.cen.attachments:read',
    'networks.cen.attachments:write',
    'networks.security-domain:read',
    'networks.security-domain:write',
    'networks.srv6:read',
    'networks.srv6:write',
    'networks.vr-config:read',
    'networks.vr-config:write',
    'networks.route-tables:read',
    'networks.route-tables:write',
    'networks.acl:read',
    'networks.acl:write',
    'networks.vswitches:read',
    'networks.vswitches:write',
    // 安全服务与日志
    'security.services:read',
    'security.services:write',
    'security.logs:read',
    'security.logs:write',
    'security.policies:read',
    'security.policies:write',
    'security.apps:read',
    'security.apps:write',
    // 安全运营
    'secops.dashboard:read',
    'secops.dashboard:write',
    'secops.alerts:read',
    'secops.alerts:write',
    'secops.rules:read',
    'secops.rules:write',
    // 系统管理
    'system.roles:read',
    'system.roles:write'
];

export async function initializeRoles() {
  try {
    const repo = AppDataSource.getRepository(RBACRole);

    // 1. Super Admin
    const superAdmin = await repo.findOne({ where: { name: 'Super Admin' } });
    if (!superAdmin) {
      await repo.save(repo.create({
        name: 'Super Admin',
        description: '拥有系统所有权限的超级管理员',
        scope: 'system',
        permissions: JSON.stringify(['*']),
        status: 'active'
      }));
      console.log('Role "Super Admin" created.');
    }

    // 2. Tenant Admin
    const tenantAdmin = await repo.findOne({ where: { name: 'Tenant Admin' } });
    if (!tenantAdmin) {
      await repo.save(repo.create({
        name: 'Tenant Admin',
        description: '租户管理员，拥有租户内的管理权限',
        scope: 'tenant',
        permissions: JSON.stringify([
            'clouds.instances:read', 
            'clouds.instances:write',
            'clouds.console:read', 
            'clouds.console:write',
            'networks.vpcs:read',
            'networks.vpcs:write'
        ]),
        status: 'active'
      }));
      console.log('Role "Tenant Admin" created.');
    }
    
    // 3. User (Standard User)
    const userRole = await repo.findOne({ where: { name: 'User' } });
    if (!userRole) {
        await repo.save(repo.create({
            name: 'User',
            description: '普通用户，拥有基础查看权限',
            scope: 'tenant',
            permissions: JSON.stringify(['clouds.console:read', 'clouds.instances:read']),
            status: 'active'
        }));
        console.log('Role "User" created.');
    }

    // =========================================================================
    // 三权分立默认角色
    // =========================================================================

    const allRead = CURATED_PERMISSIONS.filter(p => p.endsWith(':read'));

    // 4. 三权-审计员
    // 仅具备各分组的只读权限
    const auditorRoleName = '三权-审计员';
    const auditor = await repo.findOne({ where: { name: auditorRoleName } });
    if (!auditor) {
        await repo.save(repo.create({
            name: auditorRoleName,
            description: '仅具备各分组的只读权限，用于安全审计与合规检查',
            scope: 'system',
            permissions: JSON.stringify(allRead),
            status: 'active'
        }));
        console.log(`Role "${auditorRoleName}" created.`);
    }

    // 5. 三权-运维操作员
    // 具备运维相关分组的写入权限，并具备全局只读权限
    const opsRoleName = '三权-运维操作员';
    const ops = await repo.findOne({ where: { name: opsRoleName } });
    if (!ops) {
        const opsWrites = CURATED_PERMISSIONS.filter(p => 
            p.endsWith(':write') && (
                p.startsWith('clouds.') || 
                p.startsWith('networks.') || 
                p.startsWith('security.') || 
                p.startsWith('secops.') || 
                p.startsWith('ops.')
            )
        );
        const opsPerms = Array.from(new Set([...allRead, ...opsWrites]));
        await repo.save(repo.create({
            name: opsRoleName,
            description: '具备运维相关分组的写入权限，并具备全局只读权限',
            scope: 'system',
            permissions: JSON.stringify(opsPerms),
            status: 'active'
        }));
        console.log(`Role "${opsRoleName}" created.`);
    }

    // 6. 三权-策略管理员
    // 具备管理分组的写入权限，并具备全局只读权限
    const policyRoleName = '三权-策略管理员';
    const policy = await repo.findOne({ where: { name: policyRoleName } });
    if (!policy) {
        const mgmtWrites = CURATED_PERMISSIONS.filter(p => 
            p.endsWith(':write') && (
                p.startsWith('tenants') || 
                p.startsWith('users') || 
                p.startsWith('user-spaces') || 
                p.startsWith('system.')
            )
        );
        const policyPerms = Array.from(new Set([...allRead, ...mgmtWrites]));
        await repo.save(repo.create({
            name: policyRoleName,
            description: '具备管理分组的写入权限，并具备全局只读权限；用于策略与资源管理',
            scope: 'system',
            permissions: JSON.stringify(policyPerms),
            status: 'active'
        }));
        console.log(`Role "${policyRoleName}" created.`);
    }

  } catch (error) {
    console.error('初始化角色失败:', error);
  }
}
