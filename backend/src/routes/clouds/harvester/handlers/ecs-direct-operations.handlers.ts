/**
 * ==============================================================================
 * 模块名称: Harvester ECS 操作 Handlers (VM Operations)
 * 文件路径: src/routes/clouds/harvester/handlers/ecs-operations.handlers.ts
 * ==============================================================================
 * 功能描述:
 * 本文件包含 Harvester 虚拟机 (ECS) 的其他操作 handlers，包括：
 * - 控制台访问：VNC URL、SSE 实时流
 * - 卷管理：挂载、卸载
 * - 迁移操作：迁移、取消迁移
 * - 硬件资源：GPU、USB 资源查询
 * - 聚合查询：VM 聚合详情
 * 
 * 注意：生命周期操作已迁移到 ecs-lifecycle.handlers.ts
 *       CRUD 操作已迁移到 ecs-crud.handlers.ts
 * ==============================================================================
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterNamespaceInventory } from '../../../../entities/harvester/HarvesterNamespaceInventory';
import {
  getHarvesterVmVncUrl,
  getHarvesterVMAggregated,
  harvesterAddVolumeToVM,
  harvesterRemoveVolumeFromVM,
  harvesterMigrateVM,
  harvesterAbortMigration,
  listHarvesterGpuResources,
  listHarvesterUsbResources,
  listKubevirtVMsRawWithMeta,
  listKubevirtVMIsRawWithMeta,
} from '../../../../services/clouds/harvester/client';
import { getJsonOnce, watchJsonStream, requestJson } from '../../../../services/clouds/harvester/utils';
import {
  checkTenantAccess,
  resolveTenantVmId,
  ensureProvider,
  resolveVMStatus,
  isNamespaceAllowed,
} from '../harvester.direct.helpers';

/**
 * GET /:id/resources/ecs/stream - 建立 VM 状态实时推送流 (SSE)
 */
export async function harvesterEcsStreamHandler(req: any, res: Response, next: any) {
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

    // 与 watch 回调一致：租户仅同步白名单命名空间；init 首包原先未过滤，会把全集群 VM 推给前端
    const tenantAllowedNs = tenantNamespace
      ? tenantNamespace.split(',').map((s: string) => s.trim()).filter(Boolean)
      : null;
    const tenantNsAllowed = (ns: string) =>
      !tenantAllowedNs || tenantAllowedNs.includes(ns);

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    (res as any).flushHeaders?.();

    let closed = false;

    const pingInterval = setInterval(() => {
      if (closed) {
        clearInterval(pingInterval);
        return;
      }
      try {
        res.write(': ping\n\n');
      } catch {}
    }, 3000);

    let activeWatchers: any[] = [];
    req.on('close', () => {
      closed = true;
      try {
        clearInterval(pingInterval);
      } catch {}
      activeWatchers.forEach((w) => w.abort());
    });

    const vmCache = new Map<string, any>();
    const vmiCache = new Map<string, any>();
    const lastSentStatus = new Map<string, string>();

    const send = (event: string, payload: any) => {
      if (closed) return;
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {}
    };

    const sendItem = (
      key: string,
      eventType: 'vm_created' | 'vm_status' = 'vm_status',
    ) => {
      const vm = vmCache.get(key);
      if (!vm) return;
      const vmi = vmiCache.get(key);

      if (!vm.status) vm.status = {};
      vm.status.printableStatus = resolveVMStatus(vm, vmi);

      const base = (cloud.endpoint || '').replace(/\/+$/, '');
      let origin = base;
      try {
        const u = new URL(base);
        origin = `${u.protocol}//${u.host}`;
      } catch {
        origin = base.replace(/\/v[0-9].*$/, '');
      }

      const namespace = vm.metadata?.namespace || 'default';
      const name = vm.metadata?.name || '';
      const viewUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

      const item = {
        id: vm.metadata?.uid,
        links: { view: viewUrl },
        ...vm,
        vmi,
        _rv: `${vm.metadata?.resourceVersion || ''}|${
          vmi?.metadata?.resourceVersion || ''
        }`,
      };

      if (eventType === 'vm_created') {
        send('vm_created', { item });
      } else {
        const status = String(
          item.status?.printableStatus || item.status?.phase || '',
        );
        const nodeName =
          item.vmi?.status?.nodeName || item.status?.nodeName || '';
        const ips: string[] = [];
        if (item.vmi?.status?.interfaces) {
          item.vmi.status.interfaces.forEach((i: any) => {
            if (i.ipAddress || i.ip) ips.push(i.ipAddress || i.ip);
          });
        }
        const lastStatus = lastSentStatus.get(key);
        if (lastStatus !== status || nodeName || ips.length > 0) {
          lastSentStatus.set(key, status);
          send('vm_status', {
            id: item.id,
            status,
            nodeName,
            ips,
            item,
          });
        }
      }
    };

    const init = async () => {
      const base = (cloud.endpoint || '').replace(/\/+$/, '');
      let origin = base;
      try {
        const u = new URL(base);
        origin = `${u.protocol}//${u.host}`;
      } catch {
        origin = base.replace(/\/v[0-9].*$/, '');
      }

      const [vmsResult, vmisResult] = await Promise.all([
        listKubevirtVMsRawWithMeta({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any).catch(() => null),
        listKubevirtVMIsRawWithMeta({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any).catch(() => null),
      ]);

      const vms = vmsResult?.items || [];
      const vmis = vmisResult?.items || [];

      vms.forEach((vm: any) => {
        const ns = vm.metadata?.namespace || '';
        const name = vm.metadata?.name || '';
        if (ns && name && tenantNsAllowed(ns)) {
          const key = `${ns}/${name}`;
          vmCache.set(key, vm);
        }
      });

      vmis.forEach((vmi: any) => {
        const ns = vmi.metadata?.namespace || '';
        const name = vmi.metadata?.name || '';
        if (ns && name && tenantNsAllowed(ns)) {
          const key = `${ns}/${name}`;
          vmiCache.set(key, vmi);
          sendItem(key, 'vm_created');
        }
      });

      const vmUrl = `${origin}/apis/kubevirt.io/v1/virtualmachines?watch=true`;
      const vmiUrl = `${origin}/apis/kubevirt.io/v1/virtualmachineinstances?watch=true`;

      const vmWatcher = watchJsonStream(
        vmUrl,
        cloud.secretKey || '',
        insecure,
        (event: any) => {
          if (closed) return;
          const obj = event.object;
          const ns = obj?.metadata?.namespace || '';
          const name = obj?.metadata?.name || '';
          if (!ns || !name) return;

          if (!tenantNsAllowed(ns)) return;

          const key = `${ns}/${name}`;
          if (event.type === 'DELETED') {
            vmCache.delete(key);
            send('vm_deleted', { id: obj.metadata?.uid });
          } else {
            vmCache.set(key, obj);
            sendItem(key);
          }
        },
      );

      const vmiWatcher = watchJsonStream(
        vmiUrl,
        cloud.secretKey || '',
        insecure,
        (event: any) => {
          if (closed) return;
          const obj = event.object;
          const ns = obj?.metadata?.namespace || '';
          const name = obj?.metadata?.name || '';
          if (!ns || !name) return;

          if (!tenantNsAllowed(ns)) return;

          const key = `${ns}/${name}`;
          vmiCache.set(key, obj);
          sendItem(key);
        },
      );

      return [vmWatcher, vmiWatcher];
    };

    activeWatchers = await init();
  } catch (error: any) {
    try {
      if (!res.headersSent) {
        res
          .status(500)
          .json({ message: 'Stream error', error: error.message });
      } else {
        res.end();
      }
    } catch {}
  }
}


/**
 * GET /:id/resources/ecs/:instanceId/vnc-url - 获取 VNC URL
 */
export async function harvesterEcsVncUrlHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
      reqAny,
      id,
    );
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    if (tenantNamespace) {
      (req as any).query.namespace = tenantNamespace;
    }

    const { namespace } = (req as any).query as any;

    const cleanName = instanceId.includes('/')
      ? instanceId.split('/')[1]
      : instanceId;

    const url = await getHarvesterVmVncUrl(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      String(namespace || 'default'),
      cleanName,
    );
    res.json({ message: '获取成功', data: { url } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '获取VNC地址失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/add-volume - 挂载卷到 VM
 */
export async function harvesterEcsAddVolumeHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const data = await harvesterAddVolumeToVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
      req.body,
    );
    res.json({ message: '挂载成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '挂载卷失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/remove-volume - 从 VM 卸载卷
 */
export async function harvesterEcsRemoveVolumeHandler(req: Request, res: Response) {
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

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const data = await harvesterRemoveVolumeFromVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
      req.body,
    );
    res.json({ message: '卸载成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    const statusCode = error?.status && error.status !== 500 ? error.status : 500;
    const errorMessage = error?.message || error?.body || error?.message || '卸载卷失败';
    res.status(statusCode).json({
      message: errorMessage,
      error: error?.body || error?.message || String(error),
    });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/migrate - 迁移 VM
 */
export async function harvesterEcsMigrateHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace, isTenant } = await checkTenantAccess(
      reqAny,
      id,
    );
    if (!allowed)
      return res.status(403).json({ message: 'Access denied' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Provider mismatch')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      namespace,
      instanceId,
      cloud,
      isTenant,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const result = await harvesterMigrateVM(
      {
        endpoint: cloud.endpoint || (cloud.config as any)?.endpoint,
        token: cloud.secretKey || (cloud.config as any)?.token,
        insecure:
          !!(cloud.config as any)?.ignoreTls ||
          !!(cloud.config as any)?.insecure,
      },
      resolvedId,
      req.body.targetNode,
    );
    res.json(result);
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: error.message });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/abort-migration - 取消迁移
 */
export async function harvesterEcsAbortMigrationHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace, isTenant } = await checkTenantAccess(
      reqAny,
      id,
    );
    if (!allowed)
      return res.status(403).json({ message: 'Access denied' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Provider mismatch')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      namespace,
      instanceId,
      cloud,
      isTenant,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const result = await harvesterAbortMigration(
      {
        endpoint: cloud.endpoint || (cloud.config as any)?.endpoint,
        token: cloud.secretKey || (cloud.config as any)?.token,
        insecure:
          !!(cloud.config as any)?.ignoreTls ||
          !!(cloud.config as any)?.insecure,
      },
      resolvedId,
    );
    res.json(result);
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: error.message });
  }
}

/**
 * GET /:id/resources/harvester/gpu - 获取 GPU 资源列表
 */
export async function harvesterGpuResourcesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const reqAny = req as any;
    const { allowed } = await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });

    const cloud = (req as any).cloud;
    if (
      !ensureProvider(
        cloud,
        'harvester',
        res,
        '仅支持 Harvester 资源查询',
      )
    )
      return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const items = await listHarvesterGpuResources({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
    } as any);
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询GPU资源失败',
      error: error.body || error.message,
    });
  }
}

/**
 * GET /:id/resources/harvester/usb - 获取 USB 资源列表
 */
export async function harvesterUsbResourcesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const reqAny = req as any;
    const { allowed } = await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });

    const cloud = (req as any).cloud;
    if (
      !ensureProvider(
        cloud,
        'harvester',
        res,
        '仅支持 Harvester 资源查询',
      )
    )
      return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const items = await listHarvesterUsbResources({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
    } as any);
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询USB资源失败',
      error: error.body || error.message,
    });
  }
}

/**
 * GET /:id/resources/harvester/migrations-direct - 获取迁移列表
 */
export async function harvesterMigrationsDirectHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    const cloud = (req as any).cloud;
    if (
      !ensureProvider(
        cloud,
        'harvester',
        res,
        '仅支持 Harvester 资源查询',
      )
    )
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

    const clusterUrl = `${origin}/apis/kubevirt.io/v1/virtualmachineinstancemigrations`;
    let items: any[] = [];
    let clusterErr: any = null;
    try {
      const raw = await getJsonOnce(clusterUrl, cloud.secretKey || '', insecure);
      items = Array.isArray(raw?.items) ? raw.items : [];
    } catch (e: any) {
      clusterErr = e;
    }

    if (items.length === 0 && clusterErr) {
      const nsList: string[] = [];
      if (isTenant || tenantNamespace) {
        const allowedNs = (tenantNamespace || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        nsList.push(...allowedNs);
      } else {
        const repo =
          AppDataSource.getRepository(HarvesterNamespaceInventory);
        const dbItems = await repo.find({ where: { cloudId: id } });
        nsList.push(
          ...dbItems
            .map((i) =>
              String(
                i?.name || i?.rawData?.metadata?.name || '',
              ).trim(),
            )
            .filter(Boolean),
        );
      }
      const uniqueNs = Array.from(new Set(nsList)).filter(Boolean);
      for (const ns of uniqueNs) {
        const nsUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
          ns,
        )}/virtualmachineinstancemigrations`;
        try {
          const rawNs = await getJsonOnce(
            nsUrl,
            cloud.secretKey || '',
            insecure,
            true,
          );
          const arr = Array.isArray(rawNs?.items) ? rawNs.items : [];
          if (arr.length > 0) items.push(...arr);
        } catch (eNs: any) {}
      }
    }

    if (isTenant || tenantNamespace) {
      const allowedNs = (tenantNamespace || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (allowedNs.length > 0) {
        items = items.filter((m: any) =>
          allowedNs.includes(
            String(m?.metadata?.namespace || '').trim(),
          ),
        );
      } else {
        items = [];
      }
    }

    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询迁移记录失败',
      error: error.body || error.message || error,
    });
  }
}

/**
 * POST /:id/resources/harvester/vms/:namespace/:name/action - 执行 VM 操作（热插拔等）
 * 
 * 支持的 action：
 * - addNic, removeNic, findHotunpluggableNics (网卡热插拔)
 * - addVolume, removeVolume (数据盘热插拔)
 * - cpuAndMemoryHotplug (CPU/内存热插拔)
 * - insertCdRomVolume, ejectCdRomVolume (CD-ROM热插拔)
 * - clone (克隆 VM)
 */
export async function harvesterVmActionHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const { action } = req.query;

    if (!action || typeof action !== 'string') {
      return res.status(400).json({ message: 'Missing action parameter' });
    }

    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });

    if (isTenant) {
      const validNamespaces = tenantNamespace
        ? tenantNamespace.split(',').map((s) => s.trim())
        : [];
      if (!validNamespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权访问该命名空间资源' });
      }
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    // 构建 Harvester API 路径
    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    // Harvester API 路径格式：/v1/harvester/kubevirt.io.virtualmachine/{namespace}/{name}?action={action}
    const targetUrl = `${origin}/v1/harvester/kubevirt.io.virtualmachine/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}?action=${encodeURIComponent(action)}`;

    // 转发请求到 Harvester API
    const data = await requestJson(
      'POST',
      targetUrl,
      cloud.secretKey || '',
      insecure,
      req.body,
    );

    res.json({ message: '操作成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    const statusCode = error.status || error.statusCode || 500;
    const errorMessage = error.body?.message || error.message || '操作失败';
    res.status(statusCode).json({
      message: '操作失败',
      error: errorMessage,
    });
  }
}

/**
 * GET /:id/resources/ecs/:namespace/:name/aggregated - 获取聚合 VM 详情
 */
export async function harvesterEcsAggregatedHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(reqAny, id);
    
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });
    
    if (isTenant && tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
      return res.status(403).json({ message: 'Access denied to this namespace' });
    }
    
    const cloud = (req as any).cloud;
    
    const insecure = !!(cloud.config as any)?.ignoreTls;
    
    const data = await getHarvesterVMAggregated(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace,
      name
    );
    res.json({ data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || 'Failed to fetch aggregated VM details',
      error: error.body || error.message
    });
  }
}
