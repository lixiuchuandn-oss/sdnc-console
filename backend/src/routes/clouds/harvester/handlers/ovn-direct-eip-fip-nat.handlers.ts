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
  filterItemsByOvnNetworkScopeForApi,
  formatTowerNamespacesAnnotation,
  getNamespacesFromKubeOvnSubnet,
  getNamespacesFromKubeOvnVpc,
  inferOvnScopeFromSnatSubnetRef,
  isUnderlayVpcName,
  KUBE_OVN_PUBLIC_VPC,
  ovnEipNameFromRule,
  OvnNetworkScope,
  OvnNetworkScopeListQuery,
  parseRequiredOvnNetworkScopeCreateQuery,
  parseRequiredOvnNetworkScopeListQuery,
  subnetRefToName,
  TOWER_IO_NAMESPACES_ANNOTATION,
  TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION,
} from '../../../../services/clouds/harvester/kubeOvnNetworkScope';
import {
  listKubeOvnDnatRules,
  listKubeOvnEips,
  listKubeOvnFips,
  listKubeOvnSnatRules,
} from '../../../../services/clouds/harvester/network';
import { upsertVpcPolicyDstRouteForExternalSubnet } from './ovnInternalPublicSubnetSync';

export function getOriginFromEndpoint(endpoint: string): string {
  const base = (endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

const TOWER_IO_ALIAS = 'tower.io/alias';
const TOWER_IO_VPC = 'tower.io/vpc';

/** 库存/API 列表：同 uid 优先，避免并发同步导致的重复行 */
function dedupeOvnNatRules(list: any[]): any[] {
  const items = Array.isArray(list) ? list : [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of items) {
    const uid = String(r?.metadata?.uid || '').trim();
    const name = String(r?.metadata?.name || '').trim();
    const vpc = String(r?.spec?.vpc || '').trim();
    const vpcSubnet = String(r?.spec?.vpcSubnet || '').trim();
    const cidr = String(r?.spec?.cidr || '').trim();
    const key = uid || `${name}|${vpc}|${vpcSubnet}|${cidr}`;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** GET 列表：`ovnNetworkScope=underlay|all` 不校验 VPC License；`vpc` 须已开通 network.ovn.vpc */
function assertOvnVpcLicenseForList(req: any, res: Response, scope: OvnNetworkScopeListQuery): boolean {
  if (scope === 'underlay' || scope === 'all') return true;
  if (!licenseService.hasFeature('network.ovn.vpc')) {
    res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    return false;
  }
  return true;
}

/** POST 创建：`underlay` 不校验 VPC License */
function assertOvnVpcLicenseForCreate(req: any, res: Response, scope: OvnNetworkScope | null): boolean {
  if (scope === 'underlay') return true;
  if (!licenseService.hasFeature('network.ovn.vpc')) {
    res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    return false;
  }
  return true;
}

/** DELETE 等：根据资源 scope 判断是否需要 VPC License */
function assertOvnVpcLicenseForDelete(req: any, res: Response, scope: OvnNetworkScope | null): boolean {
  if (scope === 'underlay' || scope === null || scope === undefined) return true;
  if (!licenseService.hasFeature('network.ovn.vpc')) {
    res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    return false;
  }
  return true;
}

/** DELETE 等：与历史未分域行为一致，须已开通 VPC 能力 */
function assertOvnVpcLicenseStrict(req: any, res: Response): boolean {
  if (!licenseService.hasFeature('network.ovn.vpc')) {
    res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    return false;
  }
  return true;
}

/** OVN CR：metadata.name 为技术 ID；可选 tower.io/alias；可选额外 Tower 注解（如 tower.io/namespaces） */
function ovnCrMetadataWithOptionalAlias(
  name: string,
  alias: unknown,
  extras?: Record<string, string | undefined>,
): { name: string; annotations?: Record<string, string> } {
  const n = String(name || '').trim();
  const a = typeof alias === 'string' ? alias.trim() : '';
  const ann: Record<string, string> = {};
  if (a) ann[TOWER_IO_ALIAS] = a;
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (v != null && String(v).trim() !== '') ann[k] = String(v).trim();
    }
  }
  if (Object.keys(ann).length === 0) return { name: n };
  return { name: n, annotations: ann };
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

/**
 * 集群级 OVN CR（如 OvnEip）无 metadata.namespace；租户可见性须与创建时写入的
 * `tower.io/namespaces`（镜像 VPC/子网 spec.namespaces）对齐。
 */
function crVisibleToTenantNamespaces(item: any, tenantNamespacesCsv: string | undefined): boolean {
  if (!tenantNamespacesCsv) return false;
  const metaNs = String(item?.metadata?.namespace ?? '').trim();
  if (metaNs && isNamespaceAllowed(tenantNamespacesCsv, metaNs)) return true;
  const annCsv = String(item?.metadata?.annotations?.[TOWER_IO_NAMESPACES_ANNOTATION] ?? '').trim();
  if (!annCsv) return false;
  return annCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((ns) => isNamespaceAllowed(tenantNamespacesCsv, ns));
}

function applyNsFilter(items: any[], isTenant: boolean | undefined, tenantNamespace: string | undefined): any[] {
  if (isTenant) {
    return tenantNamespace ? items.filter((i: any) => crVisibleToTenantNamespaces(i, tenantNamespace)) : [];
  }
  if (tenantNamespace) {
    return items.filter((i: any) => crVisibleToTenantNamespaces(i, tenantNamespace));
  }
  return items;
}

function filterOutSystemLrpEips(items: any[]): any[] {
  return (Array.isArray(items) ? items : []).filter((item: any) => {
    const t = String(item?.spec?.type ?? item?.type ?? '').trim().toLowerCase();
    return t !== 'lrp';
  });
}

export async function harvesterOvnEipListHandler(req: any, res: Response, next: any) {
  const parsed = parseRequiredOvnNetworkScopeListQuery(req);
  if (!parsed.ok) return res.status(parsed.status).json({ message: parsed.message });
  return harvesterOvnEipListHandlerScoped(req, res, next, parsed.scope);
}

async function harvesterOvnEipListHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScopeListQuery,
) {
  try {
    if (!assertOvnVpcLicenseForList(req, res, scope)) return;
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
    const userVisibleItems = filterOutSystemLrpEips(rawItems);
    let items = applyNsFilter(userVisibleItems, isTenant, tenantNamespace);
    if (scope !== 'all') {
      items = filterItemsByOvnNetworkScopeForApi(items, scope);
    }
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询EIP失败', error: error.body || error.message });
  }
}

export async function harvesterOvnEipCreateHandler(req: any, res: Response, next: any) {
  const p = parseRequiredOvnNetworkScopeCreateQuery(req);
  if (!p.ok) return res.status(p.status).json({ message: p.message });
  return harvesterOvnEipCreateHandlerScoped(req, res, next, p.scope);
}

async function harvesterOvnEipCreateHandlerScoped(req: any, res: Response, next: any, routeScope: OvnNetworkScope) {
  try {
    if (!assertOvnVpcLicenseForCreate(req, res, routeScope)) return;
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, alias, externalSubnet, v4Ip, type, vpc, accessRouteCidr: accessRouteCidrRaw } = req.body;
    if (!name || !externalSubnet) {
      return res.status(400).json({ message: '缺少必要参数: name, externalSubnet' });
    }
    if (String(externalSubnet).trim() === 'external') {
      return res.status(400).json({
        message: '不允许使用内置子网 external 作为 EIP 外网子网，请选择其它公共子网',
        code: 'EIP_EXTERNAL_SUBNET_BUILTIN_FORBIDDEN',
      });
    }

    const isVpcScope = routeScope === 'vpc';
    const vpcName = String(vpc ?? '').trim();
    if (isVpcScope && !vpcName) {
      return res.status(400).json({ message: '缺少必要参数: vpc' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getOriginFromEndpoint(cloud.endpoint || '');
    const subnetName = String(externalSubnet ?? '').trim();

    /** VPC 分域创建 EIP：同步业务 VPC 的 extraExternalSubnets + policyDst 路由（下一跳=公共子网网关） */
    if (vpcName && subnetName && !isUnderlayVpcName(vpcName)) {
      const routeCidrIn = String(accessRouteCidrRaw ?? '0.0.0.0/0').trim() || '0.0.0.0/0';
      if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(routeCidrIn)) {
        return res.status(400).json({
          message: '可访问范围 CIDR 格式无效，应为 IPv4 CIDR（如 0.0.0.0/0 或 10.0.0.0/8）',
          code: 'EIP_ACCESS_ROUTE_CIDR_INVALID',
        });
      }
      const prefixBits = Number(routeCidrIn.split('/')[1]);
      if (!Number.isInteger(prefixBits) || prefixBits < 0 || prefixBits > 32) {
        return res.status(400).json({
          message: '可访问范围 CIDR 前缀长度须在 0–32 之间',
          code: 'EIP_ACCESS_ROUTE_CIDR_INVALID',
        });
      }

      const subnetUrl = `${origin}/apis/kubeovn.io/v1/subnets/${encodeURIComponent(subnetName)}`;
      let currentSubnet: any = null;
      try {
        currentSubnet = await getJsonOnce(subnetUrl, cloud.secretKey || '', insecure);
      } catch (e: any) {
        const st = Number(e?.status ?? 0);
        if (st === 404) {
          return res.status(400).json({
            message: `未找到公共子网 ${subnetName}，无法解析网关`,
            code: 'EIP_EXTERNAL_SUBNET_NOT_FOUND',
          });
        }
        throw e;
      }
      const gw = String(currentSubnet?.spec?.gateway ?? '').trim();
      if (!gw) {
        return res.status(400).json({
          message: '所选公共子网未配置网关，无法写入 VPC 静态路由',
          code: 'EIP_EXTERNAL_SUBNET_GATEWAY_REQUIRED',
        });
      }

      try {
        await upsertVpcPolicyDstRouteForExternalSubnet({
          harvesterParams: {
            endpoint: cloud.endpoint,
            token: cloud.secretKey || '',
            insecure,
          } as any,
          vpcName,
          externalSubnetName: subnetName,
          gateway: gw,
          routeCidr: routeCidrIn,
        });
      } catch (syncErr: any) {
        if (!res.headersSent) {
          res.status(500).json({
            message: '同步 VPC 外网路由失败',
            error: syncErr?.message || String(syncErr),
            code: 'EIP_VPC_ROUTE_SYNC_FAILED',
          });
        }
        return;
      }
    }

    const token = cloud.secretKey || '';
    const nsListForEip =
      vpcName && !isUnderlayVpcName(vpcName)
        ? await getNamespacesFromKubeOvnVpc(origin, vpcName, token, insecure)
        : await getNamespacesFromKubeOvnSubnet(origin, subnetName, token, insecure);
    const nsCsvEip = formatTowerNamespacesAnnotation(nsListForEip);
    const eipOvnScope: OvnNetworkScope =
      vpcName && !isUnderlayVpcName(vpcName) ? 'vpc' : 'underlay';

    const metadata = (() => {
      const base = ovnCrMetadataWithOptionalAlias(name, alias, {
        [TOWER_IO_NAMESPACES_ANNOTATION]: nsCsvEip || undefined,
        [TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION]: eipOvnScope,
      });
      const ann = { ...(base.annotations || {}) };
      if (vpcName) ann[TOWER_IO_VPC] = vpcName;
      return { name: base.name, ...(Object.keys(ann).length ? { annotations: ann } : {}) };
    })();

    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'OvnEip',
      metadata,
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
export async function deleteKubeOvnClusterCr(
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

    // 先获取 EIP 列表，从中找到要删除的 EIP 并判断其类型
    const eips = await listKubeOvnEips({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
    const eipObj = (Array.isArray(eips) ? eips : []).find(
      (e: any) => String(e?.metadata?.name || '').trim() === nameStr,
    );
    // 通过 EIP 的 spec.vpc 字段判断是否属于 VPC 网络
    // 如果 vpc 字段存在且非空，则属于 VPC 网络，需要 VPC License
    // 否则属于扁平网络（underlay），不需要 VPC License
    const eipVpc = String(eipObj?.spec?.vpc || '').trim();
    const eipScope = eipVpc ? 'vpc' : 'underlay';

    if (!assertOvnVpcLicenseForDelete(req, res, eipScope)) return;

    /** 展示名：有 tower.io/alias 则用别名，否则用 metadata.name */
    const toAliasLabel = (obj: any): string | null => {
      const n = String(obj?.metadata?.name || obj?.name || '').trim();
      if (!n) return null;
      const alias = String(obj?.metadata?.annotations?.[TOWER_IO_ALIAS] || '').trim();
      return alias || n;
    };
    const shortList = (arr: string[]) => (arr.length > 5 ? `${arr.slice(0, 5).join('，')} 等` : arr.join('，'));

    try {
      const [eips, fips, snats, dnats] = await Promise.all([
        listKubeOvnEips({ endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any),
        listKubeOvnFips({ endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any),
        listKubeOvnSnatRules({ endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any),
        listKubeOvnDnatRules({ endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any),
      ]);

      const eipObj =
        (Array.isArray(eips) ? eips : []).find(
          (e: any) => String(e?.metadata?.name || '').trim() === nameStr,
        ) || null;
      const eipLabel = eipObj ? String(toAliasLabel(eipObj) || nameStr) : nameStr;

      const usingFips = fips.filter((r: any) => ovnEipNameFromRule(r) === nameStr).map(toAliasLabel).filter(Boolean) as string[];
      const usingSnats = snats.filter((r: any) => ovnEipNameFromRule(r) === nameStr).map(toAliasLabel).filter(Boolean) as string[];
      const usingDnats = dnats.filter((r: any) => ovnEipNameFromRule(r) === nameStr).map(toAliasLabel).filter(Boolean) as string[];

      if (usingFips.length || usingSnats.length || usingDnats.length) {
        const parts: string[] = [];
        if (usingFips.length) parts.push(`FIP(浮动IP)：${shortList(usingFips)}`);
        if (usingSnats.length) parts.push(`SNAT 规则：${shortList(usingSnats)}`);
        if (usingDnats.length) parts.push(`DNAT 规则：${shortList(usingDnats)}`);
        return res.status(409).json({
          message: `不能删除 公网ip「${eipLabel}」，因为正在被 ${parts.join('；')} 使用`,
          code: 'EIP_IN_USE',
          usage: {
            fips: usingFips,
            snats: usingSnats,
            dnats: usingDnats,
          },
        });
      }
    } catch (e: any) {
      return res.status(500).json({
        message: '删除EIP失败：无法校验依赖关系',
        error: e?.body || e?.message || String(e),
      });
    }

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

    // 先获取 FIP 列表，从中找到要删除的 FIP 并判断其类型
    const fips = await listKubeOvnFips({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
    const fipObj = (Array.isArray(fips) ? fips : []).find(
      (f: any) => String(f?.metadata?.name || '').trim() === nameStr,
    );
    // FIP 通过其关联的 VPC 来判断 scope（如果有 VPC 则为 vpc scope，否则为 underlay）
    const fipVpc = String(fipObj?.spec?.vpc || '').trim();
    const fipScope = fipVpc ? 'vpc' : 'underlay';

    if (!assertOvnVpcLicenseForDelete(req, res, fipScope)) return;
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

    // 先获取 SNAT 规则列表，从中找到要删除的规则并判断其类型
    const snats = await listKubeOvnSnatRules({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
    const snatObj = (Array.isArray(snats) ? snats : []).find(
      (s: any) => String(s?.metadata?.name || '').trim() === nameStr,
    );
    // SNAT 通过其关联的 VPC 来判断 scope（如果有 VPC 则为 vpc scope，否则为 underlay）
    const snatVpc = String(snatObj?.spec?.vpc || '').trim();
    const scope = snatVpc ? 'vpc' : 'underlay';
    if (!assertOvnVpcLicenseForDelete(req, res, scope)) return;
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

    // 先获取 DNAT 规则列表，从中找到要删除的规则并判断其类型
    const dnats = await listKubeOvnDnatRules({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
    const dnatObj = (Array.isArray(dnats) ? dnats : []).find(
      (d: any) => String(d?.metadata?.name || '').trim() === nameStr,
    );
    // DNAT 通过其关联的 VPC 来判断 scope（如果有 VPC 则为 vpc scope，否则为 underlay）
    const dnatVpc = String(dnatObj?.spec?.vpc || '').trim();
    const scope = dnatVpc ? 'vpc' : 'underlay';
    if (!assertOvnVpcLicenseForDelete(req, res, scope)) return;
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
  const parsed = parseRequiredOvnNetworkScopeListQuery(req);
  if (!parsed.ok) return res.status(parsed.status).json({ message: parsed.message });
  return harvesterOvnFipListHandlerScoped(req, res, next, parsed.scope);
}

async function harvesterOvnFipListHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScopeListQuery,
) {
  try {
    if (!assertOvnVpcLicenseForList(req, res, scope)) return;
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
    if (scope !== 'all') {
      items = filterItemsByOvnNetworkScopeForApi(items, scope);
    }
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询FIP失败', error: error.body || error.message });
  }
}

export async function harvesterOvnFipCreateHandler(req: any, res: Response, next: any) {
  const p = parseRequiredOvnNetworkScopeCreateQuery(req);
  if (!p.ok) return res.status(p.status).json({ message: p.message });
  return harvesterOvnFipCreateHandlerScoped(req, res, next, p.scope);
}

async function harvesterOvnFipCreateHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope,
) {
  try {
    if (!assertOvnVpcLicenseForCreate(req, res, scope)) return;
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, alias, ovnEip, vpc, ipType, ipName, v4Ip, v6Ip, type } = req.body;
    if (!name || !ovnEip || !vpc) {
      return res.status(400).json({ message: '缺少必要参数: name, ovnEip, vpc' });
    }
    if (!ipName && !v4Ip && !v6Ip) {
      return res.status(400).json({ message: '缺少必要参数: ipName 或 v4Ip/v6Ip' });
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
    const token = cloud.secretKey || '';
    const vpcStr = String(vpc).trim();
    const nsListFip = await getNamespacesFromKubeOvnVpc(origin, vpcStr, token, insecure);
    const nsCsvFip = formatTowerNamespacesAnnotation(nsListFip);
    const fipOvnScope: OvnNetworkScope =
      scope === 'underlay' || scope === 'vpc'
        ? scope
        : isUnderlayVpcName(vpcStr)
          ? 'underlay'
          : 'vpc';
    const candidates = [`${origin}/apis/kubeovn.io/v1/ovnfips`, `${origin}/apis/kubeovn.io/v1/ovn-fips`];
    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'OvnFip',
      metadata: ovnCrMetadataWithOptionalAlias(name, alias, {
        [TOWER_IO_NAMESPACES_ANNOTATION]: nsCsvFip || undefined,
        [TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION]: fipOvnScope,
      }),
      spec: {
        ovnEip,
        vpc,
        ipType: ipType || 'eip',
        ...(ipName ? { ipName } : {}),
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
  const p = parseRequiredOvnNetworkScopeCreateQuery(req);
  if (!p.ok) return res.status(p.status).json({ message: p.message });
  return harvesterOvnSnatCreateHandlerScoped(req, res, next, p.scope);
}

async function harvesterOvnSnatCreateHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope,
) {
  try {
    if (!assertOvnVpcLicenseForCreate(req, res, scope)) return;
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const { name, alias, ovnEip, vpcSubnet } = req.body;
    if (!name || !ovnEip || !vpcSubnet) {
      return res.status(400).json({ message: '缺少必要参数: name, ovnEip, vpcSubnet' });
    }

    const subnetMap = await loadSubnetVpcMap(id);
    if (scope) {
      const snatClass = inferOvnScopeFromSnatSubnetRef({ spec: { vpcSubnet } }, subnetMap);
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
    const token = cloud.secretKey || '';
    const snRefName = subnetRefToName(vpcSubnet) || String(vpcSubnet).trim();
    const vpcResolved = subnetMap.get(snRefName);
    const nsListSnat =
      vpcResolved && !isUnderlayVpcName(vpcResolved)
        ? await getNamespacesFromKubeOvnVpc(origin, vpcResolved, token, insecure)
        : await getNamespacesFromKubeOvnSubnet(origin, vpcSubnet, token, insecure);
    const nsCsvSnat = formatTowerNamespacesAnnotation(nsListSnat);
    const snatOvnScope: OvnNetworkScope =
      scope === 'underlay' || scope === 'vpc'
        ? scope
        : inferOvnScopeFromSnatSubnetRef({ spec: { vpcSubnet } }, subnetMap) === 'vpc'
          ? 'vpc'
          : 'underlay';
    const candidates = [`${origin}/apis/kubeovn.io/v1/ovnsnatrules`, `${origin}/apis/kubeovn.io/v1/ovn-snat-rules`];
    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'OvnSnatRule',
      metadata: ovnCrMetadataWithOptionalAlias(name, alias, {
        [TOWER_IO_NAMESPACES_ANNOTATION]: nsCsvSnat || undefined,
        [TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION]: snatOvnScope,
      }),
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
  const parsed = parseRequiredOvnNetworkScopeListQuery(req);
  if (!parsed.ok) return res.status(parsed.status).json({ message: parsed.message });
  return harvesterOvnSnatListHandlerScoped(req, res, next, parsed.scope);
}

async function harvesterOvnSnatListHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScopeListQuery,
) {
  try {
    if (!assertOvnVpcLicenseForList(req, res, scope)) return;
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
    list = applyNsFilter(list, isTenant, tenantNamespace);
    if (scope !== 'all') {
      list = filterItemsByOvnNetworkScopeForApi(list, scope);
    }
    list = dedupeOvnNatRules(list);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询SNAT规则失败', error: error.body || error.message });
  }
}

export async function harvesterOvnDnatCreateHandler(req: any, res: Response, next: any) {
  const p = parseRequiredOvnNetworkScopeCreateQuery(req);
  if (!p.ok) return res.status(p.status).json({ message: p.message });
  return harvesterOvnDnatCreateHandlerScoped(req, res, next, p.scope);
}

async function harvesterOvnDnatCreateHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScope,
) {
  try {
    if (!assertOvnVpcLicenseForCreate(req, res, scope)) return;
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
    const token = cloud.secretKey || '';
    const vpcDnat = String(vpc).trim();
    const nsListDnat = await getNamespacesFromKubeOvnVpc(origin, vpcDnat, token, insecure);
    const nsCsvDnat = formatTowerNamespacesAnnotation(nsListDnat);
    const dnatOvnScope: OvnNetworkScope =
      scope === 'underlay' || scope === 'vpc'
        ? scope
        : isUnderlayVpcName(vpcDnat)
          ? 'underlay'
          : 'vpc';
    const candidates = [`${origin}/apis/kubeovn.io/v1/ovndnatrules`, `${origin}/apis/kubeovn.io/v1/ovn-dnat-rules`];
    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'OvnDnatRule',
      metadata: ovnCrMetadataWithOptionalAlias(name, alias, {
        [TOWER_IO_NAMESPACES_ANNOTATION]: nsCsvDnat || undefined,
        [TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION]: dnatOvnScope,
      }),
      spec: {
        ovnEip,
        ipType: 'ip',
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
  const parsed = parseRequiredOvnNetworkScopeListQuery(req);
  if (!parsed.ok) return res.status(parsed.status).json({ message: parsed.message });
  return harvesterOvnDnatListHandlerScoped(req, res, next, parsed.scope);
}

async function harvesterOvnDnatListHandlerScoped(
  req: any,
  res: Response,
  next: any,
  scope: OvnNetworkScopeListQuery,
) {
  try {
    if (!assertOvnVpcLicenseForList(req, res, scope)) return;
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
    list = applyNsFilter(list, isTenant, tenantNamespace);
    if (scope !== 'all') {
      list = filterItemsByOvnNetworkScopeForApi(list, scope);
    }
    list = dedupeOvnNatRules(list);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询DNAT规则失败', error: error.body || error.message });
  }
}
