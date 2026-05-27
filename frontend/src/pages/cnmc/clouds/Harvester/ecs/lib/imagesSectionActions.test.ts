import {
  assessImageDeleteBlockedByVms,
  filterImageListAfterDelete,
  getImageBatchDeleteLabel,
  getImageNsNameKey,
  isImageDeleteInUseHttpError,
  mapBatchImageDelete,
  mergeUploadTasksSorted,
  selectImagesByRowKeys,
  summarizeBatchImageDeleteMessage,
} from './imagesSectionActions';

describe('imagesSectionActions', () => {
  const img = { metadata: { name: 'img-a', namespace: 'ns1' }, displayName: 'Alpha' };

  it('getImageNsNameKey', () => {
    expect(getImageNsNameKey(img)).toBe('ns1/img-a');
  });

  it('selectImagesByRowKeys', () => {
    const rows = selectImagesByRowKeys([img, { metadata: { name: 'b' } }], ['img-a']);
    expect(rows).toHaveLength(1);
  });

  it('getImageBatchDeleteLabel prefers alias', () => {
    expect(getImageBatchDeleteLabel(img)).toBe('Alpha (img-a)');
  });

  it('isImageDeleteInUseHttpError detects 422', () => {
    expect(isImageDeleteInUseHttpError({ status: 422 })).toBe(true);
    expect(isImageDeleteInUseHttpError({ message: 'in use' })).toBe(true);
  });

  it('summarizeBatchImageDeleteMessage', () => {
    const out = summarizeBatchImageDeleteMessage([
      { ok: true, name: 'a', ns: 'ns', id: 'a' },
      { ok: false, name: 'b', err: 'fail' },
    ]);
    expect(out.success).toContain('1');
    expect(out.error).toContain('b');
    expect(out.deletedKeys.has('ns/a')).toBe(true);
  });

  it('filterImageListAfterDelete', () => {
    const next = filterImageListAfterDelete(
      [img, { metadata: { name: 'keep', namespace: 'ns2' } }],
      new Set(['ns1/img-a']),
    );
    expect(next).toHaveLength(1);
  });

  it('mergeUploadTasksSorted merges by id', () => {
    const merged = mergeUploadTasksSorted(
      [{ id: '1', status: 'pending', createdAt: '2024-01-01' } as any],
      { id: '2', status: 'success', createdAt: '2024-02-01' } as any,
    );
    expect(merged.map((x) => x.id)).toEqual(['2', '1']);
  });

  it('mapBatchImageDelete aggregates results', async () => {
    const results = await mapBatchImageDelete([img], async () => {});
    expect(results[0].ok).toBe(true);
  });

  it('assessImageDeleteBlockedByVms returns null when unused', () => {
    expect(assessImageDeleteBlockedByVms(img, [])).toBeNull();
  });
});
