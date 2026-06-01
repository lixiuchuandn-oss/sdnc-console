import {
  backupDisplayLabel,
  buildBackupNamespaceOptions,
  filterBackupsForTable,
  normalizeBackupList,
} from './backupsSectionUtils';

describe('backupsSectionUtils', () => {
  const backup = {
    metadata: {
      uid: 'uid-1',
      name: 'backup-a',
      namespace: 'proj-1',
      annotations: { 'tower.io/alias': 'nightly-backup' },
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: { type: 'backup', source: { name: 'vm-1' } },
    status: { readyToUse: true },
  };

  it('normalizes backup rows by type', () => {
    const rows = normalizeBackupList({
      backups: [backup, { ...backup, spec: { type: 'snapshot', source: { name: 'vm-1' } } }],
      type: 'backup',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('backup-a');
    expect(rows[0].readyToUse).toBe(true);
  });

  it('filters by ready status and keyword', () => {
    const rows = normalizeBackupList({
      backups: [
        backup,
        {
          ...backup,
          metadata: { ...backup.metadata, uid: 'uid-2', name: 'backup-b' },
          status: { readyToUse: false },
        },
      ],
      type: 'backup',
    });
    const ready = filterBackupsForTable(rows, {
      keyword: '',
      statusFilter: 'ready',
      isPublicNamespace: () => false,
    });
    expect(ready).toHaveLength(1);
    expect(ready[0].name).toBe('backup-a');

    const byName = filterBackupsForTable(rows, {
      keyword: 'backup-b',
      isPublicNamespace: () => false,
    });
    expect(byName).toHaveLength(1);
    expect(byName[0].name).toBe('backup-b');
  });

  it('backupDisplayLabel prefers alias', () => {
    const row = normalizeBackupList({ backups: [backup], type: 'backup' })[0];
    expect(backupDisplayLabel(row)).toBe('nightly-backup');
  });

  it('buildBackupNamespaceOptions excludes system ns', () => {
    const rows = normalizeBackupList({
      backups: [
        backup,
        {
          ...backup,
          metadata: { ...backup.metadata, namespace: 'kube-system' },
        },
      ],
      type: 'backup',
    });
    const opts = buildBackupNamespaceOptions(rows, { isPublicNamespace: () => false });
    expect(opts.map((o) => o.value)).toEqual(['proj-1']);
  });
});
