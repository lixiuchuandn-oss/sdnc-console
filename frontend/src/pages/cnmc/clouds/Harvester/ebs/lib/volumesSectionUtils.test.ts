import {
  cnVolumeStatus,
  parseQuantity,
  VOLUME_STATUS_FILTER_OPTIONS,
} from './volumeQuantityUtils';
import { isVolumePhaseTransitional, TRANSITION_VOLUME_PHASES } from './volumePhaseUtils';
import { checkIsVolumeSystemDisk, volumeDisplayLabel } from './volumeSafeRead';
import {
  filterVolumesForTable,
  normalizeVolumeList,
  volumeDetailRawRecord,
} from './volumesSectionUtils';

describe('volumeQuantityUtils', () => {
  it('parseQuantity handles Gi suffix', () => {
    expect(parseQuantity('10Gi')).toBe(10 * 1024 ** 3);
  });

  it('cnVolumeStatus maps bound', () => {
    expect(cnVolumeStatus('bound')).toBe('已绑定');
  });

  it('exports status filter options', () => {
    expect(VOLUME_STATUS_FILTER_OPTIONS).toContain('bound');
  });
});

describe('volumePhaseUtils', () => {
  it('detects transitional phases', () => {
    expect(isVolumePhaseTransitional('Pending')).toBe(true);
    expect(isVolumePhaseTransitional('Bound')).toBe(false);
  });

  it('includes resizing in transition set', () => {
    expect(TRANSITION_VOLUME_PHASES.has('resizing')).toBe(true);
  });
});

describe('volumesSectionUtils', () => {
  const pvc = {
    metadata: { name: 'vol-a', namespace: 'proj-1', uid: 'uid-1' },
    spec: { storageClassName: 'longhorn', resources: { requests: { storage: '20Gi' } } },
    status: { phase: 'Bound', capacity: { storage: '20Gi' } },
  };

  it('normalizes and deduplicates volumes', () => {
    const rows = normalizeVolumeList([pvc, pvc]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('vol-a');
    expect(rows[0].capacityBytes).toBe(parseQuantity('20Gi'));
  });

  it('filters by keyword on name and alias', () => {
    const rows = normalizeVolumeList([
      { ...pvc, metadata: { ...pvc.metadata, annotations: { 'tower.io/alias': '数据盘' } } },
    ]);
    const filtered = filterVolumesForTable(rows, {
      keyword: '数据',
      statusFilter: '',
      nsFilter: '',
      scFilter: '',
      isPublicNamespace: () => false,
    });
    expect(filtered).toHaveLength(1);
  });

  it('volumeDetailRawRecord injects kind and metadata', () => {
    const row = normalizeVolumeList([pvc])[0];
    const raw = volumeDetailRawRecord(row);
    expect(raw.kind).toBe('PersistentVolumeClaim');
    expect((raw.metadata as { name?: string }).name).toBe('vol-a');
  });
});

describe('volumeSafeRead', () => {
  it('volumeDisplayLabel prefers alias', () => {
    expect(volumeDisplayLabel({ name: 'vol-a', alias: '别名', key: 'k' } as never)).toBe('别名');
  });

  it('checkIsVolumeSystemDisk detects bootOrder 1', () => {
    const vm = {
      metadata: { namespace: 'proj-1' },
      spec: {
        template: {
          spec: {
            volumes: [{ name: 'disk-0', persistentVolumeClaim: { claimName: 'vol-a' } }],
            domain: { devices: { disks: [{ name: 'disk-0', bootOrder: 1 }] } },
          },
        },
      },
    };
    expect(
      checkIsVolumeSystemDisk(
        { name: 'vol-a', namespace: 'proj-1', key: 'k' } as never,
        vm,
      ),
    ).toBe(true);
  });
});
