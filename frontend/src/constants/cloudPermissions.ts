/**
 * 云资源相关权限原子（与 backend/src/constants/permissions.ts 保持一致）
 */

/** 资源池管理：列表与详情页路由门控（与 Tab 级 clouds.* 解耦） */
export const CLOUD_RESOURCE_POOLS_READ = 'clouds.resource-pools:read';
export const CLOUD_RESOURCE_POOLS_WRITE = 'clouds.resource-pools:write';

/** 虚拟机创建向导：入口按钮与 /instances/create 路由页门控 */
export const CLOUD_VM_CREATE_WIZARD_WRITE = 'clouds.vm-create-wizard:write';

/** Cloudmap：标准/运维视图切换（需具备该权限方可选「运维」） */
export const CLOUD_CLOUDMAP_OPS_VIEW_WRITE = 'clouds.cloudmap.ops-view:write';

/**
 * 子网分域门控（前端先行）：
 * - 若后端已下发细粒度权限，优先命中下面三个原子；
 * - 若后端尚未拆分，页面会回退使用 clouds.subnets:* 兼容老模型。
 */
export const CLOUD_SUBNETS_VPC_READ = 'clouds.subnets.vpc:read';
export const CLOUD_SUBNETS_VPC_WRITE = 'clouds.subnets.vpc:write';
export const CLOUD_SUBNETS_FLAT_READ = 'clouds.subnets.flat:read';
export const CLOUD_SUBNETS_FLAT_WRITE = 'clouds.subnets.flat:write';
export const CLOUD_SUBNETS_PUBLIC_READ = 'clouds.subnets.public:read';
export const CLOUD_SUBNETS_PUBLIC_WRITE = 'clouds.subnets.public:write';

/** Kube-OVN Provider Network（物理网络）列表与详情抽屉（读） */
export const CLOUD_PROVIDER_NETWORKS_READ = 'clouds.provider-networks:read';
/** 物理网络创建、删除等写操作 */
export const CLOUD_PROVIDER_NETWORKS_WRITE = 'clouds.provider-networks:write';
