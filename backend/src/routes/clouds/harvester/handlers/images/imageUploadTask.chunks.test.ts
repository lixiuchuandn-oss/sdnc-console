import {
  computeTotalChunks,
  expectedChunkByteSize,
  parseReceivedChunkIndices,
} from './imageUploadTask.chunks';

describe('imageUploadTask.chunks', () => {
  it('computeTotalChunks rounds up partial last chunk', () => {
    const cs = 32 * 1024 * 1024;
    expect(computeTotalChunks(cs, cs)).toBe(1);
    expect(computeTotalChunks(cs + 1, cs)).toBe(2);
  });

  it('expectedChunkByteSize uses smaller tail for last index', () => {
    const fileSize = 100;
    const cs = 40;
    const total = 3;
    expect(expectedChunkByteSize(fileSize, cs, total, 0)).toBe(40);
    expect(expectedChunkByteSize(fileSize, cs, total, 2)).toBe(20);
  });

  it('parseReceivedChunkIndices sorts valid indices', () => {
    expect(parseReceivedChunkIndices('[2,0,1]')).toEqual([0, 1, 2]);
  });
});
