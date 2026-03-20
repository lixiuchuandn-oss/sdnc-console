import { Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  isNamespaceAllowed,
} from '../harvester.direct.helpers';
import { licenseService } from '../../../../services/LicenseService';
import { KubeOvnNatRuleInventory } from '../../../../entities/kubeovn/KubeOvnNatRuleInventory';
import { syncKubeOvnNatRules } from '../../../../services/clouds/harvester/inventory';

function getOriginFromEndpoint(endpoint: string): string {
  const base = (endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

export async function harvesterOvnEipListHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    const candidates = [`${origin}/apis/kubeovn.io/v1/ovneips`, `${origin}/apis/kubeovn.io/v1/ovn-eips`];

    let json: any = null;
    let lastErr: any = null;
    for (const url of candidates) {
      try {
        json = await getJsonOnce(url, cloud.secretKey || '', insecure);
        if (json) break;
      } catch (e: any) {
        lastErr = e;
      }
    }
    if (!json) {
      const s = Number((lastErr as any)?.status || 0);
      const m = String((lastErr as any)?.message || '').toLowerCase();
      if (s === 404 || m.includes('not found')) return res.json({ message: '查询成功', data: { items: [] } });
      throw lastErr || new Error('Failed to fetch OvnEips');
    }

    const rawItems = Array.isArray(json?.items) ? json.items : Array.isArray(json?.data) ? json.data : [];
    let items = rawItems;
    if (isTenant) {
      items = tenantNamespace ? items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace)) : [];
    } else if (tenantNamespace) {
      items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
    }
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询EIP失败', error: error.body || error.message });
  }
}

export async function harvesterOvnEipCreateHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, externalSubnet, v4Ip, type } = req.body;
    if (!name || !externalSubnet) {
      return res.status(400).json({ message: '缺少必要参数: name, externalSubnet' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'OvnEip',
      metadata: { name },
      spec: { externalSubnet, type: type || 'nat', ...(v4Ip ? { v4Ip } : {}) },
    };

    let json: any = null;
    try {
      json = await requestJson('POST', `${origin}/apis/kubeovn.io/v1/ovneips`, cloud.secretKey || '', insecure, payload);
    } catch (e: any) {
      if (e?.status === 404) {
        json = await requestJson('POST', `${origin}/apis/kubeovn.io/v1/ovn-eips`, cloud.secretKey || '', insecure, payload);
      } else {
        throw e;
      }
    }
    res.json({ message: '创建成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    let details = error.body;
    try {
      if (typeof details === 'string') details = JSON.parse(details);
    } catch {}
    res.status(500).json({ message: '创建EIP失败', error: error.message, details });
  }
}

export async function harvesterOvnFipListHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    const candidates = [`${origin}/apis/kubeovn.io/v1/ovnfips`, `${origin}/apis/kubeovn.io/v1/ovn-fips`];

    let json: any = null;
    let lastErr: any = null;
    for (const url of candidates) {
      try {
        json = await getJsonOnce(url, cloud.secretKey || '', insecure);
        if (json) break;
      } catch (e: any) {
        lastErr = e;
      }
    }
    if (!json) {
      const s = Number((lastErr as any)?.status || 0);
      const m = String((lastErr as any)?.message || '').toLowerCase();
      if (s === 404 || m.includes('not found')) return res.json({ message: '查询成功', data: { items: [] } });
      throw lastErr || new Error('Failed to fetch OvnFips');
    }

    const rawItems = Array.isArray(json?.items) ? json.items : Array.isArray(json?.data) ? json.data : [];
    let items = rawItems;
    if (isTenant) {
      items = tenantNamespace ? items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace)) : [];
    } else if (tenantNamespace) {
      items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
    }
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询FIP失败', error: error.body || error.message });
  }
}

export async function harvesterOvnFipCreateHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, ovnEip, vpc, ipType, ipName, v4Ip, v6Ip, type } = req.body;
    if (!name || !ovnEip || !vpc || !ipName) {
      return res.status(400).json({ message: '缺少必要参数: name, ovnEip, vpc, ipName' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    const candidates = [`${origin}/apis/kubeovn.io/v1/ovnfips`, `${origin}/apis/kubeovn.io/v1/ovn-fips`];
    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'OvnFip',
      metadata: { name },
      spec: {
        ovnEip,
        vpc,
        ipName,
        ipType: ipType || 'eip',
        ...(v4Ip ? { v4Ip } : {}),
        ...(v6Ip ? { v6Ip } : {}),
        ...(type ? { type } : {}),
      },
    };

    let json: any = null;
    let lastErr: any = null;
    for (const url of candidates) {
      try {
        json = await requestJson('POST', url, cloud.secretKey || '', insecure, payload);
        if (json) break;
      } catch (e: any) {
        lastErr = e;
        if (e?.status === 404) continue;
        throw e;
      }
    }
    if (!json && lastErr) throw lastErr;
    res.json({ message: '创建成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    let details = error.body;
    try {
      if (typeof details === 'string') details = JSON.parse(details);
    } catch {}
    res.status(500).json({ message: '创建FIP失败', error: error.message, details });
  }
}

export async function harvesterOvnSnatCreateHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, ovnEip, vpcSubnet } = req.body;
    if (!name || !ovnEip || !vpcSubnet) {
      return res.status(400).json({ message: '缺少必要参数: name, ovnEip, vpcSubnet' });
    }
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    const candidates = [`${origin}/apis/kubeovn.io/v1/ovnsnatrules`, `${origin}/apis/kubeovn.io/v1/ovn-snat-rules`];
    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'OvnSnatRule',
      metadata: { name },
      spec: { ovnEip, vpcSubnet },
    };

    let json: any = null;
    let lastErr: any = null;
    for (const url of candidates) {
      try {
        json = await requestJson('POST', url, cloud.secretKey || '', insecure, payload);
        if (json) break;
      } catch (e: any) {
        lastErr = e;
        if (e?.status === 404 && candidates.indexOf(url) === 0) continue;
        throw e;
      }
    }
    if (!json && lastErr) throw lastErr || new Error('Failed to create OvnSnatRule');

    if (json && json.metadata) {
      try {
        const repo = AppDataSource.getRepository(KubeOvnNatRuleInventory);
        const entity = repo.create({
          cloudId: cloud.id,
          uid: json.metadata?.uid || json.metadata?.name,
          name: json.metadata?.name || '',
          vpc: json.spec?.vpc,
          type: 'SNAT',
          cidr: json.spec?.vpcSubnet,
          eip: json.spec?.ovnEip,
          externalIp: json.status?.v4Eip,
          rawData: json,
        });
        await repo.save(entity);
      } catch (e: any) {
        console.error('[SNAT-Create] 入库失败:', e?.message || e);
      }
    }
    res.json({ message: '创建成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    let details = error.body;
    try {
      if (typeof details === 'string') details = JSON.parse(details);
    } catch {}
    res.status(500).json({ message: '创建SNAT规则失败', error: error.message, details });
  }
}

export async function harvesterOvnSnatListHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(KubeOvnNatRuleInventory);
    const whereCondition: any = { cloudId: id, type: 'SNAT' };
    if (isTenant && !tenantNamespace) whereCondition.cloudId = 'none';
    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      try {
        await syncKubeOvnNatRules(cloud, insecure);
      } catch (e: any) {
        if (count === 0) throw e;
      }
    }
    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => i.rawData).filter((item) => item != null);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询SNAT规则失败', error: error.body || error.message });
  }
}

export async function harvesterOvnDnatCreateHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, ovnEip, protocol, externalPort, internalPort, internalIp, vpc } = req.body;
    if (!name || !ovnEip || !externalPort || !internalPort || !internalIp || !vpc) {
      return res.status(400).json({ message: '缺少必要参数: name, ovnEip, externalPort, internalPort, internalIp, vpc' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    const candidates = [`${origin}/apis/kubeovn.io/v1/ovndnatrules`, `${origin}/apis/kubeovn.io/v1/ovn-dnat-rules`];
    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'OvnDnatRule',
      metadata: { name },
      spec: {
        ovnEip,
        ipType: 'ip',
        ipName: ovnEip,
        protocol: protocol || 'tcp',
        externalPort: String(externalPort),
        internalPort: String(internalPort),
        v4Ip: internalIp,
        vpc,
      },
    };

    let json: any = null;
    let lastErr: any = null;
    for (const url of candidates) {
      try {
        json = await requestJson('POST', url, cloud.secretKey || '', insecure, payload);
        if (json) break;
      } catch (e: any) {
        lastErr = e;
        if (e?.status === 404 && candidates.indexOf(url) === 0) continue;
        throw e;
      }
    }
    if (!json && lastErr) throw lastErr || new Error('Failed to create OvnDnatRule');

    if (json && json.metadata) {
      try {
        const repo = AppDataSource.getRepository(KubeOvnNatRuleInventory);
        const entity = repo.create({
          cloudId: cloud.id,
          uid: json.metadata?.uid || json.metadata?.name,
          name: json.metadata?.name || '',
          vpc: json.spec?.vpc || vpc,
          type: 'DNAT',
          eip: json.spec?.ovnEip,
          externalIp: json.status?.v4Eip,
          internalIp: json.spec?.v4Ip || internalIp,
          internalPort: json.spec?.internalPort || String(internalPort),
          externalPort: json.spec?.externalPort || String(externalPort),
          protocol: json.spec?.protocol || protocol || 'tcp',
          rawData: json,
        });
        await repo.save(entity);
      } catch (e: any) {
        console.error('[DNAT-Create] 入库失败:', e?.message || e);
      }
    }
    res.json({ message: '创建成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    let details = error.body;
    try {
      if (typeof details === 'string') details = JSON.parse(details);
    } catch {}
    res.status(500).json({ message: '创建DNAT规则失败', error: error.message, details });
  }
}

export async function harvesterOvnDnatListHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(KubeOvnNatRuleInventory);
    const whereCondition: any = { cloudId: id, type: 'DNAT' };
    if (isTenant && !tenantNamespace) whereCondition.cloudId = 'none';
    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      try {
        await syncKubeOvnNatRules(cloud, insecure);
      } catch (e: any) {
        if (count === 0) throw e;
      }
    }
    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => i.rawData).filter((item) => item != null);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询DNAT规则失败', error: error.body || error.message });
  }
}
