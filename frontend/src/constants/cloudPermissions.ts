/**
 * 云资源相关权限原子（与 backend/src/constants/permissions.ts 保持一致）
 */

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
