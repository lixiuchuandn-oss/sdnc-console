import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { hasPermissionForAction } from '../utils/accessMapping';

/** 云桌面统一权限：clouds.desktop:read / write */
export function useCloudDesktopPermission() {
  const { user } = useAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const permissions = (user?.permissions ?? []) as string[];

  return useMemo(() => {
    const canWrite =
      user?.role === 'super_admin' ||
      hasPermissionForAction(permissions, 'clouds.desktop:write');
    const canRead =
      canWrite || hasPermissionForAction(permissions, 'clouds.desktop:read');
    return { canRead, canWrite };
  }, [user?.role, permissions]);
}
