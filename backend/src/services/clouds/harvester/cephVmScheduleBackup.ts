import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson } from './utils';

const CEPH_SCHEDULE_VM_BACKUP_API = 'hms.rivercloud.com/v1';
const CEPH_SCHEDULE_VM_BACKUP_KIND = 'ScheduleCephVmBackup';

function harvesterOrigin(endpoint: string): string {
  const base = (endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

export function isCephScheduleVmBackupResource(item: any): boolean {
  if (!item) return false;
  const kind = String(item?.kind || '').toLowerCase();
  if (kind === 'schedulecephvmbackup') return true;
  if (kind === 'schedulevmbackup') return false;
  return String(item?.metadata?.annotations?.['tower.io/scheduleBackupBackend'] || '') === 'ceph';
}

function clampCephScheduleRetain(n: unknown): number {
  const v = Number.isFinite(Number(n)) ? Math.floor(Number(n)) : 8;
  return Math.min(250, Math.max(2, v));
}

function clampCephScheduleMaxFailure(n: unknown): number {
  const v = Number.isFinite(Number(n)) ? Math.floor(Number(n)) : 4;
  return Math.max(2, v);
}

function toCephScheduleResourceName(alias: string): string {
  const slug = String(alias || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  if (slug && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(slug)) {
    return slug.startsWith('scvmb-') ? slug : `scvmb-${slug}`;
  }
  return `scvmb-${Math.random().toString(36).slice(2, 14)}`;
}

/** 从 Longhorn / Ceph 定时策略 raw 提取 inventory 列字段 */
export function scheduleInventoryFieldsFromRaw(item: any) {
  const ceph = isCephScheduleVmBackupResource(item);
  const spec = item?.spec || {};
  if (ceph) {
    const backupType = spec.type === 'snapshot' ? 'snapshot' : 'backup';
    return {
      cron: spec.cron,
      vmName: String(spec.targetVm || '').trim() || undefined,
      retention: String(spec.retain ?? ''),
      status: spec.suspend ? 'Suspended' : 'Active',
      maxFailure: spec.maxFailure,
      backupType,
    };
  }
  return {
    cron: spec.cron,
    vmName: spec.vmbackup?.source?.name,
    retention: String(spec.retain || ''),
    status: spec.suspend ? 'Suspended' : 'Active',
    maxFailure: spec.maxFailure,
    backupType: spec.vmbackup?.type || 'backup',
  };
}

/**
 * 规范化为与 ScheduleVMBackup 相近的结构，供 Tower 列表/编辑复用 vmbackup.source 等字段。
 */
export function normalizeCephScheduleVmBackupForInventory(item: any): any {
  const targetVm = String(item?.spec?.targetVm || '').trim();
  const backupType = item?.spec?.type === 'snapshot' ? 'snapshot' : 'backup';
  const alias = item?.metadata?.annotations?.['tower.io/alias'];
  return {
    ...item,
    apiVersion: item?.apiVersion || CEPH_SCHEDULE_VM_BACKUP_API,
    kind: CEPH_SCHEDULE_VM_BACKUP_KIND,
    metadata: {
      ...(item?.metadata || {}),
      annotations: {
        ...(item?.metadata?.annotations || {}),
        'tower.io/scheduleBackupBackend': 'ceph',
        ...(alias ? { 'tower.io/alias': alias } : {}),
      },
    },
    spec: {
      cron: item?.spec?.cron,
      retain: item?.spec?.retain,
      maxFailure: item?.spec?.maxFailure,
      suspend: item?.spec?.suspend,
      type: backupType,
      targetVm,
      vmbackup: {
        source: {
          apiGroup: 'kubevirt.io',
          kind: 'VirtualMachine',
          name: targetVm,
        },
        type: backupType,
      },
    },
  };
}

export async function listHarvesterScheduleCephVmBackupsRaw({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> {
  const origin = harvesterOrigin(endpoint || '');
  const candidates = [
    `${origin}/apis/${CEPH_SCHEDULE_VM_BACKUP_API}/schedulecephvmbackups`,
    `${origin}/v1/hms.rivercloud.com.schedulecephvmbackups`,
  ];
  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      const items = Array.isArray(json?.items)
        ? json.items
        : Array.isArray(json?.data)
          ? json.data
          : [];
      if (items.length >= 0) return items;
    } catch (e: any) {
      if (Number(e?.status) === 404) continue;
    }
  }
  return [];
}

export async function getHarvesterScheduleCephVmBackup(
  params: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any | null> {
  const origin = harvesterOrigin(params.endpoint || '');
  const candidates = [
    `${origin}/apis/${CEPH_SCHEDULE_VM_BACKUP_API}/namespaces/${encodeURIComponent(namespace)}/schedulecephvmbackups/${encodeURIComponent(name)}`,
    `${origin}/v1/hms.rivercloud.com.schedulecephvmbackups/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  ];
  for (const url of candidates) {
    try {
      return await getJsonOnce(url, params.token || '', params.insecure ?? false);
    } catch (e: any) {
      if (Number(e?.status) === 404) continue;
      throw e;
    }
  }
  return null;
}

export async function createHarvesterScheduleCephVmBackup(
  params: HarvesterTestParams,
  namespace: string,
  payload: {
    name: string;
    vmName: string;
    cron: string;
    retain?: number;
    maxFailure?: number;
    suspend?: boolean;
    type?: 'backup' | 'snapshot';
  },
): Promise<any> {
  const origin = harvesterOrigin(params.endpoint || '');
  const resourceName = toCephScheduleResourceName(payload.name);
  const backupType = payload.type === 'snapshot' ? 'snapshot' : 'backup';
  const body = {
    apiVersion: CEPH_SCHEDULE_VM_BACKUP_API,
    kind: CEPH_SCHEDULE_VM_BACKUP_KIND,
    metadata: {
      name: resourceName,
      namespace,
      annotations: {
        'tower.io/alias': payload.name,
        'tower.io/scheduleBackupBackend': 'ceph',
      },
    },
    spec: {
      cron: payload.cron,
      type: backupType,
      targetVm: payload.vmName,
      retain: clampCephScheduleRetain(payload.retain),
      maxFailure: clampCephScheduleMaxFailure(payload.maxFailure),
      suspend: payload.suspend === true,
    },
  };

  const candidates = [
    `${origin}/apis/${CEPH_SCHEDULE_VM_BACKUP_API}/namespaces/${encodeURIComponent(namespace)}/schedulecephvmbackups`,
    `${origin}/v1/hms.rivercloud.com.schedulecephvmbackups/${encodeURIComponent(namespace)}`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      return await requestJson('POST', url, params.token || '', params.insecure ?? false, body);
    } catch (e: any) {
      lastErr = e;
      if (Number(e?.status) === 404) continue;
    }
  }
  throw (
    lastErr ||
    new Error('创建 ScheduleCephVmBackup 失败：集群未安装 hms.rivercloud.com ScheduleCephVmBackup CRD')
  );
}

export async function updateHarvesterScheduleCephVmBackup(
  params: HarvesterTestParams,
  namespace: string,
  name: string,
  payload: {
    cron?: string;
    retain?: number;
    maxFailure?: number;
    suspend?: boolean;
    annotations?: Record<string, string>;
  },
): Promise<any> {
  const existing = await getHarvesterScheduleCephVmBackup(params, namespace, name);
  if (!existing) throw new Error('ScheduleCephVmBackup not found');

  const updated = { ...existing };
  if (!updated.spec) updated.spec = {};

  if (payload.cron !== undefined) updated.spec.cron = payload.cron;
  if (payload.retain !== undefined) updated.spec.retain = clampCephScheduleRetain(payload.retain);
  if (payload.maxFailure !== undefined) {
    updated.spec.maxFailure = clampCephScheduleMaxFailure(payload.maxFailure);
  }
  if (payload.suspend !== undefined) updated.spec.suspend = payload.suspend;

  if (payload.annotations) {
    updated.metadata = updated.metadata || {};
    updated.metadata.annotations = {
      ...(updated.metadata.annotations || {}),
      ...payload.annotations,
    };
  }

  const origin = harvesterOrigin(params.endpoint || '');
  const candidates = [
    `${origin}/apis/${CEPH_SCHEDULE_VM_BACKUP_API}/namespaces/${encodeURIComponent(namespace)}/schedulecephvmbackups/${encodeURIComponent(name)}`,
    `${origin}/v1/hms.rivercloud.com.schedulecephvmbackups/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      return await requestJson('PUT', url, params.token || '', params.insecure ?? false, updated);
    } catch (e: any) {
      lastErr = e;
      if (Number(e?.status) === 404) continue;
    }
  }
  throw lastErr || new Error(`更新 ScheduleCephVmBackup ${namespace}/${name} 失败`);
}

export async function deleteHarvesterScheduleCephVmBackup(
  params: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any> {
  const origin = harvesterOrigin(params.endpoint || '');
  const candidates = [
    `${origin}/apis/${CEPH_SCHEDULE_VM_BACKUP_API}/namespaces/${encodeURIComponent(namespace)}/schedulecephvmbackups/${encodeURIComponent(name)}`,
    `${origin}/v1/hms.rivercloud.com.schedulecephvmbackups/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  ];
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      return await requestJson('DELETE', url, params.token || '', params.insecure ?? false);
    } catch (e: any) {
      lastErr = e;
      if (Number(e?.status) === 404) continue;
    }
  }
  throw lastErr || new Error(`删除 ScheduleCephVmBackup ${namespace}/${name} 失败`);
}
