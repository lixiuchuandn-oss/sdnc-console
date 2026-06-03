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
import { matchAswProbeRecordByCr } from '../lib/physicalSwitchRecordUtils';

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
  const [probingSwitchName, setProbingSwitchName] = useState<string | null>(null);
  const [hsmMonitorModalOpen, setHsmMonitorModalOpen] = useState(false);
  const [hsmMonitorSwitchName, setHsmMonitorSwitchName] = useState<string | null>(null);

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

  const loadProbeSummary = useCallback(async () => {
    if (!canRead) return;
    try {
      const res = await fetchAswCtlSwitchesSummary(cloudId);
      setProbeItems(Array.isArray(res?.items) ? res.items : []);
      setProbeMeta(probeMetaFromSummaryResponse(res ?? {}));
    } catch (e) {
      setProbeItems([]);
      setProbeMeta({});
      throw e;
    }
  }, [canRead, cloudId]);

  const loadAll = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    try {
      await Promise.all([
        loadSwitchConfigs(),
        loadProbeSummary().catch(() => undefined),
      ]);
    } finally {
      setLoading(false);
    }
  }, [canRead, loadProbeSummary, loadSwitchConfigs]);

  const runSwitchHsmProbe = useCallback(
    async (switchName: string, cr?: HmsSwitchCr | null) => {
      const name = String(switchName || '').trim();
      if (!canManageSwitchCr || !name) return;
      if (probingSwitchName) {
        message.warning('已有探测进行中，请稍候');
        return;
      }
      setHsmMonitorSwitchName(name);
      setHsmMonitorModalOpen(true);
      setProbingSwitchName(name);
      setProbeLoading(true);
      setServiceMonitorLoading(true);
      try {
        const [syncRes, probeRes] = await Promise.all([
          syncAswCtlSwitchesToInventory(cloudId, { name }),
          probeAswCtlConnection(cloudId, { name }),
        ]);
        setProbeItems(Array.isArray(syncRes?.items) ? syncRes.items : []);
        setProbeMeta(probeMetaFromSummaryResponse(syncRes ?? {}));
        const probeItemsList = Array.isArray(probeRes?.items) ? probeRes.items : [];
        const aggregate = aswCtlProbeAggregateFromResponse(probeRes);
        const matchedCr =
          cr ||
          hmsSwitchConfigs.find((item) => String(item.metadata?.name || '').trim() === name) ||
          null;
        const row =
          (matchedCr ? matchAswProbeRecordByCr(probeItemsList, matchedCr) : null) ||
          aggregate;
        setServiceMonitorRows(buildHmsServiceProbeRows(probeRes, row, matchedCr?.spec?.vendor));
        message.success('探测同步完成');
      } catch (e) {
        setServiceMonitorRows([]);
        message.error(apiErrorMessage(e, '探测同步失败'));
      } finally {
        setProbeLoading(false);
        setServiceMonitorLoading(false);
        setProbingSwitchName(null);
      }
    },
    [canManageSwitchCr, cloudId, hmsSwitchConfigs, probingSwitchName],
  );

  const handleSwitchHsmProbe = useCallback(
    (cr: HmsSwitchCr) => {
      const name = String(cr.metadata?.name || '').trim();
      if (!name) return;
      void runSwitchHsmProbe(name, cr);
    },
    [runSwitchHsmProbe],
  );

  const handleHsmMonitorReprobe = useCallback(() => {
    if (!hsmMonitorSwitchName) return;
    void runSwitchHsmProbe(hsmMonitorSwitchName);
  }, [hsmMonitorSwitchName, runSwitchHsmProbe]);

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
    probingSwitchName,
    hsmMonitorModalOpen,
    setHsmMonitorModalOpen,
    hsmMonitorSwitchName,
    loadAll,
    handleSwitchHsmProbe,
    handleHsmMonitorReprobe,
  };
}
