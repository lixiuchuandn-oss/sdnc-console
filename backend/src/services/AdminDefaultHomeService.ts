/**
 * 管理端登录后默认首页路径的**唯一**服务端实现（与 RouteSpec / `cloudmapPoolNavRows` 语义对齐的静态表 `HOME_PAGE_CANDIDATES`）。
 * 供 `POST /api/auth/login` 与 `GET /api/auth/admin-default-home` 在 Network 中返回顺位明细。
 *
 * 若 RouteSpec 中首页候选或池内总览行变更，请同步更新下方 `HOME_PAGE_CANDIDATES`。
 */
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { getSystemSetting } from '../config/systemSettings';
import { licenseService } from './LicenseService';
import {
  cbrBackupScheduleAliasSatisfied,
  isCbrBackupScheduleResourceBase,
} from '../constants/cbrSchedulePermissionLegacy';

export type AdminHomeStepOutcome = 'matched' | 'skipped';

export type AdminHomeResolutionStep = {
  id: string;
  homePagePriority: number;
  templatePath: string;
  resolvedPath?: string;
  outcome: AdminHomeStepOutcome;
  reason?: string;
  rbacAction?: string | null;
  rbacOk?: boolean;
  requiredFeature?: string;
  featureOk?: boolean;
  onlyWithoutFeature?: string;
  onlyWithoutOk?: boolean;
  /** 调试附加上下文（如 allowedRoles） */
  meta?: Record<string, unknown>;
};

export type AdminDefaultHomePayload = {
  /** 与前端落地页应一致（由本服务统一计算） */
  defaultPath: string;
  favoritePoolId: string;
  licenseFeatures: string[];
  steps: AdminHomeResolutionStep[];
};

function isCloudsContainersResourceBase(resourceBase: string): boolean {
  return resourceBase === 'clouds.containers' || resourceBase.startsWith('clouds.containers.');
}

function isCloudsDashboardOrPoolsResourceBase(resourceBase: string): boolean {
  return resourceBase === 'clouds.dashboard' || resourceBase === 'clouds.resource-pools';
}

/** 与 `frontend/src/utils/accessMapping.ts` 中 `hasPermissionForAction` 对齐 */
export function hasPermissionForAction(perms: string[], act: string | null): boolean {
  if (!act) return false;
  const permsArray = perms || [];
  const base = act.split(':')[0];
  const segments = base.split('.');
  const hasDomainPrefix = segments.length >= 2 ? `${segments[0]}.${segments[1]}` : null;

  if (permsArray.includes(act)) return true;
  if (permsArray.includes('*')) return true;
  if (permsArray.includes(act.replace(':read', ':write'))) return true;
  if (permsArray.includes(`${base}:*`)) return true;
  if (!!hasDomainPrefix && permsArray.includes(`${hasDomainPrefix}:*`)) return true;

  if (
    base.startsWith('clouds.') &&
    act.endsWith(':read') &&
    !isCloudsContainersResourceBase(base) &&
    !isCloudsDashboardOrPoolsResourceBase(base)
  ) {
    if (permsArray.includes('clouds.console:read') || permsArray.includes('clouds.console:write')) {
      return true;
    }
  }

  if (
    base.startsWith('clouds.') &&
    act.endsWith(':write') &&
    !isCloudsContainersResourceBase(base) &&
    !isCloudsDashboardOrPoolsResourceBase(base)
  ) {
    if (permsArray.includes('clouds.console:write')) {
      return true;
    }
  }

  if (base.startsWith('clouds.') && act.endsWith(':write')) {
    if (permsArray.includes('clouds:write')) {
      return true;
    }
  }

  if (base.startsWith('clouds.') && act.endsWith(':read')) {
    if (permsArray.includes('clouds:read') || permsArray.includes('clouds:write')) {
      return true;
    }
  }

  if (base.startsWith('clouds.containers.') && base !== 'clouds.containers' && act.endsWith(':read')) {
    if (permsArray.includes('clouds.containers:read') || permsArray.includes('clouds.containers:write')) {
      return true;
    }
  }
  if (base.startsWith('clouds.containers.') && base !== 'clouds.containers' && act.endsWith(':write')) {
    if (permsArray.includes('clouds.containers:write')) {
      return true;
    }
  }

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

  return false;
}

type HomeCandRow = {
  id: string;
  homePagePriority: number;
  path: string;
  pageAction: string | null;
  homePageSkipPermissionCheck?: boolean;
  homePageAllowedRoles?: string[];
  homePageOnlyWithoutFeature?: string;
  requiredFeature?: string;
  homePageReplaceParamFrom?: 'favoriteCloudId';
};

/** 与 RouteSpec + CLOUDMAP_POOL_NAV_ROWS（cloudmap-pool-rh-overview）中首页相关字段一致 */
const HOME_PAGE_CANDIDATES: HomeCandRow[] = [
  {
    id: 'cloudmap-pool-rh-overview',
    homePagePriority: -1,
    path: '/admin/clouds/:cloudId/resource_hub/overview',
    pageAction: 'clouds.monitoring.overview:read',
    homePageReplaceParamFrom: 'favoriteCloudId',
    homePageAllowedRoles: ['super_admin', 'admin'],
  },
  {
    id: 'admin-welcome',
    homePagePriority: 0,
    path: '/admin/welcome',
    pageAction: 'system.license:read',
    homePageSkipPermissionCheck: true,
    homePageOnlyWithoutFeature: 'platform.multi-cloud',
    homePageAllowedRoles: ['super_admin', 'admin'],
  },
  {
    id: 'dashboard',
    homePagePriority: 1,
    path: '/admin/dashboard',
    pageAction: 'clouds.dashboard:read',
    requiredFeature: 'sys.dashboard',
  },
  {
    id: 'clouds-list',
    homePagePriority: 2,
    path: '/admin/clouds',
    pageAction: 'clouds.resource-pools:read',
    requiredFeature: 'platform.multi-cloud',
  },
  {
    id: 'console',
    homePagePriority: 3,
    path: '/console',
    pageAction: 'clouds.console:read',
  },
  {
    id: 'tenants-list',
    homePagePriority: 4,
    path: '/admin/tenants',
    pageAction: 'tenants:read',
    requiredFeature: 'sys.tenant-mgmt',
  },
  {
    id: 'tenant-users',
    homePagePriority: 5,
    path: '/admin/tenants/users',
    pageAction: 'tenant-users:read',
    requiredFeature: 'sys.tenant-mgmt',
  },
  {
    id: 'settings-audit-logs',
    homePagePriority: 6,
    path: '/admin/settings/audit-logs',
    pageAction: 'system.audit:read',
  },
  {
    id: 'access-users',
    homePagePriority: 7,
    path: '/admin/access/users',
    pageAction: 'users:read',
  },
  {
    id: 'access-roles',
    homePagePriority: 8,
    path: '/admin/access/roles',
    pageAction: 'system.roles:read',
  },
];

const SORTED_CANDIDATES = [...HOME_PAGE_CANDIDATES].sort(
  (a, b) => (a.homePagePriority ?? 999) - (b.homePagePriority ?? 999),
);

function hasLicenseFeature(feature: string): boolean {
  return licenseService.hasFeature(feature);
}

/** 默认资源池：系统设置 favorite.cloudId；未配置时取最早创建的云资源池 */
async function resolveEffectiveFavoritePoolId(favoritePoolIdOverride?: string): Promise<string> {
  const fav = String(favoritePoolIdOverride ?? getSystemSetting('favorite.cloudId') ?? '').trim();
  if (fav) return fav;
  try {
    if (!AppDataSource.isInitialized) return '';
    const repo = AppDataSource.getRepository(Cloud);
    const rows = await repo.find({ order: { createdAt: 'ASC' }, take: 1 });
    const id = rows[0]?.id;
    return id ? String(id) : '';
  } catch {
    return '';
  }
}

export async function resolveAdminDefaultHome(
  permissions: string[] = [],
  role?: string,
  favoritePoolIdOverride?: string,
): Promise<AdminDefaultHomePayload> {
  const r = String(role || '').toLowerCase();
  const fav = await resolveEffectiveFavoritePoolId(favoritePoolIdOverride);
  const status = licenseService.getStatus();
  const licenseFeatures = status.payload?.features ? [...status.payload.features] : [];

  if (r === 'tenant') {
    return {
      defaultPath: '/console',
      favoritePoolId: fav,
      licenseFeatures,
      steps: [
        {
          id: 'tenant-console-direct',
          homePagePriority: -2,
          templatePath: '/console',
          resolvedPath: '/console',
          outcome: 'matched',
          reason: 'tenant_account_type',
        },
      ],
    };
  }

  const isSystemAdminRole = r === 'super_admin' || r === 'admin';
  const hasFeature = (f: string) => hasLicenseFeature(f);

  const steps: AdminHomeResolutionStep[] = [];

  for (const spec of SORTED_CANDIDATES) {
    const baseStep: Omit<AdminHomeResolutionStep, 'outcome' | 'reason' | 'resolvedPath'> = {
      id: spec.id,
      homePagePriority: spec.homePagePriority,
      templatePath: spec.path,
      rbacAction: spec.homePageSkipPermissionCheck ? null : spec.pageAction,
    };

    if (isSystemAdminRole && spec.path === '/console') {
      steps.push({
        ...baseStep,
        outcome: 'skipped',
        reason: 'system_admin_skip_console',
      });
      continue;
    }

    if (spec.homePageAllowedRoles?.length) {
      if (!spec.homePageAllowedRoles.includes(r)) {
        steps.push({
          ...baseStep,
          outcome: 'skipped',
          reason: 'homePageAllowedRoles',
          meta: { allowed: spec.homePageAllowedRoles, role: r },
        });
        continue;
      }
    }

    if (spec.homePageOnlyWithoutFeature) {
      const onlyWithoutOk = !hasFeature(spec.homePageOnlyWithoutFeature);
      if (!onlyWithoutOk) {
        steps.push({
          ...baseStep,
          outcome: 'skipped',
          reason: 'homePageOnlyWithoutFeature',
          onlyWithoutFeature: spec.homePageOnlyWithoutFeature,
          onlyWithoutOk: false,
        });
        continue;
      }
    }

    let rbacOk = true;
    if (!spec.homePageSkipPermissionCheck) {
      const act = spec.pageAction;
      rbacOk = hasPermissionForAction(permissions, act);
      if (!rbacOk) {
        steps.push({
          ...baseStep,
          outcome: 'skipped',
          reason: 'rbac',
          rbacAction: act,
          rbacOk: false,
        });
        continue;
      }
    }

    if (spec.requiredFeature) {
      const featureOk = hasFeature(spec.requiredFeature);
      if (!featureOk) {
        steps.push({
          ...baseStep,
          outcome: 'skipped',
          reason: 'requiredFeature',
          requiredFeature: spec.requiredFeature,
          featureOk: false,
          rbacOk: spec.homePageSkipPermissionCheck ? undefined : true,
        });
        continue;
      }
    }

    if (spec.homePageReplaceParamFrom === 'favoriteCloudId') {
      if (!fav) {
        steps.push({
          ...baseStep,
          outcome: 'skipped',
          reason: 'missing_favorite_pool_id',
          rbacOk: true,
        });
        continue;
      }
      const resolvedPath = spec.path.replace(':cloudId', encodeURIComponent(fav));
      steps.push({
        ...baseStep,
        outcome: 'matched',
        resolvedPath,
        rbacOk: spec.homePageSkipPermissionCheck ? undefined : true,
        requiredFeature: spec.requiredFeature,
        featureOk: spec.requiredFeature ? true : undefined,
      });
      return {
        defaultPath: resolvedPath,
        favoritePoolId: fav,
        licenseFeatures,
        steps,
      };
    }

    steps.push({
      ...baseStep,
      outcome: 'matched',
      resolvedPath: spec.path,
      rbacOk: spec.homePageSkipPermissionCheck ? undefined : true,
      requiredFeature: spec.requiredFeature,
      featureOk: spec.requiredFeature ? true : undefined,
    });
    return {
      defaultPath: spec.path,
      favoritePoolId: fav,
      licenseFeatures,
      steps,
    };
  }

  steps.push({
    id: 'fallback-coming-soon',
    homePagePriority: 999,
    templatePath: '/admin/coming-soon',
    outcome: 'matched',
    resolvedPath: '/admin/coming-soon',
    reason: 'no_home_candidate',
  });
  return {
    defaultPath: '/admin/coming-soon',
    favoritePoolId: fav,
    licenseFeatures,
    steps,
  };
}
