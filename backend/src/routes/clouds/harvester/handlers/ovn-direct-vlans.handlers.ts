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
import { KubeOvnSubnetInventory } from '../../../../entities/kubeovn/KubeOvnSubnetInventory';
import { KubeOvnVlanInventory } from '../../../../entities/kubeovn/KubeOvnVlanInventory';
import { syncKubeOvnVlans } from '../../../../services/clouds/harvester/inventory';

const ALIAS_KEYS_SUBNET = ['tower.io/alias', 'tower.io/alies'];

function getAnnotationAlias(annotations: any, keys: string[]): string {
  if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) return '';
  for (const k of keys) {
    const v = String((annotations as any)?.[k] ?? '').trim();
    if (v) return v;
  }
  return '';
}

function getDisplayNameFromAnnotations(name: string, annotations: any, keys: string[]): string {
  const alias = getAnnotationAlias(annotations, keys);
  return alias || name;
}

/**
 * GET /:id/resources/vlans - 获取 VLAN 列表
 */
export async function harvesterVlanListHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
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

    const { name, id: vlanId, provider, annotations } = req.body;
    if (!name || String(name).trim() === '') {
      res.status(400).json({ message: '缺少必要参数: name' });
      return;
    }
    const metadata: Record<string, unknown> = { name: String(name).trim() };
    if (
      annotations &&
      typeof annotations === 'object' &&
      !Array.isArray(annotations)
    ) {
      metadata.annotations = annotations;
    }

    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'Vlan',
      metadata,
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

/**
 * DELETE /:id/resources/vlans/:name - 删除 VLAN（Kube-OVN Vlan CR）
 */
export async function harvesterVlanDeleteHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
    const { id, name } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester', next)) return;

    const nameStr = String(name || '').trim();
    if (!nameStr) {
      return res.status(400).json({ message: '缺少 VLAN 名称' });
    }

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const subnetRepo = AppDataSource.getRepository(KubeOvnSubnetInventory);
    const subnets = await subnetRepo.find({ where: { cloudId: id } });
    const usingSubnets = subnets.filter((s) => {
      const v = s.rawData?.spec?.vlan;
      return String(v || '').trim() === nameStr;
    });
    if (usingSubnets.length > 0) {
      const names = usingSubnets.map((s) => s.name).filter(Boolean);
      const displayNames = usingSubnets
        .map((s) => {
          const ann = s.annotations ?? s.rawData?.metadata?.annotations;
          return getDisplayNameFromAnnotations(String(s.name || '').trim(), ann, ALIAS_KEYS_SUBNET);
        })
        .filter(Boolean);
      return res.status(409).json({
        message: `无法删除 VLAN：仍被子网引用：${displayNames.join('、')}`,
        code: 'VLAN_IN_USE_BY_SUBNETS',
        subnets: names,
        subnetsDisplay: displayNames,
      });
    }

    const url = `${origin}/apis/kubeovn.io/v1/vlans/${encodeURIComponent(nameStr)}`;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    await requestJson('DELETE', url, cloud.secretKey || '', insecure);

    try {
      const repo = AppDataSource.getRepository(KubeOvnVlanInventory);
      await repo.delete({ cloudId: id, name: nameStr });
    } catch (e: any) {
      console.warn('[Vlan-Delete] 本地库存删除失败（集群已删）:', e?.message || e);
    }

    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除 VLAN 失败', error: error.message });
  }
}
