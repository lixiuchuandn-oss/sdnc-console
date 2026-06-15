/**
 * 将 Tower 安全组（规则 + 成员）展开后合并写入扁平子网 Subnet.spec.acls。
 * 使用固定 priority 区间 [TOWER_SG_ACL_PRIORITY_MIN, TOWER_SG_ACL_PRIORITY_MAX] 标识本服务下发项，
 * 合并时先剔除该区间内旧条目，再追加新展开规则，避免覆盖子网上用户手写 ACL。
 */
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { HarvesterVmInventory } from '../../../entities/harvester/HarvesterVmInventory';
import { HarvesterVmiInventory } from '../../../entities/harvester/HarvesterVmiInventory';
import { listSecurityGroupCrsForSubnetPush } from './kubeOvnSecurityGroupCrService';
import { resolveHarvesterK8sApiBase } from '../../../routes/clouds/harvester/harvester.direct.helpers';
import { logger } from '../../../utils/logger';
import { parseKubeOvnAclRulesInput } from './kubeOvnAclRules';
import { updateHarvesterSubnet } from './network';
import { getJsonOnce } from './utils';
import type { KubeOvnAclRuleRow } from './kubeOvnAclRules';

const sgAclLog = logger.child('KubeOvn-SG-ACL');

export const TOWER_SG_ACL_PRIORITY_MIN = 31000;
export const TOWER_SG_ACL_PRIORITY_MAX = 39999;

const vmInvRepo = () => AppDataSource.getRepository(HarvesterVmInventory);
const vmiInvRepo = () => AppDataSource.getRepository(HarvesterVmiInventory);

function nadRefMatchesSubnet(netName: string, subnetName: string): boolean {
  const sn = subnetName.toLowerCase();
  const s = String(netName || '').toLowerCase();
  const base = s.includes('@') ? s.split('@')[0] : s;
  return base === `default/${sn}` || base.endsWith(`/${sn}`);
}

function normalizeIpv4(ip: unknown): string | null {
  const raw = String(ip ?? '')
    .trim()
    .split('/')[0];
  if (!raw || !/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return null;
  return raw;
}

/**
 * 与 listHarvesterVMsStandard 一致：运行中网卡 IP 多在 VirtualMachineInstance.status.interfaces，
 * VirtualMachine.status.interfaces 可能为空或不及时，故合并 VMI（同名接口以 VMI 覆盖 VM）。
 */
function mergeVmVmiStatusInterfaces(vmRaw: any, vmiRaw: any): any[] {
  const byName = new Map<string, any>();
  for (const i of Array.isArray(vmRaw?.status?.interfaces) ? vmRaw.status.interfaces : []) {
    if (i?.name != null && String(i.name).length > 0) byName.set(String(i.name), i);
  }
  for (const i of Array.isArray(vmiRaw?.status?.interfaces) ? vmiRaw.status.interfaces : []) {
    if (i?.name != null && String(i.name).length > 0) byName.set(String(i.name), i);
  }
  return Array.from(byName.values());
}

/**
 * 从 VM 清单行或 KubeVirt VirtualMachine JSON 解析连接指定扁平子网（NAD 名与 subnet metadata.name 一致）的网卡 IPv4。
 * @param vmiLike 可选：VirtualMachineInstance 对象或库存行（含 rawData）；用于读取运行时 IP。
 */
export function findVmIpv4OnFlatSubnet(
  vmLike: HarvesterVmInventory | Record<string, unknown>,
  subnetName: string,
  vmiLike?: Record<string, unknown> | null,
): string | null {
  const row = vmLike as HarvesterVmInventory & { rawData?: unknown };
  const raw =
    row?.rawData !== undefined && row?.rawData !== null
      ? row.rawData
      : (vmLike as Record<string, unknown>);
  const vmiRow = vmiLike as
    | (HarvesterVmiInventory & { rawData?: unknown })
    | Record<string, unknown>
    | null
    | undefined;
  const vmiRaw =
    vmiRow && typeof vmiRow === 'object' && 'rawData' in vmiRow && (vmiRow as any).rawData != null
      ? (vmiRow as any).rawData
      : vmiLike || null;

  const tpl = row?.template || (raw as any)?.spec?.template;
  const networks: any[] = Array.isArray(tpl?.spec?.networks) ? tpl.spec.networks : [];
  const domainIfaces: any[] = Array.isArray(tpl?.spec?.domain?.devices?.interfaces)
    ? tpl.spec.domain.devices.interfaces
    : [];
  const statusIfaces = mergeVmVmiStatusInterfaces(raw, vmiRaw);

  for (const net of networks) {
    const nn = net?.multus?.networkName;
    if (!nn || !nadRefMatchesSubnet(nn, subnetName)) continue;
    const logicalName = net?.name;
    if (!logicalName) continue;
    const domainIface = domainIfaces.find((d: any) => d?.name === logicalName);
    const bindName = domainIface?.name || logicalName;
    for (const iface of statusIfaces) {
      if (iface?.name !== bindName) continue;
      const ip = normalizeIpv4(iface?.ipAddress ?? iface?.ip);
      if (ip) return ip;
    }
  }
  return null;
}

function expandRuleForMemberIp(
  rule: { direction: string; action: string; match: string },
  ip: string,
): KubeOvnAclRuleRow {
  const base = String(rule.match || '').trim();
  if (rule.direction === 'from-lport') {
    const match = base ? `${base} && ip4.dst == ${ip}` : `ip4.dst == ${ip}`;
    return { action: rule.action, direction: rule.direction, match, priority: 0 };
  }
  if (rule.direction === 'to-lport') {
    const match = base ? `${base} && ip4.src == ${ip}` : `ip4.src == ${ip}`;
    return { action: rule.action, direction: rule.direction, match, priority: 0 };
  }
  return {
    action: rule.action,
    direction: rule.direction,
    match: base,
    priority: 0,
  };
}

function filterNonTowerAcls(existing: unknown[]): KubeOvnAclRuleRow[] {
  const out: KubeOvnAclRuleRow[] = [];
  for (const a of existing) {
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    const p = Number(o.priority);
    if (Number.isFinite(p) && p >= TOWER_SG_ACL_PRIORITY_MIN && p <= TOWER_SG_ACL_PRIORITY_MAX) {
      continue;
    }
    const action = String(o.action ?? '').trim();
    const direction = String(o.direction ?? '').trim();
    const match = String(o.match ?? '').trim();
    if (!action || !direction || !match) continue;
    out.push({
      action,
      direction,
      match,
      priority: Number.isFinite(p) ? p : 0,
    });
  }
  return out;
}

/**
 * 按云 + 扁平子网名，展开该子网下所有安全组并 PUT 合并后的 spec.acls。
 */
export async function pushFlatSubnetAclsFromTowerSecurityGroups(
  cloud: Cloud,
  cloudId: string,
  subnetName: string,
): Promise<
  { ok: true; expandedCount: number; keptCount: number } | { ok: false; message: string }
> {
  const subnet = String(subnetName || '').trim();
  if (!subnet) {
    sgAclLog.warn('push 跳过: 子网名为空', { cloudId });
    return { ok: false, message: '子网名为空' };
  }

  const token = cloud.secretKey || '';
  if (!token) {
    sgAclLog.warn('push 跳过: 云未配置 secretKey', { cloudId, subnet });
    return { ok: false, message: '云环境未配置访问凭据，无法下发 ACL' };
  }
  const insecure = !!(cloud.config as any)?.ignoreTls;

  const apiBase = resolveHarvesterK8sApiBase(cloud.endpoint || '');
  let endpointHost = '';
  try {
    endpointHost = new URL(cloud.endpoint || 'http://x').host;
  } catch {
    endpointHost = '(unparsed)';
  }

  sgAclLog.info(
    '安全组 ACL 下发开始（与「扁平子网-编辑 ACL」不同：此处由规则×成员展开后合并写入 Subnet）',
    {
      cloudId,
      subnet,
      apiBase,
      endpointHost,
      note: '扁平子网编辑 ACL = 直接 PUT Subnet.spec.acls；安全组 = SecurityGroup CR 规则+成员 → 展开为每成员 IP 的 ACL 再 PUT',
    },
  );

  const getUrl = `${apiBase}/apis/kubeovn.io/v1/subnets/${encodeURIComponent(subnet)}`;
  let current: any;
  try {
    current = await getJsonOnce(getUrl, token, insecure);
  } catch (e: any) {
    const msg = e?.message || String(e);
    sgAclLog.warn('读取 Subnet 失败', { cloudId, subnet, getUrl, err: msg });
    return { ok: false, message: `读取子网 ${subnet} 失败，无法下发 ACL：${msg}` };
  }
  if (!current) {
    sgAclLog.warn('Subnet 响应为空', { cloudId, subnet, getUrl });
    return { ok: false, message: `集群中未找到子网 ${subnet}，无法下发 ACL` };
  }

  const existingRaw = Array.isArray(current.spec?.acls) ? current.spec.acls : [];
  const kept = filterNonTowerAcls(existingRaw);
  const towerRangeBefore = existingRaw.filter((a: any) => {
    const p = Number(a?.priority);
    return Number.isFinite(p) && p >= TOWER_SG_ACL_PRIORITY_MIN && p <= TOWER_SG_ACL_PRIORITY_MAX;
  }).length;

  const listed = await listSecurityGroupCrsForSubnetPush(cloud, cloudId, subnet);
  if (!listed.ok) {
    sgAclLog.warn('读取 SecurityGroup CR 失败', { cloudId, subnet, message: listed.message });
    return { ok: false, message: listed.message };
  }
  const groups = listed.groups;

  sgAclLog.info('子网与安全组 CR 快照', {
    cloudId,
    subnet,
    resourceVersion: current?.metadata?.resourceVersion,
    specAclTotal: existingRaw.length,
    nonTowerKept: kept.length,
    towerPriorityRangeAclsBefore: towerRangeBefore,
    towerSecurityGroupCount: groups.length,
  });

  const expanded: KubeOvnAclRuleRow[] = [];
  let pri = TOWER_SG_ACL_PRIORITY_MIN;

  let statSkipEmptyGroup = 0;
  let statPairsConsidered = 0;
  let statSkipNoVm = 0;
  let statSkipNoIp = 0;
  let statVmFromInventory = 0;
  let statVmFromLive = 0;
  let statLiveFetchFail = 0;

  for (const g of groups) {
    const rules = g.rules;
    const members = g.members;
    if (rules.length === 0 || members.length === 0) {
      statSkipEmptyGroup += 1;
      sgAclLog.debug('安全组跳过展开（缺规则或缺成员）', {
        sgId: g.id,
        sgName: g.name,
        rules: rules.length,
        members: members.length,
      });
      continue;
    }

    for (const rule of rules) {
      for (const m of members) {
        statPairsConsidered += 1;
        let fromInv = false;
        let vmLike: HarvesterVmInventory | Record<string, unknown> | null =
          (await vmInvRepo().findOne({
            where: { cloudId, namespace: m.vmNamespace, name: m.vmName },
          })) || null;
        if (vmLike) fromInv = true;
        if (!vmLike) {
          try {
            const vmUrl = `${apiBase}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(m.vmNamespace)}/virtualmachines/${encodeURIComponent(m.vmName)}`;
            vmLike = await getJsonOnce(vmUrl, token, insecure, true);
          } catch (err: any) {
            statLiveFetchFail += 1;
            vmLike = null;
            sgAclLog.debug('集群拉取 VM 失败', {
              vm: `${m.vmNamespace}/${m.vmName}`,
              err: err?.message || String(err),
            });
          }
        }
        if (!vmLike) {
          statSkipNoVm += 1;
          continue;
        }
        if (fromInv) statVmFromInventory += 1;
        else statVmFromLive += 1;

        let vmiForIp: Record<string, unknown> | null | undefined;
        const vmiInv = await vmiInvRepo().findOne({
          where: { cloudId, namespace: m.vmNamespace, name: m.vmName },
        });
        if (vmiInv) vmiForIp = vmiInv as unknown as Record<string, unknown>;

        let ip = findVmIpv4OnFlatSubnet(vmLike, subnet, vmiForIp);
        if (!ip) {
          try {
            const vmiUrl = `${apiBase}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(m.vmNamespace)}/virtualmachineinstances/${encodeURIComponent(m.vmName)}`;
            const vmiJson = await getJsonOnce(vmiUrl, token, insecure, true);
            if (vmiJson) {
              ip = findVmIpv4OnFlatSubnet(vmLike, subnet, vmiJson);
            }
          } catch {
            /* 忽略：VM 关机时无 VMI */
          }
        }
        if (!ip) {
          statSkipNoIp += 1;
          sgAclLog.debug(
            '无法在扁平子网上解析成员网卡 IPv4（已合并 VM+VMI status.interfaces；请确认 multus.networkName 指向该子网、网卡名与 domain 一致、VM 运行中）',
            {
              subnet,
              vm: `${m.vmNamespace}/${m.vmName}`,
              sgName: g.name,
            },
          );
          continue;
        }
        if (pri > TOWER_SG_ACL_PRIORITY_MAX) {
          sgAclLog.warn('展开条数超过优先级上限', { cloudId, subnet });
          return { ok: false, message: '展开后的 ACL 条数超出单个子网可分配优先级上限' };
        }
        const row = expandRuleForMemberIp(rule, ip);
        expanded.push({ ...row, priority: pri });
        pri += 1;
      }
    }
  }

  sgAclLog.info('安全组 → ACL 展开统计', {
    cloudId,
    subnet,
    ruleMemberPairs: statPairsConsidered,
    expandedAclRows: expanded.length,
    skippedNoVmRecord: statSkipNoVm,
    skippedNoIpOnSubnet: statSkipNoIp,
    vmResolvedFromInventory: statVmFromInventory,
    vmResolvedFromClusterApi: statVmFromLive,
    liveVmFetchFailures: statLiveFetchFail,
    skippedGroupsNoRulesOrNoMembers: statSkipEmptyGroup,
  });

  const merged = [...kept, ...expanded];
  const parsed = parseKubeOvnAclRulesInput(merged, 'acls');
  if (!parsed.ok) {
    sgAclLog.warn('合并后 ACL 校验失败', { cloudId, subnet, message: parsed.message });
    return { ok: false, message: parsed.message };
  }

  try {
    await updateHarvesterSubnet({ endpoint: cloud.endpoint, token, insecure }, subnet, {
      acls: parsed.value,
    });
    sgAclLog.info('安全组 ACL 下发成功', {
      cloudId,
      subnet,
      putAclsTotal: parsed.value.length,
      expandedCount: expanded.length,
      keptNonTowerCount: kept.length,
    });
    return { ok: true, expandedCount: expanded.length, keptCount: kept.length };
  } catch (e: any) {
    const msg = e?.message || String(e);
    sgAclLog.warn('PUT Subnet.spec.acls 失败', { cloudId, subnet, err: msg });
    return { ok: false, message: `下发子网 ACL 失败：${msg}` };
  }
}
