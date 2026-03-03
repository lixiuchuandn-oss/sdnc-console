import http from 'http';
import https from 'https';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { UserSpace } from '../entities/UserSpace';
import { getJsonOnce } from '../services/clouds/harvester/utils';
import { UserRole } from '../entities/User';

function getRequestModule(target: string) {
  try {
    const u = new URL(target);
    return u.protocol === 'http:' ? http : https;
  } catch {
    return https;
  }
}

/**
 * WebSocket 代理：将 Harvester/K8s Pod 日志流（流式推送）转发给前端
 * 与 Harvester UI 一致：使用 Kubernetes Pod 日志 API，follow=true 流式推送
 * 先拉取 sinceSeconds 内的历史日志，再持续推送新日志
 */
export function createKvPodLogWss() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const cloudId = url.searchParams.get('cloudId') || '';
    const namespace = url.searchParams.get('namespace') || '';
    const podName = url.searchParams.get('podName') || '';
    const sinceSeconds = url.searchParams.get('sinceSeconds') || '1800';
    const tailLines = url.searchParams.get('tailLines') || '';
    const container = url.searchParams.get('container') || 'compute';

    let decoded: any = null;
    try {
      if (!token) throw new Error('缺少 token');
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      if (!decoded || !decoded.role) throw new Error('无效令牌');
      // 允许 admin, super_admin 以及 tenant
      const allowedRoles = [UserRole.SUPER_ADMIN, 'admin', 'tenant'];
      if (!allowedRoles.includes(decoded.role)) {
        throw new Error('权限不足');
      }
    } catch (err: any) {
      try {
        ws.close(1011, err?.message || '鉴权失败');
      } catch {}
      return;
    }

    if (!cloudId || !namespace || !podName) {
      try {
        ws.close(1002, '缺少 cloudId、namespace 或 podName');
      } catch {}
      return;
    }

    // 租户权限检查
    try {
      if (decoded.role === 'tenant') {
        const userSpaceRepo = AppDataSource.getRepository(UserSpace);
        const whereClause: any = {
          tenantId: decoded.tenantId,
          cloudId,
          status: 'active',
        };
        if (decoded.organizationId) {
          whereClause.organizationId = decoded.organizationId;
        } else {
          whereClause.organizationId = null;
        }

        const spaces = await userSpaceRepo.find({ where: whereClause });
        const allowedNamespaces = new Set<string>();
        spaces.forEach(s => {
          if (s.namespace) {
            s.namespace.split(',').forEach(ns => allowedNamespaces.add(ns.trim()));
          }
        });

        if (!allowedNamespaces.has(namespace)) {
          throw new Error('无权访问该命名空间');
        }
      }
    } catch (err: any) {
      try {
        ws.close(1011, err?.message || '租户权限校验失败');
      } catch {}
      return;
    }

    try {
      const repo = AppDataSource.getRepository(Cloud);
      const cloud = await repo.findOne({ where: { id: cloudId } });
      if (!cloud) throw new Error('云资源不存在');
      const pv = String((cloud as any)?.config?.provider || '').toLowerCase().trim();
      const allowed = ['harvester', 'cloudmap.private', 'cloudmap.edge'];
      if (!allowed.includes(pv)) throw new Error(`仅支持 Harvester/Cloudmap (current: ${pv})`);
      const insecure = !!(cloud.config as any)?.ignoreTls;
      const base = String(cloud.endpoint || '').replace(/\/+$/, '');
      let origin = base;
      try {
        const u = new URL(base);
        origin = `${u.protocol}//${u.host}`;
      } catch {
        origin = base.replace(/\/v[0-9].*$/, '');
      }

      let clusterId: string | null = null;
      try {
        const clusters = await getJsonOnce(`${origin}/v3/clusters`, cloud.secretKey || '', insecure);
        const items: any[] = Array.isArray(clusters?.data) ? clusters?.data : Array.isArray(clusters?.items) ? clusters?.items : [];
        const local = items.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
        const anyItem = items[0];
        clusterId = String(local?.id || local?.Id || anyItem?.id || anyItem?.Id || '')?.trim() || null;
      } catch {}

      const params = new URLSearchParams({
        container,
        follow: 'true',
        timestamps: 'true',
        pretty: 'true',
        previous: 'false',
      });
      const tailVal = tailLines ? parseInt(tailLines, 10) : 0;
      if (tailVal > 0) {
        params.set('tailLines', String(Math.min(10000, tailVal)));
      } else {
        const sinceVal = Math.max(60, Math.min(86400, parseInt(sinceSeconds, 10) || 1800));
        params.set('sinceSeconds', String(sinceVal));
      }
      const logPath = clusterId
        ? `/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log?${params}`
        : `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log?${params}`;
      const logUrlHttp = `${origin}${logPath}`;

      const rawToken = String(cloud.secretKey || '').trim();
      const authValue = rawToken ? (rawToken.toLowerCase().startsWith('bearer ') ? rawToken : `Bearer ${rawToken}`) : '';

      // K8s Pod 日志 API 使用 HTTP GET + chunked 流式传输（follow=true），非 WebSocket
      // 与 Harvester 1.6 / Rancher 一致：GET /api/v1/namespaces/{ns}/pods/{pod}/log?follow=true&...
      const mod = getRequestModule(logUrlHttp);
      let isClosing = false;

      const logReq = mod.request(
        logUrlHttp,
        {
          method: 'GET',
          headers: {
            Authorization: authValue,
            Accept: 'text/plain, */*',
          },
          rejectUnauthorized: !insecure,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try {
                ws.close(1011, `日志请求失败: ${res.statusCode} ${body.slice(0, 200)}`);
              } catch {}
            });
            return;
          }
          res.on('data', (chunk: Buffer) => {
            try {
              if (ws.readyState === WebSocket.OPEN && chunk?.length) {
                ws.send(chunk.toString('utf8'));
              }
            } catch {
              /* ignore */
            }
          });
          res.on('end', () => {
            try {
              if (ws.readyState === WebSocket.OPEN) ws.close(1000, '日志流结束');
            } catch {}
          });
          res.on('error', (err) => {
            if (isClosing) return;
            try {
              const msg = err?.message || String(err);
              const userMsg = msg.toLowerCase().includes('aborted') ? '远程日志流已中断' : msg;
              ws.close(1011, `流错误: ${userMsg}`);
            } catch {}
          });
        }
      );
      logReq.on('error', (err) => {
        if (isClosing) return;
        try {
          ws.close(1011, `请求失败: ${err?.message || err}`);
        } catch {}
      });
      // follow=true 时连接需长保持，不设短超时
      logReq.setTimeout(0);
      logReq.end();
      
      ws.on('close', () => {
        isClosing = true;
        try {
          logReq.destroy();
        } catch {}
      });
    } catch (err: any) {
      try {
        ws.close(1011, err?.message || '初始化失败');
      } catch {}
    }
  });

  return wss;
}
