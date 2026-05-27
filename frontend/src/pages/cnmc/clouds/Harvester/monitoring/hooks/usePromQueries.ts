/**
 * 监控大盘统一查询器：
 * - 入参：cloudId + 一组命名 PromQL（含可选 vars）+ 时间范围 / step
 * - 出参：以命名为键的查询结果（每条 = 一组 `[ts(ms), number][]` 时间序列），并标注 loading/error
 * - 同一 Section 内并发执行；任何单条失败不影响其他面板
 * - 切 Tab / 切时间范围 / 卸载时 AbortController 中断未返回的请求
 *
 * 注意：后端 `/monitoring/metric-range` 走 Prometheus `api/v1/query_range`，
 *      响应里 `data.result[i].values` 形如 `[ [unixSeconds, "stringNumber"], ... ]`，
 *      本 hook 统一把它们转成 `[timestampMs, number][]`。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMetricRange, type PrometheusQueryRangeResponse } from '../../../../../../services/monitoringApi';
import { expandPromql, type PromVarMap } from '../lib/promql';

export interface PromQueryDef {
  /** 面板内或跨面板唯一键，对应 results[key] */
  key: string;
  /** 原始 PromQL（带 $var 占位） */
  expr: string;
  /** legend 模板（如 `{{instance}}`），渲染端使用，hook 内不处理 */
  legend?: string;
  /** 该查询独有的变量；与 globalVars 合并，覆盖 globalVars */
  vars?: PromVarMap;
}

/** 单条 series：metric labels + `[ts(ms), value][]` */
export interface PromSeries {
  metric: Record<string, string>;
  /** legend 渲染所需 raw 标签 */
  values: Array<[number, number]>;
}

export interface PromQueryResult {
  key: string;
  expr: string;
  series: PromSeries[];
  loading: boolean;
  error?: string;
}

export interface UsePromQueriesArgs {
  cloudId: string;
  queries: PromQueryDef[];
  /** Unix 秒 */
  start: number;
  /** Unix 秒 */
  end: number;
  /** 秒 */
  step: number;
  /** 全局变量（$__rate_interval / $__interval / 业务侧的 $cluster 等） */
  globalVars?: PromVarMap;
  /** 刷新令牌：变化即重拉 */
  reloadToken?: number;
}

export interface UsePromQueriesResult {
  /** loading 至少一条没回 */
  loading: boolean;
  /** 任意一条失败时，error 为聚合（用 \n 连接） */
  error?: string;
  /** 以 query.key 为键 */
  results: Record<string, PromQueryResult>;
}

function parseValues(raw: PrometheusQueryRangeResponse | null): PromSeries[] {
  const arr = raw?.data?.result ?? [];
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    const values = Array.isArray(item?.values) ? item.values : [];
    return {
      metric: item?.metric ?? {},
      values: values
        .map((v) => {
          const ts = Number(v?.[0]);
          const raw = Number(v?.[1]);
          if (!Number.isFinite(ts) || !Number.isFinite(raw)) return null;
          return [ts < 1e12 ? ts * 1000 : ts, raw] as [number, number];
        })
        .filter((x): x is [number, number] => x != null),
    } as PromSeries;
  });
}

const EMPTY_RESULTS: Record<string, PromQueryResult> = Object.freeze({}) as Record<string, PromQueryResult>;

export function usePromQueries({
  cloudId,
  queries,
  start,
  end,
  step,
  globalVars,
  reloadToken,
}: UsePromQueriesArgs): UsePromQueriesResult {
  const [results, setResults] = useState<Record<string, PromQueryResult>>(EMPTY_RESULTS);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>();
  const ctrlRef = useRef<AbortController | null>(null);

  /** 序列化稳定 key，避免对象引用变化重复请求 */
  const queriesKey = useMemo(() => JSON.stringify(queries ?? []), [queries]);
  const varsKey = useMemo(() => JSON.stringify(globalVars ?? {}), [globalVars]);

  useEffect(() => {
    if (!cloudId || !queries || queries.length === 0) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      setError(undefined);
      return undefined;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || step <= 0) {
      setError('时间范围或 step 无效');
      return undefined;
    }

    if (ctrlRef.current) ctrlRef.current.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    setLoading(true);
    setError(undefined);
    setResults((prev) => {
      const next: Record<string, PromQueryResult> = {};
      queries.forEach((q) => {
        next[q.key] = { ...(prev[q.key] ?? { key: q.key, expr: q.expr, series: [] }), loading: true, error: undefined };
      });
      return next;
    });

    const promises = queries.map(async (q) => {
      const expr = expandPromql(q.expr, { ...(globalVars ?? {}), ...(q.vars ?? {}) });
      const res = await fetchMetricRange(
        cloudId,
        { query: expr, start, end, step },
        { signal: ctrl.signal },
      );
      return { q, expr, res };
    });

    let cancelled = false;
    void Promise.allSettled(promises).then((settled) => {
      if (cancelled || ctrl.signal.aborted) return;
      const errs: string[] = [];
      setResults((prev) => {
        const next: Record<string, PromQueryResult> = { ...prev };
        settled.forEach((item, idx) => {
          const q = queries[idx];
          if (item.status === 'fulfilled') {
            const { res, expr } = item.value;
            if (res.ok) {
              next[q.key] = { key: q.key, expr, series: parseValues(res.data), loading: false };
            } else {
              const msg = res.error || '查询失败';
              errs.push(`${q.key}: ${msg}`);
              next[q.key] = { key: q.key, expr, series: [], loading: false, error: msg };
            }
          } else {
            const reason = (item.reason as Error)?.message ?? '查询失败';
            if (reason !== 'The operation was aborted.') errs.push(`${q.key}: ${reason}`);
            next[q.key] = { key: q.key, expr: q.expr, series: [], loading: false, error: reason };
          }
        });
        return next;
      });
      setLoading(false);
      setError(errs.length > 0 ? errs.join('\n') : undefined);
    });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudId, queriesKey, start, end, step, varsKey, reloadToken]);

  return { loading, error, results };
}
