import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { MenuProps } from 'antd';

export type TenantConsoleSiderModel = {
  selectedKeys: string[];
  openKeys?: string[];
  defaultOpenKeys?: string[];
  onOpenChange?: (keys: string[]) => void;
  items: MenuProps['items'];
  onClick: NonNullable<MenuProps['onClick']>;
  width?: number;
};

type Ctx = {
  model: TenantConsoleSiderModel | null;
  setTenantConsoleSiderModel: (m: TenantConsoleSiderModel | null) => void;
};

const TenantConsoleSiderContext = createContext<Ctx | null>(null);

export function TenantConsoleSiderProvider({ children }: { children: React.ReactNode }) {
  const [model, setModel] = useState<TenantConsoleSiderModel | null>(null);
  const setTenantConsoleSiderModel = useCallback((m: TenantConsoleSiderModel | null) => {
    setModel(m);
  }, []);
  const value = useMemo(() => ({ model, setTenantConsoleSiderModel }), [model, setTenantConsoleSiderModel]);
  return (
    <TenantConsoleSiderContext.Provider value={value}>
      {children}
    </TenantConsoleSiderContext.Provider>
  );
}

export function useTenantConsoleSider(): Ctx {
  const c = useContext(TenantConsoleSiderContext);
  if (!c) {
    throw new Error('useTenantConsoleSider must be used within TenantConsoleSiderProvider');
  }
  return c;
}
