import type { Dispatch, SetStateAction } from 'react';
import {
  fetchCloudById,
  fetchCloudProviderEcs,
  fetchHarvesterCapabilities,
  fetchHarvesterImages,
  fetchHarvesterNads,
  fetchHarvesterNamespaces,
  fetchHarvesterNodes,
  fetchHarvesterStorageClasses,
  fetchHarvesterVolumes,
  fetchKubeOvnSubnets,
  fetchKubeOvnVpcs,
} from '../runtime/api';

/** 概览/首屏必需数据：`runLoadEssentials` 注入项 */
export type LoadEssentialsDeps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  canReadNetworkScope: boolean;
  canViewKubeOvnGroup: boolean;
  ovnVpcEnabled: boolean;
  canReadFlatSubnets: boolean;
  canReadVpcSubnets: boolean;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  setCloud: Dispatch<SetStateAction<any | null>>;
  setEcs: Dispatch<SetStateAction<any[]>>;
  setRawEcs: Dispatch<SetStateAction<any | null>>;
  setHarvesterNads: Dispatch<SetStateAction<any[]>>;
  setRawNads: Dispatch<SetStateAction<any | null>>;
  setKubeOvnVpcs: Dispatch<SetStateAction<any[]>>;
  setRawVpcs: Dispatch<SetStateAction<any | null>>;
  setKubeOvnSubnets: Dispatch<SetStateAction<any[]>>;
  setRawSubnets: Dispatch<SetStateAction<any | null>>;
  setHarvesterImages: Dispatch<SetStateAction<any[]>>;
  setRawImages: Dispatch<SetStateAction<any | null>>;
  setHarvesterVolumes: Dispatch<SetStateAction<any[]>>;
  setRawVolumes: Dispatch<SetStateAction<any | null>>;
  setHarvesterStorageClasses: Dispatch<SetStateAction<any[]>>;
  setHarvesterNodes: Dispatch<SetStateAction<any[]>>;
  setRawNodes: Dispatch<SetStateAction<any | null>>;
  setHarvesterNamespaces: Dispatch<SetStateAction<any[]>>;
  setRawNamespaces: Dispatch<SetStateAction<any | null>>;
  setCapabilities: Dispatch<SetStateAction<any | null>>;
};

/**
 * 加载核心资源 (首页/概览页必须的数据)
 * 包括: 云信息, VM, 网络, 卷, 镜像, 节点, 命名空间
 */
export function runLoadEssentials(
  force: boolean,
  d: LoadEssentialsDeps,
): void {
  const {
    cloudId,
    checkPerm,
    loadResource,
    canReadNetworkScope,
    canViewKubeOvnGroup,
    ovnVpcEnabled,
    canReadFlatSubnets,
    canReadVpcSubnets,
    setCloud,
    setEcs,
    setRawEcs,
    setHarvesterNads,
    setRawNads,
    setKubeOvnVpcs,
    setRawVpcs,
    setKubeOvnSubnets,
    setRawSubnets,
    setHarvesterImages,
    setRawImages,
    setHarvesterVolumes,
    setRawVolumes,
    setHarvesterStorageClasses,
    setHarvesterNodes,
    setRawNodes,
    setHarvesterNamespaces,
    setRawNamespaces,
    setCapabilities,
  } = d;

  loadResource(
    'cloud',
    () => fetchCloudById(cloudId, { skipCache: force }),
    (cloudRes) => {
      setCloud(cloudRes || null);
    },
    force,
  );

  if (checkPerm('clouds.ecs:read')) {
    loadResource(
      'ecs',
      () => fetchCloudProviderEcs(cloudId, force),
      (json) => {
        const list: any[] = Array.isArray((json as any)?.data)
          ? (json as any).data
          : (json as any)?.data?.Instances?.Instance ||
            (json as any)?.data?.items ||
            (json as any)?.data?.data ||
            [];
        setEcs(Array.isArray(list) ? list : []);
        setRawEcs(json || null);
      },
      force,
    );
  }

  if (canReadNetworkScope) {
    loadResource(
      'nads',
      () => fetchHarvesterNads(cloudId, force),
      (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterNads(Array.isArray(list) ? list : []);
        setRawNads(json || null);
      },
      force,
    );
  }

  const shouldPrefetchVpcs =
    canViewKubeOvnGroup ||
    checkPerm('clouds.eips.flat:read') ||
    checkPerm('clouds.fips.flat:read') ||
    checkPerm('clouds.snat.flat:read') ||
    checkPerm('clouds.dnat.flat:read');
  if (shouldPrefetchVpcs) {
    loadResource(
      'vpcs',
      () => fetchKubeOvnVpcs(cloudId, force),
      (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnVpcs(Array.isArray(list) ? list : []);
        setRawVpcs(json || null);
      },
      force,
    );
  } else {
    setKubeOvnVpcs([]);
    setRawVpcs(null);
  }

  const shouldPrefetchKubeOvnSubnets =
    checkPerm('clouds:read') ||
    canReadFlatSubnets ||
    canReadVpcSubnets ||
    checkPerm('clouds.subnets:read') ||
    (ovnVpcEnabled && canViewKubeOvnGroup) ||
    checkPerm('clouds.snat.flat:read') ||
    checkPerm('clouds.eips.flat:read') ||
    (ovnVpcEnabled &&
      (checkPerm('clouds.snat.vpc:read') ||
        checkPerm('clouds.eips.vpc:read')));
  if (shouldPrefetchKubeOvnSubnets) {
    loadResource(
      'subnets',
      () => fetchKubeOvnSubnets(cloudId, force),
      (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnSubnets(Array.isArray(list) ? list : []);
        setRawSubnets(json || null);
      },
      force,
    );
  }

  if (checkPerm('clouds.images:read') || checkPerm('clouds.ecs:read')) {
    loadResource(
      'images',
      () => fetchHarvesterImages(cloudId, force),
      (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterImages(Array.isArray(list) ? list : []);
        setRawImages(json || null);
      },
      force,
    );
  }

  if (checkPerm('clouds.disks:read')) {
    loadResource(
      'volumes',
      () => fetchHarvesterVolumes(cloudId, force),
      (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items)
          ? (json as any).data.items
          : Array.isArray((json as any)?.items)
            ? (json as any).items
            : [];
        setHarvesterVolumes(Array.isArray(list) ? list : []);
        setRawVolumes(json || null);
      },
      force,
    );
  }

  if (
    checkPerm('clouds.storage-classes:read') ||
    checkPerm('clouds.ecs:read')
  ) {
    loadResource(
      'storageClasses',
      () => fetchHarvesterStorageClasses(cloudId, force),
      (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items)
          ? (json as any).data.items
          : Array.isArray((json as any)?.items)
            ? (json as any).items
            : [];
        setHarvesterStorageClasses(Array.isArray(list) ? list : []);
      },
      force,
    );
  }

  if (
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds.ecs:read')
  ) {
    loadResource(
      'nodes',
      () => fetchHarvesterNodes(cloudId, force),
      (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterNodes(Array.isArray(list) ? list : []);
        setRawNodes(json || null);
      },
      force,
    );
  }

  loadResource(
    'namespaces',
    () => fetchHarvesterNamespaces(cloudId, force, true),
    (json) => {
      const list: any[] = Array.isArray((json as any)?.data?.items)
        ? (json as any).data.items
        : Array.isArray((json as any)?.items)
          ? (json as any).items
          : [];
      setHarvesterNamespaces(Array.isArray(list) ? list : []);
      setRawNamespaces(json || null);
    },
    force,
  );

  loadResource(
    'capabilities',
    () => fetchHarvesterCapabilities(cloudId),
    (json) => {
      setCapabilities(json?.data || null);
    },
    force,
  );
}
