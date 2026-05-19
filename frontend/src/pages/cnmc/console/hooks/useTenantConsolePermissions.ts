/**
 * 租户云控制台 RBAC：与 Cloudmap 池内 poolPageAction 对齐（严格读权限，无 clouds.console / clouds:read 兜底）。
 */
import { useCallback, useMemo } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useLicense } from '../../../../contexts/LicenseContext';
import { checkPoolPageReadPerm } from '../../clouds/Cloudmap/pool/lib/poolPageReadAccess';
import {
  canAccessTenantConsoleContainerResource,
  canAccessTenantConsoleLeftNav,
  canAccessTenantConsoleMainResource,
  firstAccessibleTenantConsoleContainerResource,
  firstAccessibleTenantConsoleLeftNav,
  firstAccessibleTenantConsoleMainResourceForScope,
  type TenantConsoleLeftNavKey,
} from '../lib/tenantConsolePageAccess';

export function useTenantConsolePermissions() {
  const { user } = useAuth();
  const { hasFeature } = useLicense();
  const ovnVpcEnabled = hasFeature('network.ovn.vpc');

  const permissions = useMemo(() => {
    const p = user?.permissions;
    return Array.isArray(p) ? p : [];
  }, [user?.permissions]);

  const canAccessLeftNav = useCallback(
    (navKey: TenantConsoleLeftNavKey) =>
      canAccessTenantConsoleLeftNav(permissions, navKey, ovnVpcEnabled),
    [permissions, ovnVpcEnabled],
  );

  const canAccessMainResource = useCallback(
    (resourceKey: string) => canAccessTenantConsoleMainResource(permissions, resourceKey),
    [permissions],
  );

  const canAccessContainerResource = useCallback(
    (resourceKey: string) => canAccessTenantConsoleContainerResource(permissions, resourceKey),
    [permissions],
  );

  const firstAccessibleLeftNav = useMemo(
    () => firstAccessibleTenantConsoleLeftNav(permissions, ovnVpcEnabled),
    [permissions, ovnVpcEnabled],
  );

  const pickFirstMainResourceForScope = useCallback(
    (scope: 'host' | 'flat' | 'vpc') =>
      firstAccessibleTenantConsoleMainResourceForScope(permissions, scope),
    [permissions],
  );

  const pickFirstContainerResource = useCallback(
    () => firstAccessibleTenantConsoleContainerResource(permissions),
    [permissions],
  );

  /** 写操作仍走 accessMapping（与 Section 内按钮一致）；读门控用严格 poolPageAction */
  const checkPoolPageWrite = useCallback(
    (writeAction: string) => {
      const readAction = writeAction.replace(':write', ':read');
      return (
        checkPoolPageReadPerm(permissions, readAction) || permissions.includes(writeAction)
      );
    },
    [permissions],
  );

  return {
    permissions,
    ovnVpcEnabled,
    canAccessLeftNav,
    canAccessMainResource,
    canAccessContainerResource,
    firstAccessibleLeftNav,
    pickFirstMainResourceForScope,
    pickFirstContainerResource,
    checkPoolPageWrite,
  };
}
