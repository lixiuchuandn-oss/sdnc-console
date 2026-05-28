/**
 * 运维告警 · 告警中心概览：数据加载与刷新控制（供首行 DashboardToolbar + Section 共用）
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchAlertsRules } from '../../../../../../services/monitoringApi';
import { parseAlerts, type ParsedAlert } from '../lib/prometheusAlerts';
import type { AutoRefreshOption } from './useAutoRefresh';

export const OPS_ALERT_OVERVIEW_AUTO_REFRESH_OPTIONS: AutoRefreshOption[] = [
  { label: '关', value: null },
  { label: '5m', value: 5 * 60 * 1000 },
  { label: '10m', value: 10 * 60 * 1000 },
  { label: '15m', value: 15 * 60 * 1000 },
  { label: '30m', value: 30 * 60 * 1000 },
];

const DEFAULT_AUTO_REFRESH_MS = 10 * 60 * 1000;

export type OpsAlertOverviewControls = {
  loading: boolean;
  error: string;
  alerts: ParsedAlert[];
  autoRefreshMs: number | null;
  setAutoRefreshMs: (v: number | null) => void;
  loadDashboard: () => Promise<void>;
};

export function useOpsAlertOverviewControls(cloudId: string): OpsAlertOverviewControls {
  const [loading, setLoading] = useState(() => Boolean(cloudId));
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState<ParsedAlert[]>([]);
  const [autoRefreshMs, setAutoRefreshMs] = useState<number | null>(DEFAULT_AUTO_REFRESH_MS);

  const loadDashboard = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    setError('');
    try {
      const { data, ok, error: err } = await fetchAlertsRules(cloudId, {
        datasource: 'prometheus',
        autoRefreshMs,
      });
      if (!ok) {
        setAlerts([]);
        setError(err || '加载运维告警数据失败');
        return;
      }
      const list = parseAlerts(data ?? null).sort((a, b) => {
        const at = a.activeAtRaw ? new Date(a.activeAtRaw).getTime() : 0;
        const bt = b.activeAtRaw ? new Date(b.activeAtRaw).getTime() : 0;
        return bt - at;
      });
      setAlerts(list);
    } finally {
      setLoading(false);
    }
  }, [autoRefreshMs, cloudId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!autoRefreshMs) return undefined;
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshMs, loadDashboard]);

  return {
    loading,
    error,
    alerts,
    autoRefreshMs,
    setAutoRefreshMs,
    loadDashboard,
  };
}
