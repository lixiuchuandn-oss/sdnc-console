import type { Cloud } from '../../../entities/Cloud';

/** 边缘推理一体机默认：与 XI 同主机，Dify 经 Nginx 对外端口 */
const DEFAULT_DIFY_CONSOLE_PORT = Number(process.env.EDGE_DIFY_CONSOLE_PORT || 80) || 80;

function pickConfigString(cfg: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = cfg[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

/** Xinference Supervisor 地址（边缘池唯一必填接入点） */
export function getEdgePoolXiEndpoint(cloud: Cloud): string | undefined {
  const cfg = (cloud.config && typeof cloud.config === 'object' ? cloud.config : {}) as Record<
    string,
    unknown
  >;
  const raw = String((cloud as { endpoint?: string }).endpoint || cfg.endpoint || '').trim();
  if (!raw) return undefined;
  let base = raw.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  try {
    return new URL(base).href.replace(/\/+$/, '');
  } catch {
    return base;
  }
}

/**
 * 同机 Dify 控制台根地址：与 XI 同 host，默认 80 端口（边缘 Compose / Nginx）。
 * 优先级：ui_config → 池 config 显式覆盖 → 由 XI endpoint 推导。
 */
export function resolveEdgeDifyConsoleUrl(
  xiEndpoint: string,
  cfg: Record<string, unknown> = {},
  uiConfig?: Record<string, unknown>,
): string {
  const fromUi = uiConfig
    ? pickConfigString(uiConfig, 'dify_console_url', 'difyConsoleUrl', 'dify_url')
    : undefined;
  if (fromUi) return normalizeConsoleRoot(fromUi);

  const explicit = pickConfigString(cfg, 'difyConsoleUrl', 'dify_console_url');
  if (explicit) return normalizeConsoleRoot(explicit);

  const xi = new URL(xiEndpoint.includes('://') ? xiEndpoint : `http://${xiEndpoint}`);
  const portRaw = pickConfigString(cfg, 'difyPort', 'dify_port');
  const port = portRaw ? Number(portRaw) : DEFAULT_DIFY_CONSOLE_PORT;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('无效的 difyPort');
  }
  const pathPrefix = (pickConfigString(cfg, 'difyPathPrefix', 'dify_path_prefix') || '')
    .replace(/\/+$/, '')
    .replace(/^\//, '');
  const hostPart =
    (xi.protocol === 'https:' && port === 443) || (xi.protocol === 'http:' && port === 80)
      ? xi.host
      : `${xi.hostname}:${port}`;
  const root = `${xi.protocol}//${hostPart}`;
  return pathPrefix ? `${root}/${pathPrefix}` : root;
}

function normalizeConsoleRoot(raw: string): string {
  const u = raw.trim().replace(/\/+$/, '');
  if (!u) throw new Error('Dify 控制台地址为空');
  const withScheme = /^https?:\/\//i.test(u) ? u : `http://${u}`;
  const parsed = new URL(withScheme);
  return parsed.origin + (parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '');
}
