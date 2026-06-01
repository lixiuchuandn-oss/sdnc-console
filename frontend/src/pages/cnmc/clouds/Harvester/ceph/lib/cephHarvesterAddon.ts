/**
 * Harvester rook-ceph Addon：统一导出入口（实现已拆至同目录 `cephHarvesterAddon*.ts`）。
 */

export { normalizeDeviceNames } from './harvesterAddonFormUtils';
export type {
  BlockDeviceDriveKind,
  CephBlockDeviceOption,
} from './cephHarvesterBlockDevices';
export {
  blockDeviceDriveKindIconColor,
  blockDeviceDriveKindLabel,
  blockDeviceDriveKindTagColor,
  blockDeviceOptionTooltip,
  buildMetadataDeviceSelectOptions,
  createMetadataDeviceSizeLookup,
  describeSelectedBlockDevices,
  formatBlockDeviceOptionSummary,
  formatBlockDeviceSizeBytes,
  formatBlockDeviceStorageController,
  isBlockDevicePartition,
  isCephOsdCandidateDeviceName,
  isPartitionDevPath,
  isRemovableBlockDevice,
  mergeConfiguredBlockDeviceOptions,
  parseBlockDeviceOptions,
  parseNodeNameOptions,
  resolveBlockDeviceDriveKind,
  resolveBlockDeviceNodeName,
  resolveBlockDeviceSizeMB,
} from './cephHarvesterBlockDevices';

export type {
  CephHarvesterAddonApplyPayload,
  CephHarvesterAddonFormValues,
  CephHarvesterAddonFormValuesWithOverride,
  CephHarvesterAddonNodeDevice,
  CephHarvesterAddonNodeFormRow,
  CephHarvesterAddonPhase,
  CephHarvesterAddonStatus,
  CephHarvesterAddonValuesConfig,
} from './cephHarvesterAddonTypes';
export {
  CEPH_HARVESTER_DEFAULT_CEPH_IMAGE,
  CEPH_HARVESTER_DEFAULT_ROOK_OPERATOR_IMAGE,
} from './cephHarvesterAddonTypes';

export {
  buildAllNodesEmptyDeviceRows,
  buildDefaultHarvesterAddonFormValues,
  buildHarvesterAddonFormValuesFromStatus,
  configToFormValues,
  defaultCephHarvesterAddonValuesConfig,
  defaultNodeDeviceFormRows,
  flattenNodeDevicesFromForm,
  formValuesToApplyConfig,
  groupNodeDevicesForForm,
  isDefaultEmptyWizardNodeRows,
  normalizeDatabaseSizeMBInput,
  parseDatabaseSizeMB,
} from './cephHarvesterAddonForm';

export type { MetadataDeviceSizeLookup } from './cephHarvesterAddonValidation';
export {
  baselineNodeDeviceKeySet,
  baselineNodeNameSet,
  listConfiguredNodeDevices,
  suggestDatabaseSizeMBPerOsd,
  validateAddonConfig,
  validateNodeMetadataDeviceRows,
  validateRunningClusterConfigChange,
} from './cephHarvesterAddonValidation';

export {
  addonPhaseLabel,
  addonPhaseTagColor,
  isCephHarvesterAddonRunning,
} from './cephHarvesterAddonPhaseUi';
