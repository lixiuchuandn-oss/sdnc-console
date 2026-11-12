/**
 * 将 HA 组平台侧 vrrpIntent 物化为单机设备 config_json 补丁，
 * 并在设备底稿上定点合并（interfaces_*[].vrrp 或 interface[].vrrp + 顶层 vrrp[]）。
 */

import type {
  HaGroupVrrpGroupIntent,
  HaGroupVrrpInstanceIntent,
  HaGroupVrrpIntent,
  HaGroupVrrpMemberIntent,
} from './haGroupVrrpIntent';
import type { VrConfigJson } from './vrConfigDeploy';

export type DeviceVrrpIfaceInstance = {
  vrid: number;
  auth_pass?: string;
  priority: number;
  advert_interval: number;
  preempt: boolean;
  unicast_peer?: string;
  unicast_source?: string;
  virtual_ipaddress: string[];
};

export type DeviceVrrpGroup = {
  group_id: number;
  track_gateway: string[];
  vrrp_instance: number[];
  track_interval?: number;
};

export type HaMemberIfacePatch = {
  interfaceName: string;
  ifaceVrrp: DeviceVrrpIfaceInstance;
};

export type HaMemberVrrpPatch = {
  role: 'primary' | 'backup';
  vrUuid: string;
  ifacePatches: HaMemberIfacePatch[];
  topVrrp: DeviceVrrpGroup[];
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function compactIfaceName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function ifaceNamesEqual(a: string, b: string): boolean {
  const left = compactIfaceName(a);
  const right = compactIfaceName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.replace(/\s/g, '') === right.replace(/\s/g, '');
}

function isIfaceBucketKey(key: string): boolean {
  return (
    key === 'interface' ||
    key === 'interfaces' ||
    key.startsWith('interfaces_') ||
    key.startsWith('subinterfaces_')
  );
}

function listIfaceBucketKeys(cfg: Record<string, unknown>): string[] {
  return Object.keys(cfg).filter((key) => isIfaceBucketKey(key) && Array.isArray(cfg[key]));
}

function findIfaceIndex(list: unknown[], interfaceName: string): number {
  return list.findIndex((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    return ifaceNamesEqual(String((raw as { name?: unknown }).name ?? ''), interfaceName);
  });
}

/** 设备 schema 要求 VIP 带掩码；无掩码时默认 /32 */
export function ensureVipCidr(vip: string): string {
  const t = String(vip ?? '').trim();
  if (!t) return t;
  if (t.includes('/')) return t;
  return `${t}/32`;
}

function requireMember(
  intent: HaGroupVrrpIntent,
  role: 'primary' | 'backup',
): HaGroupVrrpMemberIntent {
  const member = intent.members.find((m) => m.role === role);
  if (!member) {
    throw new Error(`vrrpIntent 缺少 ${role} 成员`);
  }
  return member;
}

function materializeInstance(inst: HaGroupVrrpInstanceIntent): DeviceVrrpIfaceInstance {
  const advert = inst.advert_interval ?? 1;
  const ifaceVrrp: DeviceVrrpIfaceInstance = {
    vrid: inst.vrid,
    priority: inst.priority,
    advert_interval: Number.isFinite(advert) ? Math.trunc(advert) : 1,
    preempt: inst.preempt !== false,
    virtual_ipaddress: [ensureVipCidr(inst.virtual_ip)],
  };
  const auth = String(inst.auth_pass ?? '').trim();
  if (auth) ifaceVrrp.auth_pass = auth;
  if (inst.advert_mode === 'unicast') {
    const unicastPeer = String(inst.unicast_peer ?? '').trim();
    const unicastSource = String(inst.unicast_source ?? '').trim();
    if (unicastPeer) ifaceVrrp.unicast_peer = unicastPeer;
    if (unicastSource) ifaceVrrp.unicast_source = unicastSource;
  }
  return ifaceVrrp;
}

function materializeGroup(group: HaGroupVrrpGroupIntent): DeviceVrrpGroup {
  const track = String(group.track_gateway ?? '').trim();
  const interval = group.track_interval ?? 1;
  return {
    group_id: group.group_id,
    track_gateway: track ? [track] : [],
    vrrp_instance: [group.vrrp_instance],
    ...(Number.isFinite(interval) ? { track_interval: Math.trunc(interval) } : {}),
  };
}

/** 按角色生成单机 VRRP 补丁（不读设备） */
export function materializeHaGroupVrrpForMember(
  intent: HaGroupVrrpIntent,
  role: 'primary' | 'backup',
): HaMemberVrrpPatch {
  const member = requireMember(intent, role);
  if (!member.instances.length) {
    throw new Error(`${role === 'primary' ? '主' : '备'}节点缺少 VRRP 实例`);
  }
  const ifacePatches: HaMemberIfacePatch[] = member.instances.map((inst) => {
    const interfaceName = String(inst.interface ?? '').trim();
    if (!interfaceName) {
      throw new Error(`${role === 'primary' ? '主' : '备'}节点缺少 VRRP 绑定接口`);
    }
    return {
      interfaceName,
      ifaceVrrp: materializeInstance(inst),
    };
  });
  const topVrrp = (member.groups || []).map(materializeGroup);
  if (!topVrrp.length) {
    throw new Error(`${role === 'primary' ? '主' : '备'}节点缺少 VRRP 组策略`);
  }

  return {
    role,
    vrUuid: member.vr_uuid,
    ifacePatches,
    topVrrp,
  };
}

function upsertIfaceVrrp(
  result: VrConfigJson,
  patch: HaMemberIfacePatch,
  vrUuid: string,
): void {
  const bucketKeys = listIfaceBucketKeys(result);
  let bucketKey: string | null = null;
  let ifaceIdx = -1;
  for (const key of bucketKeys) {
    const idx = findIfaceIndex(result[key] as unknown[], patch.interfaceName);
    if (idx >= 0) {
      bucketKey = key;
      ifaceIdx = idx;
      break;
    }
  }
  if (!bucketKey || ifaceIdx < 0) {
    throw new Error(
      `设备配置中未找到接口「${patch.interfaceName}」（vr=${vrUuid}），请确认该口已存在于 IBR`,
    );
  }

  const interfaces = [...(result[bucketKey] as unknown[])];
  const iface = { ...(interfaces[ifaceIdx] as Record<string, unknown>) };
  const existingVrrp = Array.isArray(iface.vrrp) ? [...(iface.vrrp as unknown[])] : [];
  const vrrpIdx = existingVrrp.findIndex((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    return Number((raw as { vrid?: unknown }).vrid) === patch.ifaceVrrp.vrid;
  });
  if (vrrpIdx >= 0) {
    const merged: Record<string, unknown> = {
      ...(existingVrrp[vrrpIdx] as Record<string, unknown>),
      ...patch.ifaceVrrp,
    };
    if (!patch.ifaceVrrp.unicast_peer) delete merged.unicast_peer;
    if (!patch.ifaceVrrp.unicast_source) delete merged.unicast_source;
    if (!patch.ifaceVrrp.auth_pass) delete merged.auth_pass;
    existingVrrp[vrrpIdx] = merged;
  } else {
    existingVrrp.push(patch.ifaceVrrp);
  }
  iface.vrrp = existingVrrp;
  interfaces[ifaceIdx] = iface;
  result[bucketKey] = interfaces;
}

function upsertTopVrrp(result: VrConfigJson, group: DeviceVrrpGroup): void {
  const topVrrp = Array.isArray(result.vrrp) ? [...(result.vrrp as unknown[])] : [];
  // 仅按 group_id 匹配，避免同 VRID 的多条策略互相覆盖
  const topIdx = topVrrp.findIndex((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    return Number((raw as { group_id?: unknown }).group_id) === group.group_id;
  });
  if (topIdx >= 0) {
    topVrrp[topIdx] = group;
  } else {
    topVrrp.push(group);
  }
  result.vrrp = topVrrp;
}

/**
 * 在设备全量配置底稿上 upsert 本 HA 组对应的 VRRP。
 * 不删除其它口或其他 group 的 VRRP。
 */
export function applyVrrpPatchToDeviceConfig(
  deviceConfig: VrConfigJson,
  patch: HaMemberVrrpPatch,
): VrConfigJson {
  const result = deepClone(deviceConfig);
  for (const ifacePatch of patch.ifacePatches) {
    upsertIfaceVrrp(result, ifacePatch, patch.vrUuid);
  }
  for (const group of patch.topVrrp) {
    upsertTopVrrp(result, group);
  }
  return result;
}

function groupIdSetOf(patch: HaMemberVrrpPatch): Set<number> {
  return new Set(patch.topVrrp.map((g) => g.group_id).filter((n) => Number.isFinite(n)));
}

/**
 * 解散回退：从底稿剥掉本组 vrid / group_id。
 * 同一份 JSON 里接口片和顶层 vrrp 一起去掉，避免 CSM「顶层 instance 在接口中无 vrid」。
 * 其它 vrid / group 不动；空数组改为缺省键，便于 agent Lua cmp_del。
 */
export function stripHaGroupVrrpFromDeviceConfig(
  deviceConfig: VrConfigJson,
  patch: HaMemberVrrpPatch,
): VrConfigJson {
  const result = deepClone(deviceConfig);
  const groupIds = groupIdSetOf(patch);
  /** 接口侧按「接口名 + vrid」剥，避免同机其它口碰巧同 vrid 被误删 */
  const vridsByIface = patch.ifacePatches.map((p) => ({
    interfaceName: p.interfaceName,
    vrid: p.ifaceVrrp.vrid,
  }));

  for (const key of listIfaceBucketKeys(result)) {
    const list = result[key];
    if (!Array.isArray(list)) continue;
    result[key] = list.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
      const iface = { ...(raw as Record<string, unknown>) };
      if (!Array.isArray(iface.vrrp)) return iface;
      const ifaceName = String(iface.name ?? '');
      const dropVrids = new Set(
        vridsByIface
          .filter((p) => Number.isFinite(p.vrid) && ifaceNamesEqual(ifaceName, p.interfaceName))
          .map((p) => p.vrid),
      );
      if (!dropVrids.size) return iface;
      const kept = (iface.vrrp as unknown[]).filter((row) => {
        if (!row || typeof row !== 'object') return true;
        const vrid = Number((row as { vrid?: unknown }).vrid);
        return !Number.isFinite(vrid) || !dropVrids.has(vrid);
      });
      if (kept.length) iface.vrrp = kept;
      else delete iface.vrrp;
      return iface;
    });
  }

  if (Array.isArray(result.vrrp)) {
    const kept = (result.vrrp as unknown[]).filter((row) => {
      if (!row || typeof row !== 'object') return true;
      const gid = Number((row as { group_id?: unknown }).group_id);
      return !Number.isFinite(gid) || !groupIds.has(gid);
    });
    if (kept.length) result.vrrp = kept;
    else delete result.vrrp;
  }

  return result;
}

/** 下发预览：只抽出本组写入的接口 vrrp 与顶层 vrrp group */
export function pickHaVrrpDeploySlice(
  merged: VrConfigJson,
  patch: HaMemberVrrpPatch,
): { interfaces: Array<{ name: string; vrrp?: unknown }>; vrrp: unknown } {
  const cfg = merged as Record<string, unknown>;
  const interfaces: Array<{ name: string; vrrp?: unknown }> = [];
  for (const ifacePatch of patch.ifacePatches) {
    let found: Record<string, unknown> | null = null;
    for (const key of listIfaceBucketKeys(cfg)) {
      const list = cfg[key] as unknown[];
      const idx = findIfaceIndex(list, ifacePatch.interfaceName);
      if (idx >= 0 && list[idx] && typeof list[idx] === 'object') {
        found = list[idx] as Record<string, unknown>;
        break;
      }
    }
    interfaces.push({
      name: ifacePatch.interfaceName,
      vrrp: found?.vrrp ?? [ifacePatch.ifaceVrrp],
    });
  }
  return {
    interfaces,
    vrrp: cfg.vrrp ?? patch.topVrrp,
  };
}
