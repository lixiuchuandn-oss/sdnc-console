/**
 * Cloudmap 资源池详情（与 `layouts/admin/cloudmap/cloudPoolSidebar` 侧栏路径一致）
 *
 * - PoolDetailPage.tsx — 布局与 Provider 包裹
 * - hooks/useCloudmapPoolDetailEngine.ts — 池级状态与加载编排
 * - routing/ — PoolRoutes、PoolDetailContext、types.ts
 * - panels/ — 主内容区视图；子目录 = `cloudPoolSidebar` 中 `CLOUDMAP_POOL_TAB_KEYS` 业务域
 * - panels/index.ts — 视图导出入口
 * - loaders/ — 首屏底稿 + 按路径内层段按需拉数；`pathResource/*` 与 panels 域同名
 * - hooks/ — 池级 hooks
 * - api.ts — 对本模块的 HTTP 聚合出口
 * - styles/layout.css — 详情页 flex / Tabs 布局（类名仍以 .cloudmap-* 为前缀）
 * - utils/ — 无 UI 的领域辅助
 */
export { default } from './PoolDetailPage';
export { default as PoolDetailPage } from './PoolDetailPage';
