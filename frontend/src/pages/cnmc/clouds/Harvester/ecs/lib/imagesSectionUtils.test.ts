import {
  filterAndSortImages,
  formatImageSizeGb,
  getImageActualFileBytes,
  getImageRowId,
  imageStatusLabelZh,
} from './imagesSectionUtils';

describe('imagesSectionUtils', () => {
  it('getImageActualFileBytes reads status.size', () => {
    expect(getImageActualFileBytes({ status: { size: 1024 } })).toBe(1024);
  });

  it('getImageRowId prefers metadata.name', () => {
    expect(getImageRowId({ metadata: { name: 'img-a' } })).toBe('img-a');
  });

  it('formatImageSizeGb formats bytes', () => {
    expect(formatImageSizeGb(1024 * 1024 * 1024)).toBe('1.00GB');
  });

  it('imageStatusLabelZh maps ready', () => {
    expect(imageStatusLabelZh('ready')).toBe('就绪');
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
