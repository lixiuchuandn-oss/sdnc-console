/**
 * 监控概览双车道数据（快车道 / 慢车道），与同页多卡片共享，避免重复 HTTP。
 * 不包办整块 Spin；各卡片自行 Spin。
 */
import React, { createContext, useContext, useMemo } from 'react';
import { useMonitoringLanePoll } from './hooks/useMonitoringLanePoll';
import {
  fetchMonitoringOverviewFastLaneCoreOutcome,
  fetchMonitoringOverviewFastLaneExtrasOutcome,
  fetchMonitoringOverviewSlowLaneOutcome,
  type MonitoringOverviewFastLaneData,
  type MonitoringOverviewSlowLaneData,
} from './lib/overviewFetchBundles';
import { OVERVIEW_POLL_ERROR_MS, OVERVIEW_POLL_FAST_MS, OVERVIEW_POLL_SLOW_MS } from './lib/overviewPolling';

export interface MonitoringOverviewFastLaneState extends MonitoringOverviewFastLaneData {
  /** 核心或附加任一进行中（整块快车道维度） */
  loading: boolean;
  /** 节点 / 指标 / Longhorn（CPU·内存·主机卡只看此项） */
  coreLoading: boolean;
  /** Ceph · Harvester 存储类（储存 ceph 分支、磁盘 OSD 聚合） */
  extrasLoading: boolean;
  error: string | null;
}

export interface MonitoringOverviewSlowLaneState extends MonitoringOverviewSlowLaneData {
  loading: boolean;
  error: string | null;
}

const FastLaneContext = createContext<MonitoringOverviewFastLaneState | null>(null);
const SlowLaneContext = createContext<MonitoringOverviewSlowLaneState | null>(null);

export function useMonitoringOverviewFastLane(): MonitoringOverviewFastLaneState {
  const v = useContext(FastLaneContext);
  if (v == null) {
    throw new Error('useMonitoringOverviewFastLane must be used within MonitoringOverviewLanesProvider');
  }
  return v;
}

export function useMonitoringOverviewSlowLane(): MonitoringOverviewSlowLaneState {
  const v = useContext(SlowLaneContext);
  if (v == null) {
    throw new Error('useMonitoringOverviewSlowLane must be used within MonitoringOverviewLanesProvider');
  }
  return v;
}

interface MonitoringOverviewLanesProviderProps {
  cloudId: string;
  children: React.ReactNode;
}

export function MonitoringOverviewLanesProvider({
  cloudId,
  children,
}: MonitoringOverviewLanesProviderProps) {
  const fastCorePoll = useMonitoringLanePoll(
    cloudId,
    fetchMonitoringOverviewFastLaneCoreOutcome,
    OVERVIEW_POLL_FAST_MS,
    OVERVIEW_POLL_ERROR_MS,
  );
  const fastExtrasPoll = useMonitoringLanePoll(
    cloudId,
    fetchMonitoringOverviewFastLaneExtrasOutcome,
    OVERVIEW_POLL_FAST_MS,
    OVERVIEW_POLL_ERROR_MS,
  );
  const slowPoll = useMonitoringLanePoll(
    cloudId,
    fetchMonitoringOverviewSlowLaneOutcome,
    OVERVIEW_POLL_SLOW_MS,
    OVERVIEW_POLL_ERROR_MS,
  );

  const fastValue = useMemo((): MonitoringOverviewFastLaneState => {
    const c = fastCorePoll.data;
    const e = fastExtrasPoll.data;
    const merged: MonitoringOverviewFastLaneData = {
      nodeResources: c?.nodeResources ?? null,
      nodeMetrics: c?.nodeMetrics ?? null,
      storageNodes: c?.storageNodes ?? null,
      cephHealthMinimal: e?.cephHealthMinimal ?? null,
      cephResourcesRaw: e?.cephResourcesRaw ?? null,
      storageClassesJson: e?.storageClassesJson ?? null,
    };
    const coreLoading = fastCorePoll.loading;
    const extrasLoading = fastExtrasPoll.loading;
    return {
      ...merged,
      loading: coreLoading || extrasLoading,
      coreLoading,
      extrasLoading,
      error: fastCorePoll.error ?? fastExtrasPoll.error,
    };
  }, [
    fastCorePoll.data,
    fastCorePoll.loading,
    fastCorePoll.error,
    fastExtrasPoll.data,
    fastExtrasPoll.loading,
    fastExtrasPoll.error,
  ]);

  const slowValue = useMemo((): MonitoringOverviewSlowLaneState => {
    const d = slowPoll.data;
    return {
      alertsRules: d?.alertsRules ?? null,
      blockDevices: d?.blockDevices ?? null,
      virtualMachines: d?.virtualMachines ?? null,
      vmInstances: d?.vmInstances ?? null,
      loading: slowPoll.loading,
      error: slowPoll.error,
    };
  }, [slowPoll.data, slowPoll.loading, slowPoll.error]);

  return (
    <FastLaneContext.Provider value={fastValue}>
      <SlowLaneContext.Provider value={slowValue}>{children}</SlowLaneContext.Provider>
    </FastLaneContext.Provider>
  );
}
