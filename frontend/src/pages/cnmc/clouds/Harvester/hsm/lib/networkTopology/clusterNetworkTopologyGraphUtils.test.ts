import {
  clusterNetworkTopologyLabel,
  nodeNamesForClusterNetwork,
  uplinkNicsListForClusterNetworkOnNode,
} from './clusterNetworkTopologyGraphUtils';

describe('clusterNetworkTopologyGraphUtils', () => {
  const nodes = [
    { metadata: { name: 'node-a', labels: { zone: 'a' } } },
    { metadata: { name: 'node-b', labels: { zone: 'b' } } },
  ];

  describe('clusterNetworkTopologyLabel', () => {
    it('returns trimmed metadata name or fallback', () => {
      expect(clusterNetworkTopologyLabel('mgmt')).toBe('mgmt');
      expect(clusterNetworkTopologyLabel('')).toBe('集群网络');
    });
  });

  describe('nodeNamesForClusterNetwork', () => {
    it('returns all nodes when no vlanConfigs', () => {
      expect(nodeNamesForClusterNetwork({}, nodes)).toEqual(['node-a', 'node-b']);
    });

    it('filters by vlanConfig nodeSelector', () => {
      const cn = {
        vlanConfigs: [{ spec: { nodeSelector: { zone: 'a' } } }],
      };
      expect(nodeNamesForClusterNetwork(cn, nodes)).toEqual(['node-a']);
    });
  });

  describe('uplinkNicsListForClusterNetworkOnNode', () => {
    it('collects nics from matching vlanConfig', () => {
      const cn = {
        vlanConfigs: [
          {
            spec: {
              nodeSelector: { zone: 'a' },
              uplink: { nics: ['eth0', 'eth1'] },
            },
          },
        ],
      };
      expect(uplinkNicsListForClusterNetworkOnNode(cn, 'node-a', nodes)).toEqual(['eth0', 'eth1']);
      expect(uplinkNicsListForClusterNetworkOnNode(cn, 'node-b', nodes)).toEqual([]);
    });

    it('falls back to cn.uplinks when no vlanConfigs', () => {
      const cn = { uplinks: { nics: ['bond0'] } };
      expect(uplinkNicsListForClusterNetworkOnNode(cn, 'node-a', nodes)).toEqual(['bond0']);
    });
  });
});
