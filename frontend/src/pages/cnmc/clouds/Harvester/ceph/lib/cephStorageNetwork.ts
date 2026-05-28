/** Harvester Setting `ceph-storage-network`（名称固定，不可改） */

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
  rawValue?: string | null;
};

export type CephStorageNetworkFormValues = {
  enabled: boolean;
  vlan?: number;
  clusterNetwork?: string;
  range?: string;
};

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

export function formValuesFromEffective(
  effective: CephStorageNetworkEffective | null | undefined,
): CephStorageNetworkFormValues {
  if (effective?.mode === 'configured' && effective.config) {
    return {
      enabled: true,
      vlan: effective.config.vlan,
      clusterNetwork: effective.config.clusterNetwork,
      range: effective.config.range,
    };
  }
  return { enabled: false, vlan: undefined, clusterNetwork: CEPH_STORAGE_NETWORK_MGMT_CLUSTER, range: '' };
}

export function formValuesToConfig(
  values: CephStorageNetworkFormValues,
): CephStorageNetworkConfig | null {
  if (!values.enabled) return null;
  const vlan = Number(values.vlan);
  const clusterNetwork = String(values.clusterNetwork ?? '').trim();
  const range = String(values.range ?? '').trim();
  if (!Number.isFinite(vlan) || !clusterNetwork || !range) return null;
  return { vlan: Math.trunc(vlan), clusterNetwork, range };
}

export function validateCephStorageNetworkForm(
  values: CephStorageNetworkFormValues,
): string | null {
  if (!values.enabled) return null;
  const config = formValuesToConfig(values);
  if (!config) return '请填写 VLAN、集群网络与 IP 段';
  const vlan = config.vlan;
  if (vlan < 1 || vlan > 4094) return 'VLAN ID 须为 1–4094';
  if (!/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(config.range)) {
    return 'IP 段须为 IPv4 CIDR，例如 176.11.0.0/24';
  }
  return null;
}

export function storageNetworkModeLabel(mode: CephStorageNetworkEffective['mode']): string {
  return mode === 'configured' ? '已配置专用存储网' : '使用管理网';
}

export function storageNetworkModeTagColor(mode: CephStorageNetworkEffective['mode']): string {
  return mode === 'configured' ? 'blue' : 'default';
}
