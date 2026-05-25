import { buildStorageCardViewModel } from './storageCardViewModel';

describe('storageCardViewModel', () => {
  it('uses Longhorn summary when no ceph bundle', () => {
    const vm = buildStorageCardViewModel({
      storageNodes: {
        data: [
          {
            status: {
              diskStatus: {
                default: { storageMaximum: 100 * 1024 ** 3, storageAvailable: 40 * 1024 ** 3 },
              },
            },
          },
        ],
        _tower: { distributedStorageKind: 'longhorn', defaultStorageClassReplicaCount: 3 },
      },
      nodeResources: null,
      cephResourcesRaw: null,
      cephHealthMinimal: null,
      storageClassesJson: null,
    });
    expect(vm.isCeph).toBe(false);
    expect(vm.footerIsCephProtectionLayout).toBe(false);
    expect(vm.usedPercent).toBe(60);
    expect(vm.replicaKnown).toBe(true);
    expect(vm.replica).toBe(3);
  });

  it('prefers ceph capacity when cluster has ceph', () => {
    const vm = buildStorageCardViewModel({
      storageNodes: null,
      nodeResources: { data: [{}, {}] },
      cephResourcesRaw: { clusters: [{ metadata: { name: 'rook-ceph' } }], blockPools: [] },
      cephHealthMinimal: {
        df: {
          stats: {
            total_bytes: 1000,
            total_used_raw_bytes: 400,
            total_avail_bytes: 600,
          },
        },
      },
      storageClassesJson: null,
    });
    expect(vm.isCeph).toBe(true);
    expect(vm.headerNodeCount).toBe(2);
    expect(vm.usedPercent).toBe(40);
  });
});
