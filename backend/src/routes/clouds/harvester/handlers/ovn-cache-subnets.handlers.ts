/**
 * Harvester Subnets Handlers（缓存清单：GET /:id/resources/subnets）
 *
 * -----------------------------------------------------------------------------
 * 与「公共子网 / 扁平子网 / VPC 子网」相关的授权说明（本文件职责边界）
 * -----------------------------------------------------------------------------
 *
 * 集群侧均为 kubeovn.io/v1 Subnet CR，靠注解 `tower.io/subnet-type` 区分逻辑类型：
 *   - public  → 公共子网（挂在内置 `ovn-cluster`）
 *   - flat    → 扁平子网（`tower.io/subnet-type=flat`；是否挂 VLAN 另用
 *        `tower.io/subnet-type-flat-underlay` / `tower.io/subnet-type-flat-overlay` 标记，二者互斥）：
 *        （1）有 `spec.vlan` — underlay，物理 VLAN 上行；
 *        （2）无 `spec.vlan` — overlay，纯 OVN 与同 VPC 互通。
 *   - vpc     → VPC 子网（挂在用户业务 VPC，非上述内置 VPC）
 *
 * 【路由层 RBAC】
 * 本接口挂载 `createApiPermissionMiddleware()`（见 `permissions/middleware.ts`）。
 * GET 映射为 `clouds.subnets:read`，并允许以下任一满足即通过：
 *   `clouds.subnets.vpc:read` | `clouds.subnets.flat:read` | `clouds.subnets.public:read`
 *   | `clouds.vpcs:read`（兼容旧角色）
 * 即：读权限按「子网总权 + 分域 + VPC 读」做并集，不在本 handler 内再按 subnet-type 细分。
 *
 * 【许可证 License】
 * 本 handler **不**校验 `network.ovn.vpc`。未开通虚拟专有云授权时，仍可拉取子网缓存（与 VPC 列表 handler 不同），
 * 前端再按注解过滤出公共/扁平/VPC 子网视图。
 *
 * 【本 handler 内租户过滤】
 * 租户用户：返回 `spec.namespaces` 与「租户授权命名空间」有交集的 Subnet；当 `mergePublicScenarioNamespaces=true`（默认，兼容旧客户端）
 * 时并入 `tower.io/scenario=public` 命名空间后再求交集（扁平子网控制台显式传 true）。
 * 若需空列表，上游 UserSpace 未命中时直接返回 `items: []`。
 *
 * 【写操作 / 直连 CRUD】
 * Subnet 的创建、更新、删除走直连路由与 `ovn-direct-subnets.handlers.ts`，不在本文件。
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubeOvnSubnetInventory } from '../../../../entities/kubeovn/KubeOvnSubnetInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncKubeOvnSubnets } from '../../../../services/clouds/harvester/inventory';
import {
  filterItemsByOvnNetworkScopeForApi,
  parseRequiredOvnNetworkScopeListQuery,
} from '../../../../services/clouds/harvester/kubeOvnNetworkScope';
import {
  getPublicScenarioNamespaceNames,
  mergePublicScenarioNamespacesFromQuery,
} from '../../../../services/clouds/harvester/publicNamespaces';

/**
 * GET /:id/resources/subnets — 子网 Inventory 列表（含同步逻辑）。
 * 权限与许可证见文件头；`vpcId` query 仅做结果过滤，不改变授权语义。
 */
export async function harvesterSubnetListHandler(req: Request, res: Response) {
  try {
    const parsedScope = parseRequiredOvnNetworkScopeListQuery(req);
    if (!parsedScope.ok) {
      return res.status(parsedScope.status).json({ message: parsedScope.message });
    }

    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { vpcId, force } = req.query as any;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(KubeOvnSubnetInventory);
    const reqAny = req as any;

    let whereCondition: any = { cloudId: id };
    let tenantNamespace: string | undefined;
    const isTenantUser = reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device';
    const isTenantRole = reqAny.user?.role === 'tenant';
    const isTenant = isTenantUser || isTenantRole;

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

    if (count === 0 || String(force) === 'true') {
      try {
        await syncKubeOvnSubnets(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync Subnets failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    }

    const dbItems = await repo.find({ where: whereCondition });
    let list = dbItems.map((i) => i.rawData);

    if (isTenant) {
      let userNamespaces = tenantNamespace ? tenantNamespace.split(',').map((n) => n.trim()) : [];
      if (mergePublicScenarioNamespacesFromQuery(req)) {
        const pub = await getPublicScenarioNamespaceNames(id);
        userNamespaces = Array.from(new Set([...userNamespaces, ...pub]));
      }
      list = list.filter((subnet: any) => {
        const allowed = subnet?.spec?.namespaces || [];
        return Array.isArray(allowed) && userNamespaces.some((ns) => allowed.includes(ns));
      });
    }

    let items = list;
    const scopeQ = parsedScope.scope;
    if (scopeQ === 'vpc') {
      items = filterItemsByOvnNetworkScopeForApi(items, 'vpc');
    } else if (scopeQ === 'underlay') {
      items = filterItemsByOvnNetworkScopeForApi(items, 'underlay');
    }
    // scopeQ === 'all'：不分域

    if (vpcId) {
      items = items.filter(
        (s: any) => String(s?.spec?.vpc ?? s?.vpc ?? '').trim() === String(vpcId).trim(),
      );
    }
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询子网失败', error: error.message });
  }
}
