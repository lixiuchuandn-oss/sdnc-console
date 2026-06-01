import {
  harvesterScheduleVmBackupSourceVmName,
  isHarvesterCephScheduleVmBackup,
} from '../../../../../../utils/harvesterUtils';
import { findHarvesterVmDisplayAlias } from './vmBackupDisplay';
import {
  buildScheduleCronExpression,
  type ScheduleCronMode,
  type ScheduleUiCron,
} from './scheduleVmBackupCreateModalUtils';

export type ScheduleEditFormValues = {
  namespace: string;
  name: string;
  alias: string;
  vmName: string;
  retain: number;
  maxFailure: number;
  suspend: boolean;
  cron: string;
};

export type ScheduleEditUiState = {
  cronMode: ScheduleCronMode;
  uiCron: ScheduleUiCron;
};

/** 从已有 cron 推断 daily / weekly / custom 及 UI 时分星期 */
export function parseScheduleCronToUiState(currentCron: string): ScheduleEditUiState {
  let cronMode: ScheduleCronMode = 'custom';
  let uiCron: ScheduleUiCron = { hour: 0, minute: 0, weekDay: 0 };

  const parts = String(currentCron || '').split(' ');
  if (parts.length === 5) {
    const [m, h, , mon, dow] = parts;
    if (parts[2] === '*' && mon === '*') {
      if (dow === '*') {
        cronMode = 'daily';
        uiCron = { hour: parseInt(h, 10) || 0, minute: parseInt(m, 10) || 0, weekDay: 0 };
      } else {
        cronMode = 'weekly';
        uiCron = {
          hour: parseInt(h, 10) || 0,
          minute: parseInt(m, 10) || 0,
          weekDay: parseInt(dow, 10) || 0,
        };
      }
    }
  }

  return { cronMode, uiCron };
}

export function resolveScheduleVmDisplayName(
  record: unknown,
  vms: unknown[] | undefined,
): string {
  const rec = record as Record<string, unknown> & {
    namespace?: string;
    vmAlias?: string;
    raw?: Record<string, unknown>;
  };
  const raw = (rec.raw || rec) as Record<string, unknown>;
  const spec = (raw.spec || {}) as Record<string, unknown> & {
    vmbackup?: { source?: { name?: string } };
    targetVm?: string;
  };
  const metadata = (raw.metadata || {}) as Record<string, unknown> & {
    namespace?: string;
  };

  const vmId =
    harvesterScheduleVmBackupSourceVmName(record) ||
    spec.vmbackup?.source?.name ||
    spec.targetVm ||
    '';
  const vmNamespace = String(metadata.namespace || rec.namespace || '');
  const vmDisplayRaw = findHarvesterVmDisplayAlias(vms as any[], vmNamespace, vmId);
  if (vmDisplayRaw !== vmId) return vmDisplayRaw;
  if (rec.vmAlias && rec.vmAlias !== '-') return String(rec.vmAlias);
  return vmDisplayRaw;
}

export function buildScheduleEditFormValues(
  record: unknown,
  vms?: unknown[],
): ScheduleEditFormValues {
  const rec = record as Record<string, unknown> & {
    namespace?: string;
    raw?: Record<string, unknown>;
  };
  const raw = (rec.raw || rec) as Record<string, unknown>;
  const spec = (raw.spec || {}) as Record<string, unknown> & {
    cron?: string;
    retain?: number;
    maxFailure?: number;
    suspend?: boolean;
  };
  const metadata = (raw.metadata || {}) as Record<string, unknown> & {
    namespace?: string;
    name?: string;
    annotations?: Record<string, string>;
  };

  const cephSchedule = isHarvesterCephScheduleVmBackup(record);
  const currentCron = String(spec.cron || '');

  return {
    namespace: String(metadata.namespace || ''),
    name: String(metadata.name || ''),
    alias: metadata.annotations?.['tower.io/alias'] || '',
    vmName: resolveScheduleVmDisplayName(record, vms),
    retain: Number(spec.retain ?? (cephSchedule ? 8 : 10)),
    maxFailure: Number(spec.maxFailure ?? (cephSchedule ? 4 : 5)),
    suspend: !!spec.suspend,
    cron: currentCron,
  };
}

export function buildScheduleEditInitialUiState(record: unknown): ScheduleEditUiState {
  const rec = record as Record<string, unknown> & { raw?: Record<string, unknown> };
  const raw = (rec.raw || rec) as Record<string, unknown>;
  const spec = (raw.spec || {}) as { cron?: string };
  return parseScheduleCronToUiState(String(spec.cron || ''));
}

export function syncScheduleEditCronField(
  cronMode: ScheduleCronMode,
  uiCron: ScheduleUiCron,
  currentCron: string | undefined,
): string | null {
  const nextCron = buildScheduleCronExpression(cronMode, uiCron);
  if (nextCron == null || currentCron === nextCron) return null;
  return nextCron;
}

export function buildScheduleEditUpdatePayload(values: Pick<
  ScheduleEditFormValues,
  'cron' | 'retain' | 'maxFailure' | 'suspend' | 'alias'
>) {
  return {
    cron: values.cron,
    retain: values.retain,
    maxFailure: values.maxFailure,
    suspend: values.suspend,
    labels: {},
    annotations: {
      'tower.io/alias': values.alias,
    },
  };
}

export function resolveScheduleEditTargetIds(record: unknown): {
  namespace: string;
  id: string;
} {
  const rec = record as Record<string, unknown> & {
    namespace?: string;
    id?: string;
    raw?: { metadata?: { namespace?: string; name?: string } };
  };
  return {
    namespace: String(rec.namespace || rec.raw?.metadata?.namespace || ''),
    id: String(rec.id || rec.raw?.metadata?.name || ''),
  };
}
