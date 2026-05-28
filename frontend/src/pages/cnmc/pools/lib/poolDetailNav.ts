import type { NavigateFunction } from 'react-router-dom';

/** 资源池 `/admin/clouds/vendor/{slug}/:id` 段（不含 Cloudmap 嵌套）。 */
export type PoolVendorSlug = 'aliyun' | 'csm' | 'huawei' | 'rancher' | 'xinference' | 'maas';

export type PoolRouteKind =
  | { kind: 'cloudmap'; variant: 'edge' | 'private' }
  | { kind: 'cloudmap-csm' }
  | { kind: 'unknown' }
  | { kind: 'vendor'; slug: PoolVendorSlug };

export function inferPoolRouteKind(cloud: {
  config?: { provider?: string };
  type?: string;
}): PoolRouteKind {
  const raw = String(cloud?.config?.provider || cloud?.type || '').toLowerCase().trim();
  if (raw.includes('huawei')) return { kind: 'vendor', slug: 'huawei' };
  if (raw.includes('aliyun')) return { kind: 'vendor', slug: 'aliyun' };
  if (raw === 'cloudmap.csm') return { kind: 'cloudmap-csm' };
  if (raw === 'cloudmap.edge') return { kind: 'cloudmap', variant: 'edge' };
  if (raw === 'cloudmap.private') return { kind: 'cloudmap', variant: 'private' };
  if (raw === 'rancher') return { kind: 'vendor', slug: 'rancher' };
  if (raw === 'xinference') return { kind: 'vendor', slug: 'xinference' };
  if (raw === 'maas') return { kind: 'vendor', slug: 'maas' };
  const t = String(cloud?.type ?? '').toLowerCase().trim();
  if (t === 'bare_metal') return { kind: 'vendor', slug: 'maas' };
  return { kind: 'unknown' };
}

export function stripPoolPathTrailingSlash(p: string): string {
  return p.replace(/\/+$/, '') || '/';
}

/** `buildPoolEntryPath` 的路径部分（不含 `?` 查询），用于与 `location.pathname` 比较。 */
export function poolEntryPathname(cloudOrPath: Record<string, any> | string): string {
  const full =
    typeof cloudOrPath === 'string' ? cloudOrPath : buildPoolEntryPath(cloudOrPath);
  const q = full.indexOf('?');
  return q >= 0 ? full.slice(0, q) : full;
}

/** 列表/仪表盘进入详情时的规范路径（Cloudmap 仍为 `/admin/clouds/:id` 根 + 子路径）。 */
export function buildPoolEntryPath(cloud: Record<string, any>): string {
  const rawId = String(cloud?.id ?? '');
  const id = encodeURIComponent(rawId);
  const k = inferPoolRouteKind(cloud);
  if (k.kind === 'vendor') {
    if (k.slug === 'xinference') {
      return `/admin/clouds/vendor/xinference/${id}?tab=dashboard`;
    }
    if (k.slug === 'maas') {
      return `/admin/clouds/vendor/maas/${id}?tab=dashboard`;
    }
    return `/admin/clouds/vendor/${k.slug}/${id}`;
  }
  if (k.kind === 'cloudmap-csm') return `/admin/security/traffic/csm-pools/${id}`;
  if (k.kind === 'cloudmap') return `/admin/clouds/${id}`;
  return `/admin/clouds/${id}`;
}

/** 与 `GET /api/clouds/:id` 单行结果对齐的视图行 */
export type PoolDetailCloudRow = {
  config?: any;
  description?: string;
  endpoint?: string;
  id: string;
  name: string;
  region: string;
  status?: string;
  type: string;
  createdAt?: string;
  updatedAt?: string;
};

export function mapFetchedCloudToPoolRow(c: Record<string, any>): PoolDetailCloudRow {
  return {
    id: c.id,
    name: c.name,
    region: c.region ?? '',
    type: c.type,
    config: c.config,
    status: c.status,
    endpoint: c.endpoint,
    description: c.description,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** 从列表/仪表盘进入详情：只换 URL，详情页统一用路径里的 id 调接口。 */
export function navigateToPoolDetail(navigate: NavigateFunction, cloud: Record<string, any>): void {
  navigate(buildPoolEntryPath(cloud));
}
