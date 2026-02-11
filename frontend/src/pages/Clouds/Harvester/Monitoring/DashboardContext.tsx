/**
 * 概览 - 节点数据与慢数据 Context，按 cloudId 拉取
 */
import React, { createContext, useContext } from 'react';
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

interface ProvidersProps {
  cloudId: string | undefined;
  children: React.ReactNode;
}

export function DashboardProviders({ cloudId, children }: ProvidersProps) {
  const nodeState = useDashboardNodeData(cloudId);
  const slowState = useDashboardSlowData(cloudId);
  return (
    <DashboardNodeDataContext.Provider value={nodeState}>
      <DashboardSlowDataContext.Provider value={slowState}>
        {children}
      </DashboardSlowDataContext.Provider>
    </DashboardNodeDataContext.Provider>
  );
}
