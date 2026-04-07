/**
 * ==============================================================================
 * 模块名称: Harvester 虚拟机领域路由 (Harvester VM Routes)
 * 文件路径: src/routes/clouds/harvester/harvester.cache.vm.routes.ts
 * ==============================================================================
 * 功能描述:
 * 本文件集中管理 Harvester 虚拟机的相关路由，提供列表查询、生命周期管理、实时状态流
 * 和模板保存等功能。实现了基于缓存的列表查询策略和直连 API 的操作策略，并集成了
 * 多租户命名空间隔离逻辑。
 *
 * 核心逻辑:
 * 1. [Inventory Cache First]: 列表接口 (/:id/resources/ecs) 优先从本地数据库缓存
 *    (HarvesterVmInventory/HarvesterVmiInventory) 读取数据，仅在强制刷新或缓存为空时
 *    触发同步，避免高频调用 Harvester API。
 * 2. [Direct API for Actions]: 所有生命周期操作 (Start/Stop/Delete 等) 直接调用 Harvester API，
 *    确保操作的实时性和一致性，避免缓存延迟导致的状态不一致。
 * 3. [Tenant Isolation]: 基于 UserSpace 和 Organization ID 动态构建命名空间白名单，
 *    在所有接口层面对请求进行严格的权限过滤，确保租户只能访问授权范围内的资源。
 * 4. [SSE Real-time Stream]: 提供 Server-Sent Events (SSE) 接口，通过 watchJsonStream
 *    订阅 K8s 事件，实时推送 VM/VMI 的状态变更 (vm_created, vm_status, vm_deleted)。
 *
 * API 列表:
 * - GET    /:id/resources/ecs                                      获取虚拟机列表 (带缓存)
 * - GET    /:id/resources/ecs/stream                               获取虚拟机实时状态流 (SSE)
 * - POST   /:id/resources/harvester/vms                            创建虚拟机
 * - GET    /:id/resources/harvester/vms/:namespace/:name           获取 VM 原始 Manifest
 * - POST   /:id/resources/harvester/vms/:namespace/:name/save-as-template 保存为模板
 * - GET    /:id/resources/ecs/:instanceId/vnc                      获取 VNC Console URL
 * - POST   /:id/resources/ecs/:instanceId/start                    启动虚拟机 (通用)
 * - POST   /:id/resources/ecs/:instanceId/stop                     停止虚拟机 (通用)
 * - POST   /:id/resources/ecs/:instanceId/reboot                   重启虚拟机
 * - POST   /:id/resources/ecs/:instanceId/softreboot               软重启虚拟机
 * - POST   /:id/resources/ecs/:instanceId/pause                    暂停虚拟机
 * - POST   /:id/resources/ecs/:instanceId/unpause                  恢复虚拟机
 * - DELETE /:id/resources/ecs/:instanceId                          删除虚拟机
 * - POST   /:id/resources/harvester/vms/:namespace/:name/start     启动虚拟机 (指定 NS)
 * - POST   /:id/resources/harvester/vms/:namespace/:name/stop      停止虚拟机 (指定 NS)
 * ==============================================================================
 */
import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { UserSpace } from '../../../entities/UserSpace';
import { HarvesterVmInventory } from '../../../entities/harvester/HarvesterVmInventory';
import { HarvesterVmiInventory } from '../../../entities/harvester/HarvesterVmiInventory';
import { HarvesterTemplateInventory } from '../../../entities/harvester/HarvesterTemplateInventory';
import {
  createHarvesterVM,
  getHarvesterVM,
  getHarvesterVmVncUrl,
  harvesterStartVM,
  harvesterStopVM,
  harvesterRebootVM,
  harvesterSoftRebootVM,
  harvesterPauseVM,
  harvesterUnpauseVM,
  harvesterDeleteVM,
  listKubevirtVMsRawWithMeta,
  listKubevirtVMIsRawWithMeta,
} from '../../../services/clouds/harvester/client';
import { createHarvesterPVCVolume } from '../../../services/clouds/harvester/storage';
import { syncKubevirtVms, syncKubevirtVmis } from '../../../services/clouds/harvester/inventory';
import {
  getJsonOnce,
  requestJson,
  watchJsonStream,
  logVmWatchStreamError,
} from '../../../services/clouds/harvester/utils';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

/**
 * 检查克隆目标 VM 所用 PVC 是否全部 Bound，用于克隆任务结束状态判断。
 * @returns true 表示全部 Bound（克隆卷已就绪），false 表示有未 Bound 或请求失败
 */
async function checkClonePvcsBound(
  origin: string,
  token: string,
  insecure: boolean,
  namespace: string,
  claimNames: string[],
): Promise<boolean> {
  if (!namespace || !Array.isArray(claimNames) || claimNames.length === 0) return true;
  try {
    const results = await Promise.all(
      claimNames.map(async (name) => {
        try {
          const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`;
          const pvc = await getJsonOnce(url, token, insecure, true);
          const phase = String(pvc?.status?.phase || '').toLowerCase();
          return phase === 'bound';
        } catch {
          return false;
        }
      }),
    );
    return results.every(Boolean);
  } catch {
    return false;
  }
}

/**
 * 将 Harvester VM 相关路由注册到传入的 Express Router 上。
 *
 * 设计要点：
 * - 不直接 new Router()，而是复用上层聚合路由的 router 实例，保证前缀一致性
 * - 通过参数传入 checkAdminPermission 中间件，保持鉴权逻辑与其它云路由一致
 * - 所有路由路径都以 /:id/resources/... 开头，其中 :id 为 Cloud 账号主键
 */
export const registerHarvesterVmRoutes = (router: Router, checkAdminPermission: any) => {
  // [已迁移] 以下路由已迁移到 harvester.cache.routes.provider.ts，使用策略模式+中间件架构
  // 保留代码作为参考，但实际路由已在新文件中注册
  // 如需查看新实现，请参考: backend/src/routes/clouds/harvester/harvester.cache.routes.provider.ts
  return;
  
  /**
   * [GET] /:id/resources/ecs
   * 获取虚拟机列表 (ECS)
   *
   * 实现原理：
   * - 从 HarvesterVmInventory / HarvesterVmiInventory 读出 VM / VMI 清单
   * - 根据租户 UserSpace.namespace + 组织 ns-{orgId} 做命名空间白名单过滤
   * - 过滤系统命名空间（除非管理员显式 ?includeSystem=true）
   * - 将 VM 与 VMI 按 namespace/name 关联，融合出 status / ip / 节点 / 网络 等字段
   * - capabilities 字段描述当前云账号在 ECS 维度支持哪些能力（InstanceType / VPC 等）
   *
   * 与前端契约：
   * - data 为数组，每一项带有 id/name/namespace/status/ips/nodeName 等字段
   * - vmi/vmiRaw 字段为前端详情视图做透传
   */
  // [已迁移] GET /:id/resources/ecs - 已迁移到 harvester.cache.routes.provider.ts
  // 保留代码作为参考，但实际路由已在新文件中注册
  router.get(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const vmRepo = AppDataSource.getRepository(HarvesterVmInventory);
        const vmiRepo = AppDataSource.getRepository(HarvesterVmiInventory);

        const isSystemNamespace = (ns: string) => {
          if (!ns) return false;
          const exactBlacklist = ['cloud-public', 'ingress-nginx'];
          if (exactBlacklist.includes(ns)) return true;
          const prefixBlacklist = [
            'cattle',
            'fleet',
            'longhorn',
            'kube',
            'harvester',
            'cluster',
            'cluster-fleet',
            'local',
            'user',
          ];
          return prefixBlacklist.some((p) => ns.startsWith(p));
        };

        let vmWhere: any = { cloudId: id };
        let vmiWhere: any = { cloudId: id };
        let validNamespaces: string[] | null = null;

        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          validNamespaces = [];
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
            return res.json({ message: '查询成功', data: [], capabilities: {} });
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

          if (uniqueNamespaces.size > 0) {
            validNamespaces = Array.from(uniqueNamespaces);
          }
        }

        const count = await vmRepo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
          try {
            await Promise.all([syncKubevirtVms(cloud, insecure), syncKubevirtVmis(cloud, insecure)]);
          } catch (e: any) {
            console.warn('Sync ECS failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        let vmItems = await vmRepo.find({ where: vmWhere });
        const vmiItems = await vmiRepo.find({ where: vmiWhere });
        let vmisRaw = vmiItems.map((i) => i.rawData);

        if (validNamespaces) {
          vmItems = vmItems.filter((i) => validNamespaces!.includes(i.namespace));
          vmisRaw = vmisRaw.filter((v: any) => validNamespaces!.includes(v.metadata?.namespace));
        }

        const includeSystem = req.query.includeSystem === 'true';
        if (isTenant || !includeSystem) {
          vmItems = vmItems.filter((i) => !isSystemNamespace(i.namespace));
          vmisRaw = vmisRaw.filter((v: any) => !isSystemNamespace(v.metadata?.namespace));
        }

        const vmiMap = new Map<string, any>();
        vmisRaw.forEach((v: any) => {
          if (v?.metadata?.name && v?.metadata?.namespace) {
            vmiMap.set(`${v.metadata.namespace}/${v.metadata.name}`, v);
          }
        });

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const data = vmItems.map((item: any) => {
          const vm = item.rawData;
          const name = vm?.metadata?.name || '';
          const namespace = vm?.metadata?.namespace || '';
          const uid = vm?.metadata?.uid || '';
          const vmi = vmiMap.get(`${namespace}/${name}`);

          const viewUrl =
            item.view || `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

          const status = vm?.status?.printableStatus || vm?.status?.phase || 'Unknown';

          const ips: string[] = [];
          const macs: string[] = [];
          const addIp = (s: any) => {
            const v = String(s || '').trim();
            if (v && !ips.includes(v)) ips.push(v);
          };

          if (vm?.status?.vmIp) addIp(vm.status.vmIp);
          if (Array.isArray(vm?.status?.interfaces)) {
            vm.status.interfaces.forEach((i: any) => {
              addIp(i.ipAddress || i.ip);
              if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
            });
          }
          if (vmi) {
            if (Array.isArray(vmi.status?.interfaces)) {
              vmi.status.interfaces.forEach((i: any) => {
                if (i.ipAddress || i.ip) addIp(i.ipAddress || i.ip);
                if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
              });
            }
          }

          const nodeName = vm?.status?.nodeName || vmi?.status?.nodeName || '';

          const networksArr: any[] = Array.isArray(vm?.spec?.template?.spec?.networks)
            ? vm?.spec?.template?.spec?.networks
            : [];
          const networks: string[] = networksArr
            .map((n: any) => n?.multus?.networkName || (n?.name ? String(n.name) : 'pod'))
            .filter((s: string) => !!s);

          const cpu =
            vm?.spec?.template?.spec?.domain?.cpu?.cores ||
            vm?.spec?.template?.spec?.domain?.cpu?.sockets ||
            undefined;
          const memory =
            vm?.spec?.template?.spec?.domain?.resources?.requests?.memory ||
            vm?.spec?.template?.spec?.domain?.memory?.guest ||
            undefined;

          const volumes = vm?.spec?.template?.spec?.volumes || [];
          const volumeClaims = volumes
            .map((v: any) => v?.persistentVolumeClaim?.claimName)
            .filter((n: string) => !!n);

          const creationTimestamp = vm?.metadata?.creationTimestamp;
          const description = vm?.metadata?.annotations?.description || '';
          const creator = vm?.metadata?.labels?.['harvesterhci.io/creator'] || '';
          const conditions = vm?.status?.conditions || [];

          const mergedAnnotations = {
            ...(vm?.metadata?.annotations || {}),
            ...(item.annotations || {}),
          };

          return {
            ...vm,
            metadata: {
              ...(vm?.metadata || {}),
              annotations: mergedAnnotations,
            },
            view: viewUrl,
            links: { view: viewUrl },
            id: uid,
            name,
            namespace,
            status,
            description,
            creator,
            conditions,
            createdAt: creationTimestamp,
            ips,
            macAddresses: Array.from(new Set(macs)),
            nodeName,
            networks,
            vpcName: networks.find((n) => n !== 'pod' && n !== 'default'),
            volumeClaims,
            cpu,
            memoryGb: memory,
            vmiRaw: vmi,
            vmi: vmi,
          };
        });

        // 克隆任务状态：对带 tower.io/cloneTask 且 cloneType=standard 的 VM 查询其 PVC 是否全部 Bound
        await Promise.all(
          data.map(async (row: any) => {
            const cloneAnno = row?.metadata?.annotations?.['tower.io/cloneTask'];
            if (!cloneAnno) return;
            let isStandardClone = false;
            try {
              const info = JSON.parse(cloneAnno);
              isStandardClone = info?.cloneType === 'standard';
            } catch {
              return;
            }
            if (!isStandardClone) return;
            const ns = row.namespace || '';
            const claims: string[] = Array.isArray(row.volumeClaims) ? row.volumeClaims : [];
            if (claims.length === 0) {
              row.clonePvcsReady = true;
              return;
            }
            row.clonePvcsReady = await checkClonePvcsBound(
              origin,
              cloud.secretKey || '',
              insecure,
              ns,
              claims,
            );
          }),
        );

        const capabilities = {
          isHarvester: true,
          supportsInstanceType: false,
          supportsZone: false,
          supportsVpc: false,
          supportsNetworkFusion: true,
          supportsMultus: true,
        };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询ECS失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/stop',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { force } = req.body;

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
          // STRICT: Do not implicitly add ns-{orgId}. Rely on UserSpace record.
          // if ((req.user as any).organizationId) {
          //   validNamespaces.push(`ns-${(req.user as any).organizationId}`);
          // }

          if (!validNamespaces.includes(namespace)) {
            return res.status(403).json({ message: '无权访问该命名空间资源' });
          }
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 操作', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        await harvesterStopVM(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          `${namespace}/${name}`,
          !!force,
        );

        res.json({ message: '已发送停止指令' });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '停止VM失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/start',
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
          // STRICT: Do not implicitly add ns-{orgId}. Rely on UserSpace record.
          // if ((req.user as any).organizationId) {
          //   validNamespaces.push(`ns-${(req.user as any).organizationId}`);
          // }

          if (!validNamespaces.includes(namespace)) {
            return res.status(403).json({ message: '无权访问该命名空间资源' });
          }
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 操作', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        await harvesterStartVM(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          `${namespace}/${name}`,
        );

        res.json({ message: '已发送启动指令' });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '启动VM失败', error: error.message });
      }
    },
  );

  /**
   * [POST] /:id/resources/harvester/vms
   * 创建虚拟机 (标准 Harvester API 路径)
   *
   * 实现原理：
   * - 通过 fetchCloudOr404 + ensureProvider 确认当前 Cloud 为 Harvester 类型
   * - 解析目标命名空间：
   *   - 优先读取 body.metadata.namespace（标准 K8s Manifest 写法）
   *   - 回退到 body.namespace 兼容旧调用方式
   * - 在租户模式下：
   *   - 要求权限 clouds.console:write
   *   - 使用 UserSpace.namespace + ns-{orgId} 构造允许访问的命名空间列表
   *   - 若目标 namespace 不在允许列表内则直接 403 拒绝
   * - 在构造 payload 时，强制将 metadata.namespace 修正为 targetNamespace，并移除根级别 namespace 字段
   * - 最终调用 createHarvesterVM 走 Harvester 官方 VM 创建 API
   */
  router.post(
    '/:id/resources/harvester/vms',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        // 确定目标命名空间
        // 优先级：Metadata (标准 Manifest) > Root (旧版/查询参数)
        // 严格模式：必须显式指定命名空间，禁止默认回退到 'default'
        const targetNamespace = req.body.metadata?.namespace || req.body.namespace;

        if (!targetNamespace) {
          return res
            .status(400)
            .json({ message: '参数错误：必须指定 namespace (在 metadata.namespace 或 namespace 字段中)' });
        }

        // 租户检查
        let tenantNamespace: string | undefined;
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({ message: 'Permission denied: Requires clouds.console:write' });

          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
          if ((req.user as any).organizationId) {
            where.organizationId = (req.user as any).organizationId;
          }
          const us = await userSpaceRepo.findOne({ where });
          if (!us) return res.status(403).json({ message: 'Access denied to this resource pool' });
          tenantNamespace = us.namespace;

          // 动态组织命名空间
          // STRICT: Do not implicitly add ns-{orgId}. Rely on UserSpace record.
          // if ((req.user as any).organizationId) {
          //   const orgNs = `ns-${(req.user as any).organizationId}`;
          //   tenantNamespace = tenantNamespace ? `${tenantNamespace},${orgNs}` : orgNs;
          // }
        }

        if (isTenant) {
          const allowed = tenantNamespace ? tenantNamespace.split(',').map((s) => s.trim()) : [];

          // 如果目标命名空间不被允许，直接拒绝
          if (!allowed.includes(targetNamespace)) {
            return res.status(403).json({
              message: `无权访问命名空间 '${targetNamespace}'。允许的范围: ${allowed.join(', ')}`,
            });
          }
        }

        // Payload 准备
        // 1. 确保 metadata.namespace 与 targetNamespace 一致
        // 如果它是类似 Manifest 的对象，必须正确设置 metadata.namespace。
        if (req.body.metadata) {
          req.body.metadata.namespace = targetNamespace;
        }

        // 2. 移除根级别的 'namespace' 以确保 Payload 纯净
        const payload = { ...req.body };
        delete payload.namespace;

        const data = await createHarvesterVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          targetNamespace,
          payload,
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '创建实例失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/templates/:namespace/:name/create-vm',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const body = req.body || {};
        const newVmName: string = String(body?.name || '').trim();
        const targetNamespace: string = String(body?.namespace || '').trim() || namespace;
        if (!newVmName) return res.status(400).json({ message: '缺少虚拟机名称' });

        let tenantNamespace: string | undefined;
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          const p = (req.user as any)?.permissions || [];
          if (!p.includes('clouds.console:write'))
            return res.status(403).json({ message: 'Permission denied: Requires clouds.console:write' });

          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
          if ((req.user as any).organizationId) {
            where.organizationId = (req.user as any).organizationId;
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
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 操作', next)) return;
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
        const body = error?.body ?? error;
        const reason = String(body?.reason || '').trim();
        const msg = String(body?.message || '').toLowerCase();

        if (status === 409 && (reason === 'AlreadyExists' || msg.includes('already exists'))) {
          const attemptedName = String((req as any)?.body?.name || '').trim();
          const attemptedNs =
            String((req as any)?.body?.namespace || '').trim() || String((req as any)?.params?.namespace || '').trim();
          return res.status(409).json({
            message: `虚拟机已存在：${attemptedNs}/${attemptedName}，请更换名称后重试`,
            error: body,
          });
        }

        res.status(status).json({ message: error?.message || '创建失败', error: body });
      }
    },
  );

  /**
   * [GET] /:id/resources/harvester/vms/:namespace/:name
   * 获取单个 VM 的原始 Manifest（直连 Harvester）
   *
   * 使用场景：
   * - 前端需要展示完整的 K8s/Harvester 原始字段（调试 / 高级信息）
   * - 某些需要透传 annotations/labels 的复杂场景
   *
   * 安全策略：
   * - 仅在当前用户为租户时执行命名空间白名单检查
   * - UserSpace.namespace + ns-{orgId} 共同组成允许访问范围
   */
  router.get(
    '/:id/resources/harvester/vms/:namespace/:name',
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

          // STRICT: Do not implicitly add ns-{orgId}. Rely on UserSpace record.
          // if ((req.user as any).organizationId) {
          //   validNamespaces.push(`ns-${(req.user as any).organizationId}`);
          // }

          if (!validNamespaces.includes(namespace)) {
            return res.status(403).json({ message: '无权访问该命名空间资源' });
          }
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
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

        res.json({ message: '查询成功', data: vm });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询VM详情失败', error: error.message });
      }
    },
  );

  /**
   * [POST] /:id/resources/harvester/vms/:namespace/:name/action
   * 执行 VM 操作（热插拔等）
   *
   * 支持的 action：
   * - addNic, removeNic, findHotunpluggableNics (网卡热插拔)
   * - addVolume, removeVolume (数据盘热插拔)
   * - cpuAndMemoryHotplug (CPU/内存热插拔)
   * - insertCdRomVolume, ejectCdRomVolume (CD-ROM热插拔)
   *
   * 安全策略：
   * - 仅在当前用户为租户时执行命名空间白名单检查
   * - UserSpace.namespace + ns-{orgId} 共同组成允许访问范围
   */
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/action',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { action } = req.query;

        if (!action || typeof action !== 'string') {
          return res.status(400).json({ message: 'Missing action parameter' });
        }

        // 租户权限检查
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
          if ((req.user as any).organizationId) {
            where.organizationId = (req.user as any).organizationId;
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
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作', next)) return;
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

        console.log(`[HarvesterVMAction] Proxying POST to: ${targetUrl}, action: ${action}`);

        // 转发请求到 Harvester API
        const data = await requestJson(
          'POST',
          targetUrl,
          cloud.secretKey || '',
          insecure,
          req.body, // 传递请求体
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
    },
  );

  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/save-as-template',
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

          // STRICT: Do not implicitly add ns-{orgId}. Rely on UserSpace record.
          // if ((req.user as any).organizationId) {
          //   validNamespaces.push(`ns-${(req.user as any).organizationId}`);
          // }

          if (!validNamespaces.includes(namespace)) {
            return res.status(403).json({ message: '无权访问该命名空间资源' });
          }
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 操作', next)) return;
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
            ownerReferences: [
              {
                apiVersion: 'harvesterhci.io/v1beta1',
                kind: 'VirtualMachineTemplate',
                name: resourceName,
                uid: createdTemplate.metadata.uid,
                blockOwnerDeletion: true,
                controller: true
              }
            ]
          },
          spec: {
            templateId: `${targetNamespace}/${resourceName}`,
            vm: {
              apiVersion: 'kubevirt.io/v1',
              kind: 'VirtualMachine',
              metadata: {
                name: vmName,
                namespace: targetNamespace,
                labels: vmTemplateMeta?.labels || undefined,
                annotations: vmTemplateMeta?.annotations || undefined,
              },
              spec: {
                template: {
                  metadata: {
                    labels: vmTemplateMeta?.labels || undefined,
                    annotations: vmTemplateMeta?.annotations || undefined,
                  },
                  spec: vmTemplateSpec,
                },
              }
            },
          },
        };

        // Handle VolumeClaimTemplates (sibling to template in VirtualMachineSpec)
        if (volumeClaimTemplates && volumeClaimTemplates.length > 0) {
          (versionPayload.spec.vm.spec as any).volumeClaimTemplates = volumeClaimTemplates;
        }

        // Clean up
        const templateSpec = versionPayload.spec.vm.spec.template.spec;
        
        // 1. Remove hostname to avoid conflict
        if (templateSpec.hostname) {
            delete templateSpec.hostname;
        }

        // 2. Clean up firmware UUID
        if (templateSpec.domain?.firmware?.uuid) {
            delete templateSpec.domain.firmware.uuid;
        }

        // 3. Remove MAC addresses
        if (templateSpec.domain?.devices?.interfaces) {
            templateSpec.domain.devices.interfaces.forEach((iface: any) => {
                if (iface.macAddress) delete iface.macAddress;
            });
        }

        if (!templateSpec.domain) templateSpec.domain = {};
        if (!templateSpec.domain.resources) templateSpec.domain.resources = {};
        if (!templateSpec.domain.resources.limits) templateSpec.domain.resources.limits = {};
        const existingCpuLimit = (templateSpec.domain.resources.limits as any)?.cpu;
        if (!existingCpuLimit) {
          const cpuFromRequests =
            (templateSpec.domain.resources.requests as any)?.cpu ||
            (vm.spec?.template?.spec?.domain?.resources?.requests as any)?.cpu;
          const cpuFromCores = vm.spec?.template?.spec?.domain?.cpu?.cores;
          (templateSpec.domain.resources.limits as any).cpu =
            cpuFromRequests || (cpuFromCores ? String(cpuFromCores) : '1');
        }

        await requestJson(
          'POST',
          versionUrl,
          cloud.secretKey || '',
          insecure,
          versionPayload,
        );

        const templateUrl = `${url}/${resourceName}`;
        const defaultVersionId = `${targetNamespace}/${versionName}`;

        const patchTemplateDefaultVersion = async () => {
          const body = { spec: { defaultVersionId } };
          for (let i = 0; i < 5; i++) {
            try {
              await requestJson('PATCH', templateUrl, cloud.secretKey || '', insecure, body, {
                'Content-Type': 'application/merge-patch+json',
              });
              return;
            } catch (e: any) {
              const st = Number(e?.status || 0);
              if (st === 409 && i < 4) {
                await new Promise((r) => setTimeout(r, 250));
                continue;
              }
              throw e;
            }
          }
        };

        const putTemplateDefaultVersion = async () => {
          for (let i = 0; i < 5; i++) {
            const latest = await requestJson('GET', templateUrl, cloud.secretKey || '', insecure);
            latest.spec = latest.spec || {};
            latest.spec.defaultVersionId = defaultVersionId;
            try {
              await requestJson('PUT', templateUrl, cloud.secretKey || '', insecure, latest);
              return;
            } catch (e: any) {
              const st = Number(e?.status || 0);
              if (st === 409 && i < 4) {
                await new Promise((r) => setTimeout(r, 250));
                continue;
              }
              throw e;
            }
          }
        };

        try {
          await patchTemplateDefaultVersion();
        } catch (e: any) {
          const st = Number(e?.status || 0);
          if (st === 405 || st === 415 || st === 400) {
            await putTemplateDefaultVersion();
          } else {
            throw e;
          }
        }

        const latestTemplate = await requestJson('GET', templateUrl, cloud.secretKey || '', insecure);

        try {
          const repo = AppDataSource.getRepository(HarvesterTemplateInventory);
          const uid = latestTemplate?.metadata?.uid || createdTemplate?.metadata?.uid || '';
          if (uid) {
            const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
            const payload = {
              cloudId: cloud.id,
              uid,
              name: latestTemplate?.metadata?.name || resourceName,
              namespace: latestTemplate?.metadata?.namespace || targetNamespace,
              description: latestTemplate?.spec?.description,
              defaultVersionId: latestTemplate?.spec?.defaultVersionId,
              labels: latestTemplate?.metadata?.labels,
              annotations: latestTemplate?.metadata?.annotations,
              rawData: latestTemplate,
            };
            if (existing) {
              Object.assign(existing, payload);
              await repo.save(existing);
            } else {
              const entity = repo.create(payload as any);
              await repo.save(entity);
            }
          }
        } catch (e: any) {
          console.error('[Template-SaveAs] 入库模板失败:', e?.message || e);
        }

        res.json({ message: '模板创建成功', data: latestTemplate });
      } catch (error: any) {
        if (res.headersSent) return;
        const status = Number(error?.status || 500);
        const body = error?.body ?? error?.message ?? String(error);
        res.status(status || 500).json({ message: '保存为模板失败', error: body });
      }
    },
  );

  /**
   * [GET] /:id/resources/ecs/stream
   * ECS 实时状态流 (Server-Sent Events)
   *
   * 事件模型：
   * - hello：连接成功的握手事件，payload { ok: true }
   * - vms：初始全量列表，payload { items: VM[] }
   * - vm_created：有新 VM 创建时推送完整 VM 对象
   * - vm_status：已有 VM 状态变化时推送精简状态（status/nodeName/ips）
   * - vm_deleted：VM 被删除时推送 { iid }，方便前端从列表中移除
   *
   * 实现原理：
   * - 首先通过 listKubevirtVMsRawWithMeta / listKubevirtVMIsRawWithMeta 拉取一次全量数据
   * - 在服务端内存中构建 vmCache/vmiCache，并推送一次 vms 事件作为初始状态
   * - 然后基于返回的 url + resourceVersion 启动 K8s watch 流：
   *   - VM 流：负责创建 / 删除 / 状态变更的主体（ADDED/MODIFIED/DELETED）
   *   - VMI 流：提供更实时的运行状态与 IP 信息，用于刷新 vm_status
   * - 所有事件在发送前会根据 allowedNamespace 做二次过滤，保证租户隔离
   *
   * 注意：
   * - 长连接通过 15 秒一次的 ping 注释行保持活跃，避免中间网络设备提前回收
   * - 连接关闭时会 abort 所有 watcher，避免后台 goroutine 泄漏
   */
  router.get(
    '/:id/resources/ecs/stream',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap'))) return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        let closed = false;

        const pingInterval = setInterval(() => {
          if (closed) {
            clearInterval(pingInterval);
            return;
          }
          try {
            res.write(': ping\n\n');
          } catch {}
        }, 15000);

        const watchers: any[] = [];
        req.on('close', () => {
          closed = true;
          try {
            clearInterval(pingInterval);
          } catch {}
          watchers.forEach((w) => w.abort());
        });

        let allowedNamespace: string | undefined;
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const userSpace = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!userSpace) {
            allowedNamespace = '__FORBIDDEN__';
          } else if (userSpace.namespace) {
            allowedNamespace = userSpace.namespace;
          }

          // STRICT: Do not implicitly add ns-{orgId}. Rely on UserSpace record.
          // if ((req.user as any).organizationId) {
          //   const orgNs = `ns-${(req.user as any).organizationId}`;
          //   allowedNamespace = allowedNamespace ? `${allowedNamespace},${orgNs}` : orgNs;
          // }
        }

        const send = (event: string, payload: any) => {
          if (closed) return;
          try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          } catch {}
        };

        const vmCache = new Map<string, any>();
        const vmiCache = new Map<string, any>();

        const resolveVMStatus = (vm: any, vmi: any) => {
          // [优先级1] 检查 VMI 的迁移状态（迁移状态优先级最高）
          // 迁移状态存储在 VMI 的 metadata.annotations['harvesterhci.io/migrationState'] 中
          // 也可能在 status.migrationState 中（不同版本可能不同）
          // 注意：如果 migrationState.completed 为 true，说明迁移已完成，不应该返回 'Migrating'
          const migrationState = vmi?.status?.migrationState;
          const migrationAnnotation = vmi?.metadata?.annotations?.['harvesterhci.io/migrationState'];
          
          // 检查是否真的在迁移中（排除已完成的迁移）
          if (migrationState) {
            // 如果 migrationState.completed 或 migrationState.Completed 为 true，说明迁移已完成，不应该显示为迁移中
            // 注意：JSON 中的字段名是小写的 "completed"，但代码中可能有大写的情况
            const isCompleted = migrationState.completed === true || migrationState.Completed === true;
            if (!isCompleted) {
              return 'Migrating';
            }
          } else if (migrationAnnotation) {
            // 如果只有注解但没有 migrationState，也认为在迁移中
            return 'Migrating';
          }
          
          if (vm?.metadata?.deletionTimestamp) return 'Terminating';
          if (vmi?.status?.phase === 'Running') return 'Running';
          return vm?.status?.printableStatus || vm?.status?.phase || 'Unknown';
        };

        const sendItem = (key: string, eventType: 'vm_created' | 'vm_status' = 'vm_status') => {
          const vm = vmCache.get(key);
          if (!vm) return;
          const vmi = vmiCache.get(key);

          const printableStatus = resolveVMStatus(vm, vmi);

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
            status: {
              ...vm.status,
              printableStatus,
            },
          };

          if (eventType === 'vm_created') {
            send('vm_created', { item });
          } else {
            const status = String(printableStatus);
            const nodeName = vmi?.status?.nodeName || vm.status?.nodeName || '';
            const ips: string[] = [];
            if (vm?.status?.vmIp) ips.push(vm.status.vmIp);
            if (Array.isArray(vm?.status?.interfaces)) {
              vm.status.interfaces.forEach((i: any) => {
                if (i.ipAddress) ips.push(i.ipAddress);
              });
            }
            if (vmi?.status?.interfaces) {
              vmi.status.interfaces.forEach((i: any) => {
                if (i.ipAddress) ips.push(i.ipAddress);
                if (Array.isArray(i.ipAddresses)) ips.push(...i.ipAddresses);
              });
            }

            send('vm_status', {
              iid: item.id,
              status,
              nodeName,
              ips: Array.from(new Set(ips)),
            });
          }
        };

        const init = async () => {
          try {
            const [vmsResult, vmisResult] = await Promise.all([
              listKubevirtVMsRawWithMeta({
                endpoint: cloud.endpoint,
                token: cloud.secretKey || '',
                insecure,
              } as any),
              listKubevirtVMIsRawWithMeta({
                endpoint: cloud.endpoint,
                token: cloud.secretKey || '',
                insecure,
              } as any),
            ]);

            const initialItems: any[] = [];
            const vmsRaw = vmsResult?.items || [];
            const vmisRaw = vmisResult?.items || [];

            if (Array.isArray(vmsRaw)) {
              vmsRaw.forEach((vm: any) => {
                if (allowedNamespace) {
                  if (allowedNamespace === '__FORBIDDEN__') return;
                  if (vm.metadata?.namespace !== allowedNamespace) return;
                }
                const key = `${vm.metadata?.namespace}/${vm.metadata?.name}`;
                vmCache.set(key, vm);
              });
            }
            if (Array.isArray(vmisRaw)) {
              vmisRaw.forEach((vmi: any) => {
                if (allowedNamespace) {
                  if (allowedNamespace === '__FORBIDDEN__') return;
                  if (vmi.metadata?.namespace !== allowedNamespace) return;
                }
                const key = `${vmi.metadata?.namespace}/${vmi.metadata?.name}`;
                vmiCache.set(key, vmi);
              });
            }

            for (const key of vmCache.keys()) {
              const vm = vmCache.get(key);
              const vmi = vmiCache.get(key);
              const printableStatus = resolveVMStatus(vm, vmi);

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
                status: { ...vm.status, printableStatus },
              });
            }
            send('vms', { items: initialItems });

            if (vmsResult?.url) {
              const vmRv = vmsResult.resourceVersion || '0';
              const vmUrl = `${vmsResult.url}?watch=true&resourceVersion=${vmRv}`;
              const w1 = watchJsonStream(
                vmUrl,
                cloud.secretKey || '',
                insecure,
                (event) => {
                  if (closed) return;
                  const obj = event.object;
                  if (!obj || !obj.metadata) return;

                  if (allowedNamespace) {
                    if (allowedNamespace === '__FORBIDDEN__') return;
                    if (obj.metadata.namespace !== allowedNamespace) return;
                  }

                  const key = `${obj.metadata.namespace}/${obj.metadata.name}`;
                  if (event.type === 'DELETED') {
                    vmCache.delete(key);
                    send('vm_deleted', { iid: obj.metadata.uid });
                  } else {
                    vmCache.set(key, obj);
                    const eventType = event.type === 'ADDED' ? 'vm_created' : 'vm_status';
                    sendItem(key, eventType);
                  }
                },
                (err) => {
                  logVmWatchStreamError('vm', err);
                  // Notify client and close connection to force reconnect
                  send('stream_error', {
                    message: '虚拟机列表监听流异常',
                    cause: err?.message,
                  });
                  try { res.end(); } catch {}
                },
              );
              watchers.push(w1);
            }

            if (vmisResult?.url) {
              const vmiRv = vmisResult.resourceVersion || '0';
              const vmiUrl = `${vmisResult.url}?watch=true&resourceVersion=${vmiRv}`;
              const w2 = watchJsonStream(
                vmiUrl,
                cloud.secretKey || '',
                insecure,
                (event) => {
                  if (closed) return;
                  const obj = event.object;
                  if (!obj || !obj.metadata) return;
                  if (allowedNamespace) {
                    if (allowedNamespace === '__FORBIDDEN__') return;
                    if (obj.metadata.namespace !== allowedNamespace) return;
                  }
                  const key = `${obj.metadata.namespace}/${obj.metadata.name}`;
                  if (event.type === 'DELETED') {
                    vmiCache.delete(key);
                    if (vmCache.has(key)) sendItem(key);
                  } else {
                    vmiCache.set(key, obj);
                    if (vmCache.has(key)) sendItem(key);
                  }
                },
                (err) => {
                  logVmWatchStreamError('vmi', err);
                  // Notify client and close connection to force reconnect
                  send('stream_error', {
                    message: '实例（VMI）监听流异常',
                    cause: err?.message,
                  });
                  try { res.end(); } catch {}
                },
              );
              watchers.push(w2);
            }
          } catch (e: any) {
            console.error('[虚拟机 SSE] 初始化失败:', e);
            send('stream_error', { message: '实时流初始化失败', cause: e?.message });
            try { res.end(); } catch {}
          }
        };

        send('hello', { ok: true });
        init();
      } catch (error: any) {
        try {
          res.status(500).end();
        } catch {}
      }
    },
  );

  /**
   * [GET] /:id/resources/ecs/:instanceId/vnc
   * 获取虚拟机 VNC Console URL
   *
   * 说明：
   * - instanceId 既可以是 "namespace/name" 形式，也可以是单独的 name
   *   - 单独 name 时自动回退 namespace=default
   * - 通过 getHarvesterVmVncUrl 封装了 Harvester 的 VNC token 创建与 URL 拼装逻辑
   * - 仅在 provider 为 harvester/cloudmap 时才处理，请求会优雅地向后续中间件透传
   */
  router.get(
    '/:id/resources/ecs/:instanceId/vnc',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap'))) return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const [namespace, name] = instanceId.includes('/') ? instanceId.split('/') : ['default', instanceId];

        const url = await getHarvesterVmVncUrl(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
        );
        res.json({ message: '获取成功', data: { url } });
      } catch (error: any) {
        res.status(500).json({ message: '获取VNC地址失败', error: error.message });
      }
    },
  );

  /**
   * [POST] /:id/resources/ecs/:instanceId/start
   * 启动虚拟机
   *
   * 说明：
   * - 直接调用 harvesterStartVM，底层走 Harvester 的 VM Start 操作
   * - instanceId 统一复用前端列表中的 ID（通常为 "namespace/name"）
   * - 不做额外的状态判断，由 Harvester 后端保证幂等性与错误提示
   */
  router.post(
    '/:id/resources/ecs/:instanceId/start',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap'))) return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterStartVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
        );
        res.json({ message: '启动成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '启动实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] /:id/resources/ecs/:instanceId/stop
   * 停止虚拟机
   *
   * 参数：
   * - body.force: boolean，是否强制关机（类似硬关电源）
   */
  router.post(
    '/:id/resources/ecs/:instanceId/stop',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap'))) return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterStopVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          !!force,
        );
        res.json({ message: '停止成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '停止实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] /:id/resources/ecs/:instanceId/reboot
   * 重启虚拟机
   *
   * 参数：
   * - body.force: boolean，是否强制重启
   */
  router.post(
    '/:id/resources/ecs/:instanceId/reboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap'))) return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterRebootVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          !!force,
        );
        res.json({ message: '重启成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '重启实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] /:id/resources/ecs/:instanceId/softreboot
   * 软重启虚拟机（优先尝试在 Guest OS 内部触发重启）
   */
  router.post(
    '/:id/resources/ecs/:instanceId/softreboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap'))) return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterSoftRebootVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
        );
        res.json({ message: '软重启成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '软重启实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] /:id/resources/ecs/:instanceId/pause
   * 暂停虚拟机（KubeVirt Pause）
   */
  router.post(
    '/:id/resources/ecs/:instanceId/pause',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap'))) return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterPauseVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
        );
        res.json({ message: '暂停成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '暂停实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] /:id/resources/ecs/:instanceId/unpause
   * 恢复虚拟机（KubeVirt Unpause）
   */
  router.post(
    '/:id/resources/ecs/:instanceId/unpause',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap'))) return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterUnpauseVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
        );
        res.json({ message: '恢复成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '恢复实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [DELETE] /:id/resources/ecs/:instanceId
   * 删除虚拟机
   *
   * 参数：
   * - query.deleteImage: 是否同时删除关联镜像（取决于平台策略，默认 false）
   * - query.deleteVolumes: 是否同时删除挂载的数据卷
   *
   * 说明：
   * - 具体删除策略由 harvesterDeleteVM 实现，支持多步安全删除流程
   */
  router.delete(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { deleteImage, deleteVolumes } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap'))) return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterDeleteVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          String(deleteImage) === 'true',
          String(deleteVolumes) === 'true',
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '删除实例失败', error: error.body || error.message });
      }
    },
  );
};
