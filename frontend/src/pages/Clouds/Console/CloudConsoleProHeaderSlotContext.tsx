import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type Ctx = {
  centerSlot: React.ReactNode | null;
  setCenterSlot: (node: React.ReactNode | null) => void;
};

const CloudConsoleProHeaderSlotContext = createContext<Ctx | null>(null);

/**
 * 供「云资源控制台」页把控件（如可用区选择）挂到 AdminLayout 的 ProHeader 中间区域。
 * Provider 包在 AdminLayout 外层，仅 CloudConsole 写入 slot，ProHeader 只读。
 */
export function CloudConsoleProHeaderSlotProvider({ children }: { children: React.ReactNode }) {
  const [centerSlot, setCenterSlotState] = useState<React.ReactNode | null>(null);
  const setCenterSlot = useCallback((node: React.ReactNode | null) => {
    setCenterSlotState(node);
  }, []);
  const value = useMemo(() => ({ centerSlot, setCenterSlot }), [centerSlot, setCenterSlot]);
  return (
    <CloudConsoleProHeaderSlotContext.Provider value={value}>
      {children}
    </CloudConsoleProHeaderSlotContext.Provider>
  );
}

export function useCloudConsoleProHeaderSlot(): Ctx {
  const c = useContext(CloudConsoleProHeaderSlotContext);
  if (!c) {
    throw new Error('useCloudConsoleProHeaderSlot must be used within CloudConsoleProHeaderSlotProvider');
  }
  return c;
}
