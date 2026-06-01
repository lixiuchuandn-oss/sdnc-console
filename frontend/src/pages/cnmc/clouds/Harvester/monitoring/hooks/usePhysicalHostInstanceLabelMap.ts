import { useCallback, useEffect, useMemo } from 'react';
import { useMonitoringOverviewFastLane } from '../MonitoringOverviewLanesContext';
import {
  clearPhysicalHostInstanceLabelCache,
  getPhysicalHostInstanceLabelMap,
  resolvePhysicalHostInstanceLabel,
} from '../lib/physicalHostInstanceLabels';

/**
 * 物理主机 instance → 主机名映射（node-resources 构建，按 cloudId 缓存）。
 */
export function usePhysicalHostInstanceLabelMap(cloudId: string) {
  const fast = useMonitoringOverviewFastLane();

  useEffect(() => {
    return () => clearPhysicalHostInstanceLabelCache(cloudId);
  }, [cloudId]);

  const labelMap = useMemo(
    () => getPhysicalHostInstanceLabelMap(cloudId, fast.nodeResources ?? null),
    [cloudId, fast.nodeResources],
  );

  const resolveLabel = useCallback(
    (instance: string) => resolvePhysicalHostInstanceLabel(instance, labelMap),
    [labelMap],
  );

  return { resolveLabel, labelMap, hasMapping: labelMap.size > 0 };
}
