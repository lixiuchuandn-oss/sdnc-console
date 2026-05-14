/**
 * Cloudmap 资源池详情：RBAC / License 派生的门控布尔量与 checkPerm。
 */
import { useCallback, useMemo } from 'react';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { useLicense } from '../../../../../../contexts/LicenseContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import {
  CLOUD_CONTAINERS_READ,
  CLOUD_PROVIDER_NETWORKS_READ,
  CLOUD_SUBNETS_FLAT_READ,
  CLOUD_SUBNETS_PUBLIC_READ,
  CLOUD_SUBNETS_VPC_READ,
} from '../../../../../../constants/cloudPermissions';
import { ALL_CLOUD_CONTAINER_SUB_READ } from '../../../../../../utils/permissionUtils';

export type CloudmapPoolPermissions = {
  checkPerm: (act: string) => boolean;
  isTenant: boolean;
  canReadVpcSubnets: boolean;
  canReadFlatSubnets: boolean;
  canReadPublicSubnets: boolean;
  canReadNetworkScope: boolean;
  canReadLoadBalancers: boolean;
  canViewMonitoringTab: boolean;
  canViewLoggingTab: boolean;
  canViewClusterGroup: boolean;
  canViewComputeGroup: boolean;
  canViewCloudDatabaseTab: boolean;
  /** 虚拟网元（Cloudmap 侧栏：虚拟路由、负载均衡等池内网络能力） */
  canViewOniaasNetworkTab: boolean;
  canViewContainersGroup: boolean;
  canViewStorageGroup: boolean;
  /** Rook 对象网关 / COSI（与云存储同级池内 Tab） */
  canViewObjectStorageGroup: boolean;
  /** Rook-Ceph 总览（原云存储子 Tab，现独立池内域） */
  canViewCephGroup: boolean;
  canViewBackupsGroup: boolean;
  canViewFlatNetworkGroup: boolean;
  canViewKubeOvnGroup: boolean;
  ovnVpcEnabled: boolean;
};

export function useCloudmapPoolPermissions(): CloudmapPoolPermissions {
  const { user } = useAuth();
  const permissions = user?.permissions;
  const isTenant = user?.role === 'tenant' || (user as any)?.tenantId;

  const checkPerm = useCallback(
    (act: string) => hasPermissionForAction(permissions || [], act),
    [permissions],
  );

  const canReadVpcSubnets =
    checkPerm(CLOUD_SUBNETS_VPC_READ) || checkPerm('clouds.subnets:read');
  const canReadFlatSubnets =
    checkPerm(CLOUD_SUBNETS_FLAT_READ) || checkPerm('clouds.subnets:read');
  const canReadPublicSubnets =
    checkPerm(CLOUD_SUBNETS_PUBLIC_READ) || checkPerm('clouds.subnets:read');

  const canReadNetworkScopeBase =
    checkPerm('clouds.vpcs:read') ||
    canReadVpcSubnets ||
    canReadFlatSubnets ||
    canReadPublicSubnets ||
    checkPerm('clouds.security-groups.flat:read') ||
    checkPerm('clouds.security-groups.vpc:read') ||
    checkPerm('clouds.nads:read') ||
    checkPerm('clouds.networks:read') ||
    checkPerm('clouds:read');

  const canReadNetworkScope =
    canReadNetworkScopeBase ||
    checkPerm(CLOUD_PROVIDER_NETWORKS_READ) ||
    checkPerm('clouds.vlans:read');

  const canReadLoadBalancers =
    checkPerm('clouds.load-balancers:read') ||
    checkPerm('clouds.loadbalancers:read') ||
    checkPerm('clouds.nads:read') ||
    checkPerm('clouds:read');

  const canViewMonitoringTab =
    checkPerm('clouds.alerts:read') ||
    checkPerm('clouds.alert-rules:read') ||
    checkPerm('clouds.alert-policies:read') ||
    checkPerm('clouds.alert-receivers:read') ||
    checkPerm('clouds.alert-secrets:read');

  const canViewLoggingTab =
    checkPerm('clouds.log-targets:read') ||
    checkPerm('clouds.log-receivers:read') ||
    checkPerm('clouds.log-configs:read');

  const canViewClusterGroup =
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds.cluster-services:read') ||
    checkPerm('clouds.cluster-networks:read') ||
    checkPerm('clouds.namespaces:read') ||
    checkPerm('clouds.storage-classes:read') ||
    checkPerm('clouds.gpus:read') ||
    checkPerm('clouds.usb-devices:read') ||
    checkPerm('clouds.pci-devices:read') ||
    checkPerm('clouds.nads:read') ||
    checkPerm(CLOUD_PROVIDER_NETWORKS_READ) ||
    checkPerm('clouds.vlans:read') ||
    checkPerm('clouds:read');

  const canViewComputeGroup =
    checkPerm('clouds.ecs:read') ||
    checkPerm('clouds.templates:read') ||
    checkPerm('clouds.images:read') ||
    checkPerm('clouds.sshkeys:read') ||
    checkPerm('clouds.cloudinits:read') ||
    checkPerm('clouds.recycle-bin:read') ||
    checkPerm('clouds.migrations:read') ||
    checkPerm('clouds:read');

  const canViewCloudDatabaseTab =
    checkPerm('clouds.ecs:read') || checkPerm('clouds:read');

  const canViewOniaasNetworkTab =
    checkPerm('clouds.ecs:read') || checkPerm('clouds:read') || canReadLoadBalancers;

  const canViewContainersGroup =
    checkPerm(CLOUD_CONTAINERS_READ) ||
    checkPerm('clouds:read') ||
    ALL_CLOUD_CONTAINER_SUB_READ.some((a) => checkPerm(a));

  const canViewStorageGroup =
    checkPerm('clouds.disks:read') ||
    checkPerm('clouds.snapshots:read') ||
    checkPerm('clouds.storage-classes:read') ||
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds:read');

  const canViewCephGroup =
    checkPerm('clouds.disks:read') ||
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds:read');

  const canViewObjectStorageGroup = canViewCephGroup;

  const canViewBackupsGroup =
    checkPerm('clouds.backups:read') ||
    checkPerm('clouds.restore-tasks:read') ||
    checkPerm('clouds:read');

  const canViewFlatNetworkGroup =
    checkPerm('clouds:read') ||
    canReadFlatSubnets ||
    checkPerm('clouds.security-groups.flat:read') ||
    checkPerm('clouds.eips.flat:read') ||
    checkPerm('clouds.fips.flat:read') ||
    checkPerm('clouds.snat.flat:read') ||
    checkPerm('clouds.dnat.flat:read');

  const canViewKubeOvnGroup =
    checkPerm('clouds:read') ||
    checkPerm('clouds.vpcs:read') ||
    canReadVpcSubnets ||
    checkPerm('clouds.security-groups.vpc:read') ||
    checkPerm('clouds.eips.vpc:read') ||
    checkPerm('clouds.fips.vpc:read') ||
    checkPerm('clouds.dnat.vpc:read') ||
    checkPerm('clouds.snat.vpc:read') ||
    checkPerm('clouds.traffic-mirroring.vpc:read');

  const { hasFeature } = useLicense();
  const ovnVpcEnabled = hasFeature('network.ovn.vpc');

  return {
    checkPerm,
    isTenant,
    canReadVpcSubnets,
    canReadFlatSubnets,
    canReadPublicSubnets,
    canReadNetworkScope,
    canReadLoadBalancers,
    canViewMonitoringTab,
    canViewLoggingTab,
    canViewClusterGroup,
    canViewComputeGroup,
    canViewCloudDatabaseTab,
    canViewOniaasNetworkTab,
    canViewContainersGroup,
    canViewStorageGroup,
    canViewObjectStorageGroup,
    canViewCephGroup,
    canViewBackupsGroup,
    canViewFlatNetworkGroup,
    canViewKubeOvnGroup,
    ovnVpcEnabled,
  };
}
