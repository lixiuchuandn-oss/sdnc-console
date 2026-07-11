import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { AdminSidebarCenter } from '../AdminSidebar';
import { findMenuOpenKeyChainForPath, sidebarForPath } from '../lib/adminLayoutNav';

type UseSidebarMenuStateArgs = {
  visibleCenters: AdminSidebarCenter[];
};

export function useSidebarMenuState({ visibleCenters }: UseSidebarMenuStateArgs) {
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(false);
  const [activeSidebarKey, setActiveSidebarKey] = useState('/admin/cen_sdn');
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const lastSidebarAutoExpandSigRef = useRef<string>('');

  useEffect(() => {
    setActiveSidebarKey(sidebarForPath(location.pathname + location.search));
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (collapsed) {
      lastSidebarAutoExpandSigRef.current = '';
      return;
    }

    const center =
      visibleCenters.find((c) => c.key === activeSidebarKey) || visibleCenters[0];
    if (!center) return;

    const currentPath = location.pathname.split('?')[0];
    const chain = findMenuOpenKeyChainForPath(center.items, currentPath);
    if (chain && chain.length > 0) {
      const sig = `path|${activeSidebarKey}|${currentPath}|${chain.join('>')}`;
      if (lastSidebarAutoExpandSigRef.current === sig) return;
      lastSidebarAutoExpandSigRef.current = sig;
      setOpenKeys((prev) => {
        const firstKey = chain[0];
        const pfPrefix = String(firstKey).split('_')[0];
        const nextBase = prev.filter((k) => String(k).startsWith(`${pfPrefix}_`));
        const merged = [...nextBase];
        for (const k of chain) {
          if (!merged.includes(k)) merged.push(k);
        }
        return merged;
      });
    }
  }, [collapsed, activeSidebarKey, location.pathname, visibleCenters]);

  return {
    collapsed,
    setCollapsed,
    openKeys,
    setOpenKeys,
    activeSidebarKey,
    setActiveSidebarKey,
    sidebarCentersForMenu: visibleCenters,
    poolSelectedMenuKey: undefined as string | undefined,
    platformDropdownSelectedKeys: [activeSidebarKey],
  };
}
