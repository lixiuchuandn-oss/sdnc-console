/**
 * 将 HA 组平台侧 vrrpIntent 物化为单机设备 config_json 补丁，
 * 并在设备底稿上定点合并（interface[].vrrp + 顶层 vrrp[]）。
 */

import type { HaGroupVrrpIntent, HaGroupVrrpMemberIntent } from './haGroupVrrpIntent';
import type { VrConfigJson } from './vrConfigDeploy';

export type DeviceVrrpIfaceInstance = {
  vrid: number;
  advert_interval: number;
  auth_pass?: string;
  priority: number;
  virtual_ipaddress: string[];
};

export type DeviceVrrpGroup = {
  group_id: number;
  track_gateway: string[];
  vrrp_instance: number[];
};

export type HaMemberVrrpPatch = {
  role: 'primary' | 'backup';
  vrUuid: string;
  interfaceName: string;
  ifaceVrrp: DeviceVrrpIfaceInstance;
  topVrrp: DeviceVrrpGroup;
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

/** 按角色生成单机 VRRP 补丁（不读设备） */
export function materializeHaGroupVrrpForMember(
  intent: HaGroupVrrpIntent,
  role: 'primary' | 'backup',
): HaMemberVrrpPatch {
  const member = requireMember(intent, role);
  const interfaceName = String(member.interface ?? '').trim();
  if (!interfaceName) {
    throw new Error(`${role === 'primary' ? '主' : '备'}节点缺少 VRRP 绑定接口`);
  }
  const trackGateway = String(member.track_gateway ?? '').trim();
  if (!trackGateway) {
    throw new Error(`${role === 'primary' ? '主' : '备'}节点缺少 track-gateway`);
  }

  const ifaceVrrp: DeviceVrrpIfaceInstance = {
    vrid: intent.vrid,
    advert_interval: intent.advert_interval,
    priority: member.priority,
    virtual_ipaddress: [ensureVipCidr(intent.virtual_ip)],
  };
  const auth = String(intent.auth_pass ?? '').trim();
  if (auth) ifaceVrrp.auth_pass = auth;

  return {
    role,
    vrUuid: member.vr_uuid,
    interfaceName,
    ifaceVrrp,
    topVrrp: {
      group_id: intent.vrid,
      track_gateway: [trackGateway],
      vrrp_instance: [intent.vrid],
    },
  };
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
  const interfaces = Array.isArray(result.interface) ? [...(result.interface as unknown[])] : [];
  const ifaceIdx = interfaces.findIndex((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    return String((raw as { name?: unknown }).name ?? '').trim() === patch.interfaceName;
  });
  if (ifaceIdx < 0) {
    throw new Error(
      `设备配置中未找到接口「${patch.interfaceName}」（vr=${patch.vrUuid}），请确认该口已存在于 IBR`,
    );
  }

  const iface = { ...(interfaces[ifaceIdx] as Record<string, unknown>) };
  const existingVrrp = Array.isArray(iface.vrrp) ? [...(iface.vrrp as unknown[])] : [];
  const vrrpIdx = existingVrrp.findIndex((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    return Number((raw as { vrid?: unknown }).vrid) === patch.ifaceVrrp.vrid;
  });
  if (vrrpIdx >= 0) {
    existingVrrp[vrrpIdx] = {
      ...(existingVrrp[vrrpIdx] as Record<string, unknown>),
      ...patch.ifaceVrrp,
    };
  } else {
    existingVrrp.push(patch.ifaceVrrp);
  }
  iface.vrrp = existingVrrp;
  interfaces[ifaceIdx] = iface;
  result.interface = interfaces;

  const topVrrp = Array.isArray(result.vrrp) ? [...(result.vrrp as unknown[])] : [];
  const topIdx = topVrrp.findIndex((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const row = raw as { group_id?: unknown; vrrp_instance?: unknown };
    if (Number(row.group_id) === patch.topVrrp.group_id) return true;
    if (Array.isArray(row.vrrp_instance)) {
      return row.vrrp_instance.map(Number).includes(patch.ifaceVrrp.vrid);
    }
    return false;
  });
  if (topIdx >= 0) {
    topVrrp[topIdx] = patch.topVrrp;
  } else {
    topVrrp.push(patch.topVrrp);
  }
  result.vrrp = topVrrp;

  return result;
}
