import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAlertsRules } from 'services/monitoringApi';
import { parseAlerts } from '../../monitoring/lib/prometheusAlerts';

/** 物理节点页 KPI：etcd-custom-rules 活跃告警数量 */
export function useEtcdActiveAlertCount(cloudId: string | undefined, enabled: boolean) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const load = useCallback(async () => {
    if (!cloudId || !enabled) return;
    const gen = ++genRef.current;
    setLoading(true);
    const { data, ok } = await fetchAlertsRules(cloudId);
    if (gen !== genRef.current) return;
    setLoading(false);
    if (!ok) {
      setCount(0);
      return;
    }
    const parsed = parseAlerts(data);
    setCount(parsed.filter((a) => a.groupName === 'etcd-custom-rules').length);
  }, [cloudId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { etcdActiveAlertCount: count, etcdAlertsLoading: loading, reloadEtcdAlerts: load };
}
