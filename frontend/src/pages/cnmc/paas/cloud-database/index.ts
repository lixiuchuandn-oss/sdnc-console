/**
 * 云数据库（PaaS）相关 UI：列表 / 备份子 Tab / 创建与管理弹窗等。
 * 归属 **pages/cnmc/paas**，不放在 **cnmc/clouds/Harvester/**；创建向导仍依赖 Harvester 下 VM 向导与 kube-ovn 常量。
 */
export { default as PaasSection } from './sections/PaasSection';
export { default as PaasBackupsSection } from './sections/PaasBackupsSection';
/** @deprecated 使用 PaasSection */
export { default as RdsSection } from './sections/PaasSection';
export { default as RdsCreateModal } from './modals/RdsCreateModal';
export { default as RdsManageDrawer } from './drawers/RdsManageDrawer';
export { default as RdsInstanceLabelEditModal } from './modals/RdsInstanceLabelEditModal';
export { default as RdsDatabaseConsoleModal, RDS_DATABASE_CONSOLE_URL } from './modals/RdsDatabaseConsoleModal';