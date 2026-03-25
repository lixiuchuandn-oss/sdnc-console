/**
 * Harvester Subnets Handlers
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubeOvnSubnetInventory } from '../../../../entities/kubeovn/KubeOvnSubnetInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncKubeOvnSubnets } from '../../../../services/clouds/harvester/inventory';
export async function harvesterSubnetListHandler(req: Request, res: Response) {
  try {
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
      const userNamespaces = tenantNamespace ? tenantNamespace.split(',').map((n) => n.trim()) : [];
      list = list.filter((subnet: any) => {
        const allowed = subnet?.spec?.namespaces || [];
        return Array.isArray(allowed) && userNamespaces.some((ns) => allowed.includes(ns));
      });
    }

    let items = list;
    if (vpcId) {
      items = list.filter(
        (s: any) => String(s?.vpc || '').trim() === String(vpcId).trim(),
      );
    }
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询子网失败', error: error.message });
  }
}
