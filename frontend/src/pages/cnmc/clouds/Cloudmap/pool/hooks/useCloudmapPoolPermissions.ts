/**
 * Cloudmap 资源池详情：RBAC / License 派生的门控布尔量与 checkPerm。
 */
import { useCallback, useMemo } from 'react';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { useLicense } from '../../../../../../contexts/LicenseContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { readActionToWrite } from '../../../../../../utils/rbacUi';
import {
  CLOUD_MONITORING_OVERVIEW_READ,
  CLOUD_ALERTS_READ,
  CLOUD_ALERT_RULES_READ,
  CLOUD_ALERT_POLICIES_READ,
  CLOUD_ALERT_RECEIVERS_READ,
  CLOUD_ALERT_SECRETS_READ,
  CLOUD_PAAS_DATABASES_READ,
  CLOUD_PROVIDER_NETWORKS_READ,
  CLOUD_VNE_READ,
  CLOUD_SUBNETS_FLAT_READ,
  CLOUD_SUBNETS_PUBLIC_READ,
  CLOUD_SUBNETS_VPC_READ,
} from '../../../../../../constants/cloudPermissions';
import { canViewAnyContainerSubPage } from '../../../../../../utils/permissionUtils';
import type { CloudmapResourceSubKey } from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import {
  canAccessPoolPage,
  canAccessResourceHubSub,
  firstAccessibleResourceHubSub,
} from '../lib/poolPageReadAccess';
import {
  canEnterClusterGroup,
  canEnterUnifiedStorageGroup,
  canViewComputeClusterInner,
  canViewComputeResourceInner,
  firstAccessibleClusterPoolInnerSeg,
  firstAccessibleComputeResourceInnerSeg,
} from '../lib/clusterPageAccess';
import {
  isComputeClusterInnerSeg,
  isComputeResourceInnerSeg,
  remapLegacyClusterInnerSeg,
} from '../../../Harvester/cluster/lib/computeResourcesNav';

export type CloudmapPoolPermissions = {
  checkPerm: (act: string) => boolean;
  /** 由 read atom 推导对应 write（用于隐藏写操作按钮） */
  checkWrite: (readAction: string) => boolean;
  isTenant: boolean;
  canReadVpcSubnets: boolean;
  canReadFlatSubnets: boolean;
  canReadPublicSubnets: boolean;
  canReadNetworkScope: boolean;
  /** 资源总览 · 网络拓扑（`clouds.net-topology:read`） */
  canViewNetworkTopology: boolean;
  canReadLoadBalancers: boolean;
  canViewMonitoringTab: boolean;
  /** 资源总览 · 集群总览（与 poolPageAction `clouds.monitoring.overview:read` 对齐） */
  canViewMonitoringOverview: boolean;
  canAccessResourceHubSub: (sub: CloudmapResourceSubKey) => boolean;
  resolveResourceHubSubAccess: (requested: CloudmapResourceSubKey) => CloudmapResourceSubKey | null;
  canViewLoggingTab: boolean;
  canViewClusterGroup: boolean;
  resolveClusterPoolInnerAccess: (requested: string) => string | null;
  canViewComputeGroup: boolean;
  canViewCloudDatabaseTab: boolean;
  /** 虚拟网元（Cloudmap 侧栏：虚拟路由、负载均衡等池内网络能力） */
  canViewOniaasNetworkTab: boolean;
  canViewContainersGroup: boolean;
  canViewStorageGroup: boolean;
  /** 统一存储（块/RBD/对象/RGW） */
  canViewUnifiedStorageGroup: boolean;
  /** @deprecated 与 `canViewUnifiedStorageGroup` 同义，兼容旧引用 */
  canViewObjectStorageGroup: boolean;
  /** @deprecated 与 `canViewUnifiedStorageGroup` 同义，兼容旧引用 */
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

  const checkWrite = useCallback(
    (readAction: string) => hasPermissionForAction(permissions || [], readActionToWrite(readAction)),
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
    checkPerm(CLOUD_MONITORING_OVERVIEW_READ) ||
    checkPerm(CLOUD_ALERTS_READ) ||
    checkPerm(CLOUD_ALERT_RULES_READ) ||
    checkPerm(CLOUD_ALERT_POLICIES_READ) ||
    checkPerm(CLOUD_ALERT_RECEIVERS_READ) ||
    checkPerm(CLOUD_ALERT_SECRETS_READ);

  const canAccessResourceHubSubFn = useCallback(
    (sub: CloudmapResourceSubKey) => canAccessResourceHubSub(checkPerm, sub),
    [checkPerm],
  );

  const resolveResourceHubSubAccess = useCallback(
    (requested: CloudmapResourceSubKey) => {
      if (canAccessResourceHubSub(checkPerm, requested)) return requested;
      return firstAccessibleResourceHubSub(checkPerm);
    },
    [checkPerm],
  );

  const canViewMonitoringOverview = canAccessResourceHubSubFn('overview');

  const canViewNetworkTopology = canAccessPoolPage(checkPerm, 'resource_hub/network_topology');

  const canViewLoggingTab =
    checkPerm('clouds.log-targets:read') ||
    checkPerm('clouds.log-receivers:read') ||
    checkPerm('clouds.log-configs:read');

  const clusterVisCtx = useMemo(
    () => ({
      canReadPublicSubnets,
      canReadNetworkScope,
      canReadLoadBalancers,
    }),
    [canReadPublicSubnets, canReadNetworkScope, canReadLoadBalancers],
  );

  const canViewClusterGroup = useMemo(
    () => canEnterClusterGroup(checkPerm, clusterVisCtx),
    [checkPerm, clusterVisCtx],
  );

  const resolveClusterPoolInnerAccess = useCallback(
    (requested: string) => {
      if (!canViewClusterGroup) return null;
      const normalized = remapLegacyClusterInnerSeg(requested);
      if (isComputeClusterInnerSeg(normalized)) {
        if (canViewComputeClusterInner(checkPerm)) return normalized;
        return firstAccessibleClusterPoolInnerSeg(checkPerm, clusterVisCtx);
      }
      if (isComputeResourceInnerSeg(normalized)) {
        if (canViewComputeResourceInner(normalized, checkPerm)) return normalized;
        return firstAccessibleComputeResourceInnerSeg(checkPerm);
      }
      if (canAccessPoolPage(checkPerm, `cluster/${normalized}`)) return normalized;
      return firstAccessibleClusterPoolInnerSeg(checkPerm, clusterVisCtx);
    },
    [checkPerm, canViewClusterGroup, clusterVisCtx],
  );

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
    checkPerm(CLOUD_PAAS_DATABASES_READ) ||
    checkPerm('clouds.ecs:read') ||
    checkPerm('clouds:read');

  const canViewOniaasNetworkTab =
    checkPerm(CLOUD_VNE_READ) ||
    checkPerm('clouds.ecs:read') ||
    canReadLoadBalancers ||
    checkPerm('clouds:read');

  const canViewContainersGroup =
    canViewAnyContainerSubPage(checkPerm) || checkPerm('harbor.registry:read');

  const canViewStorageGroup =
    checkPerm('clouds.disks:read') ||
    checkPerm('clouds.snapshots:read') ||
    checkPerm('clouds.storage-classes:read') ||
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds:read');

  const canViewUnifiedStorageGroup = useMemo(
    () => canEnterUnifiedStorageGroup(checkPerm),
    [checkPerm],
  );

  const canViewCephGroup = canViewUnifiedStorageGroup;
  const canViewObjectStorageGroup = canViewUnifiedStorageGroup;

  const canViewBackupsGroup =
    checkPerm('clouds.backups:read') ||
    checkPerm('clouds.vm-backup-snapshots:read') ||
    checkPerm('clouds.schedules:read') ||
    checkPerm('clouds.restore-tasks:read') ||
    checkPerm('clouds:read');

  const canViewFlatNetworkGroup =
    checkPerm('clouds:read') ||
    canReadFlatSubnets ||
    checkPerm('clouds.security-groups.flat:read') ||
    checkPerm('clouds.eips.flat:read') ||
    checkPerm('clouds.snat.flat:read') ||
    checkPerm('clouds.dnat.flat:read');

  const { hasFeature } = useLicense();
  const ovnVpcEnabled = hasFeature('network.ovn.vpc');

  /** VPC 网络整组须已开通 network.ovn.vpc，与扁平网络门控分离 */
  const canViewKubeOvnGroup =
    ovnVpcEnabled &&
    (checkPerm('clouds:read') ||
      checkPerm('clouds.vpcs:read') ||
      canReadVpcSubnets ||
      checkPerm('clouds.security-groups.vpc:read') ||
      checkPerm('clouds.eips.vpc:read') ||
      checkPerm('clouds.dnat.vpc:read') ||
      checkPerm('clouds.snat.vpc:read') ||
      checkPerm('clouds.traffic-mirroring.vpc:read'));

  return {
    checkPerm,
    checkWrite,
    isTenant,
    canReadVpcSubnets,
    canReadFlatSubnets,
    canReadPublicSubnets,
    canReadNetworkScope,
    canViewNetworkTopology,
    canReadLoadBalancers,
    canViewMonitoringTab,
    canViewMonitoringOverview,
    canAccessResourceHubSub: canAccessResourceHubSubFn,
    resolveResourceHubSubAccess,
    canViewLoggingTab,
    canViewClusterGroup,
    resolveClusterPoolInnerAccess,
    canViewComputeGroup,
    canViewCloudDatabaseTab,
    canViewOniaasNetworkTab,
    canViewContainersGroup,
    canViewStorageGroup,
    canViewUnifiedStorageGroup,
    canViewObjectStorageGroup,
    canViewCephGroup,
    canViewBackupsGroup,
    canViewFlatNetworkGroup,
    canViewKubeOvnGroup,
    ovnVpcEnabled,
  };
}
