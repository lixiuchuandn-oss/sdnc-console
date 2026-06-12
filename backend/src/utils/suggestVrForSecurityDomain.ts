import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { CloudInstanceInventory } from '../entities/CloudInstanceInventory';
import { SecurityDomain } from '../entities/SecurityDomain';
import { VRCacheBasic } from '../entities/vRouter/VRCacheBasic';
import { VRConfig } from '../entities/vRouter/VRConfig';
import { callAliyunEcs, callAliyunVpc } from '../services/clouds/aliyun/client';

export type VrSuggestReason = {
  code: 'vm_id_inventory_match' | 'lan_ip_inventory_match' | 'lan_in_vpc_cidr' | 'vm_id_not_in_inventory';
  message: string;
};

export type VrSuggestItem = {
  vrUuid: string;
  name: string;
  score: number;
  reasons: VrSuggestReason[];
  instanceId?: string;
  privateIp?: string;
  vmId?: string;
};

export type SuggestVrTerminalSummary = {
  instanceId: string;
  instanceName?: string;
  privateIp?: string;
};

export type SuggestVrResult = {
  terminals: {
    count: number;
    vpcCidr?: string;
    source?: 'inventory' | 'inventory_fuzzy' | 'live_cloud_api';
    items?: SuggestVrTerminalSummary[];
  };
  suggestions: VrSuggestItem[];
  /** vm_id 已配置但未在库存命中时的提示（非推荐） */
  hints?: string[];
  autoSuggestVrUuid?: string;
};

type TerminalRow = Pick<
  CloudInstanceInventory,
  'instanceId' | 'instanceName' | 'privateIps' | 'vpcId' | 'vpcCidr'
>;

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parsePrivateIps(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
    return [String(parsed).trim()].filter(Boolean);
  } catch {
    return trimmed
      .split(/[,;，；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

/** 简易 IPv4 CIDR 包含判断（仅用于推荐打分） */
function ipv4InCidr(ip: string, cidr: string): boolean {
  const i = String(ip || '').trim();
  const c = String(cidr || '').trim();
  if (!i || !c || !c.includes('/')) return false;
  const [netStr, prefixStr] = c.split('/');
  const prefix = Number(prefixStr);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
  const toInt = (addr: string) => {
    const parts = addr.split('.').map((x) => Number(x));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };
  const ipInt = toInt(i);
  const netInt = toInt(netStr);
  if (ipInt == null || netInt == null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function extractLanIp(basic: Record<string, any>, vrConfig: VRConfig | null | undefined): string {
  if (vrConfig?.config_json) {
    const cfg = safeJsonParse<Record<string, any>>(vrConfig.config_json, {});
    const lan = cfg.lan_ip || cfg.private_ip || cfg.lanIp || cfg.privateIp;
    if (lan) return String(Array.isArray(lan) ? lan[0] : lan).trim();
  }
  const lan = basic.lan_ip || basic.private_ip || basic.lanIp || basic.privateIp;
  if (lan) return String(Array.isArray(lan) ? lan[0] : lan).trim();
  return '';
}

function plausibleVmId(vmId: string, vrUuid: string): boolean {
  const v = String(vmId || '').trim();
  const u = String(vrUuid || '').trim();
  if (!v) return false;
  if (v === u) return false;
  return true;
}

/** VPC ID 精确或前缀兼容（表单展示截断 vs 库存全量 ID） */
function vpcIdsMatch(stored: string | null | undefined, selected: string): boolean {
  const a = String(stored || '').trim();
  const b = String(selected || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length >= 8 && a.startsWith(b)) return true;
  if (a.length >= 8 && b.startsWith(a)) return true;
  return false;
}

async function fetchAliyunTerminalsForVpc(cloud: Cloud, vpcId: string): Promise<TerminalRow[]> {
  if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return [];
  const resp: any = await callAliyunEcs({
    accessKeyId: cloud.accessKey,
    accessKeySecret: cloud.secretKey,
    regionId: cloud.region,
    action: 'DescribeInstances',
    extraParams: { PageNumber: 1, PageSize: 100 },
  } as any);
  const list: any[] = resp?.Instances?.Instance || [];
  let vpcCidr = '';
  try {
    const vpcResp: any = await callAliyunVpc({
      accessKeyId: cloud.accessKey,
      accessKeySecret: cloud.secretKey,
      regionId: cloud.region,
      action: 'DescribeVpcAttribute',
      extraParams: { VpcId: vpcId },
    } as any);
    vpcCidr = String(vpcResp?.CidrBlock || vpcResp?.Vpc?.CidrBlock || '').trim();
  } catch {
    // ignore
  }

  const rows: TerminalRow[] = [];
  for (const r of Array.isArray(list) ? list : []) {
    const vid = String(r?.VpcId || r?.VpcAttributes?.VpcId || '').trim();
    if (!vpcIdsMatch(vid, vpcId)) continue;
    const pri: any[] = r?.VpcAttributes?.PrivateIpAddress?.IpAddress || [];
    rows.push({
      instanceId: String(r?.InstanceId || '').trim(),
      instanceName: String(r?.InstanceName || r?.HostName || r?.InstanceId || '').trim(),
      privateIps: JSON.stringify(Array.isArray(pri) ? pri : []),
      vpcId: vid || vpcId,
      vpcCidr: vpcCidr || undefined,
    });
  }
  return rows.filter((x) => x.instanceId);
}

function inventoryToTerminalRow(row: CloudInstanceInventory): TerminalRow {
  return {
    instanceId: row.instanceId,
    instanceName: row.instanceName,
    privateIps: row.privateIps,
    vpcId: row.vpcId,
    vpcCidr: row.vpcCidr,
  };
}

async function resolveTerminalRows(
  cloudId: string,
  vpcId: string,
  vpcCidrHint?: string,
): Promise<{
  rows: TerminalRow[];
  vpcCidr?: string;
  source?: 'inventory' | 'inventory_fuzzy' | 'live_cloud_api';
}> {
  const invRepo = AppDataSource.getRepository(CloudInstanceInventory);
  let rows: TerminalRow[] = (await invRepo.find({ where: { cloudId, vpcId } })).map(
    inventoryToTerminalRow,
  );
  let source: 'inventory' | 'inventory_fuzzy' | 'live_cloud_api' = 'inventory';

  if (!rows.length) {
    const all = await invRepo.find({ where: { cloudId } });
    rows = all.filter((r) => vpcIdsMatch(r.vpcId, vpcId)).map(inventoryToTerminalRow);
    if (rows.length) source = 'inventory_fuzzy';
  }

  if (!rows.length) {
    const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id: cloudId } });
    const provider = String(cloud?.config?.provider || (cloud as any)?.provider || '').toLowerCase();
    if (cloud && provider === 'aliyun') {
      const live = await fetchAliyunTerminalsForVpc(cloud, vpcId);
      if (live.length) {
        rows = live;
        source = 'live_cloud_api';
      }
    }
  }

  let vpcCidr = String(vpcCidrHint || '').trim();
  for (const row of rows) {
    if (!vpcCidr && row.vpcCidr) vpcCidr = String(row.vpcCidr).trim();
  }

  return { rows, vpcCidr: vpcCidr || undefined, source };
}

export async function suggestVrForSecurityDomain(params: {
  cloudId: string;
  vpcId: string;
  tenantId?: string;
  organizationId?: string;
  excludeDomainId?: string;
  vpcCidr?: string;
}): Promise<SuggestVrResult> {
  const cloudId = String(params.cloudId || '').trim();
  const vpcId = String(params.vpcId || '').trim();
  if (!cloudId || !vpcId) {
    return { terminals: { count: 0 }, suggestions: [] };
  }

  const { rows: inventoryRows, vpcCidr, source: terminalSource } = await resolveTerminalRows(
    cloudId,
    vpcId,
    params.vpcCidr,
  );

  const instanceById = new Map<string, TerminalRow>();
  const allPrivateIps: string[] = [];
  for (const row of inventoryRows) {
    if (row.instanceId) instanceById.set(String(row.instanceId).trim(), row);
    allPrivateIps.push(...parsePrivateIps(row.privateIps));
  }

  const boundElsewhere = new Set<string>();
  const domains = await AppDataSource.getRepository(SecurityDomain).find();
  for (const d of domains) {
    if (params.excludeDomainId && d.id === params.excludeDomainId) continue;
    const vu = String(d.vrUuid || '').trim();
    if (vu) boundElsewhere.add(vu);
  }

  const basicRows = await AppDataSource.getRepository(VRCacheBasic).find();
  const vrConfigs = await AppDataSource.getRepository(VRConfig).find();
  const configByUuid = new Map(vrConfigs.map((c) => [String(c.uuid).trim(), c]));

  const suggestions: VrSuggestItem[] = [];
  const hints: string[] = [];

  for (const basicRow of basicRows) {
    const vrUuid = String(basicRow.uuid || '').trim();
    if (!vrUuid || boundElsewhere.has(vrUuid)) continue;

    const basic = safeJsonParse<Record<string, any>>(basicRow.data, {});
    if (basic.is_deleted) continue;

    const vrConfig = configByUuid.get(vrUuid);
    const vmIdRaw = String(basic.vm_id || vrConfig?.vmId || '').trim();
    const name = String(basic.name || vrConfig?.name || vrUuid || '未命名VR').trim();
    const lanIp = extractLanIp(basic, vrConfig);

    const reasons: VrSuggestReason[] = [];
    let score = 0;
    let instanceId: string | undefined;
    let privateIp: string | undefined;

    if (plausibleVmId(vmIdRaw, vrUuid)) {
      const inv = instanceById.get(vmIdRaw);
      if (inv) {
        score = 100;
        instanceId = vmIdRaw;
        reasons.push({
          code: 'vm_id_inventory_match',
          message: `VR 本地 vm_id 与云主机 ${vmIdRaw} 一致（同 VPC）`,
        });
        const ips = parsePrivateIps(inv.privateIps);
        if (ips[0]) privateIp = ips[0];
      } else {
        hints.push(
          `${name}：已配置 vm_id ${vmIdRaw}，但当前 VPC 库存中未找到（请同步云资源池或核对实例是否在所选 VPC）`,
        );
      }
    }

    if (lanIp) {
      for (const row of inventoryRows) {
        const ips = parsePrivateIps(row.privateIps);
        if (ips.includes(lanIp)) {
          const bump = score < 100 ? 88 : 0;
          if (bump > 0) score = Math.max(score, bump);
          if (!instanceId && row.instanceId) instanceId = String(row.instanceId);
          privateIp = lanIp;
          if (!reasons.some((r) => r.code === 'vm_id_inventory_match')) {
            reasons.push({
              code: 'lan_ip_inventory_match',
              message: `私网 IP ${lanIp} 与云主机 ${row.instanceName || row.instanceId || '—'} 一致`,
            });
          }
          break;
        }
      }
      if (vpcCidr && ipv4InCidr(lanIp, vpcCidr) && score < 70) {
        score = Math.max(score, 70);
        privateIp = privateIp || lanIp;
        if (!reasons.some((r) => r.code.startsWith('lan_'))) {
          reasons.push({
            code: 'lan_in_vpc_cidr',
            message: `私网 IP ${lanIp} 落在 VPC ${vpcCidr} 内`,
          });
        }
      }
    }

    if (score <= 0) continue;

    suggestions.push({
      vrUuid,
      name,
      score,
      reasons,
      instanceId,
      privateIp,
      vmId: plausibleVmId(vmIdRaw, vrUuid) ? vmIdRaw : undefined,
    });
  }

  suggestions.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  let autoSuggestVrUuid: string | undefined;
  const top = suggestions.filter((s) => s.score >= 95);
  if (top.length === 1) {
    autoSuggestVrUuid = top[0].vrUuid;
  }

  const terminalItems: SuggestVrTerminalSummary[] = inventoryRows.map((row) => {
    const ips = parsePrivateIps(row.privateIps);
    return {
      instanceId: String(row.instanceId || '').trim(),
      instanceName: row.instanceName ? String(row.instanceName).trim() : undefined,
      privateIp: ips[0],
    };
  }).filter((x) => x.instanceId);

  return {
    terminals: {
      count: inventoryRows.length,
      vpcCidr: vpcCidr || undefined,
      source: terminalSource,
      items: terminalItems.length ? terminalItems : undefined,
    },
    suggestions,
    hints: hints.length ? hints : undefined,
    autoSuggestVrUuid,
  };
}
