import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { findHarvesterVmDisplayAlias, formatVmBackupRelativeAge } from './vmBackupDisplay';

export interface ScheduleVmBackupListRow {
  key: string;
  name: string;
  id: string;
  namespace: string;
  vmAlias: string;
  vmName: string;
  retention: string | number;
  maxFailure: string | number;
  type: string;
  cron: string;
  suspended: boolean;
  creationTimestamp?: string;
  age: string;
  raw: unknown;
  links?: Record<string, unknown>;
}

export type SuspendedOverride = { ns: string; id: string; suspended: boolean };
export type RemovedSchedule = { ns: string; id?: string; alias?: string };
export type SchedulePollingTarget = {
  namespace: string;
  alias: string;
  resourceName?: string;
};

export function mapScheduleVmBackupItem(
  b: unknown,
  vms: unknown[] | undefined,
  suspendedOverrides: SuspendedOverride[],
): ScheduleVmBackupListRow | null {
  const item = b as Record<string, unknown> & {
    rawData?: Record<string, unknown>;
    namespace?: string;
    name?: string;
    retention?: string | number;
    maxFailure?: string | number;
    vmName?: string;
    cron?: string;
    status?: string;
    createdAt?: string;
    links?: Record<string, unknown>;
  };
  const raw = (item.rawData || item) as Record<string, unknown> & {
    metadata?: {
      uid?: string;
      name?: string;
      namespace?: string;
      creationTimestamp?: string;
      annotations?: Record<string, string>;
    };
    spec?: {
      retain?: string | number;
      maxFailure?: string | number;
      type?: string;
      cron?: string;
      suspend?: boolean;
      targetVm?: string;
      vmbackup?: { type?: string; source?: { name?: string } };
    };
  };
  const ns = String(raw.metadata?.namespace || item.namespace || '');
  if (isSystemNamespace(ns)) return null;

  let retentionCount: string | number = '-';
  if (raw.spec?.retain !== undefined) retentionCount = raw.spec.retain;
  else if (item.retention !== undefined) retentionCount = item.retention;

  const id = String(raw.metadata?.name || item.name || '');
  const alias = raw.metadata?.annotations?.['tower.io/alias'];
  const displayName = alias || id;

  const vmNameRaw =
    raw.spec?.targetVm ||
    raw.spec?.vmbackup?.source?.name ||
    item.vmName ||
    '';
  const vmAlias = vmNameRaw
    ? findHarvesterVmDisplayAlias(vms as any[], ns, String(vmNameRaw))
    : '-';

  let isSuspended = raw.spec?.suspend === true || item.status === 'Suspended';
  const ov = suspendedOverrides.find((o) => o.ns === ns && o.id === id);
  if (ov) isSuspended = ov.suspended;

  return {
    key: raw.metadata?.uid || item.name || `${ns}-${id}`,
    name: String(displayName),
    id,
    namespace: ns,
    vmAlias,
    vmName: String(vmNameRaw),
    retention: retentionCount,
    maxFailure: raw.spec?.maxFailure || item.maxFailure || '-',
    type: raw.spec?.vmbackup?.type || raw.spec?.type || 'backup',
    cron: raw.spec?.cron || item.cron || '-',
    suspended: isSuspended,
    creationTimestamp: raw.metadata?.creationTimestamp || item.createdAt,
    age: formatVmBackupRelativeAge(
      String(raw.metadata?.creationTimestamp || item.createdAt || ''),
    ),
    raw,
    links: item.links || {},
  };
}

export function buildScheduleVmBackupDataSource(params: {
  data: unknown[] | undefined;
  vms?: unknown[];
  optimisticItems: ScheduleVmBackupListRow[];
  removed: RemovedSchedule[];
  suspendedOverrides: SuspendedOverride[];
}): ScheduleVmBackupListRow[] {
  const base = (params.data || [])
    .map((b) => mapScheduleVmBackupItem(b, params.vms, params.suspendedOverrides))
    .filter((x): x is ScheduleVmBackupListRow => x != null);

  const filteredBase = base.filter(
    (x) =>
      !params.removed.some(
        (r) =>
          r.ns === x.namespace &&
          ((r.id && r.id === x.id) || (r.alias && r.alias === x.name)),
      ),
  );

  const dedupedOptimistic = params.optimisticItems.filter(
    (o) => !filteredBase.some((x) => x.namespace === o.namespace && x.name === o.name),
  );

  return filteredBase.concat(dedupedOptimistic);
}

export type ScheduleVmBackupFilterParams = {
  keyword: string;
  typeFilter?: string;
  namespaceFilter?: string;
  vmId?: string;
  targetVmPredicate?: (namespace: string, vmName: string) => boolean;
};

export function filterScheduleVmBackupsForTable(
  dataSource: ScheduleVmBackupListRow[],
  params: ScheduleVmBackupFilterParams,
): ScheduleVmBackupListRow[] {
  let d = dataSource;
  if (params.typeFilter && params.typeFilter !== 'all') {
    d = d.filter((x) => x.type === params.typeFilter);
  }
  if (params.namespaceFilter) {
    d = d.filter((x) => x.namespace === params.namespaceFilter);
  }
  if (params.keyword) {
    const k = params.keyword.toLowerCase();
    d = d.filter(
      (x) =>
        x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k),
    );
  }
  if (params.vmId) {
    d = d.filter((x) => x.vmName === params.vmId);
  }
  if (params.targetVmPredicate) {
    d = d.filter(
      (x) => x.vmName && params.targetVmPredicate!(x.namespace, x.vmName),
    );
  }
  return d;
}

export function buildScheduleVmBackupNamespaceOptions(
  dataSource: ScheduleVmBackupListRow[],
): Array<{ value: string; label: string }> {
  const set = new Set<string>();
  dataSource.forEach((x) => {
    const ns = String(x.namespace || '').trim();
    if (ns) set.add(ns);
  });
  return Array.from(set)
    .sort()
    .map((v) => ({ value: v, label: v }));
}

export function schedulePollingTargetExists(
  data: unknown[] | undefined,
  target: SchedulePollingTarget,
): boolean {
  return (data || []).some((x: unknown) => {
    const item = x as Record<string, unknown> & {
      rawData?: Record<string, unknown>;
      namespace?: string;
      name?: string;
    };
    const raw = (item.rawData || item) as Record<string, unknown> & {
      metadata?: { namespace?: string; name?: string; annotations?: Record<string, string> };
    };
    const ns = raw.metadata?.namespace || item.namespace;
    const name = raw.metadata?.name || item.name;
    const alias = raw.metadata?.annotations?.['tower.io/alias'];
    return (
      ns === target.namespace &&
      (name === target.resourceName ||
        name === target.alias ||
        alias === target.alias)
    );
  });
}

export type ScheduleVmBackupCreatedPayload = {
  namespace: string;
  alias: string;
  vmName: string;
  type: 'backup' | 'snapshot';
  cron: string;
  retain: number;
  maxFailure: number;
  suspend: boolean;
  resourceName?: string;
};

export function buildOptimisticScheduleVmBackupRow(
  created: ScheduleVmBackupCreatedPayload,
  vmAlias: string,
): ScheduleVmBackupListRow {
  const resourceName = created.resourceName || '-';
  return {
    key: `opt-${Date.now()}`,
    name: created.alias,
    id: resourceName,
    namespace: created.namespace,
    vmAlias,
    vmName: created.vmName,
    retention: created.retain,
    maxFailure: created.maxFailure,
    type: created.type,
    cron: created.cron,
    suspended: created.suspend,
    creationTimestamp: new Date().toISOString(),
    age: '0 分钟',
    raw: {
      metadata: {
        namespace: created.namespace,
        name: resourceName,
        annotations: { 'tower.io/alias': created.alias },
      },
      spec: {
        suspend: created.suspend,
        cron: created.cron,
        retain: created.retain,
      },
    },
  };
}

export function scheduleSuspendPollingMatched(
  data: unknown[] | undefined,
  target: { ns: string; id: string; suspended: boolean },
): boolean {
  const rec = (data || []).find((x: unknown) => {
    const item = x as Record<string, unknown> & { rawData?: Record<string, unknown>; namespace?: string; name?: string };
    const raw = (item.rawData || item) as Record<string, unknown> & {
      metadata?: { namespace?: string; name?: string };
      spec?: { suspend?: boolean };
    };
    const ns = raw.metadata?.namespace || item.namespace;
    const id = raw.metadata?.name || item.name;
    return ns === target.ns && id === target.id;
  });
  if (!rec) return false;
  const item = rec as Record<string, unknown> & { rawData?: Record<string, unknown>; status?: string };
  const raw = (item.rawData || item) as Record<string, unknown> & { spec?: { suspend?: boolean } };
  const isSuspended = raw.spec?.suspend === true || item.status === 'Suspended';
  return isSuspended === target.suspended;
}
