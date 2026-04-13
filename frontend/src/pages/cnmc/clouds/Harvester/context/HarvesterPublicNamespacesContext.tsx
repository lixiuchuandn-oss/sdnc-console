import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../../../services/api';
import { isPublicNamespace as isPublicNamespaceByLegacyName } from '../../../../../utils/harvesterUtils';

type Ctx = {
  /** null = 尚未加载完成；加载后可为空 Set（无公共 NS） */
  publicNamespaceSet: Set<string> | null;
  isPublicNamespace: (name: string) => boolean;
  refresh: () => Promise<void>;
};

const HarvesterPublicNamespacesContext = createContext<Ctx>({
  publicNamespaceSet: null,
  isPublicNamespace: isPublicNamespaceByLegacyName,
  refresh: async () => {},
});

export function HarvesterPublicNamespacesProvider({
  cloudId,
  children,
}: {
  cloudId: string;
  children: React.ReactNode;
}) {
  const [publicNamespaceSet, setPublicNamespaceSet] = useState<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    if (!cloudId) {
      setPublicNamespaceSet(new Set());
      return;
    }
    try {
      const raw = await apiRequest(
        `/api/clouds/${encodeURIComponent(cloudId)}/resources/harvester/public-namespace-names`,
        { skipCache: true },
      );
      const names = (raw as { names?: string[] })?.names;
      setPublicNamespaceSet(new Set(Array.isArray(names) ? names : []));
    } catch {
      setPublicNamespaceSet(null);
    }
  }, [cloudId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const isPublicNamespace = useCallback(
    (name: string) => {
      const n = String(name || '').trim();
      if (!n) return false;
      if (publicNamespaceSet !== null) return publicNamespaceSet.has(n);
      return isPublicNamespaceByLegacyName(name);
    },
    [publicNamespaceSet],
  );

  const value = useMemo(
    () => ({ publicNamespaceSet, isPublicNamespace, refresh }),
    [publicNamespaceSet, isPublicNamespace, refresh],
  );

  return (
    <HarvesterPublicNamespacesContext.Provider value={value}>{children}</HarvesterPublicNamespacesContext.Provider>
  );
}

export function useHarvesterPublicNamespaces(): Ctx {
  return useContext(HarvesterPublicNamespacesContext);
}
