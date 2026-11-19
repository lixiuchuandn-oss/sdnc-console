import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { ACLGroup } from '../../entities/vRouter/ACLGroup';
import { ACLGroupBinding } from '../../entities/vRouter/ACLGroupBinding';
import { ACLRule } from '../../entities/vRouter/ACLRule';
import { NATAddressGroup } from '../../entities/vRouter/NATAddressGroup';
import { NATStaticMapping } from '../../entities/vRouter/NATStaticMapping';
import { VRCacheBasic } from '../../entities/vRouter/VRCacheBasic';
import { VRCacheDevice } from '../../entities/vRouter/VRCacheDevice';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import {
  configSemanticEqual,
  diffConfigSemantic,
  formatConfigSemanticDiffs,
} from '../../utils/configSemanticEqual';
import { listVrInstanceBinders, type VrInstanceBinder } from './vrInstanceBinders';
import { parseRolePreSnapshot } from './rolePreSnapshot';
import { assertCsmUpdateSuccess, stripMeta } from './vrConfigDeploy';
import { ibrLocalWebClient } from './ibrLocalWebClient';
import { getVR2QueryResult, unregisterVrFromCsm, vrController } from './vrController';

export type VrInstanceDeleteReason =
  | 'binders'
  | 'drift'
  | 'not_applied'
  | 'csm_update'
  | 'device_read'
  | 'no_snapshot';

export class VrInstanceDeleteError extends Error {
  statusCode: number;
  reason: VrInstanceDeleteReason;
  binders?: VrInstanceBinder[];
  conflicts?: VrInstanceDeleteConflict[];

  constructor(
    message: string,
    options: {
      statusCode?: number;
      reason: VrInstanceDeleteReason;
      binders?: VrInstanceBinder[];
      conflicts?: VrInstanceDeleteConflict[];
    },
  ) {
    super(message);
    this.name = 'VrInstanceDeleteError';
    this.statusCode = options.statusCode ?? 409;
    this.reason = options.reason;
    this.binders = options.binders;
    this.conflicts = options.conflicts;
  }
}

export type VrInstanceDeleteConflict = {
  kind: 'DOMAIN_OVERWRITE';
  key: string;
  message: string;
};

export type VrInstanceDeletePreview = {
  uuid: string;
  binders: VrInstanceBinder[];
  hasSnapshot: boolean;
  deviceReverted: boolean;
  conflicts: VrInstanceDeleteConflict[];
  applied?: string | null;
};

const DEFAULT_APPLIED_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_MS = 2_000;

const sleepDefault = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readApplied = (config: unknown): string => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
  return String((config as Record<string, unknown>).report_config_status ?? '').trim().toLowerCase();
};

const snapshotEqualsLive = (live: unknown, snapshot: Record<string, unknown>): boolean =>
  configSemanticEqual(stripMeta(live), snapshot);

const diffsToConflicts = (live: unknown, snapshot: Record<string, unknown>): VrInstanceDeleteConflict[] => {
  const diffs = diffConfigSemantic(stripMeta(live), snapshot);
  if (!diffs.length) return [];
  const detail = formatConfigSemanticDiffs(diffs, {
    leftLabel: '设备',
    rightLabel: '角色前快照',
    limit: 8,
  });
  return [
    {
      kind: 'DOMAIN_OVERWRITE',
      key: diffs[0]?.path || '$',
      message: `下发角色前快照将覆盖设备现网配置。${detail}`,
    },
  ];
};

export async function previewVrInstanceDelete(uuid: string): Promise<VrInstanceDeletePreview> {
  const id = String(uuid || '').trim();
  if (!id) {
    throw new VrInstanceDeleteError('缺少 uuid', { statusCode: 400, reason: 'device_read' });
  }
  const binders = await listVrInstanceBinders(id);
  const row = await AppDataSource.getRepository(VRConfig).findOne({ where: { uuid: id } });
  const snapshot = parseRolePreSnapshot(row?.rolePreSnapshot);
  const hasSnapshot = Boolean(snapshot);
  if (binders.length) {
    return { uuid: id, binders, hasSnapshot, deviceReverted: false, conflicts: [] };
  }
  if (!snapshot) {
    return { uuid: id, binders, hasSnapshot: false, deviceReverted: false, conflicts: [] };
  }

  const live = await getVR2QueryResult(id);
  if (live.transportError) {
    throw new VrInstanceDeleteError(`无法读取设备当前配置：${live.transportError}`, {
      statusCode: 503,
      reason: 'device_read',
    });
  }
  const liveConfig = live.config;
  const applied = readApplied(liveConfig) || null;
  if (!liveConfig) {
    return {
      uuid: id,
      binders,
      hasSnapshot: true,
      deviceReverted: false,
      conflicts: [
        {
          kind: 'DOMAIN_OVERWRITE',
          key: '$',
          message: '无法读取设备当前配置，确认后将下发角色前快照',
        },
      ],
      applied,
    };
  }
  return {
    uuid: id,
    binders,
    hasSnapshot: true,
    deviceReverted: false,
    conflicts: diffsToConflicts(liveConfig, snapshot),
    applied,
  };
}

export async function cleanupVrPlatformRows(uuid: string): Promise<void> {
  const id = String(uuid || '').trim();
  if (!id) return;
  await AppDataSource.getRepository(ACLRule).delete({ vrId: id });
  await AppDataSource.getRepository(ACLGroupBinding).delete({ vrId: id });
  await AppDataSource.getRepository(ACLGroup).delete({ vrId: id });
  const natGroups = await AppDataSource.getRepository(NATAddressGroup).find({ where: { vrId: id } });
  const natGroupIds = natGroups.map((g) => g.id).filter(Boolean);
  if (natGroupIds.length) {
    await AppDataSource.getRepository(NATStaticMapping).delete({ addressGroupId: In(natGroupIds) });
  }
  await AppDataSource.getRepository(NATAddressGroup).delete({ vrId: id });
  await AppDataSource.getRepository(VRConfig).delete({ uuid: id });
  await AppDataSource.getRepository(VRCacheBasic).delete({ uuid: id });
  await AppDataSource.getRepository(VRCacheExtended).delete({ uuid: id });
  await AppDataSource.getRepository(VRCacheDevice).delete({ uuid: id });
}

async function waitUntilApplied(
  uuid: string,
  snapshot: Record<string, unknown>,
  options: { timeoutMs: number; pollMs: number; sleep: (ms: number) => Promise<unknown> },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() <= deadline) {
    const live = await getVR2QueryResult(uuid);
    const bodyMatches = Boolean(live.config) && snapshotEqualsLive(live.config, snapshot);
    if (!live.transportError && bodyMatches && readApplied(live.config) === 'applied') return;
    if (Date.now() + options.pollMs > deadline) break;
    await options.sleep(options.pollMs);
  }
  throw new VrInstanceDeleteError(
    '回退配置已在控制器，设备尚未 applied。实例仍在，可重试（不会再次打乱 checksum）。',
    { statusCode: 409, reason: 'not_applied' },
  );
}

function assertCsmAccepted(respData: unknown): void {
  try {
    assertCsmUpdateSuccess(respData);
  } catch (err: unknown) {
    throw new VrInstanceDeleteError(err instanceof Error ? err.message : String(err), {
      statusCode: 409,
      reason: 'csm_update',
    });
  }
}

export async function deleteVrInstance(
  uuid: string,
  options?: {
    acknowledgeDrift?: boolean;
    appliedTimeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<unknown>;
    /** 注销成功后回写设备，只清 finish。缺省走 local-web；测试可注入。 */
    clearDeviceRegistration?: (params: { uuid: string; managementIp: string }) => Promise<unknown>;
  },
): Promise<{
  uuid: string;
  deviceReverted: boolean;
  alreadyGone?: boolean;
  registrationFinishCleared: boolean;
  registrationClearError?: string;
}> {
  const id = String(uuid || '').trim();
  if (!id) {
    throw new VrInstanceDeleteError('缺少 uuid', { statusCode: 400, reason: 'device_read' });
  }

  const binders = await listVrInstanceBinders(id);
  if (binders.length) {
    throw new VrInstanceDeleteError('该 IBR 仍被其它业务引用，请先按待办拆除后再删除实例', {
      reason: 'binders',
      binders,
    });
  }

  const row = await AppDataSource.getRepository(VRConfig).findOne({ where: { uuid: id } });
  const snapshot = parseRolePreSnapshot(row?.rolePreSnapshot);
  let deviceReverted = false;

  if (!snapshot) {
    throw new VrInstanceDeleteError(
      '该实例没有角色前快照，无法回退设备 CLI，因此不能删除。历史已设角色的实例不会补录快照。',
      { reason: 'no_snapshot' },
    );
  }

  const live = await getVR2QueryResult(id);
  if (live.transportError) {
    throw new VrInstanceDeleteError(`无法读取设备当前配置：${live.transportError}`, {
      statusCode: 503,
      reason: 'device_read',
    });
  }
  const liveConfig = live.config;
  const equal = liveConfig ? snapshotEqualsLive(liveConfig, snapshot) : false;
  const conflicts = liveConfig
    ? diffsToConflicts(liveConfig, snapshot)
    : [
        {
          kind: 'DOMAIN_OVERWRITE' as const,
          key: '$',
          message: '无法读取设备当前配置，确认后将下发角色前快照',
        },
      ];
  if (!equal && conflicts.length && !options?.acknowledgeDrift) {
    throw new VrInstanceDeleteError('设备现网与角色前快照不一致，确认后将覆盖设备配置', {
      reason: 'drift',
      conflicts,
    });
  }

  if (!equal) {
    const resp = await vrController.updateVRConfig(id, { ...snapshot, uuid: id });
    assertCsmAccepted(resp.data);
  }

  await waitUntilApplied(id, snapshot, {
    timeoutMs: options?.appliedTimeoutMs ?? DEFAULT_APPLIED_TIMEOUT_MS,
    pollMs: options?.pollMs ?? DEFAULT_POLL_MS,
    sleep: options?.sleep ?? sleepDefault,
  });
  deviceReverted = true;

  let alreadyGone = false;
  try {
    alreadyGone = (await unregisterVrFromCsm(id)) === 'already_gone';
  } catch (err: unknown) {
    throw new VrInstanceDeleteError(err instanceof Error ? err.message : String(err), {
      statusCode: 502,
      reason: 'csm_update',
    });
  }

  const managementIp = String(row?.managementIp ?? '').trim();
  let registrationFinishCleared = false;
  let registrationClearError: string | undefined;
  if (!managementIp) {
    registrationClearError = '无管理口地址，未回写设备清 finish';
  } else {
    try {
      const clear =
        options?.clearDeviceRegistration ??
        ((params: { uuid: string; managementIp: string }) =>
          ibrLocalWebClient.clearRegistrationFinish(params.managementIp, params.uuid));
      const cleared = await clear({ uuid: id, managementIp });
      if (cleared && typeof cleared === 'object' && (cleared as { ok?: boolean }).ok === false) {
        throw new Error(
          String((cleared as { error?: string }).error || '设备未清掉 .registration_finish'),
        );
      }
      registrationFinishCleared = true;
    } catch (err: unknown) {
      registrationClearError = err instanceof Error ? err.message : String(err);
    }
  }

  await cleanupVrPlatformRows(id);
  return {
    uuid: id,
    deviceReverted,
    alreadyGone,
    registrationFinishCleared,
    ...(registrationClearError ? { registrationClearError } : {}),
  };
}
