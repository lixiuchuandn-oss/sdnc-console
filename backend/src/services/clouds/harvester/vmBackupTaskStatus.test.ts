import {
  buildVmBackupCreateBlockedMessage,
  findInProgressHarvesterBackupForVm,
  isHarvesterVmBackupReady,
} from '../../../../services/clouds/harvester/vmBackupTaskStatus';

describe('vmBackupTaskStatus', () => {
  it('isHarvesterVmBackupReady for longhorn backup', () => {
    expect(
      isHarvesterVmBackupReady({
        metadata: { name: 'bk-1', namespace: 'ns-1' },
        spec: { source: { name: 'vm-1' } },
        status: { readyToUse: false },
      }),
    ).toBe(false);
  });

  it('findInProgressHarvesterBackupForVm ignores ready backups', () => {
    const hit = findInProgressHarvesterBackupForVm(
      [
        {
          metadata: { namespace: 'ns-1', name: 'bk-ready' },
          spec: { type: 'backup', source: { name: 'vm-1' } },
          status: { readyToUse: true },
        },
        {
          metadata: { namespace: 'ns-1', name: 'bk-pending' },
          spec: { type: 'backup', source: { name: 'vm-1' } },
          status: { readyToUse: false },
        },
      ],
      'ns-1',
      'vm-1',
    );
    expect(hit?.name).toBe('bk-pending');
    expect(buildVmBackupCreateBlockedMessage(hit!)).toContain('进行中的备份任务');
  });
});
