import React, { createContext, useContext, type ReactNode } from 'react';
import type { CloudmapPoolPanelProps } from './cloudmapPoolDetailTypes';

/** 主内容区路由子树共用数据（由 `useCloudmapPoolDetailEngine` / `PoolDetailPage` 注入） */
export type CloudmapPoolDetailContextValue = CloudmapPoolPanelProps;

const CloudmapPoolDetailContext = createContext<CloudmapPoolDetailContextValue | null>(null);

export function CloudmapPoolDetailProvider({
  value,
  children,
}: {
  value: CloudmapPoolDetailContextValue;
  children: ReactNode;
}): React.ReactElement {
  return (
    <CloudmapPoolDetailContext.Provider value={value}>{children}</CloudmapPoolDetailContext.Provider>
  );
}

export function useCloudmapPoolDetail(): CloudmapPoolDetailContextValue {
  const v = useContext(CloudmapPoolDetailContext);
  if (!v) {
    throw new Error('useCloudmapPoolDetail 须在 CloudmapPoolDetailProvider 内使用');
  }
  return v;
}
