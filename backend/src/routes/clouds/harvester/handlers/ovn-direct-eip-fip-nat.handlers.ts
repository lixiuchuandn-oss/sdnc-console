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
import { KubeOvnEipInventory } from '../../../../entities/kubeovn/KubeOvnEipInventory';
import { KubeOvnFipInventory } from '../../../../entities/kubeovn/KubeOvnFipInventory';
import { KubeOvnNatRuleInventory } from '../../../../entities/kubeovn/KubeOvnNatRuleInventory';
import { KubeOvnSubnetInventory } from '../../../../entities/kubeovn/KubeOvnSubnetInventory';
import { syncKubeOvnNatRules } from '../../../../services/clouds/harvester/inventory';
import {
  classifyFipOrDnat,
  classifySnatRule,
  filterItemsByScope,
  isUnderlayVpcName,
  KUBE_OVN_PUBLIC_VPC,
  ovnEipNameFromRule,
  OvnNetworkScope,
} from '../../../../services/clouds/harvester/kubeOvnNetworkScope';
import {
  listKubeOvnDnatRules,
  listKubeOvnFips,
  listKubeOvnSnatRules,
} from '../../../../services/clouds/harvester/network';

function getOriginFromEndpoint(endpoint: string): string {
  const base = (endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

const TOWER_IO_ALIAS = 'tower.io/alias';

/** OVN CR：metadata.name 为技术 ID；可选展示名写入 tower.io/alias（与 VM 创建约定一致） */
function ovnCrMetadataWithOptionalAlias(
  name: string,
  alias: unknown,
): { name: string; annotations?: Record<string, string> } {
  const n = String(name || '').trim();
  const a = typeof alias === 'string' ? alias.trim() : '';
  if (a) {
    return { name: n, annotations: { [TOWER_IO_ALIAS]: a } };
  }
  return { name: n };
}

async function loadSubnetVpcMap(cloudId: string): Promise<Map<string, string>> {
  const repo = AppDataSource.getRepository(KubeOvnSubnetInventory);
  const rows = await repo.find({ where: { cloudId } });
  const m = new Map<string, string>();
  for (const r of rows) {
    const vpc = r.vpc || (r.rawData?.spec?.vpc as string | undefined) || KUBE_OVN_PUBLIC_VPC;
    m.set(r.name, vpc);
  }
  return m;
}

/** 未绑定任何 FIP/SNAT/DNAT 的 EIP 在两侧列表均展示，便于创建规则时选用 */
async function filterEipsByOvnScope(
  items: any[],
  scope: OvnNetworkScope,
  cloud: any,
  insecure: boolean,
): Promise<any[]> {
  let fips: any[] = [];
  let snats: any[] = [];
  let dnats: any[] = [];
  try {
    [fips, snats, dnats] = await Promise.all([
      listKubeOvnFips({ endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any),
      listKubeOvnSnatRules({ endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any),
      listKubeOvnDnatRules({ endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any),
    ]);
  } catch {
    return items;
  }
  const subnetMap = await loadSubnetVpcMap(cloud.id);
  const usedUnderlay = new Set<string>();
  const usedVpc = new Set<string>();
  for (const r of fips) {
    const n = ovnEipNameFromRule(r);
    if (!n) continue;
    if (classifyFipOrDnat(r) === 'underlay') usedUnderlay.add(n);
    else usedVpc.add(n);
  }
  for (const r of snats) {
    const n = ovnEipNameFromRule(r);
    if (!n) continue;
    const c = classifySnatRule(r, subnetMap);
    if (c === 'underlay') usedUnderlay.add(n);
    else if (c === 'vpc') usedVpc.add(n);
    else {
      usedVpc.add(n);
    }
  }
  for (const r of dnats) {
    const n = ovnEipNameFromRule(r);
    if (!n) continue;
    if (classifyFipOrDnat(r) === 'underlay') usedUnderlay.add(n);
    else usedVpc.add(n);
  }

  return items.filter((eip) => {
    const name = eip?.metadata?.name;
    if (!name) return true;
    const u = usedUnderlay.has(name);
    const v = usedVpc.has(name);
    if (!u && !v) return true;
    if (scope === 'underlay') return u || !v;
    return v || !u;
  });
}

function applyNsFilter(items: any[], isTenant: boolean | undefined, tenantNamespace: string | undefined): any[] {
  if (isTenant) {
    return tenantNamespace ? items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace)) : [];
  }
  if (tenantNamespace) {
    return items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
  }
  return items;
}

export async function harvesterOvnEipListHandler(req: any, res: Response, next: any) {
  return harvesterOvnEipListHandlerScoped(req, res, next, null);
}

export async function harvesterOvnEipListHandlerUnderlay(req: any, res: Response, next: any) {
  return harvesterOvnEipListHandlerScoped(req, res, next, 'underlay');
}

export async function harvesterOvnEipListHandlerVpc(req: any, res: Response, next: any) {
  return harvesterOvnEipListHandlerScoped(req, res, next, 'vpc');
}

async function harvesterOvnEipListHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope | null,
) {
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
    let items = applyNsFilter(rawItems, isTenant, tenantNamespace);
    if (scope) {
      items = await filterEipsByOvnScope(items, scope, cloud, insecure);
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

    const { name, alias, externalSubnet, v4Ip, type } = req.body;
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
      metadata: ovnCrMetadataWithOptionalAlias(name, alias),
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

/** 集群级 OVN CR 删除：兼容两种 API 路径；双 404 视为已删除 */
async function deleteKubeOvnClusterCr(
  origin: string,
  token: string,
  insecure: boolean,
  pluralA: string,
  pluralB: string,
  name: string,
): Promise<void> {
  const enc = encodeURIComponent(name);
  const candidates = [
    `${origin}/apis/kubeovn.io/v1/${pluralA}/${enc}`,
    `${origin}/apis/kubeovn.io/v1/${pluralB}/${enc}`,
  ];
  let lastErr: any = null;
  for (let i = 0; i < candidates.length; i++) {
    try {
      await requestJson('DELETE', candidates[i], token, insecure);
      return;
    } catch (e: any) {
      lastErr = e;
      if (e?.status === 404 && i < candidates.length - 1) continue;
      if (e?.status === 404) return;
      throw e;
    }
  }
  if (lastErr && lastErr.status !== 404) throw lastErr;
}

export async function harvesterOvnEipDeleteHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id, name } = req.params;
    const nameStr = String(name || '').trim();
    if (!nameStr) return res.status(400).json({ message: '缺少资源名称' });
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    await deleteKubeOvnClusterCr(origin, cloud.secretKey || '', insecure, 'ovneips', 'ovn-eips', nameStr);
    try {
      await AppDataSource.getRepository(KubeOvnEipInventory).delete({ cloudId: cloud.id, name: nameStr });
    } catch (e: any) {
      console.warn('[EIP-Delete] 本地库存删除失败:', e?.message || e);
    }
    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除EIP失败', error: error.message });
  }
}

export async function harvesterOvnFipDeleteHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id, name } = req.params;
    const nameStr = String(name || '').trim();
    if (!nameStr) return res.status(400).json({ message: '缺少资源名称' });
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    await deleteKubeOvnClusterCr(origin, cloud.secretKey || '', insecure, 'ovnfips', 'ovn-fips', nameStr);
    try {
      await AppDataSource.getRepository(KubeOvnFipInventory).delete({ cloudId: cloud.id, name: nameStr });
    } catch (e: any) {
      console.warn('[FIP-Delete] 本地库存删除失败:', e?.message || e);
    }
    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除FIP失败', error: error.message });
  }
}

export async function harvesterOvnSnatDeleteHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id, name } = req.params;
    const nameStr = String(name || '').trim();
    if (!nameStr) return res.status(400).json({ message: '缺少资源名称' });
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    await deleteKubeOvnClusterCr(origin, cloud.secretKey || '', insecure, 'ovnsnatrules', 'ovn-snat-rules', nameStr);
    try {
      await AppDataSource.getRepository(KubeOvnNatRuleInventory).delete({
        cloudId: cloud.id,
        name: nameStr,
        type: 'SNAT',
      });
    } catch (e: any) {
      console.warn('[SNAT-Delete] 本地库存删除失败:', e?.message || e);
    }
    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除SNAT规则失败', error: error.message });
  }
}

export async function harvesterOvnDnatDeleteHandler(req: any, res: Response, next: any) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id, name } = req.params;
    const nameStr = String(name || '').trim();
    if (!nameStr) return res.status(400).json({ message: '缺少资源名称' });
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    await deleteKubeOvnClusterCr(origin, cloud.secretKey || '', insecure, 'ovndnatrules', 'ovn-dnat-rules', nameStr);
    try {
      await AppDataSource.getRepository(KubeOvnNatRuleInventory).delete({
        cloudId: cloud.id,
        name: nameStr,
        type: 'DNAT',
      });
    } catch (e: any) {
      console.warn('[DNAT-Delete] 本地库存删除失败:', e?.message || e);
    }
    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除DNAT规则失败', error: error.message });
  }
}

export async function harvesterOvnFipListHandler(req: any, res: Response, next: any) {
  return harvesterOvnFipListHandlerScoped(req, res, next, null);
}

export async function harvesterOvnFipListHandlerUnderlay(req: any, res: Response, next: any) {
  return harvesterOvnFipListHandlerScoped(req, res, next, 'underlay');
}

export async function harvesterOvnFipListHandlerVpc(req: any, res: Response, next: any) {
  return harvesterOvnFipListHandlerScoped(req, res, next, 'vpc');
}

async function harvesterOvnFipListHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope | null,
) {
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
    let items = applyNsFilter(rawItems, isTenant, tenantNamespace);
    if (scope) {
      items = filterItemsByScope(items, scope, classifyFipOrDnat);
    }
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询FIP失败', error: error.body || error.message });
  }
}

export async function harvesterOvnFipCreateHandler(req: any, res: Response, next: any) {
  return harvesterOvnFipCreateHandlerScoped(req, res, next, null);
}

export async function harvesterOvnFipCreateHandlerUnderlay(req: any, res: Response, next: any) {
  return harvesterOvnFipCreateHandlerScoped(req, res, next, 'underlay');
}

export async function harvesterOvnFipCreateHandlerVpc(req: any, res: Response, next: any) {
  return harvesterOvnFipCreateHandlerScoped(req, res, next, 'vpc');
}

async function harvesterOvnFipCreateHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope | null,
) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, alias, ovnEip, vpc, ipType, ipName, v4Ip, v6Ip, type } = req.body;
    if (!name || !ovnEip || !vpc || !ipName) {
      return res.status(400).json({ message: '缺少必要参数: name, ovnEip, vpc, ipName' });
    }
    if (scope === 'underlay' && !isUnderlayVpcName(vpc)) {
      return res.status(400).json({
        message: '扁平网络 FIP 仅允许绑定内置扁平 VPC（ovn-internal）或历史默认 VPC（ovn-cluster）',
      });
    }
    if (scope === 'vpc' && isUnderlayVpcName(vpc)) {
      return res.status(400).json({
        message: 'VPC 网络 FIP 不能使用内置 VPC（ovn-cluster / ovn-internal），请选业务 VPC',
      });
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
      metadata: ovnCrMetadataWithOptionalAlias(name, alias),
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
  return harvesterOvnSnatCreateHandlerScoped(req, res, next, null);
}

export async function harvesterOvnSnatCreateHandlerUnderlay(req: any, res: Response, next: any) {
  return harvesterOvnSnatCreateHandlerScoped(req, res, next, 'underlay');
}

export async function harvesterOvnSnatCreateHandlerVpc(req: any, res: Response, next: any) {
  return harvesterOvnSnatCreateHandlerScoped(req, res, next, 'vpc');
}

async function harvesterOvnSnatCreateHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope | null,
) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, alias, ovnEip, vpcSubnet } = req.body;
    if (!name || !ovnEip || !vpcSubnet) {
      return res.status(400).json({ message: '缺少必要参数: name, ovnEip, vpcSubnet' });
    }

    if (scope) {
      const subnetMap = await loadSubnetVpcMap(id);
      const snatClass = classifySnatRule({ spec: { vpcSubnet } }, subnetMap);
      if (snatClass === 'unknown') {
        return res.status(400).json({
          message:
            scope === 'underlay'
              ? '无法在库存中解析子网所属 VPC，请先同步子网或确认 vpcSubnet 为默认 VPC 下的扁平/公共子网'
              : '无法在库存中解析子网所属 VPC，请先同步子网',
        });
      }
      if (scope === 'underlay' && snatClass !== 'underlay') {
        return res.status(400).json({
          message: '扁平网络 SNAT 仅允许绑定内置 VPC（ovn-internal / 历史 ovn-cluster）下的扁平子网',
        });
      }
      if (scope === 'vpc' && snatClass !== 'vpc') {
        return res.status(400).json({ message: 'VPC SNAT 仅允许绑定业务 VPC 下的子网' });
      }
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
      metadata: ovnCrMetadataWithOptionalAlias(name, alias),
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
  return harvesterOvnSnatListHandlerScoped(req, res, next, null);
}

export async function harvesterOvnSnatListHandlerUnderlay(req: any, res: Response, next: any) {
  return harvesterOvnSnatListHandlerScoped(req, res, next, 'underlay');
}

export async function harvesterOvnSnatListHandlerVpc(req: any, res: Response, next: any) {
  return harvesterOvnSnatListHandlerScoped(req, res, next, 'vpc');
}

async function harvesterOvnSnatListHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope | null,
) {
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
    let list = items.map((i) => i.rawData).filter((item) => item != null);
    const subnetMap = scope ? await loadSubnetVpcMap(id) : null;
    if (scope && subnetMap) {
      list = filterItemsByScope(list, scope, (raw) => classifySnatRule(raw, subnetMap));
    }
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询SNAT规则失败', error: error.body || error.message });
  }
}

export async function harvesterOvnDnatCreateHandler(req: any, res: Response, next: any) {
  return harvesterOvnDnatCreateHandlerScoped(req, res, next, null);
}

export async function harvesterOvnDnatCreateHandlerUnderlay(req: any, res: Response, next: any) {
  return harvesterOvnDnatCreateHandlerScoped(req, res, next, 'underlay');
}

export async function harvesterOvnDnatCreateHandlerVpc(req: any, res: Response, next: any) {
  return harvesterOvnDnatCreateHandlerScoped(req, res, next, 'vpc');
}

async function harvesterOvnDnatCreateHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope | null,
) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, alias, ovnEip, protocol, externalPort, internalPort, internalIp, vpc } = req.body;
    if (!name || !ovnEip || !externalPort || !internalPort || !internalIp || !vpc) {
      return res.status(400).json({ message: '缺少必要参数: name, ovnEip, externalPort, internalPort, internalIp, vpc' });
    }
    if (scope === 'underlay' && !isUnderlayVpcName(vpc)) {
      return res.status(400).json({
        message: '扁平网络 DNAT 仅允许使用内置 VPC（ovn-internal / 历史 ovn-cluster）',
      });
    }
    if (scope === 'vpc' && isUnderlayVpcName(vpc)) {
      return res.status(400).json({
        message: 'VPC DNAT 不能使用内置 VPC（ovn-cluster / ovn-internal）',
      });
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
      metadata: ovnCrMetadataWithOptionalAlias(name, alias),
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
  return harvesterOvnDnatListHandlerScoped(req, res, next, null);
}

export async function harvesterOvnDnatListHandlerUnderlay(req: any, res: Response, next: any) {
  return harvesterOvnDnatListHandlerScoped(req, res, next, 'underlay');
}

export async function harvesterOvnDnatListHandlerVpc(req: any, res: Response, next: any) {
  return harvesterOvnDnatListHandlerScoped(req, res, next, 'vpc');
}

async function harvesterOvnDnatListHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope | null,
) {
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
    let list = items.map((i) => i.rawData).filter((item) => item != null);
    if (scope) {
      list = filterItemsByScope(list, scope, classifyFipOrDnat);
    }
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询DNAT规则失败', error: error.body || error.message });
  }
}
