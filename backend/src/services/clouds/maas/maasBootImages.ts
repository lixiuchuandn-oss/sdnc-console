import type { MaasHttpContext, MaasHttpResult } from './maasClient';
import { extractMaasList, maasGetV2, maasRequest } from './maasClient';
import {
  groupMaasImageResources,
  isDeployableOsImageListItem,
  type MaasImageGroup,
} from './maasBootImagesGroup';

export type { MaasImageGroup, MaasImageVariant } from './maasBootImagesGroup';
export { formatMaasImageDisplayName, isDeployableOsImageListItem } from './maasBootImagesGroup';

export type MaasImageNormalized = {
  id: number | string;
  name: string;
  title: string;
  os: string;
  release: string;
  osystem: string;
  distro_series: string;
  architecture: string;
  type: 'synced' | 'uploaded' | 'unknown';
  size_bytes: number;
  status: 'ready' | 'downloading' | 'unknown';
  deployable: boolean;
};

function parseNameParts(name: string): { os: string; release: string } {
  const parts = String(name || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { os: parts[0], release: parts[1] };
  }
  return { os: parts[0] || 'unknown', release: 'default' };
}

/** MAAS v2 详情中 `sets` 为版本号 → set 对象；列表接口无 size（见 integrate §13.3.1） */
function setsAsVersionEntries(
  detail: Record<string, unknown>,
): [string, Record<string, unknown>][] {
  const sets = detail.sets;
  if (!sets || typeof sets !== 'object') return [];
  if (Array.isArray(sets)) {
    return sets.map((s, i) => [String(i), s as Record<string, unknown>]);
  }
  return Object.entries(sets as Record<string, Record<string, unknown>>);
}

/** 固定算法：complete 的 set 取版本号最大者的 `size`（字节）；否则取最新 set 的 size */
export function extractSizeBytesFromDetail(detail: Record<string, unknown>): number {
  const entries = setsAsVersionEntries(detail);
  if (!entries.length) return 0;

  const completeSets = entries.filter(([, s]) => s.complete === true);
  const pickFrom = completeSets.length ? completeSets : entries;
  const [, chosen] = pickFrom.reduce((best, cur) => (cur[0] > best[0] ? cur : best));

  const n = Number(chosen?.size ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function resolveImageType(raw: Record<string, unknown>): MaasImageNormalized['type'] {
  const t = String(raw.type ?? '').toLowerCase();
  if (t === 'synced' || t === 'uploaded') return t;
  const rtype = raw.rtype ?? raw.resource_type;
  if (rtype === 0 || rtype === '0' || rtype === 'sync') return 'synced';
  if (rtype === 2 || rtype === '2' || rtype === 'uploaded') return 'uploaded';
  return 'unknown';
}

function resolveImageStatus(detail: Record<string, unknown>): MaasImageNormalized['status'] {
  if (detail.last_deployable === true) return 'ready';
  if (detail.last_deployable === false) return 'downloading';

  const entries = setsAsVersionEntries(detail);
  if (!entries.length) return 'unknown';

  const completeSets = entries.filter(([, s]) => s.complete === true);
  if (completeSets.length) {
    const incomplete = entries.some(([, s]) => s.complete === false);
    return incomplete ? 'downloading' : 'ready';
  }

  const [, latest] = entries.reduce((best, cur) => (cur[0] > best[0] ? cur : best));
  if (latest?.complete === false) return 'downloading';
  return 'unknown';
}

export function normalizeMaasBootResource(
  listItem: Record<string, unknown>,
  detail?: Record<string, unknown> | null,
): MaasImageNormalized {
  const raw = detail ? { ...listItem, ...detail } : listItem;
  const name = String(raw.name ?? listItem.name ?? raw.id ?? '');
  const { os, release } = parseNameParts(name);
  const osystem = String(raw.osystem ?? raw.os ?? os).trim() || os;
  const distro = String(raw.distro_series ?? raw.release ?? release).trim() || release;
  const statusSource = detail || raw;
  const status = resolveImageStatus(statusSource);
  const deployable = status === 'ready' && raw.last_deployable !== false;
  const title =
    String(raw.title ?? '').trim() ||
    (name ? name.replace(/\//g, ' ') : `${osystem} ${distro}`);
  const size_bytes = detail ? extractSizeBytesFromDetail(detail) : 0;

  return {
    id: (listItem.id ?? raw.id ?? name) as number | string,
    name,
    title,
    os: osystem,
    release: distro,
    osystem,
    distro_series: distro,
    architecture: String(raw.architecture ?? listItem.architecture ?? '—'),
    type: resolveImageType(raw),
    size_bytes,
    status,
    deployable,
  };
}

async function fetchMaasBootResourceDetailRaw(
  ctx: MaasHttpContext,
  imageId: string | number,
): Promise<Record<string, unknown> | null> {
  const res = await maasGetV2(ctx, `/boot-resources/${encodeURIComponent(String(imageId))}/`, {
    timeout: 25_000,
  });
  if (!res.ok) return null;
  const data = res.data;
  if (data && typeof data === 'object') {
    return Array.isArray(data)
      ? (data[0] as Record<string, unknown>)
      : (data as Record<string, unknown>);
  }
  return null;
}

async function maasPostV2Op(
  ctx: MaasHttpContext,
  op: string,
  timeout = 60_000,
): Promise<MaasHttpResult> {
  return maasRequest(ctx, 'POST', `/api/2.0/boot-resources/?op=${encodeURIComponent(op)}`, {
    timeout,
  });
}

async function maasDeleteV2Path(
  ctx: MaasHttpContext,
  path: string,
  timeout = 60_000,
): Promise<MaasHttpResult> {
  const apiPath = path.startsWith('/api/2.0')
    ? path
    : `/api/2.0${path.startsWith('/') ? path : `/${path}`}`;
  return maasRequest(ctx, 'DELETE', apiPath, { timeout });
}

export async function listMaasImagesV2(
  ctx: MaasHttpContext,
  opts?: { type?: 'synced' | 'uploaded' },
): Promise<{ ok: boolean; items: MaasImageGroup[]; message?: string }> {
  let path = '/boot-resources/';
  if (opts?.type) {
    path += `?type=${encodeURIComponent(opts.type)}`;
  }
  const res = await maasGetV2(ctx, path, { timeout: 30_000 });
  if (res.status === 401) {
    return { ok: false, items: [], message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (!res.ok) {
    return { ok: false, items: [], message: res.message || '拉取镜像列表失败' };
  }

  const listItems = extractMaasList(res.data).filter(isDeployableOsImageListItem);
  const resources = await Promise.all(
    listItems.map(async (listItem) => {
      const id = listItem.id;
      if (id == null || String(id).trim() === '') {
        return normalizeMaasBootResource(listItem, null);
      }
      const detail = await fetchMaasBootResourceDetailRaw(ctx, id as string | number);
      return normalizeMaasBootResource(listItem, detail);
    }),
  );

  const items = groupMaasImageResources(resources);
  return { ok: true, items };
}

export async function getMaasImageV2(
  ctx: MaasHttpContext,
  imageId: string,
): Promise<{ ok: boolean; item?: MaasImageNormalized; message?: string }> {
  const detail = await fetchMaasBootResourceDetailRaw(ctx, imageId);
  if (!detail) {
    return { ok: false, message: '拉取镜像详情失败' };
  }
  return {
    ok: true,
    item: normalizeMaasBootResource({ id: imageId, ...detail }, detail),
  };
}

export async function deleteMaasImageV2(
  ctx: MaasHttpContext,
  imageId: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await maasDeleteV2Path(
    ctx,
    `/boot-resources/${encodeURIComponent(imageId)}/`,
    60_000,
  );
  if (res.status === 401) {
    return { ok: false, message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (res.status === 409) {
    return { ok: false, message: res.message || '镜像正在使用中，无法删除' };
  }
  if (!res.ok) {
    return { ok: false, message: res.message || '删除镜像失败' };
  }
  return { ok: true, message: '镜像已删除' };
}

export async function startMaasImagesSyncV2(
  ctx: MaasHttpContext,
): Promise<{ ok: boolean; message: string }> {
  const res = await maasPostV2Op(ctx, 'import', 120_000);
  if (res.status === 401) {
    return { ok: false, message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (res.status === 409) {
    return { ok: false, message: res.message || '同步任务已在运行' };
  }
  if (!res.ok) {
    return { ok: false, message: res.message || '启动同步失败' };
  }
  return { ok: true, message: '已开始从官方源同步镜像' };
}

export async function stopMaasImagesSyncV2(
  ctx: MaasHttpContext,
): Promise<{ ok: boolean; message: string }> {
  const res = await maasPostV2Op(ctx, 'stop_import', 30_000);
  if (!res.ok) {
    return { ok: false, message: res.message || '停止同步失败' };
  }
  return { ok: true, message: '已请求停止同步' };
}

export async function getMaasImagesSyncStatusV2(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  is_importing: boolean;
  message?: string;
}> {
  const res = await maasGetV2(ctx, '/boot-resources/?op=is_importing', { timeout: 15_000 });
  if (!res.ok) {
    return { ok: false, is_importing: false, message: res.message || '查询同步状态失败' };
  }
  const d = res.data;
  if (d === true) return { ok: true, is_importing: true };
  if (d === false) return { ok: true, is_importing: false };
  const text = String(d ?? '')
    .trim()
    .toLowerCase();
  return { ok: true, is_importing: text === 'true' };
}
