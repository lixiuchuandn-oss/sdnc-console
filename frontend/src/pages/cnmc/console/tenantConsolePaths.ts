/**
 * 租户云资源（Cloudmap）控制台 — 与平台管理后台 `/admin/*` 分离的独立路径前缀。
 */
export const TENANT_CLOUD_CONSOLE_PATH = '/console' as const;

/** 旧版入口，仅用于重定向兼容书签与历史链接 */
export const LEGACY_TENANT_CLOUD_CONSOLE_PATH = '/admin/clouds/console' as const;
