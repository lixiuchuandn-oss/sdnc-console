import { act, renderHook } from '@testing-library/react';
import { runHarvesterSectionRefresh } from '../lib/cbrSectionRefresh';
import { useScheduleVmBackupsOptimistic } from './useScheduleVmBackupsOptimistic';
import type { ScheduleVmBackupListRow } from '../lib/scheduleVmBackupsSectionUtils';

jest.mock('../lib/cbrSectionRefresh', () => ({
  runHarvesterSectionRefresh: jest.fn(),
}));

jest.mock('../lib/vmBackupDisplay', () => ({
  findHarvesterVmDisplayAlias: jest.fn(() => 'vm-display'),
}));

const scheduleItem = {
  metadata: {
    name: 'sched-a',
    namespace: 'proj-1',
    annotations: { 'tower.io/alias': 'daily-backup' },
  },
  spec: { suspend: false },
};

const createdPayload = {
  namespace: 'proj-1',
  alias: 'daily-backup',
  vmName: 'vm-1',
  type: 'backup' as const,
  cron: '0 2 * * *',
  retain: 7,
  maxFailure: 3,
  suspend: false,
  resourceName: 'sched-a',
};

describe('useScheduleVmBackupsOptimistic', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registerCreateSuccess adds optimistic row', () => {
    const onRefresh = jest.fn();
    const { result } = renderHook(() =>
      useScheduleVmBackupsOptimistic({ data: [], onRefresh }),
    );

    act(() => {
      result.current.registerCreateSuccess(createdPayload, []);
    });

    expect(result.current.optimisticItems).toHaveLength(1);
    expect(result.current.optimisticItems[0].name).toBe('daily-backup');
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, {
      force: true,
      silent: true,
    });
  });

  it('clears optimistic row when polling target appears in data', () => {
    const onRefresh = jest.fn();
    const { result, rerender } = renderHook(
      ({ data }: { data: unknown[] }) =>
        useScheduleVmBackupsOptimistic({ data, onRefresh }),
      { initialProps: { data: [] as unknown[] } },
    );

    act(() => {
      result.current.registerCreateSuccess(createdPayload, []);
    });
    expect(result.current.optimisticItems).toHaveLength(1);

    rerender({ data: [scheduleItem] });
    expect(result.current.optimisticItems).toHaveLength(0);
  });

  it('markRemoved tracks removed schedule and drops matching optimistic row', () => {
    const { result } = renderHook(() =>
      useScheduleVmBackupsOptimistic({ data: [scheduleItem], onRefresh: jest.fn() }),
    );

    const optimistic: ScheduleVmBackupListRow = {
      key: 'opt-1',
      name: 'pending',
      id: 'sched-new',
      namespace: 'proj-1',
      vmAlias: 'vm-1',
      vmName: 'vm-1',
      retention: 5,
      maxFailure: 1,
      type: 'backup',
      cron: '0 3 * * *',
      suspended: false,
      age: '0 分钟',
      raw: {},
    };

    act(() => {
      result.current.registerCreateSuccess(
        { ...createdPayload, alias: 'pending', resourceName: 'sched-new' },
        [],
      );
    });
    expect(result.current.optimisticItems).toHaveLength(1);

    act(() => {
      result.current.markRemoved(optimistic);
    });

    expect(result.current.removed).toEqual([
      { ns: 'proj-1', id: 'sched-new', alias: 'pending' },
    ]);
    expect(result.current.optimisticItems).toHaveLength(0);
  });

  it('applySuspendOverride sets override and clears after data matches', () => {
    const onRefresh = jest.fn();
    const { result, rerender } = renderHook(
      ({ data }: { data: unknown[] }) =>
        useScheduleVmBackupsOptimistic({ data, onRefresh }),
      { initialProps: { data: [scheduleItem] as unknown[] } },
    );

    const record: ScheduleVmBackupListRow = {
      key: 'sched-a',
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
      raw: scheduleItem,
    };

    act(() => {
      result.current.applySuspendOverride(record, true);
    });

    expect(result.current.suspendedOverrides).toEqual([
      { ns: 'proj-1', id: 'sched-a', suspended: true },
    ]);
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, {
      force: true,
      silent: true,
    });

    rerender({
      data: [{ ...scheduleItem, spec: { suspend: true } }],
    });
    expect(result.current.suspendedOverrides).toHaveLength(0);
  });

  it('polls with silent refresh while create target is missing', () => {
    const onRefresh = jest.fn();
    const { result } = renderHook(() =>
      useScheduleVmBackupsOptimistic({ data: [], onRefresh }),
    );

    act(() => {
      result.current.registerCreateSuccess(createdPayload, []);
    });

    const initialCalls = (runHarvesterSectionRefresh as jest.Mock).mock.calls.length;

    act(() => {
      jest.advanceTimersByTime(3000 * 3);
    });

    expect((runHarvesterSectionRefresh as jest.Mock).mock.calls.length).toBeGreaterThan(
      initialCalls,
    );
  });
});
