/**
 * 概览 - 告警/块设备/虚拟机 统一请求与轮询（30s）
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  fetchAlertsRules,
  fetchBlockDevices,
  fetchVirtualMachineInstances,
} from '../../../../services/monitoringApi';

const POLL_INTERVAL_SUCCESS_SEC = 30;
const POLL_INTERVAL_ERROR_SEC = 15;

export interface DashboardSlowDataState {
  alertsRules: unknown;
  blockDevices: unknown;
  vmInstances: unknown;
  loading: boolean;
  error: string | null;
}

export function useDashboardSlowData(cloudId: string | undefined): DashboardSlowDataState {
  const [state, setState] = useState<DashboardSlowDataState>({
    alertsRules: null,
    blockDevices: null,
    vmInstances: null,
    loading: !!cloudId,
    error: null,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const isFetchingRef = useRef(false);

  const runFetch = useCallback(
    (isBackground: boolean) => {
      if (!cloudId) {
        setState((s) => ({ ...s, loading: false, error: '缺少 cloudId' }));
        return;
      }
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      if (!isBackground) {
        setState((s) => ({ ...s, loading: true, error: null }));
      }
      const ctrl = new AbortController();
      const signal = ctrl.signal;
      const opts = { signal };

      Promise.all([
        fetchAlertsRules(cloudId, opts),
        fetchBlockDevices(cloudId, opts),
        fetchVirtualMachineInstances(cloudId, opts),
      ])
        .then(([alertsRes, blockRes, vmiRes]) => {
          if (!mountedRef.current || signal.aborted) return;
          const errMsg = !alertsRes.ok
            ? alertsRes.error
            : !blockRes.ok
              ? blockRes.error
              : !vmiRes.ok
                ? vmiRes.error
                : null;
          setState({
            alertsRules: alertsRes.ok ? alertsRes.data : null,
            blockDevices: blockRes.ok ? blockRes.data : null,
            vmInstances: vmiRes.ok ? vmiRes.data : null,
            loading: false,
            error: errMsg ?? null,
          });
          const delayMs = errMsg ? POLL_INTERVAL_ERROR_SEC * 1000 : POLL_INTERVAL_SUCCESS_SEC * 1000;
          timerRef.current = setTimeout(() => runFetch(true), delayMs);
        })
        .catch((err) => {
          if (!mountedRef.current || signal.aborted) return;
          setState((s) => ({
            ...s,
            loading: false,
            error: err?.message ?? '请求失败',
          }));
          timerRef.current = setTimeout(() => runFetch(true), POLL_INTERVAL_ERROR_SEC * 1000);
        })
        .finally(() => {
          isFetchingRef.current = false;
        });

      return () => ctrl.abort();
    },
    [cloudId]
  );

  useEffect(() => {
    mountedRef.current = true;
    runFetch(false);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [runFetch]);

  return state;
}
