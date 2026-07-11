/**
 * 管理端登录后默认首页（SDNC：IBR / 设置页候选；仅 RBAC，无 License 门控）。
 */
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
  onlyWithoutFeature?: string;
  onlyWithoutOk?: boolean;
  meta?: Record<string, unknown>;
};

export type AdminDefaultHomePayload = {
  defaultPath: string;
  favoritePoolId: string;
  /** API 兼容字段；SDNC 恒为空 */
  licenseFeatures: string[];
  steps: AdminHomeResolutionStep[];
};

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

  return false;
}

type HomeCandRow = {
  id: string;
  homePagePriority: number;
  path: string;
  pageAction: string | null;
  homePageSkipPermissionCheck?: boolean;
  homePageAllowedRoles?: string[];
};

const HOME_PAGE_CANDIDATES: HomeCandRow[] = [
  {
    id: 'interconnect-vr',
    homePagePriority: 0,
    path: '/admin/interconnect/vr',
    pageAction: 'networks.vr-config:read',
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

async function resolveEffectiveFavoritePoolId(_favoritePoolIdOverride?: string): Promise<string> {
  return '';
}

export async function resolveAdminDefaultHome(
  permissions: string[] = [],
  role?: string,
  favoritePoolIdOverride?: string,
): Promise<AdminDefaultHomePayload> {
  const r = String(role || '').toLowerCase();
  const fav = await resolveEffectiveFavoritePoolId(favoritePoolIdOverride);

  if (r === 'tenant') {
    return {
      defaultPath: '/admin/interconnect/vr',
      favoritePoolId: fav,
      licenseFeatures: [],
      steps: [
        {
          id: 'tenant-fallback-vr',
          homePagePriority: -2,
          templatePath: '/admin/interconnect/vr',
          resolvedPath: '/admin/interconnect/vr',
          outcome: 'matched',
          reason: 'tenant_account_type',
        },
      ],
    };
  }

  const steps: AdminHomeResolutionStep[] = [];

  for (const spec of SORTED_CANDIDATES) {
    const baseStep: Omit<AdminHomeResolutionStep, 'outcome' | 'reason' | 'resolvedPath'> = {
      id: spec.id,
      homePagePriority: spec.homePagePriority,
      templatePath: spec.path,
      rbacAction: spec.homePageSkipPermissionCheck ? null : spec.pageAction,
    };

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

    if (!spec.homePageSkipPermissionCheck) {
      const act = spec.pageAction;
      const rbacOk = hasPermissionForAction(permissions, act);
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

    steps.push({
      ...baseStep,
      outcome: 'matched',
      resolvedPath: spec.path,
      rbacOk: spec.homePageSkipPermissionCheck ? undefined : true,
    });
    return {
      defaultPath: spec.path,
      favoritePoolId: fav,
      licenseFeatures: [],
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
    licenseFeatures: [],
    steps,
  };
}
