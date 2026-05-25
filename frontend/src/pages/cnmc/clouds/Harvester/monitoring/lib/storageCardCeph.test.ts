import {
  clusterHasCeph,
  resolveCephOverviewRawCapacity,
  resolveDefaultStorageClassCephPoolProtection,
} from './storageCardCeph';

describe('storageCardCeph', () => {
  describe('clusterHasCeph', () => {
    it('detects clusters or block pools', () => {
      expect(clusterHasCeph({ clusters: [{ metadata: { name: 'c' } }], blockPools: [] } as any)).toBe(true);
      expect(clusterHasCeph({ clusters: [], blockPools: [{ metadata: { name: 'p' } }] } as any)).toBe(true);
      expect(clusterHasCeph({ clusters: [], blockPools: [] } as any)).toBe(false);
    });
  });

  describe('resolveCephOverviewRawCapacity', () => {
    it('prefers landing df when total > 0', () => {
      const landing = { total: 100, used: 40, avail: 60, pctOfTotal: 40 };
      expect(resolveCephOverviewRawCapacity(landing, { clusters: [], blockPools: [] } as any)).toBe(landing);
    });

    it('aggregates cluster capacity when landing missing', () => {
      const cap = resolveCephOverviewRawCapacity(null, {
        clusters: [
          {
            status: {
              ceph: {
                capacity: { bytesTotal: 1000, bytesUsed: 200, bytesAvailable: 800 },
              },
            },
          },
        ],
        blockPools: [],
      } as any);
      expect(cap?.total).toBe(1000);
      expect(cap?.used).toBe(200);
      expect(cap?.pctOfTotal).toBe(20);
    });
  });

  describe('resolveDefaultStorageClassCephPoolProtection', () => {
    it('resolves pool protection from default RBD storage class', () => {
      const bundle = {
        clusters: [],
        blockPools: [
          {
            metadata: { namespace: 'rook-ceph', name: 'replicapool' },
            spec: { replicated: { size: 3 } },
          },
        ],
      } as any;
      const scPayload = {
        items: [
          {
            metadata: { name: 'longhorn-default' },
            provisioner: 'driver.longhorn.io',
          },
          {
            metadata: { name: 'ceph-rbd-default' },
            provisioner: 'rbd.csi.ceph.com',
            parameters: { pool: 'replicapool', clusterID: 'rook-ceph' },
          },
        ],
      };
      const hit = resolveDefaultStorageClassCephPoolProtection('ceph-rbd-default', bundle, scPayload);
      expect(hit?.poolSummary).toBe('replicapool');
      expect(hit?.protectionZh).toContain('3');
    });
  });
});
