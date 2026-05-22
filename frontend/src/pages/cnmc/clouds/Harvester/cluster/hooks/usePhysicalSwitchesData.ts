import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import {
  fetchAswCtlSwitchesSummary,
  fetchHmsSwitchCrs,
  probeAswCtlConnection,
  syncAswCtlSwitchesToInventory,
  type HmsSwitchCr,
} from 'services/harvester/cluster';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import {
  aswCtlProbeAggregateFromResponse,
  buildHmsServiceProbeRows,
  type HmsServiceProbeRow,
} from '../components/HmsServiceMonitorCard';
import {
  apiErrorMessage,
  probeMetaFromSummaryResponse,
  type PhysicalSwitchProbeMeta,
} from '../lib/physicalSwitchesSectionUtils';

export type LoadPhysicalSwitchesOpts = {
  liveProbe?: boolean;
  withServiceMonitor?: boolean;
};

export function usePhysicalSwitchesData(
  cloudId: string,
  canRead: boolean,
  canManageSwitchCr: boolean,
) {
  const [hmsSwitchConfigs, setHmsSwitchConfigs] = useState<HmsSwitchCr[]>([]);
  const [probeItems, setProbeItems] = useState<AswCtlSwitchProbeRecord[]>([]);
  const [probeMeta, setProbeMeta] = useState<PhysicalSwitchProbeMeta>({});
  const [serviceMonitorRows, setServiceMonitorRows] = useState<HmsServiceProbeRow[]>([]);
  const [serviceMonitorLoading, setServiceMonitorLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [probeLoading, setProbeLoading] = useState(false);
  const [hsmMonitorModalOpen, setHsmMonitorModalOpen] = useState(false);

  const loadSwitchConfigs = useCallback(async () => {
    if (!canRead) return;
    try {
      const res = await fetchHmsSwitchCrs(cloudId);
      const list = Array.isArray(res?.data?.items) ? res.data.items : [];
      setHmsSwitchConfigs(list);
    } catch (e) {
      setHmsSwitchConfigs([]);
      throw e;
    }
  }, [canRead, cloudId]);

  const loadProbeSummary = useCallback(
    async (live: boolean) => {
      if (!canRead) return;
      try {
        const res =
          live && canManageSwitchCr
            ? await syncAswCtlSwitchesToInventory(cloudId)
            : await fetchAswCtlSwitchesSummary(cloudId);
        setProbeItems(Array.isArray(res?.items) ? res.items : []);
        setProbeMeta(probeMetaFromSummaryResponse(res ?? {}));
        if (live && canManageSwitchCr) {
          message.success('HSM 探测完成');
        }
      } catch (e) {
        setProbeItems([]);
        setProbeMeta({});
        if (live) {
          message.error(apiErrorMessage(e, 'HSM 探测数据加载失败'));
        }
        throw e;
      }
    },
    [canManageSwitchCr, canRead, cloudId],
  );

  const loadServiceMonitor = useCallback(async () => {
    if (!canRead) return;
    setServiceMonitorLoading(true);
    try {
      const res = await probeAswCtlConnection(cloudId, {});
      const aggregate = aswCtlProbeAggregateFromResponse(res);
      setServiceMonitorRows(
        aggregate ? buildHmsServiceProbeRows(res, aggregate) : [],
      );
    } catch {
      setServiceMonitorRows([]);
    } finally {
      setServiceMonitorLoading(false);
    }
  }, [canRead, cloudId]);

  const loadAll = useCallback(
    async (opts?: LoadPhysicalSwitchesOpts) => {
      if (!canRead) return;
      const liveProbe = !!opts?.liveProbe;
      const withServiceMonitor = !!opts?.withServiceMonitor;
      setLoading(true);
      if (liveProbe) setProbeLoading(true);
      try {
        const tasks: Promise<unknown>[] = [
          loadSwitchConfigs(),
          loadProbeSummary(liveProbe).catch(() => undefined),
        ];
        if (withServiceMonitor) {
          tasks.push(loadServiceMonitor());
        }
        await Promise.all(tasks);
      } finally {
        setLoading(false);
        setProbeLoading(false);
      }
    },
    [canRead, loadProbeSummary, loadServiceMonitor, loadSwitchConfigs],
  );

  const handleHsmProbe = useCallback(async () => {
    if (!canManageSwitchCr) return;
    setHsmMonitorModalOpen(true);
    await loadAll({ liveProbe: true, withServiceMonitor: true });
  }, [canManageSwitchCr, loadAll]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return {
    hmsSwitchConfigs,
    probeItems,
    probeMeta,
    serviceMonitorRows,
    serviceMonitorLoading,
    loading,
    probeLoading,
    hsmMonitorModalOpen,
    setHsmMonitorModalOpen,
    loadAll,
    handleHsmProbe,
  };
}
