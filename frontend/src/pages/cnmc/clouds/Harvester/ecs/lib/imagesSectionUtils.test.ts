import {
  buildTenantImageNamespaceSet,
  canTenantOperateImage,
  clusterReportedSizeLooksLikeVirtualCapacity,
  filterAndSortImages,
  formatImageSizeGb,
  getImageActualFileBytes,
  getImageStorageClassName,
  getImageVirtualSizeBytes,
  getImageListDisplayActualSizeBytes,
  getImageListDisplayVirtualSizeBytes,
  isVolumeExportedVmImageRecord,
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

  it('export-from-volume masks PVC capacity as actual size until sparse file size known', () => {
    const virtual = 300 * 1024 ** 3;
    const row = {
      sourceType: 'export-from-volume',
      spec: { sourceType: 'export-from-volume' },
      state: 'Active',
      virtualSize: virtual,
      status: {
        progress: 100,
        size: virtual,
        virtualSize: virtual,
        conditions: [{ type: 'Imported', status: 'True' }],
      },
    };
    expect(isVolumeExportedVmImageRecord(row)).toBe(true);
    expect(getImageListDisplayActualSizeBytes(row)).toBeUndefined();

    const sparse = 1344995328;
    expect(
      getImageListDisplayActualSizeBytes({
        ...row,
        size: sparse,
        status: { ...row.status, size: sparse },
      }),
    ).toBe(sparse);
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

  it('canTenantOperateImage matches metadata.namespace to tenant namespaces', () => {
    const tenantNs = buildTenantImageNamespaceSet(['proj-a', 'proj-b']);
    const own = { metadata: { name: 'img-1', namespace: 'proj-a' } };
    const other = { metadata: { name: 'img-2', namespace: 'other-ns' } };
    expect(canTenantOperateImage(own, tenantNs)).toBe(true);
    expect(canTenantOperateImage(other, tenantNs)).toBe(false);
  });
});
