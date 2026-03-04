/**
 * ==============================================================================
 * 模块名称: Harvester 资源缓存路由 (Harvester Resource Cache Routes)
 * 文件路径: src/routes/clouds/harvester/harvester.cache.routes.ts
 * ==============================================================================
 *
 * [功能描述]
 * 注册 Harvester 相关的资源路由，包括：
 * 1. 资源迁移记录查询 (Migrations)
 * 2. 通用 API 代理 (Proxy)
 * 3. 聚合注册其他子模块路由 (VM, Storage, Network 等)
 *
 * [核心逻辑]
 * 1. 迁移记录同步策略:
 *    - 如果本地无记录 (count === 0) 或强制刷新 (force=true)，则触发同步
 *    - 否则直接返回本地缓存数据
 * 2. API 代理逻辑:
 *    - 支持绝对路径 (http/https) 和相对路径
 *    - 智能处理 API 路径前缀 (/api/, /apis/)，自动修正 endpoint 以适配 k8s 原生接口
 *
 * ------------------------------------------------------------------------------
 * [交互/依赖说明 (Dependencies & Interactions)]
 * ------------------------------------------------------------------------------
 * 1. 涉及接口:
 *    - GET /:id/resources/harvester/migrations?force=boolean - 查询虚拟机迁移记录 (支持强制刷新)
 *    - GET /:id/resources/harvester/proxy?path=string - 通用 Harvester API 代理 (支持 k8s 原生路径修正)
 *
 * 2. 依赖服务:
 *    - HarvesterMigrationInventory (数据库实体)
 *    - syncKubevirtMigrations (同步逻辑)
 *    - fetchCloudOr404 (云资源获取)
 * ==============================================================================
 */
import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { HarvesterMigrationInventory } from '../../../entities/harvester/HarvesterMigrationInventory';
import { requestJson } from '../../../services/clouds/harvester/utils';
import { syncKubevirtMigrations } from '../../../services/clouds/harvester/inventory';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { registerHarvesterVmRoutes } from './harvester.cache.vm.routes';
import { registerHarvesterStorageRoutes } from './harvester.cache.storage.routes';
import { registerHarvesterNetworkRoutes } from './harvester.cache.network.routes';
import { registerHarvesterClusterRoutes } from './harvester.cache.cluster.routes';
import { registerHarvesterNamespaceRoutes } from './harvester.cache.namespace.routes';
import { registerHarvesterPeripheralsRoutes } from './harvester.cache.peripherals.routes';
import { registerHarvesterMetaRoutes } from './harvester.cache.meta.routes';

/**
 * [初始化] 注册所有 Harvester 相关路由
 * @param router Express 路由对象
 * @param checkAdminPermission 权限校验中间件
 */
export const registerHarvesterRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  /**
   * [API] 查询 Harvester 虚拟机迁移记录
   * GET /:id/resources/harvester/migrations
   *
   * [同步策略]
   * 1. 检查本地数据库是否已有记录
   * 2. 如果无记录或请求参数 force=true，调用 syncKubevirtMigrations 同步最新数据
   * 3. 如果同步失败且本地无数据，抛出异常；否则降级返回旧数据
   */
  router.get(
    '/:id/resources/harvester/migrations',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterMigrationInventory);
        const count = await repo.count({ where: { cloudId: id } });
        if (String(force) === 'true' || count === 0) {
          try {
            await syncKubevirtMigrations(cloud, insecure);
          } catch (e: any) {
            if (count === 0) throw e;
          }
        }
        const items = await repo.find({ where: { cloudId: id } });
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({
          message: '查询迁移记录失败',
          error: error.body || error.message || error,
        });
      }
    },
  );

  /**
   * [API] Harvester 通用 API 代理
   * GET /:id/resources/harvester/proxy
   *
   * [参数说明]
   * - path: 目标 API 路径 (支持 /apis/..., /api/..., 或 http全路径)
   *
   * [核心逻辑]
   * 1. [路径重写]: 如果请求 k8s 原生 API (/api/, /apis/) 且 endpoint 含版本号，
   *    自动去除 endpoint 的版本后缀，确保 k8s API 路径正确拼接
   * 2. [安全性]: 复用 Cloud 配置的 secretKey 进行认证
   * 3. [请求转发]: 默认支持 GET 请求，若需其他方法请扩展逻辑
   */
  router.all(
    '/:id/resources/harvester/proxy',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { path } = req.query;
        if (!path || typeof path !== 'string') {
          return res.status(400).json({ message: 'Missing path parameter' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester', next))
          return;

        const insecure = !!(cloud.config as any)?.ignoreTls;

        let target = '';
        if (path.startsWith('http://') || path.startsWith('https://')) {
          target = path;
        } else {
          const cleanPath = path.startsWith('/') ? path : `/${path}`;

          let base = cloud.endpoint.replace(/\/+$/, '');

          if (
            (cleanPath.startsWith('/api/') ||
              cleanPath.startsWith('/apis/')) &&
            !base.includes('/k8s/clusters/')
          ) {
            base = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
          }

          target = `${base}${cleanPath}`;
        }
        console.log(`[HarvesterProxy] Proxying ${req.method} to: ${target}`);

        const data = await requestJson(
          req.method,
          target,
          cloud.secretKey || '',
          insecure,
          req.method === 'POST' || req.method === 'PUT' ? req.body : undefined
        );
        res.json(data);
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: 'Proxy request failed',
          error: error.message || String(error),
        });
      }
    },
  );

  // [模块注册] 聚合注册各个子功能模块的路由
  registerHarvesterVmRoutes(router, checkAdminPermission);
  registerHarvesterStorageRoutes(router, checkAdminPermission);
  registerHarvesterNetworkRoutes(router, checkAdminPermission);
  registerHarvesterClusterRoutes(router, checkAdminPermission);
  registerHarvesterNamespaceRoutes(router, checkAdminPermission);
  registerHarvesterPeripheralsRoutes(router, checkAdminPermission);
  registerHarvesterMetaRoutes(router, checkAdminPermission);
};
