import { getOsKeywordGroups } from 'components/OsIcon';
import {
  isImagePublicByScenario,
  isSystemNamespace,
  resolveVmImageKind,
} from 'utils/harvesterUtils';
import { resolveImageListStateKey } from './vmImageStatus';

/** 列表行：Harvester 镜像 API 原始对象或 Tower 标准化包装 */
export type ImageListRecord = Record<string, unknown>;

export type ImageListFilters = {
  keyword: string;
  statusFilter: string;
  typeFilter: string;
  osFilter: string;
  scopeFilter: string;
};

/**
 * Harvester 镜像底层文件占用：status.size / spec.size / 导入中 downloadedBytes；
 * Tower 列表还会在顶层镜像对象上回填 `size`。
 */
export function getImageActualFileBytes(r: ImageListRecord): number | undefined {
  const status = r?.status as Record<string, unknown> | undefined;
  const spec = r?.spec as Record<string, unknown> | undefined;
  const raw = status?.size ?? spec?.size ?? status?.downloadedBytes;
  let n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  const topSize = r?.size;
  n =
    typeof topSize === 'number'
      ? topSize
      : typeof topSize === 'string'
        ? Number(topSize)
        : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return undefined;
}

export function getImageRowId(r: ImageListRecord): string {
  const meta = r?.metadata as Record<string, unknown> | undefined;
  return String(r?.name || meta?.name || '');
}

export function getImageRowNamespace(r: ImageListRecord): string {
  const meta = r?.metadata as Record<string, unknown> | undefined;
  return String(r?.namespace || meta?.namespace || 'default');
}

export function getImageDisplayAlias(r: ImageListRecord): string {
  const meta = r?.metadata as Record<string, unknown> | undefined;
  const labels = (meta?.labels || {}) as Record<string, string>;
  const spec = r?.spec as Record<string, unknown> | undefined;
  return String(
    r?.displayName || spec?.displayName || labels['harvesterhci.io/imageDisplayName'] || '',
  ).trim();
}

export function formatImageSizeGb(bytes?: number | string): string {
  const n = typeof bytes === 'number' ? bytes : typeof bytes === 'string' ? Number(bytes) : NaN;
  if (!Number.isFinite(n) || n <= 0) return '-';
  const gb = n / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)}GB`;
}

export function getImageCreatedMs(r: ImageListRecord): number {
  const meta = r?.metadata as Record<string, unknown> | undefined;
  const t = meta?.creationTimestamp || r?.createdAt;
  const ms = t ? new Date(String(t)).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

export function imageStatusLabelZh(s?: string): string {
  const k = String(s || '').toLowerCase();
  const m: Record<string, string> = {
    imported: '已导入',
    pending: '等待',
    downloading: '下载中',
    uploading: '上传中',
    importing: '导入中',
    exporting: '导出中',
    ready: '就绪',
    failed: '失败',
    cancelled: '已取消',
    unknown: '未知',
  };
  return m[k] || (s || '-');
}

export function getImageStatusText(stateKey: string, sourceType?: string): string {
  const k = String(stateKey || '').toLowerCase();
  const st = String(sourceType || '').toLowerCase();

  if (k === 'downloading' || k === 'importing') {
    if (st === 'download') return '下载中';
    if (st === 'export-from-volume') return '从磁盘导出中';
    if (st === 'upload') return '上传中';
  }

  const m: Record<string, string> = {
    imported: '已导入',
    pending: '等待',
    downloading: '下载中',
    uploading: '上传中',
    importing: '导入中',
    exporting: '导出中',
    ready: '就绪',
    failed: '失败',
    cancelled: '已取消',
    unknown: '未知',
  };
  return m[k] || stateKey || '-';
}

export function expandImageOsFilterKeywords(val: string): string[] {
  const v = (val || '').toLowerCase();
  const groups = getOsKeywordGroups();
  const g = groups.find((gr: string[]) => gr.includes(v));
  return g ? g : v ? [v] : [];
}

export function filterAndSortImages(
  base: readonly ImageListRecord[],
  filters: ImageListFilters,
  opts: { isTenant: boolean },
): ImageListRecord[] {
  const { keyword, statusFilter, typeFilter, osFilter, scopeFilter } = filters;
  const hasFilters =
    keyword.trim() ||
    statusFilter ||
    typeFilter ||
    osFilter ||
    (!opts.isTenant ? scopeFilter : '');

  let list: ImageListRecord[];
  if (!hasFilters && !opts.isTenant) {
    list = [...base];
  } else {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    const osKey = osFilter.trim().toLowerCase();
    list = base.filter((r) => {
      const ns = getImageRowNamespace(r);

      if (opts.isTenant) {
        if (isSystemNamespace(ns) && !isImagePublicByScenario(r)) return false;
      }

      if (!opts.isTenant && scopeFilter === 'public' && !isImagePublicByScenario(r)) return false;
      if (!opts.isTenant && scopeFilter === 'private') {
        if (isImagePublicByScenario(r) || isSystemNamespace(ns)) return false;
      }

      if (kw) {
        const meta = r?.metadata as Record<string, unknown> | undefined;
        const labels = (meta?.labels || {}) as Record<string, string>;
        const spec = r?.spec as Record<string, unknown> | undefined;
        const displayName = String(
          r?.displayName || spec?.displayName || labels['harvesterhci.io/imageDisplayName'] || '',
        ).toLowerCase();
        const imageName = String(r?.name || meta?.name || '').toLowerCase();
        const namespace = ns.toLowerCase();
        if (!displayName.includes(kw) && !imageName.includes(kw) && !namespace.includes(kw)) {
          return false;
        }
      }

      if (st && resolveImageListStateKey(r) !== st) return false;

      if (typeFilter && resolveVmImageKind(r) !== typeFilter) return false;

      if (osKey) {
        const meta = r?.metadata as Record<string, unknown> | undefined;
        const labels = (meta?.labels || {}) as Record<string, string>;
        const osLabel = String(labels['harvesterhci.io/os'] || '').toLowerCase();
        const iconName = String(
          labels['harvesterhci.io/imageDisplayName'] || meta?.name || r?.name || '',
        ).toLowerCase();
        const keys = expandImageOsFilterKeywords(osKey);
        if (!keys.some((k) => osLabel.includes(k) || iconName.includes(k))) return false;
      }
      return true;
    });
  }

  return [...list].sort((a, b) => getImageCreatedMs(b) - getImageCreatedMs(a));
}
