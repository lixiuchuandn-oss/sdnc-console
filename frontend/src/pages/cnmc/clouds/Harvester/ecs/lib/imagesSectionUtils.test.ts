import {
  clusterReportedSizeLooksLikeVirtualCapacity,
  filterAndSortImages,
  formatImageSizeGb,
  getImageActualFileBytes,
  getImageStorageClassName,
  getImageVirtualSizeBytes,
  getImageListDisplayVirtualSizeBytes,
  getImageRowId,
  imageStatusLabelZh,
} from './imagesSectionUtils';

describe('imagesSectionUtils', () => {
  it('getImageActualFileBytes reads status.size', () => {
    expect(getImageActualFileBytes({ status: { size: 1024 } })).toBe(1024);
  });

  it('clusterReportedSizeLooksLikeVirtualCapacity detects PVC size during ceph sync', () => {
    const virtual = 300 * 1024 ** 3;
    const file = 11 * 1024 ** 3;
    expect(clusterReportedSizeLooksLikeVirtualCapacity(virtual, virtual, file)).toBe(true);
    expect(clusterReportedSizeLooksLikeVirtualCapacity(file, virtual, file)).toBe(false);
  });

  it('getImageVirtualSizeBytes reads top-level and status.virtualSize', () => {
    expect(
      getImageVirtualSizeBytes({
        virtualSize: 214748364800,
        status: { size: 4712693760, virtualSize: 214748364800 },
      }),
    ).toBe(214748364800);
    expect(formatImageSizeGb(214748364800)).toBe('200.00GB');
  });

  it('getImageListDisplayVirtualSizeBytes only when ready and import complete', () => {
    const readyRow = {
      state: 'Active',
      sourceType: 'upload',
      virtualSize: 214748364800,
      status: {
        progress: 100,
        size: 4712693760,
        virtualSize: 214748364800,
        conditions: [{ type: 'Imported', status: 'True' }],
      },
    };
    expect(getImageListDisplayVirtualSizeBytes(readyRow)).toBe(214748364800);
    expect(
      getImageListDisplayVirtualSizeBytes({
        state: 'syncing',
        virtualSize: 214748364800,
        status: { progress: 21, size: 1000, virtualSize: 214748364800 },
        sourceType: 'upload',
      }),
    ).toBeUndefined();
  });

  it('getImageStorageClassName derives longhorn-image from image id', () => {
    expect(
      getImageStorageClassName({
        metadata: { name: 'image-ir55m', annotations: { 'harvesterhci.io/storageClassName': 'longhorn' } },
      }),
    ).toBe('longhorn-image-ir55m');
  });

  it('getImageStorageClassName prefers status.storageClassName', () => {
    expect(
      getImageStorageClassName({
        metadata: { name: 'image-abc' },
        status: { storageClassName: 'longhorn-image-abc' },
      }),
    ).toBe('longhorn-image-abc');
  });

  it('getImageRowId prefers metadata.name', () => {
    expect(getImageRowId({ metadata: { name: 'img-a' } })).toBe('img-a');
  });

  it('formatImageSizeGb formats bytes', () => {
    expect(formatImageSizeGb(1024 * 1024 * 1024)).toBe('1.00GB');
  });

  it('imageStatusLabelZh maps ready', () => {
    expect(imageStatusLabelZh('ready')).toBe('已就绪');
  });

  it('filterAndSortImages filters by keyword', () => {
    const rows = filterAndSortImages(
      [
        { metadata: { name: 'alpha', namespace: 'ns1' }, displayName: 'Alpha' },
        { metadata: { name: 'beta', namespace: 'ns2' }, displayName: 'Beta' },
      ],
      { keyword: 'beta', statusFilter: '', typeFilter: '', osFilter: '', scopeFilter: '' },
      { isTenant: false },
    );
    expect(rows).toHaveLength(1);
    expect(getImageRowId(rows[0])).toBe('beta');
  });
});
