import { ALL_PERMISSIONS, getGroupByPermission, getPlatformByPermission } from './permissions';
import { isSdncProduct } from './productFlavor';

/** SDNC 仅 IBR：SDNCC 下只保留 PERMISSION_GROUPS「IBR管理」原子（VR/SRv6/IPsec/ACL/NAT） */
const SDNC_IBR_GROUP = 'IBR管理';

/** 单条权限是否纳入 SDNC RBAC 目录（Tower 全量时恒 true） */
export function isPermissionInSdncCatalog(permission: string): boolean {
  const platform = getPlatformByPermission(permission);
  if (platform === 'SETTINGS') return true;
  if (platform === 'SDNCC') {
    return getGroupByPermission(permission) === SDNC_IBR_GROUP;
  }
  return false;
}

/** 当前产品形态下 RBAC 可选权限原子（种子、/rbac/actions、/rbac/permissions） */
export function getEffectivePermissionCatalog(
  all: readonly string[] = ALL_PERMISSIONS,
): string[] {
  if (!isSdncProduct()) {
    return [...all];
  }
  return all.filter(isPermissionInSdncCatalog);
}
