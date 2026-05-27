// Harvester 对外统一客户端入口（Facade）。
// 分层设计：
// - 基础设施层：client.ts / types.ts / utils.ts
// - 领域服务层：cluster.ts / namespace.ts / vm.ts / lifecycle.ts / storage.ts / network.ts / peripherals.ts
// - 技术关注点层：inventory.ts（同步到 DB，提供 syncVmInventory / syncVolumeInventory / syncNetworkInventory 等入口）
// 设计约定：
// - vm.ts：VM 列表、详情、规格、VNC 等只读/编辑能力
// - lifecycle.ts：VM 生命周期与迁移（start/stop/reboot/pause/unpause/delete/migrate 等）
// - network.ts：Kube-OVN VPC/Subnet/LB/EIP/NAT 等网络能力
// - storage.ts：卷 / PVC / 镜像 / Snapshot / Backup / Secret / 模板 / Schedule 备份等存储域资源
// - cluster.ts：集群健康检查、集群能力、节点、Service、StorageClass 等 cluster 级信息
// - namespace.ts：命名空间的增删查（后续会结合租户/组织 ns-{orgId} 约束）
// - peripherals.ts：GPU / USB / PCI 等外设资源
// 注：库存同步逻辑集中在 inventory.ts，通过 syncXXX 函数写入本地 DB，
// 上层路由优先采用 “Inventory Cache First + Sync Fallback”，
// 仅在需要实时诊断时直接使用本文件聚合导出的 Direct API 能力。
export { HarvesterTestParams } from './types';
import { getHarvesterVMAggregated } from './vm_aggregated';
export { getHarvesterVMAggregated };
export { updateHarvesterVMSpec } from './vm_update';
export {
  listHarvesterVMsStandard,
  // 移除 buildHarvesterVMManifest,
  listKubevirtVMsRaw,
  listKubevirtVMIsRaw,
  listKubevirtVMsRawWithMeta,
  listKubevirtVMIsRawWithMeta,
  getHarvesterVM,
  createHarvesterVM,
  patchHarvesterVM, // Export the new function
  getHarvesterVmVncUrl,
  syncVmVolumeSize,
  harvesterAddVolumeToVM,
  harvesterRemoveVolumeFromVM,
  harvesterAddVolumeToVMDirect,
} from './vm';
export {
  harvesterStartVM,
  harvesterStopVM,
  harvesterRebootVM,
  harvesterSoftRebootVM,
  harvesterPauseVM,
  harvesterUnpauseVM,
  harvesterDeleteVM,
  harvesterForceDeleteVM,
  harvesterRestoreVM,
  harvesterMigrateVM,
  harvesterAbortMigration,
} from './lifecycle';
export {
  listHarvesterNADsStandard,
  listKubeOvnVpcs,
  createKubeOvnVpc,
  deleteKubeOvnVpc,
  updateKubeOvnVpc,
  listKubeOvnSubnets,
  updateHarvesterSubnet,
  listHarvesterLoadBalancers,
  listHarvesterLoadBalancerIPPools,
  createHarvesterLoadBalancer,
  listKubeOvnEips,
  listKubeOvnFips,
  listKubeOvnSnatRules,
  listKubeOvnDnatRules,
  listKubeOvnProviderNetworks,
  listKubeOvnVlans,
  listHarvesterClusterNetworks,
  listHarvesterClusterNetworkConfigs,
} from './network';
export {
  listHarvesterVolumesStandard,
  buildUsedPvcSetFromKubevirtVms,
  mapHarvesterPvcToAvailableVolumeItem,
  filterHarvesterAvailableVolumeItems,
  listHarvesterAvailableVolumesStandard,
  listHarvesterImagesStandard,
  listHarvesterImagesRaw,
  deleteHarvesterLonghornVolume,
  deleteHarvesterPVC,
  createHarvesterPVCVolume,
  listHarvesterPVCRaw, // Export the new function
  exportImageFromPVC,
  createVolumeSnapshot,
  updatePVCSpec,
  clonePVC,
  listHarvesterSnapshotClassesRaw,
  listHarvesterVirtualMachineSnapshots,
  listHarvesterVolumeSnapshots,
  listHarvesterBackupsStandard,
  listHarvesterSshKeysStandard,
  listHarvesterCloudInitsStandard,
  listHarvesterTemplatesRaw,
  listHarvesterTemplatesStandard,
  listHarvesterScheduleVmBackupsStandard,
  createHarvesterScheduleVmBackup,
  updateHarvesterScheduleVmBackup,
  deleteHarvesterScheduleVmBackup,
  createHarvesterVirtualMachineBackup,
  createHarvesterVirtualMachineRestore,
  listHarvesterVirtualMachineRestoresRaw,
  restoreVolumeSnapshot,
  deleteHarvesterVirtualMachineBackup,
  deleteHarvesterVirtualMachineSnapshot,
  deleteHarvesterVolumeSnapshot,
  createHarvesterSecret,
  deleteHarvesterSecret,
  resolveHarvesterDefaultStorageClassName,
  pickDefaultStorageClassNameFromRecords,
  vmImageStorageClassParametersForName,
  DEFAULT_VM_IMAGE_LONGHORN_STORAGE_CLASS_PARAMS,
  resolveVmImageStorageProfile,
  buildHarvesterVmImageSpecFields,
  vmImageCephHarvesterExtraAnnotations,
  classifyVmImageStorageKindByClassName,
  type VmImageStorageProfile,
  type VmImageStorageKind,
} from './storage';
export {
  vmShouldUseCephVmBackup,
  shouldFallbackToCephVmBackup,
  createHarvesterCephVmBackup,
  deleteHarvesterCephVmBackup,
  listHarvesterCephVmBackupsRaw,
  normalizeCephVmBackupForInventory,
  cephVmBackupReady,
  cephVmBackupManagerStatusValue,
  CEPH_VM_BACKUP_MANAGER_STATUS_KEY,
  isCephVmBackupResource,
  isCephVmRestoreResource,
  shouldFallbackToCephVmRestore,
  buildHarvesterCephVmRestoreBody,
  resolveCephVmRestoreType,
  findCephVmBackupByName,
  resolveCephBackupSourceVm,
  createHarvesterCephVmRestore,
  listHarvesterCephVmRestoresRaw,
  deleteHarvesterCephVmRestore,
} from './cephVmBackup';
export {
  isCephScheduleVmBackupResource,
  scheduleInventoryFieldsFromRaw,
  normalizeCephScheduleVmBackupForInventory,
  listHarvesterScheduleCephVmBackupsRaw,
  getHarvesterScheduleCephVmBackup,
  createHarvesterScheduleCephVmBackup,
  updateHarvesterScheduleCephVmBackup,
  deleteHarvesterScheduleCephVmBackup,
} from './cephVmScheduleBackup';
export {
  listHarvesterNodesStandard,
  listK8sNodesRaw,
  listHarvesterServices,
  listHarvesterIngresses,
  listHarvesterStorageClassesStandard,
  harvesterHealthCheck,
  testHarvesterConnection,
  getHarvesterCapabilities,
  listHarvesterSettingsRaw,
  getHarvesterSettingRaw,
  getHarvesterSettingValue,
  updateHarvesterSettingValue,
} from './cluster';
export {
  createHarvesterNamespace,
  patchHarvesterNamespaceMetadata,
  deleteHarvesterNamespace,
  listHarvesterNamespacesRaw,
  getHarvesterNamespaceRaw,
  isProtectedNamespace,
  isTowerManagedNamespace,
  getNamespaceScenario,
  TOWER_NAMESPACE_MANAGED_FINALIZER,
} from './namespace';
export {
  listHarvesterGpuResources,
  listHarvesterUsbResources,
  listHarvesterPciDevices,
  listHarvesterPciDeviceClaims,
  listHarvesterUsbDeviceClaims,
  createHarvesterUsbDeviceClaim,
  deleteHarvesterUsbDeviceClaim,
  deleteHarvesterPciDeviceClaim,
  buildHarvesterPciDeviceClaimIndex,
  findHarvesterPciClaimForPciRow,
  harvesterPciDeviceClaimPassthroughEnabled,
} from './peripherals';
