/**
 * Cloudmap 详情 — 虚拟网元：侧栏 `oniaas_network/*`；业务在 `Harvester/vne`、`Harvester/nad`。
 * 虚拟路由创建弹窗依赖数据与 `paas_databases` 同源（镜像/子网/NAD/存储类）。
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import { CLOUD_VNE_READ } from '../../../../../../../constants/cloudPermissions';
import LoadBalancersSection from '../../../../Harvester/nad/sections/LoadBalancersSection';
import { VirtualRouterSection } from '../../../../Harvester/vne';
import { createOniaasNetworkTabOnRefresh } from '../../loaders/oniaasNetworkRefresh';
import {
  fetchHarvesterImages,
  fetchHarvesterNads,
  fetchHarvesterStorageClasses,
  fetchKubeOvnSubnets,
} from '../../api';

export type CloudmapOniaasNetworkRoutePanelProps = {
  cloudId: string;
  innerActiveKey: string;
  /** 与云数据库 `PaasSection` 同源：全量 VM，虚拟路由页内按 VNE 标签筛选 */
  ecs: any[];
  ecsLoading: boolean;
  canReadLoadBalancers: boolean;
  isTenant: boolean;
  harvesterLoadBalancers: any[];
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
  resourceLoading: Record<string, boolean>;
  namespacesForLb?: any[];
  checkPerm: (act: string) => boolean;
  canReadFlatSubnets: boolean;
  canReadVpcSubnets: boolean;
  harvesterImages: any[];
  harvesterStorageClasses: any[];
  kubeOvnSubnets: any[];
  harvesterNads: any[];
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  setHarvesterImages: (v: any[] | ((prev: any[]) => any[])) => void;
  setKubeOvnSubnets: (v: any[] | ((prev: any[]) => any[])) => void;
  setHarvesterNads: (v: any[] | ((prev: any[]) => any[])) => void;
  setHarvesterStorageClasses: (v: any[] | ((prev: any[]) => any[])) => void;
  namespacesOptions: string[];
  /** 与计算域一致：Harvester Namespace 列表，供实例详情抽屉映射租户/组织等 */
  harvesterNamespaces?: any[];
  capabilities?: any;
};

const CloudmapOniaasNetworkRoutePanel: React.FC<CloudmapOniaasNetworkRoutePanelProps> = ({
  cloudId,
  innerActiveKey,
  ecs,
  ecsLoading,
  canReadLoadBalancers,
  isTenant,
  harvesterLoadBalancers,
  loadTabResource,
  resourceLoading,
  namespacesForLb = [],
  checkPerm,
  canReadFlatSubnets,
  canReadVpcSubnets,
  harvesterImages,
  harvesterStorageClasses,
  kubeOvnSubnets,
  harvesterNads,
  loadResource,
  setHarvesterImages,
  setKubeOvnSubnets,
  setHarvesterNads,
  setHarvesterStorageClasses,
  namespacesOptions,
  harvesterNamespaces = [],
  capabilities,
}) => {
  const seg = (innerActiveKey || '').trim() || 'virtual_routers';

  useEffect(() => {
    if (seg === 'virtual_routers') {
      void loadTabResource('virtual_routers', false);
    } else if (seg === 'slb') {
      void loadTabResource('slb', false);
    }
  }, [seg, cloudId, loadTabResource]);

  const refreshVmSectionAuxiliaries = useCallback(() => {
    if (checkPerm('clouds.images:read') || checkPerm('clouds.ecs:read')) {
      void loadTabResource('images', true);
    }
    if (
      canReadFlatSubnets ||
      canReadVpcSubnets ||
      checkPerm('clouds.networks:read')
    ) {
      void loadResource(
        'subnets',
        () => fetchKubeOvnSubnets(cloudId, true),
        (json) => setKubeOvnSubnets((json as any)?.data?.items || []),
        true,
      );
    }
    if (checkPerm('clouds.nads:read')) {
      void loadTabResource('nads', true);
    }
    if (
      checkPerm('clouds.storage-classes:read') ||
      checkPerm('clouds.disks:read') ||
      checkPerm('clouds.ecs:read')
    ) {
      void loadTabResource('storage_classes', true);
    }
  }, [
    checkPerm,
    canReadFlatSubnets,
    canReadVpcSubnets,
    cloudId,
    loadResource,
    loadTabResource,
    setKubeOvnSubnets,
  ]);

  const oniaasNetworkTabOnRefresh = useMemo(() => {
    const deps = { loadTabResource, refreshVmSectionAuxiliaries };
    return {
      virtual_routers: createOniaasNetworkTabOnRefresh('virtual_routers', deps),
      slb: createOniaasNetworkTabOnRefresh('slb', deps),
    };
  }, [loadTabResource, refreshVmSectionAuxiliaries]);

  const onReloadImages = useCallback(() => {
    if (!checkPerm('clouds.images:read') && !checkPerm('clouds.ecs:read')) {
      return;
    }
    void loadResource(
      'images',
      () => fetchHarvesterImages(cloudId, true),
      (json: any) => setHarvesterImages((json as any)?.data?.items || []),
      true,
    );
  }, [checkPerm, cloudId, loadResource, setHarvesterImages]);

  const onReloadSubnets = useCallback(() => {
    if (
      !canReadFlatSubnets &&
      !canReadVpcSubnets &&
      !checkPerm('clouds.networks:read')
    ) {
      return;
    }
    void loadResource(
      'subnets',
      () => fetchKubeOvnSubnets(cloudId, true),
      (json) => setKubeOvnSubnets((json as any)?.data?.items || []),
      true,
    );
  }, [
    canReadFlatSubnets,
    canReadVpcSubnets,
    checkPerm,
    cloudId,
    loadResource,
    setKubeOvnSubnets,
  ]);

  const onReloadNads = useCallback(() => {
    if (!checkPerm('clouds.networks:read')) return;
    void loadResource(
      'nads',
      () => fetchHarvesterNads(cloudId, true),
      (json: any) => setHarvesterNads((json as any)?.data?.items || []),
      true,
    );
  }, [checkPerm, cloudId, loadResource, setHarvesterNads]);

  const onReloadStorageClasses = useCallback(() => {
    if (
      !checkPerm('clouds.disks:read') &&
      !checkPerm('clouds.ecs:read') &&
      !checkPerm('clouds.storage-classes:read')
    ) {
      return;
    }
    void loadResource(
      'storageClasses',
      () => fetchHarvesterStorageClasses(cloudId, true),
      (json: any) =>
        setHarvesterStorageClasses((json as any)?.data?.items || []),
      true,
    );
  }, [checkPerm, cloudId, loadResource, setHarvesterStorageClasses]);

  if (seg === 'virtual_routers') {
    const canViewVr =
      checkPerm(CLOUD_VNE_READ) ||
      checkPerm('clouds.ecs:read') ||
      checkPerm('clouds:read');
    if (!canViewVr) {
      return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
    }
    return (
      <VirtualRouterSection
        vms={ecs}
        loading={ecsLoading}
        cloudId={cloudId}
        onRefresh={oniaasNetworkTabOnRefresh.virtual_routers}
        isTenant={isTenant}
        images={harvesterImages}
        storageClasses={harvesterStorageClasses}
        kubeSubnets={kubeOvnSubnets}
        harvesterNads={harvesterNads}
        onReloadImages={onReloadImages}
        onReloadSubnets={onReloadSubnets}
        onReloadNads={onReloadNads}
        onReloadStorageClasses={onReloadStorageClasses}
        namespacesOptions={namespacesOptions}
        namespaceRecords={harvesterNamespaces}
        clusterCapabilities={capabilities}
      />
    );
  }
  if (seg === 'slb') {
    if (!canReadLoadBalancers) {
      return <Empty description="无权限查看负载均衡" style={{ marginTop: 48 }} />;
    }
    return (
      <LoadBalancersSection
        cloudId={cloudId}
        loadBalancers={harvesterLoadBalancers}
        loading={!!resourceLoading.loadBalancers}
        onRefresh={oniaasNetworkTabOnRefresh.slb}
        namespaces={namespacesForLb}
        isTenant={isTenant}
      />
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapOniaasNetworkRoutePanel;
