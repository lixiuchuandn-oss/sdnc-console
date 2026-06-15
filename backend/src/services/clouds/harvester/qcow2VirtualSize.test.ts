import {
  computeProxyStreamByteSize,
  injectVmImageVirtualSize,
  readQcow2VirtualSizeBytesFromBuffer,
  resolveCephCdiDataVolumeByteSize,
  resolveImageProxyUploadSizes,
} from './qcow2VirtualSize';
import { readVmImageVirtualSizeBytes } from './vmImageClusterApi';

function buildQcow2HeaderBuffer(virtualSize: bigint): Buffer {
  const buf = Buffer.alloc(64);
  Buffer.from([0x51, 0x46, 0x49, 0xfb]).copy(buf, 0);
  buf.writeBigUInt64BE(virtualSize, 24);
  return buf;
}

describe('readQcow2VirtualSizeBytesFromBuffer', () => {
  it('reads virtual size at offset 24 after magic', () => {
    const vs = BigInt(322122547200);
    expect(readQcow2VirtualSizeBytesFromBuffer(buildQcow2HeaderBuffer(vs))).toBe(322122547200);
  });

  it('finds magic after multipart-like prefix', () => {
    const prefix = Buffer.from('--boundary\r\nContent-Disposition: form-data\r\n\r\n');
    const header = buildQcow2HeaderBuffer(BigInt(8589934592));
    expect(readQcow2VirtualSizeBytesFromBuffer(Buffer.concat([prefix, header]))).toBe(8589934592);
  });

  it('returns undefined for non-qcow2', () => {
    expect(readQcow2VirtualSizeBytesFromBuffer(Buffer.from('not-a-qcow2-image'))).toBeUndefined();
  });
});

describe('resolveCephCdiDataVolumeByteSize', () => {
  it('uses max(file, virtual) for qcow2', () => {
    expect(
      resolveCephCdiDataVolumeByteSize({
        fileByteSize: 12884901888,
        virtualSizeBytes: 322122547200,
        diskFormat: 'qcow2',
      }),
    ).toBe(322122547200);
  });

  it('uses file size for iso', () => {
    expect(
      resolveCephCdiDataVolumeByteSize({
        fileByteSize: 5368709120,
        virtualSizeBytes: 10737418240,
        diskFormat: 'iso',
      }),
    ).toBe(5368709120);
  });
});

describe('resolveImageProxyUploadSizes', () => {
  it('ceph qcow2: upload URL size= is file bytes not virtual size', () => {
    const sizes = resolveImageProxyUploadSizes({
      fileByteTotal: 12884901888,
      storageKind: 'ceph',
      diskFormat: 'qcow2',
      virtualSizeBytes: 322122547200,
    });
    expect(sizes.streamByteSize).toBe(12884901888);
    expect(sizes.uploadUrlSize).toBe(12884901888);
  });

  it('longhorn: stream padded to 512', () => {
    const sizes = resolveImageProxyUploadSizes({
      fileByteTotal: 1000,
      storageKind: 'longhorn',
      diskFormat: 'qcow2',
      virtualSizeBytes: 322122547200,
    });
    expect(sizes.streamByteSize).toBe(1024);
    expect(sizes.uploadUrlSize).toBe(1024);
  });
});

describe('computeProxyStreamByteSize', () => {
  it('pads longhorn to 512 boundary', () => {
    expect(computeProxyStreamByteSize(1000, 'longhorn')).toBe(1024);
    expect(computeProxyStreamByteSize(1024, 'longhorn')).toBe(1024);
  });

  it('does not pad ceph', () => {
    expect(computeProxyStreamByteSize(12884901888, 'ceph')).toBe(12884901888);
  });
});

describe('injectVmImageVirtualSize', () => {
  it('writes status.virtualSize', () => {
    const injected = injectVmImageVirtualSize({ metadata: { name: 'img-a' } }, 8589934592);
    expect(readVmImageVirtualSizeBytes(injected)).toBe(8589934592);
  });
});
