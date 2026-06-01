import {
  buildRestoreBlockingDeleteMessage,
  findRestoreBlockingBackupDelete,
} from './checkBackupDeleteBlocked';
import { fetchHarvesterVmRestoreTaskList } from 'services/harvester/cbr';

jest.mock('services/harvester/cbr', () => ({
  fetchHarvesterVmRestoreTaskList: jest.fn(),
}));

describe('checkBackupDeleteBlocked', () => {
  it('buildRestoreBlockingDeleteMessage uses snapshot label', () => {
    expect(
      buildRestoreBlockingDeleteMessage(
        { namespace: 'ns-1', name: 'restore-a', statusText: '恢复卷' },
        'snapshot',
      ),
    ).toContain('该快照已有进行中的恢复任务');
  });

  it('findRestoreBlockingBackupDelete returns in-progress restore', async () => {
    (fetchHarvesterVmRestoreTaskList as jest.Mock).mockResolvedValue([
      {
        metadata: {
          name: 'restore-a',
          namespace: 'ns-1',
          annotations: { 'tower.io/restoreTask': 'true' },
        },
        spec: {
          virtualMachineBackupName: 'bk-1',
          virtualMachineBackupNamespace: 'ns-1',
        },
        status: { progress: 10 },
      },
    ]);

    const hit = await findRestoreBlockingBackupDelete('cloud-1', 'ns-1', 'bk-1');
    expect(hit).toEqual({
      namespace: 'ns-1',
      name: 'restore-a',
      statusText: '进行中',
    });
  });
});
