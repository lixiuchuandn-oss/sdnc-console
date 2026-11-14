/**
 * HA 组运行时巡检：经设备 local-web 读 `do show vrrp instances/groups`，
 * 只关心本组 vrid / group_id 的主备角色、track、VIP，不扫 SRv6。
 */
import {
  ibrLocalWebClient,
  IbrLocalWebError,
  type IbrForwardingVrrpResult,
} from './ibrLocalWebClient';
import {
  hasVrrpGroupsShow,
  hasVrrpInstancesShow,
  hasVrrpLiveShow,
  parseVrrpGroupsShow,
  parseVrrpInstancesShow,
  type ParsedVrrpGroup,
  type ParsedVrrpInstance,
} from '../../utils/parseVrrpShow';
import type { HaGroupVrrpIntent } from './haGroupVrrpIntent';

export type HaLiveStepKey = 'role' | 'track' | 'vip';
export type HaLiveStepStatus = 'pass' | 'fail' | 'skip';

export type HaLiveStep = {
  key: HaLiveStepKey;
  status: HaLiveStepStatus;
  message: string;
};

export type HaLiveMemberSnapshot = {
  role: 'primary' | 'backup';
  vrUuid: string;
  name: string | null;
  reachable: boolean;
  error?: string;
  /** 本组拥有实例的汇总角色；多实例状态不一致时为 MIXED */
  state: string | null;
  /** 兼容字段：首个拥有实例的 Virtual Router ID */
  vrid: number | null;
  /** 本组拥有实例的 Virtual Router ID（不是 keepalived 实例序号） */
  memberVrids: number[];
  /** 本组拥有的 sync group id（可多个） */
  groupIds: number[];
  virtualIps: string[];
  /** 本组每个实例的每条 VIP 均已挂载 */
  vipInstalled: boolean;
  /** 任一条 VIP 已挂载（备端脑裂） */
  anyVipInstalled: boolean;
  trackStatus: string | null;
  trackCommand: string | null;
  /** track 目标网关；多组时逗号拼接 */
  trackGateway: string | null;
  /** show vrrp groups 是否解析到 Sync Group（失败时 track 不得 skip） */
  groupsReadable: boolean;
  /** 有跟踪脚本但未读到 Status */
  trackIncomplete: boolean;
  /** 仅含意图所属的实例 / group，便于私有云多组展示 */
  instances: ParsedVrrpInstance[];
  groups: ParsedVrrpGroup[];
};

export type HaGroupLiveReport = {
  groupId: string;
  name: string;
  lifecycleStatus: string;
  side: string | null;
  members: HaLiveMemberSnapshot[];
  steps: HaLiveStep[];
  checkedAt: string;
};

/** 只取该成员自己的意图标识，避免把对端 vrid/group_id 算进本机过滤集 */
export function ownedVrrpIdsForMember(
  member: HaGroupVrrpIntent['members'][number] | undefined | null,
): { vrids: Set<number>; groupIds: Set<number> } {
  const vrids = new Set<number>();
  const groupIds = new Set<number>();
  if (!member) return { vrids, groupIds };
  for (const inst of member.instances || []) {
    if (Number.isFinite(inst.vrid)) vrids.add(inst.vrid);
  }
  for (const g of member.groups || []) {
    if (Number.isFinite(g.group_id)) groupIds.add(g.group_id);
  }
  return { vrids, groupIds };
}

/** @deprecated 仅兼容旧调用；live 巡检请用 ownedVrrpIdsForMember */
export function ownedVrrpIds(intent: HaGroupVrrpIntent): { vrids: Set<number>; groupIds: Set<number> } {
  const vrids = new Set<number>();
  const groupIds = new Set<number>();
  for (const member of intent.members || []) {
    const owned = ownedVrrpIdsForMember(member);
    for (const v of owned.vrids) vrids.add(v);
    for (const g of owned.groupIds) groupIds.add(g);
  }
  return { vrids, groupIds };
}

function pickInstances(rows: ParsedVrrpInstance[], vrids: Set<number>): ParsedVrrpInstance[] {
  return rows.filter((r) => r.vrid != null && vrids.has(r.vrid));
}

function pickGroups(rows: ParsedVrrpGroup[], groupIds: Set<number>): ParsedVrrpGroup[] {
  return rows.filter((r) => r.groupId != null && groupIds.has(r.groupId));
}

function rollupMemberState(owned: ParsedVrrpInstance[]): string | null {
  const states = [
    ...new Set(owned.map((r) => String(r.state || '').toUpperCase()).filter(Boolean)),
  ];
  if (states.length === 0) return null;
  if (states.length === 1) return states[0]!;
  return 'MIXED';
}

function hasTrackedScripts(g: ParsedVrrpGroup): boolean {
  return (g.trackedScripts || []).length > 0;
}

function rollupTrack(owned: ParsedVrrpGroup[]): {
  trackStatus: string | null;
  trackCommand: string | null;
  trackGateway: string | null;
  trackIncomplete: boolean;
} {
  const incomplete = owned.filter((g) => hasTrackedScripts(g) && !g.scriptStatus);
  const withStatus = owned.filter((g) => g.scriptStatus);
  const gateways = [
    ...new Set(owned.map((g) => g.trackGateway).filter((x): x is string => Boolean(x))),
  ];
  const commands = [
    ...new Set(owned.map((g) => g.scriptCommand).filter((x): x is string => Boolean(x))),
  ];
  if (incomplete.length) {
    return {
      trackStatus: null,
      trackCommand: commands[0] || null,
      trackGateway: gateways.length ? gateways.join(', ') : null,
      trackIncomplete: true,
    };
  }
  if (!withStatus.length) {
    return { trackStatus: null, trackCommand: null, trackGateway: null, trackIncomplete: false };
  }
  const bad = withStatus.find((g) => !/^good$/i.test(String(g.scriptStatus)));
  return {
    trackStatus: bad ? String(bad.scriptStatus) : String(withStatus[0]!.scriptStatus),
    trackCommand: commands[0] || null,
    trackGateway: gateways.length ? gateways.join(', ') : null,
    trackIncomplete: false,
  };
}

function extractRaws(data: IbrForwardingVrrpResult | null): { instancesRaw: string; groupsRaw: string } {
  const rec = (data || {}) as IbrForwardingVrrpResult & {
    instancesRaw?: string;
    groupsRaw?: string;
    instances_raw?: string;
    groups_raw?: string;
  };
  const instancesField = String(rec.instancesRaw || rec.instances_raw || '');
  const groupsField = String(rec.groupsRaw || rec.groups_raw || '');
  const fallback = String(rec.raw || '');
  return {
    instancesRaw: hasVrrpInstancesShow(instancesField)
      ? instancesField
      : hasVrrpInstancesShow(fallback)
        ? fallback
        : instancesField,
    // groups 不得回退到 running-config / instances show，避免把「没读到 groups」当成无 track
    groupsRaw: hasVrrpGroupsShow(groupsField) ? groupsField : groupsField,
  };
}

export function snapshotFromVrrpPayload(options: {
  role: 'primary' | 'backup';
  vrUuid: string;
  name: string | null;
  data: IbrForwardingVrrpResult | null;
  error?: string;
  vrids: Set<number>;
  groupIds: Set<number>;
}): HaLiveMemberSnapshot {
  const { role, vrUuid, name, data, error, vrids, groupIds } = options;
  const empty = (message: string): HaLiveMemberSnapshot => ({
    role,
    vrUuid,
    name,
    reachable: false,
    error: message,
    state: null,
    vrid: null,
    memberVrids: [],
    groupIds: [],
    virtualIps: [],
    vipInstalled: false,
    anyVipInstalled: false,
    trackStatus: null,
    trackCommand: null,
    trackGateway: null,
    groupsReadable: false,
    trackIncomplete: false,
    instances: [],
    groups: [],
  });
  if (!data) return empty(error || '未能读取设备 VRRP');
  const { instancesRaw, groupsRaw } = extractRaws(data);
  const instancesLive = hasVrrpInstancesShow(instancesRaw);
  const groupsLive = hasVrrpGroupsShow(groupsRaw);
  const live = instancesLive || groupsLive || hasVrrpLiveShow(instancesRaw) || hasVrrpLiveShow(groupsRaw);
  if (!live) {
    return empty(
      error || data.error || '设备未返回 show vrrp 运行状态（请确认 local-web 已支持 do show vrrp）',
    );
  }
  const ownedInstances = pickInstances(parseVrrpInstancesShow(instancesRaw), vrids);
  const ownedGroups = pickGroups(parseVrrpGroupsShow(groupsRaw), groupIds);
  const track = rollupTrack(ownedGroups);
  const memberVrids = [
    ...new Set(ownedInstances.map((i) => i.vrid).filter((n): n is number => n != null)),
  ].sort((a, b) => a - b);
  const ownedGroupIds = [
    ...new Set(ownedGroups.map((g) => g.groupId).filter((n): n is number => n != null)),
  ].sort((a, b) => a - b);
  const virtualIps = [...new Set(ownedInstances.flatMap((i) => i.virtualIps))];
  const groupsReadable = groupsLive;
  const missingOwnedGroup = groupsLive && groupIds.size > 0 && ownedGroups.length === 0;
  return {
    role,
    vrUuid,
    name,
    reachable: true,
    state: rollupMemberState(ownedInstances),
    vrid: ownedInstances[0]?.vrid ?? null,
    memberVrids,
    groupIds: ownedGroupIds,
    virtualIps,
    vipInstalled: ownedInstances.length > 0 && ownedInstances.every((i) => i.vipInstalled),
    anyVipInstalled: ownedInstances.some((i) => i.anyVipInstalled),
    trackStatus: track.trackStatus,
    trackCommand: track.trackCommand,
    trackGateway: track.trackGateway,
    groupsReadable,
    trackIncomplete: track.trackIncomplete || missingOwnedGroup || (groupIds.size > 0 && !groupsLive),
    instances: ownedInstances,
    groups: ownedGroups,
  };
}

export function evaluateHaLiveSteps(members: HaLiveMemberSnapshot[]): HaLiveStep[] {
  const primary = members.find((m) => m.role === 'primary');
  const backup = members.find((m) => m.role === 'backup');
  const label = (m: HaLiveMemberSnapshot | undefined) =>
    m ? `${m.role === 'primary' ? '意图主' : '意图备'} ${m.name || m.vrUuid}` : '—';

  const roleStep = (): HaLiveStep => {
    if (!primary?.reachable) {
      return { key: 'role', status: 'fail', message: `${label(primary)}：${primary?.error || '不可达'}` };
    }
    if (!backup?.reachable) {
      return { key: 'role', status: 'fail', message: `${label(backup)}：${backup?.error || '不可达'}` };
    }
    if (members.some((m) => String(m.state || '').toUpperCase() === 'MIXED')) {
      return {
        key: 'role',
        status: 'fail',
        message: `同设备多实例角色不一致：${label(primary)}=${primary.state || '无'}，${label(backup)}=${
          backup.state || '无'
        }`,
      };
    }
    const states = members.map((m) => String(m.state || '').toUpperCase());
    const masterCount = states.filter((s) => s === 'MASTER').length;
    const backupCount = states.filter((s) => s === 'BACKUP').length;
    if (masterCount === 1 && backupCount === 1) {
      const master = members.find((m) => String(m.state).toUpperCase() === 'MASTER');
      const slave = members.find((m) => String(m.state).toUpperCase() === 'BACKUP');
      return {
        key: 'role',
        status: 'pass',
        message: `${label(master)} = MASTER，${label(slave)} = BACKUP`,
      };
    }
    return {
      key: 'role',
      status: 'fail',
      message: `当前 ${label(primary)}=${primary.state || '无'}，${label(backup)}=${backup.state || '无'}（期望一主一备）`,
    };
  };

  const trackStep = (): HaLiveStep => {
    const missing = members.filter((m) => m.reachable && !m.trackStatus);
    const bad = members.filter((m) => m.trackStatus && !/^good$/i.test(m.trackStatus));
    const unreadGroups = members.filter((m) => m.reachable && m.groupsReadable === false);
    const incomplete = members.filter((m) => m.trackIncomplete);
    if (members.some((m) => !m.reachable)) {
      return { key: 'track', status: 'fail', message: '主备未全部读到 live VRRP，无法判断 track' };
    }
    if (unreadGroups.length) {
      return {
        key: 'track',
        status: 'fail',
        message: unreadGroups.map((m) => `${label(m)} 未读到 show vrrp groups`).join('；'),
      };
    }
    if (bad.length) {
      return {
        key: 'track',
        status: 'fail',
        message: bad
          .map((m) => `${label(m)} track=${m.trackStatus}${m.trackGateway ? `（${m.trackGateway}）` : ''}`)
          .join('；'),
      };
    }
    if (incomplete.length) {
      return {
        key: 'track',
        status: 'fail',
        message: incomplete.map((m) => `${label(m)} 未读到本组 track 状态`).join('；'),
      };
    }
    if (missing.length === members.length) {
      return { key: 'track', status: 'skip', message: '未读到 VRRP Script Status（可能无 track）' };
    }
    if (missing.length) {
      return {
        key: 'track',
        status: 'fail',
        message: missing.map((m) => `${label(m)} 未读到 track 状态`).join('；'),
      };
    }
    return {
      key: 'track',
      status: 'pass',
      message: members
        .map((m) => `${label(m)} ${m.trackStatus}${m.trackGateway ? ` → ${m.trackGateway}` : ''}`)
        .join('；'),
    };
  };

  const vipStep = (): HaLiveStep => {
    if (members.some((m) => !m.reachable)) {
      return { key: 'vip', status: 'fail', message: '主备未全部读到 live VRRP，无法判断 VIP' };
    }
    const master = members.find((m) => String(m.state).toUpperCase() === 'MASTER');
    const others = members.filter((m) => m !== master);
    if (!master) {
      return { key: 'vip', status: 'fail', message: '没有 MASTER，无法确认 VIP 挂载' };
    }
    if (!master.vipInstalled || master.virtualIps.length === 0) {
      return {
        key: 'vip',
        status: 'fail',
        message: `${label(master)} 为 MASTER 但 VIP 未全部挂载${
          master.virtualIps.length ? `（${master.virtualIps.join(', ')}）` : ''
        }`,
      };
    }
    const split = others.filter((m) => m.anyVipInstalled || m.vipInstalled);
    if (split.length) {
      return {
        key: 'vip',
        status: 'fail',
        message: `MASTER 已挂载 ${master.virtualIps.join(', ')}，但 ${split
          .map((m) => label(m))
          .join('、')} 也挂了 VIP`,
      };
    }
    return {
      key: 'vip',
      status: 'pass',
      message: `${label(master)} 已挂载 ${master.virtualIps.join(', ')}`,
    };
  };

  return [roleStep(), trackStep(), vipStep()];
}

async function loadDeviceVrrp(
  vrUuid: string,
): Promise<{ data: IbrForwardingVrrpResult | null; error?: string }> {
  try {
    const managementIp = await ibrLocalWebClient.getManagementIpForVr(vrUuid);
    const data = await ibrLocalWebClient.getForwardingVrrp(managementIp);
    if (data?.error) return { data, error: String(data.error) };
    return { data };
  } catch (e) {
    const msg =
      e instanceof IbrLocalWebError
        ? e.message
        : e instanceof Error
          ? e.message
          : '读取设备 VRRP 失败';
    return { data: null, error: msg };
  }
}

export async function collectHaLiveMembers(options: {
  intent: HaGroupVrrpIntent;
  names: Partial<Record<'primary' | 'backup', string | null>>;
}): Promise<HaLiveMemberSnapshot[]> {
  const roles = ['primary', 'backup'] as const;
  return Promise.all(
    roles.map(async (role) => {
      const member = options.intent.members.find((m) => m.role === role);
      const { vrids, groupIds } = ownedVrrpIdsForMember(member);
      const vrUuid = String(member?.vr_uuid || '').trim();
      const name = options.names[role] ?? null;
      if (!vrUuid) {
        return snapshotFromVrrpPayload({
          role,
          vrUuid: '',
          name,
          data: null,
          error: '成员缺失',
          vrids,
          groupIds,
        });
      }
      const live = await loadDeviceVrrp(vrUuid);
      return snapshotFromVrrpPayload({
        role,
        vrUuid,
        name,
        data: live.data,
        error: live.error,
        vrids,
        groupIds,
      });
    }),
  );
}
