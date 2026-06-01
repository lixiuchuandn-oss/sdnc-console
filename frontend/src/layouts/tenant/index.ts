/**
 * 租户控制台布局子模块：顶栏、可选产品侧栏、内容区。
 * 路由侧建议仍从 `layouts/TenantConsoleLayout` 引入默认导出以保持路径稳定。
 */
export { default } from './TenantConsoleLayout';
export { TENANT_CONSOLE_HEADER_HEIGHT_PX } from './TenantConsoleHeader';
export { TenantConsoleSiderProvider, useTenantConsoleSider } from './TenantConsoleSiderContext';
export type { TenantConsoleSiderModel } from './TenantConsoleSiderContext';
