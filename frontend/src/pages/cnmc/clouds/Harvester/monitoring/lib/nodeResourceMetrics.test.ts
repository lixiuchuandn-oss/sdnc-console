import {
  aggregateNodeMetrics,
  aggregateNodeResources,
  formatMemoryForDisplay,
  parseCpuToCores,
  parseMemoryToBytes,
} from './nodeResourceMetrics';

describe('nodeResourceMetrics', () => {
  it('parseCpuToCores handles cores and millicores', () => {
    expect(parseCpuToCores('2')).toBe(2);
    expect(parseCpuToCores('500m')).toBeCloseTo(0.5);
  });

  it('parseMemoryToBytes handles Gi/Mi', () => {
    expect(parseMemoryToBytes('1Gi')).toBe(1024 ** 3);
    expect(parseMemoryToBytes('512Mi')).toBe(512 * 1024 ** 2);
  });

  it('aggregateNodeResources sums allocatable', () => {
    const summary = aggregateNodeResources({
      data: [
        { status: { allocatable: { cpu: '2', memory: '4Gi' }, capacity: { memory: '8Gi' } } },
        { status: { allocatable: { cpu: '1', memory: '2Gi' }, capacity: { memory: '4Gi' } } },
      ],
    });
    expect(summary.totalCpuCores).toBe(3);
    expect(summary.totalMemoryBytes).toBe(6 * 1024 ** 3);
    expect(summary.reservedMemoryBytes).toBeGreaterThan(0);
  });

  it('aggregateNodeMetrics sums usage', () => {
    const summary = aggregateNodeMetrics({
      data: [{ usage: { cpu: '1000m', memory: '1Gi' } }],
    });
    expect(summary.usedCpuCores).toBeCloseTo(1);
    expect(summary.usedMemoryBytes).toBe(1024 ** 3);
  });

  it('formatMemoryForDisplay picks GiB or TiB', () => {
    expect(formatMemoryForDisplay(1024 ** 3).unit).toBe('GiB');
    expect(formatMemoryForDisplay(2 * 1024 ** 4).unit).toBe('TiB');
  });
});
