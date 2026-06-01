import {
  buildScheduleEditFormValues,
  buildScheduleEditInitialUiState,
  buildScheduleEditUpdatePayload,
  parseScheduleCronToUiState,
  resolveScheduleEditTargetIds,
  resolveScheduleVmDisplayName,
  syncScheduleEditCronField,
} from './scheduleVmBackupEditModalUtils';

describe('scheduleVmBackupEditModalUtils', () => {
  const record = {
    namespace: 'proj-1',
    id: 'sched-a',
    vmAlias: 'Web VM',
    raw: {
      metadata: {
        namespace: 'proj-1',
        name: 'sched-a',
        annotations: { 'tower.io/alias': 'daily-backup' },
      },
      spec: {
        cron: '15 2 * * 1',
        retain: 7,
        maxFailure: 3,
        suspend: false,
        targetVm: 'vm-web',
      },
    },
  };

  it('parseScheduleCronToUiState detects weekly cron', () => {
    expect(parseScheduleCronToUiState('15 2 * * 1')).toEqual({
      cronMode: 'weekly',
      uiCron: { hour: 2, minute: 15, weekDay: 1 },
    });
  });

  it('parseScheduleCronToUiState detects daily cron', () => {
    expect(parseScheduleCronToUiState('30 3 * * *')).toEqual({
      cronMode: 'daily',
      uiCron: { hour: 3, minute: 30, weekDay: 0 },
    });
  });

  it('parseScheduleCronToUiState falls back to custom', () => {
    expect(parseScheduleCronToUiState('0 0 1 * *').cronMode).toBe('custom');
  });

  it('buildScheduleEditFormValues maps record fields', () => {
    const values = buildScheduleEditFormValues(record, []);
    expect(values).toMatchObject({
      namespace: 'proj-1',
      alias: 'daily-backup',
      vmName: 'Web VM',
      retain: 7,
      maxFailure: 3,
      cron: '15 2 * * 1',
    });
  });

  it('resolveScheduleVmDisplayName prefers vm list alias', () => {
    const name = resolveScheduleVmDisplayName(record, [
      {
        metadata: {
          namespace: 'proj-1',
          name: 'vm-web',
          annotations: { 'tower.io/alias': 'From List' },
        },
      },
    ]);
    expect(name).toBe('From List');
  });

  it('buildScheduleEditInitialUiState reads cron from record', () => {
    expect(buildScheduleEditInitialUiState(record)).toEqual({
      cronMode: 'weekly',
      uiCron: { hour: 2, minute: 15, weekDay: 1 },
    });
  });

  it('syncScheduleEditCronField returns next cron when changed', () => {
    expect(syncScheduleEditCronField('daily', { hour: 4, minute: 10, weekDay: 0 }, '15 2 * * 1')).toBe(
      '10 4 * * *',
    );
    expect(syncScheduleEditCronField('daily', { hour: 2, minute: 15, weekDay: 0 }, '15 2 * * *')).toBeNull();
  });

  it('buildScheduleEditUpdatePayload and resolveScheduleEditTargetIds', () => {
    expect(buildScheduleEditUpdatePayload({
      cron: '0 2 * * *',
      retain: 5,
      maxFailure: 2,
      suspend: true,
      alias: 'nightly',
    })).toEqual({
      cron: '0 2 * * *',
      retain: 5,
      maxFailure: 2,
      suspend: true,
      labels: {},
      annotations: { 'tower.io/alias': 'nightly' },
    });
    expect(resolveScheduleEditTargetIds(record)).toEqual({
      namespace: 'proj-1',
      id: 'sched-a',
    });
  });
});
