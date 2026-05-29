import { act, renderHook } from '@testing-library/react';
import { message } from 'antd';
import { deleteHarvesterBackup } from 'services/harvester/cbr';
import { findRestoreBlockingBackupDelete } from '../lib/checkBackupDeleteBlocked';
import { runHarvesterSectionRefresh } from '../lib/cbrSectionRefresh';
import { useBackupsSectionActions } from './useBackupsSectionActions';
import type { BackupListRow } from '../lib/backupsSectionUtils';

const mockConfirm = jest.fn();

jest.mock('antd', () => ({
  Modal: {
    confirm: (opts: unknown) => mockConfirm(opts),
  },
  message: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('../lib/checkBackupDeleteBlocked', () => ({
  buildRestoreBlockingDeleteMessage: jest.requireActual('../lib/checkBackupDeleteBlocked')
    .buildRestoreBlockingDeleteMessage,
  findRestoreBlockingBackupDelete: jest.fn().mockResolvedValue(null),
}));

jest.mock('services/harvester/cbr', () => ({
  deleteHarvesterBackup: jest.fn(),
}));

jest.mock('../../../../../../utils/harvesterUtils', () => ({
  isHarvesterCephVmBackup: jest.fn(() => false),
}));

jest.mock('../../shared/lib/harvesterSteveViewLink', () => ({
  resolveHarvesterSteveViewLink: jest.fn(() => '/view/link'),
}));

jest.mock('../lib/cbrSectionRefresh', () => ({
  runHarvesterSectionRefresh: jest.fn(),
}));

const record: BackupListRow = {
  key: 'bk-1',
  name: 'bk-a',
  itemType: 'backup',
  namespace: 'proj-1',
  targetVmAlias: 'vm-1',
  alias: 'My Backup',
  raw: { metadata: { name: 'bk-a', namespace: 'proj-1' } },
};

describe('useBackupsSectionActions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockConfirm.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('handleRestore rejects without write permission', () => {
    const { result } = renderHook(() =>
      useBackupsSectionActions({
        cloudId: 'cloud-1',
        type: 'backup',
        hasBackupsWrite: false,
      }),
    );

    act(() => {
      result.current.handleRestore(record);
    });

    expect(message.error).toHaveBeenCalledWith('无权限执行该操作');
    expect(result.current.restoreModalVisible).toBe(false);
  });

  it('handleRestore opens restore modal when permitted', () => {
    const { result } = renderHook(() =>
      useBackupsSectionActions({
        cloudId: 'cloud-1',
        type: 'backup',
        hasBackupsWrite: true,
      }),
    );

    act(() => {
      result.current.handleRestore(record);
    });

    expect(result.current.restoreModalVisible).toBe(true);
    expect(result.current.currentSnapshot).toEqual(record);
  });

  it('handleDelete confirms and refreshes on success', async () => {
    const onRefresh = jest.fn();
    (deleteHarvesterBackup as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useBackupsSectionActions({
        cloudId: 'cloud-1',
        type: 'snapshot',
        hasBackupsWrite: true,
        onRefresh,
      }),
    );

    act(() => {
      void result.current.handleDelete(record);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockConfirm).toHaveBeenCalled();
    const { onOk } = mockConfirm.mock.calls[0][0];
    await act(async () => {
      await onOk();
    });

    expect(deleteHarvesterBackup).toHaveBeenCalledWith('cloud-1', 'proj-1', 'bk-a');
    expect(message.success).toHaveBeenCalledWith('删除成功');
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, { force: true });
  });

  it('handleOpenYaml opens drawer with resolved kind', () => {
    const { result } = renderHook(() =>
      useBackupsSectionActions({
        cloudId: 'cloud-1',
        type: 'backup',
        hasBackupsWrite: true,
      }),
    );

    act(() => {
      result.current.handleOpenYaml(record);
    });

    expect(result.current.drawerVisible).toBe(true);
    expect(result.current.drawerRecord?.kind).toBe('VirtualMachineBackup');
  });

  it('handleCreateSuccess closes modal and silent-refreshes twice', () => {
    const onRefresh = jest.fn();
    const { result } = renderHook(() =>
      useBackupsSectionActions({
        cloudId: 'cloud-1',
        type: 'backup',
        hasBackupsWrite: true,
        onRefresh,
      }),
    );

    act(() => {
      result.current.setCreateModalVisible(true);
    });
    expect(result.current.createModalVisible).toBe(true);

    act(() => {
      result.current.handleCreateSuccess();
    });

    expect(result.current.createModalVisible).toBe(false);
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, {
      force: true,
      silent: true,
    });

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(runHarvesterSectionRefresh).toHaveBeenCalledTimes(2);
  });

  it('handleDelete blocks when restore task is in progress', async () => {
    (findRestoreBlockingBackupDelete as jest.Mock).mockResolvedValue({
      namespace: 'proj-1',
      name: 'restore-1',
      statusText: '进行中',
    });

    const { result } = renderHook(() =>
      useBackupsSectionActions({
        cloudId: 'cloud-1',
        type: 'backup',
        hasBackupsWrite: true,
      }),
    );

    await act(async () => {
      await result.current.handleDelete(record);
    });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(message.warning).toHaveBeenCalledWith(
      '该备份已有进行中的恢复任务（proj-1/restore-1，进行中），请等待完成后再删除',
    );
  });
});
