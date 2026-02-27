/**
 * ==============================================================================
 * 模块名称: Harvester 直连路由入口 (Harvester Direct Routes Entry)
 * 文件路径: src/routes/clouds/harvester/harvester.direct.routes.ts
 * ==============================================================================
 * 功能描述:
 * 本文件是 Harvester 直连模式 (Direct Mode) 的路由注册入口。
 * 负责聚合 VM、Network、Storage 等子模块的路由，并提供统一的调试接口。
 *
 * 核心逻辑:
 * 1. [Route Aggregation]: 统一注册 Harvester 各个子领域的直连路由。
 * 2. [Debug Interface]: 提供 /debug-access 接口，用于开发者排查多租户权限和上下文信息。
 *
 * API 列表:
 * - (Sub-modules): 注册 VM, Network, Storage 等子模块路由
 * - GET /:id/debug-access  获取当前用户的租户上下文与权限信息 (Debug用途)
 * ==============================================================================
 */
import { Router, Response } from 'express';
import { registerHarvesterDirectStorageRoutes } from './harvester.direct.storage.routes';
import { registerHarvesterDirectVmRoutes } from './harvester.direct.vm.routes';
import { registerHarvesterDirectNetworkRoutes } from './harvester.direct.network.routes';
import { checkTenantAccess } from './harvester.direct.helpers';

/**
 * 注册 Harvester 直连相关的所有路由
 *
 * @param router Express Router 实例
 * @param checkAdminPermission 管理员权限校验中间件
 */
export const registerHarvesterDirectRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  // 注册子模块路由
  registerHarvesterDirectStorageRoutes(router, checkAdminPermission);
  registerHarvesterDirectVmRoutes(router, checkAdminPermission);
  registerHarvesterDirectNetworkRoutes(router, checkAdminPermission);

  // [Debug] 权限调试接口
  // 用于验证当前用户在特定云资源池下的租户上下文解析结果
  router.get(
    '/:id/debug-access',
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const access = await checkTenantAccess(req, id);
        res.json({
          user: {
            id: req.user?.id,
            username: req.user?.username,
            role: req.user?.role,
            tenantId: req.user?.tenantId,
            organizationId: req.user?.organizationId,
          },
          access,
          query: {
            cloudId: id,
          },
        });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );
};
