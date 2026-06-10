/**
 * Harvester Volumes Handlers
 *
 * 从 harvester.cache.storage.routes.ts 中提取的 Volumes 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { In } from 'typeorm';
import { KubevirtVolumeInventory } from '../../../../entities/kubevirt/KubevirtVolumeInventory';
import { HarvesterVmInventory } from '../../../../entities/harvester/HarvesterVmInventory';
import { HarvesterImageInventory } from '../../../../entities/harvester/HarvesterImageInventory';
import { HarvesterSnapshotInventory } from '../../../../entities/harvester/HarvesterSnapshotInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { checkTenantAccess } from '../harvester.direct.helpers';
import { syncHarvesterVolumes } from '../../../../services/clouds/harvester/inventory';
import {
  deleteHarvesterLonghornVolume,
  deleteHarvesterPVC,
  createHarvesterPVCVolume,
  exportImageFromPVC,
  createVolumeSnapshot,
  updatePVCSpec,
  clonePVC,
  harvesterAddVolumeToVM,
  harvesterRemoveVolumeFromVM,
  harvesterAddVolumeToVMDirect,
  syncVmVolumeSize,
  buildUsedPvcSetFromKubevirtVms,
  mapHarvesterPvcToAvailableVolumeItem,
  filterHarvesterAvailableVolumeItems,
  isHarvesterImageBackingPvcName,
} from '../../../../services/clouds/harvester/client';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';
import {
  isRegistryManagedPvcRef,
  getVmVolumePvcRef,
  REGISTRY_MANAGED_PVC_MESSAGE,
} from '../../../../services/registryManagedLocalRegistryVolumeGuard';
import {
  getNamespacedResources,
} from '../harvester.cache.container-shared';
import {
  buildPvcWorkloadConsumerMap,
  fetchClusterPvcWorkloadConsumerMap,
  formatPvcWorkloadConsumerLabels,
  getPvcWorkloadConsumers,
  resolveVolumeAttachedInfo,
} from '../../../../services/clouds/harvester/volumeConsumers';

export async function harvesterVolumeListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const reqAny = req as any;

    const repo = AppDataSource.getRepository(KubevirtVolumeInventory);
    const whereCondition: any = { cloudId: id };
    const isTenantUser = reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device';
    const isTenantRole = reqAny.user?.role === 'tenant';
    const isTenant = isTenantUser || isTenantRole;

    if (isTenant) {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const userOrgId = reqAny.user?.organizationId;
      const whereClause: any[] = [];

      if (userOrgId) {
        whereClause.push({
          tenantId: reqAny.user.tenantId,
          cloudId: id,
          status: 'active',
          organizationId: userOrgId,
        });
      } else {
        whereClause.push({
          tenantId: reqAny.user.tenantId,
          cloudId: id,
          status: 'active',
          organizationId: null,
        });
      }

      const matches = await userSpaceRepo.find({ where: whereClause });
      if (!matches || matches.length === 0) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }

      const uniqueNamespaces = new Set<string>();
      matches.forEach((m: any) => {
        if (m.namespace) {
          m.namespace.split(',').forEach((ns: string) => {
            const trimmed = ns.trim();
            if (trimmed) uniqueNamespaces.add(trimmed);
          });
        }
      });

      if (userOrgId) {
        const orgNs = `ns-${userOrgId}`;
        if (!uniqueNamespaces.has(orgNs)) {
          uniqueNamespaces.add(orgNs);
          const firstMatch = matches.find((m: any) => m.organizationId === userOrgId) || matches[0];
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

    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');

    if (shouldSync) {
      try {
        await syncHarvesterVolumes(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync Volumes failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    }

    const items = (await repo.find({ where: whereCondition })).filter((item: any) => {
      const v = item.rawData || {};
      const name = String(v?.metadata?.name || v?.name || item.name || '').trim();
      return !isHarvesterImageBackingPvcName(name);
    });

    const base = cloud.endpoint || '';
    const token = cloud.secretKey || '';
    const pvcWorkloadMap = await fetchClusterPvcWorkloadConsumerMap(base, token, insecure);

    const baseTrimmed = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = baseTrimmed;
    try {
      const u = new URL(baseTrimmed);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = baseTrimmed.replace(/\/v[0-9].*$/, '');
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
      const state = v?.status?.phase || v?.status?.state || v?.state || item.phase || 'Unknown';
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
      const { attachedTo, workloadConsumers } = resolveVolumeAttachedInfo({
        namespace,
        pvcName: name,
        k8sStatus: k8s,
        pvcStatus: v?.status,
        pvcWorkloadMap,
      });

      return {
        ...v,
        links: { view: viewUrl },
        name,
        size,
        state,
        namespace,
        pvcName,
        attachedTo,
        workloadConsumers,
        storageClassName,
        volumeMode,
        accessModes,
        createdAt: v?.metadata?.creationTimestamp,
        annotations: item.annotations || v?.metadata?.annotations, // 添加 annotations 字段
        raw: v,
      };
    });

    res.json({ message: '查询成功', data: { items: basic } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询卷失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/available-volumes - 获取可用卷（未挂载）
 */
export async function harvesterAvailableVolumeListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { namespace, force } = req.query as any;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(KubevirtVolumeInventory);

    let filterNamespace = namespace;
    const reqAny = req as any;
    if (reqAny.user?.role === 'tenant') {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const us = await userSpaceRepo.findOne({
        where: { tenantId: reqAny.user.tenantId, cloudId: id, status: 'active' },
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

    const vmRepo = AppDataSource.getRepository(HarvesterVmInventory);
    const allVms = await vmRepo.find({ where: { cloudId: id } });
    const usedPvcSet = buildUsedPvcSetFromKubevirtVms(
      allVms.map((vm) => vm.rawData || { metadata: { namespace: vm.namespace } }),
    );

    const items = filterHarvesterAvailableVolumeItems(
      dbItems.map((item) => {
        const v = item.rawData || {};
        const mapped = mapHarvesterPvcToAvailableVolumeItem({
          ...v,
          metadata: {
            ...(v.metadata || {}),
            name: v?.metadata?.name || item.name,
            namespace: v?.metadata?.namespace || item.namespace,
          },
        });
        if (!mapped.state || mapped.state === 'unknown') {
          mapped.state = String(item.phase || mapped.state || '').toLowerCase();
          mapped.phase = mapped.state;
        }
        if (!mapped.size && item.capacity) {
          mapped.size = item.capacity;
        }
        return mapped;
      }),
      usedPvcSet,
    );

    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询可用卷失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/volumes - 创建 PVC
 */
export async function harvesterVolumeCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed) {
      return res.status(403).json({ message: 'Access denied to this resource pool' });
    }

    const cloud = (req as any).cloud;
    const {
      namespace,
      name,
      sizeGi,
      size,
      accessModes,
      volumeMode,
      storageClassName,
      annotations,
    } = (req.body || {}) as any;

    if (!namespace || !name)
      return res.status(400).json({ message: '缺少必要参数：namespace、name' });

    // 租户命名空间隔离
    if (tenantNamespace) {
      const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
      if (!allowedNs.includes(namespace)) {
        return res.status(403).json({ message: 'Access denied to this namespace' });
      }
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const data = await createHarvesterPVCVolume(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      {
        namespace,
        name,
        sizeGi: sizeGi || size,
        accessModes,
        volumeMode,
        storageClassName,
        annotations,
      },
    );

    // [数据同步] 创建成功后，直接使用返回的数据入库
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
          existing.accessModes = Array.isArray(data.spec?.accessModes)
            ? data.spec.accessModes.join(',')
            : '';
          existing.labels = data.metadata?.labels;
          existing.annotations = data.metadata?.annotations;
          existing.rawData = data;
          await repo.save(existing);
          console.log(
            `[Volume-Create] 卷已更新，cloudId: ${cloud.id}, name: ${data.metadata?.name}`,
          );
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
            accessModes: Array.isArray(data.spec?.accessModes)
              ? data.spec.accessModes.join(',')
              : '',
            labels: data.metadata?.labels,
            annotations: data.metadata?.annotations,
            rawData: data,
          });
          await repo.save(entity);
          console.log(
            `[Volume-Create] 卷已入库，cloudId: ${cloud.id}, name: ${data.metadata?.name}`,
          );
        }
      } catch (e: any) {
        console.error('[Volume-Create] 入库卷失败:', e?.message || e);
        // 入库失败不影响创建操作的成功返回
      }
    } else if (data && data.metadata && !data.metadata.uid) {
      console.warn(
        `[Volume-Create] 创建成功但返回数据缺少 uid，跳过入库，cloudId: ${cloud.id}, name: ${data.metadata?.name || name}`,
      );
    }

    res.json({ message: '创建成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '创建卷失败', error: error.message });
  }
}

/**
 * DELETE /:id/resources/harvester/volumes/:namespace/:name - 删除 PVC
 */
export async function harvesterVolumeDeleteHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, namespace, name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const params = { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any;

    if (await isRegistryManagedPvcRef(params, String(namespace), String(name))) {
      return res.status(403).json({ message: REGISTRY_MANAGED_PVC_MESSAGE });
    }

    try {
      const [deployments, statefulsets, daemonsets] = await Promise.all([
        getNamespacedResources(
          cloud.endpoint,
          '/apis/apps/v1/deployments',
          String(namespace),
          cloud.secretKey || '',
          insecure,
        ),
        getNamespacedResources(
          cloud.endpoint,
          '/apis/apps/v1/statefulsets',
          String(namespace),
          cloud.secretKey || '',
          insecure,
        ),
        getNamespacedResources(
          cloud.endpoint,
          '/apis/apps/v1/daemonsets',
          String(namespace),
          cloud.secretKey || '',
          insecure,
        ),
      ]);
      const pvcWorkloadMap = buildPvcWorkloadConsumerMap({ deployments, statefulsets, daemonsets });
      const consumers = getPvcWorkloadConsumers(pvcWorkloadMap, String(namespace), String(name));
      if (consumers.length > 0) {
        const labels = formatPvcWorkloadConsumerLabels(consumers).join(', ');
        return res.status(403).json({
          message: `该云盘正被工作负载使用（${labels}），请先在相关工作负载中解除挂载后再删除`,
        });
      }
    } catch (e: any) {
      console.warn('[VolumeDelete] workload consumer check failed', e?.message || e);
    }

    const data = await deleteHarvesterPVC(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace,
      name,
    );
    res.json({ message: '删除成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
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
      msg = `删除虚拟磁盘失败：虚拟磁盘 ${(req as any)?.params?.name || ''} 正在被云主机使用，请先在云主机中卸载该磁盘后再删除。`;
    } else if (lower.includes('method delete not supported')) {
      msg = '删除失败：当前接口不支持删除操作。请使用 Longhorn CRD API 路径删除。';
    }
    res.status(500).json({ message: msg });
  }
}

/**
 * DELETE /:id/resources/harvester/longhorn/volumes/:namespace/:name - 删除 Longhorn 卷
 */
export async function harvesterLonghornVolumeDeleteHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, namespace, name } = req.params;

    // [权限检查] 租户只能删除自己命名空间下的卷
    const reqAny = req as any;
    if (reqAny.user?.role === 'tenant') {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const where: any = {
        tenantId: reqAny.user.tenantId,
        cloudId: id,
        status: 'active',
      };
      if (reqAny.user?.organizationId) {
        where.organizationId = reqAny.user.organizationId;
      }
      const userSpace = await userSpaceRepo.findOne({ where });
      if (!userSpace) return res.status(403).json({ message: '无权访问该云资源' });

      const validNamespaces = userSpace.namespace
        ? userSpace.namespace.split(',').map((s) => s.trim())
        : [];
      if (reqAny.user?.organizationId) {
        validNamespaces.push(`ns-${reqAny.user.organizationId}`);
      }

      if (!validNamespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权访问该命名空间资源' });
      }
    }

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
}

/**
 * PUT /:id/resources/harvester/volumes/:namespace/:pvcName - 更新 PVC 规格
 */
export async function harvesterVolumeUpdateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, namespace, pvcName } = req.params;
    const { sizeGi, size, accessModes, volumeMode, storageClassName, annotations, labels } =
      (req.body || {}) as any;
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
            // 尝试重新获取 PVC 以确认 owner
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
          ).catch((err: any) => console.error('Failed to sync VM volume size annotation', err));
        } else {
          console.log(
            `[PVC Update] No VM owner found for PVC ${pvcName}, skipping annotation sync.`,
          );
        }
      }
    }

    res.json({ message: '更新成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
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
}

/**
 * POST /:id/resources/harvester/volumes/:namespace/:pvcName/clone - 克隆 PVC
 */
export async function harvesterVolumeCloneHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, namespace, pvcName } = req.params;
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
    if (res.headersSent) return;
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
}

/**
 * POST /:id/resources/harvester/volumes/:namespace/:pvcName/export-image - 从 PVC 导出镜像
 */
export async function harvesterVolumeExportImageHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, namespace, pvcName } = req.params;
    const { displayName, targetStorageClassName } = (req.body || {}) as any;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await exportImageFromPVC(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace,
      pvcName,
      { displayName, targetStorageClassName },
    );

    // [数据同步] 导出成功后，直接使用返回的数据入库
    if (data && data.metadata && data.metadata.uid) {
      try {
        const repo = AppDataSource.getRepository(HarvesterImageInventory);
        const uid = data.metadata.uid;
        const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });

        if (existing) {
          // 更新现有记录
          existing.name = data.metadata?.name || '';
          existing.namespace = data.metadata?.namespace || namespace;
          existing.displayName = data.spec?.displayName || displayName || pvcName;
          existing.progress = data.status?.progress;
          existing.size = String(data.status?.size || data.status?.downloadedBytes || '0');
          existing.storageClassName = data.spec?.storageClassName || targetStorageClassName;
          existing.labels = data.metadata?.labels;
          existing.annotations = data.metadata?.annotations;
          existing.rawData = data;
          await repo.save(existing);
          console.log(
            `[Image-Export] 镜像已更新，cloudId: ${cloud.id}, name: ${data.metadata?.name}`,
          );
        } else {
          // 插入新记录
          const entity = repo.create({
            cloudId: cloud.id,
            uid: uid,
            name: data.metadata?.name || '',
            namespace: data.metadata?.namespace || namespace,
            displayName: data.spec?.displayName || displayName || pvcName,
            progress: data.status?.progress,
            size: String(data.status?.size || data.status?.downloadedBytes || '0'),
            storageClassName: data.spec?.storageClassName || targetStorageClassName,
            labels: data.metadata?.labels,
            annotations: data.metadata?.annotations,
            rawData: data,
          });
          await repo.save(entity);
          console.log(
            `[Image-Export] 镜像已入库，cloudId: ${cloud.id}, name: ${data.metadata?.name}`,
          );
        }
      } catch (e: any) {
        console.error('[Image-Export] 入库镜像失败:', e?.message || e);
        // 入库失败不影响导出操作的成功返回
      }
    } else if (data && data.metadata && !data.metadata.uid) {
      console.warn(
        `[Image-Export] 导出成功但返回数据缺少 uid，跳过入库，cloudId: ${cloud.id}, name: ${data.metadata?.name || pvcName}`,
      );
    }

    res.json({ message: '创建镜像任务成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
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
}

/**
 * POST /:id/resources/harvester/volumes/:namespace/:pvcName/snapshots - 创建卷快照
 */
export async function harvesterVolumeSnapshotCreateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, namespace, pvcName } = req.params;
    const { name, snapshotClassName, alias } = (req.body || {}) as any;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await createVolumeSnapshot(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace,
      pvcName,
      { name, snapshotClassName, alias },
    );

    // [数据同步] 创建成功后，直接使用返回的数据入库
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
          console.log(
            `[Snapshot-Create] 快照已更新，cloudId: ${cloud.id}, name: ${data.metadata?.name}`,
          );
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
          console.log(
            `[Snapshot-Create] 快照已入库，cloudId: ${cloud.id}, name: ${data.metadata?.name}`,
          );
        }
      } catch (e: any) {
        console.error('[Snapshot-Create] 入库快照失败:', e?.message || e);
        // 入库失败不影响创建操作的成功返回
      }
    } else if (data && data.metadata && !data.metadata.uid) {
      console.warn(
        `[Snapshot-Create] 创建成功但返回数据缺少 uid，跳过入库，cloudId: ${cloud.id}, name: ${data.metadata?.name || name}`,
      );
    }

    res.json({ message: '创建快照成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
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
}

/**
 * POST /:id/resources/harvester/vms/:instanceId/add-volume - 挂载卷到 VM (使用 Instance ID)
 */
export async function harvesterVmAddVolumeHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, instanceId } = req.params;
    const { name, bus, pvcNamespace, pvcName } = (req.body || {}) as any;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const params = { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any;

    if (pvcName && pvcNamespace) {
      if (await isRegistryManagedPvcRef(params, String(pvcNamespace), String(pvcName))) {
        return res.status(403).json({ message: REGISTRY_MANAGED_PVC_MESSAGE });
      }
    }

    const data = await harvesterAddVolumeToVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      instanceId,
      { name, bus, pvcNamespace, pvcName },
    );
    res.json({ message: '挂载成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res
      .status(500)
      .json({ message: error.message || '挂载卷失败', error: error.body || error.message });
  }
}

/**
 * POST /:id/resources/harvester/vms/:namespace/:name/add-volume - 挂载卷到 VM (直接使用 Namespace/Name)
 */
export async function harvesterVmAddVolumeDirectHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, namespace, name } = req.params;
    const { diskName, bus, pvcNamespace, pvcName, name: bodyName } = (req.body || {}) as any;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const params = { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any;

    if (pvcName && pvcNamespace) {
      if (await isRegistryManagedPvcRef(params, String(pvcNamespace), String(pvcName))) {
        return res.status(403).json({ message: REGISTRY_MANAGED_PVC_MESSAGE });
      }
    }

    const data = await harvesterAddVolumeToVMDirect(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace,
      name,
      { name: bodyName || diskName, bus, pvcNamespace, pvcName },
    );
    res.json({ message: '挂载成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '挂载卷失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/vms/:instanceId/remove-volume - 卸载卷
 */
export async function harvesterVmRemoveVolumeHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, instanceId } = req.params;
    const { name } = (req.body || {}) as any;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const params = { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any;

    if (name) {
      const pvcRef = await getVmVolumePvcRef(params, String(instanceId), String(name));
      if (
        pvcRef &&
        (await isRegistryManagedPvcRef(params, pvcRef.namespace, pvcRef.name))
      ) {
        return res.status(403).json({ message: REGISTRY_MANAGED_PVC_MESSAGE });
      }
    }

    const data = await harvesterRemoveVolumeFromVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      instanceId,
      { name },
    );
    res.json({ message: '卸载成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '卸载卷失败', error: error.message });
  }
}
