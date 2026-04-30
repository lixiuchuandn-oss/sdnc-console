/**
 * Cloudmap 池详情：路径解析、内层段高亮、与地址栏 replace 同步（含 resource_hub / poolInnerSeg）。
 */
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useMemo } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  parseCloudmapPoolPath,
  cloudmapPathForTab,
  cloudmapPoolBasePath,
  cloudmapTabUsesPoolInnerPath,
  cloudmapDefaultPoolInnerSeg,
  isValidCloudmapPoolInnerSeg,
  type CloudmapPoolTabKey,
  type CloudmapResourceSubKey,
} from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';

export type UseCloudmapPoolPathSyncParams = {
  cloudId: string;
  locationPathname: string;
  navigate: NavigateFunction;
  canViewClusterGroup: boolean;
  canViewOniaasNetworkTab: boolean;
  setActiveTabKey: (tab: string) => void;
  setResourceHubSubKey: (sub: CloudmapResourceSubKey) => void;
  handleTabChangeRef: MutableRefObject<(key: string) => void>;
};

export function useCloudmapPoolPathSync({
  cloudId,
  locationPathname,
  navigate,
  canViewClusterGroup,
  canViewOniaasNetworkTab,
  setActiveTabKey,
  setResourceHubSubKey,
  handleTabChangeRef,
}: UseCloudmapPoolPathSyncParams) {
  const pathParsed = useMemo(
    () => parseCloudmapPoolPath(locationPathname, cloudId),
    [locationPathname, cloudId],
  );

  const poolInnerActive = useCallback(
    (tab: CloudmapPoolTabKey) =>
      pathParsed?.tab === tab && pathParsed.poolInnerSeg
        ? pathParsed.poolInnerSeg
        : cloudmapDefaultPoolInnerSeg(tab),
    [pathParsed?.tab, pathParsed?.poolInnerSeg],
  );

  useEffect(() => {
    const p = parseCloudmapPoolPath(locationPathname, cloudId);
    if (!p) {
      navigate(`${cloudmapPoolBasePath(cloudId)}/resource_hub/overview`, {
        replace: true,
      });
      return;
    }

    if (p.tab === 'oniaas_network' && !canViewOniaasNetworkTab) {
      navigate(cloudmapPathForTab(cloudId, 'resource_hub', { resourceHubSub: 'overview' }), {
        replace: true,
      });
      return;
    }

    if (cloudmapTabUsesPoolInnerPath(p.tab)) {
      const inner = p.poolInnerSeg;
      if (!inner || !isValidCloudmapPoolInnerSeg(p.tab, inner)) {
        navigate(
          cloudmapPathForTab(cloudId, p.tab, {
            poolInnerSeg: cloudmapDefaultPoolInnerSeg(p.tab),
          }),
          { replace: true },
        );
        return;
      }
      handleTabChangeRef.current(inner);
    }

    setActiveTabKey(p.tab);
    if (p.resourceHubSub) {
      let nextSub = p.resourceHubSub;
      if (nextSub === 'datacenter_topology' && !canViewClusterGroup) {
        nextSub = 'overview';
        navigate(
          cloudmapPathForTab(cloudId, 'resource_hub', { resourceHubSub: nextSub }),
          { replace: true },
        );
      }
      setResourceHubSubKey(nextSub as CloudmapResourceSubKey);
    }
  }, [
    locationPathname,
    cloudId,
    canViewClusterGroup,
    canViewOniaasNetworkTab,
    navigate,
    setActiveTabKey,
    setResourceHubSubKey,
    handleTabChangeRef,
  ]);

  return { pathParsed, poolInnerActive };
}
