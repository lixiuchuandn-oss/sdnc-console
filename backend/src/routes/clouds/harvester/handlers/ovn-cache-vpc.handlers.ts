/**
 * Harvester VPC Handlers
 * 
 * 从 harvester.cache.network.routes.ts 中提取的 VPC 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubeOvnVpcInventory } from '../../../../entities/kubeovn/KubeOvnVpcInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncKubeOvnVpcs } from '../../../../services/clouds/harvester/inventory';
import { createKubeOvnVpc, deleteKubeOvnVpc, updateKubeOvnVpc } from '../../../../services/clouds/harvester/client';
import { licenseService } from '../../../../services/LicenseService';
import { checkTenantAccess } from '../harvester.direct.helpers';

/**
 * GET /:id/resources/vpcs - 获取 VPC 列表
 */
export async function harvesterVpcListHandler(req: Request, res: Response) {
  try {
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

    // [租户过滤] Kube-OVN 资源权限校验
    // 检查 VPC 的 spec.namespaces 字段是否包含租户的命名空间，或是否为公共资源 (cloud-public)。
    if (isTenant) {
      const userNamespaces = tenantNamespace ? tenantNamespace.split(',').map((n) => n.trim()) : [];
      list = list.filter((vpc: any) => {
        const allowed = vpc?.spec?.namespaces || [];
        if (!Array.isArray(allowed)) return false;
        const isAllowed = userNamespaces.some((ns) => allowed.includes(ns));
        const isPublic = allowed.some(
          (n: string) => String(n).toLowerCase() === 'cloud-public',
        );
        return isAllowed || isPublic;
      });
    }

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询VPC失败', error: error.message });
  }
}

/**
 * POST /:id/resources/vpcs - 创建 VPC
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
 * DELETE /:id/resources/vpcs/:name - 删除 VPC
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
 * PUT /:id/resources/vpcs/:name - 更新 VPC
 */
export async function harvesterVpcUpdateHandler(req: Request, res: Response) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }

    const cloud = (req as any).cloud;
    const { name } = req.params;
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
