/**
 * ==============================================================================
 * 模块名称: Harvester VM 资源直连路由 (Harvester Direct VM Routes)
 * 文件路径: src/routes/clouds/harvester/harvester.direct.vm.routes.ts
 * ==============================================================================
 * 功能描述:
 * 本文件提供 Harvester 虚拟机 (VM) 相关资源的直连管理能力，绕过中间缓存，直接与 Harvester API 交互。
 * 涵盖了 VM 的生命周期管理 (启动/停止/重启/暂停/删除)、配置变更 (Spec Update)、迁移、
 * VNC 控制台访问、卷挂载/卸载、USB/GPU 资源查询等操作。
 *
 * 核心逻辑:
 * 1. [Direct API Access]: 所有接口均直接请求 Harvester/KubeVirt 的 API，确保操作的实时性。
 * 2. [Tenant Isolation]: 严格集成了多租户权限校验 (checkTenantAccess)，确保租户只能操作
 *    授权命名空间下的 VM。
 * 3. [SSE Real-time Stream]: 提供 `/ecs/stream` 接口，通过 Server-Sent Events (SSE) 推送
 *    VM 的实时状态变更 (Watch机制)，支持多租户过滤。
 * 4. [Operation Validation]: 在执行敏感操作 (如重启/删除) 前，进行权限和资源存在性校验。
 *
 * API 列表:
 * - GET    /:id/resources/ecs/stream                       建立 VM 状态实时推送流 (SSE)
 * - POST   /:id/resources/ecs/:instanceId/start            启动 VM
 * - POST   /:id/resources/ecs/:instanceId/stop             停止 VM (支持强制)
 * - POST   /:id/resources/ecs/:instanceId/reboot           重启 VM (支持强制)
 * - POST   /:id/resources/ecs/:instanceId/softreboot       软重启 VM (ACPI)
 * - POST   /:id/resources/ecs/:instanceId/pause            暂停 VM
 * - POST   /:id/resources/ecs/:instanceId/unpause          恢复 VM
 * - DELETE /:id/resources/ecs/:instanceId                  删除 VM
 * - POST   /:id/resources/ecs                              创建 VM
 * - PUT    /:id/resources/ecs/:instanceId                  更新 VM 配置 (Spec)
 * - GET    /:id/resources/ecs/:instanceId/vnc              获取 VNC 控制台 URL
 * - POST   /:id/resources/ecs/:instanceId/volumes/attach   挂载卷到 VM
 * - POST   /:id/resources/ecs/:instanceId/volumes/detach   从 VM 卸载卷
 * - POST   /:id/resources/ecs/:instanceId/migrate          迁移 VM
 * - POST   /:id/resources/ecs/:instanceId/migrate/abort    取消迁移
 * - GET    /:id/resources/harvester-gpus                   获取 GPU 资源列表
 * - GET    /:id/resources/harvester-usbs                   获取 USB 资源列表
 * ==============================================================================
 */

import { Router, Response, json } from 'express';
import { AppDataSource } from '../../../config/database';
import { HarvesterVmInventory } from '../../../entities/harvester/HarvesterVmInventory';
import { HarvesterNamespaceInventory } from '../../../entities/harvester/HarvesterNamespaceInventory';
import {
  listKubevirtVMsRawWithMeta,
  listKubevirtVMIsRawWithMeta,
  harvesterStartVM,
  harvesterStopVM,
  harvesterRebootVM,
  harvesterSoftRebootVM,
  harvesterPauseVM,
  harvesterUnpauseVM,
  harvesterDeleteVM,
  createHarvesterVM,
  updateHarvesterVMSpec,
  getHarvesterVmVncUrl,
  harvesterAddVolumeToVM,
  harvesterRemoveVolumeFromVM,
  harvesterMigrateVM,
  harvesterAbortMigration,
  listHarvesterGpuResources,
  listHarvesterUsbResources,
  getHarvesterVMAggregated,
  patchHarvesterVM,
  harvesterForceDeleteVM,
  harvesterRestoreVM,
} from '../../../services/clouds/harvester/client';
import { getJsonOnce, watchJsonStream } from '../../../services/clouds/harvester/utils';
import {
  checkTenantAccess,
  resolveTenantVmId,
  fetchCloudOr404,
  ensureProvider,
  resolveVMStatus,
  isNamespaceAllowed,
} from './harvester.direct.helpers';

/**
 * 注册 Harvester 直连 VM 路由
 * @param router Express Router 对象
 * @param checkAdminPermission 管理员权限校验中间件
 */
export const registerHarvesterDirectVmRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  /**
   * ==================================================================================
   * [SSE] Real-time VM Status Stream
   * ==================================================================================
   * 建立 Server-Sent Events (SSE) 连接，实时推送 VM 和 VMI 的状态变更。
   *
   * [核心逻辑]:
   * 1. [Initial Sync]: 首次连接时，拉取全量 VM/VMI 列表并推送初始状态。
   * 2. [Watch Mechanism]: 使用 K8s Watch API 监听资源变更 (ADDED/MODIFIED/DELETED)。
   * 3. [Tenant Filtering]: 在推送前严格校验 namespace 权限，确保多租户隔离。
   * 4. [State Merging]: 合并 VM (配置) 和 VMI (运行时) 对象，计算最终状态 (PrintableStatus)。
   * 5. [Keep-Alive]: 发送 Ping 帧保持连接活跃。
   */
  router.get(
    '/:id/resources/ecs/stream',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
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
                if (i.ipAddress) ips.push(i.ipAddress);
                if (Array.isArray(i.ipAddresses))
                  ips.push(...i.ipAddresses);
              });
            }

            const payload = {
              iid: item.id,
              status,
              nodeName,
              ips: Array.from(new Set(ips)),
              // [Fix] 推送 metadata 以支持 Label/Finalizer 变更的实时更新 (如重要实例状态)
              metadata: item.metadata, 
            };
            const payloadStr = JSON.stringify(payload);

            if (lastSentStatus.get(item.id) === payloadStr) {
              return;
            }
            lastSentStatus.set(item.id, payloadStr);

            send('vm_status', payload);
          }
        };

        const init = async () => {
          const [vmsResult, vmisResult] = await Promise.all([
            listKubevirtVMsRawWithMeta({
              endpoint: cloud.endpoint,
              token: cloud.secretKey,
              insecure,
            } as any).catch(() => null),
            listKubevirtVMIsRawWithMeta({
              endpoint: cloud.endpoint,
              token: cloud.secretKey,
              insecure,
            } as any).catch(() => null),
          ]);

          const initialItems: any[] = [];
          const vmsRaw = vmsResult?.items || [];
          const vmisRaw = vmisResult?.items || [];

          if (Array.isArray(vmsRaw)) {
            vmsRaw.forEach((vm: any) => {
              if (isTenant) {
                if (
                  !isNamespaceAllowed(
                    tenantNamespace,
                    vm.metadata?.namespace,
                  )
                )
                  return;
              } else if (
                tenantNamespace &&
                !isNamespaceAllowed(tenantNamespace, vm.metadata?.namespace)
              )
                return;

              const key = `${vm.metadata?.namespace}/${vm.metadata?.name}`;
              vmCache.set(key, vm);
            });
          }
          if (Array.isArray(vmisRaw)) {
            vmisRaw.forEach((vmi: any) => {
              if (isTenant) {
                if (
                  !isNamespaceAllowed(
                    tenantNamespace,
                    vmi.metadata?.namespace,
                  )
                )
                  return;
              } else if (
                tenantNamespace &&
                !isNamespaceAllowed(tenantNamespace, vmi.metadata?.namespace)
              )
                return;

              const key = `${vmi.metadata?.namespace}/${vmi.metadata?.name}`;
              vmiCache.set(key, vmi);
            });
          }

          for (const key of vmCache.keys()) {
            const vm = vmCache.get(key);
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

            initialItems.push({
              id: vm.metadata?.uid,
              links: { view: viewUrl },
              ...vm,
              vmi,
              _rv: `${vm.metadata?.resourceVersion || ''}|${
                vmi?.metadata?.resourceVersion || ''
              }`,
            });
          }
          send('vms', { items: initialItems });

          const watchers: any[] = [];

          if (vmsResult?.url) {
            const vmRv = vmsResult.resourceVersion;
            const vmUrl = vmRv
              ? `${vmsResult.url}?watch=true&resourceVersion=${vmRv}`
              : `${vmsResult.url}?watch=true`;

            const w1 = watchJsonStream(
              vmUrl,
              cloud.secretKey || '',
              insecure,
              (event) => {
                if (closed) return;
                const obj = (event as any).object;
                if (!obj || !obj.metadata) return;
                if (isTenant) {
                  if (
                    !isNamespaceAllowed(
                      tenantNamespace,
                      obj.metadata.namespace,
                    )
                  )
                    return;
                } else if (
                  tenantNamespace &&
                  !isNamespaceAllowed(
                    tenantNamespace,
                    obj.metadata.namespace,
                  )
                )
                  return;
                const key = `${obj.metadata.namespace}/${obj.metadata.name}`;

                if ((event as any).type === 'DELETED') {
                  vmCache.delete(key);
                  send('vm_deleted', { iid: obj.metadata.uid });
                } else {
                  vmCache.set(key, obj);
                  const eventType =
                    (event as any).type === 'ADDED'
                      ? 'vm_created'
                      : 'vm_status';
                  sendItem(key, eventType);
                }
              },
              (err) => {
                console.error('VM Watch Error:', err);
                try {
                  send('stream_error', { message: 'Watch stream error', cause: err?.message });
                  if (!(res as any).writableEnded) res.end();
                } catch {}
              },
            );
            watchers.push(w1);
          }

          if (vmisResult?.url) {
            const vmiRv = vmisResult.resourceVersion;
            const vmiUrl = vmiRv
              ? `${vmisResult.url}?watch=true&resourceVersion=${vmiRv}`
              : `${vmisResult.url}?watch=true`;

            const w2 = watchJsonStream(
              vmiUrl,
              cloud.secretKey || '',
              insecure,
              (event) => {
                if (closed) return;
                const obj = (event as any).object;
                if (!obj || !obj.metadata) return;
                if (isTenant) {
                  if (
                    !isNamespaceAllowed(
                      tenantNamespace,
                      obj.metadata.namespace,
                    )
                  )
                    return;
                } else if (
                  tenantNamespace &&
                  !isNamespaceAllowed(
                    tenantNamespace,
                    obj.metadata.namespace,
                  )
                )
                  return;
                const key = `${obj.metadata.namespace}/${obj.metadata.name}`;

                if ((event as any).type === 'DELETED') {
                  vmiCache.delete(key);
                  if (vmCache.has(key)) {
                    sendItem(key);
                  }
                } else {
                  vmiCache.set(key, obj);
                  if (vmCache.has(key)) {
                    sendItem(key);
                  }
                }
              },
              (err) => {
                console.error('VMI Watch Error:', err);
                try {
                  send('stream_error', { message: 'Watch stream error', cause: err?.message });
                  if (!(res as any).writableEnded) res.end();
                } catch {}
              },
            );
            watchers.push(w2);
          }

          return watchers;
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
    },
  );

  /**
   * ==================================================================================
   * VM Lifecycle Management
   * ==================================================================================
   * 包含 VM 的启动、停止、重启、暂停、恢复、删除等操作。
   * 所有操作均需校验:
   * 1. 租户权限 (checkTenantAccess + clouds.console:write)
   * 2. 目标 VM 是否存在且属于该租户 (resolveTenantVmId)
   */
  router.post(
    '/:id/resources/ecs/:instanceId/start',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;

        const { resolvedId, error } = await resolveTenantVmId(
          tenantNamespace,
          instanceId,
          cloud,
        );
        if (error)
          return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await harvesterStartVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
        );
        res.json({ message: '启动成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || '启动实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/stop',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;

        const { resolvedId, error } = await resolveTenantVmId(
          tenantNamespace,
          instanceId,
          cloud,
        );
        if (error)
          return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await harvesterStopVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
          !!force,
        );
        res.json({ message: '停止成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || '停止实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/reboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;

        const { resolvedId, error } = await resolveTenantVmId(
          tenantNamespace,
          instanceId,
          cloud,
        );
        if (error)
          return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await harvesterRebootVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
          !!force,
        );
        res.json({ message: '重启成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || '重启实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/softreboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;

        const { resolvedId, error } = await resolveTenantVmId(
          tenantNamespace,
          instanceId,
          cloud,
        );
        if (error)
          return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await harvesterSoftRebootVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
        );
        res.json({ message: '软重启成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || '软重启实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/pause',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;

        const { resolvedId, error } = await resolveTenantVmId(
          tenantNamespace,
          instanceId,
          cloud,
        );
        if (error)
          return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await harvesterPauseVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
        );
        res.json({ message: '暂停成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || '暂停实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/unpause',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;

        const { resolvedId, error } = await resolveTenantVmId(
          tenantNamespace,
          instanceId,
          cloud,
        );
        if (error)
          return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await harvesterUnpauseVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
        );
        res.json({ message: '恢复成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || '恢复实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.delete(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { deleteImage, deleteVolumes } = req.query;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;

        const { resolvedId, error } = await resolveTenantVmId(
          tenantNamespace,
          instanceId,
          cloud,
        );
        if (error)
          return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await harvesterDeleteVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
          String(deleteVolumes) === 'true',
          true,
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || '删除实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * ==================================================================================
   * 回收站管理 (Recycle Bin)
   * ==================================================================================
   * 恢复和强制删除回收站中的虚拟机
   */
  router.post(
    '/:id/resources/ecs/:instanceId/restore',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;

        const { resolvedId, error } = await resolveTenantVmId(
          tenantNamespace,
          instanceId,
          cloud,
        );
        if (error)
          return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await harvesterRestoreVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
        );
        res.json({ message: '恢复成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || '恢复实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.delete(
    '/:id/resources/ecs/:instanceId/force',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { deleteVolumes } = req.query;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;

        const { resolvedId, error } = await resolveTenantVmId(
          tenantNamespace,
          instanceId,
          cloud,
        );
        if (error)
          return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await harvesterForceDeleteVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
          String(deleteVolumes) === 'true',
          true,
        );
        res.json({ message: '强制删除成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || '强制删除实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * ==================================================================================
   * VM Configuration & CRUD
   * ==================================================================================
   * 包含 VM 的创建、更新 (PUT/PATCH)、Spec 修改等操作。
   * 涉及多租户命名空间校验 (Namespace Filtering) 和本地缓存更新。
   */
  router.post(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
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

        if (req.body.metadata) {
          req.body.metadata.namespace = req.body.namespace || 'default';
        }

        const { namespace, ...payload } = req.body;

        const data = await createHarvesterVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace || 'default',
          payload,
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: '创建实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.put(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
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
        res.status(500).json({
          message: '更新实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/update-spec',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;
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
        res.status(500).json({
          message: '更新实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [PATCH] /:id/resources/harvester/vms/:namespace/:name
   * 通用 PATCH 接口，支持透传 Content-Type (如 application/merge-patch+json)
   */
  router.patch(
    '/:id/resources/harvester/vms/:namespace/:name',
    checkAdminPermission,
    // [中间件] 显式支持 Patch JSON 类型解析
    // Express 默认 json() 可能不包含 application/json-patch+json
    json({ type: ['application/json-patch+json', 'application/merge-patch+json'] }),
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        if (tenantNamespace) {
          if (!isNamespaceAllowed(tenantNamespace, namespace)) {
            return res
              .status(403)
              .json({ message: 'Access denied to this namespace' });
          }
        }

        // 透传 Content-Type，默认为 application/merge-patch+json
        const contentType = req.headers['content-type'] || 'application/merge-patch+json';

        const data = await patchHarvesterVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
          req.body,
          contentType
        );

        // 尝试更新本地缓存 (Best Effort)
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
        res.status(500).json({
          message: 'Patch 实例失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.get(
    '/:id/resources/ecs/:instanceId/vnc-url',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
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
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        if (tenantNamespace) {
          req.query.namespace = tenantNamespace;
        }

        const { namespace } = req.query as any;

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
        res.status(500).json({
          message: '获取VNC地址失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * ==================================================================================
   * Volume Operations (Hot Plug)
   * ==================================================================================
   * 支持 VM 在线挂载/卸载数据卷 (Hot Plug)。
   * 需要 Harvester 版本支持且 VM 已安装 Guest Agent。
   */
  router.post(
    [
      '/:id/resources/ecs/:instanceId/add-volume',
      '/:id/resources/harvester/vms/:instanceId/add-volume',
    ],
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;
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
        res.status(500).json({
          message: '挂载卷失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.post(
    [
      '/:id/resources/ecs/:instanceId/remove-volume',
      '/:id/resources/harvester/vms/:instanceId/remove-volume',
    ],
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });
        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({
              message: 'Permission denied: Requires clouds.console:write',
            });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next))
          return;
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
        // 如果错误对象包含 status，使用该状态码；否则使用 500
        const statusCode = error?.status && error.status !== 500 ? error.status : 500;
        // 优先使用 error.message（友好的错误消息），其次使用 error.body 或 error.message
        const errorMessage = error?.message || error?.body || error?.message || '卸载卷失败';
        res.status(statusCode).json({
          message: errorMessage,
          error: error?.body || error?.message || String(error),
        });
      }
    },
  );

  /**
   * ==================================================================================
   * Migration Operations
   * ==================================================================================
   * 支持 VM 热迁移 (Live Migration) 及取消迁移。
   */
  router.post(
    '/:id/resources/ecs/:instanceId/migrate',
    async (req: any, res: Response) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace, isTenant } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res.status(403).json({ message: 'Access denied' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Provider mismatch'))
          return;

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
            endpoint: cloud.endpoint || cloud.config.endpoint,
            token: cloud.secretKey || cloud.config.token,
            insecure:
              !!(cloud.config as any)?.ignoreTls ||
              !!(cloud.config as any)?.insecure,
          },
          resolvedId,
          req.body.targetNode,
        );
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/abort-migration',
    async (req: any, res: Response) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace, isTenant } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res.status(403).json({ message: 'Access denied' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Provider mismatch'))
          return;

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
            endpoint: cloud.endpoint || cloud.config.endpoint,
            token: cloud.secretKey || cloud.config.token,
            insecure:
              !!(cloud.config as any)?.ignoreTls ||
              !!(cloud.config as any)?.insecure,
          },
          resolvedId,
        );
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  /**
   * ==================================================================================
   * Hardware Resources (GPU/USB)
   * ==================================================================================
   * 查询 Harvester 集群的 PCI 设备资源 (HostDevices)。
   */
  router.get(
    '/:id/resources/harvester/gpu',
    checkAdminPermission,
    async (req: any, res: Response) => {
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
        res.status(500).json({
          message: '查询GPU资源失败',
          error: error.body || error.message,
        });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/usb',
    checkAdminPermission,
    async (req: any, res: Response) => {
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
        res.status(500).json({
          message: '查询USB资源失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * ==================================================================================
   * Migration Operations (Direct)
   * ==================================================================================
   */
  router.get(
    '/:id/resources/harvester/migrations-direct',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
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
        res.status(500).json({
          message: '查询迁移记录失败',
          error: error.body || error.message || error,
        });
      }
    },
  );

  router.get(
    '/:id/resources/ecs/:namespace/:name/aggregated',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        
        if (!allowed)
          return res.status(403).json({ message: 'Access denied to this resource pool' });
        
        if (isTenant && tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
          return res.status(403).json({ message: 'Access denied to this namespace' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const data = await getHarvesterVMAggregated(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name
        );
        res.json({ data });
      } catch (error: any) {
        res.status(500).json({
          message: error.message || 'Failed to fetch aggregated VM details',
          error: error.body || error.message
        });
      }
    }
  );
};
