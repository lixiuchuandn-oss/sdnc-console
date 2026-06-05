import type { Request } from 'express';

/**
 * `/clouds` 无前缀兼容挂载会与前端 React 路由冲突（如 Harvester VNC 页）。
 * 对浏览器文档级 GET/HEAD 命中下列路径时，应跳过 clouds API 鉴权与路由，交由 SPA index.html 回退。
 */
const CLOUDS_SPA_DOCUMENT_PATH =
  /^\/[^/]+\/(?:harvester\/vnc|instances\/create)(?:\/|$)/;

export function isCloudsSpaDocumentRequest(req: Request): boolean {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const raw = (req.path || req.url || '').split('?')[0].replace(/\/+$/, '') || '/';
  return CLOUDS_SPA_DOCUMENT_PATH.test(raw);
}
