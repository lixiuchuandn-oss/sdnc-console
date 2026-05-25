import { formatBytesWithUnit, parseLonghornStorage } from './longhornStorage';

describe('longhornStorage', () => {
  describe('formatBytesWithUnit', () => {
    it('uses GiB below 1 TiB', () => {
      expect(formatBytesWithUnit(1024 ** 3)).toEqual({ value: 1, unit: 'GiB' });
    });

    it('uses TiB at or above 1 TiB', () => {
      expect(formatBytesWithUnit(1024 ** 4)).toEqual({ value: 1, unit: 'TiB' });
    });
  });

  describe('parseLonghornStorage', () => {
    it('aggregates disk status from node list', () => {
      const summary = parseLonghornStorage([
        {
          status: {
            diskStatus: {
              default: { storageMaximum: 1000, storageAvailable: 400, storageScheduled: 100 },
            },
          },
          spec: { disks: [{ storageReserved: 50 }] },
        },
        {
          status: {
            diskStatus: {
              default: { storageMaximum: 2000, storageAvailable: 1500, storageScheduled: 0 },
            },
          },
        },
      ]);
      expect(summary).toMatchObject({
        storageMaximum: 3000,
        storageAvailable: 1900,
        storageUsed: 1100,
        storageReserved: 50,
        storageScheduled: 100,
        nodeCount: 2,
        distributedStorageKind: 'unknown',
      });
    });

    it('reads tower metadata from envelope', () => {
      const summary = parseLonghornStorage({
        data: [{ status: { diskStatus: {} } }],
        _tower: {
          defaultStorageClassReplicaCount: 3,
          defaultStorageClassName: 'longhorn',
          defaultStorageClassProvisioner: 'driver.longhorn.io',
          distributedStorageKind: 'longhorn',
        },
      });
      expect(summary.defaultStorageClassReplicaCount).toBe(3);
      expect(summary.defaultStorageClassName).toBe('longhorn');
      expect(summary.distributedStorageKind).toBe('longhorn');
      expect(summary.nodeCount).toBe(1);
    });

    it('returns zeros for empty input', () => {
      expect(parseLonghornStorage(null)).toMatchObject({
        storageMaximum: 0,
        storageAvailable: 0,
        storageUsed: 0,
        nodeCount: 0,
      });
    });
  });
});
