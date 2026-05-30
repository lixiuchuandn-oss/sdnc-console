import { routeSpecs } from '../routes/RouteSpec';
import { POOL_PAGE_IMPLIED_READ_BASES } from '../pages/cnmc/clouds/Cloudmap/pool/lib/poolPageReadAccess';
import { unifiedStorageReadGranted } from '../pages/cnmc/clouds/Cloudmap/pool/lib/clusterPageAccess';
import { isUnifiedStorageReadBase } from '../constants/unifiedStoragePermissions';
import {
  cbrBackupScheduleAliasSatisfied,
  isCbrBackupScheduleResourceBase,
} from '../constants/cbrPermissionBases';

/**
 * 从 RouteSpec 自动生成路径权限映射
 * 
 * 【单点生效机制】
 * - 只需在 RouteSpec 中修改 requiredActions.page，accessMapping 会自动更新
 * - 修改一个路由的权限，不会影响其他路由
 * - 符合 DRY 原则（Don't Repeat Yourself）
 */
const generateMappingFromRouteSpecs = (): Array<{ path: string; action: string }> => {
  return routeSpecs
    .filter((spec) => !spec.tenantAccountEntry)
    .map((spec) => ({
      path: spec.path,
      action: spec.requiredActions?.page,
    }))
    .filter((mapping): mapping is { path: string; action: string } => !!mapping.action)
    // 按路径长度降序排序，确保更具体的路径优先匹配（如 Cloudmap 池内路径先于 /admin/clouds 列表）
    .sort((a, b) => b.path.length - a.path.length);
};

/**
 * 手动补充的特殊映射（用于没有 requiredActions 的路由或特殊路径）
 * 
 * 【使用场景】
 * - 路径前缀匹配（如 /admin/clouds 匹配所有 /admin/clouds/* 的子路径）
 * - 没有在 RouteSpec 中定义的路由
 * - 需要特殊权限逻辑的路径
 * 
 * 【注意】
 * - 资源池列表 `/admin/clouds` 与 Cloudmap 池内路径均在 RouteSpec 中配置 requiredActions（列表为 resource-pools，池内为 console）
 */
const MANUAL_MAPPINGS: Array<{ path: string; action: string }> = [
  // 旧版租户控制台入口：重定向至 /console；权限由 TenantConsoleRoute / 账号类型判定
];

/**
 * 路径权限映射表
 * 
 * 【数据来源】
 * - 主要来源：从 RouteSpec 自动生成（单点生效）
 * - 补充来源：手动映射（特殊情况）
 * 
 * 【修改方式】
 * - ✅ 推荐：在 RouteSpec 中修改 requiredActions.page
 * - ⚠️ 特殊：在 MANUAL_MAPPINGS 中添加手动映射
 */
export const PATH_PERMISSION_MAPPING: Array<{ path: string; action: string }> = [
  ...generateMappingFromRouteSpecs(),
  ...MANUAL_MAPPINGS,
];

// 开发环境调试：打印生成的映射表（已禁用）
// if (process.env.NODE_ENV === 'development') {
//   console.log('[accessMapping] Generated mappings:', PATH_PERMISSION_MAPPING);
// }

export const getRequiredActionForPath = (path: string): string | null => {
  const purePath = String(path || '').split('?')[0];

  const matchesPath = (targetPath: string, patternPath: string): boolean => {
    const targetSegments = targetPath.split('/').filter(Boolean);
    const patternSegments = patternPath.split('/').filter(Boolean);
    if (targetSegments.length < patternSegments.length) return false;

    for (let i = 0; i < patternSegments.length; i += 1) {
      const patternSeg = patternSegments[i];
      const targetSeg = targetSegments[i];
      if (!patternSeg.startsWith(':') && patternSeg !== targetSeg) {
        return false;
      }
    }

    return true;
  };

  for (const mapping of PATH_PERMISSION_MAPPING) {
    if (matchesPath(purePath, mapping.path)) {
      // 开发环境调试（已禁用）
      // if (process.env.NODE_ENV === 'development') {
      //   console.log(`[accessMapping] Path "${purePath}" matched mapping:`, mapping);
      // }
      return mapping.action;
    }
  }
  // 开发环境调试（已禁用）
  // if (process.env.NODE_ENV === 'development') {
  //   console.warn(`[accessMapping] No mapping found for path: "${purePath}"`);
  // }
  return null;
};

export const hasPermissionForAction = (perms: string[], act: string | null): boolean => {
  if (!act) return false; // 未映射的路径默认拒绝访问
  const permsArray = perms || [];
  const base = act.split(':')[0];
  const segments = base.split('.');
  const hasDomainPrefix = segments.length >= 2 ? `${segments[0]}.${segments[1]}` : null;
  
  // 精确匹配
  if (permsArray.includes(act)) return true;
  
  // 超级管理员权限
  if (permsArray.includes('*')) return true;
  
  // write 权限包含 read 权限
  if (permsArray.includes(act.replace(':read', ':write'))) return true;
  
  // 通配符匹配：base:* 或 domain.feature:*
  if (permsArray.includes(`${base}:*`)) return true;
  if (!!hasDomainPrefix && permsArray.includes(`${hasDomainPrefix}:*`)) return true;
  
  // clouds:write 包含 clouds.*:write（含 clouds.containers.*）
  if (base.startsWith('clouds.') && act.endsWith(':write')) {
    if (permsArray.includes('clouds:write')) {
      return true;
    }
  }

  // clouds:read|write 覆盖 clouds.*:read（含 clouds.containers.*）
  if (base.startsWith('clouds.') && act.endsWith(':read')) {
    if (permsArray.includes('clouds:read') || permsArray.includes('clouds:write')) {
      return true;
    }
  }

  // 容器总权覆盖各子域（与后端 PermissionChecker / registry 语义一致）
  if (
    base.startsWith('clouds.containers.') &&
    base !== 'clouds.containers' &&
    act.endsWith(':read')
  ) {
    if (
      permsArray.includes('clouds.containers:read') ||
      permsArray.includes('clouds.containers:write')
    ) {
      return true;
    }
  }
  if (
    base.startsWith('clouds.containers.') &&
    base !== 'clouds.containers' &&
    act.endsWith(':write')
  ) {
    if (permsArray.includes('clouds.containers:write')) {
      return true;
    }
  }

  // 云备份：历史 clouds.backups 总权仅覆盖快照；定时策略须显式 clouds.schedules
  if (base === 'clouds.vm-backup-snapshots') {
    if (permsArray.includes('clouds.backups:read') || permsArray.includes('clouds.backups:write')) {
      return true;
    }
  }
  if (
    isCbrBackupScheduleResourceBase(base) &&
    (act.endsWith(':read') || act.endsWith(':write')) &&
    cbrBackupScheduleAliasSatisfied(permsArray, base, act.endsWith(':write') ? 'write' : 'read')
  ) {
    return true;
  }

  // 池内页级 token 隐式读（与 poolPageReadAccess POOL_PAGE_IMPLIED_READ_BASES、backend checker 对齐）
  if (act.endsWith(':read')) {
    for (const [pagePrefix, impliedBases] of Object.entries(POOL_PAGE_IMPLIED_READ_BASES)) {
      if (!(impliedBases as readonly string[]).includes(base)) continue;
      if (
        permsArray.includes(`${pagePrefix}:read`) ||
        permsArray.includes(`${pagePrefix}:write`) ||
        permsArray.includes(`${pagePrefix}:*`)
      ) {
        return true;
      }
    }
  }

  // 统一存储子域：umbrella / 历史 clouds.ceph（权限 ID 不含 ceph）
  if (act.endsWith(':read') && isUnifiedStorageReadBase(base)) {
    if (unifiedStorageReadGranted(permsArray, act)) return true;
  }

  // 容器子域 ↔ 已移除的 clouds.containers 总权（双向兼容）
  const containerSubReadActions = [
    'clouds.containers.workloads:read',
    'clouds.containers.pods:read',
    'clouds.containers.jobs:read',
    'clouds.containers.services:read',
    'clouds.containers.ingresses:read',
    'clouds.containers.gateway:read',
    'clouds.containers.configs:read',
    'clouds.containers.registries:read',
    'clouds.containers.pdbs:read',
    'clouds.containers.networkpolicies:read',
  ] as const;
  const containerSubWriteActions = containerSubReadActions.map((a) =>
    a.replace(':read', ':write'),
  );
  if (base === 'clouds.containers') {
    if (
      act.endsWith(':read') &&
      containerSubReadActions.some(
        (a) => permsArray.includes(a) || permsArray.includes(a.replace(':read', ':write')),
      )
    ) {
      return true;
    }
    if (act.endsWith(':write') && containerSubWriteActions.some((a) => permsArray.includes(a))) {
      return true;
    }
  }

  // 历史 atom：clouds.cluster-services 已并入 clouds.containers.services
  if (base === 'clouds.containers.services') {
    if (
      act.endsWith(':read') &&
      (permsArray.includes('clouds.cluster-services:read') ||
        permsArray.includes('clouds.cluster-services:write'))
    ) {
      return true;
    }
    if (act.endsWith(':write') && permsArray.includes('clouds.cluster-services:write')) {
      return true;
    }
  }

  return false;
};
