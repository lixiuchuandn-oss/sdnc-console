import {
  buildScheduleCronExpression,
  filterNamespacesForScheduleCreate,
  filterVmsForScheduleCreate,
  parseScheduleVmBackupCreateErrorMessage,
} from './scheduleVmBackupCreateModalUtils';

describe('scheduleVmBackupCreateModalUtils', () => {
  it('buildScheduleCronExpression for daily and weekly', () => {
    expect(buildScheduleCronExpression('daily', { hour: 2, minute: 15, weekDay: 0 })).toBe(
      '15 2 * * *',
    );
    expect(buildScheduleCronExpression('weekly', { hour: 3, minute: 5, weekDay: 1 })).toBe(
      '5 3 * * 1',
    );
    expect(buildScheduleCronExpression('custom', { hour: 0, minute: 0, weekDay: 0 })).toBeNull();
  });

  it('filterNamespacesForScheduleCreate narrows to initial vm namespace', () => {
    const namespaces = [{ metadata: { name: 'ns-a' } }, { metadata: { name: 'ns-b' } }];
    const vms = [{ metadata: { name: 'vm-1', namespace: 'ns-b' } }];
    expect(
      filterNamespacesForScheduleCreate(namespaces, vms, 'vm-1').map(
        (n: any) => n.metadata.name,
      ),
    ).toEqual(['ns-b']);
  });

  it('filterVmsForScheduleCreate excludes recycle bin vms', () => {
    const vms = [
      { metadata: { name: 'vm-1', namespace: 'ns-a' } },
      {
        metadata: {
          name: 'vm-r',
          namespace: 'ns-a',
          finalizers: ['tower.io/recycle-bin'],
        },
      },
    ];
    expect(filterVmsForScheduleCreate(vms, 'ns-a').map((v: any) => v.metadata.name)).toEqual([
      'vm-1',
    ]);
  });

  it('parseScheduleVmBackupCreateErrorMessage handles schedule conflict', () => {
    const msg = parseScheduleVmBackupCreateErrorMessage(
      '创建失败|{"message":"vm default/vm-1 already has backup schedule"}',
      {
        namespace: 'default',
        vmName: 'vm-1',
        vms: [{ metadata: { name: 'vm-1', namespace: 'default', annotations: { 'tower.io/alias': 'Web' } } }],
      },
    );
    expect(msg).toContain('Web');
    expect(msg).toContain('备份');
  });

  it('parseScheduleVmBackupCreateErrorMessage handles granularity conflict', () => {
    const msg = parseScheduleVmBackupCreateErrorMessage(
      '创建失败|{"message":"same granularity offset less than 10 minutes"}',
      {},
    );
    expect(msg).toContain('时间冲突');
  });
});
