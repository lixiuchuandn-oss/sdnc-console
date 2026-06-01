import {
  buildVmRestoreTaskRows,
  filterVmRestoreTasksForTable,
  getRestoreStatus,
  hasPendingRestoreTasks,
  isRestoreTaskRecord,
  vmLineDisplay,
} from './vmRestoreTasksSectionUtils';

describe('vmRestoreTasksSectionUtils', () => {
  const restore = {
    metadata: {
      uid: 'uid-1',
      name: 'restore-abc',
      namespace: 'proj-1',
      annotations: { 'tower.io/restoreTask': 'true' },
      creationTimestamp: '2026-01-02T00:00:00Z',
    },
    spec: {
      target: { name: 'vm-new' },
      virtualMachineBackupName: 'backup-a',
      virtualMachineBackupNamespace: 'proj-1',
      newVM: true,
    },
    status: {
      conditions: [{ type: 'Ready', status: 'True' }],
    },
  };

  it('isRestoreTaskRecord excludes clone tasks', () => {
    expect(isRestoreTaskRecord(restore)).toBe(true);
    expect(
      isRestoreTaskRecord({
        ...restore,
        metadata: {
          ...restore.metadata,
          annotations: { 'tower.io/cloneTask': 'true' },
        },
      }),
    ).toBe(false);
  });

  it('getRestoreStatus returns ready when conditions met', () => {
    const st = getRestoreStatus(restore);
    expect(st.phase).toBe('ready');
    expect(st.text).toBe('完成');
  });

  it('buildVmRestoreTaskRows maps backup linkage', () => {
    const backup = {
      metadata: { namespace: 'proj-1', name: 'backup-a' },
      spec: { type: 'backup', source: { name: 'vm-old' } },
    };
    const rows = buildVmRestoreTaskRows([restore], new Map([['proj-1/backup-a', backup]]), []);
    expect(rows).toHaveLength(1);
    expect(rows[0].restoreMode).toBe('新建');
    expect(rows[0].sourceVm).toBe('vm-old');
  });

  it('filterVmRestoreTasksForTable filters by status', () => {
    const rows = buildVmRestoreTaskRows([restore], new Map(), []);
    const pending = filterVmRestoreTasksForTable(rows, {
      keyword: '',
      statusFilter: 'ready',
      namespaceFilter: '',
      isPublicNamespace: () => false,
    });
    expect(pending).toHaveLength(1);
    expect(hasPendingRestoreTasks(pending)).toBe(false);
  });

  it('vmLineDisplay avoids duplicate technical id', () => {
    expect(vmLineDisplay('Web (vm-1)', 'vm-1')).toBe('Web (vm-1)');
    expect(vmLineDisplay(undefined, 'vm-1')).toBe('vm-1');
  });
});
