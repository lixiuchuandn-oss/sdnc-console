import type { PromQueryResult } from '../hooks/usePromQueries';

/** PromQL 结果是否已有可展示的时间序列（轮询时会保留上一轮数据） */
export function promResultHasCachedData(r: PromQueryResult | undefined): boolean {
  if (!r) return false;
  return r.series.some((s) => s.values.length > 0);
}

export function deriveQueryLoadState(r: PromQueryResult | undefined): {
  initialLoading: boolean;
  refreshing: boolean;
} {
  if (!r?.loading) return { initialLoading: false, refreshing: false };
  if (promResultHasCachedData(r)) return { initialLoading: false, refreshing: true };
  return { initialLoading: true, refreshing: false };
}

export function derivePanelLoadState(results: (PromQueryResult | undefined)[]): {
  initialLoading: boolean;
  refreshing: boolean;
} {
  if (results.length === 0) return { initialLoading: true, refreshing: false };
  let initialLoading = false;
  let refreshing = false;
  for (const r of results) {
    const state = deriveQueryLoadState(r);
    if (state.initialLoading) initialLoading = true;
    if (state.refreshing) refreshing = true;
  }
  return { initialLoading, refreshing };
}
