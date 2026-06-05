/**
 * POST …/images/upload-token — 为 uploader 签发 Kubernetes TokenRequest 短期凭证。
 */
import http from 'http';
import https from 'https';

import { Request, Response } from 'express';
import axios from 'axios';

import { resolveHarvesterOrigin } from './imageUploadTask.reconcile';

/**
 * POST /:id/resources/harvester/images/upload-token
 * 为指定命名空间下的 ServiceAccount 签发短期 Token（Kubernetes TokenRequest）。
 * tools/uploader 直连 Harvester 前向 Tower 申请短期凭证时使用。
 */
export async function harvesterImageUploadTokenHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const {
      namespace: nsRaw,
      serviceAccountName: saRaw,
      expirationSeconds: expRaw,
    } = (req.body || {}) as any;
    const namespace = (String(nsRaw || 'default').trim() || 'default') as string;
    const serviceAccountName = (String(saRaw || 'image-uploader').trim() ||
      'image-uploader') as string;
    let expirationSeconds = Math.floor(Number(expRaw) || 300);
    if (expirationSeconds < 60) expirationSeconds = 60;
    if (expirationSeconds > 600) expirationSeconds = 600;

    const origin = resolveHarvesterOrigin(cloud);

    const tokenBody = {
      apiVersion: 'authentication.k8s.io/v1',
      kind: 'TokenRequest',
      spec: {
        expirationSeconds,
        audiences: ['https://kubernetes.default.svc'],
      },
    };

    const candidates = [
      `${origin}/apis/authentication.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/serviceaccounts/${encodeURIComponent(serviceAccountName)}/token`,
      `${origin}/k8s/clusters/local/apis/authentication.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/serviceaccounts/${encodeURIComponent(serviceAccountName)}/token`,
    ];

    const isHttp = origin.startsWith('http:');
    const httpAgent = new http.Agent({ keepAlive: true });
    const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: !insecure });

    let lastErr: any;
    for (const url of candidates) {
      try {
        const r = await axios.post(url, tokenBody, {
          headers: {
            Authorization: `Bearer ${cloud.secretKey || ''}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
          httpAgent: isHttp ? httpAgent : undefined,
          httpsAgent: !isHttp ? httpsAgent : undefined,
        });
        const token = r.data?.status?.token;
        if (token) {
          const expTs = r.data?.status?.expirationTimestamp;
          return res.json({
            message: 'ok',
            data: {
              namespace,
              serviceAccountName,
              expirationSeconds,
              token,
              expiresAt: expTs || undefined,
            },
          });
        }
        lastErr = new Error('TokenRequest 响应中无 token');
      } catch (e: any) {
        lastErr = e;
      }
    }
    return res.status(502).json({
      message: '签发上传 Token 失败（请确认集群支持 TokenRequest 且 ServiceAccount 存在）',
      error: lastErr?.response?.data
        ? JSON.stringify(lastErr.response.data)
        : lastErr?.message || String(lastErr),
    });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '签发上传 Token 失败', error: error.message });
  }
}
