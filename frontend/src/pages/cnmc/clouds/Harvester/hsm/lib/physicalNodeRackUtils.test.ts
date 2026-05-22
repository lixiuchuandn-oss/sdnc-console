import {
  nodeCpuArchitecture,
  nodeCpuModelName,
  nodeManagementIp,
  nodeReadyLedClass,
  nodeUsagePercents,
  parseCpuToCores,
  parseMemoryToBytes,
} from './physicalNodeRackUtils';

describe('physicalNodeRackUtils', () => {
  describe('parseCpuToCores', () => {
    it('handles cores, millicores, nanocores', () => {
      expect(parseCpuToCores('4')).toBe(4);
      expect(parseCpuToCores('500m')).toBeCloseTo(0.5);
      expect(parseCpuToCores('1000000n')).toBeCloseTo(0.001);
    });

    it('returns 0 for empty input', () => {
      expect(parseCpuToCores(undefined)).toBe(0);
      expect(parseCpuToCores('')).toBe(0);
    });
  });

  describe('parseMemoryToBytes', () => {
    it('handles binary and decimal units', () => {
      expect(parseMemoryToBytes('1Gi')).toBe(1024 ** 3);
      expect(parseMemoryToBytes('512Mi')).toBe(512 * 1024 ** 2);
      expect(parseMemoryToBytes('1G')).toBe(1e9);
    });
  });

  describe('nodeManagementIp', () => {
    it('prefers internalIP shortcut', () => {
      expect(nodeManagementIp({ internalIP: '10.0.0.1' })).toBe('10.0.0.1');
    });

    it('reads InternalIP from status.addresses', () => {
      expect(
        nodeManagementIp({
          status: { addresses: [{ type: 'InternalIP', address: '192.168.0.5' }] },
        }),
      ).toBe('192.168.0.5');
    });
  });

  describe('nodeCpuArchitecture', () => {
    it('reads kubernetes.io/arch label', () => {
      expect(
        nodeCpuArchitecture({
          metadata: { labels: { 'kubernetes.io/arch': 'arm64' } },
        }),
      ).toBe('arm64');
    });
  });

  describe('nodeCpuModelName', () => {
    it('reads HMS hardware.cpu Model name', () => {
      expect(
        nodeCpuModelName({
          hardware: { cpu: { 'Model name': 'Intel Xeon Gold 6248R' } },
        }),
      ).toBe('Intel Xeon Gold 6248R');
    });
  });

  describe('nodeUsagePercents', () => {
    it('computes cpu/mem/storage usage capped at 100', () => {
      const node = {
        status: {
          allocatable: { cpu: '4', memory: '8Gi', 'ephemeral-storage': '100Gi' },
        },
      };
      const pct = nodeUsagePercents('node-a', node, {
        'node-a': { cpuUsedCores: 2, memUsedBytes: 4 * 1024 ** 3, storageUsedBytes: 50 * 1024 ** 3 },
      });
      expect(pct.cpuPct).toBe(50);
      expect(pct.memPct).toBe(50);
      expect(pct.storagePct).toBe(50);
    });

    it('returns zeros when metrics missing', () => {
      expect(nodeUsagePercents('n1', {}, {})).toEqual({ cpuPct: 0, memPct: 0, storagePct: 0 });
    });
  });

  describe('nodeReadyLedClass', () => {
    it('uses ready boolean when present', () => {
      expect(nodeReadyLedClass({ ready: true })).toBe('ok');
      expect(nodeReadyLedClass({ ready: false })).toBe('err');
    });

    it('reads Ready condition from status', () => {
      expect(
        nodeReadyLedClass({
          status: { conditions: [{ type: 'Ready', status: 'True' }] },
        }),
      ).toBe('ok');
      expect(nodeReadyLedClass({ status: { conditions: [] } })).toBe('warn');
    });
  });
});
