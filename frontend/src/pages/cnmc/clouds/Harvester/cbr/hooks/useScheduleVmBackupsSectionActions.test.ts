import { act, renderHook } from '@testing-library/react';
import {
  deleteHarvesterScheduleVmBackup,
  updateHarvesterScheduleVmBackup,
} from 'services/harvester/cbr';
import { runHarvesterSectionRefresh } from '../lib/cbrSectionRefresh';
import { useScheduleVmBackupsSectionActions } from './useScheduleVmBackupsSectionActions';
import type { ScheduleVmBackupListRow } from '../lib/scheduleVmBackupsSectionUtils';

const mockConfirmHighRiskDelete = jest.fn();

jest.mock('antd', () => ({
  message: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('../../shared/lib/highRiskConfirm', () => ({
  confirmHighRiskDelete: (opts: { onConfirm: () => void | Promise<void> }) => {
    mockConfirmHighRiskDelete(opts);
    return Promise.resolve().then(() => opts.onConfirm());
  },
  DELETE_RISK_ITEMS: [],
}));

jest.mock('services/harvester/cbr', () => ({
  updateHarvesterScheduleVmBackup: jest.fn(),
  deleteHarvesterScheduleVmBackup: jest.fn(),
}));

jest.mock('../lib/cbrSectionRefresh', () => ({
  runHarvesterSectionRefresh: jest.fn(),
}));

const record: ScheduleVmBackupListRow = {
  key: 'sched-1',
  name: 'daily-backup',
  id: 'sched-a',
  namespace: 'proj-1',
  vmAlias: 'vm-1',
  vmName: 'vm-1',
  retention: 7,
  maxFailure: 3,
  type: 'backup',
  cron: '0 2 * * *',
  suspended: false,
  age: '1 天',
  raw: {},
};

describe('useScheduleVmBackupsSectionActions', () => {
  const optimistic = {
    registerCreateSuccess: jest.fn(),
    markRemoved: jest.fn(),
    applySuspendOverride: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirmHighRiskDelete.mockReset();
  });

  it('handleSuspend toggles suspend and refreshes', async () => {
    const onRefresh = jest.fn();
    const ensureBackupsWrite = jest.fn(() => true);
    (updateHarvesterScheduleVmBackup as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useScheduleVmBackupsSectionActions({
        cloudId: 'cloud-1',
        onRefresh,
        hasBackupsWrite: true,
        ensureBackupsWrite,
        optimistic,
      }),
    );

    await act(async () => {
      await result.current.handleSuspend(record);
    });

    expect(updateHarvesterScheduleVmBackup).toHaveBeenCalledWith('cloud-1', 'proj-1', 'sched-a', {
      suspend: true,
    });
    expect(optimistic.applySuspendOverride).toHaveBeenCalledWith(record, true);
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, { force: true });
  });

  it('handleDelete confirms, removes optimistically and refreshes', async () => {
    const onRefresh = jest.fn();
    const ensureBackupsWrite = jest.fn(() => true);
    (deleteHarvesterScheduleVmBackup as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useScheduleVmBackupsSectionActions({
        cloudId: 'cloud-1',
        onRefresh,
        hasBackupsWrite: true,
        ensureBackupsWrite,
        optimistic,
      }),
    );

    await act(async () => {
      result.current.handleDelete(record);
      await Promise.resolve();
    });

    expect(deleteHarvesterScheduleVmBackup).toHaveBeenCalledWith('cloud-1', 'proj-1', 'sched-a');
    expect(optimistic.markRemoved).toHaveBeenCalledWith(record);
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, { force: true });
  });

  it('handleCreateSuccess registers optimistic row and silent refresh', () => {
    const onRefresh = jest.fn();
    const created = {
      namespace: 'proj-1',
      alias: 'daily',
      vmName: 'vm-1',
      type: 'backup' as const,
      cron: '0 2 * * *',
      retain: 7,
      maxFailure: 3,
      suspend: false,
    };

    const { result } = renderHook(() =>
      useScheduleVmBackupsSectionActions({
        cloudId: 'cloud-1',
        onRefresh,
        hasBackupsWrite: true,
        ensureBackupsWrite: () => true,
        optimistic,
        vms: [],
      }),
    );

    act(() => {
      result.current.handleCreateSuccess(created);
    });

    expect(optimistic.registerCreateSuccess).toHaveBeenCalledWith(created, []);
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, {
      force: true,
      silent: true,
    });
  });
});
