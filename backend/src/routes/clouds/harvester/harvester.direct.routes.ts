/**
 * Harvester 直连路由入口
 *
 * 功能：
 * 1. 注册所有直连资源路由（通过 provider-router 模式）
 * 2. 提供调试接口用于排查多租户权限问题
 *
 * 路由：
 * - GET /:id/debug-access - 获取当前用户的租户上下文与权限信息（开发调试用）
 */
import { Router, Response } from 'express';
import { registerHarvesterDirectRoutesProvider } from './harvester.direct.routes.provider';
import { checkTenantAccess } from './harvester.direct.helpers';

/**
 * 注册 Harvester 直连路由
 */
export const registerHarvesterDirectRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  // 注册所有直连资源路由（VM、Network、Storage 等）
  registerHarvesterDirectRoutesProvider(router, checkAdminPermission);

  // 调试接口：用于验证租户权限上下文解析结果
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
