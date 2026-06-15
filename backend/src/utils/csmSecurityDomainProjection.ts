import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { SecurityDomain } from '../entities/SecurityDomain';
import {
  CsmConfig,
  listCsmAssets,
  listCsmElementGroups,
  listCsmServiceChains,
} from '../services/clouds/csm/client';
import {
  CsmSecurityDomainRow,
  listCsmSecurityDomainsPaged,
} from '../services/clouds/csm/csmV2Api';

export type NormalizedCsmSecurityService = {
  id: string;
  name: string;
  type: string;
  vendor?: string;
  defenseType?: string;
  neCount: number;
  status: string;
  source: 'csm_security_domain';
  vmIds?: string[];
  webIds?: string[];
  raw?: any;
};

function uuidToObjectIdHex(uuidStr: string): string | null {
  try {
    const s = String(uuidStr || '')
      .trim()
      .toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return null;
    const hex = s.replace(/-/g, '');
    const bytes = Buffer.from(hex, 'hex');
    if (bytes.length !== 16) return null;
    if (!(bytes[6] === 0x40 && bytes[7] === 0x00 && bytes[8] === 0x80 && bytes[9] === 0x00)) return null;
    const obj = Buffer.alloc(12);
    bytes.copy(obj, 0, 0, 6);
    bytes.copy(obj, 6, 10, 16);
    return obj.toString('hex');
  } catch {
    return null;
  }
}

export type CsmSecurityDomainProjection = {
  linkedCsmSecurityDomainId?: string;
  linkedCsmSecurityDomain?: CsmSecurityDomainRow | null;
  csmCloudId?: string;
  csmProtectionObjects: any[];
  securityServices: NormalizedCsmSecurityService[];
  serviceChains: any[];
  csmProjectionReady: boolean;
  csmProjectionError?: string;
};

function isCsmCloud(cloud: Cloud | null | undefined): boolean {
  const pv = String(cloud?.config?.provider || (cloud as any)?.provider || '')
    .trim()
    .toLowerCase();
  return pv === 'cloudmap.csm';
}

function toCsmConfig(cloud: Cloud): CsmConfig {
  return {
    endpoint: String(cloud.endpoint || '').trim(),
    accessKey: String(cloud.accessKey || '').trim(),
    secretKey: String(cloud.secretKey || '').trim(),
    ignoreTls: !!(cloud as any)?.config?.ignoreTls,
  };
}

function normalizeId(v: unknown): string {
  return String(v ?? '').trim();
}

function idsMatch(a: string, b: string): boolean {
  const x = normalizeId(a);
  const y = normalizeId(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 8 && y.startsWith(x)) return true;
  if (y.length >= 8 && x.startsWith(y)) return true;
  return false;
}

function extractLinkedDomainId(row: Record<string, unknown>): string {
  return normalizeId(
    row.domain_id ??
      row.domainId ??
      row.security_domain_id ??
      row.securityDomainId ??
      row.sd_id ??
      row.sdId ??
      row.security_domain ??
      row.securityDomain,
  );
}

function toList(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((x) => normalizeId(x)).filter(Boolean);
  const s = String(raw).trim();
  if (!s) return [];
  return s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function pick(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

function rowBelongsToCsmDomain(
  row: Record<string, unknown>,
  linkedDomainId: string,
  domainRow?: CsmSecurityDomainRow | null,
): boolean {
  const rowDomain = extractLinkedDomainId(row);
  if (rowDomain && idsMatch(rowDomain, linkedDomainId)) return true;

  if (domainRow?.orgId) {
    const rowOrg = normalizeId(row.org_id ?? row.orgId);
    if (rowOrg && idsMatch(rowOrg, String(domainRow.orgId))) {
      if (!rowDomain) return true;
    }
  }

  const cidrs = Array.isArray(domainRow?.networkCidrs) ? domainRow!.networkCidrs! : [];
  if (cidrs.length > 0) {
    const networkIds = toList(row.network_ids ?? row.networkIds);
    if (networkIds.length > 0) {
      // 服务链通过防护对象 network_id 间接归属；资产过滤在 protectionObjects 阶段处理
      return false;
    }
    const val = normalizeId(row.value ?? row.ip ?? row.cidr ?? row.CidrBlock);
    if (val && cidrs.some((c) => val === String(c).trim() || val.includes(String(c).trim()))) {
      return !rowDomain;
    }
  }

  return false;
}

function assetBelongsToCsmDomain(
  asset: Record<string, unknown>,
  linkedDomainId: string,
  domainRow?: CsmSecurityDomainRow | null,
): boolean {
  if (rowBelongsToCsmDomain(asset, linkedDomainId, domainRow)) return true;

  const cidrs = Array.isArray(domainRow?.networkCidrs) ? domainRow!.networkCidrs! : [];
  const val = normalizeId(asset.value ?? asset.ip);
  if (val && cidrs.some((c) => val === String(c).trim())) return true;

  return false;
}

function normalizeElementGroup(g: any): NormalizedCsmSecurityService {
  const gid = normalizeId(
    g?.id ?? g?.vm_group_id ?? g?.vmGroupId ?? g?.vmGroupID ?? g?.vm_group_uuid ?? g?.vmGroupUuid,
  );
  const elements = Array.isArray(g?.elements)
    ? g.elements
    : typeof g?.vm_id_list === 'string'
      ? String(g.vm_id_list)
          .split(';')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];
  const neCount = Number(
    pick(g, [
      'neCount',
      'count',
      'Count',
      'elementCount',
      'elementsCount',
      'elements_count',
      'vm_count',
      'vmCount',
    ]) ?? elements.length,
  );
  const defenseRaw = pick(g, [
    'defenseType',
    'defense_type',
    'defend_type',
    'defendType',
    'protectType',
    'protect_type',
  ]);
  let defenseType: string | undefined;
  if (defenseRaw !== undefined) {
    const n = Number(defenseRaw);
    if (!Number.isNaN(n)) defenseType = n === 1 ? '非流量型' : n === 2 ? '流量型' : String(defenseRaw);
    else defenseType = String(defenseRaw).trim() || undefined;
  }
  const vmIds = elements
    .map((x: unknown) => normalizeId(x))
    .filter((id: string) => id.length > 0);
  const webIds = vmIds
    .map((id: string) => uuidToObjectIdHex(id))
    .filter((w: string | undefined): w is string => !!w);

  return {
    id: gid,
    name:
      String(pick(g, ['name', 'vm_group_name', 'vmGroupName']) || '').trim() ||
      `安全网元组-${gid.slice(0, 8)}`,
    type:
      String(
        pick(g, ['vm_type', 'vmType', 'type', 'groupType', 'vm_group_type', 'vmGroupType']) || '',
      ).trim() || 'CSM安全网元组',
    vendor: pick(g, ['vendor', 'manufacturer', 'vendor_name', 'vendorName', 'brand']),
    defenseType,
    neCount: Number.isFinite(neCount) ? neCount : 0,
    status: 'active',
    source: 'csm_security_domain',
    vmIds,
    webIds,
    raw: g,
  };
}

function collectGroupIdsFromChains(chains: any[]): Set<string> {
  const out = new Set<string>();
  for (const chain of chains) {
    for (const id of [...toList(chain?.serial_list), ...toList(chain?.monitor_list)]) {
      out.add(id);
    }
    const parsedServices = chain?.securityServices ?? chain?.security_services;
    if (parsedServices) {
      try {
        const p = typeof parsedServices === 'string' ? JSON.parse(parsedServices) : parsedServices;
        const arr = Array.isArray(p) ? p : [p];
        for (const s of arr) {
          const id = normalizeId(
            typeof s === 'object'
              ? s?.id ?? s?.vm_group_id ?? s?.vmGroupId ?? s?.vm_group_uuid
              : s,
          );
          if (id) out.add(id);
        }
      } catch {
        toList(parsedServices).forEach((id) => out.add(id));
      }
    }
  }
  return out;
}

async function resolveCsmCloud(domain: SecurityDomain): Promise<Cloud | null> {
  const cloudRepo = AppDataSource.getRepository(Cloud);
  const preferred = normalizeId(domain.csmCloudId);
  if (preferred) {
    const c = await cloudRepo.findOne({ where: { id: preferred } });
    if (c && isCsmCloud(c)) return c;
  }
  const fallback = normalizeId(domain.cloudId);
  if (fallback) {
    const c = await cloudRepo.findOne({ where: { id: fallback } });
    if (c && isCsmCloud(c)) return c;
  }
  return null;
}

export async function loadCsmSecurityDomainProjection(
  domain: SecurityDomain | (SecurityDomain & Record<string, unknown>),
): Promise<CsmSecurityDomainProjection> {
  const linkedId = normalizeId(domain.linkedCsmSecurityDomainId);
  const empty: CsmSecurityDomainProjection = {
    linkedCsmSecurityDomainId: linkedId || undefined,
    linkedCsmSecurityDomain: null,
    csmProtectionObjects: [],
    securityServices: [],
    serviceChains: [],
    csmProjectionReady: false,
  };

  if (!linkedId) {
    return { ...empty, csmProjectionError: '未关联 CSM 安全域' };
  }

  const cloud = await resolveCsmCloud(domain);
  if (!cloud) {
    return { ...empty, csmProjectionError: '未配置 CSM 资源池' };
  }

  const config = toCsmConfig(cloud);
  if (!config.endpoint || !config.accessKey || !config.secretKey) {
    return {
      ...empty,
      csmCloudId: cloud.id,
      csmProjectionError: 'CSM 资源池凭证不完整',
    };
  }

  try {
    const allDomains = await listCsmSecurityDomainsPaged(config);
    const domainRow =
      (Array.isArray(allDomains) ? allDomains : []).find((d) => idsMatch(normalizeId(d.id), linkedId)) ||
      null;

    const [allChains, allGroups, allAssets] = await Promise.all([
      listCsmServiceChains(config, {
        domain_id: linkedId,
        security_domain_id: linkedId,
        page_size: 1000,
        page_num: 1,
      }),
      listCsmElementGroups(config),
      listCsmAssets(config, { page_size: 1000, page_num: 1 }),
    ]);

    const chains = (Array.isArray(allChains) ? allChains : []).filter((c) =>
      rowBelongsToCsmDomain(c as Record<string, unknown>, linkedId, domainRow),
    );

    const assetNetworkIds = new Set<string>();
    const protectionObjects = (Array.isArray(allAssets) ? allAssets : []).filter((a) => {
      const ok = assetBelongsToCsmDomain(a as Record<string, unknown>, linkedId, domainRow);
      if (ok) {
        const nid = normalizeId((a as any).network_id ?? (a as any).id);
        if (nid) assetNetworkIds.add(nid);
      }
      return ok;
    });

    const chainByAssets = (Array.isArray(allChains) ? allChains : []).filter((c) => {
      const nids = toList((c as any).network_ids ?? (c as any).networkIds);
      return nids.some((nid) => assetNetworkIds.has(nid));
    });

    const mergedChainsMap = new Map<string, any>();
    for (const c of [...chains, ...chainByAssets]) {
      const cid = normalizeId((c as any).service_chain_id ?? (c as any).id);
      if (cid) mergedChainsMap.set(cid, c);
    }
    const serviceChains = Array.from(mergedChainsMap.values());

    const groupIdsFromChains = collectGroupIdsFromChains(serviceChains);
    const groupsById = new Map<string, any>();
    for (const g of Array.isArray(allGroups) ? allGroups : []) {
      const gid = normalizeId(
        g?.id ?? g?.vm_group_id ?? g?.vmGroupId ?? g?.vm_group_uuid ?? g?.vmGroupUuid,
      );
      if (gid) groupsById.set(gid, g);
    }

    const serviceIdSet = new Set<string>(groupIdsFromChains);
    for (const g of Array.isArray(allGroups) ? allGroups : []) {
      if (rowBelongsToCsmDomain(g as Record<string, unknown>, linkedId, domainRow)) {
        const gid = normalizeId(
          g?.id ?? g?.vm_group_id ?? g?.vmGroupId ?? g?.vm_group_uuid ?? g?.vmGroupUuid,
        );
        if (gid) serviceIdSet.add(gid);
      }
    }

    const securityServices = Array.from(serviceIdSet)
      .map((sid) => groupsById.get(sid))
      .filter(Boolean)
      .map((g) => normalizeElementGroup(g));

    return {
      linkedCsmSecurityDomainId: linkedId,
      linkedCsmSecurityDomain: domainRow,
      csmCloudId: cloud.id,
      csmProtectionObjects: protectionObjects,
      securityServices,
      serviceChains,
      csmProjectionReady: true,
    };
  } catch (e: any) {
    return {
      ...empty,
      csmCloudId: cloud.id,
      csmProjectionError: e?.message || 'CSM 投影加载失败',
    };
  }
}
