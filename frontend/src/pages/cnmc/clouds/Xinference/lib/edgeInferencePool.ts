/** 边缘推理池：XI + 同机 Dify + Grafana，与后端 edgeInferencePool.ts 约定一致 */

export const EDGE_DIFY_DEFAULT_PORT = 80;

export function deriveDifyConsoleUrlFromXiEndpoint(
  xiEndpoint: string,
  opts?: { difyPort?: number; pathPrefix?: string },
): string | null {
  const raw = xiEndpoint.trim();
  if (!raw) return null;
  try {
    const xi = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    const port = opts?.difyPort ?? EDGE_DIFY_DEFAULT_PORT;
    const hostPart =
      (xi.protocol === 'https:' && port === 443) || (xi.protocol === 'http:' && port === 80)
        ? xi.host
        : `${xi.hostname}:${port}`;
    const prefix = (opts?.pathPrefix || '').replace(/\/+$/, '').replace(/^\//, '');
    const root = `${xi.protocol}//${hostPart}`;
    return prefix ? `${root}/${prefix}` : root;
  } catch {
    return null;
  }
}
