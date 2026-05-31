import { Router, type NextFunction, type Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import type { AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import {
  getTowerPublicOrigin,
  resolveDifyConsoleForCloud,
} from '../../services/clouds/dify/difyPoolConsole';
import { normalizeDifyConsoleUrl } from '../../services/clouds/dify/towerSsoToken';
import { getDifyAdminCookieHeader } from '../../services/clouds/dify/difyAdminSession';

const log = logger.child('DifyEmbedProxy');

async function fetchXinferenceCloudOr404(id: string, res: Response): Promise<Cloud | null> {
  const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
}

function embedProxyPrefix(poolId: string): string {
  return `/api/clouds/${encodeURIComponent(poolId)}/xinference/dify/embed`;
}

function upstreamPathFromRequest(req: AuthRequest, poolId: string): string {
  const prefix = embedProxyPrefix(poolId);
  const raw = req.originalUrl || req.url || '/';
  const qIdx = raw.indexOf('?');
  const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const query = qIdx >= 0 ? raw.slice(qIdx) : '';
  let tail = pathPart.startsWith(prefix) ? pathPart.slice(prefix.length) : pathPart;
  if (!tail || tail === '') tail = '/';
  if (!tail.startsWith('/')) tail = `/${tail}`;
  return `${tail}${query}`;
}

function rewriteLocationHeader(
  location: string,
  upstreamOrigin: string,
  proxyOrigin: string,
  proxyPrefix: string,
): string {
  const trimmed = location.trim();
  if (!trimmed) return location;
  try {
    const resolved = new URL(trimmed, upstreamOrigin);
    const up = new URL(upstreamOrigin);
    if (resolved.origin === up.origin) {
      return `${proxyOrigin}${proxyPrefix}${resolved.pathname}${resolved.search}${resolved.hash}`;
    }
  } catch {
    if (trimmed.startsWith('/')) {
      return `${proxyOrigin}${proxyPrefix}${trimmed}`;
    }
  }
  return location;
}

/**
 * 同源反代 Dify 控制台，使 SSO Cookie 写在 Tower 域下，iframe 内可保持登录态。
 * 挂载在全局 authMiddleware 之前；SSO callback 的 ?token= 为 Dify JWT，不能走 Tower 鉴权。
 */
export function attachDifyEmbedProxyRoutes(router: Router): void {
  router.use('/:id/xinference/dify/embed', (req: AuthRequest, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const poolId = String(req.params.id || '').trim();
        if (!poolId) {
          res.status(400).json({ message: '缺少资源池 id' });
          return;
        }

        const cloud = await fetchXinferenceCloudOr404(poolId, res);
        if (!cloud) return;

        const difyConsoleUrl = await resolveDifyConsoleForCloud(cloud, res);
        if (!difyConsoleUrl) return;

        const upstreamOrigin = normalizeDifyConsoleUrl(difyConsoleUrl);
        const prefix = embedProxyPrefix(poolId);
        const proxyOrigin = getTowerPublicOrigin(req);

        const proxy = createProxyMiddleware({
          target: upstreamOrigin,
          changeOrigin: true,
          ws: true,
          pathRewrite: () => upstreamPathFromRequest(req, poolId),
          cookieDomainRewrite: '',
          cookiePathRewrite: { '*': prefix },
          on: {
            proxyReq(proxyReq) {
              const injected = getDifyAdminCookieHeader(poolId);
              if (!injected) return;
              const existing = proxyReq.getHeader('cookie');
              const merged =
                existing != null && String(existing).trim()
                  ? `${String(existing)}; ${injected}`
                  : injected;
              proxyReq.setHeader('cookie', merged);
            },
            proxyRes(proxyRes) {
              delete proxyRes.headers['x-frame-options'];
              delete proxyRes.headers['content-security-policy'];
              const loc = proxyRes.headers['location'];
              if (loc != null) {
                const raw = Array.isArray(loc) ? loc[0] : loc;
                if (typeof raw === 'string') {
                  proxyRes.headers['location'] = rewriteLocationHeader(
                    raw,
                    upstreamOrigin,
                    proxyOrigin,
                    prefix,
                  );
                }
              }
            },
            error(err, _req, proxyRes) {
              log.error('dify embed proxy error', err instanceof Error ? err.message : String(err));
              const out = proxyRes as Response;
              if (typeof out.headersSent === 'boolean' && !out.headersSent) {
                out.status(502).json({ message: 'Dify 控制台代理失败' });
              }
            },
          },
        });

        proxy(req, res, next);
      } catch (error: unknown) {
        log.error('dify embed proxy setup failed', error instanceof Error ? error.message : String(error));
        if (!res.headersSent) {
          res.status(500).json({ message: error instanceof Error ? error.message : 'Dify 代理初始化失败' });
        }
      }
    })();
  });
}
