import {
  buildScheduleVmBackupDataSource,
  buildScheduleVmBackupNamespaceOptions,
  filterScheduleVmBackupsForTable,
  schedulePollingTargetExists,
  scheduleSuspendPollingMatched,
  type ScheduleVmBackupListRow,
} from './scheduleVmBackupsSectionUtils';

describe('scheduleVmBackupsSectionUtils', () => {
  const schedule = {
    metadata: {
      uid: 'uid-1',
      name: 'sched-a',
      namespace: 'proj-1',
      annotations: { 'tower.io/alias': 'daily-backup' },
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      cron: '0 2 * * *',
      retain: 7,
      maxFailure: 3,
      type: 'backup',
      targetVm: 'vm-1',
      suspend: false,
    },
  };

  it('builds data source and filters by type', () => {
    const rows = buildScheduleVmBackupDataSource({
      data: [schedule, { ...schedule, spec: { ...schedule.spec, type: 'snapshot' } }],
      optimisticItems: [],
      removed: [],
      suspendedOverrides: [],
    });
    expect(rows).toHaveLength(2);
    const backupOnly = filterScheduleVmBackupsForTable(rows, {
      keyword: '',
      typeFilter: 'backup',
    });
    expect(backupOnly).toHaveLength(1);
    expect(backupOnly[0].id).toBe('sched-a');
  });

  it('excludes removed and merges optimistic rows', () => {
    const optimistic: ScheduleVmBackupListRow = {
      key: 'opt-1',
      name: 'new-alias',
      id: 'sched-new',
      namespace: 'proj-1',
      vmAlias: 'vm-1',
      vmName: 'vm-1',
      retention: 5,
      maxFailure: 1,
      type: 'backup',
      cron: '0 3 * * *',
      suspended: false,
      age: '0 分钟',
      raw: {},
    };
    const rows = buildScheduleVmBackupDataSource({
      data: [schedule],
      optimisticItems: [optimistic],
      removed: [{ ns: 'proj-1', id: 'sched-a' }],
      suspendedOverrides: [],
    });
    expect(rows.map((r) => r.id)).toEqual(['sched-new']);
  });

  it('schedulePollingTargetExists matches alias or resource name', () => {
    expect(
      schedulePollingTargetExists([schedule], {
        namespace: 'proj-1',
        alias: 'daily-backup',
      }),
    ).toBe(true);
    expect(
      schedulePollingTargetExists([schedule], {
        namespace: 'proj-1',
        alias: 'missing',
        resourceName: 'sched-a',
      }),
    ).toBe(true);
  });

  it('scheduleSuspendPollingMatched detects suspend state', () => {
    expect(
      scheduleSuspendPollingMatched([schedule], {
        ns: 'proj-1',
        id: 'sched-a',
        suspended: false,
      }),
    ).toBe(true);
    expect(
      scheduleSuspendPollingMatched(
        [{ ...schedule, spec: { ...schedule.spec, suspend: true } }],
        { ns: 'proj-1', id: 'sched-a', suspended: true },
      ),
    ).toBe(true);
  });

  it('buildScheduleVmBackupNamespaceOptions dedupes namespaces', () => {
    const rows = buildScheduleVmBackupDataSource({
      data: [schedule, { ...schedule, metadata: { ...schedule.metadata, uid: 'uid-2', name: 'sched-b' } }],
      optimisticItems: [],
      removed: [],
      suspendedOverrides: [],
    });
    expect(buildScheduleVmBackupNamespaceOptions(rows)).toEqual([
      { value: 'proj-1', label: 'proj-1' },
    ]);
  });
});
