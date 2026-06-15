/**
 * Kube-OVN 扁平子网安全组：权威数据源为集群 SecurityGroup CR（securitygroups.hms.rivercloud.com）。
 */
import { randomUUID } from 'crypto';
import { AppDataSource } from '../../../config/database';
import { KubeOvnSubnetInventory } from '../../../entities/kubeovn/KubeOvnSubnetInventory';
import {
  createSecurityGroupCr,
  deleteSecurityGroupCr,
  filterSecurityGroupCrsByCloudId,
  getSecurityGroupCr,
  listSecurityGroupCrs,
  updateSecurityGroupCr,
  type SecurityGroupCrMemberInput,
  type SecurityGroupCrRuleInput,
  type SecurityGroupCrSpecInput,
} from '../../hms/securityGroupCr';
import {
  parseKubeOvnAclRulesInput,
  securityGroupAclSemanticsError,
} from './kubeOvnAclRules';

const SUBNET_TYPE_KEY = 'tower.io/subnet-type';
const SG_NAME_MAX_LEN = 128;

export type HarvesterCloudRef = {
  id: string;
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
};

export type SecurityGroupListRow = {
  id: string;
  name: string;
  description: string;
  subnetName: string;
  ruleCount: number;
  memberCount: number;
  updatedAt: string;
};

export type SecurityGroupRuleDto = {
  id: string;
  priority: number;
  direction: string;
  action: string;
  match: string;
};

export type SecurityGroupMemberDto = {
  id: string;
  vmNamespace: string;
  vmName: string;
  createdAt: string;
};

export type SecurityGroupDetailDto = SecurityGroupListRow & {
  rules: SecurityGroupRuleDto[];
  members: SecurityGroupMemberDto[];
};

const subnetRepo = () => AppDataSource.getRepository(KubeOvnSubnetInventory);

function isFlatSubnetRow(inv: KubeOvnSubnetInventory): boolean {
  const ann =
    inv.annotations ||
    (inv.rawData?.metadata?.annotations as Record<string, string> | undefined) ||
    {};
  return (
    String(ann[SUBNET_TYPE_KEY] || '')
      .trim()
      .toLowerCase() === 'flat'
  );
}

export function validateSecurityGroupName(name: string): string | null {
  const n = String(name || '').trim();
  if (!n) return '名称不能为空';
  if (n.length > SG_NAME_MAX_LEN) return `名称最长 ${SG_NAME_MAX_LEN} 字符`;
  return null;
}

const K8S_DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function validateVmDnsLabel(label: string, fieldLabel: string): string | null {
  const s = String(label || '').trim();
  if (!s) return `${fieldLabel}不能为空`;
  if (s.length > 63) return `${fieldLabel}最长 63 字符`;
  if (!K8S_DNS_LABEL.test(s)) return `${fieldLabel}须为小写字母、数字、连字符（DNS 标签）`;
  return null;
}

async function assertSecurityGroupCrApi(cloud: HarvesterCloudRef) {
  const listed = await listSecurityGroupCrs(cloud);
  if (!listed.apiAvailable) {
    throw Object.assign(
      new Error(
        listed.error ||
          '无法从集群拉取 SecurityGroup 列表，请确认已安装 securitygroups.hms.rivercloud.com CRD。',
      ),
      { status: 503 },
    );
  }
  return listed;
}

function crUpdatedAt(cr: any): string {
  const ts =
    cr?.metadata?.managedFields?.[0]?.time ||
    cr?.metadata?.creationTimestamp ||
    cr?.metadata?.generation;
  if (ts) return String(ts);
  return new Date().toISOString();
}

function mapCrRuleToDto(rule: SecurityGroupCrRuleInput, index: number): SecurityGroupRuleDto {
  const id =
    String(rule.id || '').trim() ||
    `rule-${rule.priority}-${rule.direction}-${index}`;
  return {
    id,
    priority: Number(rule.priority),
    direction: String(rule.direction),
    action: String(rule.action),
    match: String(rule.match),
  };
}

function mapCrMemberToDto(member: SecurityGroupCrMemberInput): SecurityGroupMemberDto {
  const vmNamespace = String(member.vmNamespace || '').trim();
  const vmName = String(member.vmName || '').trim();
  const id = String(member.id || '').trim() || `${vmNamespace}/${vmName}`;
  return {
    id,
    vmNamespace,
    vmName,
    createdAt: '',
  };
}

function crItemToListRow(cr: any): SecurityGroupListRow | null {
  const id = String(cr?.metadata?.name || '').trim();
  if (!id) return null;
  const spec = cr?.spec || {};
  const rules = Array.isArray(spec.rules) ? spec.rules : [];
  const members = Array.isArray(spec.members) ? spec.members : [];
  return {
    id,
    name: String(spec.name || id),
    description: String(spec.description || ''),
    subnetName: String(spec.subnetName || ''),
    ruleCount: rules.length,
    memberCount: members.length,
    updatedAt: crUpdatedAt(cr),
  };
}

function crItemToDetail(cr: any): SecurityGroupDetailDto | null {
  const row = crItemToListRow(cr);
  if (!row) return null;
  const spec = cr?.spec || {};
  const rules = Array.isArray(spec.rules) ? spec.rules : [];
  const members = Array.isArray(spec.members) ? spec.members : [];
  return {
    ...row,
    rules: rules.map((r: SecurityGroupCrRuleInput, i: number) => mapCrRuleToDto(r, i)),
    members: members.map((m: SecurityGroupCrMemberInput) => mapCrMemberToDto(m)),
  };
}

async function loadCrItemsForCloud(cloud: HarvesterCloudRef, cloudId: string): Promise<any[]> {
  const listed = await assertSecurityGroupCrApi(cloud);
  return filterSecurityGroupCrsByCloudId(listed.items, cloudId);
}

async function getCrForCloud(cloud: HarvesterCloudRef, cloudId: string, sgId: string): Promise<any> {
  const id = String(sgId || '').trim();
  if (!id) throw Object.assign(new Error('缺少安全组标识'), { status: 400 });
  try {
    const cr = await getSecurityGroupCr(cloud, id);
    const specCloud = String(cr?.spec?.cloudId || '').trim();
    const labelCloud = String(cr?.metadata?.labels?.['tower.io/cloud-id'] || '').trim();
    if (specCloud !== cloudId && labelCloud !== cloudId) {
      throw Object.assign(new Error('安全组不存在'), { status: 404 });
    }
    return cr;
  } catch (e: any) {
    if (Number(e?.status) === 404) {
      throw Object.assign(new Error('安全组不存在'), { status: 404 });
    }
    throw e;
  }
}

function buildSpecFromCr(cr: any, cloudId: string): SecurityGroupCrSpecInput {
  const spec = cr?.spec || {};
  return {
    id: String(spec.id || cr?.metadata?.name || '').trim(),
    cloudId,
    name: String(spec.name || '').trim(),
    description: String(spec.description || '').trim() || undefined,
    subnetName: String(spec.subnetName || '').trim(),
    rules: Array.isArray(spec.rules) ? spec.rules : [],
    members: Array.isArray(spec.members) ? spec.members : [],
  };
}

export async function listKubeOvnSecurityGroups(
  cloud: HarvesterCloudRef,
  cloudId: string,
): Promise<SecurityGroupListRow[]> {
  const items = await loadCrItemsForCloud(cloud, cloudId);
  return items
    .map(crItemToListRow)
    .filter((row): row is SecurityGroupListRow => !!row)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getKubeOvnSecurityGroupDetail(
  cloud: HarvesterCloudRef,
  cloudId: string,
  sgId: string,
): Promise<SecurityGroupDetailDto> {
  const cr = await getCrForCloud(cloud, cloudId, sgId);
  const detail = crItemToDetail(cr);
  if (!detail) throw Object.assign(new Error('安全组不存在'), { status: 404 });
  return detail;
}

export async function assertFlatSubnetForSecurityGroup(cloudId: string, subnetName: string) {
  const subnet = String(subnetName || '').trim();
  if (!subnet) throw Object.assign(new Error('须选择扁平子网（subnetName）'), { status: 400 });
  const inv = await subnetRepo().findOne({ where: { cloudId, name: subnet } });
  if (!inv) {
    throw Object.assign(new Error(`子网不存在或未同步到 Tower：${subnet}`), { status: 400 });
  }
  if (!isFlatSubnetRow(inv)) {
    throw Object.assign(
      new Error('安全组仅支持注解 tower.io/subnet-type=flat 的扁平子网'),
      { status: 400 },
    );
  }
}

export async function createKubeOvnSecurityGroup(
  cloud: HarvesterCloudRef,
  cloudId: string,
  input: { name: string; description?: string; subnetName: string },
): Promise<SecurityGroupListRow> {
  const nameErr = validateSecurityGroupName(input.name);
  if (nameErr) throw Object.assign(new Error(nameErr), { status: 400 });

  const name = String(input.name).trim();
  const subnetName = String(input.subnetName || '').trim();
  await assertFlatSubnetForSecurityGroup(cloudId, subnetName);

  const existing = await loadCrItemsForCloud(cloud, cloudId);
  const dup = existing.find(
    (cr) =>
      String(cr?.spec?.subnetName || '') === subnetName &&
      String(cr?.spec?.name || '') === name,
  );
  if (dup) {
    throw Object.assign(new Error(`该子网下已存在同名安全组：${name}`), { status: 409 });
  }

  const id = randomUUID();
  const description =
    input.description === undefined || input.description === null
      ? undefined
      : String(input.description).trim() || undefined;

  await createSecurityGroupCr(cloud, {
    name: id,
    spec: {
      id,
      cloudId,
      name,
      description,
      subnetName,
      rules: [],
      members: [],
    },
  });

  const cr = await getSecurityGroupCr(cloud, id);
  const row = crItemToListRow(cr);
  if (!row) throw Object.assign(new Error('创建后读取 SecurityGroup CR 失败'), { status: 500 });
  return row;
}

export async function updateKubeOvnSecurityGroup(
  cloud: HarvesterCloudRef,
  cloudId: string,
  sgId: string,
  input: { name?: string; description?: string | null },
): Promise<SecurityGroupListRow> {
  const cr = await getCrForCloud(cloud, cloudId, sgId);
  const spec = buildSpecFromCr(cr, cloudId);

  if (input.name != null) {
    const nameErr = validateSecurityGroupName(String(input.name));
    if (nameErr) throw Object.assign(new Error(nameErr), { status: 400 });
    const newName = String(input.name).trim();
    if (newName !== spec.name) {
      const items = await loadCrItemsForCloud(cloud, cloudId);
      const dup = items.find(
        (item) =>
          String(item?.spec?.subnetName || '') === spec.subnetName &&
          String(item?.spec?.name || '') === newName &&
          String(item?.metadata?.name || '') !== sgId,
      );
      if (dup) {
        throw Object.assign(new Error(`该子网下已存在同名安全组：${newName}`), { status: 409 });
      }
      spec.name = newName;
    }
  }

  if (input.description !== undefined) {
    const d = input.description;
    spec.description =
      d === null || d === undefined || String(d).trim() === '' ? undefined : String(d).trim();
  }

  await updateSecurityGroupCr(cloud, sgId, { spec });
  const updated = await getSecurityGroupCr(cloud, sgId);
  const row = crItemToListRow(updated);
  if (!row) throw Object.assign(new Error('更新后读取 SecurityGroup CR 失败'), { status: 500 });
  return row;
}

export async function replaceKubeOvnSecurityGroupRules(
  cloud: HarvesterCloudRef,
  cloudId: string,
  sgId: string,
  rulesInput: unknown,
): Promise<{ detail: SecurityGroupDetailDto; rules: SecurityGroupRuleDto[] }> {
  const cr = await getCrForCloud(cloud, cloudId, sgId);
  const spec = buildSpecFromCr(cr, cloudId);

  const parsed = parseKubeOvnAclRulesInput(rulesInput, 'rules');
  if (!parsed.ok) throw Object.assign(new Error(parsed.message), { status: 400 });

  for (let i = 0; i < parsed.value.length; i++) {
    const row = parsed.value[i];
    const sem = securityGroupAclSemanticsError(row.direction, row.match);
    if (sem) throw Object.assign(new Error(`rules[${i}]: ${sem}`), { status: 400 });
  }

  const rules: SecurityGroupCrRuleInput[] = parsed.value.map((row) => ({
    id: randomUUID(),
    priority: row.priority,
    direction: row.direction,
    action: row.action,
    match: row.match,
  }));

  spec.rules = rules;
  await updateSecurityGroupCr(cloud, sgId, { spec });

  const updated = await getSecurityGroupCr(cloud, sgId);
  const detail = crItemToDetail(updated);
  if (!detail) throw Object.assign(new Error('保存后读取 SecurityGroup CR 失败'), { status: 500 });
  return { detail, rules: detail.rules };
}

export async function deleteKubeOvnSecurityGroup(
  cloud: HarvesterCloudRef,
  cloudId: string,
  sgId: string,
): Promise<{ subnetName: string }> {
  const cr = await getCrForCloud(cloud, cloudId, sgId);
  const subnetName = String(cr?.spec?.subnetName || '').trim();
  await deleteSecurityGroupCr(cloud, sgId);
  return { subnetName };
}

export async function addKubeOvnSecurityGroupMembers(
  cloud: HarvesterCloudRef,
  cloudId: string,
  sgId: string,
  items: { vmNamespace: string; vmName: string }[],
): Promise<{ detail: SecurityGroupDetailDto; members: SecurityGroupMemberDto[] }> {
  const cr = await getCrForCloud(cloud, cloudId, sgId);
  const spec = buildSpecFromCr(cr, cloudId);
  const members: SecurityGroupCrMemberInput[] = Array.isArray(spec.members) ? [...spec.members] : [];

  for (const it of items) {
    const vmNamespace = String(it.vmNamespace || '').trim();
    const vmName = String(it.vmName || '').trim();
    const dup = members.find((m) => m.vmNamespace === vmNamespace && m.vmName === vmName);
    if (dup) {
      throw Object.assign(
        new Error(`虚拟机已在该安全组中：${vmNamespace}/${vmName}`),
        { status: 409 },
      );
    }
    members.push({
      id: randomUUID(),
      vmNamespace,
      vmName,
    });
  }

  spec.members = members;
  await updateSecurityGroupCr(cloud, sgId, { spec });

  const updated = await getSecurityGroupCr(cloud, sgId);
  const detail = crItemToDetail(updated);
  if (!detail) throw Object.assign(new Error('添加成员后读取 SecurityGroup CR 失败'), { status: 500 });
  return { detail, members: detail.members };
}

export async function removeKubeOvnSecurityGroupMember(
  cloud: HarvesterCloudRef,
  cloudId: string,
  sgId: string,
  memberId: string,
): Promise<{ detail: SecurityGroupDetailDto; members: SecurityGroupMemberDto[] }> {
  const cr = await getCrForCloud(cloud, cloudId, sgId);
  const spec = buildSpecFromCr(cr, cloudId);
  const members: SecurityGroupCrMemberInput[] = Array.isArray(spec.members) ? [...spec.members] : [];
  const mid = String(memberId || '').trim();

  let idx = members.findIndex((m) => String(m.id || '').trim() === mid);
  if (idx < 0 && mid.includes('/')) {
    const [ns, nm] = mid.split('/');
    idx = members.findIndex((m) => m.vmNamespace === ns && m.vmName === nm);
  }
  if (idx < 0) {
    throw Object.assign(new Error('成员不存在或不属于该安全组'), { status: 404 });
  }

  members.splice(idx, 1);
  spec.members = members;
  await updateSecurityGroupCr(cloud, sgId, { spec });

  const updated = await getSecurityGroupCr(cloud, sgId);
  const detail = crItemToDetail(updated);
  if (!detail) throw Object.assign(new Error('移除成员后读取 SecurityGroup CR 失败'), { status: 500 });
  return { detail, members: detail.members };
}

/** ACL 推送：按云 + 子网读取 SecurityGroup CR 列表（已过滤 cloudId）。 */
export async function listSecurityGroupCrsForSubnetPush(
  cloud: HarvesterCloudRef,
  cloudId: string,
  subnetName: string,
): Promise<
  | { ok: true; groups: Array<{ id: string; name: string; rules: SecurityGroupCrRuleInput[]; members: SecurityGroupCrMemberInput[] }> }
  | { ok: false; message: string }
> {
  const subnet = String(subnetName || '').trim();
  const listed = await listSecurityGroupCrs(cloud);
  if (!listed.apiAvailable) {
    return {
      ok: false,
      message:
        listed.error ||
        'SecurityGroup CR API 不可用，无法下发 ACL（请确认 securitygroups.hms.rivercloud.com CRD）',
    };
  }

  const groups = filterSecurityGroupCrsByCloudId(listed.items, cloudId)
    .filter((cr) => String(cr?.spec?.subnetName || '').trim() === subnet)
    .map((cr) => ({
      id: String(cr?.metadata?.name || ''),
      name: String(cr?.spec?.name || ''),
      rules: Array.isArray(cr?.spec?.rules) ? cr.spec.rules : [],
      members: Array.isArray(cr?.spec?.members) ? cr.spec.members : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, groups };
}
