import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { logger } from '../../utils/logger';
import { vrController } from './vrController';

const deployLog = logger.child('VR-Config-Deploy');

export type VrConfigDeployDomain = 'acl' | 'nat' | 'ipsec' | 'srv6' | 'vrrp';

const OTHER_FEATURE_KEYS = new Set(['acl', 'nat', 'nat_address_group', 'ipsec']);

/** NAT 域仅同步平台管理的 nat_address_group */
const NAT_SLICE_KEYS = ['nat_address_group'] as const;

const META_KEYS = new Set([
  'msg',
  'code',
  'report_config_status',
  'updateDate',
  'createDate',
  '_id',
  'requestId',
  '_towerHubInventory',
]);

export type VrConfigJson = Record<string, unknown>;

export class VrConfigDeployError extends Error {
  statusCode?: number;
  conflicts?: VrConfigDriftConflict[];

  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'VrConfigDeployError';
  }
}

export type VrConfigDriftKind = 'DOMAIN_OVERWRITE' | 'PLATFORM_STALE';

export type VrConfigDriftConflict = {
  kind: VrConfigDriftKind;
  key: string;
  message: string;
};

export const jsonConfigEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const isConfigValueEmpty = (value: unknown): boolean => {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 去掉 CSM 包装字段与平台扩展，再下发 */
export const stripMeta = (obj: unknown): VrConfigJson => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return {};
  }
  const rest = { ...(obj as VrConfigJson) };
  for (const key of META_KEYS) {
    delete rest[key];
  }
  return rest;
};

/** 下发前清洗（与 SRv6 / IPsec deploy 一致） */
export const sanitizeConfig = (config: VrConfigJson): VrConfigJson => {
  if (!config) return config;

  if (config.ipv4_route) {
    if (!Array.isArray(config.ipv4_route) || config.ipv4_route.length === 0) {
      delete config.ipv4_route;
    } else {
      const validRoutes = config.ipv4_route.filter(
        (r: unknown) =>
          r &&
          typeof r === 'object' &&
          typeof (r as { destination?: unknown }).destination === 'string' &&
          String((r as { destination: string }).destination).trim() !== '',
      );

      if (validRoutes.length === 0) {
        delete config.ipv4_route;
      } else {
        config.ipv4_route = validRoutes.map((r: unknown) => {
          const row = r as { destination: string; [key: string]: unknown };
          const dest = row.destination.trim();
          if (dest && !dest.includes('/') && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(dest)) {
            return { ...row, destination: `${dest}/32` };
          }
          return row;
        });
      }
    }
  }

  if (Array.isArray(config.ipv6_route) && config.ipv6_route.length) {
    config.ipv6_route = config.ipv6_route.map((r: unknown) => {
      if (!r || typeof r !== 'object') return r;
      const { dev: _dev, ...rest } = r as { dev?: unknown; [key: string]: unknown };
      return rest;
    });
  }

  return config;
};

/** IPsec 条目设备侧格式（布尔 → 字符串等） */
export const normalizeIpsecSliceForDevice = (ipsec: unknown): unknown => {
  if (!Array.isArray(ipsec)) return ipsec;
  return ipsec.map((item: unknown) => {
    if (!item || typeof item !== 'object') return item;
    const row = { ...(item as Record<string, unknown>) };
    if (typeof row.dpd !== 'undefined') delete row.dpd;
    if (typeof row['nat-traversal'] === 'boolean') {
      row['nat-traversal'] = row['nat-traversal'] ? 'true' : 'false';
    }
    if (typeof row['sa-initiate'] === 'boolean') {
      row['sa-initiate'] = row['sa-initiate'] ? 'true' : 'false';
    }
    return row;
  });
};

const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);

export const getVRConfigFromDB = async (uuid: string): Promise<VrConfigJson> => {
  const record = await vrConfigRepo().findOne({ where: { uuid } });
  if (!record) {
    throw new VrConfigDeployError(`平台库中未找到 VR 配置：${uuid}`, 'DB_NOT_FOUND');
  }
  try {
    return JSON.parse(record.config_json) as VrConfigJson;
  } catch {
    throw new VrConfigDeployError(`平台库 VR 配置 JSON 解析失败：${uuid}`, 'DB_PARSE_ERROR');
  }
};

export const saveVRConfigToDB = async (uuid: string, config: VrConfigJson): Promise<void> => {
  let record = await vrConfigRepo().findOne({ where: { uuid } });
  const jsonStr = JSON.stringify(config);

  if (record) {
    record.config_json = jsonStr;
    await vrConfigRepo().save(record);
    return;
  }

  record = vrConfigRepo().create({ uuid, config_json: jsonStr });
  await vrConfigRepo().save(record);
};

/** 从 CSMCTL 读取设备当前配置（下发底稿） */
export const getVRConfigFromDevice = async (uuid: string): Promise<VrConfigJson> => {
  const resp = await vrController.getVRConfig(uuid);
  const data =
    resp && typeof resp === 'object' && resp !== null && 'data' in resp
      ? (resp as { data?: unknown }).data
      : resp;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new VrConfigDeployError(
      `无法查询设备现有配置（空响应），已终止下发以避免覆盖：${uuid}`,
      'DEVICE_EMPTY',
    );
  }
  return stripMeta(data);
};

const domainSliceKey = (domain: VrConfigDeployDomain): string | null => {
  if (domain === 'srv6' || domain === 'vrrp') return null;
  return domain;
};

/**
 * 以设备配置为底稿，仅覆盖本域 slice，保留其它域与未纳管字段。
 */
export const mergeDeviceWithPlatformSlice = (
  deviceConfig: VrConfigJson,
  platformConfig: VrConfigJson,
  domain: VrConfigDeployDomain,
): VrConfigJson => {
  const result = deepClone(deviceConfig);

  if (domain === 'vrrp') {
    throw new VrConfigDeployError(
      'VRRP 域须提供 preMergedConfig（在设备底稿上定点合并 interface/vrrp）',
      'VRRP_PREMERGE_REQUIRED',
    );
  }

  if (domain === 'srv6') {
    for (const [key, value] of Object.entries(platformConfig)) {
      if (META_KEYS.has(key) || OTHER_FEATURE_KEYS.has(key)) continue;
      result[key] = deepClone(value);
    }
    return result;
  }

  if (domain === 'nat') {
    for (const key of NAT_SLICE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(platformConfig, key)) continue;
      result[key] = deepClone(platformConfig[key]);
    }
    return result;
  }

  const sliceKey = domainSliceKey(domain);
  if (!sliceKey) return result;

  if (Object.prototype.hasOwnProperty.call(platformConfig, sliceKey)) {
    let slice = deepClone(platformConfig[sliceKey]);
    if (domain === 'ipsec') {
      slice = normalizeIpsecSliceForDevice(slice);
    }
    result[sliceKey] = slice;
  }

  return result;
};

/** 本次下发将从平台覆盖到设备的顶层 key */
export const getOverlayKeysForDomain = (
  domain: VrConfigDeployDomain,
  platform: VrConfigJson,
): string[] => {
  if (domain === 'srv6') {
    return Object.keys(platform).filter((k) => !META_KEYS.has(k) && !OTHER_FEATURE_KEYS.has(k));
  }
  if (domain === 'nat') {
    return NAT_SLICE_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(platform, k));
  }
  return [domain];
};

const normalizeSliceForCompare = (
  domain: VrConfigDeployDomain,
  key: string,
  value: unknown,
): unknown => {
  if (domain === 'ipsec' && key === 'ipsec') {
    return normalizeIpsecSliceForDevice(value);
  }
  return value;
};

/**
 * 对比设备态与平台意图，找出下发时会覆盖设备历史策略的漂移项。
 * PLATFORM_STALE 仅提示平台库滞后（SRv6 下发会保留设备 acl/nat/ipsec）。
 */
export const detectDeployDrift = (
  device: VrConfigJson,
  platform: VrConfigJson,
  domain: VrConfigDeployDomain,
): VrConfigDriftConflict[] => {
  const conflicts: VrConfigDriftConflict[] = [];
  const overlayKeys = getOverlayKeysForDomain(domain, platform);

  for (const key of overlayKeys) {
    if (!Object.prototype.hasOwnProperty.call(platform, key)) continue;

    const deviceVal = device[key];
    const platformVal = platform[key];
    const deviceNorm = normalizeSliceForCompare(domain, key, deviceVal);
    const platformNorm = normalizeSliceForCompare(domain, key, platformVal);

    if (jsonConfigEqual(deviceNorm, platformNorm)) continue;
    if (isConfigValueEmpty(deviceVal)) continue;

    conflicts.push({
      kind: 'DOMAIN_OVERWRITE',
      key,
      message:
        domain === 'srv6'
          ? `设备上的「${key}」与平台意图不一致，下发将覆盖设备侧现网配置`
          : `设备上的「${key}」与平台意图不一致，下发将覆盖设备侧历史策略`,
    });
  }

  if (domain === 'srv6') {
    for (const key of OTHER_FEATURE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(device, key)) continue;
      if (isConfigValueEmpty(device[key])) continue;
      if (jsonConfigEqual(device[key], platform[key])) continue;

      conflicts.push({
        kind: 'PLATFORM_STALE',
        key,
        message: `设备「${key}」与平台库不一致；本次 SRv6 下发会保留设备现网值，但平台库已滞后`,
      });
    }
  }

  return conflicts;
};

export const getBlockingDriftConflicts = (
  conflicts: VrConfigDriftConflict[],
): VrConfigDriftConflict[] => conflicts.filter((c) => c.kind === 'DOMAIN_OVERWRITE');

export const assertNoBlockingDeployDrift = (
  conflicts: VrConfigDriftConflict[],
  options?: { acknowledgeDrift?: boolean },
): void => {
  if (options?.acknowledgeDrift) return;
  const blockers = getBlockingDriftConflicts(conflicts);
  if (blockers.length === 0) return;

  const err = new VrConfigDeployError(
    '检测到设备与平台配置漂移，继续下发将覆盖设备侧历史策略；请确认后携带 acknowledgeDrift 重试',
    'CONFIG_DRIFT',
  );
  err.statusCode = 409;
  err.conflicts = blockers;
  throw err;
};

export const inspectDeployDrift = async (options: {
  vrId: string;
  domain: VrConfigDeployDomain;
  platformConfig?: VrConfigJson;
}): Promise<{
  vrId: string;
  domain: VrConfigDeployDomain;
  conflicts: VrConfigDriftConflict[];
  blocking: boolean;
}> => {
  const device = await getVRConfigFromDevice(options.vrId);
  let platform: VrConfigJson;
  if (options.platformConfig) {
    platform = options.platformConfig;
  } else {
    try {
      platform = await getVRConfigFromDB(options.vrId);
    } catch {
      platform = {};
    }
  }
  const conflicts = detectDeployDrift(device, platform, options.domain);
  return {
    vrId: options.vrId,
    domain: options.domain,
    conflicts,
    blocking: getBlockingDriftConflicts(conflicts).length > 0,
  };
};

export const mapDeployErrorToResponse = (
  err: unknown,
): { status: number; body: Record<string, unknown> } => {
  if (err instanceof VrConfigDeployError) {
    return {
      status: err.statusCode ?? 500,
      body: {
        message: err.message,
        code: err.code,
        conflicts: err.conflicts,
      },
    };
  }
  return {
    status: 500,
    body: { message: err instanceof Error ? err.message : String(err) },
  };
};

export const assertCsmUpdateSuccess = (respData: unknown): void => {
  if (!respData || typeof respData !== 'object') return;
  const row = respData as { code?: unknown; msg?: string; message?: string };
  if (typeof row.code === 'undefined') return;
  if (row.code == 0 || row.code == 200) return;
  throw new VrConfigDeployError(
    `设备返回错误：${row.msg || row.message || JSON.stringify(respData)}`,
    'CSM_BIZ_ERROR',
  );
};

export interface PushVRConfigOptions {
  vrId: string;
  domain: VrConfigDeployDomain;
  /** 平台意图；省略时从 SQLite 读取 */
  platformConfig?: VrConfigJson;
  /** 调用方已完成读设备并合并时使用，跳过 slice merge */
  preMergedConfig?: VrConfigJson;
  skipPush?: boolean;
  /** skipPush 或设备不可达时是否回退读平台库 */
  allowDbFallbackOnDeviceError?: boolean;
  /** 为 true 时跳过 DOMAIN_OVERWRITE 漂移拦截（用户已确认覆盖） */
  acknowledgeDrift?: boolean;
  /** 为 true 时不做漂移检测（如 NAT 已在设备态完成 merge） */
  skipDriftCheck?: boolean;
}

export interface PushVRConfigResult {
  status: 'success' | 'skipped';
  mergedConfig: VrConfigJson;
  deviceResponse?: unknown;
  driftWarnings?: VrConfigDriftConflict[];
}

const resolveSkipPush = (explicit?: boolean): boolean => {
  if (typeof explicit === 'boolean') return explicit;
  return String(process.env.SKIP_VR_PUSH || '').trim() === '1';
};

/**
 * 统一下发网关：读设备 → 分域 merge → 清洗 → updateVRConfig → 回写平台库。
 */
export const pushVRConfig = async (options: PushVRConfigOptions): Promise<PushVRConfigResult> => {
  const {
    vrId,
    domain,
    platformConfig,
    preMergedConfig,
    allowDbFallbackOnDeviceError,
    acknowledgeDrift,
    skipDriftCheck,
  } = options;
  const skipPush = resolveSkipPush(options.skipPush);

  let merged: VrConfigJson;
  let driftWarnings: VrConfigDriftConflict[] = [];
  let deviceConfigForDrift: VrConfigJson | null = null;
  let platformForDrift: VrConfigJson | null = null;

  if (preMergedConfig) {
    merged = deepClone(preMergedConfig);
  } else {
    let deviceConfig: VrConfigJson | null = null;
    try {
      deviceConfig = await getVRConfigFromDevice(vrId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (skipPush || allowDbFallbackOnDeviceError) {
        deployLog.warn(`设备配置读取失败，回退平台库：${vrId}`, msg);
        try {
          deviceConfig = await getVRConfigFromDB(vrId);
        } catch {
          deviceConfig = {};
        }
      } else {
        throw new VrConfigDeployError(
          `无法查询设备现有配置，已终止下发以避免覆盖: ${msg}`,
          'DEVICE_READ_FAILED',
        );
      }
    }

    const platform =
      platformConfig ??
      (await getVRConfigFromDB(vrId).catch(() => {
        throw new VrConfigDeployError(`缺少平台配置且平台库无记录：${vrId}`, 'PLATFORM_MISSING');
      }));

    deviceConfigForDrift = deviceConfig;
    platformForDrift = platform;
    merged = mergeDeviceWithPlatformSlice(deviceConfig ?? {}, platform, domain);
  }

  if (!skipDriftCheck && !preMergedConfig && deviceConfigForDrift && platformForDrift) {
    const conflicts = detectDeployDrift(deviceConfigForDrift, platformForDrift, domain);
    driftWarnings = conflicts.filter((c) => c.kind === 'PLATFORM_STALE');
    assertNoBlockingDeployDrift(conflicts, { acknowledgeDrift });
  }

  const cleanConfig = sanitizeConfig(stripMeta(deepClone(merged)));

  if (skipPush) {
    await saveVRConfigToDB(vrId, merged);
    return { status: 'skipped', mergedConfig: merged, driftWarnings };
  }

  deployLog.debug(`Pushing VR config (${domain})`, { vrId });
  const updateResp = await vrController.updateVRConfig(vrId, cleanConfig);
  const respData = updateResp.data || {};
  assertCsmUpdateSuccess(respData);

  await saveVRConfigToDB(vrId, merged);
  return {
    status: 'success',
    mergedConfig: merged,
    deviceResponse: respData,
    driftWarnings: driftWarnings.length ? driftWarnings : undefined,
  };
};
