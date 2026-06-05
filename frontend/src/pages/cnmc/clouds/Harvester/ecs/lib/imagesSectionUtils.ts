import { getOsKeywordGroups } from 'components/OsIcon';
import {
  isImagePublicByScenario,
  isSystemNamespace,
  resolveVmImageKind,
} from 'utils/harvesterUtils';
import { isClusterVmImageImportComplete, resolveImageListStateKey } from './vmImageStatus';
import { IMAGE_LIST_STATE_LABEL_ZH } from './imagesSectionConstants';

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

/**
 * 同步到 Ceph 等场景下，集群 status.size 常为 PVC/虚拟盘容量，而非 qcow2 稀疏文件体积。
 */
export function clusterReportedSizeLooksLikeVirtualCapacity(
  reportedBytes: number | undefined,
  virtualBytes: number | undefined,
  fileBytesHint?: number,
): boolean {
  if (reportedBytes == null || !Number.isFinite(reportedBytes) || reportedBytes <= 0) {
    return false;
  }
  if (virtualBytes != null && virtualBytes > 0 && reportedBytes >= virtualBytes * 0.9) {
    return true;
  }
  if (
    fileBytesHint != null &&
    fileBytesHint > 0 &&
    reportedBytes > fileBytesHint * 1.5
  ) {
    return true;
  }
  return false;
}

/** 解析 K8s quantity / 数字为字节（与后端 vmImageClusterApi 一致） */
export function parseKubernetesQuantityToBytes(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  const s = String(raw).trim();
  if (!s) return undefined;
  const plain = Number(s);
  if (Number.isFinite(plain) && plain > 0) return plain;
  const m = /^([\d.]+)\s*([KMGTPE]i?)?$/i.exec(s.replace(/\s+/g, ''));
  if (!m) return undefined;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = (m[2] || '').toLowerCase();
  const binary: Record<string, number> = {
    '': 1,
    k: 1e3,
    ki: 1024,
    m: 1e6,
    mi: 1024 ** 2,
    g: 1e9,
    gi: 1024 ** 3,
    t: 1e12,
    ti: 1024 ** 4,
    p: 1e15,
    pi: 1024 ** 5,
    e: 1e18,
    ei: 1024 ** 6,
  };
  const mult = binary[unit];
  if (mult == null) return undefined;
  const bytes = Math.round(amount * mult);
  return bytes > 0 ? bytes : undefined;
}

/** 镜像虚拟容量：优先顶层/status.virtualSize（qcow2 逻辑盘大小），ISO 可回退实际文件大小 */
export function getImageVirtualSizeBytes(r: ImageListRecord): number | undefined {
  const status = r?.status as Record<string, unknown> | undefined;
  const spec = r?.spec as Record<string, unknown> | undefined;
  for (const raw of [
    r?.virtualSize,
    status?.virtualSize,
    status?.virtualsize,
    spec?.virtualSize,
  ]) {
    const parsed = parseKubernetesQuantityToBytes(raw);
    if (parsed != null) return parsed;
  }
  if (resolveVmImageKind(r) === 'iso') {
    return getImageActualFileBytes(r);
  }
  return undefined;
}

/** 列表「虚拟大小」列：仅 Harvester 已就绪且进度 100% 后展示 */
export function getImageListDisplayVirtualSizeBytes(r: ImageListRecord): number | undefined {
  if (resolveImageListStateKey(r) !== 'ready') return undefined;
  if (!isClusterVmImageImportComplete(r)) return undefined;
  return getImageVirtualSizeBytes(r);
}

/** Harvester 镜像专用存储类：优先 status，其次由 image-xxx 推导 longhorn-image-xxx */
export function getImageStorageClassName(r: ImageListRecord): string {
  const status = r?.status as Record<string, unknown> | undefined;
  const spec = r?.spec as Record<string, unknown> | undefined;
  const meta = r?.metadata as Record<string, unknown> | undefined;
  const ann = (meta?.annotations || {}) as Record<string, string>;
  const name = getImageRowId(r);

  const statusSc = String(status?.storageClassName || '').trim();
  if (statusSc) return statusSc;

  const derived = (() => {
    const m = /^image-([a-z0-9]+)$/i.exec(name);
    return m?.[1] ? `longhorn-image-${m[1]}` : '';
  })();
  if (derived) return derived;

  for (const candidate of [
    String(r?.storageClassName || '').trim(),
    String(spec?.storageClassName || spec?.targetStorageClassName || '').trim(),
    String(ann['harvesterhci.io/storageClassName'] || '').trim(),
  ]) {
    if (candidate.startsWith('longhorn-image-')) return candidate;
  }

  const specSc = String(spec?.storageClassName || spec?.targetStorageClassName || '').trim();
  if (specSc && specSc !== 'longhorn') return specSc;
  const topSc = String(r?.storageClassName || '').trim();
  if (topSc && topSc !== 'longhorn') return topSc;
  const annSc = String(ann['harvesterhci.io/storageClassName'] || '').trim();
  if (annSc && annSc !== 'longhorn') return annSc;
  return derived || annSc || topSc || specSc;
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
  return IMAGE_LIST_STATE_LABEL_ZH[k] || (s || '-');
}

export function getImageStatusText(stateKey: string, sourceType?: string): string {
  const k = String(stateKey || '').toLowerCase();
  const st = String(sourceType || '').toLowerCase();

  if (k === 'downloading' || k === 'importing') {
    if (st === 'download') return '下载中';
    if (st === 'export-from-volume') return '从磁盘导出中';
    if (st === 'upload') return '上传中';
  }

  return IMAGE_LIST_STATE_LABEL_ZH[k] || stateKey || '-';
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
