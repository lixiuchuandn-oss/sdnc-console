import { useEffect, useRef, useState } from 'react';

export interface MonitoringLanePollResult<T> {
  data: T | null;
  loading: boolean;
  /** 车道级错误文案（与历史 Dashboard 一致：部分接口失败仍可展示其余数据） */
  error: string | null;
}

export interface MonitoringLanePollOutcome<T> {
  data: T;
  laneError: string | null;
}

/**
 * 概览「车道」轮询：fetchRound 永不 reject，返回 `{ data, laneError }`；
 * `laneError != null` 时用较短间隔退避（与历史 node/slow 链路一致）。
 */
export function useMonitoringLanePoll<T>(
  cloudId: string | undefined,
  fetchRound: (cloudId: string, signal: AbortSignal) => Promise<MonitoringLanePollOutcome<T>>,
  intervalSuccessMs: number,
  intervalErrorMs: number,
): MonitoringLanePollResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(() => !!cloudId);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetchRound);
  fetchRef.current = fetchRound;

  useEffect(() => {
    if (!cloudId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setData(null);

    let cancelled = false;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = (ms: number) => {
      clearTimer();
      timer = setTimeout(() => run(true), ms);
    };

    const run = (isBackground: boolean) => {
      if (cancelled) return;
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }

      const startedAt = Date.now();
      fetchRef
        .current(cloudId, ac.signal)
        .then((outcome) => {
          if (cancelled || ac.signal.aborted) return;
          setData(outcome.data);
          setLoading(false);
          setError(outcome.laneError);
          const intervalMs = outcome.laneError != null ? intervalErrorMs : intervalSuccessMs;
          const delayMs = Math.max(0, intervalMs - (Date.now() - startedAt));
          scheduleNext(delayMs);
        })
        .catch((e: unknown) => {
          if (cancelled || ac.signal.aborted) return;
          const msg = e instanceof Error ? e.message : String(e);
          setLoading(false);
          setError(msg);
          const delayMs = Math.max(0, intervalErrorMs - (Date.now() - startedAt));
          scheduleNext(delayMs);
        });
    };

    run(false);

    return () => {
      cancelled = true;
      clearTimer();
      ac.abort();
    };
  }, [cloudId, intervalSuccessMs, intervalErrorMs]);

  return { data, loading, error };
}
