import { useMemo } from 'react';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import {
  CLOUD_RESOURCE_POOLS_CREATE_WRITE,
  CLOUD_RESOURCE_POOLS_READ,
  CLOUD_RESOURCE_POOLS_WRITE,
} from '../../../constants/cloudPermissions';

type AuthUser = {
  role?: string;
  permissions?: string[];
} | null;

/** Admin 顶栏资源池条：读/写/概览可见性（License + RBAC） */
export function useAdminPoolAccess(
  user: AuthUser,
  hasPoolManagementLicense: boolean,
) {
  const canReadPools = useMemo(() => {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'super_admin') return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return (
      hasPermissionForAction(perms, CLOUD_RESOURCE_POOLS_READ) ||
      hasPermissionForAction(perms, 'clouds:read') ||
      hasPermissionForAction(perms, 'clouds:write')
    );
  }, [user]);

  const canWritePools = useMemo(() => {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'super_admin') return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return (
      hasPermissionForAction(perms, CLOUD_RESOURCE_POOLS_CREATE_WRITE) ||
      hasPermissionForAction(perms, CLOUD_RESOURCE_POOLS_WRITE) ||
      hasPermissionForAction(perms, 'clouds:write')
    );
  }, [user]);

  const headerPoolOverviewEnabled = useMemo(() => {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'super_admin') return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    if (hasPoolManagementLicense) return canReadPools;
    return (
      hasPermissionForAction(perms, 'clouds.ecs:read') ||
      hasPermissionForAction(perms, 'clouds.ecs:write')
    );
  }, [user, hasPoolManagementLicense, canReadPools]);

  return { canReadPools, canWritePools, headerPoolOverviewEnabled };
}
