/** StorageClass 列表 Section 纯函数 */

import type { StorageClassRow } from 'services/harvester/types/inventoryRows';

/** 从 StorageClass.parameters 推断后端块池（Rook/Ceph RBD 常用 pool；部分驱动用 blockPool / storagePool） */
export function storageClassBackendPoolLabel(r: StorageClassRow): string {
  const p = r?.parameters || {};
  const pool = String(p.pool ?? p.blockPool ?? p.storagePool ?? p.StoragePool ?? '').trim();
  const dataPool = String(p.dataPool ?? '').trim();
  if (pool && dataPool) return `${pool}（数据 ${dataPool}）`;
  if (pool) return pool;
  return '';
}

export type StorageClassesFilterState = {
  keyword: string;
  provisionerFilter: string;
  reclaimPolicyFilter: string;
};

export function filterStorageClassesForTable(
  rows: readonly StorageClassRow[],
  f: StorageClassesFilterState,
): StorageClassRow[] {
  const kw = f.keyword.trim().toLowerCase();
  const pf = f.provisionerFilter.trim().toLowerCase();
  const rf = f.reclaimPolicyFilter.trim().toLowerCase();
  return (rows || []).filter((r) => {
    const name = String(r?.metadata?.name || r?.name || '').toLowerCase();
    const provisioner = String(r?.provisioner || '').toLowerCase();
    const reclaimPolicy = String(r?.reclaimPolicy || '').toLowerCase();
    const poolHint = storageClassBackendPoolLabel(r).toLowerCase();
    if (kw && !(name.includes(kw) || provisioner.includes(kw) || poolHint.includes(kw))) return false;
    if (pf && provisioner !== pf) return false;
    if (rf && reclaimPolicy !== rf) return false;
    return true;
  });
}

export function storageClassRowKey(r: StorageClassRow): string {
  return String(r?.metadata?.name || r?.name || '');
}

export function buildStorageClassProvisionerOptions(rows: readonly StorageClassRow[]): string[] {
  return Array.from(
    new Set(rows.map((r) => String(r?.provisioner || '').trim()).filter(Boolean)),
  ).sort();
}

export function buildStorageClassReclaimPolicyOptions(rows: readonly StorageClassRow[]): string[] {
  return Array.from(
    new Set(rows.map((r) => String(r?.reclaimPolicy || '').trim()).filter(Boolean)),
  ).sort();
}
