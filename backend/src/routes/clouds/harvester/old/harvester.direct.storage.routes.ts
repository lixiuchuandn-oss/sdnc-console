/**
 * ==============================================================================
 * 模块名称: Harvester 存储资源直连路由 (Harvester Direct Storage Routes)
 * 文件路径: src/routes/clouds/harvester/harvester.direct.storage.routes.ts
 * ==============================================================================
 * 功能描述:
 * 本文件提供 Harvester 存储相关资源 (Volume/PVC, Snapshot, StorageClass) 的直连管理能力。
 * 绕过中间缓存，直接与 Harvester/K8s API 交互，确保数据的实时性和操作的原子性。
 *
 * 核心逻辑:
 * 1. [Direct API Access]: 直接操作 PersistentVolumeClaim (PVC) 和 VolumeSnapshot CRD。
 * 2. [Tenant Isolation]: 通过 checkTenantAccess + isNamespaceAllowed 严格限制租户
 *    只能操作授权命名空间下的存储资源。
 * 3. [Advanced Operations]: 支持卷克隆 (Clone)、快照恢复 (Restore)、镜像导出 (Export Image)
 *    等高级存储操作。
 * 4. [Standardization]: 返回的数据格式与缓存路由保持一致，便于前端统一渲染。
 *
 * API 列表:
 * - POST   /:id/resources/harvester/snapshots/:namespace/:name/restore   从快照恢复卷
 * - GET    /:id/resources/harvester/capabilities                         查询存储能力
 * - GET    /:id/resources/harvester/snapshot-classes                     查询快照类列表
 * - POST   /:id/resources/harvester/volumes/:namespace/:name/export-image 导出卷为镜像
 * - POST   /:id/resources/harvester/volumes/:namespace/:name/snapshots   创建卷快照
 * - POST   /:id/resources/harvester/volumes/:namespace/:name/clone       克隆卷
 * - GET    /:id/resources/harvester/volumes                              查询卷列表
 * - GET    /:id/resources/harvester/storage-classes/:name                查询存储类详情
 * - POST   /:id/resources/harvester/volumes                              创建卷
 * - DELETE /:id/resources/harvester/volumes/:name                        删除卷
 * - POST   /:id/resources/harvester/volumes/snapshot                     (Legacy) 创建快照
 * - POST   /:id/resources/harvester/volumes/:name/resize                 扩容卷
 * ==============================================================================
 */

import { Router, Response } from 'express';
import {
  listHarvesterVolumesStandard,
  listHarvesterAvailableVolumesStandard,
  createHarvesterPVCVolume,
  createVolumeSnapshot,
  exportImageFromPVC,
  clonePVC,
  restoreVolumeSnapshot,
  updatePVCSpec,
  getHarvesterCapabilities,
  listHarvesterSnapshotClassesRaw,
  syncVmVolumeSize,
} from '../../../services/clouds/harvester/client';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import { listKubevirtVMsRaw } from '../../../services/clouds/harvester/vm';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  isNamespaceAllowed,
} from './harvester.direct.helpers';

export const registerHarvesterDirectStorageRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  // ==================================================================================
  // 已迁移到新路由机制 (provider-router)
  // 所有存储直连路由已迁移到以下 handlers:
  // - storage-volumes-direct.handlers.ts
  // - storage-snapshots-direct.handlers.ts
  // - storage-volume-ops-direct.handlers.ts
  // - storage-capabilities-direct.handlers.ts
  // 并在 harvester.direct.routes.provider.ts 中注册
  // ==================================================================================
  return;

  /**
   * ==================================================================================
   * Harvester 直连存储领域路由 (Direct Storage Routes)
   * ==================================================================================
   * 设计目标：
   * - 将所有 “存储 / 卷 / 快照 / 镜像能力” 相关直连路由集中到单独文件
   * - 对应 Harvester 原生 PVC / VolumeSnapshot / StorageClass 等存储能力
   *
   * 核心设计点：
   * 1. Direct API Only：所有存储操作均直连 Harvester / Kube-OVN / K8s API，不依赖本地 Inventory
   * 2. Tenant Isolation：通过 checkTenantAccess + isNamespaceAllowed 做命名空间级隔离
   * 3. 与缓存路由对齐：路径保持与 clouds.harvester.ts 中存储相关路由一致，便于前端切换视图
   */

  /**
   * [POST] /:id/resources/harvester/snapshots/:namespace/:name/restore
   * 从 VolumeSnapshot 恢复 PVC（创建新卷）
   */
  router.post(
    '/:id/resources/harvester/snapshots/:namespace/:name/restore',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
          return res
            .status(403)
            .json({ message: 'Access denied to this namespace' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源操作',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const result = await restoreVolumeSnapshot(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure },
          namespace,
          name,
          {
            newName: req.body.name,
            storageClassName: req.body.storageClassName,
            size: req.body.size,
            accessModes: req.body.accessModes,
            volumeMode: req.body.volumeMode,
          },
        );
        res.json({ message: '快照恢复任务已提交', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '快照恢复失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [GET] /:id/resources/harvester/capabilities
   * 查询 Harvester 集群存储相关能力
   */
  router.get(
    '/:id/resources/harvester/capabilities',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;

        const data = await getHarvesterCapabilities({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure: !!(cloud.config as any)?.ignoreTls,
        });

        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询Capabilities失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [GET] /:id/resources/harvester/snapshot-classes
   * 查询 VolumeSnapshotClass 列表
   */
  router.get(
    '/:id/resources/harvester/snapshot-classes',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await listHarvesterSnapshotClassesRaw({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        });

        res.json({ message: '查询成功', data: { items: data } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询快照存储类失败',
          error: error.body || error.message,
        });
      }
    },
  );

  // ==================================================================================
  // Volume Operations (Export, Snapshot, Clone) - Namespaced PVC
  // ==================================================================================

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:name/export-image',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
          return res
            .status(403)
            .json({ message: 'Access denied to this namespace' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源操作',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const result = await exportImageFromPVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure },
          namespace,
          name,
          req.body,
        );
        res.json({ message: '导出镜像任务已提交', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '导出镜像失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:name/snapshots',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
          return res
            .status(403)
            .json({ message: 'Access denied to this namespace' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源操作',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const result = await createVolumeSnapshot(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure },
          namespace,
          name,
          req.body,
        );
        res.json({ message: '创建快照任务已提交', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '创建快照失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/:namespace/:name/clone',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
          return res
            .status(403)
            .json({ message: 'Access denied to source namespace' });
        }

        const targetNs = req.body.targetNamespace || namespace;
        if (
          tenantNamespace &&
          !isNamespaceAllowed(tenantNamespace, targetNs)
        ) {
          return res
            .status(403)
            .json({ message: 'Access denied to target namespace' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源操作',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const result = await clonePVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure },
          namespace,
          name,
          req.body,
        );
        res.json({ message: '克隆卷任务已提交', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '克隆卷失败',
          error: error.body || error.message,
        });
      }
    },
  );

  // ==================================================================================
  // Volumes & StorageClasses - 列表 + 单卷详情 + 创建/删除/更新
  // ==================================================================================

  router.get(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询'))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const items = await listHarvesterVolumesStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);

        let filteredItems = items;
        if (isTenant) {
          filteredItems = tenantNamespace
            ? items.filter((v: any) =>
                isNamespaceAllowed(tenantNamespace, v?.metadata?.namespace),
              )
            : [];
        } else if (tenantNamespace) {
          filteredItems = items.filter((v: any) =>
            isNamespaceAllowed(tenantNamespace, v?.metadata?.namespace),
          );
        }

        const basic = filteredItems.map((v: any) => {
          const name = v?.metadata?.name || v?.name || '';
          const size = v?.spec?.size || v?.size || 0;
          const state = v?.status?.state || v?.state || 'Unknown';
          const k8s = v?.status?.kubernetesStatus || {};
          const namespace = k8s?.namespace || v?.metadata?.namespace || '';
          const pvcName = k8s?.pvcName || '';
          const workloads =
            k8s?.workloadsStatus ||
            v?.status?.workloadsStatus ||
            v?.status?.workloadStatus ||
            [];
          const rawNames: string[] = Array.isArray(workloads)
            ? workloads
                .map((w: any) =>
                  String(w?.workloadName || w?.podName || ''),
                )
                .filter(Boolean)
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
            id: v?.id || v?.metadata?.uid || name,
            links: v?.links,
            name,
            size,
            state,
            namespace,
            pvcName,
            attachedTo,
            attached: attachedTo.length > 0,
            lastAttachedBy: k8s?.lastPVCRefAt || '',
            created: v?.metadata?.creationTimestamp || '',
            rawData: v,
          };
        });

        res.json({ message: '查询成功', data: { items: basic } });
      } catch (error: any) {
        res.status(500).json({
          message: '查询卷列表失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/storage-classes/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询'))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/apis/storage.k8s.io/v1/storageclasses/${encodeURIComponent(
          name,
        )}`;
        const raw = await getJsonOnce(url, cloud.secretKey || '', insecure);

        res.json(raw);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  /*
  // REMOVED: Redundant Direct API GET route for Storage Classes.
  // Use the cached route in clouds.harvester.ts instead.
  router.get(
    '/:id/resources/harvester/storage-classes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      // ... implementation removed ...
      res
        .status(301)
        .json({
          message:
            'Please use /api/clouds/:id/resources/harvester/storage-classes',
        });
    },
  );
  */

  router.post(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported'))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        if (tenantNamespace) {
          const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
          if (req.body.namespace) {
            if (!allowedNs.includes(req.body.namespace)) {
              return res
                .status(403)
                .json({ message: 'Access denied to this namespace' });
            }
          } else {
            req.body.namespace = allowedNs[0];
          }
        }

        const data = await createHarvesterPVCVolume(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          {
            ...req.body,
            namespace: req.body.namespace || 'default',
          },
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: '创建卷失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/volumes/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const { namespace } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported'))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        let targetNamespace = namespace ? String(namespace) : 'default';
        if (tenantNamespace) {
          const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
          if (namespace) {
            if (!allowedNs.includes(String(namespace))) {
              return res
                .status(403)
                .json({ message: 'Access denied to this namespace' });
            }
          } else {
            targetNamespace = allowedNs[0];
          }
        }
        const ns = String(targetNamespace);

        const url = `${origin}/api/v1/namespaces/${ns}/persistentvolumeclaims/${name}`;
        await requestJson('DELETE', url, cloud.secretKey || '', insecure);

        res.json({ message: '删除成功' });
      } catch (error: any) {
        res.status(500).json({
          message: '删除卷失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/snapshot',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported'))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        if (tenantNamespace) {
          const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
          if (req.body.namespace) {
            if (!allowedNs.includes(req.body.namespace)) {
              return res
                .status(403)
                .json({ message: 'Access denied to this namespace' });
            }
          } else {
            req.body.namespace = allowedNs[0];
          }
        }

        const { namespace, pvcName, ...opts } = req.body;
        const data = await createVolumeSnapshot(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          opts,
        );
        res.json({ message: '创建快照成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: '创建快照失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/export-image',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported'))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        if (tenantNamespace) {
          const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
          if (req.body.namespace) {
            if (!allowedNs.includes(req.body.namespace)) {
              return res
                .status(403)
                .json({ message: 'Access denied to this namespace' });
            }
          } else {
            req.body.namespace = allowedNs[0];
          }
        }

        const { namespace, pvcName, ...opts } = req.body;
        const data = await exportImageFromPVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          opts,
        );
        res.json({ message: '导出镜像成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: '导出镜像失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes/clone',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported'))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        if (tenantNamespace) {
          const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
          if (req.body.namespace) {
            if (!allowedNs.includes(req.body.namespace)) {
              return res
                .status(403)
                .json({ message: 'Access denied to this namespace' });
            }
          } else {
            req.body.namespace = allowedNs[0];
          }
        }

        const { namespace, pvcName, ...payload } = req.body;
        const data = await clonePVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          payload,
        );
        res.json({ message: '克隆卷成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: '克隆卷失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.put(
    '/:id/resources/harvester/volumes/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported'))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        if (tenantNamespace) {
          const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
          if (!allowedNs.includes(namespace)) {
            return res
              .status(403)
              .json({ message: 'Access denied to this namespace' });
          }
        }

        const data = await updatePVCSpec(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
          req.body,
        );

        const sizeStr = (function () {
          const raw =
            typeof (req.body as any)?.size === 'number'
              ? String((req.body as any).size)
              : String((req.body as any)?.size || '').trim();
          if (raw) {
            const hasUnit = /[a-zA-Z]/.test(raw);
            if (hasUnit) return raw;
            const n = Number(raw);
            if (!isNaN(n) && n > 0) return `${Math.round(n)}Gi`;
          }
          const g = Number((req.body as any)?.sizeGi || 0);
          return g > 0 ? `${g}Gi` : undefined;
        })();

        if (sizeStr) {
          try {
            await syncVmVolumeSize(
              { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
              namespace,
              null,
              name,
              sizeStr,
            );
          } catch (e) {
            console.warn(
              `[HarvesterDirect] Failed to sync VM volume size for PVC ${name}`,
              e,
            );
          }
        }

        res.json({ message: '更新卷成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: '更新卷失败',
          error: error.body || error.message,
        });
      }
    },
  );

  // ==================================================================================
  // Available Volumes & 单卷详情
  // ==================================================================================

  router.get(
    '/:id/resources/harvester/available-volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        if (isTenant && !tenantNamespace) {
          return res.json({ message: '查询成功', data: { items: [] } });
        }

        const { namespace } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询'))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const itemsRaw = await listHarvesterAvailableVolumesStandard(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          { namespace: '' },
        );

        // [修复] 查询所有虚拟机，提取所有被虚拟机使用的 PVC
        // 无论虚拟机是否运行、是否在回收站，只要卷在 VM spec 中定义，就不应该出现在"可用卷"列表中
        let usedPvcSet = new Set<string>();
        try {
          const allVms = await listKubevirtVMsRaw({
            endpoint: cloud.endpoint,
            token: cloud.secretKey || '',
            insecure,
          });
          allVms.forEach((vm: any) => {
            const vmNs = vm?.metadata?.namespace || '';
            
            // 从 VM spec.template.spec.volumes 中提取所有 PVC
            const volumes = vm?.spec?.template?.spec?.volumes || [];
            volumes.forEach((vol: any) => {
              const claimName = vol?.persistentVolumeClaim?.claimName;
              if (claimName && vmNs) {
                usedPvcSet.add(`${vmNs}/${claimName}`);
              }
            });
          });
        } catch (e: any) {
          console.warn('[available-volumes] 查询虚拟机列表失败，跳过卷使用检查', e.message);
        }

        // [修复] 过滤被虚拟机使用的卷
        let items = itemsRaw.map((vol: any) => {
          const pvcKey = `${vol.namespace}/${vol.pvcName || vol.name}`;
          const isUsedByVm = usedPvcSet.has(pvcKey);
          return { ...vol, isUsedByVm };
        }).filter((vol: any) => !vol.isUsedByVm);

        if (isTenant) {
          if (tenantNamespace) {
            items = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.namespace),
            );
          } else {
            items = [];
          }
        } else if (tenantNamespace) {
          items = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.namespace),
          );
        } else if (namespace) {
          items = items.filter((i: any) => i.namespace === namespace);
        }
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({
          message: '查询可用卷失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/volumes/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res.status(403).json({ message: 'Access denied' });

        if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
          return res
            .status(403)
            .json({ message: 'Access denied to this namespace' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/v1/harvester/persistentvolumeclaims/${encodeURIComponent(
          namespace,
        )}/${encodeURIComponent(name)}`;
        const json = await getJsonOnce(url, cloud.secretKey || '', insecure);

        res.json(json);
      } catch (error: any) {
        res.status(500).json({
          message: '查询卷详情失败',
          error: error.body || error.message,
        });
      }
    },
  );
};

