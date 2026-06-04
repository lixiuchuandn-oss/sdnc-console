import {
  readVmImageVirtualSizeBytes,
  parseKubernetesQuantityToBytes,
  isHarvesterVmImageImportComplete,
  readVmImageImportProgress,
} from './vmImageClusterApi';

describe('readVmImageVirtualSizeBytes', () => {
  it('reads status.virtualSize when top-level virtualSize is 0', () => {
    expect(
      readVmImageVirtualSizeBytes({
        virtualSize: 0,
        status: { virtualSize: 8589934592 },
      }),
    ).toBe(8589934592);
  });

  it('parses Gi quantity strings', () => {
    expect(parseKubernetesQuantityToBytes('200Gi')).toBe(200 * 1024 ** 3);
  });
});

describe('isHarvesterVmImageImportComplete', () => {
  it('does not treat steve active as complete while progress < 100', () => {
    expect(
      isHarvesterVmImageImportComplete({
        metadata: { state: { name: 'active' } },
        spec: { sourceType: 'upload' },
        status: { progress: 21, size: 1000 },
      }),
    ).toBe(false);
    expect(readVmImageImportProgress({ status: { progress: 21 } })).toBe(21);
  });

  it('is complete when Imported=True', () => {
    expect(
      isHarvesterVmImageImportComplete({
        status: {
          conditions: [{ type: 'Imported', status: 'True' }],
          progress: 21,
        },
      }),
    ).toBe(true);
  });

  it('is complete when progress 100 and size present', () => {
    expect(
      isHarvesterVmImageImportComplete({
        status: { progress: 100, size: 5000 },
      }),
    ).toBe(true);
  });
});
