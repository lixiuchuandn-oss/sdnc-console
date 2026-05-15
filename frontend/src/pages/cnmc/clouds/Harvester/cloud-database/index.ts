/**
 * 云数据库（PaaS）相关 UI：列表、创建与管理弹窗等。
 * 仅适用于 **Cloudmap 资源池（Harvester）** 上的云数据库托管 VM；与侧栏/路由 `paas_databases` 对应。源码在 **pages/cnmc/clouds/Harvester/cloud-database/**（与 `ecs`/`kube-ovn` 等域同级），创建向导复用同树 **ecs**、**kube-ovn**。
 */
export { default as PaasSection } from './sections/PaasSection';
/** @deprecated 使用 PaasSection */
export { default as RdsSection } from './sections/PaasSection';
export { default as RdsCreateModal } from './modals/RdsCreateModal';
export { default as RdsManageDrawer } from './drawers/RdsManageDrawer';
export { default as RdsInstanceLabelEditModal } from './modals/RdsInstanceLabelEditModal';
export {
  default as RdsDatabaseConsoleModal,
  buildRdsDatabaseConsoleUrl,
  readRdsVmPrimaryIp,
} from './modals/RdsDatabaseConsoleModal';