/**
 * IBR HA 组 VRRP 意图（对齐《网际路由 SRv6 高可用方案》方案二）。
 * 边缘 CE 双机 VRRP + 中间 PE 侧 SRv6 segment list 选路。
 */

export type HaGroupVrrpPlacement = 'access' | 'egress';

export type HaGroupVrrpMemberIntent = {
  role: 'primary' | 'backup';
  vr_uuid: string;
  priority: number;
  interface?: string;
  /** 方案二：track-gateway，上游 PE 接口名或对端网关 IPv4 */
  track_gateway?: string;
};

export type HaGroupVrrpIntent = {
  scheme: 'srv6-segment-list-vrrp';
  placement: HaGroupVrrpPlacement;
  vrid: number;
  virtual_ip: string;
  /** 组级可选跟踪接口（本地） */
  track_interface?: string;
  advert_interval: number;
  auth_pass?: string;
  preempt: boolean;
  members: HaGroupVrrpMemberIntent[];
};

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\/(?:[0-9]|[1-2][0-9]|3[0-2]))?$/;

function normalizeUuid(value: unknown): string {
  return String(value ?? '').trim();
}

function readPlacement(raw: unknown): HaGroupVrrpPlacement | null {
  const p = String(raw ?? '').trim();
  if (p === 'access' || p === 'egress') return p;
  return null;
}

/** 兼容旧版 vrrpIntent（无 scheme / placement / track_gateway） */
export function normalizeHaGroupVrrpIntent(raw: unknown): HaGroupVrrpIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const membersRaw = Array.isArray(row.members) ? row.members : [];
  const members: HaGroupVrrpMemberIntent[] = [];
  for (const item of membersRaw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const role = String(m.role ?? '').trim();
    if (role !== 'primary' && role !== 'backup') continue;
    const vr_uuid = normalizeUuid(m.vr_uuid ?? m.vrUuid);
    if (!vr_uuid) continue;
    members.push({
      role,
      vr_uuid,
      priority: Number(m.priority) || (role === 'primary' ? 200 : 100),
      interface: String(m.interface ?? '').trim() || undefined,
      track_gateway: String(m.track_gateway ?? m.trackGateway ?? '').trim() || undefined,
    });
  }
  if (members.length !== 2) return null;

  const schemeRaw = String(row.scheme ?? '').trim();
  const scheme =
    schemeRaw === 'srv6-segment-list-vrrp' ? 'srv6-segment-list-vrrp' : 'srv6-segment-list-vrrp';

  return {
    scheme,
    placement: readPlacement(row.placement) ?? 'access',
    vrid: Number(row.vrid) || 1,
    virtual_ip: String(row.virtual_ip ?? row.virtualIp ?? '').trim(),
    track_interface: String(row.track_interface ?? row.trackInterface ?? '').trim() || undefined,
    advert_interval: Number(row.advert_interval ?? row.advertInterval) || 1,
    auth_pass: String(row.auth_pass ?? row.authPass ?? '').trim() || undefined,
    preempt: row.preempt !== false,
    members,
  };
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

  if (!Number.isInteger(intent.vrid) || intent.vrid < 1 || intent.vrid > 255) {
    throw new Error('VRID 须为 1–255 的整数');
  }
  const vip = intent.virtual_ip.trim();
  if (!vip || !IPV4_RE.test(vip.split('/')[0] ?? '')) {
    throw new Error('虚拟 IP（VIP）须为合法 IPv4 或 IPv4/CIDR');
  }
  if (!Number.isFinite(intent.advert_interval) || intent.advert_interval < 1 || intent.advert_interval > 60) {
    throw new Error('通告间隔须为 1–60 秒');
  }
  if (primary.priority <= backup.priority) {
    throw new Error('主节点 VRRP 优先级须高于备节点');
  }

  for (const m of intent.members) {
    const tg = String(m.track_gateway ?? '').trim();
    if (!tg) {
      throw new Error(`${m.role === 'primary' ? '主' : '备'}节点须配置 track-gateway（上游 PE 接口或网关地址）`);
    }
    const iface = String(m.interface ?? '').trim();
    if (!iface) {
      throw new Error(`${m.role === 'primary' ? '主' : '备'}节点须配置 VRRP 绑定接口`);
    }
  }

  return intent;
}

export function memberPriorityFromIntent(
  intent: HaGroupVrrpIntent | null,
  role: 'primary' | 'backup',
): number | null {
  const m = intent?.members.find((x) => x.role === role);
  if (!m || !Number.isFinite(m.priority)) return null;
  return m.priority;
}
