export { registerHarvesterRoutes } from './harvester.cache.routes';
export { registerHarvesterDirectRoutes } from './harvester.direct.routes';
export { registerHarvesterServiceRoutesProvider } from './harvester.service.routes.provider';
// 旧路由已迁移到 provider 模式，文件已移动到 old 目录
// 如需查看历史实现，请参考 old 目录下的文件
// 注意：registerHarvesterCacheRoutesProvider 仅在内部使用，不需要导出

