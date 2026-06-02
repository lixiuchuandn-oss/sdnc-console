import {
  MIGRATION_AUTO_SCHEDULED_FINGERPRINT_LABEL,
  migrationRowFields,
  filterMigrationsForTable,
} from './migrationsSectionUtils';

describe('migrationsSectionUtils auto-scheduled fingerprint', () => {
  const autoRow = {
    metadata: {
      labels: {
        [MIGRATION_AUTO_SCHEDULED_FINGERPRINT_LABEL]: 'alert-abc-123',
      },
      namespace: 'default',
    },
    status: { phase: 'Succeeded' },
    spec: { vmiName: 'vm-1' },
  };

  it('reads fingerprint from migration labels', () => {
    expect(migrationRowFields.autoScheduledFingerprint(autoRow)).toBe('alert-abc-123');
    expect(migrationRowFields.isAutoScheduledMigration(autoRow)).toBe(true);
  });

  it('filters auto vs manual trigger', () => {
    const manualRow = { metadata: { namespace: 'default' }, status: { phase: 'Succeeded' } };
    const list = [autoRow, manualRow];
    expect(
      filterMigrationsForTable(list, { keyword: '', statusFilter: '', namespaceFilter: '', triggerFilter: 'auto' }, []),
    ).toHaveLength(1);
    expect(
      filterMigrationsForTable(list, { keyword: '', statusFilter: '', namespaceFilter: '', triggerFilter: 'manual' }, []),
    ).toHaveLength(1);
  });
});
