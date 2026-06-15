import {
  HARVESTER_CDI_UPLOAD_PROBE_BYTES,
  minMultipartFilePrefixBytes,
  takeAtLeastFromAsyncIterator,
} from './imageUploadMultipart';

describe('imageUploadMultipart', () => {
  it('minMultipartFilePrefixBytes fills gap to 1024 after header', () => {
    expect(minMultipartFilePrefixBytes(220)).toBe(1024 - 220);
    expect(minMultipartFilePrefixBytes(1024)).toBe(512);
  });

  it('takeAtLeastFromAsyncIterator buffers until min bytes', async () => {
    async function* gen() {
      yield Buffer.from('ab');
      yield Buffer.from('cdef');
      yield Buffer.from('ghij');
    }
    const iter = gen()[Symbol.asyncIterator]();
    const { prefix, iter: rest } = await takeAtLeastFromAsyncIterator(iter, 5);
    expect(prefix.toString()).toBe('abcdef');
    const tail = await rest.next();
    expect(tail.value?.toString()).toBe('ghij');
  });

  it('multipart header plus prefix covers probe window', () => {
    const headerLen = 248;
    const prefix = minMultipartFilePrefixBytes(headerLen);
    expect(headerLen + prefix).toBeGreaterThanOrEqual(HARVESTER_CDI_UPLOAD_PROBE_BYTES);
  });
});
