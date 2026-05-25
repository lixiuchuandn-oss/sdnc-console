import {
  buildSnapshotNamespaceOptions,
  filterSnapshotsForTable,
  normalizeSnapshotList,
  snapshotDisplayLabel,
} from './snapshotsSectionUtils';

describe('snapshotsSectionUtils', () => {
  const snap = {
    metadata: {
      uid: 'uid-1',
      name: 'snap-a',
      namespace: 'proj-1',
      annotations: { 'tower.io/alias': '备份点' },
    },
    spec: {
      source: { persistentVolumeClaimName: 'vol-a' },
      volumeSnapshotClassName: 'longhorn',
    },
    status: { readyToUse: true, restoreSize: '10Gi' },
  };

  it('normalizes snapshot rows', () => {
    const rows = normalizeSnapshotList([snap]);
    expect(rows[0].name).toBe('snap-a');
    expect(rows[0].sourcePvc).toBe('vol-a');
    expect(rows[0].readyToUse).toBe(true);
  });

  it('filters by ready status', () => {
    const rows = normalizeSnapshotList([
      snap,
      { ...snap, metadata: { ...snap.metadata, uid: 'uid-2', name: 'snap-b' }, status: { readyToUse: false } },
    ]);
    const ready = filterSnapshotsForTable(rows, {
      keyword: '',
      namespaceFilter: '',
      statusFilter: 'ready',
      isPublicNamespace: () => false,
    });
    expect(ready).toHaveLength(1);
    expect(ready[0].name).toBe('snap-a');
  });

  it('snapshotDisplayLabel prefers alias', () => {
    const row = normalizeSnapshotList([snap])[0];
    expect(snapshotDisplayLabel(row)).toBe('备份点');
  });

  it('buildSnapshotNamespaceOptions maps and excludes system ns', () => {
    const options = buildSnapshotNamespaceOptions(
      [
        { metadata: { name: 'proj-1' } },
        { name: 'kube-system' },
      ],
      { excludeSystem: true },
    );
    expect(options).toEqual([{ label: 'proj-1', value: 'proj-1' }]);
  });
});
