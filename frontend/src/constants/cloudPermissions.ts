/**
 * 云资源相关权限原子（与 backend/src/constants/permissions.ts 保持一致）
 */

import { hasPermissionForAction } from '../utils/accessMapping';

/** 资源池管理：列表与详情页路由门控（与 Tab 级 clouds.* 解耦） */
export const CLOUD_RESOURCE_POOLS_READ = 'clouds.resource-pools:read';
export const CLOUD_RESOURCE_POOLS_WRITE = 'clouds.resource-pools:write';

/** 资源池接入向导：新建 / 编辑 / 连接测试（与 CloudWizardeasy、后端原子对齐） */
export const CLOUD_RESOURCE_POOLS_CREATE_WRITE = 'clouds.resource-pools.create:write';

/** 虚拟机创建向导：入口按钮与 /instances/create 路由页门控 */
export const CLOUD_VM_CREATE_WIZARD_WRITE = 'clouds.vm-create-wizard:write';

/** 云主机列表「快速创建」入口；与创建向导一致，仅门控 UI，具体操作由后端/API 校验 */
export const CLOUD_VM_QUICK_CREATE_WRITE = 'clouds.vm-quick-create:write';

/**
 * 子网分域门控（与 clouds.vpcs 解耦：VPC 写权限不隐含子网写）：
 * - 优先命中下面分域原子；
 * - 未拆分时回退 clouds.subnets:*；超级管理员 clouds:write / clouds:read。
 */
export const CLOUD_SUBNETS_VPC_READ = 'clouds.subnets.vpc:read';
export const CLOUD_SUBNETS_VPC_WRITE = 'clouds.subnets.vpc:write';
export const CLOUD_SUBNETS_FLAT_READ = 'clouds.subnets.flat:read';
export const CLOUD_SUBNETS_FLAT_WRITE = 'clouds.subnets.flat:write';
export const CLOUD_SUBNETS_PUBLIC_READ = 'clouds.subnets.public:read';
export const CLOUD_SUBNETS_PUBLIC_WRITE = 'clouds.subnets.public:write';

/** Kube-OVN VPC 读（不含子网写；子网列表只读见 hasKubeOvnVpcSubnetRead） */
export function hasKubeOvnVpcWrite(perms: string[]): boolean {
  return (
    hasPermissionForAction(perms, 'clouds.vpcs:write') || hasPermissionForAction(perms, 'clouds:write')
  );
}

/** Kube-OVN VPC 子网读（含 clouds.vpcs:read：VPC 页展开子网；不含子网写） */
export function hasKubeOvnVpcSubnetRead(perms: string[]): boolean {
  return (
    hasPermissionForAction(perms, CLOUD_SUBNETS_VPC_READ) ||
    hasPermissionForAction(perms, 'clouds.subnets:read') ||
    hasPermissionForAction(perms, 'clouds.vpcs:read') ||
    hasPermissionForAction(perms, 'clouds:read')
  );
}

/** Kube-OVN VPC 子网写（不含 clouds.vpcs:write） */
export function hasKubeOvnVpcSubnetWrite(perms: string[]): boolean {
  return (
    hasPermissionForAction(perms, CLOUD_SUBNETS_VPC_WRITE) ||
    hasPermissionForAction(perms, 'clouds.subnets:write') ||
    hasPermissionForAction(perms, 'clouds:write')
  );
}

/** Kube-OVN 扁平子网写（不含 clouds.vpcs:write） */
export function hasKubeOvnFlatSubnetWrite(perms: string[]): boolean {
  return (
    hasPermissionForAction(perms, CLOUD_SUBNETS_FLAT_WRITE) ||
    hasPermissionForAction(perms, 'clouds.subnets:write') ||
    hasPermissionForAction(perms, 'clouds:write')
  );
}

/** Kube-OVN 公共子网写（不含 clouds.vpcs:write） */
export function hasKubeOvnPublicSubnetWrite(perms: string[]): boolean {
  return (
    hasPermissionForAction(perms, CLOUD_SUBNETS_PUBLIC_WRITE) ||
    hasPermissionForAction(perms, 'clouds.subnets:write') ||
    hasPermissionForAction(perms, 'clouds:write')
  );
}

/** @deprecated 请按子域授权；见 permissionUtils LEGACY_CLOUD_CONTAINERS_* */
export {
  LEGACY_CLOUD_CONTAINERS_READ as CLOUD_CONTAINERS_READ,
  LEGACY_CLOUD_CONTAINERS_WRITE as CLOUD_CONTAINERS_WRITE,
} from '../utils/permissionUtils';

/** Cloudmap 资源总览 · 监控大盘（/monitoring/* 概览类 API） */
export const CLOUD_MONITORING_OVERVIEW_READ = 'clouds.monitoring.overview:read';

/** 云监控 · 运维监控（Prometheus 大盘；与资源总览「集群总览」共用 monitoring API 权限基） */
export const CLOUD_ALERTS_READ = 'clouds.alerts:read';
export const CLOUD_ALERTS_WRITE = 'clouds.alerts:write';
export const CLOUD_ALERT_RULES_READ = 'clouds.alert-rules:read';
export const CLOUD_ALERT_RULES_WRITE = 'clouds.alert-rules:write';
export const CLOUD_ALERT_POLICIES_READ = 'clouds.alert-policies:read';
export const CLOUD_ALERT_POLICIES_WRITE = 'clouds.alert-policies:write';
export const CLOUD_ALERT_RECEIVERS_READ = 'clouds.alert-receivers:read';
export const CLOUD_ALERT_RECEIVERS_WRITE = 'clouds.alert-receivers:write';
export const CLOUD_ALERT_SECRETS_READ = 'clouds.alert-secrets:read';
export const CLOUD_ALERT_SECRETS_WRITE = 'clouds.alert-secrets:write';

/** 资源总览 · 机房拓扑（机柜/柜内占位；与物理节点/交换机 Tab 解耦） */
export const CLOUD_DATACENTER_TOPOLOGY_READ = 'clouds.dc-topology:read';
export const CLOUD_DATACENTER_TOPOLOGY_WRITE = 'clouds.dc-topology:write';

/** 资源总览 · 网络拓扑（纯展示） */
export const CLOUD_NETWORK_TOPOLOGY_READ = 'clouds.net-topology:read';

/** 统一存储（Rook / RGW）；见 unifiedStoragePermissions.ts */
export {
  CLOUD_UNIFIED_STORAGE_READ,
  CLOUD_UNIFIED_STORAGE_WRITE,
  CLOUD_STORAGE_DASHBOARD_READ,
  CLOUD_STORAGE_ADDON_READ,
  CLOUD_UNIFIED_STORAGE_POOLS_READ,
  CLOUD_STORAGE_RBD_MIRROR_READ,
  CLOUD_STORAGE_S3_BUCKETS_READ,
  CLOUD_STORAGE_RGW_USERS_READ,
  CLOUD_STORAGE_OBJECT_GATEWAY_READ,
  CLOUD_STORAGE_COSI_READ,
  LEGACY_CLOUD_CEPH_READ,
} from './unifiedStoragePermissions';

/** @deprecated 新代码请用 CLOUD_UNIFIED_STORAGE_READ 或子域常量 */
export { LEGACY_CLOUD_CEPH_READ as CLOUD_CEPH_READ } from './unifiedStoragePermissions';

/** Cloudmap · 云数据库（池内 paas_databases；当前 RDS 页） */
export const CLOUD_PAAS_DATABASES_READ = 'clouds.paas-databases:read';

/** Cloudmap · 虚拟路由器（池内 oniaas_network/virtual_routers） */
export const CLOUD_VNE_READ = 'clouds.vne:read';

/** Kube-OVN Provider Network（物理网络）列表与详情抽屉（读） */
export const CLOUD_PROVIDER_NETWORKS_READ = 'clouds.provider-networks:read';
/** 物理网络创建、删除等写操作 */
export const CLOUD_PROVIDER_NETWORKS_WRITE = 'clouds.provider-networks:write';
