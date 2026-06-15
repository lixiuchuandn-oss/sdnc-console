import { collectVmImageCdiDataVolumeNames } from './imageUploadCdiCleanup';

describe('collectVmImageCdiDataVolumeNames', () => {
  it('uses image name when detail is missing', () => {
    expect(collectVmImageCdiDataVolumeNames(null, 'image-abc')).toEqual(['image-abc']);
  });

  it('merges metadata.name and spec.pvcName from detail', () => {
    expect(
      collectVmImageCdiDataVolumeNames(
        {
          metadata: { name: 'image-xyz' },
          spec: { pvcName: 'image-xyz-pvc' },
        },
        'image-xyz',
      ).sort(),
    ).toEqual(['image-xyz', 'image-xyz-pvc']);
  });

  it('deduplicates identical names', () => {
    expect(collectVmImageCdiDataVolumeNames({ metadata: { name: 'image-a' } }, 'image-a')).toEqual([
      'image-a',
    ]);
  });
});
