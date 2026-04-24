import { routeSpecs } from './RouteSpec';

function normalizePath(p: string): string {
  return String(p || '').replace(/\/+$/, '') || '/';
}

function pathMatch(specPath: string, curPath: string): boolean {
  const a = normalizePath(specPath);
  const b = normalizePath(curPath);
  if (a === b) return true;
  const re = new RegExp(`^${a.replace(/:[^/]+/g, '[^/]+')}$`);
  return re.test(b);
}

export function findRouteSpecForPath(pathname: string) {
  const pure = String(pathname || '').split('?')[0];
  return routeSpecs.find((s) => pathMatch(s.path, pure));
}

/**
 * 与 RouteSpec 中 SDN 控制台常见前缀一致（含未单独注册子路径，如 /admin/interconnect/srv6/create）。
 */
export function isSdnccAdminPathname(pathname: string): boolean {
  const p = String(pathname || '').split('?')[0];
  return (
    p.startsWith('/admin/interconnect/') ||
    p.startsWith('/admin/sec-mgr-plane/') ||
    p.startsWith('/admin/security/traffic/')
  );
}

/** 当前路径是否属 SDN 控制台页面（用于表格等全域样式）。 */
export function isSdnccPagePath(pathname: string): boolean {
  const spec = findRouteSpecForPath(pathname);
  return spec?.platform === 'SDNCC' || isSdnccAdminPathname(pathname);
}
