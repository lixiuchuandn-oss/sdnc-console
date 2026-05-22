import type { XinferenceModelRegistration } from '../../../../../services/xinferenceApi';
import { modelNameHasAnyCache } from './modelCacheUtils';

/** 运行状态与本地缓存分列，可组合筛选 */
export type GalleryFilterState = {
  keyword: string;
  /** 是否在运行模型列表中 */
  runtime: 'all' | 'running' | 'idle';
  /** 集群 cache 是否已有权重 */
  cache: 'all' | 'cached' | 'uncached';
  ability: string | null;
};

export const DEFAULT_GALLERY_FILTER: GalleryFilterState = {
  keyword: '',
  runtime: 'all',
  cache: 'all',
  ability: null,
};

export type GalleryFilterCounts = {
  total: number;
  running: number;
  idle: number;
  cached: number;
  uncached: number;
};

export function countGalleryFilterDimensions(
  items: XinferenceModelRegistration[],
  runningNames: Set<string>,
  cachedVersions: string[],
): GalleryFilterCounts {
  let running = 0;
  let cached = 0;
  for (const item of items) {
    if (runningNames.has(item.modelName)) running += 1;
    if (modelNameHasAnyCache(item.modelName, cachedVersions)) cached += 1;
  }
  const total = items.length;
  return {
    total,
    running,
    idle: total - running,
    cached,
    uncached: total - cached,
  };
}

export function filterGalleryRegistrations(
  items: XinferenceModelRegistration[],
  runningNames: Set<string>,
  filter: GalleryFilterState,
  cachedVersions: string[] = [],
): XinferenceModelRegistration[] {
  const kw = filter.keyword.trim().toLowerCase();
  return items.filter((item) => {
    const isRunning = runningNames.has(item.modelName);
    if (filter.runtime === 'running' && !isRunning) return false;
    if (filter.runtime === 'idle' && isRunning) return false;

    const isCached = modelNameHasAnyCache(item.modelName, cachedVersions);
    if (filter.cache === 'cached' && !isCached) return false;
    if (filter.cache === 'uncached' && isCached) return false;

    if (filter.ability && !item.abilities.includes(filter.ability)) return false;

    if (!kw) return true;
    const hay = `${item.modelName} ${item.description ?? ''} ${item.abilities.join(' ')}`.toLowerCase();
    return hay.includes(kw);
  });
}

export function hasActiveGalleryFilter(filter: GalleryFilterState): boolean {
  return (
    filter.keyword.trim() !== '' ||
    filter.runtime !== 'all' ||
    filter.cache !== 'all' ||
    filter.ability != null
  );
}

export function galleryFilterEmptyDescription(
  filter: GalleryFilterState,
  modelTypeLabelText: string,
): string {
  if (filter.keyword.trim()) return '无匹配搜索条件的模型，请调整关键词或重置筛选';
  if (filter.runtime === 'running' && filter.cache === 'cached') {
    return '暂无「运行中且已缓存」的模型';
  }
  if (filter.runtime === 'running') return '当前类型下没有运行中的模型';
  if (filter.runtime === 'idle' && filter.cache === 'cached') {
    return '暂无「未运行但已缓存」的模型，可筛选「已缓存」后一键启动';
  }
  if (filter.cache === 'cached') {
    return `暂无已缓存的${modelTypeLabelText}，启动并完成下载后会出现在此筛选`;
  }
  if (filter.cache === 'uncached') {
    return '当前 Tab 下模型均在集群缓存中，或未拉取到 cache 列表';
  }
  if (filter.ability) return `没有具备「${filter.ability}」能力的模型`;
  return `暂无${modelTypeLabelText}，可点击「更新」同步注册表`;
}

export function runtimeSegmentOptions(counts: GalleryFilterCounts) {
  return [
    { label: `全部 ${counts.total}`, value: 'all' as const },
    { label: `运行中 ${counts.running}`, value: 'running' as const },
    { label: `未运行 ${counts.idle}`, value: 'idle' as const },
  ];
}

export function cacheSegmentOptions(counts: GalleryFilterCounts, cacheKnown: boolean) {
  if (!cacheKnown) {
    return [
      { label: '全部', value: 'all' as const, disabled: false },
      { label: '已缓存', value: 'cached' as const, disabled: true },
      { label: '未缓存', value: 'uncached' as const, disabled: true },
    ];
  }
  return [
    { label: `全部 ${counts.total}`, value: 'all' as const },
    { label: `已缓存 ${counts.cached}`, value: 'cached' as const },
    { label: `未缓存 ${counts.uncached}`, value: 'uncached' as const },
  ];
}
