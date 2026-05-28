/**
 * Harvester Setting `ceph-storage-network`：Ceph 专用存储网（名称固定）。
 * 未配置或 value 为空时，部署 Ceph 走管理网 `mgmt`。
 */
import {
  getHarvesterSettingRaw,
  getHarvesterSettingValue,
  updateHarvesterSettingValue,
} from './cluster';
import {
  extractKubernetesStatusMessage,
  getJsonOnce,
  requestJson,
  resolveHarvesterCloudKubeToken,
} from './utils';

/** Setting metadata.name，不可变更 */
export const CEPH_STORAGE_NETWORK_SETTING_NAME = 'ceph-storage-network';

export const CEPH_STORAGE_NETWORK_MGMT_CLUSTER = 'mgmt';

export type CephStorageNetworkConfig = {
  vlan: number;
  clusterNetwork: string;
  range: string;
  exclude?: string[];
};

export type CephStorageNetworkEffective = {
  mode: 'configured' | 'mgmt';
  settingName: typeof CEPH_STORAGE_NETWORK_SETTING_NAME;
  config: CephStorageNetworkConfig | null;
  rawValue: string | null;
};

function harvesterParams(cloud: {
  endpoint?: string | null;
  secretKey?: string | null;
  config?: { ignoreTls?: boolean; apiToken?: string; token?: string } | null;
}) {
  return {
    endpoint: cloud.endpoint || '',
    token: resolveHarvesterCloudKubeToken(cloud),
    insecure: !!(cloud.config as { ignoreTls?: boolean } | null)?.ignoreTls,
  };
}

function normalizeOrigin(endpoint: string): string {
  const base = String(endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

export function parseCephStorageNetworkValue(
  raw: string | null | undefined,
): CephStorageNetworkConfig | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const vlan = Number(parsed.vlan);
    const clusterNetwork = String(parsed.clusterNetwork ?? '').trim();
    const range = String(parsed.range ?? '').trim();
    if (!Number.isFinite(vlan) || vlan < 1 || vlan > 4094) return null;
    if (!clusterNetwork || !range) return null;
    const exclude = Array.isArray(parsed.exclude)
      ? parsed.exclude.map((x) => String(x ?? '').trim()).filter(Boolean)
      : undefined;
    return {
      vlan: Math.trunc(vlan),
      clusterNetwork,
      range,
      ...(exclude && exclude.length > 0 ? { exclude } : {}),
    };
  } catch {
    return null;
  }
}

export function serializeCephStorageNetworkValue(config: CephStorageNetworkConfig): string {
  const payload: Record<string, unknown> = {
    vlan: Math.trunc(config.vlan),
    clusterNetwork: String(config.clusterNetwork).trim(),
    range: String(config.range).trim(),
  };
  if (Array.isArray(config.exclude) && config.exclude.length > 0) {
    payload.exclude = config.exclude.map((x) => String(x).trim()).filter(Boolean);
  }
  return JSON.stringify(payload);
}

export function isCephStorageNetworkConfigured(
  config: CephStorageNetworkConfig | null | undefined,
): boolean {
  return !!config?.clusterNetwork && !!config?.range && Number.isFinite(config.vlan);
}

export function validateCephStorageNetworkConfig(
  config: CephStorageNetworkConfig,
): string | null {
  const vlan = Number(config.vlan);
  if (!Number.isFinite(vlan) || vlan < 1 || vlan > 4094) {
    return 'VLAN ID 须为 1–4094 的整数';
  }
  const clusterNetwork = String(config.clusterNetwork ?? '').trim();
  if (!clusterNetwork) return '请选择或填写集群网络';
  const range = String(config.range ?? '').trim();
  if (!range) return '请填写存储网 IP 段（CIDR）';
  if (!/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(range)) {
    return 'IP 段须为 IPv4 CIDR 格式，例如 176.11.0.0/24';
  }
  if (Array.isArray(config.exclude)) {
    for (const item of config.exclude) {
      const ex = String(item ?? '').trim();
      if (ex && !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(ex)) {
        return `排除地址 ${ex} 须为 CIDR 格式`;
      }
    }
  }
  return null;
}

export async function fetchCephStorageNetworkEffective(cloud: {
  endpoint?: string | null;
  secretKey?: string | null;
  config?: { ignoreTls?: boolean; apiToken?: string; token?: string } | null;
}): Promise<CephStorageNetworkEffective> {
  const params = harvesterParams(cloud);
  const rawValue = await getHarvesterSettingValue(params, CEPH_STORAGE_NETWORK_SETTING_NAME);
  const config = parseCephStorageNetworkValue(rawValue);
  if (isCephStorageNetworkConfigured(config)) {
    return {
      mode: 'configured',
      settingName: CEPH_STORAGE_NETWORK_SETTING_NAME,
      config,
      rawValue: rawValue ?? serializeCephStorageNetworkValue(config!),
    };
  }
  return {
    mode: 'mgmt',
    settingName: CEPH_STORAGE_NETWORK_SETTING_NAME,
    config: null,
    rawValue: rawValue ?? null,
  };
}

/** 读取 Setting；仅 404 视为不存在，其它错误原样抛出（避免把 500 误判为未配置） */
async function fetchHarvesterSettingForUpsert(
  params: ReturnType<typeof harvesterParams>,
  name: string,
): Promise<Record<string, unknown> | null> {
  const origin = normalizeOrigin(params.endpoint);
  const url = `${origin}/v1/harvester/harvesterhci.io.settings/${encodeURIComponent(name)}`;
  try {
    const json = await getJsonOnce(url, params.token, params.insecure, true);
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status;
    if (status === 404) return null;
    throw e;
  }
}

async function createHarvesterSetting(
  params: ReturnType<typeof harvesterParams>,
  name: string,
  value: string,
): Promise<void> {
  const origin = normalizeOrigin(params.endpoint);
  const url = `${origin}/v1/harvester/harvesterhci.io.settings`;
  await requestJson(
    'POST',
    url,
    params.token,
    params.insecure,
    {
      type: 'harvesterhci.io.setting',
      metadata: { name },
      value,
    },
    { 'Content-Type': 'application/json' },
  );
}

async function upsertHarvesterSettingValue(
  cloud: {
    endpoint?: string | null;
    secretKey?: string | null;
    config?: { ignoreTls?: boolean; apiToken?: string; token?: string } | null;
  },
  name: string,
  value: string,
): Promise<void> {
  const params = harvesterParams(cloud);
  const current = await fetchHarvesterSettingForUpsert(params, name);

  if (current) {
    const rv =
      (current.metadata as { resourceVersion?: string } | undefined)?.resourceVersion ||
      (current as { resourceVersion?: string }).resourceVersion;
    await updateHarvesterSettingValue(params, name, value, rv);
    return;
  }

  try {
    await createHarvesterSetting(params, name, value);
  } catch (createErr: unknown) {
    const body = (createErr as { body?: unknown })?.body;
    const detail = extractKubernetesStatusMessage(body);
    const err = new Error(
      detail ||
        `Harvester 中不存在 Setting「${name}」且无法自动创建。请确认集群已注册该 Setting（HMS/Ceph 扩展），或在 Harvester 中手动创建后再保存。`,
    );
    (err as { status?: number }).status =
      (createErr as { status?: number })?.status === 404 ? 404 : 502;
    throw err;
  }
}

/** 写入或清空 `ceph-storage-network` Setting（清空表示走管理网） */
export async function applyCephStorageNetworkSetting(
  cloud: {
    endpoint?: string | null;
    secretKey?: string | null;
    config?: { ignoreTls?: boolean; apiToken?: string; token?: string } | null;
  },
  input: { enabled: boolean; config?: CephStorageNetworkConfig | null },
): Promise<CephStorageNetworkEffective> {
  if (!input.enabled) {
    await upsertHarvesterSettingValue(cloud, CEPH_STORAGE_NETWORK_SETTING_NAME, '');
    return fetchCephStorageNetworkEffective(cloud);
  }
  const config = input.config;
  if (!config) {
    const err = new Error('启用存储网时须提供 vlan、clusterNetwork 与 range');
    (err as { status?: number }).status = 400;
    throw err;
  }
  const validationError = validateCephStorageNetworkConfig(config);
  if (validationError) {
    const err = new Error(validationError);
    (err as { status?: number }).status = 400;
    throw err;
  }
  const value = serializeCephStorageNetworkValue(config);
  await upsertHarvesterSettingValue(cloud, CEPH_STORAGE_NETWORK_SETTING_NAME, value);
  return fetchCephStorageNetworkEffective(cloud);
}

/**
 * 部署 rook-ceph Addon 前：已配置则保持 Setting；未配置则不写入（Harvester 侧走管理网）。
 */
export async function prepareCephStorageNetworkForAddonDeploy(cloud: {
  endpoint?: string | null;
  secretKey?: string | null;
  config?: { ignoreTls?: boolean; apiToken?: string; token?: string } | null;
}): Promise<CephStorageNetworkEffective> {
  return fetchCephStorageNetworkEffective(cloud);
}

export async function readCephStorageNetworkSettingRaw(cloud: {
  endpoint?: string | null;
  secretKey?: string | null;
  config?: { ignoreTls?: boolean; apiToken?: string; token?: string } | null;
}): Promise<unknown | null> {
  const params = harvesterParams(cloud);
  return getHarvesterSettingRaw(params, CEPH_STORAGE_NETWORK_SETTING_NAME);
}
