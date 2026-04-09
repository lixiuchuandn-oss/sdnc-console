/**
 * Harvester 缓存路由注册（策略模式+中间件）
 * 使用 provider-router 中间件统一处理不同供应商的路由分发
 */

import { Router, RequestHandler, json } from 'express';
import { createProviderRouter } from '../middleware/provider-router';
import { 
  harvesterVpcListHandler,
  harvesterVpcCreateHandler,
  harvesterVpcDeleteHandler,
  harvesterVpcUpdateHandler,
} from './handlers/ovn-cache-vpc.handlers';
import { harvesterEcsListHandler } from './handlers/ecs-cache-list.handlers';
import { harvesterSubnetListHandler } from './handlers/ovn-cache-subnets.handlers';
import { 
  harvesterNadListHandler,
  harvesterNadDetailHandler,
  harvesterNadCreateHandler,
  harvesterNadDeleteHandler,
} from './handlers/network-cache-nads.handlers';
import { harvesterClusterNetworkListHandler } from './handlers/network-cache-cluster-networks.handlers';
import { harvesterServiceCacheListHandler } from './handlers/network-cache-services.handlers';
import { 
  harvesterVolumeListHandler,
  harvesterAvailableVolumeListHandler,
  harvesterVolumeDeleteHandler,
  harvesterLonghornVolumeDeleteHandler,
  harvesterVmAddVolumeHandler,
  harvesterVmAddVolumeDirectHandler,
  harvesterVmRemoveVolumeHandler,
} from './handlers/storage-cache-volumes.handlers';
import { 
  harvesterImageListHandler,
  harvesterImageDetailHandler,
  harvesterImageCreateHandler,
  harvesterImageUpdateHandler,
  harvesterImagePatchHandler,
  harvesterImageDeleteHandler,
  harvesterImageUploadTaskCreateHandler,
  harvesterImageUploadTaskGetHandler,
  harvesterImageUploadTaskListHandler,
  harvesterImageUploadTaskDeleteHandler,
  harvesterImageUploadTaskCancelHandler,
  harvesterImageUploadTaskFileHandler,
  harvesterImageUploadProxyHandler,
  harvesterImageUploadTokenHandler,
} from './handlers/storage-cache-images.handlers';
import { harvesterStorageClassListHandler } from './handlers/storage-cache-classes.handlers';
import { 
  harvesterSnapshotListHandler,
  harvesterSnapshotDeleteHandler,
} from './handlers/storage-cache-snapshots.handlers';
import {
  harvesterNamespaceListHandler,
  harvesterNamespaceDetailHandler,
  harvesterNamespaceCreateHandler,
  harvesterNamespaceUpdateHandler,
  harvesterNamespaceDeleteHandler,
  harvesterPublicNamespaceNamesHandler,
} from './handlers/compute-cache-namespaces.handlers';
import {
  harvesterNodeListHandler,
  harvesterNodeDetailHandler,
  harvesterHealthHandler,
  harvesterCapabilitiesHandler,
} from './handlers/cluster-cache.handlers';
import {
  harvesterSshKeyListHandler,
  harvesterSshKeyCreateHandler,
  harvesterSshKeyDeleteHandler,
  harvesterCloudInitListHandler,
  harvesterTemplateListHandler,
} from './handlers/compute-cache-meta.handlers';
import {
  harvesterGpuListHandler,
  harvesterGpuClaimListHandler,
  harvesterGpuClaimDeleteHandler,
  harvesterUsbDeviceListHandler,
  harvesterUsbDeviceClaimCreateHandler,
  harvesterUsbDeviceClaimDeleteHandler,
  harvesterPciDeviceListHandler,
} from './handlers/compute-cache-peripherals.handlers';
import { harvesterMigrationListHandler } from './handlers/compute-cache-migrations.handlers';
import { harvesterVmDetailHandler } from './handlers/ecs-direct-detail.handlers';
import {
  harvesterBackupListHandler,
  harvesterBackupCreateHandler,
  harvesterBackupDeleteHandler,
} from './handlers/storage-cache-backups.handlers';
import {
  harvesterScheduleBackupListHandler,
  harvesterScheduleBackupCreateHandler,
  harvesterScheduleBackupUpdateHandler,
  harvesterScheduleBackupPutHandler,
  harvesterScheduleBackupDeleteHandler,
} from './handlers/storage-cache-schedule-backups.handlers';
import { harvesterRestoreCreateHandler } from './handlers/storage-direct-restores.handlers';

export function registerHarvesterCacheRoutesProvider(
  router: Router,
  checkAdminPermission: RequestHandler
) {
  // VPC Handlers 映射
  const vpcListHandlers = {
    harvester: harvesterVpcListHandler,
    cloudmap: harvesterVpcListHandler,
    'cloudmap.private': harvesterVpcListHandler,
    'cloudmap.edge': harvesterVpcListHandler,
  };

  const vpcCreateHandlers = {
    harvester: harvesterVpcCreateHandler,
    cloudmap: harvesterVpcCreateHandler,
    'cloudmap.private': harvesterVpcCreateHandler,
    'cloudmap.edge': harvesterVpcCreateHandler,
  };

  const vpcDeleteHandlers = {
    harvester: harvesterVpcDeleteHandler,
    cloudmap: harvesterVpcDeleteHandler,
    'cloudmap.private': harvesterVpcDeleteHandler,
    'cloudmap.edge': harvesterVpcDeleteHandler,
  };

  const vpcUpdateHandlers = {
    harvester: harvesterVpcUpdateHandler,
    cloudmap: harvesterVpcUpdateHandler,
    'cloudmap.private': harvesterVpcUpdateHandler,
    'cloudmap.edge': harvesterVpcUpdateHandler,
  };

  const ecsListHandlers = {
    harvester: harvesterEcsListHandler,
    cloudmap: harvesterEcsListHandler,
    'cloudmap.private': harvesterEcsListHandler,
    'cloudmap.edge': harvesterEcsListHandler,
  };

  // GET /:id/resources/vpcs - 获取 VPC 列表
  router.get(
    '/:id/resources/vpcs',
    checkAdminPermission,
    createProviderRouter(vpcListHandlers)
  );

  // POST /:id/resources/vpcs - 创建 VPC
  router.post(
    '/:id/resources/vpcs',
    checkAdminPermission,
    createProviderRouter(vpcCreateHandlers)
  );

  // DELETE /:id/resources/vpcs/:name - 删除 VPC
  router.delete(
    '/:id/resources/vpcs/:name',
    checkAdminPermission,
    createProviderRouter(vpcDeleteHandlers)
  );

  // PUT /:id/resources/vpcs/:name - 更新 VPC
  router.put(
    '/:id/resources/vpcs/:name',
    checkAdminPermission,
    createProviderRouter(vpcUpdateHandlers)
  );

  // GET /:id/resources/ecs - 获取虚拟机列表
  router.get(
    '/:id/resources/ecs',
    checkAdminPermission,
    createProviderRouter(ecsListHandlers)
  );

  // Subnets 相关路由
  const subnetListHandlers = {
    harvester: harvesterSubnetListHandler,
    cloudmap: harvesterSubnetListHandler,
    'cloudmap.private': harvesterSubnetListHandler,
    'cloudmap.edge': harvesterSubnetListHandler,
  };

  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    createProviderRouter(subnetListHandlers)
  );

  // NADs 相关路由
  const nadListHandlers = {
    harvester: harvesterNadListHandler,
    cloudmap: harvesterNadListHandler,
    'cloudmap.private': harvesterNadListHandler,
    'cloudmap.edge': harvesterNadListHandler,
  };

  router.get(
    '/:id/resources/harvester/nads',
    checkAdminPermission,
    createProviderRouter(nadListHandlers)
  );

  // NADs 详情、创建、删除
  const nadDetailHandlers = {
    harvester: harvesterNadDetailHandler,
    cloudmap: harvesterNadDetailHandler,
    'cloudmap.private': harvesterNadDetailHandler,
    'cloudmap.edge': harvesterNadDetailHandler,
  };

  const nadCreateHandlers = {
    harvester: harvesterNadCreateHandler,
    cloudmap: harvesterNadCreateHandler,
    'cloudmap.private': harvesterNadCreateHandler,
    'cloudmap.edge': harvesterNadCreateHandler,
  };

  const nadDeleteHandlers = {
    harvester: harvesterNadDeleteHandler,
    cloudmap: harvesterNadDeleteHandler,
    'cloudmap.private': harvesterNadDeleteHandler,
    'cloudmap.edge': harvesterNadDeleteHandler,
  };

  router.get(
    '/:id/resources/harvester/nads/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(nadDetailHandlers)
  );

  router.post(
    '/:id/resources/harvester/nads',
    checkAdminPermission,
    createProviderRouter(nadCreateHandlers)
  );

  router.delete(
    '/:id/resources/harvester/nads/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(nadDeleteHandlers)
  );

  // Volumes 相关路由
  const volumeListHandlers = {
    harvester: harvesterVolumeListHandler,
    cloudmap: harvesterVolumeListHandler,
    'cloudmap.private': harvesterVolumeListHandler,
    'cloudmap.edge': harvesterVolumeListHandler,
  };

  router.get(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    createProviderRouter(volumeListHandlers)
  );

  const availableVolumeListHandlers = {
    harvester: harvesterAvailableVolumeListHandler,
    cloudmap: harvesterAvailableVolumeListHandler,
    'cloudmap.private': harvesterAvailableVolumeListHandler,
    'cloudmap.edge': harvesterAvailableVolumeListHandler,
  };

  router.get(
    '/:id/resources/harvester/available-volumes',
    checkAdminPermission,
    createProviderRouter(availableVolumeListHandlers)
  );

  const volumeDeleteHandlers = {
    harvester: harvesterVolumeDeleteHandler,
    cloudmap: harvesterVolumeDeleteHandler,
    'cloudmap.private': harvesterVolumeDeleteHandler,
    'cloudmap.edge': harvesterVolumeDeleteHandler,
  };

  router.delete(
    '/:id/resources/harvester/volumes/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(volumeDeleteHandlers)
  );

  const longhornVolumeDeleteHandlers = {
    harvester: harvesterLonghornVolumeDeleteHandler,
    cloudmap: harvesterLonghornVolumeDeleteHandler,
    'cloudmap.private': harvesterLonghornVolumeDeleteHandler,
    'cloudmap.edge': harvesterLonghornVolumeDeleteHandler,
  };

  router.delete(
    '/:id/resources/harvester/longhorn/volumes/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(longhornVolumeDeleteHandlers)
  );

  const vmAddVolumeHandlers = {
    harvester: harvesterVmAddVolumeHandler,
    cloudmap: harvesterVmAddVolumeHandler,
    'cloudmap.private': harvesterVmAddVolumeHandler,
    'cloudmap.edge': harvesterVmAddVolumeHandler,
  };

  router.post(
    '/:id/resources/harvester/vms/:instanceId/add-volume',
    checkAdminPermission,
    createProviderRouter(vmAddVolumeHandlers)
  );

  const vmAddVolumeDirectHandlers = {
    harvester: harvesterVmAddVolumeDirectHandler,
    cloudmap: harvesterVmAddVolumeDirectHandler,
    'cloudmap.private': harvesterVmAddVolumeDirectHandler,
    'cloudmap.edge': harvesterVmAddVolumeDirectHandler,
  };

  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/add-volume',
    checkAdminPermission,
    createProviderRouter(vmAddVolumeDirectHandlers)
  );

  const vmRemoveVolumeHandlers = {
    harvester: harvesterVmRemoveVolumeHandler,
    cloudmap: harvesterVmRemoveVolumeHandler,
    'cloudmap.private': harvesterVmRemoveVolumeHandler,
    'cloudmap.edge': harvesterVmRemoveVolumeHandler,
  };

  router.post(
    '/:id/resources/harvester/vms/:instanceId/remove-volume',
    checkAdminPermission,
    createProviderRouter(vmRemoveVolumeHandlers)
  );

  // Images 相关路由
  const imageListHandlers = {
    harvester: harvesterImageListHandler,
    cloudmap: harvesterImageListHandler,
    'cloudmap.private': harvesterImageListHandler,
    'cloudmap.edge': harvesterImageListHandler,
  };

  router.get(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    createProviderRouter(imageListHandlers)
  );

  const imageUploadProxyHandlers = {
    harvester: harvesterImageUploadProxyHandler,
    cloudmap: harvesterImageUploadProxyHandler,
    'cloudmap.private': harvesterImageUploadProxyHandler,
    'cloudmap.edge': harvesterImageUploadProxyHandler,
  };
  router.post(
    '/:id/resources/harvester/images/upload-proxy',
    checkAdminPermission,
    createProviderRouter(imageUploadProxyHandlers)
  );

  const imageUploadTokenHandlers = {
    harvester: harvesterImageUploadTokenHandler,
    cloudmap: harvesterImageUploadTokenHandler,
    'cloudmap.private': harvesterImageUploadTokenHandler,
    'cloudmap.edge': harvesterImageUploadTokenHandler,
  };
  router.post(
    '/:id/resources/harvester/images/upload-token',
    checkAdminPermission,
    createProviderRouter(imageUploadTokenHandlers)
  );

  // upload-tasks 必须放在 :namespace/:name 之前，避免被详情路由吞掉
  const imageUploadTaskCreateHandlers = {
    harvester: harvesterImageUploadTaskCreateHandler,
    cloudmap: harvesterImageUploadTaskCreateHandler,
    'cloudmap.private': harvesterImageUploadTaskCreateHandler,
    'cloudmap.edge': harvesterImageUploadTaskCreateHandler,
  };
  router.post(
    '/:id/resources/harvester/images/upload-tasks',
    checkAdminPermission,
    createProviderRouter(imageUploadTaskCreateHandlers)
  );

  const imageUploadTaskListHandlers = {
    harvester: harvesterImageUploadTaskListHandler,
    cloudmap: harvesterImageUploadTaskListHandler,
    'cloudmap.private': harvesterImageUploadTaskListHandler,
    'cloudmap.edge': harvesterImageUploadTaskListHandler,
  };
  router.get(
    '/:id/resources/harvester/images/upload-tasks',
    checkAdminPermission,
    createProviderRouter(imageUploadTaskListHandlers)
  );

  const imageUploadTaskGetHandlers = {
    harvester: harvesterImageUploadTaskGetHandler,
    cloudmap: harvesterImageUploadTaskGetHandler,
    'cloudmap.private': harvesterImageUploadTaskGetHandler,
    'cloudmap.edge': harvesterImageUploadTaskGetHandler,
  };
  router.get(
    '/:id/resources/harvester/images/upload-tasks/:taskId',
    checkAdminPermission,
    createProviderRouter(imageUploadTaskGetHandlers)
  );

  const imageUploadTaskDeleteHandlers = {
    harvester: harvesterImageUploadTaskDeleteHandler,
    cloudmap: harvesterImageUploadTaskDeleteHandler,
    'cloudmap.private': harvesterImageUploadTaskDeleteHandler,
    'cloudmap.edge': harvesterImageUploadTaskDeleteHandler,
  };
  router.delete(
    '/:id/resources/harvester/images/upload-tasks/:taskId',
    checkAdminPermission,
    createProviderRouter(imageUploadTaskDeleteHandlers)
  );

  const imageUploadTaskFileHandlers = {
    harvester: harvesterImageUploadTaskFileHandler,
    cloudmap: harvesterImageUploadTaskFileHandler,
    'cloudmap.private': harvesterImageUploadTaskFileHandler,
    'cloudmap.edge': harvesterImageUploadTaskFileHandler,
  };
  router.post(
    '/:id/resources/harvester/images/upload-tasks/:taskId/file',
    checkAdminPermission,
    createProviderRouter(imageUploadTaskFileHandlers)
  );

  const imageUploadTaskCancelHandlers = {
    harvester: harvesterImageUploadTaskCancelHandler,
    cloudmap: harvesterImageUploadTaskCancelHandler,
    'cloudmap.private': harvesterImageUploadTaskCancelHandler,
    'cloudmap.edge': harvesterImageUploadTaskCancelHandler,
  };
  router.post(
    '/:id/resources/harvester/images/upload-tasks/:taskId/cancel',
    checkAdminPermission,
    createProviderRouter(imageUploadTaskCancelHandlers)
  );

  const imageDetailHandlers = {
    harvester: harvesterImageDetailHandler,
    cloudmap: harvesterImageDetailHandler,
    'cloudmap.private': harvesterImageDetailHandler,
    'cloudmap.edge': harvesterImageDetailHandler,
  };

  router.get(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(imageDetailHandlers)
  );

  const imageCreateHandlers = {
    harvester: harvesterImageCreateHandler,
    cloudmap: harvesterImageCreateHandler,
    'cloudmap.private': harvesterImageCreateHandler,
    'cloudmap.edge': harvesterImageCreateHandler,
  };

  router.post(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    createProviderRouter(imageCreateHandlers)
  );

  const imageUpdateHandlers = {
    harvester: harvesterImageUpdateHandler,
    cloudmap: harvesterImageUpdateHandler,
    'cloudmap.private': harvesterImageUpdateHandler,
    'cloudmap.edge': harvesterImageUpdateHandler,
  };

  router.put(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(imageUpdateHandlers)
  );

  const imagePatchHandlers = {
    harvester: harvesterImagePatchHandler,
    cloudmap: harvesterImagePatchHandler,
    'cloudmap.private': harvesterImagePatchHandler,
    'cloudmap.edge': harvesterImagePatchHandler,
  };

  router.patch(
    '/:id/resources/harvester/images/:namespace/:name/patch',
    checkAdminPermission,
    json({ type: ['application/json-patch+json', 'application/merge-patch+json'] }),
    createProviderRouter(imagePatchHandlers)
  );

  const imageDeleteHandlers = {
    harvester: harvesterImageDeleteHandler,
    cloudmap: harvesterImageDeleteHandler,
    'cloudmap.private': harvesterImageDeleteHandler,
    'cloudmap.edge': harvesterImageDeleteHandler,
  };

  router.delete(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(imageDeleteHandlers)
  );

  // Storage Classes 相关路由
  const storageClassListHandlers = {
    harvester: harvesterStorageClassListHandler,
    cloudmap: harvesterStorageClassListHandler,
    'cloudmap.private': harvesterStorageClassListHandler,
    'cloudmap.edge': harvesterStorageClassListHandler,
  };

  router.get(
    '/:id/resources/harvester/storage-classes',
    checkAdminPermission,
    createProviderRouter(storageClassListHandlers)
  );

  // Snapshots 相关路由
  const snapshotListHandlers = {
    harvester: harvesterSnapshotListHandler,
    cloudmap: harvesterSnapshotListHandler,
    'cloudmap.private': harvesterSnapshotListHandler,
    'cloudmap.edge': harvesterSnapshotListHandler,
  };

  router.get(
    '/:id/resources/harvester/snapshots',
    checkAdminPermission,
    createProviderRouter(snapshotListHandlers)
  );

  const snapshotDeleteHandlers = {
    harvester: harvesterSnapshotDeleteHandler,
    cloudmap: harvesterSnapshotDeleteHandler,
    'cloudmap.private': harvesterSnapshotDeleteHandler,
    'cloudmap.edge': harvesterSnapshotDeleteHandler,
  };

  router.delete(
    '/:id/resources/harvester/snapshots/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(snapshotDeleteHandlers)
  );

  // Cluster Networks 相关路由
  const clusterNetworkListHandlers = {
    harvester: harvesterClusterNetworkListHandler,
    cloudmap: harvesterClusterNetworkListHandler,
    'cloudmap.private': harvesterClusterNetworkListHandler,
    'cloudmap.edge': harvesterClusterNetworkListHandler,
  };

  router.get(
    '/:id/resources/cluster-networks',
    checkAdminPermission,
    createProviderRouter(clusterNetworkListHandlers)
  );

  // Services 相关路由
  const serviceListHandlers = {
    harvester: harvesterServiceCacheListHandler,
    cloudmap: harvesterServiceCacheListHandler,
    'cloudmap.private': harvesterServiceCacheListHandler,
    'cloudmap.edge': harvesterServiceCacheListHandler,
  };

  router.get(
    '/:id/resources/harvester/services',
    checkAdminPermission,
    createProviderRouter(serviceListHandlers)
  );

  // Namespaces 相关路由
  const publicNamespaceNamesHandlers = {
    harvester: harvesterPublicNamespaceNamesHandler,
    cloudmap: harvesterPublicNamespaceNamesHandler,
    'cloudmap.private': harvesterPublicNamespaceNamesHandler,
    'cloudmap.edge': harvesterPublicNamespaceNamesHandler,
  };

  const namespaceListHandlers = {
    harvester: harvesterNamespaceListHandler,
    cloudmap: harvesterNamespaceListHandler,
    'cloudmap.private': harvesterNamespaceListHandler,
    'cloudmap.edge': harvesterNamespaceListHandler,
  };

  const namespaceDetailHandlers = {
    harvester: harvesterNamespaceDetailHandler,
    cloudmap: harvesterNamespaceDetailHandler,
    'cloudmap.private': harvesterNamespaceDetailHandler,
    'cloudmap.edge': harvesterNamespaceDetailHandler,
  };

  const namespaceCreateHandlers = {
    harvester: harvesterNamespaceCreateHandler,
    cloudmap: harvesterNamespaceCreateHandler,
    'cloudmap.private': harvesterNamespaceCreateHandler,
    'cloudmap.edge': harvesterNamespaceCreateHandler,
  };

  const namespaceUpdateHandlers = {
    harvester: harvesterNamespaceUpdateHandler,
    cloudmap: harvesterNamespaceUpdateHandler,
    'cloudmap.private': harvesterNamespaceUpdateHandler,
    'cloudmap.edge': harvesterNamespaceUpdateHandler,
  };

  const namespaceDeleteHandlers = {
    harvester: harvesterNamespaceDeleteHandler,
    cloudmap: harvesterNamespaceDeleteHandler,
    'cloudmap.private': harvesterNamespaceDeleteHandler,
    'cloudmap.edge': harvesterNamespaceDeleteHandler,
  };

  router.get(
    '/:id/resources/harvester/public-namespace-names',
    checkAdminPermission,
    createProviderRouter(publicNamespaceNamesHandlers)
  );

  router.get(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    createProviderRouter(namespaceListHandlers)
  );

  router.get(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    createProviderRouter(namespaceDetailHandlers)
  );

  router.post(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    createProviderRouter(namespaceCreateHandlers)
  );

  router.patch(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    createProviderRouter(namespaceUpdateHandlers)
  );

  router.delete(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    createProviderRouter(namespaceDeleteHandlers)
  );

  // Migrations 相关路由
  const migrationListHandlers = {
    harvester: harvesterMigrationListHandler,
    cloudmap: harvesterMigrationListHandler,
    'cloudmap.private': harvesterMigrationListHandler,
    'cloudmap.edge': harvesterMigrationListHandler,
  };

  router.get(
    '/:id/resources/harvester/migrations',
    checkAdminPermission,
    createProviderRouter(migrationListHandlers)
  );

  // Cluster 相关路由
  const nodeListHandlers = {
    harvester: harvesterNodeListHandler,
    cloudmap: harvesterNodeListHandler,
    'cloudmap.private': harvesterNodeListHandler,
    'cloudmap.edge': harvesterNodeListHandler,
  };

  const nodeDetailHandlers = {
    harvester: harvesterNodeDetailHandler,
    cloudmap: harvesterNodeDetailHandler,
    'cloudmap.private': harvesterNodeDetailHandler,
    'cloudmap.edge': harvesterNodeDetailHandler,
  };

  const healthHandlers = {
    harvester: harvesterHealthHandler,
    cloudmap: harvesterHealthHandler,
    'cloudmap.private': harvesterHealthHandler,
    'cloudmap.edge': harvesterHealthHandler,
  };

  const capabilitiesHandlers = {
    harvester: harvesterCapabilitiesHandler,
    cloudmap: harvesterCapabilitiesHandler,
    'cloudmap.private': harvesterCapabilitiesHandler,
    'cloudmap.edge': harvesterCapabilitiesHandler,
  };

  router.get(
    '/:id/resources/harvester/nodes',
    checkAdminPermission,
    createProviderRouter(nodeListHandlers)
  );

  router.get(
    '/:id/resources/harvester/nodes/:name',
    checkAdminPermission,
    createProviderRouter(nodeDetailHandlers)
  );

  router.get(
    '/:id/resources/harvester/health',
    checkAdminPermission,
    createProviderRouter(healthHandlers)
  );

  router.get(
    '/:id/resources/harvester/capabilities',
    checkAdminPermission,
    createProviderRouter(capabilitiesHandlers)
  );

  // Meta 相关路由
  const sshKeyListHandlers = {
    harvester: harvesterSshKeyListHandler,
    cloudmap: harvesterSshKeyListHandler,
    'cloudmap.private': harvesterSshKeyListHandler,
    'cloudmap.edge': harvesterSshKeyListHandler,
  };

  const sshKeyCreateHandlers = {
    harvester: harvesterSshKeyCreateHandler,
    cloudmap: harvesterSshKeyCreateHandler,
    'cloudmap.private': harvesterSshKeyCreateHandler,
    'cloudmap.edge': harvesterSshKeyCreateHandler,
  };

  const sshKeyDeleteHandlers = {
    harvester: harvesterSshKeyDeleteHandler,
    cloudmap: harvesterSshKeyDeleteHandler,
    'cloudmap.private': harvesterSshKeyDeleteHandler,
    'cloudmap.edge': harvesterSshKeyDeleteHandler,
  };

  const cloudInitListHandlers = {
    harvester: harvesterCloudInitListHandler,
    cloudmap: harvesterCloudInitListHandler,
    'cloudmap.private': harvesterCloudInitListHandler,
    'cloudmap.edge': harvesterCloudInitListHandler,
  };

  const templateListHandlers = {
    harvester: harvesterTemplateListHandler,
    cloudmap: harvesterTemplateListHandler,
    'cloudmap.private': harvesterTemplateListHandler,
    'cloudmap.edge': harvesterTemplateListHandler,
  };

  router.get(
    '/:id/resources/harvester/sshkeys',
    checkAdminPermission,
    createProviderRouter(sshKeyListHandlers)
  );

  router.post(
    '/:id/resources/harvester/sshkeys',
    checkAdminPermission,
    createProviderRouter(sshKeyCreateHandlers)
  );

  router.delete(
    '/:id/resources/harvester/sshkeys/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(sshKeyDeleteHandlers)
  );

  router.get(
    '/:id/resources/harvester/cloudinits',
    checkAdminPermission,
    createProviderRouter(cloudInitListHandlers)
  );

  router.get(
    '/:id/resources/harvester/templates',
    checkAdminPermission,
    createProviderRouter(templateListHandlers)
  );

  // Peripherals 相关路由
  const gpuListHandlers = {
    harvester: harvesterGpuListHandler,
    cloudmap: harvesterGpuListHandler,
    'cloudmap.private': harvesterGpuListHandler,
    'cloudmap.edge': harvesterGpuListHandler,
  };

  router.get(
    '/:id/resources/harvester/gpus',
    checkAdminPermission,
    createProviderRouter(gpuListHandlers)
  );

  const gpuClaimListHandlers = {
    harvester: harvesterGpuClaimListHandler,
    cloudmap: harvesterGpuClaimListHandler,
    'cloudmap.private': harvesterGpuClaimListHandler,
    'cloudmap.edge': harvesterGpuClaimListHandler,
  };

  router.get(
    '/:id/resources/harvester/gpu-claims',
    checkAdminPermission,
    createProviderRouter(gpuClaimListHandlers)
  );

  const gpuClaimDeleteHandlers = {
    harvester: harvesterGpuClaimDeleteHandler,
    cloudmap: harvesterGpuClaimDeleteHandler,
    'cloudmap.private': harvesterGpuClaimDeleteHandler,
    'cloudmap.edge': harvesterGpuClaimDeleteHandler,
  };

  router.delete(
    '/:id/resources/harvester/gpu-claims/:name',
    checkAdminPermission,
    createProviderRouter(gpuClaimDeleteHandlers)
  );

  const usbDeviceListHandlers = {
    harvester: harvesterUsbDeviceListHandler,
    cloudmap: harvesterUsbDeviceListHandler,
    'cloudmap.private': harvesterUsbDeviceListHandler,
    'cloudmap.edge': harvesterUsbDeviceListHandler,
  };

  router.get(
    '/:id/resources/harvester/usb-devices',
    checkAdminPermission,
    createProviderRouter(usbDeviceListHandlers)
  );

  const usbDeviceClaimCreateHandlers = {
    harvester: harvesterUsbDeviceClaimCreateHandler,
    cloudmap: harvesterUsbDeviceClaimCreateHandler,
    'cloudmap.private': harvesterUsbDeviceClaimCreateHandler,
    'cloudmap.edge': harvesterUsbDeviceClaimCreateHandler,
  };

  router.post(
    '/:id/resources/harvester/usb-devices/:name/claim',
    checkAdminPermission,
    createProviderRouter(usbDeviceClaimCreateHandlers)
  );

  const usbDeviceClaimDeleteHandlers = {
    harvester: harvesterUsbDeviceClaimDeleteHandler,
    cloudmap: harvesterUsbDeviceClaimDeleteHandler,
    'cloudmap.private': harvesterUsbDeviceClaimDeleteHandler,
    'cloudmap.edge': harvesterUsbDeviceClaimDeleteHandler,
  };

  router.delete(
    '/:id/resources/harvester/usb-devices/:name/claim',
    checkAdminPermission,
    createProviderRouter(usbDeviceClaimDeleteHandlers)
  );

  const pciDeviceListHandlers = {
    harvester: harvesterPciDeviceListHandler,
    cloudmap: harvesterPciDeviceListHandler,
    'cloudmap.private': harvesterPciDeviceListHandler,
    'cloudmap.edge': harvesterPciDeviceListHandler,
  };

  router.get(
    '/:id/resources/harvester/pci-devices',
    checkAdminPermission,
    createProviderRouter(pciDeviceListHandlers)
  );

  // ECS Detail 相关路由
  const vmDetailHandlers = {
    harvester: harvesterVmDetailHandler,
    cloudmap: harvesterVmDetailHandler,
    'cloudmap.private': harvesterVmDetailHandler,
    'cloudmap.edge': harvesterVmDetailHandler,
  };

  router.get(
    '/:id/resources/harvester/vms/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(vmDetailHandlers)
  );

  // Backups 相关路由
  const backupListHandlers = {
    harvester: harvesterBackupListHandler,
    cloudmap: harvesterBackupListHandler,
    'cloudmap.private': harvesterBackupListHandler,
    'cloudmap.edge': harvesterBackupListHandler,
  };

  const backupCreateHandlers = {
    harvester: harvesterBackupCreateHandler,
    cloudmap: harvesterBackupCreateHandler,
    'cloudmap.private': harvesterBackupCreateHandler,
    'cloudmap.edge': harvesterBackupCreateHandler,
  };

  const backupDeleteHandlers = {
    harvester: harvesterBackupDeleteHandler,
    cloudmap: harvesterBackupDeleteHandler,
    'cloudmap.private': harvesterBackupDeleteHandler,
    'cloudmap.edge': harvesterBackupDeleteHandler,
  };

  router.get(
    '/:id/resources/harvester/backups',
    checkAdminPermission,
    createProviderRouter(backupListHandlers)
  );

  router.post(
    '/:id/resources/harvester/virtualmachinebackups/:namespace',
    checkAdminPermission,
    createProviderRouter(backupCreateHandlers)
  );

  router.delete(
    '/:id/resources/harvester/backups/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(backupDeleteHandlers)
  );

  // Schedule Backups 相关路由
  const scheduleBackupListHandlers = {
    harvester: harvesterScheduleBackupListHandler,
    cloudmap: harvesterScheduleBackupListHandler,
    'cloudmap.private': harvesterScheduleBackupListHandler,
    'cloudmap.edge': harvesterScheduleBackupListHandler,
  };

  const scheduleBackupCreateHandlers = {
    harvester: harvesterScheduleBackupCreateHandler,
    cloudmap: harvesterScheduleBackupCreateHandler,
    'cloudmap.private': harvesterScheduleBackupCreateHandler,
    'cloudmap.edge': harvesterScheduleBackupCreateHandler,
  };

  const scheduleBackupUpdateHandlers = {
    harvester: harvesterScheduleBackupUpdateHandler,
    cloudmap: harvesterScheduleBackupUpdateHandler,
    'cloudmap.private': harvesterScheduleBackupUpdateHandler,
    'cloudmap.edge': harvesterScheduleBackupUpdateHandler,
  };

  const scheduleBackupPutHandlers = {
    harvester: harvesterScheduleBackupPutHandler,
    cloudmap: harvesterScheduleBackupPutHandler,
    'cloudmap.private': harvesterScheduleBackupPutHandler,
    'cloudmap.edge': harvesterScheduleBackupPutHandler,
  };

  const scheduleBackupDeleteHandlers = {
    harvester: harvesterScheduleBackupDeleteHandler,
    cloudmap: harvesterScheduleBackupDeleteHandler,
    'cloudmap.private': harvesterScheduleBackupDeleteHandler,
    'cloudmap.edge': harvesterScheduleBackupDeleteHandler,
  };

  router.get(
    '/:id/resources/harvester/schedulevmbackups',
    checkAdminPermission,
    createProviderRouter(scheduleBackupListHandlers)
  );

  router.post(
    '/:id/resources/harvester/schedulevmbackups',
    checkAdminPermission,
    createProviderRouter(scheduleBackupCreateHandlers)
  );

  router.patch(
    '/:id/resources/harvester/schedulevmbackups/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(scheduleBackupUpdateHandlers)
  );

  router.put(
    '/:id/resources/harvester/schedulevmbackups/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(scheduleBackupPutHandlers)
  );

  router.delete(
    '/:id/resources/harvester/schedulevmbackups/:namespace/:name',
    checkAdminPermission,
    createProviderRouter(scheduleBackupDeleteHandlers)
  );

  // Restores 相关路由
  const restoreCreateHandlers = {
    harvester: harvesterRestoreCreateHandler,
    cloudmap: harvesterRestoreCreateHandler,
    'cloudmap.private': harvesterRestoreCreateHandler,
    'cloudmap.edge': harvesterRestoreCreateHandler,
  };

  router.post(
    '/:id/resources/harvester/virtualmachinerestores/:namespace',
    checkAdminPermission,
    createProviderRouter(restoreCreateHandlers)
  );
}
