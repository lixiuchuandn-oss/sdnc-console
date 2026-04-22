/**
 * 管理后台布局子模块（与 `tenant/` 对称）：顶栏、侧栏、内容区、全局搜索。
 * 路由侧建议仍从 `layouts/AdminLayout` 引入默认导出以保持路径稳定。
 */
export { default } from './AdminLayout';
export { default as AdminSidebar } from './AdminSidebar';
export type { AdminSidebarCenter } from './AdminSidebar';
