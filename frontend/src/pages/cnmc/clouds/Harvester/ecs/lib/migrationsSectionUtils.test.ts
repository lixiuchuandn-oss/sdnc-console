import { translateMigrationPhase, migrationRowFields } from './migrationsSectionUtils';

describe('migrationsSectionUtils', () => {
  it('translateMigrationPhase maps known phases', () => {
    expect(translateMigrationPhase('Running')).toBe('迁移中');
    expect(translateMigrationPhase('Succeeded')).toBe('成功');
  });

  it('migrationRowFields reads task id from metadata', () => {
    const id = migrationRowFields.taskId({
      metadata: { name: 'mig-1', namespace: 'ns' },
    });
    expect(id).toBe('mig-1');
  });
});
