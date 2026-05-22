import type { Response } from 'express';
import type { Cloud } from '../../../entities/Cloud';
import {
  getEdgePoolXiEndpoint,
  resolveEdgeDifyConsoleUrl,
} from '../xinference/edgeInferencePool';
import { getXinferenceContext, xinferenceGet } from '../xinference/xinferenceClient';

export function getTowerPublicOrigin(req: {
  protocol?: string;
  get(name: string): string | undefined;
  headers: Record<string, string | string[] | undefined>;
}): string {
  const fromEnv = process.env.TOWER_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const originHdr = req.headers.origin;
  if (typeof originHdr === 'string' && originHdr.trim()) {
    return originHdr.trim().replace(/\/+$/, '');
  }

  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.trim()) {
    try {
      return new URL(referer).origin;
    } catch {
      /* ignore */
    }
  }

  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

export function buildDifyEmbedProxyPrefix(
  req: Parameters<typeof getTowerPublicOrigin>[0],
  poolId: string,
): string {
  return `${getTowerPublicOrigin(req)}/api/clouds/${encodeURIComponent(poolId)}/xinference/dify/embed`;
}

export async function resolveDifyConsoleForCloud(
  cloud: Cloud,
  res?: Response,
): Promise<string | null> {
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'xinference') {
    res?.status(400).json({ message: '仅边缘推理资源池支持 Dify' });
    return null;
  }

  const xiEndpoint = getEdgePoolXiEndpoint(cloud);
  if (!xiEndpoint) {
    res?.status(400).json({
      message: '边缘推理池未配置 Xinference 服务地址',
      hint: '请填写资源池服务地址（Supervisor，默认 :9997）',
    });
    return null;
  }

  const cfg = (cloud.config && typeof cloud.config === 'object' ? cloud.config : {}) as Record<
    string,
    unknown
  >;

  let uiRaw: Record<string, unknown> = {};
  const ctx = getXinferenceContext(cloud);
  if (ctx) {
    const r = await xinferenceGet(ctx, '/v1/cluster/ui_config');
    if (r.ok && r.data && typeof r.data === 'object') {
      uiRaw = r.data as Record<string, unknown>;
    }
  }

  try {
    return resolveEdgeDifyConsoleUrl(xiEndpoint, cfg, uiRaw);
  } catch (e: unknown) {
    res?.status(400).json({
      message: e instanceof Error ? e.message : '无法解析同机 Dify 地址',
    });
    return null;
  }
}
