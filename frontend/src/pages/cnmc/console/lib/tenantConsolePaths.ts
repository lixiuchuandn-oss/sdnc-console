/**
 * 租户云资源（Cloudmap）控制台 — 与平台管理后台 `/admin/*` 分离的独立路径前缀。
 */
export const TENANT_CLOUD_CONSOLE_PATH = '/console' as const;

/** 旧版入口，仅用于重定向兼容书签与历史链接 */
export const LEGACY_TENANT_CLOUD_CONSOLE_PATH = '/admin/clouds/console' as const;

/**
 * 租户云主机控制台：GET 列表是否合并「公共场景命名空间」(tower.io/scenario=public) 的资源。
 * 与后端 query `mergePublicScenarioNamespaces` 对齐：镜像、实例页（公共镜像）、扁平子网为 true；模板仅租户自有命名空间。
 */
export function shouldMergePublicScenarioForTenantConsole(
  activeCategory: string,
  activeResource: string,
): boolean {
  if (activeCategory === 'compute' && activeResource === 'image') return true;
  /** 实例列表依赖公共镜像（创建/展示） */
  if (activeCategory === 'compute' && activeResource === 'vm') return true;
  if (activeCategory === 'flatnet' && activeResource === 'flat-subnet') return true;
  return false;
}
