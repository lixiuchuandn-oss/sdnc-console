/**
 * 监控大盘时间范围 + step：把"显示 5m / 1h / 24h…"统一映射成 Prometheus query_range 的 start/end/step。
 * 与 VmPerformance 思路一致，但选项更丰富（5m–7d），step 由 recommendStep 自动推荐。
 */
import { useCallback, useMemo, useState } from 'react';
import { recommendStep } from '../lib/promql';

export interface DashboardTimeRangeOption {
  label: string;
  /** 范围秒数 */
  value: number;
}

export const OPS_DASHBOARD_TIME_RANGE_OPTIONS: DashboardTimeRangeOption[] = [
  { label: '5m', value: 5 * 60 },
  { label: '15m', value: 15 * 60 },
  { label: '30m', value: 30 * 60 },
  { label: '1h', value: 60 * 60 },
  { label: '3h', value: 3 * 60 * 60 },
  { label: '6h', value: 6 * 60 * 60 },
  { label: '12h', value: 12 * 60 * 60 },
  { label: '24h', value: 24 * 60 * 60 },
  { label: '7d', value: 7 * 24 * 60 * 60 },
];

export const OPS_DASHBOARD_DEFAULT_RANGE_SECONDS = 60 * 60;

export interface ResolvedTimeRange {
  /** Unix 秒 */
  start: number;
  /** Unix 秒 */
  end: number;
  /** step 秒，建议 60–180 个点 */
  step: number;
  /** `$__rate_interval` 替换值（含 `s`） */
  rateInterval: string;
  /** `$__interval` 替换值（含 `s`） */
  intervalStr: string;
  /** 范围秒数 */
  rangeSeconds: number;
}

export function resolveTimeRange(rangeSeconds: number, now: number = Date.now()): ResolvedTimeRange {
  const end = Math.floor(now / 1000);
  const start = end - rangeSeconds;
  const { step, rateInterval, intervalStr } = recommendStep(rangeSeconds);
  return { start, end, step, rateInterval, intervalStr, rangeSeconds };
}

export interface UseDashboardTimeRangeResult {
  rangeSeconds: number;
  setRangeSeconds: (s: number) => void;
  /** 一次"刷新令牌"：每次手动/自动刷新 +1，便于 Section 内 useEffect 监听 */
  reloadToken: number;
  triggerReload: () => void;
  resolved: ResolvedTimeRange;
}

/**
 * 顶层只维护两个状态：rangeSeconds 与 reloadToken。
 * 各 Section 在 useEffect deps 里同时挂这两者，即可同时支持「切范围」与「手动/自动刷新」。
 */
export function useDashboardTimeRange(initial: number = OPS_DASHBOARD_DEFAULT_RANGE_SECONDS): UseDashboardTimeRangeResult {
  const [rangeSeconds, setRangeSeconds] = useState<number>(initial);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const triggerReload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const resolved = useMemo(
    () => resolveTimeRange(rangeSeconds, Date.now() + reloadToken * 0), // eslint-disable-line @typescript-eslint/no-unused-expressions
    [rangeSeconds, reloadToken],
  );

  return { rangeSeconds, setRangeSeconds, reloadToken, triggerReload, resolved };
}
