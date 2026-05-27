import { createBackupsTabOnRefresh } from './backupsRefresh';

describe('backupsRefresh', () => {
  it('routes all inner tabs through loadTabResource("backups")', () => {
    const loadTabResource = jest.fn();
    const tabs = ['backups', 'vm_snapshots', 'schedule_vm_backups'] as const;

    tabs.forEach((tab) => {
      loadTabResource.mockClear();
      const refresh = createBackupsTabOnRefresh(tab, { loadTabResource });
      refresh(true, true);
      expect(loadTabResource).toHaveBeenCalledWith('backups', true, true);
    });
  });

  it('defaults force to true when omitted', () => {
    const loadTabResource = jest.fn();
    const refresh = createBackupsTabOnRefresh('backups', { loadTabResource });
    refresh();
    expect(loadTabResource).toHaveBeenCalledWith('backups', true, undefined);
  });

  it('respects force=false', () => {
    const loadTabResource = jest.fn();
    const refresh = createBackupsTabOnRefresh('vm_snapshots', { loadTabResource });
    refresh(false);
    expect(loadTabResource).toHaveBeenCalledWith('backups', false, undefined);
  });
});
