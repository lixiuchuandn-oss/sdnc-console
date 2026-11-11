/**
 * IBR HA 组 VRRP 意图：一组 = 本端或对端的主备两台，
 * 每台可配置多条接口 VRRP 实例 + 多条全局 vrrp group 策略。
 */

export type HaGroupSide = 'local' | 'peer';

export type HaVrrpAdvertMode = 'multicast' | 'unicast';

export type HaGroupVrrpInstanceIntent = {
  interface: string;
  vrid: number;
  virtual_ip: string;
  priority: number;
  auth_pass?: string;
  preempt: boolean;
  /** 通告间隔秒，对应设备 `vrrp vrid N advert_int`，范围 1–256 */
  advert_interval: number;
  advert_mode: HaVrrpAdvertMode;
  unicast_peer?: string;
  unicast_source?: string;
};

export type HaGroupVrrpGroupIntent = {
  group_id: number;
  vrrp_instance: number;
  track_gateway?: string;
  track_interval?: number;
};

export type HaGroupVrrpMemberIntent = {
  role: 'primary' | 'backup';
  vr_uuid: string;
  instances: HaGroupVrrpInstanceIntent[];
  groups: HaGroupVrrpGroupIntent[];
};

export type HaGroupVrrpIntent = {
  scheme: 'srv6-segment-list-vrrp';
  side: HaGroupSide;
  members: HaGroupVrrpMemberIntent[];
};

const IPV4_HOST_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

const IPV4_OPTIONAL_CIDR_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\/(?:[0-9]|[1-2][0-9]|3[0-2]))?$/;

function normalizeUuid(value: unknown): string {
  return String(value ?? '').trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readPositiveInt(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export function normalizeHaGroupSide(raw: unknown): HaGroupSide {
  const t = String(raw ?? '').trim();
  if (t === 'peer' || t === 'egress') return 'peer';
  return 'local';
}

function parseInstance(
  raw: unknown,
  fallbackPriority: number,
  legacyTop?: Record<string, unknown>,
): HaGroupVrrpInstanceIntent | null {
  const row = asRecord(raw);
  if (!row) return null;
  const iface = String(row.interface ?? '').trim();
  const vrid = readPositiveInt(row.vrid ?? legacyTop?.vrid, 0);
  if (!iface || !vrid) return null;
  const unicastSource = String(row.unicast_source ?? row.unicastSource ?? '').trim();
  const unicastPeer = String(row.unicast_peer ?? row.unicastPeer ?? '').trim();
  const advertRaw = String(row.advert_mode ?? row.advertMode ?? '').trim();
  const advert_mode: HaVrrpAdvertMode =
    advertRaw === 'unicast' || (unicastSource && unicastPeer) ? 'unicast' : 'multicast';
  const auth = String(row.auth_pass ?? row.authPass ?? legacyTop?.auth_pass ?? '').trim();
  return {
    interface: iface,
    vrid,
    virtual_ip: String(row.virtual_ip ?? row.virtualIp ?? legacyTop?.virtual_ip ?? '').trim(),
    priority: readPositiveInt(row.priority, fallbackPriority),
    preempt: (row.preempt ?? legacyTop?.preempt) !== false,
    advert_interval: readPositiveInt(
      row.advert_interval ?? row.advertInterval ?? legacyTop?.advert_interval,
      1,
    ),
    advert_mode,
    ...(auth ? { auth_pass: auth } : {}),
    ...(advert_mode === 'unicast' && unicastSource && unicastPeer
      ? { unicast_source: unicastSource, unicast_peer: unicastPeer }
      : {}),
  };
}

function parseGroup(raw: unknown): HaGroupVrrpGroupIntent | null {
  const row = asRecord(raw);
  if (!row) return null;
  const group_id = readPositiveInt(row.group_id ?? row.groupId, 0);
  const instanceRaw = row.vrrp_instance ?? row.vrrpInstanceId ?? row.vrid;
  const vrrp_instance = Array.isArray(instanceRaw)
    ? readPositiveInt(instanceRaw[0], 0)
    : readPositiveInt(instanceRaw, 0);
  if (!group_id || !vrrp_instance) return null;
  const gateways = Array.isArray(row.track_gateway) ? row.track_gateway : null;
  const track_gateway = gateways
    ? String(gateways[0] ?? '').trim() || undefined
    : String(row.track_gateway ?? row.trackGateway ?? '').trim() || undefined;
  return {
    group_id,
    vrrp_instance,
    ...(track_gateway ? { track_gateway } : {}),
    track_interval: readPositiveInt(row.track_interval ?? row.trackInterval, 1),
  };
}

function parseMember(
  raw: unknown,
  legacyTop?: Record<string, unknown>,
): HaGroupVrrpMemberIntent | null {
  const row = asRecord(raw);
  if (!row) return null;
  const role = String(row.role ?? '').trim();
  if (role !== 'primary' && role !== 'backup') return null;
  const vr_uuid = normalizeUuid(row.vr_uuid ?? row.vrUuid);
  if (!vr_uuid) return null;
  const fallbackPriority = role === 'primary' ? 200 : 100;
  const instancesRaw = Array.isArray(row.instances) ? row.instances : [];
  const groupsRaw = Array.isArray(row.groups) ? row.groups : [];
  let instances = instancesRaw
    .map((item) => parseInstance(item, fallbackPriority))
    .filter((item): item is HaGroupVrrpInstanceIntent => Boolean(item));
  let groups = groupsRaw
    .map((item) => parseGroup(item))
    .filter((item): item is HaGroupVrrpGroupIntent => Boolean(item));

  if (instances.length === 0) {
    const legacy = parseInstance(
      {
        interface: row.interface,
        vrid: legacyTop?.vrid,
        virtual_ip: legacyTop?.virtual_ip ?? legacyTop?.virtualIp,
        priority: row.priority,
        auth_pass: legacyTop?.auth_pass ?? row.auth_pass,
        preempt: legacyTop?.preempt,
        unicast_source: row.unicast_source ?? row.unicastSource,
        unicast_peer: row.unicast_peer ?? row.unicastPeer,
      },
      fallbackPriority,
      legacyTop,
    );
    if (legacy) instances = [legacy];
    const vrid = legacy?.vrid ?? readPositiveInt(legacyTop?.vrid, 1);
    const track = String(row.track_gateway ?? row.trackGateway ?? '').trim();
    groups = [
      {
        group_id: vrid,
        vrrp_instance: vrid,
        ...(track ? { track_gateway: track } : {}),
        track_interval: 1,
      },
    ];
  }

  if (instances.length === 0) return null;
  if (groups.length === 0) {
    const first = instances[0]!;
    groups = [{ group_id: first.vrid, vrrp_instance: first.vrid, track_interval: 1 }];
  }

  return { role, vr_uuid, instances, groups };
}

/** 兼容旧版：顶层 vrid/VIP + member.interface/track_gateway；以及 placement=access|egress */
export function normalizeHaGroupVrrpIntent(raw: unknown): HaGroupVrrpIntent | null {
  const row = asRecord(raw);
  if (!row) return null;
  const membersRaw = Array.isArray(row.members) ? row.members : [];
  const members: HaGroupVrrpMemberIntent[] = [];
  for (const item of membersRaw) {
    const parsed = parseMember(item, row);
    if (parsed) members.push(parsed);
  }
  if (members.length !== 2) return null;
  const schemeRaw = String(row.scheme ?? '').trim();
  const scheme =
    schemeRaw === 'srv6-segment-list-vrrp' ? 'srv6-segment-list-vrrp' : 'srv6-segment-list-vrrp';
  return {
    scheme,
    side: normalizeHaGroupSide(row.side ?? row.placement),
    members,
  };
}

function roleLabel(role: 'primary' | 'backup'): string {
  return role === 'primary' ? '主' : '备';
}

function validateMemberNode(member: HaGroupVrrpMemberIntent): void {
  const prefix = `${roleLabel(member.role)}节点`;
  if (!member.instances.length) {
    throw new Error(`${prefix}须至少配置 1 条 VRRP 实例`);
  }
  const vrids = new Set<number>();
  for (const inst of member.instances) {
    if (!Number.isInteger(inst.vrid) || inst.vrid < 1 || inst.vrid > 255) {
      throw new Error(`${prefix} VRRP ID 须为 1–255 的整数`);
    }
    if (vrids.has(inst.vrid)) {
      throw new Error(`${prefix} VRRP ID ${inst.vrid} 重复`);
    }
    vrids.add(inst.vrid);
    if (!String(inst.interface ?? '').trim()) {
      throw new Error(`${prefix}须配置 VRRP 绑定接口`);
    }
    const vip = inst.virtual_ip.trim();
    if (!vip || !IPV4_OPTIONAL_CIDR_RE.test(vip)) {
      throw new Error(`${prefix} VRRP IP 须为合法 IPv4 或 IPv4/CIDR`);
    }
    if (!Number.isInteger(inst.priority) || inst.priority < 1 || inst.priority > 255) {
      throw new Error(`${prefix}优先级须为 1–255 的整数`);
    }
    const advertInterval = inst.advert_interval ?? 1;
    if (!Number.isInteger(advertInterval) || advertInterval < 1 || advertInterval > 256) {
      throw new Error(`${prefix}通告间隔须为 1–256 秒`);
    }
    if (inst.advert_mode === 'unicast') {
      const peer = String(inst.unicast_peer ?? '').trim();
      const source = String(inst.unicast_source ?? '').trim();
      if (!peer || !source) {
        throw new Error(`${prefix}单播须同时填写 unicast-source 与 unicast-peer`);
      }
      if (!IPV4_HOST_RE.test(peer)) {
        throw new Error(`${prefix} unicast-peer 须为无掩码 IPv4`);
      }
      if (!IPV4_HOST_RE.test(source)) {
        throw new Error(`${prefix} unicast-source 须为无掩码 IPv4`);
      }
    }
  }

  if (!member.groups.length) {
    throw new Error(`${prefix}须至少配置 1 条 VRRP 组策略`);
  }
  const groupIds = new Set<number>();
  for (const group of member.groups) {
    if (!Number.isInteger(group.group_id) || group.group_id < 1) {
      throw new Error(`${prefix} Group ID 须为正整数`);
    }
    if (groupIds.has(group.group_id)) {
      throw new Error(`${prefix} Group ID ${group.group_id} 重复`);
    }
    groupIds.add(group.group_id);
    if (!vrids.has(group.vrrp_instance)) {
      throw new Error(`${prefix}组策略的 VRRP 实例 ID 须指向已配置实例`);
    }
    const interval = group.track_interval ?? 1;
    if (!Number.isInteger(interval) || interval < 1 || interval > 255) {
      throw new Error(`${prefix}探测间隔须为 1–255 秒`);
    }
    const track = String(group.track_gateway ?? '').trim();
    if (/^\d+\.\d+\.\d+\.\d+\//.test(track)) {
      throw new Error(`${prefix} track-gateway 不可携带掩码`);
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(track) && !IPV4_HOST_RE.test(track)) {
      throw new Error(`${prefix} track-gateway IPv4 不合法`);
    }
  }
}

export function validateHaGroupVrrpIntent(
  raw: unknown,
  opts?: { primaryUuid?: string; backupUuid?: string },
): HaGroupVrrpIntent {
  const intent = normalizeHaGroupVrrpIntent(raw);
  if (!intent) {
    throw new Error('vrrpIntent 须包含 primary 与 backup 两台成员');
  }

  const primaryUuid = normalizeUuid(opts?.primaryUuid);
  const backupUuid = normalizeUuid(opts?.backupUuid);
  const primary = intent.members.find((m) => m.role === 'primary');
  const backup = intent.members.find((m) => m.role === 'backup');
  if (!primary || !backup) {
    throw new Error('vrrpIntent.members 须各包含 1 台 primary 与 1 台 backup');
  }
  if (primaryUuid && primary.vr_uuid !== primaryUuid) {
    throw new Error('vrrpIntent 主节点与 HA 组成员不一致');
  }
  if (backupUuid && backup.vr_uuid !== backupUuid) {
    throw new Error('vrrpIntent 备节点与 HA 组成员不一致');
  }
  if (primary.vr_uuid === backup.vr_uuid) {
    throw new Error('vrrpIntent 主备不能为同一实例');
  }

  validateMemberNode(primary);
  validateMemberNode(backup);

  const primaryByVrid = new Map(primary.instances.map((inst) => [inst.vrid, inst] as const));
  for (const backupInst of backup.instances) {
    const matched = primaryByVrid.get(backupInst.vrid);
    if (matched && matched.priority <= backupInst.priority) {
      throw new Error(`VRRP ID ${backupInst.vrid}：主节点优先级须高于备节点`);
    }
  }

  return intent;
}

export function memberPriorityFromIntent(
  intent: HaGroupVrrpIntent | null,
  role: 'primary' | 'backup',
): number | null {
  const m = intent?.members.find((x) => x.role === role);
  const first = m?.instances?.[0];
  if (!first || !Number.isFinite(first.priority)) return null;
  return first.priority;
}
