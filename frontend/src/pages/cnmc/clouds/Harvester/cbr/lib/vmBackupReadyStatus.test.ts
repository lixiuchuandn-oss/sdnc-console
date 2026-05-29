import {
  buildVmBackupCreateBlockedMessage,
  findInProgressHarvesterBackupForVm,
  isHarvesterVmBackupReady,
} from './vmBackupReadyStatus';

describe('vmBackupReadyStatus', () => {
  const longhornReady = {
    metadata: { namespace: 'proj-1', name: 'bk-ready' },
    spec: { type: 'backup', source: { name: 'vm-a' } },
    status: { readyToUse: true },
  };

  const longhornPending = {
    metadata: { namespace: 'proj-1', name: 'bk-pending' },
    spec: { type: 'snapshot', source: { name: 'vm-a' } },
    status: { readyToUse: false },
  };

  it('isHarvesterVmBackupReady respects readyToUse', () => {
    expect(isHarvesterVmBackupReady(longhornReady)).toBe(true);
    expect(isHarvesterVmBackupReady(longhornPending)).toBe(false);
  });

  it('findInProgressHarvesterBackupForVm returns pending backup for vm', () => {
    const hit = findInProgressHarvesterBackupForVm(
      [longhornReady, longhornPending],
      'proj-1',
      'vm-a',
    );
    expect(hit).toEqual({
      namespace: 'proj-1',
      name: 'bk-pending',
      itemType: 'snapshot',
      alias: undefined,
    });
  });

  it('buildVmBackupCreateBlockedMessage includes resource type', () => {
    expect(
      buildVmBackupCreateBlockedMessage({
        namespace: 'proj-1',
        name: 'bk-pending',
        itemType: 'snapshot',
      }),
    ).toContain('进行中的快照任务');
  });
});
