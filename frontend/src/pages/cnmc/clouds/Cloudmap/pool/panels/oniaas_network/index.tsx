/**
 * Cloudmap 详情 — 虚拟网元：侧栏 `oniaas_network/*`；业务在 `Harvester/vne`、`Harvester/nad`。
 * 虚拟路由创建弹窗依赖数据与 `paas_databases` 同源（镜像/子网/NAD/存储类）。
 */
import React from 'react';
import { Empty } from 'antd';
import { CLOUD_VNE_READ } from '../../../../../../../constants/cloudPermissions';
import LoadBalancersSection from '../../../../Harvester/nad/sections/LoadBalancersSection';
import { VirtualRouterSection } from '../../../../Harvester/vne';
import {
  fetchHarvesterImages,
  fetchHarvesterNads,
  fetchHarvesterStorageClasses,
  fetchKubeOvnSubnets,
} from '../../api';

export type CloudmapOniaasNetworkRoutePanelProps = {
  cloudId: string;
  innerActiveKey: string;
  /** 与云数据库 `PaasSection` 同源：全量 VM，虚拟路由页内按 `tower.io/vne-router` 筛选 */
  ecs: any[];
  ecsLoading: boolean;
  onRefreshVms: () => void | Promise<void>;
  onForceRefreshVms: () => void | Promise<void>;
  canReadLoadBalancers: boolean;
  isTenant: boolean;
  harvesterLoadBalancers: any[];
  loadTabResource: (key: string, force?: boolean) => void | Promise<void>;
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
  onRefreshVms,
  onForceRefreshVms,
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
        onRefresh={onRefreshVms}
        onForceRefresh={onForceRefreshVms}
        isTenant={isTenant}
        images={harvesterImages}
        storageClasses={harvesterStorageClasses}
        kubeSubnets={kubeOvnSubnets}
        harvesterNads={harvesterNads}
        onReloadImages={
          checkPerm('clouds.images:read') || checkPerm('clouds.ecs:read')
            ? () =>
                loadResource(
                  'images',
                  () => fetchHarvesterImages(cloudId, true),
                  (json: any) => setHarvesterImages((json as any)?.data?.items || []),
                  true,
                )
            : undefined
        }
        onReloadSubnets={
          canReadFlatSubnets ||
          canReadVpcSubnets ||
          checkPerm('clouds.networks:read')
            ? () =>
                loadResource(
                  'subnets',
                  () => fetchKubeOvnSubnets(cloudId, true),
                  (json) => setKubeOvnSubnets((json as any)?.data?.items || []),
                  true,
                )
            : undefined
        }
        onReloadNads={
          checkPerm('clouds.networks:read')
            ? () =>
                loadResource(
                  'nads',
                  () => fetchHarvesterNads(cloudId, true),
                  (json: any) => setHarvesterNads((json as any)?.data?.items || []),
                  true,
                )
            : undefined
        }
        onReloadStorageClasses={
          checkPerm('clouds.disks:read') || checkPerm('clouds.ecs:read')
            ? () =>
                loadResource(
                  'storageClasses',
                  () => fetchHarvesterStorageClasses(cloudId, true),
                  (json: any) => setHarvesterStorageClasses((json as any)?.data?.items || []),
                  true,
                )
            : undefined
        }
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
        onRefresh={() => void loadTabResource('slb', true)}
        namespaces={namespacesForLb}
        isTenant={isTenant}
      />
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapOniaasNetworkRoutePanel;
