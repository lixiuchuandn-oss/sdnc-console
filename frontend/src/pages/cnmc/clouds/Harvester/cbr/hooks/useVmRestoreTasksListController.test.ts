import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { App } from 'antd';
import {
  fetchHarvesterBackups,
  fetchHarvesterCephVmRestores,
  fetchHarvesterVirtualMachineRestores,
} from 'services/harvester/cbr';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../lib/cbrSectionRefresh';
import type { VmRestoreTaskListRow } from '../lib/vmRestoreTasksSectionUtils';
import {
  useVmRestoreTasksListController,
  useVmRestoreTasksListPoll,
} from './useVmRestoreTasksListController';

jest.mock('services/harvester/cbr', () => ({
  fetchHarvesterBackups: jest.fn(),
  fetchHarvesterVirtualMachineRestores: jest.fn(),
  fetchHarvesterCephVmRestores: jest.fn(),
}));

jest.mock('../lib/cbrSectionRefresh', () => ({
  runHarvesterSectionRefresh: jest.fn(),
  createHarvesterToolbarRefresh: jest.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(App, null, children);

describe('useVmRestoreTasksListController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (runHarvesterSectionRefresh as jest.Mock).mockImplementation((onRefresh, opts) => {
      void onRefresh?.(opts?.force !== false, opts?.silent);
    });
    (createHarvesterToolbarRefresh as jest.Mock).mockImplementation(
      (onRefresh) => () => onRefresh(true),
    );
    (fetchHarvesterBackups as jest.Mock).mockResolvedValue({
      data: { items: [{ metadata: { name: 'bk-1' } }] },
    });
    (fetchHarvesterVirtualMachineRestores as jest.Mock).mockResolvedValue({
      items: [{ metadata: { name: 'rs-1' } }],
    });
    (fetchHarvesterCephVmRestores as jest.Mock).mockResolvedValue({
      items: [{ metadata: { name: 'ceph-rs-1' } }],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads backups and restores on mount', async () => {
    const { result } = renderHook(() => useVmRestoreTasksListController('cloud-1'), { wrapper });

    expect(runHarvesterSectionRefresh).toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchHarvesterBackups).toHaveBeenCalledWith('cloud-1', true, false);
    expect(fetchHarvesterVirtualMachineRestores).toHaveBeenCalledWith('cloud-1', true);
    expect(result.current.backups).toHaveLength(1);
    expect(result.current.restores).toHaveLength(2);
    expect(result.current.loading).toBe(false);
  });

  it('handleToolbarRefresh delegates to createHarvesterToolbarRefresh', () => {
    const { result } = renderHook(() => useVmRestoreTasksListController('cloud-1'), { wrapper });

    act(() => {
      result.current.handleToolbarRefresh();
    });

    expect(createHarvesterToolbarRefresh).toHaveBeenCalled();
  });

  it('refreshes after harvester:restore-created event', async () => {
    renderHook(() => useVmRestoreTasksListController('cloud-1'), { wrapper });
    (runHarvesterSectionRefresh as jest.Mock).mockClear();

    act(() => {
      window.dispatchEvent(new Event('harvester:restore-created'));
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(runHarvesterSectionRefresh).toHaveBeenCalled();
  });
});

describe('useVmRestoreTasksListPoll', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const pendingRow: VmRestoreTaskListRow = {
    key: 'rs-1',
    namespace: 'proj-1',
    restoreBackend: 'longhorn',
    restoreName: 'restore-a',
    targetVm: 'vm-new',
    targetVmAlias: 'vm-new',
    sourceVm: 'vm-old',
    sourceVmAlias: 'vm-old',
    backupName: 'bk-a',
    restoreMode: 'new',
    resourceType: 'backup',
    restoreRaw: {},
    backupRaw: null,
    restoreStatus: { phase: 'pending', text: '进行中', progress: 10 },
    creationTimestamp: '2026-01-01T00:00:00Z',
  };

  it('polls silently while pending tasks exist', () => {
    const onListRefresh = jest.fn();
    const timerRef = { current: null as ReturnType<typeof setInterval> | null };

    renderHook(() => useVmRestoreTasksListPoll([pendingRow], onListRefresh, timerRef));

    expect(timerRef.current).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onListRefresh, {
      force: true,
      silent: true,
    });
  });

  it('clears timer when no pending tasks remain', () => {
    const onListRefresh = jest.fn();
    const timerRef = { current: null as ReturnType<typeof setInterval> | null };

    const { rerender } = renderHook(
      ({ filtered }: { filtered: VmRestoreTaskListRow[] }) =>
        useVmRestoreTasksListPoll(filtered, onListRefresh, timerRef),
      { initialProps: { filtered: [pendingRow] } },
    );

    expect(timerRef.current).not.toBeNull();

    rerender({
      filtered: [{ ...pendingRow, restoreStatus: { phase: 'ready', text: '完成', progress: 100 } }],
    });

    expect(timerRef.current).toBeNull();
  });
});
