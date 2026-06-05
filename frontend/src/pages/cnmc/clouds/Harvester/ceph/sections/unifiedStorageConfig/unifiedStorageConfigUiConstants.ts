/** 存储配置页 · 扁平 Tab 与 URL `operateTab` */

import {
  parseHarvesterAddonOperateTabKey,
  type HarvesterAddonOperateTabKey,
} from '../harvesterAddon/addonUiConstants';

export type StorageConfigFlatTabKey = 'overview' | 'rbd_mirror' | HarvesterAddonOperateTabKey;

const FLAT_TAB_KEYS = new Set<string>([
  'overview',
  'rbd_mirror',
  'config',
  'storage_pools',
  'expand',
  'storage_network',
  'sdrs_policy',
  'sdrs_tasks',
]);

export const STORAGE_CONFIG_ADDON_OPERATE_TAB_KEYS: readonly HarvesterAddonOperateTabKey[] = [
  'config',
  'storage_pools',
  'expand',
  'storage_network',
  'sdrs_policy',
  'sdrs_tasks',
];

export function isStorageConfigAddonTabKey(key: string): key is HarvesterAddonOperateTabKey {
  return parseHarvesterAddonOperateTabKey(key) != null;
}

export function parseStorageConfigFlatTabKey(
  raw: string | null | undefined,
): StorageConfigFlatTabKey | null {
  const k = String(raw || '').trim();
  if (!k || !FLAT_TAB_KEYS.has(k)) return null;
  if (k === 'overview' || k === 'rbd_mirror') return k;
  return parseHarvesterAddonOperateTabKey(k);
}

/** 历史独立 pathSeg → operateTab */
export const LEGACY_STORAGE_CONFIG_OPERATE_TAB: Readonly<Record<string, string>> = {
  overview: 'overview',
  ceph_storage_overview: 'overview',
  rbd_mirror: 'rbd_mirror',
  storage_pools: 'storage_pools',
  storage_drs: 'sdrs_policy',
  ha_storage_drs: 'sdrs_policy',
};

export function legacyStorageConfigOperateTab(innerSeg: string): string | null {
  return LEGACY_STORAGE_CONFIG_OPERATE_TAB[innerSeg] ?? null;
}

export function resolveStorageConfigFlatTab(
  operateTabRaw: string | null | undefined,
  fallback?: StorageConfigFlatTabKey,
): StorageConfigFlatTabKey {
  return parseStorageConfigFlatTabKey(operateTabRaw) ?? fallback ?? 'overview';
}

export const STORAGE_CONFIG_TAB_LOAD_KEY: Readonly<Partial<Record<StorageConfigFlatTabKey, string>>> = {
  overview: 'overview',
  rbd_mirror: 'rbd_mirror',
  config: 'harvester_addon',
  storage_pools: 'storage_pools',
  expand: 'harvester_addon',
  storage_network: 'harvester_addon',
  sdrs_policy: 'harvester_addon',
  sdrs_tasks: 'harvester_addon',
};
