import { useMemo } from 'react';
import type { AdminSidebarCenter } from '../AdminSidebar';
import type { PageSearchEntry } from '../lib/adminLayoutNav';
import { buildAdminPlatformCenters, filterVisibleAdminCenters } from '../lib/buildAdminPlatformMenu';
import { buildPageSearchEntries } from '../lib/buildPageSearchEntries';

/** Admin 顶栏平台菜单 + 全局搜索条目（与侧栏同源） */
export function useAdminPlatformMenu(
  hasFeature: (feature: string) => boolean,
  isEnterpriseLicense: () => boolean,
  canAccessPath: (path: string) => boolean,
): {
  visibleCenters: AdminSidebarCenter[];
  pageSearchEntries: PageSearchEntry[];
} {
  const centers = useMemo(() => buildAdminPlatformCenters(), []);

  const visibleCenters = useMemo(
    () => filterVisibleAdminCenters(centers, { hasFeature, isEnterpriseLicense, canAccessPath }),
    [centers, hasFeature, isEnterpriseLicense, canAccessPath],
  );

  const pageSearchEntries = useMemo(
    () => buildPageSearchEntries(visibleCenters),
    [visibleCenters],
  );

  return { visibleCenters, pageSearchEntries };
}
