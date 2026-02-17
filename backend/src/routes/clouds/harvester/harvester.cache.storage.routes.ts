import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { UserSpace } from '../../../entities/UserSpace';
import { KubevirtVolumeInventory } from '../../../entities/kubevirt/KubevirtVolumeInventory';
import { KubevirtStorageClassInventory } from '../../../entities/kubevirt/KubevirtStorageClassInventory';
import { HarvesterImageInventory } from '../../../entities/harvester/HarvesterImageInventory';
import { HarvesterSnapshotInventory } from '../../../entities/harvester/HarvesterSnapshotInventory';
import { HarvesterBackupInventory } from '../../../entities/harvester/HarvesterBackupInventory';
import { HarvesterScheduleVmBackupInventory } from '../../../entities/harvester/HarvesterScheduleVmBackupInventory';
import {
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
  getHarvesterCapabilities,
  syncVmVolumeSize,
} from '../../../services/clouds/harvester/client';
import {
  syncHarvesterVolumes,
  syncHarvesterImages,
  syncHarvesterSnapshots,
  syncHarvesterBackups,
  syncHarvesterScheduleVmBackups,
  syncHarvesterStorageClasses,
} from '../../../services/clouds/harvester/inventory';
import { requestJson, getJsonOnce } from '../../../services/clouds/harvester/utils';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

export const registerHarvesterStorageRoutes = (router: Router, checkAdminPermission: any) => {
  // Volumes (List)
  /**
   * [GET] /:id/resources/harvester/volumes
   * 获取卷列表 (Volumes/PVCs)
   */
  router.get(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubevirtVolumeInventory);

        // Tenant Isolation: Filter by UserSpace Namespace
        let whereCondition: any = { cloudId: id };
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) {
            whereCondition.namespace = us.namespace;
          }
        }

        const count = await repo.count({ where: whereCondition });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterVolumes(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Volumes failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });

        // Frontend Response Formatting
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const basic = items.map((item: any) => {
          const v = item.rawData || {};
          const name = v?.metadata?.name || v?.name || item.name || '';

          const size =
            v?.status?.capacity?.storage ||
            v?.spec?.resources?.requests?.storage ||
            v?.spec?.size ||
            v?.size ||
            item.capacity ||
            0;

          const state =
            v?.status?.phase ||
            v?.status?.state ||
            v?.state ||
            item.phase ||
            'Unknown';

          const k8s = v?.status?.kubernetesStatus || {};
          const namespace = k8s?.namespace || v?.metadata?.namespace || item.namespace || '';
          const pvcName = k8s?.pvcName || '';

          const storageClassName = v?.spec?.storageClassName || item.storageClassName || '';
          const volumeMode = v?.spec?.volumeMode || item.volumeMode || '';

          const rawAccessModes = v?.status?.accessModes || v?.spec?.accessModes;
          const accessModes = Array.isArray(rawAccessModes)
            ? rawAccessModes
            : item.accessModes
            ? String(item.accessModes).split(',')
            : [];

          const viewUrl = `${origin}/api/v1/namespaces/${namespace}/persistentvolumeclaims/${name}`;

          const workloads =
            k8s?.workloadsStatus || v?.status?.workloadsStatus || v?.status?.workloadStatus || [];
          const rawNames: string[] = Array.isArray(workloads)
            ? workloads
                .map((w: any) => String(w?.workloadName || w?.podName || '')).filter(Boolean)
            : [];
          const attachedTo: string[] = Array.from(
            new Set(
              rawNames
                .map((n: string) => {
                  let s = n.trim();
                  if (/^virt-launcher-/.test(s)) {
                    s = s.replace(/^virt-launcher-/, '');
                  }
                  return s;
                })
                .filter(Boolean),
            ),
          );
          return {
            ...v,
            links: { view: viewUrl },
            name,
            size,
            state,
            namespace,
            pvcName,
            attachedTo,
            storageClassName,
            volumeMode,
            accessModes,
            createdAt: v?.metadata?.creationTimestamp,
            raw: v,
          };
        });

        res.json({ message: '查询成功', data: { items: basic } });
      } catch (error: any) {
        res.status(500).json({ message: '查询卷失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/longhorn/volumes/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;

        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = {
            tenantId: (req as any).user.tenantId,
            cloudId: id,
            status: 'active',
          };
          if ((req.user as any).organizationId) {
            where.organizationId = (req.user as any).organizationId;
          }
          const userSpace = await userSpaceRepo.findOne({ where });
          if (!userSpace) return res.status(403).json({ message: '无权访问该云资源' });

          const validNamespaces = userSpace.namespace
            ? userSpace.namespace.split(',').map((s) => s.trim())
            : [];
          if ((req.user as any).organizationId) {
            validNamespaces.push(`ns-${(req.user as any).organizationId}`);
          }

          if (!validNamespaces.includes(namespace)) {
            return res.status(403).json({ message: '无权访问该命名空间资源' });
          }
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 操作', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        await deleteHarvesterLonghornVolume(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name,
        );

        res.json({ message: '删除成功' });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '删除卷失败', error: error.message });
      }
    },
  );

  // Available Volumes (For Attachment)
  router.get(
    '/:id/resources/harvester/available-volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, force } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubevirtVolumeInventory);

        let filterNamespace = namespace;
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) {
            filterNamespace = us.namespace;
          }
        }

        const count = await repo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterVolumes(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Volumes failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const where: any = { cloudId: id };
        if (filterNamespace) {
          where.namespace = filterNamespace;
        }

        const dbItems = await repo.find({ where });

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const items = dbItems
          .map((item) => {
            const v = item.rawData || {};

            const name = v?.metadata?.name || v?.name || item.name || '';
            const ns = v?.metadata?.namespace || v?.namespace || item.namespace || '';

            const size =
              v?.status?.capacity?.storage ||
              v?.spec?.resources?.requests?.storage ||
              v?.spec?.size ||
              v?.size ||
              item.capacity ||
              0;

            const state = String(
              v?.status?.phase ||
                v?.status?.state ||
                v?.state ||
                item.phase ||
                'Unknown',
            ).toLowerCase();

            const workloads =
              v?.status?.workloadsStatus || v?.status?.workloadStatus || [];
            const inUse =
              Array.isArray(workloads) &&
              workloads.some(
                (w: any) =>
                  String(w?.state || w?.podStatus || '').toLowerCase() === 'running',
              );
            const attached = state === 'attached' || inUse;
            const pvcName = v?.status?.kubernetesStatus?.pvcName || name;

            const viewUrl = `${origin}/api/v1/namespaces/${ns}/persistentvolumeclaims/${name}`;

            return {
              ...v,
              name,
              pvcName,
              namespace: ns,
              size,
              state,
              attached,
              links: { view: viewUrl },
            };
          })
          .filter((x: any) => {
            const isBound = String(x.state).toLowerCase() === 'bound';
            return isBound && !x.attached;
          });

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询可用卷失败', error: error.message });
      }
    },
  );

  // Storage Classes
  router.get(
    '/:id/resources/harvester/storage-classes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubevirtStorageClassInventory);
        const count = await repo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterStorageClasses(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync StorageClasses failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const dbItems = await repo.find({ where: { cloudId: id } });
        const items = dbItems.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '查询存储类失败', error: error.body || error.message });
      }
    },
  );

  // Volume Operations
  router.post(
    '/:id/resources/harvester/vms/:instanceId/add-volume',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, instanceId } = req.params as any;
        const { name, bus, pvcNamespace, pvcName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterAddVolumeToVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          { name, bus, pvcNamespace, pvcName },
        );
        res.json({ message: '挂载成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '挂载卷失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/add-volume',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const { diskName, bus, pvcNamespace, pvcName, name: bodyName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterAddVolumeToVMDirect(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
          { name: bodyName || diskName, bus, pvcNamespace, pvcName },
        );
        res.json({ message: '挂载成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '挂载卷失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms/:instanceId/remove-volume',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, instanceId } = req.params as any;
        const { name } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterRemoveVolumeFromVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          { name },
        );
        res.json({ message: '卸载成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '卸载卷失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/volumes/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      const { id, namespace, name } = req.params as any;
      try {
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await deleteHarvesterPVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '删除卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('permissiondenied')) {
          msg =
            '删除失败：权限不足或接口不支持删除（403）。请检查登录账号权限，或通过 Longhorn 卷 CRD 路径执行删除。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '删除失败：未找到该卷（404）。请确认命名空间与卷名是否正确。';
        } else if (status === 409 || lower.includes('conflict') || lower.includes('in use')) {
          msg = `删除虚拟磁盘失败：虚拟磁盘 ${name} 正在被云主机使用，请先在云主机中卸载该磁盘后再删除。`;
        } else if (lower.includes('method delete not supported')) {
          msg = '删除失败：当前接口不支持删除操作。请使用 Longhorn CRD API 路径删除。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:pvcName/export-image',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const { displayName, targetStorageClassName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await exportImageFromPVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          { displayName, targetStorageClassName },
        );
        res.json({ message: '创建镜像任务成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '导出镜像失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '失败：PVC 未找到（404）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:pvcName/snapshots',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const { name, snapshotClassName, alias } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await createVolumeSnapshot(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          { name, snapshotClassName, alias },
        );
        res.json({ message: '创建快照成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '创建快照失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '失败：PVC 未找到（404）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.put(
    '/:id/resources/harvester/volumes/:namespace/:pvcName',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const { sizeGi, size, accessModes, volumeMode, storageClassName, annotations, labels } =
          (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await updatePVCSpec(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          { sizeGi, size, accessModes, volumeMode, storageClassName, annotations, labels },
        );

        if (sizeGi || size) {
          const newSize = size || (sizeGi ? `${sizeGi}Gi` : '');
          if (newSize) {
            let owner = (data?.metadata?.ownerReferences || []).find(
              (r: any) => r.kind === 'VirtualMachine',
            );

            if (!owner) {
              try {
                const base = (cloud.endpoint || '').replace(/\/+$/, '');
                let origin = base;
                try {
                  const u = new URL(base);
                  origin = `${u.protocol}//${u.host}`;
                } catch {
                  origin = base.replace(/\/v[0-9].*$/, '');
                }
                const getUrl = `${origin}/api/v1/namespaces/${encodeURIComponent(
                  namespace,
                )}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`;
                const pvc = await getJsonOnce(getUrl, cloud.secretKey || '', insecure);
                owner = (pvc?.metadata?.ownerReferences || []).find(
                  (r: any) => r.kind === 'VirtualMachine',
                );
              } catch (e) {
                console.warn('Failed to fetch PVC for owner check', e);
              }
            }

            if (owner && owner.name) {
              syncVmVolumeSize(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                namespace,
                owner.name,
                pvcName,
                newSize,
              ).catch((err: any) =>
                console.error('Failed to sync VM volume size annotation', err),
              );
            } else {
              console.log(
                `[PVC Update] No VM owner found for PVC ${pvcName}, skipping annotation sync.`,
              );
            }
          }
        }

        res.json({ message: '更新成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '更新卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '失败：PVC 未找到（404）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:pvcName/clone',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const {
          targetNamespace,
          newName,
          sizeGi,
          size,
          storageClassName,
          fromSnapshotName,
          accessModes,
          volumeMode,
        } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await clonePVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          {
            targetNamespace,
            newName,
            sizeGi,
            size,
            storageClassName,
            fromSnapshotName,
            accessModes,
            volumeMode,
          },
        );
        res.json({ message: '克隆创建成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '克隆卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 409 || lower.includes('already exists')) {
          msg = '失败：同名PVC已存在（409）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params as any;
        const { namespace, name, sizeGi, size, accessModes, volumeMode, storageClassName, annotations } =
          (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        if (!namespace || !name)
          return res.status(400).json({ message: '缺少必要参数：namespace、name' });
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await createHarvesterPVCVolume(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          { namespace, name, sizeGi: sizeGi || size, accessModes, volumeMode, storageClassName, annotations },
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '创建卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '创建失败：权限不足（403）。请检查登录账号的集群写权限。';
        } else if (status === 409 || lower.includes('already exists')) {
          msg = '创建失败：同名卷已存在（409）。请更换名称或删除后再试。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '创建失败：命名空间不存在（404）。请确认命名空间是否正确。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  // Longhorn Volumes (Underlying Longhorn volume delete)
  router.delete(
    '/:id/resources/harvester/longhorn/volumes/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;

        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
          if ((req.user as any).organizationId) {
            where.organizationId = (req.user as any).organizationId;
          }
          const userSpace = await userSpaceRepo.findOne({ where });
          if (!userSpace) return res.status(403).json({ message: '无权访问该云资源' });

          const validNamespaces = userSpace.namespace ? userSpace.namespace.split(',').map((s) => s.trim()) : [];
          if ((req.user as any).organizationId) {
            validNamespaces.push(`ns-${(req.user as any).organizationId}`);
          }

          if (!validNamespaces.includes(namespace)) {
            return res.status(403).json({ message: '无权访问该命名空间资源' });
          }
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 操作', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        await deleteHarvesterLonghornVolume(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name,
        );

        res.json({ message: '删除成功' });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '删除卷失败', error: error.message });
      }
    },
  );

  // Images (List)
  router.get(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterImageInventory);

        let whereCondition: any = { cloudId: id };
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req as any).user?.role === 'tenant';

        if (isTenantUser || isTenantRole) {
          const tenantId = (req as any).user.tenantId;
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const matches = await userSpaceRepo.find({
            where: [
              { tenantId, cloudId: id, status: 'active', organizationId: (req.user as any).organizationId },
              { tenantId, cloudId: id, status: 'active', organizationId: null },
            ],
          });
          const us = matches.find((m) => m.organizationId === (req.user as any).organizationId) || matches[0];

          if (!us) return res.json({ message: '查询成功', data: { items: [] } });

          if (us.namespace) {
            whereCondition = [
              { cloudId: id, namespace: us.namespace },
              { cloudId: id, namespace: 'cloud-public' },
              { cloudId: id, namespace: 'Cloud-Public' },
            ];
          } else {
            whereCondition = [
              { cloudId: id, namespace: 'cloud-public' },
              { cloudId: id, namespace: 'Cloud-Public' },
            ];
          }
        }

        const count = await repo.count({ where: whereCondition });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterImages(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Images failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => {
          const r = i.rawData || {};
          const name = r.metadata?.name || i.name || '';
          const namespace = r.metadata?.namespace || i.namespace || '';
          const displayName = r.spec?.displayName || i.displayName || name;
          const size = r.status?.size || i.size || 0;
          const progress = r.status?.progress || i.progress || 0;
          const conditions = r.status?.conditions || [];
          let state = 'Unknown';
          const imported = conditions.find((c: any) => c.type === 'Imported');
          if (imported?.status === 'True') state = 'Active';
          else if (imported?.status === 'False') state = 'Failed';
          else if (progress < 100) state = 'Downloading';

          const createdAt = r.metadata?.creationTimestamp;

          return {
            ...r,
            id: r.metadata?.uid || i.uid,
            name,
            namespace,
            displayName,
            size,
            progress,
            state,
            createdAt,
            conditions,
          };
        });

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询镜像失败', error: error.message });
      }
    },
  );

  // Images (Detail / CRUD)
  router.get(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
          namespace,
        )}/virtualmachineimages/${encodeURIComponent(name)}`;
        let json: any = null;
        try {
          json = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
        } catch {
          const urlV1 = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
            namespace,
          )}/virtualmachineimages/${encodeURIComponent(name)}`;
          json = await getJsonOnce(urlV1, cloud.secretKey || '', insecure, true);
        }

        res.json({ message: '查询成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '查询镜像详情失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const url = `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
          namespace,
        )}/${encodeURIComponent(name)}`;
        await requestJson('DELETE', url, cloud.secretKey || '', insecure, undefined);
        res.json({ message: '删除成功' });
      } catch (error: any) {
        res.status(500).json({ message: '删除镜像失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params as any;
        const {
          namespace,
          name,
          displayName,
          sourceType,
          url,
          targetStorageClassName,
          storageClassParameters,
        } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建')) return;
        if (!namespace || !(name || displayName))
          return res.status(400).json({ message: '缺少必填参数：namespace、name 或 displayName' });
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const urlPath = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
          namespace,
        )}/virtualmachineimages`;
        const body = {
          apiVersion: 'harvesterhci.io/v1beta1',
          kind: 'VirtualMachineImage',
          metadata: {
            name: name || undefined,
            generateName: name ? undefined : 'image-',
            namespace,
          },
          spec: {
            displayName: displayName || name || 'image',
            sourceType: sourceType || (url ? 'download' : 'upload'),
            url: url || '',
            targetStorageClassName: targetStorageClassName || 'longhorn',
            storageClassParameters: storageClassParameters || {},
          },
        };
        const json = await requestJson('POST', urlPath, cloud.secretKey || '', insecure, body);
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '创建镜像失败', error: error.message });
      }
    },
  );

  router.put(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const { displayName, retry, targetStorageClassName, storageClassParameters } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源更新')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const getUrl = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
          namespace,
        )}/virtualmachineimages/${encodeURIComponent(name)}`;
        const current = await getJsonOnce(getUrl, cloud.secretKey || '', insecure);
        const next = {
          apiVersion: current?.apiVersion || 'harvesterhci.io/v1beta1',
          kind: current?.kind || 'VirtualMachineImage',
          metadata: { ...(current?.metadata || {}), name, namespace },
          spec: {
            ...(current?.spec || {}),
            ...(displayName ? { displayName } : {}),
            ...(typeof retry === 'number' ? { retry } : {}),
            ...(targetStorageClassName ? { targetStorageClassName } : {}),
            ...(storageClassParameters ? { storageClassParameters } : {}),
          },
        };
        const putUrl = getUrl;
        const json = await requestJson('PUT', putUrl, cloud.secretKey || '', insecure, next);
        res.json({ message: '更新成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '更新镜像失败', error: error.message });
      }
    },
  );

  // Snapshots (Inventory Cache First)
  router.get(
    '/:id/resources/harvester/snapshots',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterSnapshotInventory);

        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });

          const allowedNamespaces: string[] = [];
          if (us.namespace) {
            us.namespace.split(',').forEach((ns) => allowedNamespaces.push(ns.trim()));
          }

          if ((req.user as any).organizationId) {
            allowedNamespaces.push(`ns-${(req.user as any).organizationId}`);
          }

          if (allowedNamespaces.length > 0) {
            whereCondition = [...allowedNamespaces.map((ns) => ({ cloudId: id, namespace: ns }))];
          }
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterSnapshots(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Snapshots failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询快照失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/snapshots/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const opts = {
          endpoint: cloud.endpoint,
          token: cloud.secretKey,
          insecure,
        } as any;

        try {
          await deleteHarvesterVirtualMachineSnapshot(opts, namespace, name);
        } catch (e: any) {
          if (Number(e?.status) === 404 || String(e?.message).includes('404')) {
            try {
              await deleteHarvesterVolumeSnapshot(opts, namespace, name);
            } catch (e2: any) {
              throw e2;
            }
          } else {
            throw e;
          }
        }

        try {
          await syncHarvesterSnapshots(cloud, insecure);
        } catch (e) {
          console.warn('Sync Snapshots after delete failed', e);
        }

        res.json({ message: '删除成功' });
      } catch (error: any) {
        res.status(500).json({ message: '删除快照失败', error: error.message });
      }
    },
  );

  // Backups (Inventory Cache First)
  router.get(
    '/:id/resources/harvester/backups',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterBackupInventory);

        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });

          const allowedNamespaces: string[] = [];
          if (us.namespace) {
            us.namespace.split(',').forEach((ns) => allowedNamespaces.push(ns.trim()));
          }

          if ((req.user as any).organizationId) {
            allowedNamespaces.push(`ns-${(req.user as any).organizationId}`);
          }

          if (allowedNamespaces.length > 0) {
            whereCondition = [...allowedNamespaces.map((ns) => ({ cloudId: id, namespace: ns }))];
          }
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterBackups(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Backups failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询备份失败', error: error.message });
      }
    },
  );

  // Schedule VM Backups
  router.get(
    '/:id/resources/harvester/schedulevmbackups',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterScheduleVmBackupInventory);

        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });

          const allowedNamespaces: string[] = [];
          if (us.namespace) {
            us.namespace.split(',').forEach((ns) => allowedNamespaces.push(ns.trim()));
          }

          if ((req.user as any).organizationId) {
            allowedNamespaces.push(`ns-${(req.user as any).organizationId}`);
          }

          if (allowedNamespaces.length > 0) {
            whereCondition = [...allowedNamespaces.map((ns) => ({ cloudId: id, namespace: ns }))];
          }
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterScheduleVmBackups(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync ScheduleVmBackups failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询定时备份失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/schedulevmbackups',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const payload = req.body;

        await createHarvesterScheduleVmBackup(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          payload.namespace,
          payload,
        );

        try {
          await syncHarvesterScheduleVmBackups(cloud, insecure);
        } catch (e) {
          console.warn('Sync after create failed', e);
        }

        res.json({ message: '创建定时备份成功' });
      } catch (error: any) {
        res.status(500).json({ message: '创建定时备份失败', error: error.body || error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/harvester/schedulevmbackups/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const payload = req.body;

        await updateHarvesterScheduleVmBackup(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name,
          payload,
        );

        try {
          await syncHarvesterScheduleVmBackups(cloud, insecure);
        } catch (e) {
          console.warn('Sync after update failed', e);
        }

        res.json({ message: '更新定时备份成功' });
      } catch (error: any) {
        res.status(500).json({ message: '更新定时备份失败', error: error.body || error.message });
      }
    },
  );

  router.put(
    '/:id/resources/harvester/schedulevmbackups/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const payload = req.body;

        await updateHarvesterScheduleVmBackup(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name,
          payload,
        );

        try {
          await syncHarvesterScheduleVmBackups(cloud, insecure);
        } catch (e) {
          console.warn('Sync after update failed', e);
        }

        res.json({ message: '更新定时备份成功' });
      } catch (error: any) {
        res.status(500).json({ message: '更新定时备份失败', error: error.body || error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/schedulevmbackups/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        await deleteHarvesterScheduleVmBackup(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name,
        );

        try {
          await syncHarvesterScheduleVmBackups(cloud, insecure);
        } catch (e) {
          console.warn('Sync after delete failed', e);
        }

        res.json({ message: '删除定时备份成功' });
      } catch (error: any) {
        res.status(500).json({ message: '删除定时备份失败', error: error.body || error.message });
      }
    },
  );

  // VM Backup/Snapshot Create/Delete
  router.post(
    '/:id/resources/harvester/virtualmachinebackups/:namespace',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const { name, vmName, type, alias } = req.body;
        if (!name || !vmName || !type) {
          return res.status(400).json({ message: 'Missing required fields: name, vmName, type' });
        }
        if (type !== 'backup' && type !== 'snapshot') {
          return res.status(400).json({ message: 'Invalid type: must be \"backup\" or \"snapshot\"' });
        }

        const result = await createHarvesterVirtualMachineBackup(
          { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any,
          namespace,
          { name, vmName, type, alias },
        );

        try {
          await syncHarvesterBackups(cloud, insecure);
        } catch (e) {
          console.warn('Sync after create failed', e);
        }

        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '创建失败', error: error.body || error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/backups/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const result = await deleteHarvesterVirtualMachineBackup(
          { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any,
          namespace,
          name,
        );

        try {
          await syncHarvesterBackups(cloud, insecure);
        } catch (e) {
          console.warn('Sync after delete failed', e);
        }

        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除失败', error: error.body || error.message });
      }
    },
  );

  // VM Restore
  router.post(
    '/:id/resources/harvester/virtualmachinerestores/:namespace',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const result = await createHarvesterVirtualMachineRestore(
          { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any,
          namespace,
          req.body,
        );

        res.json({ message: '创建恢复任务成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '创建恢复任务失败', error: error.body || error.message });
      }
    },
  );

  // Cluster capabilities related to storage (delegated here for cohesion)
  router.get(
    '/:id/resources/harvester/capabilities',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await getHarvesterCapabilities({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);

        res.json({ message: '查询成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '获取集群能力失败', error: error.message });
      }
    },
  );
};
