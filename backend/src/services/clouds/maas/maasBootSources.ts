import type { MaasHttpContext } from './maasClient';
import { extractMaasList, maasGetV2, maasRequest } from './maasClient';

export type MaasBootSourceSelection = {
  id: number | string;
  os: string;
  release: string;
  arches: string[];
  subarches: string[];
  labels: string[];
};

export type MaasBootSource = {
  id: number | string;
  url: string;
  keyring_filename: string;
  selections: MaasBootSourceSelection[];
};

function toStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (v == null || v === '') return [];
  return [String(v)];
}

function normalizeSelection(raw: Record<string, unknown>): MaasBootSourceSelection {
  return {
    id: (raw.id ?? '') as number | string,
    os: String(raw.os ?? ''),
    release: String(raw.release ?? ''),
    arches: toStrArray(raw.arches),
    subarches: toStrArray(raw.subarches),
    labels: toStrArray(raw.labels),
  };
}

async function listSelections(
  ctx: MaasHttpContext,
  sourceId: string | number,
): Promise<MaasBootSourceSelection[]> {
  const res = await maasGetV2(
    ctx,
    `/boot-sources/${encodeURIComponent(String(sourceId))}/selections/`,
    { timeout: 20_000 },
  );
  if (!res.ok) return [];
  return extractMaasList(res.data).map(normalizeSelection);
}

export async function listMaasBootSources(
  ctx: MaasHttpContext,
): Promise<{ ok: boolean; items: MaasBootSource[]; message?: string }> {
  const res = await maasGetV2(ctx, '/boot-sources/', { timeout: 25_000 });
  if (res.status === 401) {
    return { ok: false, items: [], message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (!res.ok) {
    return { ok: false, items: [], message: res.message || '拉取镜像源失败' };
  }
  const sources = extractMaasList(res.data);
  const items = await Promise.all(
    sources.map(async (s) => {
      const id = (s.id ?? '') as string | number;
      const selections =
        id !== '' ? await listSelections(ctx, id) : ([] as MaasBootSourceSelection[]);
      return {
        id,
        url: String(s.url ?? ''),
        keyring_filename: String(s.keyring_filename ?? ''),
        selections,
      };
    }),
  );
  return { ok: true, items };
}

export async function createMaasBootSourceSelection(
  ctx: MaasHttpContext,
  sourceId: string | number,
  params: {
    os: string;
    release: string;
    arches?: string[];
    subarches?: string[];
    labels?: string[];
  },
): Promise<{ ok: boolean; message: string; data?: unknown }> {
  if (!params.os?.trim()) return { ok: false, message: '缺少操作系统（os）' };
  if (!params.release?.trim()) return { ok: false, message: '缺少版本（release）' };
  const form: Record<string, string | string[]> = {
    os: params.os.trim(),
    release: params.release.trim(),
    arches: params.arches?.length ? params.arches : ['*'],
    subarches: params.subarches?.length ? params.subarches : ['*'],
    labels: params.labels?.length ? params.labels : ['*'],
  };
  const res = await maasRequest(
    ctx,
    'POST',
    `/api/2.0/boot-sources/${encodeURIComponent(String(sourceId))}/selections/`,
    { body: form, timeout: 30_000 },
  );
  if (res.status === 401) {
    return { ok: false, message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (!res.ok) {
    return { ok: false, message: res.message || '新增镜像源选择失败' };
  }
  return { ok: true, message: '已新增镜像源选择，下次同步将生效', data: res.data };
}

export async function deleteMaasBootSourceSelection(
  ctx: MaasHttpContext,
  sourceId: string | number,
  selectionId: string | number,
): Promise<{ ok: boolean; message: string }> {
  const res = await maasRequest(
    ctx,
    'DELETE',
    `/api/2.0/boot-sources/${encodeURIComponent(String(sourceId))}/selections/${encodeURIComponent(
      String(selectionId),
    )}/`,
    { timeout: 30_000 },
  );
  if (res.status === 401) {
    return { ok: false, message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (!res.ok) {
    return { ok: false, message: res.message || '删除镜像源选择失败' };
  }
  return { ok: true, message: '已删除镜像源选择' };
}
