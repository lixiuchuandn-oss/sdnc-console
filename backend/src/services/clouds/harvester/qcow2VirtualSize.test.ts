import { injectVmImageVirtualSize } from './qcow2VirtualSize';
import { readVmImageVirtualSizeBytes } from './vmImageClusterApi';

describe('injectVmImageVirtualSize', () => {
  it('writes status.virtualSize', () => {
    const injected = injectVmImageVirtualSize({ metadata: { name: 'img-a' } }, 8589934592);
    expect(readVmImageVirtualSizeBytes(injected)).toBe(8589934592);
  });
});
