/**
 * 监控大盘自动刷新：可配置 off / 30s / 1m / 5m / 10m / 30m，只在文档可见时跑。
 * 实际触发动作交给上层（通常是 triggerReload）。
 */
import { useEffect, useState } from 'react';

export interface AutoRefreshOption {
  label: string;
  /** ms；null 表示关闭 */
  value: number | null;
}

export const OPS_DASHBOARD_AUTO_REFRESH_OPTIONS: AutoRefreshOption[] = [
  { label: '关', value: null },
  { label: '30s', value: 30 * 1000 },
  { label: '1m', value: 60 * 1000 },
  { label: '5m', value: 5 * 60 * 1000 },
  { label: '10m', value: 10 * 60 * 1000 },
  { label: '30m', value: 30 * 60 * 1000 },
];

export interface UseAutoRefreshResult {
  intervalMs: number | null;
  setIntervalMs: (v: number | null) => void;
}

/**
 * 注册自动刷新：每隔 intervalMs 调用一次 `onTick`，仅在 `document.visibilityState === 'visible'` 时触发。
 * 切走 Tab 时停掉 interval，回到 Tab 时立即触发一次"补刷"（与 Grafana 行为一致）。
 */
export function useAutoRefresh(initial: number | null, onTick: () => void): UseAutoRefreshResult {
  const [intervalMs, setIntervalMs] = useState<number | null>(initial);

  useEffect(() => {
    if (!intervalMs) return undefined;
    let timer: number | null = null;
    let lastTick = Date.now();

    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        lastTick = Date.now();
        onTick();
      }, intervalMs);
    };
    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastTick;
        if (elapsed >= intervalMs) {
          lastTick = Date.now();
          onTick();
        }
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, onTick]);

  return { intervalMs, setIntervalMs };
}
