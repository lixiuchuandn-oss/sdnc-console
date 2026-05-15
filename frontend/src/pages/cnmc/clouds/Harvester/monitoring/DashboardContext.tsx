/**
 * 概览 - 节点数据与慢数据 Context，按 cloudId 拉取
 */
import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useDashboardNodeData, type DashboardNodeDataState } from './useDashboardNodeData';
import { useDashboardSlowData, type DashboardSlowDataState } from './useDashboardSlowData';

const DashboardNodeDataContext = createContext<DashboardNodeDataState | null>(null);
const DashboardSlowDataContext = createContext<DashboardSlowDataState | null>(null);

export function useDashboardNodeDataContext(): DashboardNodeDataState | null {
  return useContext(DashboardNodeDataContext);
}

export function useDashboardSlowDataContext(): DashboardSlowDataState | null {
  return useContext(DashboardSlowDataContext);
}

/** 监控大盘首轮双链路（节点类 / 告警·VM 类）任一尚在请求中则为 true；用于页面级单次占位，避免各卡片重复 Spin */
export function useDashboardBootstrapLoading(): boolean {
  const node = useContext(DashboardNodeDataContext);
  const slow = useContext(DashboardSlowDataContext);
  return (node?.loading ?? false) || (slow?.loading ?? false);
}

interface ProvidersProps {
  cloudId: string | undefined;
  children: React.ReactNode;
  /** 快链路（节点/指标/存储）与慢链路（告警/块设备/VM）首轮请求均结束 `loading` 后触发一次（失败也算结束） */
  onInitialDashboardReady?: () => void;
}

export function DashboardProviders({ cloudId, children, onInitialDashboardReady }: ProvidersProps) {
  const nodeState = useDashboardNodeData(cloudId);
  const slowState = useDashboardSlowData(cloudId);
  const dashboardReadyNotifiedRef = useRef(false);

  useEffect(() => {
    dashboardReadyNotifiedRef.current = false;
  }, [cloudId]);

  useEffect(() => {
    if (!onInitialDashboardReady || !cloudId) return;
    const busy = nodeState.loading || slowState.loading;
    if (!busy && !dashboardReadyNotifiedRef.current) {
      dashboardReadyNotifiedRef.current = true;
      onInitialDashboardReady();
    }
  }, [
    cloudId,
    nodeState.loading,
    slowState.loading,
    onInitialDashboardReady,
  ]);

  return (
    <DashboardNodeDataContext.Provider value={nodeState}>
      <DashboardSlowDataContext.Provider value={slowState}>
        {children}
      </DashboardSlowDataContext.Provider>
    </DashboardNodeDataContext.Provider>
  );
}
