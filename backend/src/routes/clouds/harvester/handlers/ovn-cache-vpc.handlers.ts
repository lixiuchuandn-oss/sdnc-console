/**
 * Harvester VPC Handlers（缓存：GET/POST/DELETE/PUT /:id/resources/vpcs...）
 *
 * -----------------------------------------------------------------------------
 * 与「公共子网 / 扁平子网 / VPC 子网」相关的授权说明（本模块与子网的关系）
 * -----------------------------------------------------------------------------
 *
 * Kube-OVN 中业务 VPC 与内置 VPC 并存：
 *   - 用户业务 VPC：虚拟专有云能力，对应产品「VPC 子网」所在 VPC。
 *   - 内置 `ovn-cluster`：承载**公共子网**（subnet-type=public）。
 *   - 内置 `ovn-internal`：承载**扁平子网**（subnet-type=flat）的常见挂载；与公共子网分域。
 *   扁平子网在 Tower 中的**两类**指：是否配置 **VLAN**（`spec.vlan` 有值 = 挂 VLAN 接物理侧；无值 = 不挂 VLAN、纯 overlay），与授权解耦说明见 License（不含扁平/公共子网）。
 *
 * 【路由层 RBAC】
 * 本组接口挂载 `createApiPermissionMiddleware()`（见 `permissions/middleware.ts` + `permissions/registry.ts`）。
 *   - GET `/resources/vpcs`  → `clouds.vpcs:read`
 *   - POST/DELETE/PUT 其它名 → `clouds.vpcs:write`
 *   - PUT `/resources/vpcs/ovn-internal` 为特例：除 `clouds.vpcs:write` 外，还接受 `clouds.subnets.public:write`、
 *     `clouds.subnets:write`、`clouds:write`（与公共子网联动改 `enableExternal` / `nextHopIP` 对齐）。
 *
 * 【许可证 network.ovn.vpc】
 *   - 列表 / 创建 / 删除 / 更新「业务 VPC」：一律校验 `network.ovn.vpc` 未启用则 403。
 *   - 仅 PUT 更新内置 VPC：`ovn-internal`、`ovn-cluster`、`ovn-provider` **不**要求该许可证（与公共/扁平 underlay 联动一致）。
 * 子网清单接口（`ovn-cache-subnets.handlers.ts`）不在此做许可证校验。
 *
 * 【租户过滤】
 * GET 列表对租户按 `spec.namespaces` 与租户命名空间交集过滤；允许绑定在 tower.io/scenario=public 的命名空间上的 VPC 对租户可见。
 *
 * 【默认列表范围】
 * 由查询参数 **`ovnNetworkScope`**（必填）控制：`vpc` / `underlay` / `all`，见 `kubeOvnNetworkScope.ts` 与
 * `deployment/docs/specs/api/Harvester-OVN-网络接口分域规范.md`。
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubeOvnVpcInventory } from '../../../../entities/kubeovn/KubeOvnVpcInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncKubeOvnVpcs } from '../../../../services/clouds/harvester/inventory';
import { createKubeOvnVpc, deleteKubeOvnVpc, updateKubeOvnVpc } from '../../../../services/clouds/harvester/client';
import { licenseService } from '../../../../services/LicenseService';
import { checkTenantAccess } from '../harvester.direct.helpers';
import {
  getPublicScenarioNamespaceNames,
  mergePublicScenarioNamespacesFromQuery,
} from '../../../../services/clouds/harvester/publicNamespaces';
import {
  ovnNetworkScopeFromAnnotations,
  parseRequiredOvnNetworkScopeListQuery,
} from '../../../../services/clouds/harvester/kubeOvnNetworkScope';

/**
 * GET /:id/resources/vpcs — 获取 VPC 列表（Inventory）。
 * 需 `network.ovn.vpc` + `clouds.vpcs:read`（RBAC 由路由中间件保证）。
 */
export async function harvesterVpcListHandler(req: Request, res: Response) {
  try {
    const query = { ...(req.query as Record<string, unknown>) };
    if (!String(query.ovnNetworkScope ?? '').trim()) {
      query.ovnNetworkScope = 'vpc';
    }
    const parsedScope = parseRequiredOvnNetworkScopeListQuery({ query });
    if (!parsedScope.ok) {
      return res.status(parsedScope.status).json({ message: parsedScope.message });
    }

    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }

    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force, skipSync } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(KubeOvnVpcInventory);

    let whereCondition: any = { cloudId: id };
    let tenantNamespace: string | undefined;
    const reqAny = req as any;
    const isTenantUser =
      reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device';
    const isTenantRole = reqAny.user?.role === 'tenant';
    const isTenant = isTenantUser || isTenantRole;

    // [租户上下文] 获取租户的授权命名空间
    if (isTenant) {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const where: any = {
        tenantId: reqAny.user.tenantId,
        cloudId: id,
        status: 'active',
      };
      if (reqAny.user.organizationId) {
        where.organizationId = reqAny.user.organizationId;
      }
      const us = await userSpaceRepo.findOne({ where });
      if (!us) return res.json({ message: '查询成功', data: { items: [] } });
      tenantNamespace = us.namespace;

      // Auto-Fix: Ensure organization namespace is included in UserSpace
      if (reqAny.user.organizationId) {
        const orgNs = `ns-${reqAny.user.organizationId}`;
        const nsList = tenantNamespace ? tenantNamespace.split(',').map((s) => s.trim()).filter(Boolean) : [];
        if (!nsList.includes(orgNs)) {
          nsList.push(orgNs);
          tenantNamespace = nsList.join(',');
          us.namespace = tenantNamespace;
          try {
            await userSpaceRepo.save(us);
          } catch (e) {
            console.warn('Failed to auto-update UserSpace namespace', e);
          }
        }
      }
    }

    const count = await repo.count({ where: whereCondition });

    // 如果数据库为空或强制刷新且未跳过同步，则进行全量同步
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      try {
        await syncKubeOvnVpcs(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync VPCs failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    } else if (String(skipSync) === 'true') {
      console.log(`[VPC-Refresh] 跳过全量同步（创建后刷新），直接查询数据库`);
    }

    const items = await repo.find({ where: whereCondition });
    let list = items.map((i: any) => ({
      ...(i.rawData || {}),
      view: i.view,
    }));

    // [租户过滤] Kube-OVN 资源权限校验；mergePublicScenarioNamespaces=false 时不放宽「公共场景」VPC
    if (isTenant) {
      const userNamespaces = tenantNamespace ? tenantNamespace.split(',').map((n) => n.trim()) : [];
      const mergePublic = mergePublicScenarioNamespacesFromQuery(req);
      if (mergePublic) {
        const publicNameSet = new Set(await getPublicScenarioNamespaceNames(id));
        list = list.filter((vpc: any) => {
          const allowed = vpc?.spec?.namespaces || [];
          if (!Array.isArray(allowed)) return false;
          const isAllowed = userNamespaces.some((ns) => allowed.includes(ns));
          const isPublic = allowed.some((n: string) => publicNameSet.has(String(n).trim()));
          return isAllowed || isPublic;
        });
      } else {
        list = list.filter((vpc: any) => {
          const allowed = vpc?.spec?.namespaces || [];
          if (!Array.isArray(allowed)) return false;
          return userNamespaces.some((ns) => allowed.includes(ns));
        });
      }
    }

    const scopeQ = parsedScope.scope;
    if (scopeQ === 'vpc') {
      list = list.filter((vpc: any) => ovnNetworkScopeFromAnnotations(vpc) === 'vpc');
    } else if (scopeQ === 'underlay') {
      list = list.filter((vpc: any) => ovnNetworkScopeFromAnnotations(vpc) === 'underlay');
    }
    // scopeQ === 'all'：不分域

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询VPC失败', error: error.message });
  }
}

/**
 * POST /:id/resources/vpcs — 创建业务 VPC。
 * 需 `network.ovn.vpc`；另经 `checkTenantAccess` 校验资源池访问。
 */
export async function harvesterVpcCreateHandler(req: Request, res: Response) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }

    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) {
      return res.status(403).json({ message: 'Access denied to this resource pool' });
    }

    const cloud = (req as any).cloud;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await createKubeOvnVpc(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      req.body
    );

    // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法）
    if (data && data.metadata) {
      try {
        const repo = AppDataSource.getRepository(KubeOvnVpcInventory);
        const entity = repo.create({
          cloudId: cloud.id,
          uid: data.metadata?.uid || '',
          name: data.metadata?.name || '',
          namespace: data.metadata?.namespace,
          status: data.status?.conditions?.[0]?.type || 'Unknown',
          subnets: data.status?.subnets,
          labels: data.metadata?.labels,
          annotations: data.metadata?.annotations,
          rawData: data,
        });
        await repo.save(entity);
      } catch (e: any) {
        console.error('[VPC-Create] 入库失败:', e?.message || e);
      }
    }

    res.json({ message: '创建成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '创建 VPC 失败', error: error.message });
  }
}

/**
 * DELETE /:id/resources/vpcs/:name — 删除 VPC（含业务 VPC；内置 VPC 删除需集群侧约束）。
 * 需 `network.ovn.vpc`。
 */
export async function harvesterVpcDeleteHandler(req: Request, res: Response) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }

    const cloud = (req as any).cloud;
    const { name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    await deleteKubeOvnVpc(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      name
    );

    // 从数据库删除
    const repo = AppDataSource.getRepository(KubeOvnVpcInventory);
    await repo.delete({ cloudId: cloud.id, name });

    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除 VPC 失败', error: error.message });
  }
}

/**
 * PUT /:id/resources/vpcs/:name — 更新 VPC。
 * 许可证：`ovn-internal` / `ovn-cluster` / `ovn-provider` 豁免 `network.ovn.vpc`；其余名称必须已开通该功能。
 * RBAC：PUT `ovn-internal` 时中间件额外接受公共子网写权限（见 `permissions/middleware.ts`）。
 */
export async function harvesterVpcUpdateHandler(req: Request, res: Response) {
  try {
    const { name } = req.params;
    const nameTrim = String(name || '').trim();
    // 内置 ovn-internal / ovn-cluster / ovn-provider 与 underlay、公共子网等联动，不占用「虚拟专有云」授权
    const isBuiltinVpcExemptFromVpcLicense =
      nameTrim === 'ovn-internal' || nameTrim === 'ovn-cluster' || nameTrim === 'ovn-provider';
    if (!isBuiltinVpcExemptFromVpcLicense && !licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }

    const cloud = (req as any).cloud;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await updateKubeOvnVpc(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      name,
      req.body
    );

    res.json({ message: '更新成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '更新 VPC 失败', error: error.message });
  }
}
