import {
  buildManualNumaNodes,
  resolveTotalVcpusFromTopology,
  validateManualNumaParams,
} from './numaManual';

describe('numaManual', () => {
  it('builds even manual nodes', () => {
    expect(buildManualNumaNodes(8, 2, 16)).toEqual([
      { vcpus: '0-3', memory: '8Gi' },
      { vcpus: '4-7', memory: '8Gi' },
    ]);
  });

  it('validates socket divisibility', () => {
    expect(
      validateManualNumaParams({
        totalVcpus: 8,
        sockets: 2,
        nodeCount: 2,
        totalMemoryGi: 8,
      }),
    ).toBeNull();
    expect(
      validateManualNumaParams({
        totalVcpus: 8,
        sockets: 3,
        nodeCount: 2,
        totalMemoryGi: 8,
      }),
    ).toMatch(/插槽/);
  });

  it('resolves total vcpus from topology', () => {
    expect(resolveTotalVcpusFromTopology(2, 4, 1)).toBe(8);
  });
});
