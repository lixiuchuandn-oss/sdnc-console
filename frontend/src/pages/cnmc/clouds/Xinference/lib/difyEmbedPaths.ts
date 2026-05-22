/** 边缘池 Dify 直连 / 嵌入 URL 构造 */

export function buildDifyDirectPageUrl(base: string, pathOrRoute: string): string {
  const origin = base.replace(/\/+$/, '');
  const raw = pathOrRoute.startsWith('/') ? pathOrRoute.slice(1) : pathOrRoute;
  return new URL(raw, `${origin}/`).href;
}

/** iframe 内嵌：对面约定加 ?embed=1（如 /apps?embed=1） */
export function buildDifyIframePageUrl(base: string, path: string): string {
  const url = new URL(buildDifyDirectPageUrl(base, path));
  url.searchParams.set('embed', '1');
  return url.toString();
}

export function xinferenceDifyEmbedBase(poolId: string): string {
  return `/api/clouds/${encodeURIComponent(poolId)}/xinference/dify/embed`;
}

export function xinferenceDifyEmbedPath(poolId: string, subPath: string): string {
  const base = xinferenceDifyEmbedBase(poolId);
  const p = subPath.startsWith('/') ? subPath : `/${subPath}`;
  return `${base}${p}`;
}

/** 将后端返回的绝对 SSO URL 转为与 Tower 页面同源的相对路径 */
export function toTowerPageEmbedPath(absoluteOrRelative: string): string {
  const raw = absoluteOrRelative.trim();
  if (!raw) return raw;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`;
  }
}
