import {
  buildStorageClassProvisionerOptions,
  buildStorageClassReclaimPolicyOptions,
  filterStorageClassesForTable,
  storageClassBackendPoolLabel,
  storageClassRowKey,
} from './storageClassesSectionUtils';

describe('storageClassesSectionUtils', () => {
  const rbd = {
    metadata: { name: 'ceph-rbd', annotations: {} },
    provisioner: 'rbd.csi.ceph.com',
    reclaimPolicy: 'Delete',
    parameters: { pool: 'replicapool', dataPool: 'ecpool' },
    allowVolumeExpansion: true,
  };

  const longhorn = {
    metadata: { name: 'longhorn', annotations: {} },
    provisioner: 'driver.longhorn.io',
    reclaimPolicy: 'Delete',
  };

  describe('storageClassBackendPoolLabel', () => {
    it('combines pool and dataPool', () => {
      expect(storageClassBackendPoolLabel(rbd)).toBe('replicapool（数据 ecpool）');
    });

    it('returns empty for drivers without pool', () => {
      expect(storageClassBackendPoolLabel(longhorn)).toBe('');
    });
  });

  describe('filterStorageClassesForTable', () => {
    it('filters by provisioner and keyword on pool hint', () => {
      const rows = filterStorageClassesForTable([rbd, longhorn], {
        keyword: 'replica',
        provisionerFilter: 'rbd.csi.ceph.com',
        reclaimPolicyFilter: '',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata?.name).toBe('ceph-rbd');
    });
  });

  describe('options and rowKey', () => {
    it('builds provisioner/reclaim options and row key', () => {
      expect(buildStorageClassProvisionerOptions([rbd, longhorn])).toEqual([
        'driver.longhorn.io',
        'rbd.csi.ceph.com',
      ]);
      expect(buildStorageClassReclaimPolicyOptions([rbd, longhorn])).toEqual(['Delete']);
      expect(storageClassRowKey(rbd)).toBe('ceph-rbd');
    });
  });
});
