/**
 * d:\ComputeTower\Compute.Tower\backend\src\routes\clouds\harvester\harvester.cache.storage.routes.ts
 *
 * Harvester 存储资源路由模块 (Harvester Storage Routes)
 * =============================================================================
 * [功能描述]
 * 本模块负责处理 Harvester 云平台的存储相关资源请求，包括卷 (Volumes)、镜像 (Images)、
 * 快照 (Snapshots) 和备份 (Backups)。
 * 它实现了从本地缓存读取数据、实时同步数据、以及向 Harvester API 发起增删改查操作的功能。
 * 同时包含了严格的租户隔离逻辑，确保租户只能访问授权的命名空间资源。
 *
 * [核心逻辑]
 * 1. [卷管理]      : 查询卷列表 (支持缓存/实时强制刷新)、创建/删除 PVC、挂载/卸载卷。
 * 2. [镜像管理]    : 查询镜像列表、创建/更新/删除镜像 (VirtualMachineImage)。
 * 3. [快照/备份]   : 管理虚拟机快照和备份，支持定时备份策略 (ScheduleVmBackup)。
 * 4. [租户隔离]    : 针对租户角色 (tenant)，自动过滤 UserSpace 授权的命名空间。
 * 5. [自动修复]    : 自动检测并修复 UserSpace 中缺失的组织命名空间 (ns-{orgId})。
 * 6. [异常处理]    : 统一捕获 Harvester API 错误，转换为用户友好的提示信息 (403/404/409)。
 *
 * [API 接口清单]
 * -----------------------------------------------------------------------------
 * GET    /:id/resources/harvester/volumes                          查询卷列表
 * DELETE /:id/resources/harvester/longhorn/volumes/:namespace/:name 删除 Longhorn 卷 (底层)
 * GET    /:id/resources/harvester/available-volumes                查询可用卷 (未挂载)
 * GET    /:id/resources/harvester/storage-classes                  查询存储类
 * POST   /:id/resources/harvester/vms/:instanceId/add-volume       挂载卷到 VM (ID)
 * POST   /:id/resources/harvester/vms/:namespace/:name/add-volume  挂载卷到 VM (Direct)
 * POST   /:id/resources/harvester/vms/:instanceId/remove-volume    卸载卷
 * DELETE /:id/resources/harvester/volumes/:namespace/:name         删除 PVC
 * POST   /:id/resources/harvester/volumes/:namespace/:pvcName/export-image 导出镜像
 * POST   /:id/resources/harvester/volumes/:namespace/:pvcName/snapshots    创建卷快照
 * PUT    /:id/resources/harvester/volumes/:namespace/:pvcName      更新 PVC 规格
 * POST   /:id/resources/harvester/volumes/:namespace/:pvcName/clone 克隆 PVC
 * POST   /:id/resources/harvester/volumes                          创建 PVC
 * GET    /:id/resources/harvester/images                           查询镜像列表
 * GET    /:id/resources/harvester/images/:namespace/:name          查询镜像详情
 * DELETE /:id/resources/harvester/images/:namespace/:name          删除镜像
 * POST   /:id/resources/harvester/images                           创建镜像
 * PUT    /:id/resources/harvester/images/:namespace/:name          更新镜像
 * GET    /:id/resources/harvester/snapshots                        查询快照列表
 * DELETE /:id/resources/harvester/snapshots/:namespace/:name       删除快照
 * GET    /:id/resources/harvester/backups                          查询备份列表
 * DELETE /:id/resources/harvester/backups/:namespace/:name         删除备份
 * GET    /:id/resources/harvester/schedulevmbackups                查询定时备份
 * POST   /:id/resources/harvester/schedulevmbackups                创建定时备份
 * PATCH  /:id/resources/harvester/schedulevmbackups/:namespace/:name 更新定时备份
 * PUT    /:id/resources/harvester/schedulevmbackups/:namespace/:name 更新定时备份 (兼容)
 * DELETE /:id/resources/harvester/schedulevmbackups/:namespace/:name 删除定时备份
 * POST   /:id/resources/harvester/virtualmachinebackups/:namespace 创建 VM 备份/快照
 * DELETE /:id/resources/harvester/backups/:namespace/:name         删除 VM 备份
 * POST   /:id/resources/harvester/virtualmachinerestores/:namespace 恢复 VM
 * GET    /:id/resources/harvester/capabilities                     查询集群能力
 * =============================================================================
 */

import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { In } from 'typeorm';
import { UserSpace } from '../../../entities/UserSpace';
import { KubevirtVolumeInventory } from '../../../entities/kubevirt/KubevirtVolumeInventory';
import { KubevirtStorageClassInventory } from '../../../entities/kubevirt/KubevirtStorageClassInventory';
import { HarvesterImageInventory } from '../../../entities/harvester/HarvesterImageInventory';
import { HarvesterSnapshotInventory } from '../../../entities/harvester/HarvesterSnapshotInventory';
import { HarvesterBackupInventory } from '../../../entities/harvester/HarvesterBackupInventory';
import { HarvesterScheduleVmBackupInventory } from '../../../entities/harvester/HarvesterScheduleVmBackupInventory';
import { HarvesterVmInventory } from '../../../entities/harvester/HarvesterVmInventory';
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

/**
 * 注册 Harvester 存储相关路由
 * @param router Express 路由对象
 * @param checkAdminPermission 权限检查中间件
 */
export const registerHarvesterStorageRoutes = (router: Router, checkAdminPermission: any) => {
  // ===========================================================================
  // [卷管理] Volumes (List / CRUD)
  // ===========================================================================

  /**
   * [GET] /:id/resources/harvester/volumes
   * 查询卷列表 (Volumes/PVCs)
   * ---------------------------------------------------------------------------
   * 支持 force=true 强制刷新缓存。
   * 包含租户隔离逻辑：Tenant 用户只能看到 UserSpace 授权的命名空间下的卷。
   */
  router.get(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        
        // [校验] 检查云资源是否存在及类型
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubevirtVolumeInventory);

        // [租户隔离] 过滤 UserSpace 命名空间
        let whereCondition: any = { cloudId: id };
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const userOrgId = (req.user as any).organizationId;
          const whereClause: any[] = [];

          // [UserSpace Query] 查询当前用户所属组织的 UserSpace 记录（组织隔离）
          // 组织级用户：只查询 organizationId = userOrgId 的记录
          // 租户级用户（无 organizationId）：查询 organizationId = null 的记录
          if (userOrgId) {
            whereClause.push({
              tenantId: (req.user as any).tenantId,
              cloudId: id,
              status: 'active',
              organizationId: userOrgId, // 严格限制：只查询当前组织的 UserSpace
            });
          } else {
            whereClause.push({
              tenantId: (req.user as any).tenantId,
              cloudId: id,
              status: 'active',
              organizationId: null, // 租户级用户：查询租户级的 UserSpace
            });
          }

          const matches = await userSpaceRepo.find({ where: whereClause });

          if (!matches || matches.length === 0) {
            return res.json({ message: '查询成功', data: { items: [] } });
          }

          // [Namespace Aggregation] 聚合同一组织内所有 UserSpace 记录的命名空间
          // 注意：不会跨组织聚合，因为查询条件已限制 organizationId
          const uniqueNamespaces = new Set<string>();
          matches.forEach((m) => {
            if (m.namespace) {
              m.namespace.split(',').forEach((ns) => {
                const trimmed = ns.trim();
                if (trimmed) uniqueNamespaces.add(trimmed);
              });
            }
          });

          // Auto-Fix: Ensure organization namespace is included
          if (userOrgId) {
            const orgNs = `ns-${userOrgId}`;
            if (!uniqueNamespaces.has(orgNs)) {
              uniqueNamespaces.add(orgNs);
              // Update the first matching UserSpace record
              const firstMatch = matches.find(m => m.organizationId === userOrgId) || matches[0];
              if (firstMatch) {
                const nsList = Array.from(uniqueNamespaces);
                firstMatch.namespace = nsList.join(',');
                try {
                  await userSpaceRepo.save(firstMatch);
                } catch (e) {
                  console.warn('Failed to auto-update UserSpace namespace', e);
                }
              }
            }
          }

          if (uniqueNamespaces.size === 0) {
            return res.json({ message: '查询成功', data: { items: [] } });
          }

          whereCondition.namespace = In(Array.from(uniqueNamespaces));
        }

        // [缓存策略] 自动同步逻辑
        // 触发条件: 1. 本地无数据 (count === 0) 2. 显式强制刷新 (force === 'true' 且 skipSync !== 'true')
        // skipSync=true 表示创建后刷新，数据已直接入库，只需查询数据库，无需全量同步
        const { force, skipSync } = req.query;
        const count = await repo.count({ where: whereCondition });
        const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
        
        if (shouldSync) {
          try {
            await syncHarvesterVolumes(cloud, insecure);
            // 同步后重新获取 repository，确保查询使用最新数据
            console.log(`[Volume-Query] 同步完成，cloudId: ${id}`);
          } catch (e: any) {
            console.warn('Sync Volumes failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        } else if (String(skipSync) === 'true') {
          console.log(`[Volume-Query] 跳过全量同步（创建后刷新），直接查询数据库，cloudId: ${id}`);
        }

        const items = await repo.find({ where: whereCondition });

        // [数据格式化] 转换为前端友好的格式
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

          // 解析挂载状态
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
                  // 移除 virt-launcher 前缀，显示真实的 VM 名称
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

  /**
   * [DELETE] /:id/resources/harvester/longhorn/volumes/:namespace/:name
   * 删除底层 Longhorn 卷
   * ---------------------------------------------------------------------------
   * 直接操作 Longhorn API 删除卷，通常用于 PVC 删除失败后的清理。
   */
  router.delete(
    '/:id/resources/harvester/longhorn/volumes/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;

        // [权限检查] 租户只能删除自己命名空间下的卷
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

  /**
   * [GET] /:id/resources/harvester/available-volumes
   * 查询可用卷 (未挂载)
   * ---------------------------------------------------------------------------
   * 筛选状态为 'bound' 且未挂载到任何 VM 的卷，用于挂载操作的选择列表。
   */
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

        // [修复] 查询所有虚拟机，提取所有被虚拟机使用的 PVC
        // 无论虚拟机是否运行、是否在回收站，只要卷在 VM spec 中定义，就不应该出现在"可用卷"列表中
        const vmRepo = AppDataSource.getRepository(HarvesterVmInventory);
        const allVms = await vmRepo.find({ where: { cloudId: id } });
        
        // 构建所有被虚拟机使用的 PVC 集合（使用 namespace/pvcName 作为键）
        const usedPvcSet = new Set<string>();
        allVms.forEach((vm) => {
          const vmData = vm.rawData || {};
          const vmNs = vmData?.metadata?.namespace || vm.namespace || '';
          
          // 从 VM spec.template.spec.volumes 中提取所有 PVC
          const volumes = vmData?.spec?.template?.spec?.volumes || [];
          volumes.forEach((vol: any) => {
            const claimName = vol?.persistentVolumeClaim?.claimName;
            if (claimName && vmNs) {
              usedPvcSet.add(`${vmNs}/${claimName}`);
            }
          });
        });

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

            // [修复] 检查卷是否被任何虚拟机使用（无论虚拟机是否运行、是否在回收站）
            // 只要卷在某个 VM 的 spec.template.spec.volumes 中定义，就认为它"属于"这个 VM
            const pvcKey = `${ns}/${pvcName}`;
            const isUsedByVm = usedPvcSet.has(pvcKey);

            const viewUrl = `${origin}/api/v1/namespaces/${ns}/persistentvolumeclaims/${name}`;

            return {
              ...v,
              name,
              pvcName,
              namespace: ns,
              size,
              state,
              attached,
              isUsedByVm, // 标记是否被虚拟机使用
              links: { view: viewUrl },
            };
          })
          .filter((x: any) => {
            // [筛选规则] 只返回 Bound 且未挂载的卷，并且未被任何虚拟机使用
            const isBound = String(x.state).toLowerCase() === 'bound';
            return isBound && !x.attached && !x.isUsedByVm;
          });

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询可用卷失败', error: error.message });
      }
    },
  );

  /**
   * [GET] /:id/resources/harvester/storage-classes
   * 查询存储类 (StorageClasses)
   */
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

  // ===========================================================================
  // [卷操作] Volume Operations
  // ===========================================================================

  /**
   * [POST] /:id/resources/harvester/vms/:instanceId/add-volume
   * 挂载卷到 VM (使用 Instance ID)
   */
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

  /**
   * [POST] /:id/resources/harvester/vms/:namespace/:name/add-volume
   * 挂载卷到 VM (直接使用 Namespace/Name)
   */
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

  /**
   * [POST] /:id/resources/harvester/vms/:instanceId/remove-volume
   * 卸载卷
   */
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

  /**
   * [DELETE] /:id/resources/harvester/volumes/:namespace/:name
   * 删除 PVC
   * ---------------------------------------------------------------------------
   * 包含详细的错误处理逻辑，将 403/404/409 等状态码转换为友好的中文提示。
   */
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
        // [错误处理] 转换错误消息
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '删除卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('permissiondenied')) {
          msg =
            '删除失败：权限不足或接口不支持删除（403）。请检查登录账号权限，或通过 Longhorn 卷 CRD 路径执行删除。';
        } else if (status === 404 || lower.includes('not found')) {
          return res.json({ message: '删除成功', data: { status: 'AlreadyDeleted' } });
        } else if (status === 409 || lower.includes('conflict') || lower.includes('in use')) {
          msg = `删除虚拟磁盘失败：虚拟磁盘 ${name} 正在被云主机使用，请先在云主机中卸载该磁盘后再删除。`;
        } else if (lower.includes('method delete not supported')) {
          msg = '删除失败：当前接口不支持删除操作。请使用 Longhorn CRD API 路径删除。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  /**
   * [POST] /:id/resources/harvester/volumes/:namespace/:pvcName/export-image
   * 从 PVC 导出镜像
   */
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

  /**
   * [POST] /:id/resources/harvester/volumes/:namespace/:pvcName/snapshots
   * 创建卷快照 (VolumeSnapshot)
   */
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
        
        // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
        // 注意：只有当返回数据包含 metadata.uid 时才入库，避免空字符串导致唯一索引冲突
        if (data && data.metadata && data.metadata.uid) {
          try {
            const repo = AppDataSource.getRepository(HarvesterSnapshotInventory);
            const uid = data.metadata.uid;
            const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
            
            if (existing) {
              // 更新现有记录
              existing.name = data.metadata?.name || '';
              existing.namespace = data.metadata?.namespace || namespace;
              existing.sourcePvc = data.spec?.source?.persistentVolumeClaimName || pvcName;
              existing.status = data.status?.readyToUse ? 'Ready' : 'NotReady';
              existing.size = data.status?.restoreSize;
              existing.restoreSize = data.status?.restoreSize;
              existing.snapshotClassName = data.spec?.volumeSnapshotClassName || snapshotClassName;
              existing.labels = data.metadata?.labels;
              existing.annotations = data.metadata?.annotations;
              existing.rawData = data;
              await repo.save(existing);
              console.log(`[Snapshot-Create] 快照已更新，cloudId: ${cloud.id}, name: ${data.metadata?.name}`);
            } else {
              // 插入新记录
              const entity = repo.create({
                cloudId: cloud.id,
                uid: uid,
                name: data.metadata?.name || '',
                namespace: data.metadata?.namespace || namespace,
                sourcePvc: data.spec?.source?.persistentVolumeClaimName || pvcName,
                status: data.status?.readyToUse ? 'Ready' : 'NotReady',
                size: data.status?.restoreSize,
                restoreSize: data.status?.restoreSize,
                snapshotClassName: data.spec?.volumeSnapshotClassName || snapshotClassName,
                labels: data.metadata?.labels,
                annotations: data.metadata?.annotations,
                rawData: data,
              });
              await repo.save(entity);
              console.log(`[Snapshot-Create] 快照已入库，cloudId: ${cloud.id}, name: ${data.metadata?.name}`);
            }
          } catch (e: any) {
            console.error('[Snapshot-Create] 入库快照失败:', e?.message || e);
            // 入库失败不影响创建操作的成功返回
          }
        } else if (data && data.metadata && !data.metadata.uid) {
          console.warn(`[Snapshot-Create] 创建成功但返回数据缺少 uid，跳过入库，cloudId: ${cloud.id}, name: ${data.metadata?.name || name}`);
        }
        
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

  /**
   * [PUT] /:id/resources/harvester/volumes/:namespace/:pvcName
   * 更新 PVC 规格 (如扩容)
   * ---------------------------------------------------------------------------
   * 特殊逻辑：如果是扩容操作 (size 变更)，会自动尝试更新所属 VM 的 volume size annotation，
   * 以实现 VM 内部的感知 (需要 QEMU Guest Agent)。
   */
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

        // [业务逻辑] 同步 VM 卷大小标注
        if (sizeGi || size) {
          const newSize = size || (sizeGi ? `${sizeGi}Gi` : '');
          if (newSize) {
            let owner = (data?.metadata?.ownerReferences || []).find(
              (r: any) => r.kind === 'VirtualMachine',
            );

            if (!owner) {
              try {
                // 尝试重新获取 PVC 以确认 owner (某些情况下返回的 data 可能不全)
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

  /**
   * [POST] /:id/resources/harvester/volumes/:namespace/:pvcName/clone
   * 克隆 PVC
   */
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

  /**
   * [POST] /:id/resources/harvester/volumes
   * 创建 PVC
   */
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
        
        // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
        // 注意：只有当返回数据包含 metadata.uid 时才入库，避免空字符串导致唯一索引冲突
        if (data && data.metadata && data.metadata.uid) {
          try {
            const repo = AppDataSource.getRepository(KubevirtVolumeInventory);
            const uid = data.metadata.uid;
            const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
            
            if (existing) {
              // 更新现有记录
              existing.name = data.metadata?.name || '';
              existing.namespace = data.metadata?.namespace || namespace;
              existing.phase = data.status?.phase;
              existing.capacity = data.status?.capacity?.storage;
              existing.storageClassName = data.spec?.storageClassName || storageClassName;
              existing.volumeMode = data.spec?.volumeMode || volumeMode;
              existing.accessModes = Array.isArray(data.spec?.accessModes) ? data.spec.accessModes.join(',') : '';
              existing.labels = data.metadata?.labels;
              existing.annotations = data.metadata?.annotations;
              existing.rawData = data;
              await repo.save(existing);
              console.log(`[Volume-Create] PVC 已更新，cloudId: ${cloud.id}, name: ${data.metadata?.name}`);
            } else {
              // 插入新记录
              const entity = repo.create({
                cloudId: cloud.id,
                uid: uid,
                name: data.metadata?.name || '',
                namespace: data.metadata?.namespace || namespace,
                phase: data.status?.phase,
                capacity: data.status?.capacity?.storage,
                storageClassName: data.spec?.storageClassName || storageClassName,
                volumeMode: data.spec?.volumeMode || volumeMode,
                accessModes: Array.isArray(data.spec?.accessModes) ? data.spec.accessModes.join(',') : '',
                labels: data.metadata?.labels,
                annotations: data.metadata?.annotations,
                rawData: data,
              });
              await repo.save(entity);
              console.log(`[Volume-Create] PVC 已入库，cloudId: ${cloud.id}, name: ${data.metadata?.name}`);
            }
          } catch (e: any) {
            console.error('[Volume-Create] 入库 PVC 失败:', e?.message || e);
            // 入库失败不影响创建操作的成功返回
          }
        } else if (data && data.metadata && !data.metadata.uid) {
          console.warn(`[Volume-Create] 创建成功但返回数据缺少 uid，跳过入库，cloudId: ${cloud.id}, name: ${data.metadata?.name || name}`);
        }
        
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

  /**
   * [DELETE] /:id/resources/harvester/longhorn/volumes/:namespace/:name
   * (重复定义，已在上方定义，此处保留以防遗漏，但逻辑上是重复的，建议移除或合并)
   * 修正：代码中确实出现了两次 delete longhorn volumes 的路由注册。
   * 下面这个 block 是第 742 行的副本。我们将忽略它，因为已经处理过了。
   * 实际上，原代码 197 行和 742 行是完全一样的路由定义。
   * 在这里我们不需要重复注册。
   */
  
  // ===========================================================================
  // [镜像管理] Images (List / CRUD)
  // ===========================================================================

  /**
   * [GET] /:id/resources/harvester/images
   * 查询镜像列表
   * ---------------------------------------------------------------------------
   * 支持 force=true。
   * 租户隔离：UserSpace namespace + 公共命名空间 (harvester-public, cloud-public, default)。
   */
  router.get(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
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
            const allowed = us.namespace.split(',').map(s => s.trim()).filter(Boolean);
            
            // [自动修复] 确保组织命名空间存在
            if ((req.user as any).organizationId) {
               const orgNs = `ns-${(req.user as any).organizationId}`;
               if (!allowed.includes(orgNs)) {
                  allowed.push(orgNs);
                  // Update UserSpace record immediately
                  us.namespace = allowed.join(',');
                  try {
                     await userSpaceRepo.save(us);
                  } catch (e) {
                     console.warn('Failed to auto-update UserSpace namespace', e);
                  }
               }
            }

            whereCondition = [
              ...allowed.map(ns => ({ cloudId: id, namespace: ns })),
              { cloudId: id, namespace: 'cloud-public' },
              { cloudId: id, namespace: 'Cloud-Public' },
              { cloudId: id, namespace: 'harvester-public' }, // Support harvester-public
              { cloudId: id, namespace: 'default' }, // Allow access to default namespace images
            ];
          } else {
             // Even if namespace is empty, check for orgNs auto-fix
             if ((req.user as any).organizationId) {
                const orgNs = `ns-${(req.user as any).organizationId}`;
                us.namespace = orgNs;
                try {
                   await userSpaceRepo.save(us);
                   whereCondition = [
                      { cloudId: id, namespace: orgNs },
                      { cloudId: id, namespace: 'cloud-public' },
                      { cloudId: id, namespace: 'Cloud-Public' },
                      { cloudId: id, namespace: 'harvester-public' },
                      { cloudId: id, namespace: 'default' },
                   ];
                } catch (e) {
                   console.warn('Failed to auto-update UserSpace namespace', e);
                   whereCondition = [
                    { cloudId: id, namespace: 'cloud-public' },
                    { cloudId: id, namespace: 'Cloud-Public' },
                    { cloudId: id, namespace: 'harvester-public' },
                    { cloudId: id, namespace: 'default' },
                  ];
                }
             } else {
                whereCondition = [
                  { cloudId: id, namespace: 'cloud-public' },
                  { cloudId: id, namespace: 'Cloud-Public' },
                  { cloudId: id, namespace: 'harvester-public' },
                  { cloudId: id, namespace: 'default' },
                ];
             }
          }
        }

        // [缓存策略] 自动同步逻辑
        // 触发条件: 1. 本地无数据 (count === 0) 2. 显式强制刷新 (force === 'true' 且 skipSync !== 'true')
        // skipSync=true 表示创建后刷新，数据已直接入库，只需查询数据库，无需全量同步
        const { force, skipSync } = req.query;
        const count = await repo.count({ where: whereCondition });
        const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
        
        if (shouldSync) {
          try {
            await syncHarvesterImages(cloud, insecure);
            // 同步后重新获取 repository，确保查询使用最新数据
            console.log(`[Image-Query] 同步完成，cloudId: ${id}`);
          } catch (e: any) {
            console.warn('Sync Images failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        } else if (String(skipSync) === 'true') {
          console.log(`[Image-Query] 跳过全量同步（创建后刷新），直接查询数据库，cloudId: ${id}`);
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

  /**
   * [GET] /:id/resources/harvester/images/:namespace/:name
   * 查询镜像详情 (实时)
   */
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

        // 尝试 v1beta1 和 v1 两个版本的 API
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

  /**
   * [DELETE] /:id/resources/harvester/images/:namespace/:name
   * 删除镜像
   */
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

  /**
   * [POST] /:id/resources/harvester/images
   * 创建镜像
   */
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
        const urlV1beta1 = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
          namespace,
        )}/virtualmachineimages`;
        const urlV1 = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
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
        let json: any;
        try {
          json = await requestJson('POST', urlV1beta1, cloud.secretKey || '', insecure, body);
        } catch {
          json = await requestJson('POST', urlV1, cloud.secretKey || '', insecure, body);
        }
        
        // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
        // 注意：只有当返回数据包含 metadata.uid 时才入库，避免空字符串导致唯一索引冲突
        if (json && json.metadata && json.metadata.uid) {
          try {
            const repo = AppDataSource.getRepository(HarvesterImageInventory);
            const uid = json.metadata.uid;
            const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
            
            if (existing) {
              // 更新现有记录
              existing.name = json.metadata?.name || '';
              existing.namespace = json.metadata?.namespace || namespace;
              existing.displayName = json.spec?.displayName || displayName || name;
              existing.progress = json.status?.progress;
              existing.size = String(json.status?.size || json.status?.downloadedBytes || '0');
              existing.storageClassName = json.spec?.storageClassName || targetStorageClassName;
              existing.labels = json.metadata?.labels;
              existing.annotations = json.metadata?.annotations;
              existing.rawData = json;
              await repo.save(existing);
              console.log(`[Image-Create] 镜像已更新，cloudId: ${cloud.id}, name: ${json.metadata?.name}`);
            } else {
              // 插入新记录
              const entity = repo.create({
                cloudId: cloud.id,
                uid: uid,
                name: json.metadata?.name || '',
                namespace: json.metadata?.namespace || namespace,
                displayName: json.spec?.displayName || displayName || name,
                progress: json.status?.progress,
                size: String(json.status?.size || json.status?.downloadedBytes || '0'),
                storageClassName: json.spec?.storageClassName || targetStorageClassName,
                labels: json.metadata?.labels,
                annotations: json.metadata?.annotations,
                rawData: json,
              });
              await repo.save(entity);
              console.log(`[Image-Create] 镜像已入库，cloudId: ${cloud.id}, name: ${json.metadata?.name}`);
            }
          } catch (e: any) {
            console.error('[Image-Create] 入库镜像失败:', e?.message || e);
            // 入库失败不影响创建操作的成功返回
          }
        } else if (json && json.metadata && !json.metadata.uid) {
          console.warn(`[Image-Create] 创建成功但返回数据缺少 uid，跳过入库，cloudId: ${cloud.id}, name: ${json.metadata?.name || name}`);
        }
        
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '创建镜像失败', error: error.message });
      }
    },
  );

  /**
   * [PUT] /:id/resources/harvester/images/:namespace/:name
   * 更新镜像
   */
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

  // ===========================================================================
  // [快照/备份管理] Snapshots & Backups
  // ===========================================================================

  /**
   * [GET] /:id/resources/harvester/snapshots
   * 查询快照列表
   */
  router.get(
    '/:id/resources/harvester/snapshots',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
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
             const orgNs = `ns-${(req.user as any).organizationId}`;
             if (!allowedNamespaces.includes(orgNs)) {
                allowedNamespaces.push(orgNs);
                us.namespace = allowedNamespaces.join(',');
                try {
                   await userSpaceRepo.save(us);
                } catch (e) {
                   console.warn('Failed to auto-update UserSpace namespace', e);
                }
             }
          }

          if (allowedNamespaces.length === 0) {
             return res.json({ message: '查询成功', data: { items: [] } });
          }
          whereCondition = allowedNamespaces.map((ns) => ({ cloudId: id, namespace: ns }));
        }

        // [缓存策略] 自动同步逻辑
        // 触发条件: 1. 本地无数据 (count === 0) 2. 显式强制刷新 (force === 'true' 且 skipSync !== 'true')
        // skipSync=true 表示创建后刷新，数据已直接入库，只需查询数据库，无需全量同步
        const { force, skipSync } = req.query;
        const count = await repo.count({ where: whereCondition });
        const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
        
        if (shouldSync) {
          try {
            await syncHarvesterSnapshots(cloud, insecure);
            // 同步后重新获取 repository，确保查询使用最新数据
            console.log(`[Snapshot-Query] 同步完成，cloudId: ${id}`);
          } catch (e: any) {
            console.warn('Sync Snapshots failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        } else if (String(skipSync) === 'true') {
          console.log(`[Snapshot-Query] 跳过全量同步（创建后刷新），直接查询数据库，cloudId: ${id}`);
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询快照失败', error: error.message });
      }
    },
  );

  /**
   * [DELETE] /:id/resources/harvester/snapshots/:namespace/:name
   * 删除快照
   * ---------------------------------------------------------------------------
   * 尝试删除 VM Snapshot，如果报 404，则尝试删除 Volume Snapshot (兼容性处理)。
   */
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

  /**
   * [GET] /:id/resources/harvester/backups
   * 查询备份列表
   */
  router.get(
    '/:id/resources/harvester/backups',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force, skipSync } = req.query;
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
             const orgNs = `ns-${(req.user as any).organizationId}`;
             if (!allowedNamespaces.includes(orgNs)) {
                allowedNamespaces.push(orgNs);
                us.namespace = allowedNamespaces.join(',');
                try {
                   await userSpaceRepo.save(us);
                } catch (e) {
                   console.warn('Failed to auto-update UserSpace namespace', e);
                }
             }
          }

          if (allowedNamespaces.length === 0) {
             return res.json({ message: '查询成功', data: { items: [] } });
          }
          whereCondition = allowedNamespaces.map((ns) => ({ cloudId: id, namespace: ns }));
        }
        const count = await repo.count({ where: whereCondition });
        // [同步策略] 缓存优先 + 按需同步
        // skipSync=true 表示创建后刷新，数据已入库，只需查询数据库，无需全量同步
        const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
        if (shouldSync) {
          try {
            await syncHarvesterBackups(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Backups failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        } else if (String(skipSync) === 'true') {
          console.log(`[Backup-Refresh] 跳过全量同步（创建后刷新），直接查询数据库`);
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询备份失败', error: error.message });
      }
    },
  );

  // ===========================================================================
  // [定时备份] Schedule VM Backups
  // ===========================================================================

  /**
   * [GET] /:id/resources/harvester/schedulevmbackups
   * 查询定时备份策略
   */
  router.get(
    '/:id/resources/harvester/schedulevmbackups',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
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

          if (allowedNamespaces.length > 0) {
            whereCondition = [...allowedNamespaces.map((ns) => ({ cloudId: id, namespace: ns }))];
          }
        }

        // [缓存策略] 自动同步逻辑
        // 触发条件: 1. 本地无数据 (count === 0) 2. 显式强制刷新 (force === 'true' 且 skipSync !== 'true')
        // skipSync=true 表示创建后刷新，数据已直接入库，只需查询数据库，无需全量同步
        const { force, skipSync } = req.query;
        const count = await repo.count({ where: whereCondition });
        const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
        
        if (shouldSync) {
          try {
            await syncHarvesterScheduleVmBackups(cloud, insecure);
            console.log(`[ScheduleVmBackup-Query] 同步完成，cloudId: ${id}`);
          } catch (e: any) {
            console.warn('Sync ScheduleVmBackups failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        } else if (String(skipSync) === 'true') {
          console.log(`[ScheduleVmBackup-Query] 跳过全量同步（创建后刷新），直接查询数据库，cloudId: ${id}`);
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询定时备份失败', error: error.message });
      }
    },
  );

  /**
   * [POST] /:id/resources/harvester/schedulevmbackups
   * 创建定时备份策略
   */
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

        const result = await createHarvesterScheduleVmBackup(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          payload.namespace,
          payload,
        );

        // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
        if (result && result.metadata) {
          try {
            const repo = AppDataSource.getRepository(HarvesterScheduleVmBackupInventory);
            const uid = result.metadata?.uid || result.id || '';
            const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
            
            if (existing) {
              // 更新现有记录
              existing.name = result.metadata?.name || '';
              existing.namespace = result.metadata?.namespace || payload.namespace;
              existing.cron = result.spec?.cron;
              existing.vmName = result.spec?.vmbackup?.source?.name;
              existing.retention = String(result.spec?.retain || '');
              existing.status = result.spec?.suspend ? 'Suspended' : 'Active';
              existing.maxFailure = result.spec?.maxFailure;
              existing.links = result.links;
              existing.labels = result.metadata?.labels;
              existing.annotations = result.metadata?.annotations;
              existing.rawData = result;
              await repo.save(existing);
              console.log(`[ScheduleVmBackup-Create] 定时策略已更新，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
            } else {
              // 插入新记录
              const entity = repo.create({
                cloudId: cloud.id,
                uid: uid,
                name: result.metadata?.name || '',
                namespace: result.metadata?.namespace || payload.namespace,
                cron: result.spec?.cron,
                vmName: result.spec?.vmbackup?.source?.name,
                retention: String(result.spec?.retain || ''),
                status: result.spec?.suspend ? 'Suspended' : 'Active',
                maxFailure: result.spec?.maxFailure,
                links: result.links,
                labels: result.metadata?.labels,
                annotations: result.metadata?.annotations,
                rawData: result,
              });
              await repo.save(entity);
              console.log(`[ScheduleVmBackup-Create] 定时策略已入库，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
            }
          } catch (e: any) {
            console.error('[ScheduleVmBackup-Create] 入库定时策略失败:', e?.message || e);
            // 入库失败不影响创建操作的成功返回
          }
        }

        res.json({ message: '创建定时备份成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '创建定时备份失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [PATCH] /:id/resources/harvester/schedulevmbackups/:namespace/:name
   * 更新定时备份策略 (PATCH)
   */
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

  /**
   * [PUT] /:id/resources/harvester/schedulevmbackups/:namespace/:name
   * 更新定时备份策略 (PUT)
   */
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

  /**
   * [DELETE] /:id/resources/harvester/schedulevmbackups/:namespace/:name
   * 删除定时备份策略
   */
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

  // ===========================================================================
  // [通用] Backup / Snapshot Create / Restore
  // ===========================================================================

  /**
   * [POST] /:id/resources/harvester/virtualmachinebackups/:namespace
   * 创建 VM 备份或快照
   */
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

        // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
        if (result && result.metadata) {
          try {
            const repo = AppDataSource.getRepository(HarvesterBackupInventory);
            const uid = result.metadata?.uid || result.id || '';
            const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
            
            if (existing) {
              // 更新现有记录
              existing.name = result.metadata?.name || '';
              existing.namespace = result.metadata?.namespace || namespace;
              existing.sourceVm = result.spec?.source?.name;
              existing.status = result.status?.readyToUse ? 'Ready' : undefined;
              existing.type = result.spec?.type;
              existing.target = result.status?.target ? JSON.stringify(result.status.target) : undefined;
              existing.labels = result.metadata?.labels;
              existing.annotations = result.metadata?.annotations;
              existing.rawData = result;
              await repo.save(existing);
              console.log(`[Backup-Create] 备份已更新，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
            } else {
              // 插入新记录
              const entity = repo.create({
                cloudId: cloud.id,
                uid: uid,
                name: result.metadata?.name || '',
                namespace: result.metadata?.namespace || namespace,
                sourceVm: result.spec?.source?.name,
                status: result.status?.readyToUse ? 'Ready' : undefined,
                type: result.spec?.type,
                target: result.status?.target ? JSON.stringify(result.status.target) : undefined,
                labels: result.metadata?.labels,
                annotations: result.metadata?.annotations,
                rawData: result,
              });
              await repo.save(entity);
              console.log(`[Backup-Create] 备份已入库，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
            }
          } catch (e: any) {
            console.error('[Backup-Create] 入库备份失败:', e?.message || e);
            // 入库失败不影响创建操作的成功返回
          }
        }

        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '创建失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [DELETE] /:id/resources/harvester/backups/:namespace/:name
   * 删除 VM 备份
   */
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

  /**
   * [POST] /:id/resources/harvester/virtualmachinerestores/:namespace
   * 恢复 VM (从备份或快照)
   */
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

  // ===========================================================================
  // [能力查询] Capabilities
  // ===========================================================================

  /**
   * [GET] /:id/resources/harvester/capabilities
   * 查询集群能力 (如版本信息、支持的特性)
   */
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
