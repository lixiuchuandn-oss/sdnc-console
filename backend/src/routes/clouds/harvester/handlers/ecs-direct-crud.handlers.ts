/**
 * ==============================================================================
 * 模块名称: Harvester ECS CRUD Handlers (VM CRUD & Template Operations)
 * 文件路径: src/routes/clouds/harvester/handlers/ecs-crud.handlers.ts
 * ==============================================================================
 * 功能描述:
 * 本文件包含 Harvester 虚拟机 (ECS) 的 CRUD 操作和模板相关 handlers，包括：
 * - CRUD 操作：创建、更新、PATCH
 * - 模板操作：从模板创建 VM、保存为模板
 * 
 * 从 ecs-operations.handlers.ts 和 harvester.cache.vm.routes.ts 中提取的业务逻辑
 * ==============================================================================
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterVmInventory } from '../../../../entities/harvester/HarvesterVmInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import {
  createHarvesterVM,
  updateHarvesterVMSpec,
  patchHarvesterVM,
  getHarvesterVM,
} from '../../../../services/clouds/harvester/client';
import { createHarvesterPVCVolume } from '../../../../services/clouds/harvester/client';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  isNamespaceAllowed,
} from '../harvester.direct.helpers';

/**
 * POST /:id/resources/ecs - 创建 VM
 */
export async function harvesterEcsCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });

    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    // 前端发送完整 KubeVirt manifest：命名空间在 metadata.namespace；兼容顶层 body.namespace
    const topNs =
      typeof req.body?.namespace === 'string' ? req.body.namespace.trim() : '';
    const metaNs =
      typeof req.body?.metadata?.namespace === 'string'
        ? req.body.metadata.namespace.trim()
        : '';
    let resolvedNs = topNs || metaNs;

    if (tenantNamespace) {
      const allowedNs = tenantNamespace.split(',').map((s) => s.trim());

      if (resolvedNs) {
        if (!allowedNs.includes(resolvedNs)) {
          return res
            .status(403)
            .json({ message: 'Access denied to this namespace' });
        }
      } else {
        resolvedNs = allowedNs[0];
      }
    } else if (!resolvedNs) {
      resolvedNs = 'default';
    }

    req.body.namespace = resolvedNs;
    if (req.body.metadata && typeof req.body.metadata === 'object') {
      req.body.metadata.namespace = resolvedNs;
    }

    const { namespace, ...payload } = req.body;

    const data = await createHarvesterVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace || resolvedNs,
      payload,
    );
    res.json({ message: '创建成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '创建实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * PUT /:id/resources/ecs/:instanceId - 更新 VM 配置
 */
export async function harvesterEcsUpdateHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    if (tenantNamespace) {
      const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
      if (req.body.namespace) {
        if (!allowedNs.includes(req.body.namespace)) {
          return res
            .status(403)
            .json({ message: 'Access denied to this namespace' });
        }
      } else if (instanceId.includes('/')) {
        const [ns] = instanceId.split('/');
        if (allowedNs.includes(ns)) {
          req.body.namespace = ns;
        } else {
          req.body.namespace = allowedNs[0];
        }
      } else {
        req.body.namespace = allowedNs[0];
      }
    }

    const { namespace, ...spec } = req.body;

    if (tenantNamespace && instanceId.includes('/')) {
      const [ns] = instanceId.split('/');
      if (!isNamespaceAllowed(tenantNamespace, ns))
        return res
          .status(403)
          .json({ message: 'Access denied to VM in other namespace' });
    }

    const cleanName = instanceId.includes('/')
      ? instanceId.split('/')[1]
      : instanceId;

    const data = await updateHarvesterVMSpec(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace || 'default',
      cleanName,
      spec,
    );
    res.json({ message: '更新成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '更新实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/harvester/vms/:namespace/:name/update-spec - 更新 VM Spec
 */
export async function harvesterVmUpdateSpecHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    if (tenantNamespace) {
      if (!isNamespaceAllowed(tenantNamespace, namespace)) {
        return res
          .status(403)
          .json({ message: 'Access denied to this namespace' });
      }
    }

    const data = await updateHarvesterVMSpec(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace,
      name,
      req.body,
    );

    try {
      const repo = AppDataSource.getRepository(HarvesterVmInventory);
      await repo.update(
        { cloudId: id, uid: data.metadata.uid },
        {
          name: data.metadata?.name,
          namespace: data.metadata?.namespace,
          running: data.spec?.running,
          runStrategy: data.spec?.runStrategy,
          template: data.spec?.template,
          labels: data.metadata?.labels,
          annotations: data.metadata?.annotations,
          rawData: data,
        },
      );
    } catch (ignore) {
      console.warn(
        '[HarvesterDirect] Failed to update local cache:',
        ignore,
      );
    }

    res.json({ message: '更新成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '更新实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * PATCH /:id/resources/harvester/vms/:namespace/:name - PATCH VM
 */
export async function harvesterVmPatchHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    if (tenantNamespace) {
      if (!isNamespaceAllowed(tenantNamespace, namespace)) {
        return res
          .status(403)
          .json({ message: 'Access denied to this namespace' });
      }
    }

    const contentType = req.headers['content-type'] || 'application/merge-patch+json';

    const data = await patchHarvesterVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace,
      name,
      req.body,
      contentType
    );

    try {
      const repo = AppDataSource.getRepository(HarvesterVmInventory);
      await repo.update(
        { cloudId: id, uid: data.metadata.uid },
        {
          labels: data.metadata?.labels,
          annotations: data.metadata?.annotations,
          rawData: data,
        },
      );
    } catch (ignore) {
      // ignore cache update error
    }

    res.json({ message: '更新成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: 'Patch 实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/harvester/templates/:namespace/:name/create-vm - 从模板创建 VM
 */
export async function harvesterEcsCreateFromTemplateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const body = req.body || {};
    const newVmName: string = String(body?.name || '').trim();
    const targetNamespace: string = String(body?.namespace || '').trim() || namespace;
    if (!newVmName) return res.status(400).json({ message: '缺少虚拟机名称' });

    let tenantNamespace: string | undefined;
    const isTenantUser = (req as any).user?.tenantId && (req as any).user?.role !== 'sase_device';
    const isTenantRole = (req as any).user?.role === 'tenant';
    const isTenant = isTenantUser || isTenantRole;

    if (isTenant) {
      const p = (req as any).user?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({ message: 'Permission denied: Requires clouds.console:write' });

      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
      if ((req as any).user?.organizationId) {
        where.organizationId = (req as any).user.organizationId;
      }
      const us = await userSpaceRepo.findOne({ where });
      if (!us) return res.status(403).json({ message: 'Access denied to this resource pool' });
      tenantNamespace = us.namespace;
    }

    if (isTenant) {
      const allowed = tenantNamespace ? tenantNamespace.split(',').map((s) => s.trim()) : [];
      if (!allowed.includes(targetNamespace)) {
        return res.status(403).json({
          message: `无权访问命名空间 '${targetNamespace}'。允许的范围: ${allowed.join(', ')}`,
        });
      }
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const tplUrl = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
      namespace,
    )}/virtualmachinetemplates/${encodeURIComponent(name)}`;
    const template = await getJsonOnce(tplUrl, cloud.secretKey || '', insecure);

    let defaultVersionId: string | undefined =
      template?.spec?.defaultVersionId || template?.status?.defaultVersionId || template?.status?.defaultVersion;
    if (!defaultVersionId) return res.status(400).json({ message: '模板缺少默认版本信息' });

    let versionNs = namespace;
    let versionName = String(defaultVersionId);
    const parts = String(defaultVersionId).split('/').filter(Boolean);
    if (parts.length >= 2) {
      versionNs = parts[parts.length - 2];
      versionName = parts[parts.length - 1];
    }

    const verUrl = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
      versionNs,
    )}/virtualmachinetemplateversions/${encodeURIComponent(versionName)}`;
    const version = await getJsonOnce(verUrl, cloud.secretKey || '', insecure);

    const vmSpec = version?.spec?.vm?.spec;
    const vmTemplateSpec = vmSpec?.template?.spec;
    const vmTemplateMeta = vmSpec?.template?.metadata || {};
    const vct = vmSpec?.volumeClaimTemplates || [];
    if (!vmTemplateSpec) return res.status(400).json({ message: '模板版本缺少 VM 模板规范' });

    const cleanSpec = JSON.parse(JSON.stringify(vmTemplateSpec));
    if (cleanSpec.hostname) delete cleanSpec.hostname;
    if (cleanSpec.domain?.firmware?.uuid) delete cleanSpec.domain.firmware.uuid;
    if (Array.isArray(cleanSpec.domain?.devices?.interfaces)) {
      cleanSpec.domain.devices.interfaces.forEach((iface: any) => {
        if (iface.macAddress) delete iface.macAddress;
      });
    }
    if (
      cleanSpec.domain?.cpu?.dedicatedCpuPlacement === true &&
      (cleanSpec.domain?.cpu?.cores || cleanSpec.domain?.cpu?.sockets || cleanSpec.domain?.cpu?.threads)
    ) {
      if (cleanSpec.domain?.resources?.requests && (cleanSpec.domain.resources.requests as any).cpu != null) {
        delete (cleanSpec.domain.resources.requests as any).cpu;
      }
      if (cleanSpec.domain?.resources?.limits && (cleanSpec.domain.resources.limits as any).cpu != null) {
        delete (cleanSpec.domain.resources.limits as any).cpu;
      }
    }

    let vctArray = Array.isArray(vct) ? JSON.parse(JSON.stringify(vct)) : [];
    try {
      const annVctStr = vmTemplateMeta?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
      if ((!vctArray || vctArray.length === 0) && annVctStr) {
        const annVcts = JSON.parse(annVctStr);
        if (Array.isArray(annVcts) && annVcts.length > 0) vctArray = JSON.parse(JSON.stringify(annVcts));
      }
    } catch {}

    let primaryImageId: string | undefined = undefined;
    let primaryImageName: string | undefined = undefined;

    if (Array.isArray(cleanSpec?.volumes)) {
      const waitForPvcCreated = async (ns: string, pvcName: string, timeoutMs = 20000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          try {
            const pvcUrl = `${origin}/api/v1/namespaces/${encodeURIComponent(
              ns,
            )}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`;
            const j = await getJsonOnce(pvcUrl, cloud.secretKey || '', insecure);
            if (j) return j;
          } catch {}
          await new Promise((r) => setTimeout(r, 1000));
        }
        throw new Error(`PVC创建后未找到：${ns}/${pvcName}`);
      };

      cleanSpec.volumes = await Promise.all(
        cleanSpec.volumes.map(async (vol: any, idx: number) => {
          if (vol?.persistentVolumeClaim?.claimName) {
            const oldClaim = String(vol.persistentVolumeClaim.claimName).trim();
            const volName = String(vol?.name || `disk-${idx}`).trim();
            const suffix = Math.random().toString(36).substring(2, 7);
            const newPvcName = `${newVmName}-${volName}-${suffix}`;

            const pvcNamespacesToTry = Array.from(
              new Set([String(namespace).trim(), String(versionNs).trim(), String(targetNamespace).trim()]),
            ).filter(Boolean);
            let pvc: any = null;
            for (const nsTry of pvcNamespacesToTry) {
              try {
                const pvcUrl = `${origin}/api/v1/namespaces/${encodeURIComponent(
                  nsTry,
                )}/persistentvolumeclaims/${encodeURIComponent(oldClaim)}`;
                pvc = await getJsonOnce(pvcUrl, cloud.secretKey || '', insecure);
                if (pvc) break;
              } catch {}
            }

            const pvcSpec = pvc?.spec || {};
            const pvcAnn = pvc?.metadata?.annotations || {};
            const imageId = pvcAnn['harvesterhci.io/imageId'];
            const imageName = pvcAnn['harvesterhci.io/image-name'] || pvcAnn['harvesterhci.io/imageName'];

            if (!primaryImageId && imageId) primaryImageId = String(imageId);
            if (!primaryImageName && imageName) primaryImageName = String(imageName);

            await createHarvesterPVCVolume(
              { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
              {
                namespace: targetNamespace,
                name: newPvcName,
                size: (pvcSpec?.resources?.requests?.storage as any) || '10Gi',
                accessModes:
                  Array.isArray(pvcSpec?.accessModes) && pvcSpec.accessModes.length > 0
                    ? pvcSpec.accessModes
                    : ['ReadWriteOnce'],
                volumeMode: pvcSpec?.volumeMode,
                storageClassName: pvcSpec?.storageClassName,
                annotations:
                  imageId || imageName
                    ? {
                        ...(imageId ? { 'harvesterhci.io/imageId': String(imageId) } : {}),
                        ...(imageName ? { 'harvesterhci.io/image-name': String(imageName) } : {}),
                      }
                    : undefined,
              } as any,
            );
            await waitForPvcCreated(targetNamespace, newPvcName);

            return { ...vol, persistentVolumeClaim: { claimName: newPvcName }, dataVolume: undefined };
          }

          return vol;
        }),
      );

      vctArray = [];
    }

    const metaClean = JSON.parse(JSON.stringify(vmTemplateMeta || {}));
    try {
      if (metaClean.annotations && metaClean.annotations['harvesterhci.io/volumeClaimTemplates']) {
        try {
          metaClean.annotations['harvesterhci.io/volumeClaimTemplates'] = JSON.stringify(vctArray || []);
        } catch {
          delete metaClean.annotations['harvesterhci.io/volumeClaimTemplates'];
        }
      }
      if (metaClean.annotations) {
        delete metaClean.annotations['harvesterhci.io/dataVolumeTemplates'];
      }
    } catch {
      if (metaClean.annotations) {
        delete metaClean.annotations['harvesterhci.io/volumeClaimTemplates'];
        delete metaClean.annotations['harvesterhci.io/dataVolumeTemplates'];
      }
    }

    if (primaryImageId || primaryImageName) {
      if (!metaClean.annotations) metaClean.annotations = {};
      if (primaryImageId && !metaClean.annotations['harvesterhci.io/imageId']) {
        metaClean.annotations['harvesterhci.io/imageId'] = String(primaryImageId);
      }
      if (primaryImageName && !metaClean.annotations['harvesterhci.io/image-name']) {
        metaClean.annotations['harvesterhci.io/image-name'] = String(primaryImageName);
      }
    }

    const autoStart = Boolean(body?.autoStart ?? true);
    const desiredRunStrategy = autoStart ? 'Always' : 'Manual';
    const payload: any = {
      apiVersion: 'kubevirt.io/v1',
      kind: 'VirtualMachine',
      metadata: {
        name: newVmName,
        namespace: targetNamespace,
        labels: metaClean.labels || {},
        annotations: metaClean.annotations || {},
      },
      spec: {
        runStrategy: desiredRunStrategy,
        template: { metadata: metaClean, spec: cleanSpec },
      },
    };

    if (Array.isArray(vctArray) && vctArray.length > 0) payload.spec.volumeClaimTemplates = vctArray;

    const created = await createHarvesterVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      targetNamespace,
      payload,
    );
    res.json({ message: '创建成功', data: created });
  } catch (error: any) {
    if (res.headersSent) return;
    const status = Number(error?.status || 500);
    const errorBody = error?.body ?? error;
    const reason = String(errorBody?.reason || '').trim();
    const msg = String(errorBody?.message || '').toLowerCase();

    if (status === 409 && (reason === 'AlreadyExists' || msg.includes('already exists'))) {
      const attemptedName = String((req as any)?.body?.name || '').trim();
      const attemptedNs =
        String((req as any)?.body?.namespace || '').trim() || String((req as any)?.params?.namespace || '').trim();
      return res.status(409).json({
        message: `虚拟机已存在：${attemptedNs}/${attemptedName}，请更换名称后重试`,
        error: errorBody,
      });
    }

    res.status(status).json({ message: error?.message || '创建失败', error: errorBody });
  }
}

/**
 * POST /:id/resources/harvester/vms/:namespace/:name/save-as-template - 保存为模板
 */
export async function harvesterEcsSaveAsTemplateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;

    if ((req as any).user?.role === 'tenant') {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
      if ((req as any).user?.organizationId) {
        where.organizationId = (req as any).user.organizationId;
      }
      const userSpace = await userSpaceRepo.findOne({ where });
      if (!userSpace) return res.status(403).json({ message: '无权访问该云资源' });

      const validNamespaces = userSpace.namespace ? userSpace.namespace.split(',').map((s) => s.trim()) : [];

      if (!validNamespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权访问该命名空间资源' });
      }
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const vm = await getHarvesterVM(
      {
        endpoint: cloud.endpoint,
        token: cloud.secretKey,
        insecure,
      } as any,
      namespace,
      name,
    );

    if (!vm || !vm.spec?.template?.spec) {
      return res.status(400).json({ message: '当前 VM 不包含完整 template spec，无法保存为模板' });
    }

    const vmNamespace = vm.metadata?.namespace || namespace;
    const vmName = vm.metadata?.name || name;
    const body = req.body || {};

    const targetNamespace =
      (typeof body.namespace === 'string' && body.namespace.trim()) || vmNamespace;

    const aliasFromBody =
      typeof body.alias === 'string' && body.alias.trim() ? String(body.alias).trim() : undefined;
    const descFromBody =
      typeof body.description === 'string' && body.description.trim()
        ? String(body.description).trim()
        : undefined;

    const vmAnnotations = vm.metadata?.annotations || {};

    // 构造新的注解对象，避免直接复制原始 VM 的所有注解（如 mac-address 等不应在模板层保留）
    const templateAnnotations: any = {};
    
    // 保留描述
    const description =
      descFromBody ||
      vmAnnotations['description'] ||
      vmAnnotations['harvesterhci.io/description'];
    
    if (description) {
        templateAnnotations['harvesterhci.io/description'] = description;
    }

    // 处理别名 (Template Alias)
    if (aliasFromBody) {
         templateAnnotations['tower.io/template-alias'] = aliasFromBody;
    } else if (vmAnnotations['tower.io/template-alias']) {
         templateAnnotations['tower.io/template-alias'] = vmAnnotations['tower.io/template-alias'];
    }

    // 保留 volumeClaimTemplates (如果存在)
    const vctRaw = vmAnnotations['harvesterhci.io/volumeClaimTemplates'];
    let volumeClaimTemplates: any[] | undefined = undefined;
    if (vctRaw) {
      try {
        const parsed = JSON.parse(vctRaw);
        if (Array.isArray(parsed)) {
          volumeClaimTemplates = parsed;
          // 在 Template Metadata 中也保留这个注解，以便快速查看
          templateAnnotations['harvesterhci.io/volumeClaimTemplates'] = vctRaw;
        }
      } catch {
      }
    }

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
      targetNamespace,
    )}/virtualmachinetemplates`;

    const resourceName = `id-vmtpl-${Math.random().toString(36).substring(2, 18)}`;
    const versionName = `id-vmtplv-${Math.random().toString(36).substring(2, 18)}`;

    // 1. Create Template
    const templatePayload: any = {
      apiVersion: 'harvesterhci.io/v1beta1',
      kind: 'VirtualMachineTemplate',
      metadata: {
        name: resourceName,
        namespace: targetNamespace,
        labels: {
            // 仅保留必要的 Label，不复制 vmName 等特定 Label
            'harvesterhci.io/creator': 'tower', 
        },
        annotations: templateAnnotations,
      },
      spec: {
        description: description || undefined,
      },
    };

    const createdTemplate = await requestJson(
      'POST',
      url,
      cloud.secretKey || '',
      insecure,
      templatePayload,
    );

    // 2. Create Template Version
    const versionUrl = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
      targetNamespace,
    )}/virtualmachinetemplateversions`;

    const vmTemplateSpec = JSON.parse(JSON.stringify(vm.spec?.template?.spec || {}));
    const vmTemplateMeta = JSON.parse(JSON.stringify(vm.spec?.template?.metadata || {}));

    const versionPayload: any = {
      apiVersion: 'harvesterhci.io/v1beta1',
      kind: 'VirtualMachineTemplateVersion',
      metadata: {
        name: versionName,
        namespace: targetNamespace,
        labels: {
          'harvesterhci.io/vm-template': resourceName,
        },
      },
      spec: {
        vm: {
          metadata: vmTemplateMeta,
          spec: {
            template: {
              metadata: vmTemplateMeta,
              spec: vmTemplateSpec,
            },
            ...(Array.isArray(volumeClaimTemplates) && volumeClaimTemplates.length > 0
              ? { volumeClaimTemplates }
              : {}),
          },
        },
      },
    };

    const createdVersion = await requestJson(
      'POST',
      versionUrl,
      cloud.secretKey || '',
      insecure,
      versionPayload,
    );

    // 3. Update Template to set default version
    const updateUrl = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
      targetNamespace,
    )}/virtualmachinetemplates/${encodeURIComponent(resourceName)}`;
    const updatePayload = {
      spec: {
        defaultVersionId: `${targetNamespace}/${versionName}`,
      },
    };

    await requestJson('PATCH', updateUrl, cloud.secretKey || '', insecure, updatePayload, {
      'Content-Type': 'application/merge-patch+json',
    });

    res.json({
      message: '保存为模板成功',
      data: {
        template: createdTemplate,
        version: createdVersion,
      },
    });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '保存为模板失败',
      error: error.body || error.message,
    });
  }
}
