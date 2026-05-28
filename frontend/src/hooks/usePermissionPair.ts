import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { hasPermissionForAction } from '../utils/accessMapping';
import { readActionToWrite } from '../utils/rbacUi';

/**
 * 页面级 read/write 权限对（有 read 可进页浏览，无 write 时由 UI 隐藏写操作）。
 */
export function usePermissionPair(readAction: string | null, writeAction?: string | null) {
  const { user } = useAuth();
  const perms = useMemo(
    () => {
      const permissions = user?.permissions;
      return Array.isArray(permissions) ? permissions : [];
    },
    [user?.permissions],
  );

  const write = writeAction ?? (readAction ? readActionToWrite(readAction) : null);

  return useMemo(
    () => ({
      canRead: readAction ? hasPermissionForAction(perms, readAction) : false,
      canWrite: write ? hasPermissionForAction(perms, write) : false,
    }),
    [perms, readAction, write],
  );
}
