/**
 * Harvester 存储卷直连 Handlers
 * 从 harvester.direct.storage.routes.ts 中提取的卷 CRUD 操作
 */

import { Request, Response } from 'express';
import {
  listHarvesterVolumesStandard,
  createHarvesterPVCVolume,
  updatePVCSpec,
  syncVmVolumeSize,
  buildUsedPvcSetFromKubevirtVms,
  mapHarvesterPvcToAvailableVolumeItem,
  filterHarvesterAvailableVolumeItems,
} from '../../../../services/clouds/harvester/client';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import { listKubevirtVMsRaw } from '../../../../services/clouds/harvester/vm';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  isNamespaceAllowed,
} from '../harvester.direct.helpers';

/**
 * [GET] /:id/resources/harvester/volumes
 * 查询卷列表
 */
export async function harvesterVolumeDirectListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
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
            .map((w: any) => String(w?.workloadName || w?.podName || ''))
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
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询卷列表失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [GET] /:id/resources/harvester/volumes/:namespace/:name
 * 查询卷详情
 */
export async function harvesterVolumeDirectDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
      return res.status(403).json({ message: 'Access denied to this namespace' });
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
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询卷详情失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [GET] /:id/resources/harvester/available-volumes
 * 查询可用卷列表
 */
export async function harvesterAvailableVolumesDirectHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    if (isTenant && !tenantNamespace) {
      return res.json({ message: '查询成功', data: { items: [] } });
    }

    const { namespace } = (req.query || {}) as any;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    // 以 PVC 为数据源（与块存储列表一致）；Longhorn「节点 attached」≠「未挂 VM」，勿用 Longhorn 列表误滤
    const pvcs = await listHarvesterVolumesStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
    } as any);
    const itemsRaw = (pvcs || []).map((v: any) => mapHarvesterPvcToAvailableVolumeItem(v));

    let usedPvcSet = new Set<string>();
    try {
      const allVms = await listKubevirtVMsRaw({
        endpoint: cloud.endpoint,
        token: cloud.secretKey || '',
        insecure,
      });
      usedPvcSet = buildUsedPvcSetFromKubevirtVms(allVms);
    } catch (e: any) {
      console.warn('[available-volumes] 查询虚拟机列表失败，跳过卷使用检查', e.message);
    }

    let items = filterHarvesterAvailableVolumeItems(itemsRaw, usedPvcSet);

    if (isTenant) {
      if (tenantNamespace) {
        items = items.filter((i: any) =>
          isNamespaceAllowed(tenantNamespace, i.namespace),
        );
      } else {
        items = [];
      }
    } else if (tenantNamespace) {
      items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.namespace));
    } else if (namespace) {
      items = items.filter((i: any) => i.namespace === namespace);
    }
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询可用卷失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [POST] /:id/resources/harvester/volumes
 * 创建卷
 */
export async function harvesterVolumeDirectCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    if (tenantNamespace) {
      const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
      if (req.body.namespace) {
        if (!allowedNs.includes(req.body.namespace)) {
          return res.status(403).json({ message: 'Access denied to this namespace' });
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
    if (res.headersSent) return;
    res.status(500).json({
      message: '创建卷失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [DELETE] /:id/resources/harvester/volumes/:name
 * 删除卷
 */
export async function harvesterVolumeDirectDeleteHandler(req: Request, res: Response) {
  try {
    const { id, name } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { namespace } = req.query;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
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
          return res.status(403).json({ message: 'Access denied to this namespace' });
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
    if (res.headersSent) return;
    res.status(500).json({
      message: '删除卷失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [PUT] /:id/resources/harvester/volumes/:namespace/:name
 * 更新卷
 */
export async function harvesterVolumeDirectUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    if (tenantNamespace) {
      const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
      if (!allowedNs.includes(namespace)) {
        return res.status(403).json({ message: 'Access denied to this namespace' });
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
    if (res.headersSent) return;
    res.status(500).json({
      message: '更新卷失败',
      error: error.body || error.message,
    });
  }
}
