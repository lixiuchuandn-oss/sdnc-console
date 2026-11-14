/**
 * HA 组配置健康 / 下发漂移：只比本组 vrid / group_id，不碰 SRv6 公式。
 */
import {
  configBusinessEqual,
  diffConfigSemantic,
  formatConfigSemanticDiffs,
} from '../../utils/configSemanticEqual';
import type { VrConfigDriftConflict } from './vrConfigDeploy';
import type { VrConfigJson } from './vrConfigDeploy';
import {
  applyVrrpPatchToDeviceConfig,
  ensureVipCidr,
  expectedHaVrrpSlice,
  extractHaGroupVrrpSubset,
  listForeignHaVrrpMarks,
  type HaMemberVrrpPatch,
  type HaVrrpSlice,
} from './haGroupVrrpMaterialize';

export type HaMemberHealthCode = 'ok' | 'drift' | 'not_deployed' | 'endpoint_missing';
export type HaGroupHealthCode =
  | 'ok'
  | 'drift'
  | 'not_deployed'
  | 'degraded'
  | 'endpoint_missing';

export type HaMemberHealth = {
  role: 'primary' | 'backup';
  vrUuid: string;
  code: HaMemberHealthCode;
  message: string;
};

export type HaGroupHealthReport = {
  groupId: string;
  health: HaGroupHealthCode;
  message: string;
  checkedAt: string;
  members: HaMemberHealth[];
};

const asBool = (v: unknown, defaultTrue = true): boolean => {
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  return defaultTrue;
};

const asNum = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function normalizeInstance(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const src = row as Record<string, unknown>;
  const vrid = asNum(src.vrid);
  if (vrid == null) return null;
  const vipRaw = src.virtual_ipaddress;
  const vips = (Array.isArray(vipRaw) ? vipRaw : vipRaw != null ? [vipRaw] : [])
    .map((x) => ensureVipCidr(String(x ?? '').trim()))
    .filter(Boolean)
    .sort();
  const out: Record<string, unknown> = {
    vrid,
    priority: asNum(src.priority) ?? 100,
    advert_interval: asNum(src.advert_interval ?? src.advert_int) ?? 1,
    preempt: asBool(src.preempt, true),
    virtual_ipaddress: vips,
  };
  const auth = String(src.auth_pass ?? '').trim();
  if (auth) out.auth_pass = auth;
  const peer = String(src.unicast_peer ?? '').trim();
  const source = String(src.unicast_source ?? '').trim();
  if (peer) out.unicast_peer = peer;
  if (source) out.unicast_source = source;
  return out;
}

function normalizeGroup(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const src = row as Record<string, unknown>;
  const group_id = asNum(src.group_id);
  if (group_id == null) return null;
  const instRaw = src.vrrp_instance;
  const instances = (Array.isArray(instRaw) ? instRaw : instRaw != null ? [instRaw] : [])
    .map((x) => asNum(x))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const gwRaw = src.track_gateway;
  const gateways = (Array.isArray(gwRaw) ? gwRaw : gwRaw != null ? [gwRaw] : [])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .sort();
  return {
    group_id,
    vrrp_instance: instances,
    track_gateway: gateways,
    track_interval: asNum(src.track_interval) ?? 1,
  };
}

export function normalizeHaVrrpSlice(slice: HaVrrpSlice): HaVrrpSlice {
  const interfaces = [...slice.interfaces]
    .map((iface) => ({
      name: String(iface.name || '').trim(),
      vrrp: (iface.vrrp || [])
        .map(normalizeInstance)
        .filter((x): x is Record<string, unknown> => Boolean(x))
        .sort((a, b) => Number(a.vrid) - Number(b.vrid)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const vrrp = (slice.vrrp || [])
    .map(normalizeGroup)
    .filter((x): x is Record<string, unknown> => Boolean(x))
    .sort((a, b) => Number(a.group_id) - Number(b.group_id));
  return { interfaces, vrrp };
}

export function haVrrpSliceEqual(left: HaVrrpSlice, right: HaVrrpSlice): boolean {
  return configBusinessEqual(normalizeHaVrrpSlice(left), normalizeHaVrrpSlice(right));
}

export function describeHaVrrpSliceDiff(actual: HaVrrpSlice, expected: HaVrrpSlice): string {
  const diffs = diffConfigSemantic(normalizeHaVrrpSlice(actual), normalizeHaVrrpSlice(expected));
  if (!diffs.length) return '';
  return formatConfigSemanticDiffs(diffs, { leftLabel: '设备', rightLabel: '意图', limit: 4 });
}

const sliceHasAny = (slice: HaVrrpSlice): boolean =>
  slice.interfaces.some((i) => Array.isArray(i.vrrp) && i.vrrp.length > 0) ||
  (Array.isArray(slice.vrrp) && slice.vrrp.length > 0);

export function assessHaMemberHealth(options: {
  role: 'primary' | 'backup';
  vrUuid: string;
  patch: HaMemberVrrpPatch;
  device: VrConfigJson | null;
  deviceError?: string;
}): HaMemberHealth {
  const { role, vrUuid, patch, device, deviceError } = options;
  if (!device) {
    return {
      role,
      vrUuid,
      code: 'endpoint_missing',
      message: deviceError || '无法读取设备 VR2',
    };
  }
  const actual = extractHaGroupVrrpSubset(device, patch);
  const expected = expectedHaVrrpSlice(patch);
  if (!sliceHasAny(actual)) {
    return { role, vrUuid, code: 'not_deployed', message: '设备上没有本组 VRRP 实例' };
  }
  if (haVrrpSliceEqual(actual, expected)) {
    return { role, vrUuid, code: 'ok', message: '本组 VRRP 与意图一致' };
  }
  const detail = describeHaVrrpSliceDiff(actual, expected);
  return {
    role,
    vrUuid,
    code: 'drift',
    message: detail ? `本组 VRRP 与意图不一致：${detail}` : '本组 VRRP 与意图不一致',
  };
}

export function rollupHaGroupHealth(
  primary: HaMemberHealthCode,
  backup: HaMemberHealthCode,
): HaGroupHealthCode {
  const codes = [primary, backup];
  if (codes.includes('endpoint_missing')) return 'endpoint_missing';
  if (primary === 'ok' && backup === 'ok') return 'ok';
  if (primary === 'not_deployed' && backup === 'not_deployed') return 'not_deployed';
  if (codes.includes('ok') && (codes.includes('drift') || codes.includes('not_deployed'))) {
    return 'degraded';
  }
  return 'drift';
}

export function haGroupHealthLabel(code: HaGroupHealthCode): string {
  if (code === 'ok') return '健康';
  if (code === 'drift') return '漂移';
  if (code === 'not_deployed') return '未下发';
  if (code === 'degraded') return '降级';
  return '端点缺失';
}

export function composeHaGroupHealthMessage(
  health: HaGroupHealthCode,
  members: HaMemberHealth[],
): string {
  const bits = members.map((m) => `${m.role === 'primary' ? '主' : '备'}：${m.message}`);
  if (health === 'ok') return '主备本组 VRRP 与意图一致';
  return bits.join('；');
}

/** 下发前：本组字段将改写则报 DOMAIN_OVERWRITE；其它 vrid 被丢掉也报。纯注入不报。 */
export function inspectHaVrrpDeployDrift(
  device: VrConfigJson,
  patch: HaMemberVrrpPatch,
): VrConfigDriftConflict[] {
  const conflicts: VrConfigDriftConflict[] = [];
  const beforeForeign = listForeignHaVrrpMarks(device, patch);
  const merged = applyVrrpPatchToDeviceConfig(device, patch);
  const afterForeign = listForeignHaVrrpMarks(merged, patch);
  const lost = beforeForeign.filter((m) => !afterForeign.includes(m));
  if (lost.length) {
    conflicts.push({
      kind: 'DOMAIN_OVERWRITE',
      key: 'vrrp-foreign',
      message: `下发将丢掉非本组 VRRP（${lost.slice(0, 4).join('、')}），已终止`,
    });
  }

  const actual = extractHaGroupVrrpSubset(device, patch);
  const expected = expectedHaVrrpSlice(patch);
  if (!sliceHasAny(actual)) return conflicts;
  if (haVrrpSliceEqual(actual, expected)) return conflicts;

  const detail = describeHaVrrpSliceDiff(actual, expected);
  conflicts.push({
    kind: 'DOMAIN_OVERWRITE',
    key: 'vrrp',
    message: detail
      ? `设备本组 VRRP 与平台意图不一致，继续下发将按意图改写本组实例（其它 vrid 保留）：${detail}`
      : '设备本组 VRRP 与平台意图不一致，继续下发将按意图改写本组实例（其它 vrid 保留）',
  });
  return conflicts;
}
