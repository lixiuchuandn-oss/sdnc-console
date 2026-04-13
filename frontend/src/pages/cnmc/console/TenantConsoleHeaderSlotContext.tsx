import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type Ctx = {
  centerSlot: React.ReactNode | null;
  setCenterSlot: (node: React.ReactNode | null) => void;
};

const TenantConsoleHeaderSlotContext = createContext<Ctx | null>(null);

/**
 * 租户控制台顶栏中间槽（如「可用区」选择器）。
 * Provider 挂在 TenantConsoleLayout；CloudConsole 写入，TenantConsoleHeader 只读。
 */
export function TenantConsoleHeaderSlotProvider({ children }: { children: React.ReactNode }) {
  const [centerSlot, setCenterSlotState] = useState<React.ReactNode | null>(null);
  const setCenterSlot = useCallback((node: React.ReactNode | null) => {
    setCenterSlotState(node);
  }, []);
  const value = useMemo(() => ({ centerSlot, setCenterSlot }), [centerSlot, setCenterSlot]);
  return (
    <TenantConsoleHeaderSlotContext.Provider value={value}>
      {children}
    </TenantConsoleHeaderSlotContext.Provider>
  );
}

export function useTenantConsoleHeaderSlot(): Ctx {
  const c = useContext(TenantConsoleHeaderSlotContext);
  if (!c) {
    throw new Error('useTenantConsoleHeaderSlot must be used within TenantConsoleHeaderSlotProvider');
  }
  return c;
}
