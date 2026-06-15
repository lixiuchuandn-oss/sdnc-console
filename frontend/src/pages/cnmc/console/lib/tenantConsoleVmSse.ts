/** 租户控制台 VM SSE 增量更新：行匹配键与 status 合并 */

import { getVmInstanceId } from '../../clouds/Harvester/ecs/lib/vmSectionUtils';

export function patchVmLocalPrintableStatus(
  rows: any[],
  instanceId: string,
  status: string,
): any[] {
  const target = String(instanceId || '').trim();
  if (!target) return rows;
  return (rows || []).map((vm) => {
    if (getVmInstanceId(vm) !== target) return vm;
    const prevStatus = vm?.status;
    const nextStatus =
      typeof prevStatus === 'string' || prevStatus == null
        ? { printableStatus: status, phase: status }
        : { ...prevStatus, printableStatus: status, phase: status };
    return { ...vm, status: nextStatus };
  });
}

export function collectVmSseStatusKeys(payload: {
  iid?: string;
  metadata?: { uid?: string; name?: string; namespace?: string };
}): string[] {
  const keys = new Set<string>();
  const iid = String(payload?.iid ?? '').trim();
  if (iid) keys.add(iid);
  const md = payload?.metadata;
  const uid = String(md?.uid ?? '').trim();
  const name = String(md?.name ?? '').trim();
  const namespace = String(md?.namespace ?? '').trim();
  if (uid) keys.add(uid);
  if (namespace && name) keys.add(`${namespace}/${name}`);
  return Array.from(keys);
}

export function collectVmRowMatchKeys(row: any): string[] {
  const keys = new Set<string>();
  if (row?.metadata?.namespace && row?.metadata?.name) {
    keys.add(`${row.metadata.namespace}/${row.metadata.name}`);
  }
  if (row?.id) keys.add(String(row.id));
  if (row?.metadata?.uid) keys.add(String(row.metadata.uid));
  if (row?.InstanceId) keys.add(String(row.InstanceId));
  return Array.from(keys);
}

export function findVmSseStatusUpdate(
  row: any,
  updates: Map<string, { status?: string; nodeName?: string; ips?: string[] }>,
): { status?: string; nodeName?: string; ips?: string[] } | undefined {
  for (const key of collectVmRowMatchKeys(row)) {
    const hit = updates.get(key);
    if (hit) return hit;
  }
  return undefined;
}

export function applyVmSseStatusPatch(
  row: any,
  patch: { status?: string; nodeName?: string; ips?: string[] },
): any {
  const statusStr = String(patch.status ?? '').trim();
  const nodeName = String(patch.nodeName ?? '');
  const ips = Array.isArray(patch.ips) ? patch.ips : [];

  const prevStatus = row?.status;
  const nextStatus =
    typeof prevStatus === 'string' || prevStatus == null
      ? { printableStatus: statusStr, phase: statusStr }
      : { ...prevStatus, printableStatus: statusStr, phase: statusStr };

  return {
    ...row,
    status: nextStatus,
    nodeName,
    ips,
    Extra: { ...(row.Extra || {}), NodeName: nodeName },
  };
}
