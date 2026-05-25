/**
 * Cloudmap 池详情：路径解析、内层段高亮、与地址栏 replace 同步（含 resource_hub / poolInnerSeg）。
 */
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useMemo } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  parseCloudmapPoolPath,
  cloudmapPathForNav,
  cloudmapPoolBasePath,
  cloudmapRemapLegacyCephPoolPath,
  cloudmapRemapDroppedPoolLeafPath,
  cloudmapNavUsesPoolInnerPath,
  cloudmapDefaultPoolInnerSeg,
  isValidCloudmapPoolInnerSeg,
  type CloudmapPoolNavKey,
  type CloudmapResourceSubKey,
} from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';

export type UseCloudmapPoolPathSyncParams = {
  cloudId: string;
  locationPathname: string;
  navigate: NavigateFunction;
  canViewClusterGroup: boolean;
  canViewComputeGroup: boolean;
  resolveResourceHubSubAccess: (requested: CloudmapResourceSubKey) => CloudmapResourceSubKey | null;
  canViewMonitoringTab: boolean;
  canViewLoggingTab: boolean;
  canViewCloudDatabaseTab: boolean;
  canViewOniaasNetworkTab: boolean;
  canViewCephGroup: boolean;
  canViewObjectStorageGroup: boolean;
  setActiveTabKey: (tab: string) => void;
  setResourceHubSubKey: (sub: CloudmapResourceSubKey) => void;
  handleTabChangeRef: MutableRefObject<(key: string) => void>;
};

export function useCloudmapPoolPathSync({
  cloudId,
  locationPathname,
  navigate,
  canViewClusterGroup,
  canViewComputeGroup,
  resolveResourceHubSubAccess,
  canViewMonitoringTab,
  canViewLoggingTab,
  canViewCloudDatabaseTab,
  canViewOniaasNetworkTab,
  canViewCephGroup,
  canViewObjectStorageGroup,
  setActiveTabKey,
  setResourceHubSubKey,
  handleTabChangeRef,
}: UseCloudmapPoolPathSyncParams) {
  const pathParsed = useMemo(
    () => parseCloudmapPoolPath(locationPathname, cloudId),
    [locationPathname, cloudId],
  );

  const poolInnerActive = useCallback(
    (nav: CloudmapPoolNavKey) =>
      pathParsed?.tab === nav && pathParsed.poolInnerSeg
        ? pathParsed.poolInnerSeg
        : cloudmapDefaultPoolInnerSeg(nav),
    [pathParsed?.tab, pathParsed?.poolInnerSeg],
  );

  useEffect(() => {
    const remapped = cloudmapRemapLegacyCephPoolPath(locationPathname, cloudId);
    if (remapped && remapped !== locationPathname) {
      navigate(remapped, { replace: true });
      return;
    }
    const remappedDropped = cloudmapRemapDroppedPoolLeafPath(locationPathname, cloudId);
    if (remappedDropped && remappedDropped !== locationPathname) {
      navigate(remappedDropped, { replace: true });
      return;
    }

    const p = parseCloudmapPoolPath(locationPathname, cloudId);
    if (!p) {
      navigate(`${cloudmapPoolBasePath(cloudId)}/resource_hub/overview`, {
        replace: true,
      });
      return;
    }

    if (p.tab === 'oniaas_network' && !canViewOniaasNetworkTab) {
      const hub = resolveResourceHubSubAccess('overview');
      if (hub) {
        navigate(cloudmapPathForNav(cloudId, 'resource_hub', { resourceHubSub: hub }), {
          replace: true,
        });
      } else if (canViewComputeGroup) {
        navigate(
          cloudmapPathForNav(cloudId, 'compute', {
            poolInnerSeg: cloudmapDefaultPoolInnerSeg('compute'),
          }),
          { replace: true },
        );
      }
      return;
    }

    if (p.tab === 'object_storage' && !canViewObjectStorageGroup) {
      const hub = resolveResourceHubSubAccess('overview');
      if (hub) {
        navigate(cloudmapPathForNav(cloudId, 'resource_hub', { resourceHubSub: hub }), {
          replace: true,
        });
      } else if (canViewComputeGroup) {
        navigate(
          cloudmapPathForNav(cloudId, 'compute', {
            poolInnerSeg: cloudmapDefaultPoolInnerSeg('compute'),
          }),
          { replace: true },
        );
      }
      return;
    }

    if (cloudmapNavUsesPoolInnerPath(p.tab)) {
      const inner = p.poolInnerSeg;
      if (!inner || !isValidCloudmapPoolInnerSeg(p.tab, inner)) {
        navigate(
          cloudmapPathForNav(cloudId, p.tab, {
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
      const requested = p.resourceHubSub as CloudmapResourceSubKey;
      const resolved = resolveResourceHubSubAccess(requested);
      if (!resolved) {
        if (canViewComputeGroup) {
          navigate(
            cloudmapPathForNav(cloudId, 'compute', {
              poolInnerSeg: cloudmapDefaultPoolInnerSeg('compute'),
            }),
            { replace: true },
          );
        } else if (canViewClusterGroup) {
          navigate(
            cloudmapPathForNav(cloudId, 'cluster', {
              poolInnerSeg: cloudmapDefaultPoolInnerSeg('cluster'),
            }),
            { replace: true },
          );
        }
        return;
      }
      if (resolved !== requested) {
        navigate(
          cloudmapPathForNav(cloudId, 'resource_hub', { resourceHubSub: resolved }),
          { replace: true },
        );
        return;
      }
      setResourceHubSubKey(resolved);
    }
  }, [
    locationPathname,
    cloudId,
    canViewClusterGroup,
    canViewComputeGroup,
    resolveResourceHubSubAccess,
    canViewMonitoringTab,
    canViewLoggingTab,
    canViewCloudDatabaseTab,
    canViewOniaasNetworkTab,
    canViewCephGroup,
    canViewObjectStorageGroup,
    navigate,
    setActiveTabKey,
    setResourceHubSubKey,
    handleTabChangeRef,
  ]);

  return { pathParsed, poolInnerActive };
}
