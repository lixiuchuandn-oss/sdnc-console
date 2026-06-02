import dayjs from 'dayjs';
import { isSystemNamespace } from 'utils/harvesterUtils';

/**
 * HSM / 调度底座在自动触发的 VirtualMachineInstanceMigration 上打的 label。
 * 值为告警指纹，用于关联是哪次告警触发了本次热迁移（DRS 执行记录）。
 */
export const MIGRATION_AUTO_SCHEDULED_FINGERPRINT_LABEL =
  'hci.manager.system/auto-scheduled-fingerprint';

/** 列表行（K8s VirtualMachineInstanceMigration 及兼容结构） */
export type MigrationTableRow = Record<string, unknown>;

export type MigrationTriggerFilter = '' | 'auto' | 'manual';

/** 迁移对象字段读取（兼容多种后端结构） */
export const migrationRowFields = {
  base: (r: unknown) => {
    const row = r as { rawData?: unknown };
    return row?.rawData ? row.rawData : r;
  },
  phase: (r: unknown) => {
    const x = migrationRowFields.base(r) as { status?: { phase?: string }; Phase?: string; spec?: unknown };
    const row = r as { phase?: string; vmiName?: string; vmName?: string };
    return x?.status?.phase || row?.phase || x?.Phase || 'Unknown';
  },
  vmName: (r: unknown) => {
    const x = migrationRowFields.base(r) as {
      spec?: { vmiName?: string; vmi?: string };
      VmiName?: string;
    };
    const row = r as { vmiName?: string; vmName?: string };
    return x?.spec?.vmiName || row?.vmiName || x?.VmiName || x?.spec?.vmi || row?.vmName || '-';
  },
  sourceNode: (r: unknown) => {
    const x = migrationRowFields.base(r) as {
      status?: { migrationState?: { sourceNode?: string } };
      SourceNode?: string;
    };
    const row = r as { sourceNode?: string };
    return x?.status?.migrationState?.sourceNode || row?.sourceNode || x?.SourceNode || '-';
  },
  targetNode: (r: unknown) => {
    const x = migrationRowFields.base(r) as {
      status?: { migrationState?: { targetNode?: string } };
      TargetNode?: string;
    };
    const row = r as { targetNode?: string };
    return x?.status?.migrationState?.targetNode || row?.targetNode || x?.TargetNode || '自动调度';
  },
  namespace: (r: unknown) => {
    const x = migrationRowFields.base(r) as { metadata?: { namespace?: string }; Namespace?: string };
    const row = r as { namespace?: string };
    return x?.metadata?.namespace || row?.namespace || x?.Namespace || '-';
  },
  createdAt: (r: unknown) => {
    const x = migrationRowFields.base(r) as {
      metadata?: { creationTimestamp?: string };
      CreationTimestamp?: string;
    };
    const row = r as { createdAt?: string };
    return x?.metadata?.creationTimestamp || row?.createdAt || x?.CreationTimestamp || '';
  },
  uidOrKey: (r: unknown) => {
    const x = migrationRowFields.base(r) as { metadata?: { uid?: string; name?: string } };
    return (
      x?.metadata?.uid ||
      x?.metadata?.name ||
      `${migrationRowFields.namespace(r)}/${migrationRowFields.vmName(r)}`
    );
  },
  taskId: (r: unknown) => {
    const x = migrationRowFields.base(r) as { metadata?: { name?: string; uid?: string }; Name?: string };
    const row = r as { name?: string; uid?: string };
    return x?.metadata?.name || row?.name || x?.Name || x?.metadata?.uid || row?.uid || '-';
  },
  labels: (r: unknown) => {
    const x = migrationRowFields.base(r) as {
      metadata?: { labels?: Record<string, string> };
      labels?: Record<string, string>;
    };
    const row = r as { labels?: Record<string, string> };
    return x?.metadata?.labels || row?.labels || (r as { labels?: Record<string, string> })?.labels;
  },
  /** 自动调度（HSM/DRS）触发的告警指纹；无则 undefined */
  autoScheduledFingerprint: (r: unknown) => {
    const labels = migrationRowFields.labels(r);
    const v = labels?.[MIGRATION_AUTO_SCHEDULED_FINGERPRINT_LABEL];
    const s = v != null ? String(v).trim() : '';
    return s || undefined;
  },
  isAutoScheduledMigration: (r: unknown) => !!migrationRowFields.autoScheduledFingerprint(r),
};

export function translateMigrationPhase(phase: string): string {
  const phaseMap: Record<string, string> = {
    Pending: '等待中',
    Scheduling: '调度中',
    Scheduled: '已调度',
    Preparing: '准备中',
    Running: '迁移中',
    Succeeded: '成功',
    Failed: '失败',
    Unknown: '未知',
  };
  return phaseMap[phase] || phase;
}

export function isMigrationRunning(phase: string): boolean {
  return phase === 'Running' || phase === 'Scheduled' || phase === 'Scheduling' || phase === 'Preparing';
}

export function resolveVmDisplayName(
  record: unknown,
  vms: readonly unknown[] | undefined,
): string {
  const x = migrationRowFields.base(record) as {
    metadata?: { namespace?: string; annotations?: Record<string, string> };
  };
  const row = record as { namespace?: string; alias?: string };
  const ns = x?.metadata?.namespace || row?.namespace;
  const vmName = migrationRowFields.vmName(record);

  if (ns && vmName && vms && vms.length > 0) {
    const vm = vms.find((vmItem: unknown) => {
      const item = vmItem as { metadata?: { namespace?: string; name?: string }; namespace?: string; name?: string };
      const vmNs = item?.metadata?.namespace || item?.namespace;
      const vmItemName = item?.metadata?.name || item?.name;
      return vmNs === ns && vmItemName === vmName;
    }) as { metadata?: { annotations?: Record<string, string>; name?: string }; alias?: string; name?: string } | undefined;
    if (vm) {
      return (
        vm?.metadata?.annotations?.['tower.io/alias'] ||
        vm?.alias ||
        vm?.metadata?.name ||
        vm?.name ||
        vmName ||
        '-'
      );
    }
  }

  const alias = x?.metadata?.annotations?.['tower.io/alias'] || row?.alias || '';
  if (alias) return alias;
  return vmName || '-';
}

export type MigrationsFilterState = {
  keyword: string;
  statusFilter: string;
  namespaceFilter: string;
  triggerFilter: MigrationTriggerFilter;
};

export function filterMigrationsForTable(
  items: readonly MigrationTableRow[],
  f: MigrationsFilterState,
  vms: readonly unknown[] | undefined,
): MigrationTableRow[] {
  const k = f.keyword.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const ns = String(migrationRowFields.namespace(item) || '');
    const phase = String(migrationRowFields.phase(item) || '');
    if (f.namespaceFilter && ns !== f.namespaceFilter) return false;
    if (f.statusFilter && phase !== f.statusFilter) return false;
    if (f.triggerFilter === 'auto' && !migrationRowFields.isAutoScheduledMigration(item)) return false;
    if (f.triggerFilter === 'manual' && migrationRowFields.isAutoScheduledMigration(item)) return false;
    if (!k) return true;
    const taskId = String(migrationRowFields.taskId(item) || '').toLowerCase();
    const vmName = String(migrationRowFields.vmName(item) || '').toLowerCase();
    const vmDisplayName = String(resolveVmDisplayName(item, vms) || '').toLowerCase();
    const fingerprint = String(migrationRowFields.autoScheduledFingerprint(item) || '').toLowerCase();
    return (
      taskId.includes(k) ||
      vmName.includes(k) ||
      vmDisplayName.includes(k) ||
      fingerprint.includes(k)
    );
  });
  return filtered.sort((a, b) => {
    const timeA = migrationRowFields.createdAt(a);
    const timeB = migrationRowFields.createdAt(b);
    if (!timeA && !timeB) return 0;
    if (!timeA) return 1;
    if (!timeB) return -1;
    return dayjs(timeB).valueOf() - dayjs(timeA).valueOf();
  });
}

export function buildMigrationStatusOptions(items: readonly unknown[]) {
  return Array.from(
    new Set(items.map((item) => String(migrationRowFields.phase(item) || '').trim()).filter(Boolean)),
  )
    .sort()
    .map((phase) => ({ value: phase, label: translateMigrationPhase(phase) }));
}

export function buildMigrationNamespaceOptions(items: readonly unknown[]) {
  return Array.from(
    new Set(
      items
        .map((item) => String(migrationRowFields.namespace(item) || '').trim())
        .filter((ns) => ns && !isSystemNamespace(ns)),
    ),
  ).sort();
}
