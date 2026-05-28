/**
 * 管理端：当前路径不可访问时，解析用户可进入的第一个静态路由。
 * 动态路径（含 :cloudId）优先依赖 `GET /api/auth/admin-default-home`。
 */
import { routeSpecs, type RouteSpec } from '../routes/RouteSpec';
import { hasPermissionForAction } from './accessMapping';

export function normalizeAdminPath(p: string): string {
  const pure = String(p || '').split('?')[0].trim();
  if (!pure || pure === '/') return '/';
  return pure.endsWith('/') && pure.length > 1 ? pure.slice(0, -1) : pure;
}

function findRouteSpecForPath(pathname: string): RouteSpec | undefined {
  const p = normalizeAdminPath(pathname);
  return routeSpecs.find((r) => {
    if (r.path === p) return true;
    if (r.path.includes(':')) {
      const base = r.path.split(':')[0];
      return p.startsWith(base);
    }
    return false;
  });
}

export function canAccessAdminPath(
  pathname: string,
  user: { role?: string; permissions?: string[] },
  hasFeature: (f: string) => boolean,
): boolean {
  const pure = normalizeAdminPath(pathname);
  const role = String(user.role || '').toLowerCase();
  if (role === 'super_admin') return true;
  if (pure === '/admin/welcome' && role === 'admin') return true;
  if (pure === '/admin/coming-soon' && (role === 'admin' || role === 'super_admin')) return true;
  if ((pure === '/admin' || pure === '/admin/') && role === 'admin') return true;

  const spec = findRouteSpecForPath(pure);
  if (spec?.requiredFeature && !hasFeature(spec.requiredFeature)) return false;

  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  const act = spec?.requiredActions?.page ?? null;
  if (!act) return false;
  return hasPermissionForAction(perms, act);
}

/** 与后端 `HOME_PAGE_CANDIDATES` 顺位大致一致（仅静态 path） */
export function findFirstAccessibleAdminPath(
  user: { role?: string; permissions?: string[] },
  hasFeature: (f: string) => boolean,
): string {
  const role = String(user.role || '').toLowerCase();
  if (role === 'super_admin') return '/admin/dashboard';

  const specs = [...routeSpecs]
    .filter((s) => s.layout === 'admin' && s.requiredActions?.page && !s.path.includes(':'))
    .sort((a, b) => {
      const pa = a.homePagePriority ?? 1000;
      const pb = b.homePagePriority ?? 1000;
      if (pa !== pb) return pa - pb;
      return (a.order ?? 1000) - (b.order ?? 1000);
    });

  for (const spec of specs) {
    if (spec.homePageAllowedRoles?.length && !spec.homePageAllowedRoles.includes(role)) {
      continue;
    }
    if (spec.homePageOnlyWithoutFeature && hasFeature(spec.homePageOnlyWithoutFeature)) {
      continue;
    }
    if (spec.requiredFeature && !hasFeature(spec.requiredFeature)) {
      continue;
    }
    if (spec.homePageSkipPermissionCheck && role === 'admin') {
      return spec.path;
    }
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    if (hasPermissionForAction(perms, spec.requiredActions!.page)) {
      return spec.path;
    }
  }

  return '/admin/coming-soon';
}
