import {
  readVmImageVirtualSizeBytes,
  parseKubernetesQuantityToBytes,
  isHarvesterVmImageImportComplete,
  isHarvesterVmImageImportedTerminalFailure,
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

  it('is complete when Imported=False transient but progress 100 and size present', () => {
    expect(
      isHarvesterVmImageImportComplete({
        status: {
          progress: 100,
          size: 5000,
          conditions: [{ type: 'Imported', status: 'False' }],
        },
      }),
    ).toBe(true);
  });
});

describe('isHarvesterVmImageImportedTerminalFailure', () => {
  it('is not terminal for Imported=False during import progress', () => {
    expect(
      isHarvesterVmImageImportedTerminalFailure({
        status: {
          progress: 42,
          conditions: [{ type: 'Imported', status: 'False' }],
        },
      }),
    ).toBe(false);
  });

  it('is terminal for ImportFailed at 60% when import stalled', () => {
    expect(
      isHarvesterVmImageImportedTerminalFailure({
        status: {
          progress: 60,
          conditions: [{ type: 'Imported', status: 'False', reason: 'ImportFailed', message: 'x' }],
        },
      }),
    ).toBe(true);
  });

  it('is terminal for ImportFailed reason when not actively importing', () => {
    expect(
      isHarvesterVmImageImportedTerminalFailure({
        status: {
          conditions: [{ type: 'Imported', status: 'False', reason: 'ImportFailed', message: 'x' }],
        },
      }),
    ).toBe(true);
  });

  it('is not terminal for ImportFailed at 99% import progress', () => {
    expect(
      isHarvesterVmImageImportedTerminalFailure({
        status: {
          progress: 99,
          conditions: [{ type: 'Imported', status: 'False', reason: 'ImportFailed', message: 'x' }],
        },
      }),
    ).toBe(false);
  });

  it('ignores context canceled as transient', () => {
    expect(
      isHarvesterVmImageImportedTerminalFailure({
        status: {
          conditions: [
            { type: 'Imported', status: 'False', message: 'context canceled while uploading' },
          ],
        },
      }),
    ).toBe(false);
  });
});
