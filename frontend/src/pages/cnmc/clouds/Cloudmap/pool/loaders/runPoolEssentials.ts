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
} from '../api';
import type { PoolEssentialsDeps } from './poolDataDeps';

/**
 * 首屏/进入池时拉取多域共用的底稿：云、ECS、NAD、VPC/子网、镜像、盘、
 * 节点、命名空间、能力等（与 `runPathResourceLoad` 按需补拉互补）。
 */
export function runPoolEssentials(
  force: boolean,
  d: PoolEssentialsDeps,
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

  const wantsFlatNatContext =
    checkPerm('clouds.eips.flat:read') ||
    checkPerm('clouds.fips.flat:read') ||
    checkPerm('clouds.snat.flat:read') ||
    checkPerm('clouds.dnat.flat:read');

  /** 业务 VPC 列表（scope=vpc）须 network.ovn.vpc */
  const shouldPrefetchBusinessVpcs =
    ovnVpcEnabled && (canViewKubeOvnGroup || wantsFlatNatContext);

  /** 扁平/公共子网、扁平 SNAT/DNAT 等仅需内置 underlay VPC，不占 ovn-vpc 授权 */
  const shouldPrefetchUnderlayVpcs =
    !shouldPrefetchBusinessVpcs &&
    (canReadFlatSubnets ||
      checkPerm('clouds.subnets.public:read') ||
      wantsFlatNatContext);

  if (shouldPrefetchBusinessVpcs) {
    const vpcScope =
      wantsFlatNatContext && !canViewKubeOvnGroup ? 'underlay' : 'vpc';
    loadResource(
      'vpcs',
      () => fetchKubeOvnVpcs(cloudId, force, false, vpcScope),
      (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnVpcs(Array.isArray(list) ? list : []);
        setRawVpcs(json || null);
      },
      force,
    );
  } else if (shouldPrefetchUnderlayVpcs) {
    loadResource(
      'vpcs',
      () => fetchKubeOvnVpcs(cloudId, force, false, 'underlay'),
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
