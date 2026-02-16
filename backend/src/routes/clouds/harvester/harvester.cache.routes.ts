import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { UserSpace } from '../../../entities/UserSpace';
import { HarvesterNamespace } from '../../../entities/harvester/HarvesterNamespace';
import { HarvesterNamespaceInventory } from '../../../entities/harvester/HarvesterNamespaceInventory';
import { HarvesterClusterNetworkInventory } from '../../../entities/harvester/HarvesterClusterNetworkInventory';
import { HarvesterVlanConfigInventory } from '../../../entities/harvester/HarvesterVlanConfigInventory';
import {
  listHarvesterVMsStandard,
  listHarvesterAvailableVolumesStandard,
  listHarvesterNodesStandard,
  listHarvesterGpuResources,
  listHarvesterUsbResources,
  listHarvesterStorageClassesStandard,
  harvesterHealthCheck,
  getHarvesterCapabilities,
  harvesterAddVolumeToVM,
  harvesterRemoveVolumeFromVM,
  harvesterAddVolumeToVMDirect,
  deleteHarvesterLonghornVolume,
  deleteHarvesterPVC,
  createHarvesterPVCVolume,
  exportImageFromPVC,
  createVolumeSnapshot,
  updatePVCSpec,
  clonePVC,
  createHarvesterScheduleVmBackup,
  updateHarvesterScheduleVmBackup,
  deleteHarvesterScheduleVmBackup,
  createHarvesterVirtualMachineBackup,
  createHarvesterVirtualMachineRestore,
  deleteHarvesterVirtualMachineBackup,
  deleteHarvesterVirtualMachineSnapshot,
  deleteHarvesterVolumeSnapshot,
  harvesterStartVM,
  harvesterStopVM,
  syncVmVolumeSize,
} from '../../../services/clouds/harvester/client';
import {
  syncHarvesterVolumes,
  syncHarvesterNads,
  syncKubeOvnVpcs,
  syncKubeOvnSubnets,
  syncHarvesterImages,
  syncKubevirtVms,
  syncKubevirtVmis,
  syncHarvesterGpus,
  syncHarvesterNamespaces,
  syncHarvesterSnapshots,
  syncHarvesterBackups,
  syncHarvesterSshKeys,
  syncHarvesterCloudInits,
  syncHarvesterIngresses,
  syncHarvesterServices,
  syncHarvesterNodes,
  syncHarvesterStorageClasses,
  syncHarvesterUsbResources,
  syncHarvesterTemplates,
  syncHarvesterScheduleVmBackups,
  syncHarvesterClusterNetworks,
} from '../../../services/clouds/harvester/inventory';
import { KubevirtVolumeInventory } from '../../../entities/kubevirt/KubevirtVolumeInventory';
import { KubevirtNadInventory } from '../../../entities/kubevirt/KubevirtNadInventory';
import { KubeOvnVpcInventory } from '../../../entities/kubeovn/KubeOvnVpcInventory';
import { KubeOvnSubnetInventory } from '../../../entities/kubeovn/KubeOvnSubnetInventory';
import { HarvesterImageInventory } from '../../../entities/harvester/HarvesterImageInventory';
import { HarvesterNodeInventory } from '../../../entities/harvester/HarvesterNodeInventory';
import { KubevirtStorageClassInventory } from '../../../entities/kubevirt/KubevirtStorageClassInventory';
import { HarvesterGpuInventory } from '../../../entities/harvester/HarvesterGpuInventory';
import { HarvesterSnapshotInventory } from '../../../entities/harvester/HarvesterSnapshotInventory';
import { HarvesterBackupInventory } from '../../../entities/harvester/HarvesterBackupInventory';
import { HarvesterScheduleVmBackupInventory } from '../../../entities/harvester/HarvesterScheduleVmBackupInventory';
import { HarvesterSshKeyInventory } from '../../../entities/harvester/HarvesterSshKeyInventory';
import { HarvesterCloudInitInventory } from '../../../entities/harvester/HarvesterCloudInitInventory';
import { HarvesterTemplateInventory } from '../../../entities/harvester/HarvesterTemplateInventory';
import { HarvesterUsbInventory } from '../../../entities/harvester/HarvesterUsbInventory';
import { HarvesterServiceInventory } from '../../../entities/harvester/HarvesterServiceInventory';
import { KubeOvnIngressInventory } from '../../../entities/kubeovn/KubeOvnIngressInventory';
import { HarvesterMigrationInventory } from '../../../entities/harvester/HarvesterMigrationInventory';
import { requestJson, getJsonOnce } from '../../../services/clouds/harvester/utils';
import { syncKubevirtMigrations } from '../../../services/clouds/harvester/inventory';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { registerHarvesterVmRoutes } from './harvester.cache.vm.routes';
import { registerHarvesterStorageRoutes } from './harvester.cache.storage.routes';
import { registerHarvesterNetworkRoutes } from './harvester.cache.network.routes';
import { registerHarvesterClusterRoutes } from './harvester.cache.cluster.routes';
import { registerHarvesterNamespaceRoutes } from './harvester.cache.namespace.routes';
import { registerHarvesterPeripheralsRoutes } from './harvester.cache.peripherals.routes';
import { registerHarvesterMetaRoutes } from './harvester.cache.meta.routes';

export const registerHarvesterRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  router.get(
    '/:id/resources/harvester/migrations',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterMigrationInventory);
        const count = await repo.count({ where: { cloudId: id } });
        if (String(force) === 'true' || count === 0) {
          try {
            await syncKubevirtMigrations(cloud, insecure);
          } catch (e: any) {
            if (count === 0) throw e;
          }
        }
        const items = await repo.find({ where: { cloudId: id } });
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({
          message: '查询迁移记录失败',
          error: error.body || error.message || error,
        });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/proxy',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { path } = req.query;
        if (!path || typeof path !== 'string') {
          return res.status(400).json({ message: 'Missing path parameter' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester', next))
          return;

        const insecure = !!(cloud.config as any)?.ignoreTls;

        let target = '';
        if (path.startsWith('http://') || path.startsWith('https://')) {
          target = path;
        } else {
          const cleanPath = path.startsWith('/') ? path : `/${path}`;

          let base = cloud.endpoint.replace(/\/+$/, '');

          if (
            (cleanPath.startsWith('/api/') ||
              cleanPath.startsWith('/apis/')) &&
            !base.includes('/k8s/clusters/')
          ) {
            base = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
          }

          target = `${base}${cleanPath}`;
        }
        console.log(`[HarvesterProxy] Proxying to: ${target}`);

        const data = await getJsonOnce(
          target,
          cloud.secretKey || '',
          insecure,
        );
        res.json(data);
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: 'Proxy request failed',
          error: error.message || String(error),
        });
      }
    },
  );

  registerHarvesterVmRoutes(router, checkAdminPermission);
  registerHarvesterStorageRoutes(router, checkAdminPermission);
  registerHarvesterNetworkRoutes(router, checkAdminPermission);
  registerHarvesterClusterRoutes(router, checkAdminPermission);
  registerHarvesterNamespaceRoutes(router, checkAdminPermission);
  registerHarvesterPeripheralsRoutes(router, checkAdminPermission);
  registerHarvesterMetaRoutes(router, checkAdminPermission);
};
