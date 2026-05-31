import { Router, Response, type RequestHandler } from 'express';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import { resolveDifyConsoleForCloud } from '../../services/clouds/dify/difyPoolConsole';
import { normalizeDifyConsoleUrl } from '../../services/clouds/dify/towerSsoToken';
import {
  getDifyAdminEmailHint,
  isDifyAdminLoginConfigured,
  loginDifyAdminSession,
  clearDifyAdminSession,
} from '../../services/clouds/dify/difyAdminSession';

const log = logger.child('EdgeDifyAdmin');

async function fetchEdgePoolOr404(id: string, res: Response): Promise<Cloud | null> {
  const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  if (String(cloud.config?.provider || '').toLowerCase() !== 'xinference') {
    res.status(400).json({ message: '仅边缘推理资源池支持 Dify' });
    return null;
  }
  return cloud;
}

/**
 * 边缘池 Dify：管理员账号代登（不走 Tower SSO JWT）
 */
export function attachDifyAdminRoutes(router: Router, perm: RequestHandler): void {
  router.get('/:id/xinference/dify/embed-config', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchEdgePoolOr404(req.params.id, res);
      if (!cloud) return;
      const difyConsoleUrl = await resolveDifyConsoleForCloud(cloud, res);
      if (!difyConsoleUrl) return;

      res.json({
        adminEmail: getDifyAdminEmailHint() || 'admin@dify.ai',
        adminLoginConfigured: isDifyAdminLoginConfigured(),
        signinPath: '/signin',
        difyConsoleUrl,
      });
    } catch (error: unknown) {
      log.error('embed-config failed', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: error instanceof Error ? error.message : '读取配置失败' });
    }
  });

  router.post('/:id/xinference/dify/admin-login', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchEdgePoolOr404(req.params.id, res);
      if (!cloud) return;
      const difyConsoleUrl = await resolveDifyConsoleForCloud(cloud, res);
      if (!difyConsoleUrl) return;

      const upstream = normalizeDifyConsoleUrl(difyConsoleUrl);
      const result = await loginDifyAdminSession(cloud.id, upstream);
      if (!result.ok) {
        res.status(result.message?.includes('未配置') ? 503 : 401).json({
          message: result.message || '管理员登录失败',
        });
        return;
      }
      res.json({ ok: true, message: '已使用管理员账号建立 Dify 会话' });
    } catch (error: unknown) {
      log.error('admin-login failed', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: error instanceof Error ? error.message : '管理员登录失败' });
    }
  });

  router.post(
    '/:id/xinference/dify/admin-logout',
    perm,
    async (req: AuthRequest, res: Response) => {
      const cloud = await fetchEdgePoolOr404(req.params.id, res);
      if (!cloud) return;
      clearDifyAdminSession(cloud.id);
      res.json({ ok: true });
    },
  );
}
