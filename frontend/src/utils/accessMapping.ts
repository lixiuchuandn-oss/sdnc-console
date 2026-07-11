import { routeSpecs } from '../routes/RouteSpec';

/**
 * 从 RouteSpec 自动生成路径权限映射
 */
const generateMappingFromRouteSpecs = (): Array<{ path: string; action: string }> => {
  return routeSpecs
    .map((spec) => ({
      path: spec.path,
      action: spec.requiredActions?.page,
    }))
    .filter((mapping): mapping is { path: string; action: string } => !!mapping.action)
    .sort((a, b) => b.path.length - a.path.length);
};

const MANUAL_MAPPINGS: Array<{ path: string; action: string }> = [];

export const PATH_PERMISSION_MAPPING: Array<{ path: string; action: string }> = [
  ...generateMappingFromRouteSpecs(),
  ...MANUAL_MAPPINGS,
];

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
      return mapping.action;
    }
  }
  return null;
};

export const hasPermissionForAction = (perms: string[], act: string | null): boolean => {
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
};
