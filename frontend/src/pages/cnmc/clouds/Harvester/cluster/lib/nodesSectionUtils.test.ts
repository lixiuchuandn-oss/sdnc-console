import {
  buildNodeRoleFilterOptions,
  filterNodesForTable,
  getRoles,
  isReady,
  nodeInternalIp,
  nodeRowKey,
  parseCpuToCores,
  parseMemoryToBytes,
} from './nodesSectionUtils';

describe('nodesSectionUtils', () => {
  const readyNode = {
    name: 'node-a',
    metadata: {
      name: 'node-a',
      labels: {
        'node-role.kubernetes.io/worker': '',
        'kubernetes.io/role': 'worker',
      },
    },
    ready: true,
    internalIP: '10.0.0.1',
    status: {
      conditions: [{ type: 'Ready', status: 'True' }],
      allocatable: { cpu: '4', memory: '8Gi' },
    },
  };

  const notReadyNode = {
    metadata: { name: 'node-b', labels: { 'node-role.kubernetes.io/control-plane': '' } },
    status: {
      conditions: [{ type: 'Ready', status: 'False' }],
      addresses: [{ type: 'InternalIP', address: '10.0.0.2' }],
    },
  };

  describe('getRoles', () => {
    it('merges roles from labels and roles array', () => {
      const roles = getRoles({
        roles: ['node-role.kubernetes.io/etcd'],
        metadata: { labels: { 'node-role.kubernetes.io/worker': '', 'kubernetes.io/role': 'worker' } },
      });
      expect(roles).toEqual(expect.arrayContaining(['etcd', 'worker']));
      expect(new Set(roles).size).toBe(roles.length);
    });
  });

  describe('isReady', () => {
    it('uses ready boolean when present', () => {
      expect(isReady(readyNode)).toBe(true);
      expect(isReady({ ready: false })).toBe(false);
    });

    it('falls back to Ready condition', () => {
      expect(isReady(notReadyNode)).toBe(false);
      expect(isReady({ status: { conditions: [{ type: 'Ready', status: 'True' }] } })).toBe(true);
    });
  });

  describe('parseCpuToCores / parseMemoryToBytes', () => {
    it('parses cpu and memory quantities', () => {
      expect(parseCpuToCores('500m')).toBeCloseTo(0.5);
      expect(parseCpuToCores('4')).toBe(4);
      expect(parseMemoryToBytes('512Mi')).toBe(512 * 1024 * 1024);
      expect(parseMemoryToBytes('1Gi')).toBe(1024 * 1024 * 1024);
    });
  });

  describe('filterNodesForTable', () => {
    it('filters by keyword, role and ready state', () => {
      const rows = filterNodesForTable([readyNode, notReadyNode], {
        keyword: 'node-a',
        roleFilter: 'worker',
        readyFilter: 'ready',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe('node-a');
    });

    it('filters notready nodes', () => {
      const rows = filterNodesForTable([readyNode, notReadyNode], {
        keyword: '',
        roleFilter: '',
        readyFilter: 'notready',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata?.name).toBe('node-b');
    });
  });

  describe('buildNodeRoleFilterOptions / nodeInternalIp / nodeRowKey', () => {
    it('builds role options and reads ip/key', () => {
      const opts = buildNodeRoleFilterOptions([readyNode, notReadyNode]);
      expect(opts.some((o) => o.value === 'worker')).toBe(true);
      expect(nodeInternalIp(readyNode)).toBe('10.0.0.1');
      expect(nodeInternalIp(notReadyNode)).toBe('10.0.0.2');
      expect(nodeRowKey(readyNode, 0)).toBe('node-a');
    });
  });
});
