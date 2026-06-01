import { Router, Response, type RequestHandler } from 'express';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import {
  buildTowerDifyCallbackUrl,
  signTowerDifySsoToken,
} from '../../services/clouds/dify/towerSsoToken';
import {
  buildDifyEmbedProxyPrefix,
  getTowerPublicOrigin,
  resolveDifyConsoleForCloud,
} from '../../services/clouds/dify/difyPoolConsole';

const log = logger.child('EdgeDifySso');

async function fetchEdgePoolOr404(id: string, res: Response): Promise<Cloud | null> {
  const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'xinference') {
    res.status(400).json({ message: '仅边缘推理资源池支持打开 Dify' });
    return null;
  }
  return cloud;
}

function resolveReturnUrl(raw: unknown): string | undefined {
  if (raw == null || !String(raw).trim()) return undefined;
  const path = String(raw).trim();
  if (!path.startsWith('/') || path.includes('://')) return undefined;
  return path;
}

/**
 * GET /api/clouds/:id/xinference/dify/sso-redirect
 * 边缘推理池：Dify 与 Xinference 同机部署，控制台地址由 XI endpoint 推导（可选 ui_config 覆盖）。
 */
export function attachDifySsoRoutes(router: Router, perm: RequestHandler): void {
  router.get('/:id/xinference/dify/sso-redirect', perm, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user?.id || !user.email) {
        res.status(401).json({ message: '未登录或用户信息不完整' });
        return;
      }

      const cloud = await fetchEdgePoolOr404(req.params.id, res);
      if (!cloud) return;

      const difyConsoleUrl = await resolveDifyConsoleForCloud(cloud, res);
      if (!difyConsoleUrl) return;

      const secret = process.env.DIFY_SSO_JWT_SECRET?.trim();
      if (!secret) {
        res.status(500).json({
          message: '未配置边缘池 SSO 密钥',
          hint: '在 Tower backend/.env 设置 DIFY_SSO_JWT_SECRET，与 Dify TOWER_JWT_SECRET 相同；修改后重启后端',
        });
        return;
      }

      const iss = process.env.DIFY_SSO_JWT_ISSUER?.trim();
      const aud = process.env.DIFY_SSO_JWT_AUDIENCE?.trim();
      const token = signTowerDifySsoToken(
        {
          sub: String(user.id),
          email: String(user.email).trim(),
          ...(iss ? { iss } : {}),
          ...(aud ? { aud } : {}),
        },
        secret,
        Number(process.env.DIFY_SSO_JWT_EXPIRES_SEC || 300) || 300,
      );

      const returnUrl = resolveReturnUrl(req.query.return_url);
      const embedPrefix = buildDifyEmbedProxyPrefix(req, cloud.id);
      const url = buildTowerDifyCallbackUrl(embedPrefix, token, returnUrl);

      res.json({
        url,
        embedBaseUrl: embedPrefix,
        embedMode: true,
        expiresIn: Number(process.env.DIFY_SSO_JWT_EXPIRES_SEC || 300) || 300,
        difyConsoleUrl,
        towerOrigin: getTowerPublicOrigin(req),
        edgeBundle: true,
      });
    } catch (error: unknown) {
      log.error(
        'edge dify sso-redirect failed',
        error instanceof Error ? error.message : String(error),
      );
      res.status(500).json({
        message: error instanceof Error ? error.message : '生成 Dify 跳转链接失败',
      });
    }
  });
}
