// ============================================================================
// 导航与权限目录统一导出 (Navigation & Permission Catalog Unified Export)
// ============================================================================
// 本文件为了保持向后兼容性，统一导出导航和权限相关的配置。
// 
// 注意：为了更好的职责分离，建议直接使用：
// - navigation.ts - 导航相关配置（侧边栏使用）
// - permissionCatalog.ts - 权限相关配置（权限管控使用）
// ============================================================================

// 重新导出导航相关配置
export type { Platform, Group } from './navigation';
export { PLATFORMS, PLATFORM_LABELS, GROUPS } from './navigation';

// 重新导出权限相关配置
export type { PermissionRouteItem as RouteItem } from './permissionCatalog';
export { 
  PERMISSION_CATALOG as ROUTE_CATALOG,
  platformOf,
  groupOf,
  featureLabelOf,
  getPermissionItem as getRouteItem
} from './permissionCatalog';
