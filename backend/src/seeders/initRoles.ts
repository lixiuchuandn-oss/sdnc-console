import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { RBACRole } from '../entities/RBACRole';
import { RoleAssignment } from '../entities/RoleAssignment';
import { ALL_PERMISSIONS } from '../constants/permissions';
import { expandLegacyContainerParentPermissions } from '../constants/containerPermissionLegacy';
import { expandObsoleteFipsToEips } from '../constants/fipPermissionLegacy';
import { expandLegacyBackupSchedulePermissions } from '../constants/cbrSchedulePermissionLegacy';
import {
  parseRolePermissionsJson,
  stripTenantConsoleUmbrellaPermissions,
  isTenantConsoleUmbrellaPermission,
} from '../constants/tenantConsolePermissionLegacy';
import { logger } from '../utils/logger';
// 新增/改名预置角色时须同步 constants/rbacBuiltInRoles.ts 中的 BUILT_IN_RBAC_ROLE_NAMES

const rolesLog = logger.child('RolesSeed');

// 使用统一的权限原子定义
const CURATED_PERMISSIONS = [...ALL_PERMISSIONS];

/** 已废弃：平台超级权限仅由 User.super_admin 表达，不再使用同名 RBAC 角色 */
const DEPRECATED_SUPER_RBAC_NAMES = ['超级管理员', 'Super Admin'] as const;

/** 云租户根用户：不含顶栏平台（租户管理 / SDN / 云安全 / 系统设置） */
const TENANT_ROOT_NON_CNMC_PREFIXES = [
  'tenants',
  'organizations',
  'tenant-users',
  'networks',
  'security',
  'secops',
  'system',
  'users',
] as const;

/**
 * 云租户根用户：CNMC 内排除的分组（与前端 poolNavGroup / PERMISSION_GROUPS 对齐）
 * - 多云管理、资源总览、云监控、集群、日志管理
 */
const TENANT_ROOT_CNMC_EXCLUDED_PREFIXES = [
  'clouds.dashboard',
  'clouds.resource-pools',
  'clouds.monitoring.overview',
  'clouds.dc-topology',
  'clouds.net-topology',
  'clouds.alerts',
  'clouds.alert-rules',
  'clouds.alert-policies',
  'clouds.alert-receivers',
  'clouds.alert-secrets',
  'clouds.log-targets',
  'clouds.log-receivers',
  'clouds.log-configs',
  'clouds.desktop',
  // poolNavGroup「集群」
  'clouds.cluster-nodes',
  'clouds.namespaces',
  'clouds.cluster-networks',
  'clouds.provider-networks',
  'clouds.subnets.public',
  'clouds.vlans',
  'clouds.nads',
  'clouds.load-balancers',
  'clouds.ip-pools',
  'clouds.storage-dashboard',
  'clouds.storage-addon',
  'clouds.unified-storage-pools',
  'clouds.storage-classes',
  'clouds.storage-rbd-mirror',
  'clouds.storage-s3-buckets',
  'clouds.storage-rgw-users',
  'clouds.storage-object-gateway',
  'clouds.storage-cosi',
  'clouds.gpus',
  'clouds.usb-devices',
  'clouds.pci-devices',
  // poolNavGroup「扁平网络」：除扁平子网只读外，其余默认不授权
  'clouds.traffic-mirroring.flat',
  'clouds.security-groups.flat',
  'clouds.eips.flat',
  'clouds.snat.flat',
  'clouds.dnat.flat',
  // poolNavGroup「虚拟网元」：虚拟路由器
  'clouds.vne',
] as const;

function permissionBase(permission: string): string {
  return permission.split(':')[0];
}

function matchesExcludedPrefix(base: string, prefixes: readonly string[]): boolean {
  return prefixes.some((pfx) => base === pfx || base.startsWith(`${pfx}.`));
}

/** 租户 scope 角色抽屉可配置的 clouds.* 权限（含 clouds.images:write，供自定义角色勾选） */
function isTenantRootConfigurableCloudPermission(permission: string): boolean {
  const base = permissionBase(permission);
  if (permission === 'clouds:read' || permission === 'clouds:write') return false;
  if (!base.startsWith('clouds.')) return false;
  if (matchesExcludedPrefix(base, TENANT_ROOT_CNMC_EXCLUDED_PREFIXES)) return false;
  // 子网汇总权会在角色抽屉拆成 vpc/flat/public，勿授予 write（否则扁平子网「读写」被误勾）
  if (base === 'clouds.subnets') return false;
  if (permission === 'clouds.subnets.flat:write') return false;
  if (isTenantConsoleUmbrellaPermission(permission)) return false;
  return true;
}

/** 内置「云租户根用户」种子用 clouds.* 权限（镜像仅 read） */
function isTenantRootBuiltinCloudPermission(permission: string): boolean {
  if (!isTenantRootConfigurableCloudPermission(permission)) return false;
  if (permission === 'clouds.images:write') return false;
  return true;
}

/** 租户角色配置权限抽屉固定目录（/rbac/actions.tenantRootBoundary） */
export function buildTenantRootRoleCatalogBoundary(
  allPermissions: readonly string[] = ALL_PERMISSIONS,
): string[] {
  return allPermissions.filter((p) => {
    const base = permissionBase(p);
    if (matchesExcludedPrefix(base, TENANT_ROOT_NON_CNMC_PREFIXES)) return false;
    return isTenantRootConfigurableCloudPermission(p);
  });
}

/** 云租户根用户内置权限列表（供种子与手动同步脚本共用；镜像仅 read） */
export function buildTenantRootBuiltinPermissions(
  allPermissions: readonly string[] = ALL_PERMISSIONS,
): string[] {
  return allPermissions.filter((p) => {
    const base = permissionBase(p);
    if (matchesExcludedPrefix(base, TENANT_ROOT_NON_CNMC_PREFIXES)) return false;
    return isTenantRootBuiltinCloudPermission(p);
  });
}

/** 存量全 scope 角色：移除已废弃的 clouds.console:* umbrella 权限 */
export async function migrateAllRolesRemoveConsoleUmbrella(): Promise<number> {
  const repo = AppDataSource.getRepository(RBACRole);
  const rows = await repo.find();
  let changed = 0;
  for (const row of rows) {
    const current = parseRolePermissionsJson(row.permissions);
    const next = stripTenantConsoleUmbrellaPermissions(current);
    if (next.length === current.length) continue;
    row.permissions = JSON.stringify(next);
    await repo.save(row);
    changed += 1;
  }
  if (changed > 0) {
    rolesLog.info(`已从 ${changed} 个角色中移除 clouds.console:* 权限`);
  }
  return changed;
}

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

      // 已存在则更新（确保权限配置跟随代码版本演进）
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

    // 1. 云租户根用户
    // 权限设计（与 PermissionChecker / accessMapping、前端 poolNavGroup 一致）：
    // - 顶栏平台：不含租户管理、SDN 控制台、云安全中心、系统设置（tenants/networks/secops/system 等）
    // - CNMC：不含多云管理、资源总览、云监控、集群、日志管理分组
    // - 租户控制台入口由账号类型（tenant）判定，不再授予 clouds.console:*
    // - 云主机/存储等写操作按 clouds.ecs:write 等 poolPageAction 校验
    // - 镜像：仅 clouds.images:read，不含 clouds.images:write
    // - 扁平网络：仅 clouds.subnets.flat:read；不含流量镜像/安全组/EIP/SNAT/DNAT
    // - 虚拟网元：不含 clouds.vne（虚拟路由器）
    // - 其余 clouds.*（云主机、云存储、VPC 网络等）：保留显式 read/write
    await ensureRole({
      name: '云租户根用户',
      description:
        '租户管理员：不含租户/SDN/安全/系统设置等平台入口；CNMC 不含多云管理、资源总览、云监控、集群、日志管理；扁平网络仅扁平子网只读；不含虚拟路由器；资源控制台可访问与操作；镜像仅查看。',
      scope: 'tenant',
      permissions: buildTenantRootBuiltinPermissions(CURATED_PERMISSIONS),
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
    // 2. 多云平台的资源池管理 / 资源控制台、租户管理分组的所有功能权限（不包括系统用户管理）
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
      // 资源池管理等：云资源全量（clouds:read 已隐含全部 clouds.* 含 resource-pools）
      'clouds:read',
      'clouds:write',
      // 资源池管理 / 资源控制台：所有其他 clouds.* 权限
      ...CURATED_PERMISSIONS.filter((p) => p.startsWith('clouds.')),
      // 租户管理分组：所有权限（不包括系统用户管理 users）
      ...CURATED_PERMISSIONS.filter(
        (p) =>
          p.startsWith('tenants') || p.startsWith('organizations') || p.startsWith('tenant-users'),
      ),
    ];
    await ensureRole({
      name: secadminRoleName,
      description:
        '拥有权限管控分组（角色管理等）、资源池管理与资源控制台、租户管理分组的所有权限（不包括系统用户管理）',
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
      'system.upgrade:read',
      'system.upgrade:write',
      // 权限管控分组：只保留用户管理
      'users:read',
      'users:write',
    ];
    await ensureRole({
      name: sysadminRoleName,
      description:
        '拥有通用设置分组（界面设置、授权管理）所有权限、权限管控分组的用户管理权限、以及高级集成分组所有权限',
      scope: 'system',
      permissions: sysadminPerms,
      status: 'active',
    });

    // 5. 云计算用户（系统角色）
    // 权限范围：云主机、云存储、云备份、扁平网络；不含容器服务、不含 NAD、不含云主机创建向导（NAD 列表仍可由 clouds.ecs:read 在后端兜底读取以支持创建 VM）
    const cloudComputeRoleName = '云计算用户';
    const cloudComputePrefixes = [
      // 云主机
      'clouds.ecs',
      'clouds.images',
      'clouds.templates',
      'clouds.cloudinits',
      'clouds.sshkeys',
      'clouds.recycle-bin',
      'clouds.migrations',
      // 云存储
      'clouds.disks',
      'clouds.snapshots',
      // 云备份
      'clouds.backups',
      'clouds.vm-backup-snapshots',
      'clouds.schedules',
      'clouds.restore-tasks',
      // 扁平网络
      'clouds.subnets.flat',
      'clouds.eips.flat',
      'clouds.dnat.flat',
      'clouds.snat.flat',
      'clouds.traffic-mirroring.flat',
      'clouds.security-groups.flat',
    ] as const;
    const cloudComputePerms = CURATED_PERMISSIONS.filter(
      (p) =>
        cloudComputePrefixes.some((prefix) => p.startsWith(`${prefix}:`)) &&
        !p.startsWith('clouds.containers') &&
        !p.startsWith('clouds.vm-create-wizard:') &&
        !p.startsWith('clouds.vm-quick-create:'),
    );
    cloudComputePerms.push('clouds.resource-pools:read');
    await ensureRole({
      name: cloudComputeRoleName,
      description:
        '拥有云主机、云存储、云备份、扁平网络使用权限（不含容器服务、不含网络附加定义 NAD、不含云主机创建向导与快速创建）。',
      scope: 'system',
      permissions: cloudComputePerms,
      status: 'active',
    });

    // 6. 云管理用户（系统角色）
    // 权限范围：云主机、云存储、云备份、物理网络、VLAN、扁平网络等；不含容器服务、不含 NAD、不含云主机创建向导
    const cloudOpsRoleName = '云管理用户';
    const cloudOpsPrefixes = [
      ...cloudComputePrefixes,
      // 物理网络
      'clouds.provider-networks',
      'clouds.vlans',
      'clouds.subnets.public',
    ] as const;
    const cloudOpsPerms = CURATED_PERMISSIONS.filter(
      (p) =>
        cloudOpsPrefixes.some((prefix) => p.startsWith(`${prefix}:`)) &&
        !p.startsWith('clouds.containers') &&
        !p.startsWith('clouds.vm-create-wizard:') &&
        !p.startsWith('clouds.vm-quick-create:'),
    );
    cloudOpsPerms.push('clouds.resource-pools:read');
    await ensureRole({
      name: cloudOpsRoleName,
      description:
        '拥有云主机、云存储、云备份、物理网络、扁平网络等使用权限（不含容器服务、不含网络附加定义 NAD、不含云主机创建向导与快速创建）。',
      scope: 'system',
      permissions: cloudOpsPerms,
      status: 'active',
    });

    // 历史角色：clouds.containers 总权 → 各子域 atoms（与前端 normalizeRoleGrantIds 一致）
    const allRoles = await repo.find();
    for (const role of allRoles) {
      let perms: string[] = [];
      try {
        const parsed = JSON.parse(String(role.permissions || '[]'));
        perms = Array.isArray(parsed) ? parsed : [];
      } catch {
        perms = [];
      }
      const migrated = expandLegacyBackupSchedulePermissions(
        expandLegacyContainerParentPermissions(expandObsoleteFipsToEips(perms)),
      );
      const beforeKey = JSON.stringify([...perms].sort());
      const afterKey = JSON.stringify([...migrated].sort());
      if (beforeKey !== afterKey) {
        role.permissions = JSON.stringify(migrated);
        await repo.save(role);
      }
    }

    await migrateAllRolesRemoveConsoleUmbrella();
  } catch (error) {
    rolesLog.error('初始化角色失败:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
