import { useMemo } from 'react';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';
import { CLOUD_CLOUDMAP_OPS_VIEW_WRITE } from '../../../../../constants/cloudPermissions';

/** 是否具备 Cloudmap 运维视图能力（原「运维模式」开关，现仅由 RBAC 决定） */
export function useCloudmapOpsViewWrite(): boolean {
  const { user } = useAuth();
  return useMemo(
    () => hasPermissionForAction(user?.permissions ?? [], CLOUD_CLOUDMAP_OPS_VIEW_WRITE),
    [user?.permissions],
  );
}
