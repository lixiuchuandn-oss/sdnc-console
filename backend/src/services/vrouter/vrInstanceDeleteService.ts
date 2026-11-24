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
  isSemanticEmpty,
} from '../../utils/configSemanticEqual';
import { extractRoleFromVr2Config } from './ibrVrRoleResolve';
import { listVrInstanceBinders, type VrInstanceBinder } from './vrInstanceBinders';
import { hasPlatformRole, parseRolePreSnapshot } from './rolePreSnapshot';
import { assertCsmUpdateSuccess, stripMeta } from './vrConfigDeploy';
import { ibrLocalWebClient } from './ibrLocalWebClient';
import { getVR2QueryResult, unregisterVrFromCsm, vrController } from './vrController';
import { isVr2MissingBizError } from './vr2ConfigErrors';

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
  /** 仅注册、未设角色、VR2 业务为空：可直接从列表移除，不回退设备 */
  neverConfigured: boolean;
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

type Vr2Live = Awaited<ReturnType<typeof getVR2QueryResult>>;

const VR2_IDENTITY_KEYS = new Set(['uuid', 'name', 'id']);

const leftoverDeleteError = () =>
  new VrInstanceDeleteError('当前无法删除该实例。请先到专家模式或设备侧清理后再试。', {
    reason: 'no_snapshot',
  });

const vr2HasRole = (config: unknown): boolean => {
  if (!config) return false;
  return Boolean(extractRoleFromVr2Config(config) || extractRoleFromVr2Config(stripMeta(config)));
};

/** 去掉身份字段与空 role 后，VR2 是否没有业务配置 */
const isVr2BusinessEmpty = (config: unknown): boolean => {
  if (config == null || typeof config !== 'object' || Array.isArray(config)) return true;
  const rest: Record<string, unknown> = { ...stripMeta(config) };
  for (const key of VR2_IDENTITY_KEYS) {
    delete rest[key];
  }
  if (!String(rest.role ?? '').trim()) delete rest.role;
  return isSemanticEmpty(rest);
};

const throwIfVr2Unreadable = (live: Vr2Live): void => {
  if (!live.transportError) return;
  throw new VrInstanceDeleteError('暂时无法读取实例状态，请稍后重试。', {
    statusCode: 503,
    reason: 'device_read',
  });
};

const throwIfVr2BizUncertain = (live: Vr2Live): void => {
  if (!live.csmBizError || isVr2MissingBizError(live.csmBizError)) return;
  throw new VrInstanceDeleteError('暂时无法读取实例状态，请稍后重试。', {
    statusCode: 503,
    reason: 'device_read',
  });
};

/** 无快照时：从未设角色且 VR2 为空 → 可删；否则视为存量残留，拒绝 */
async function resolveNeverConfiguredState(
  row: { role?: string | null } | null | undefined,
  id: string,
): Promise<'never_configured' | 'leftover'> {
  if (hasPlatformRole(row)) return 'leftover';
  const live = await getVR2QueryResult(id);
  throwIfVr2Unreadable(live);
  throwIfVr2BizUncertain(live);
  if (vr2HasRole(live.config)) return 'leftover';
  if (isVr2MissingBizError(live.csmBizError) || live.config == null || isVr2BusinessEmpty(live.config)) {
    return 'never_configured';
  }
  return 'leftover';
}

const diffsToConflicts = (live: unknown, snapshot: Record<string, unknown>): VrInstanceDeleteConflict[] => {
  const diffs = diffConfigSemantic(stripMeta(live), snapshot);
  if (!diffs.length) return [];
  const detail = formatConfigSemanticDiffs(diffs, {
    leftLabel: '当前',
    rightLabel: '恢复目标',
    limit: 8,
  });
  return [
    {
      kind: 'DOMAIN_OVERWRITE',
      key: diffs[0]?.path || '$',
      message: `确认后将覆盖当前设备配置。${detail}`,
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
    return {
      uuid: id,
      binders,
      hasSnapshot,
      neverConfigured: false,
      deviceReverted: false,
      conflicts: [],
    };
  }
  if (!snapshot) {
    const neverConfigured = (await resolveNeverConfiguredState(row, id)) === 'never_configured';
    return {
      uuid: id,
      binders,
      hasSnapshot: false,
      neverConfigured,
      deviceReverted: false,
      conflicts: [],
    };
  }

  const live = await getVR2QueryResult(id);
  throwIfVr2Unreadable(live);
  const liveConfig = live.config;
  const applied = readApplied(liveConfig) || null;
  if (!liveConfig) {
    return {
      uuid: id,
      binders,
      hasSnapshot: true,
      neverConfigured: false,
      deviceReverted: false,
      conflicts: [
        {
          kind: 'DOMAIN_OVERWRITE',
          key: '$',
          message: '当前设备配置读不到，确认后将覆盖为删除前状态',
        },
      ],
      applied,
    };
  }
  return {
    uuid: id,
    binders,
    hasSnapshot: true,
    neverConfigured: false,
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
  throw new VrInstanceDeleteError('设备尚未完成恢复，实例仍在，请稍后重试。', {
    statusCode: 409,
    reason: 'not_applied',
  });
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

async function unregisterAndCleanupPlatform(
  id: string,
  row: { managementIp?: string | null } | null | undefined,
  options: {
    clearDeviceRegistration?: (params: { uuid: string; managementIp: string }) => Promise<unknown>;
  } | undefined,
  deviceReverted: boolean,
): Promise<{
  uuid: string;
  deviceReverted: boolean;
  alreadyGone?: boolean;
  registrationFinishCleared: boolean;
  registrationClearError?: string;
}> {
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

  // 先清平台管理口记录，再回写设备。设备清 finish 时会作废上次上报缓存并立刻补报；
  // 若补报发生在清库之前，刚写上的 managementIp 会被随后删掉。
  await cleanupVrPlatformRows(id);

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
  return {
    uuid: id,
    deviceReverted,
    alreadyGone,
    registrationFinishCleared,
    ...(registrationClearError ? { registrationClearError } : {}),
  };
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
    throw new VrInstanceDeleteError('该实例仍被其它业务引用，请先处理后再删除', {
      reason: 'binders',
      binders,
    });
  }

  const row = await AppDataSource.getRepository(VRConfig).findOne({ where: { uuid: id } });
  const snapshot = parseRolePreSnapshot(row?.rolePreSnapshot);

  if (!snapshot) {
    const state = await resolveNeverConfiguredState(row, id);
    if (state !== 'never_configured') {
      throw leftoverDeleteError();
    }
    return unregisterAndCleanupPlatform(id, row, options, false);
  }

  const live = await getVR2QueryResult(id);
  throwIfVr2Unreadable(live);
  const liveConfig = live.config;
  const equal = liveConfig ? snapshotEqualsLive(liveConfig, snapshot) : false;
  const conflicts = liveConfig
    ? diffsToConflicts(liveConfig, snapshot)
    : [
        {
          kind: 'DOMAIN_OVERWRITE' as const,
          key: '$',
          message: '当前设备配置读不到，确认后将覆盖为删除前状态',
        },
      ];
  if (!equal && conflicts.length && !options?.acknowledgeDrift) {
    throw new VrInstanceDeleteError('当前设备配置与删除后目标不一致，确认后将覆盖', {
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

  return unregisterAndCleanupPlatform(id, row, options, true);
}
