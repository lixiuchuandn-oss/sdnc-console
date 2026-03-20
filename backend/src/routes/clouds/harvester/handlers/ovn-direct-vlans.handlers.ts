/**
 * OVN VLANs Handlers (Direct Route)
 *
 * 从 harvester.direct.network.routes.ts 中提取的 VLANs 相关业务逻辑
 * 直连路由：直接操作 Kube-OVN VLAN CRD
 */

import { Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { requestJson } from '../../../../services/clouds/harvester/utils';
import { checkTenantAccess, fetchCloudOr404, ensureProvider } from '../harvester.direct.helpers';
import { licenseService } from '../../../../services/LicenseService';
import { KubeOvnVlanInventory } from '../../../../entities/kubeovn/KubeOvnVlanInventory';
import { syncKubeOvnVlans } from '../../../../services/clouds/harvester/inventory';

/**
 * GET /:id/resources/vlans - 获取 VLAN 列表
 */
export async function harvesterVlanListHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const { force, skipSync } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const repo = AppDataSource.getRepository(KubeOvnVlanInventory);
    const count = await repo.count({ where: { cloudId: id } });

    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      await syncKubeOvnVlans(cloud, insecure);
    } else if (String(skipSync) === 'true') {
      console.log(`[Vlan-Refresh] 跳过全量同步（创建后刷新），直接查询数据库`);
    }

    const items = await repo.find({ where: { cloudId: id } });
    const list = items.map((item) => item.rawData || {
      metadata: {
        name: item.name,
        uid: item.uid,
        labels: item.labels,
        annotations: item.annotations,
      },
      spec: {
        id: item.vlanId,
        provider: item.provider,
        providerInterfaceName: item.providerInterfaceName,
      },
      status: {
        subnets: item.subnets,
        conflict: item.conflict,
      },
    });

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询 VLANs 失败', error: error.message });
  }
}

/**
 * POST /:id/resources/vlans - 创建 VLAN
 */
export async function harvesterVlanCreateHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const { name, id: vlanId, provider } = req.body;
    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'Vlan',
      metadata: { name },
      spec: {
        id: parseInt(vlanId, 10),
        provider,
      },
    };

    const url = `${origin}/apis/kubeovn.io/v1/vlans`;
    const json = await requestJson(
      'POST',
      url,
      cloud.secretKey || '',
      !!(cloud.config as any)?.ignoreTls,
      payload,
    );

    if (json && json.metadata) {
      try {
        const repo = AppDataSource.getRepository(KubeOvnVlanInventory);
        const entity = repo.create({
          cloudId: cloud.id,
          uid: json.metadata?.uid || '',
          name: json.metadata?.name || '',
          vlanId: json.spec?.id || json.spec?.vlanId,
          provider: json.spec?.provider,
          providerInterfaceName: json.spec?.providerInterfaceName,
          subnets: json.status?.subnets,
          conflict: json.status?.conflict,
          labels: json.metadata?.labels,
          annotations: json.metadata?.annotations,
          rawData: json,
        });
        await repo.save(entity);
      } catch (e: any) {
        console.error('[Vlan-Create] 入库失败:', e?.message || e);
      }
    }

    res.json({ message: '创建成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '创建 VLAN 失败', error: error.message });
  }
}
